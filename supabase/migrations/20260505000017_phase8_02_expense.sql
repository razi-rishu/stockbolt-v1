-- Phase 8 — Banking: confirm_expense + void_expense
-- D3: Direct Expense Payment
--   Dr expense_account (taxable_amount)
--   Dr 1500 Input VAT (tax_amount, if > 0)
--   Cr paid_from_account COA (total_amount)

-- ── confirm_expense ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.confirm_expense(p_expense_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_company_id    UUID;
  v_expense       public.expenses%ROWTYPE;
  v_lock_date     DATE;
  v_paid_coa_id   UUID;
  v_input_vat_id  UUID;
  v_je_id         UUID;
  v_je_number     TEXT;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_expense: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_expense
    FROM public.expenses
   WHERE id = p_expense_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_expense: expense % not found', p_expense_id;
  END IF;
  IF v_expense.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_expense: expense already % — cannot confirm', v_expense.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_expense.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_expense: date % is on or before period lock %', v_expense.date, v_lock_date;
  END IF;

  -- Resolve paid-from bank account COA
  SELECT coa_account_id INTO v_paid_coa_id
    FROM public.bank_accounts WHERE id = v_expense.paid_from_account_id AND company_id = v_company_id;
  IF v_paid_coa_id IS NULL THEN
    RAISE EXCEPTION 'confirm_expense: paid_from_account has no COA link';
  END IF;

  -- Resolve Input VAT account (1500) if tax amount exists
  IF v_expense.tax_amount > 0 THEN
    SELECT id INTO v_input_vat_id
      FROM public.chart_of_accounts
     WHERE company_id = v_company_id AND code = '1500' LIMIT 1;
    -- If 1500 doesn't exist, fall back to treating tax as part of expense
    -- (some companies don't claim input VAT)
  END IF;

  -- JE number
  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1000, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'JE-' || current_value::TEXT INTO v_je_number
    FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'JE';

  -- Post JE: D3
  INSERT INTO public.journal_entries
    (company_id, je_number, date, source_type, source_id, description, posted_by, is_reversed)
  VALUES
    (v_company_id, v_je_number, v_expense.date,
     'expense', p_expense_id,
     COALESCE(v_expense.description, 'Expense ' || v_expense.expense_number),
     v_user_id, FALSE)
  RETURNING id INTO v_je_id;

  -- Dr expense account (taxable amount = amount excl tax)
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, debit, credit, description)
  VALUES
    (v_company_id, v_je_id, v_expense.expense_account_id,
     v_expense.amount, 0,
     COALESCE(v_expense.description, 'Expense'));

  -- Dr Input VAT if applicable and account found
  IF v_expense.tax_amount > 0 AND v_input_vat_id IS NOT NULL THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, debit, credit, description)
    VALUES
      (v_company_id, v_je_id, v_input_vat_id,
       v_expense.tax_amount, 0,
       'Input VAT on ' || v_expense.expense_number);
  END IF;

  -- Cr paid-from account (total amount)
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, debit, credit, description)
  VALUES
    (v_company_id, v_je_id, v_paid_coa_id,
     0, v_expense.total_amount,
     'Payment for ' || v_expense.expense_number);

  -- Confirm
  UPDATE public.expenses
     SET status = 'confirmed', updated_at = NOW()
   WHERE id = p_expense_id;

  -- Audit
  INSERT INTO public.audit_logs (company_id, table_name, record_id, action, performed_by, new_data)
  VALUES (v_company_id, 'expenses', p_expense_id, 'confirm', v_user_id,
          jsonb_build_object('journal_entry_id', v_je_id));

  RETURN jsonb_build_object('expense_id', p_expense_id, 'journal_entry_id', v_je_id);
END;
$$;

-- ── void_expense ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.void_expense(
  p_expense_id  UUID,
  p_void_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_expense    public.expenses%ROWTYPE;
  v_lock_date  DATE;
  v_je         RECORD;
  v_rev_je_id  UUID;
  v_rev_je_num TEXT;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'void_expense: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_expense
    FROM public.expenses
   WHERE id = p_expense_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'void_expense: expense % not found', p_expense_id;
  END IF;
  IF v_expense.status <> 'confirmed' THEN
    RAISE EXCEPTION 'void_expense: only confirmed expenses can be voided (status=%)', v_expense.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_expense.date <= v_lock_date THEN
    RAISE EXCEPTION 'void_expense: posting date % is in a locked period', v_expense.date;
  END IF;

  -- Find original JE
  SELECT * INTO v_je
    FROM public.journal_entries
   WHERE source_type = 'expense' AND source_id = p_expense_id
     AND company_id = v_company_id AND is_reversed = FALSE
   ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'void_expense: no live JE found for expense %', p_expense_id;
  END IF;

  -- Reversal JE number
  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1000, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'JE-' || current_value::TEXT INTO v_rev_je_num
    FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'JE';

  INSERT INTO public.journal_entries
    (company_id, je_number, date, source_type, source_id, description, posted_by, is_reversed, reversal_of_id)
  VALUES
    (v_company_id, v_rev_je_num, CURRENT_DATE,
     'expense', p_expense_id,
     'VOID: ' || COALESCE(p_void_reason, 'Expense Void'),
     v_user_id, TRUE, v_je.id)
  RETURNING id INTO v_rev_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, debit, credit, description)
  SELECT v_company_id, v_rev_je_id, account_id, credit, debit, 'VOID: ' || description
    FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  UPDATE public.journal_entries SET is_reversed = TRUE WHERE id = v_je.id;

  UPDATE public.expenses
     SET status = 'void', void_reason = p_void_reason, voided_at = NOW(), voided_by = v_user_id,
         updated_at = NOW()
   WHERE id = p_expense_id;

  INSERT INTO public.audit_logs (company_id, table_name, record_id, action, performed_by, new_data)
  VALUES (v_company_id, 'expenses', p_expense_id, 'void', v_user_id,
          jsonb_build_object('void_reason', p_void_reason, 'reversal_je_id', v_rev_je_id));

  RETURN jsonb_build_object('expense_id', p_expense_id, 'reversal_je_id', v_rev_je_id);
END;
$$;
