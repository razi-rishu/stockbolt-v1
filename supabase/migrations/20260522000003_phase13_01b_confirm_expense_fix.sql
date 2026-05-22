-- ════════════════════════════════════════════════════════════════════════════
-- Phase 13.01b — confirm_expense column-name fix
-- ════════════════════════════════════════════════════════════════════════════
--
-- The Phase 13.01 rewrite carried over a long-standing bug from the original
-- Phase 8 RPC: it tried to INSERT into journal_entries / audit_logs columns
-- that don't actually exist on those tables. Result — clicking Confirm on
-- any expense raised:
--   "column \"je_number\" of relation \"journal_entries\" does not exist"
--
-- The real columns (verified against the live schema):
--   journal_entries:
--     entry_number (NOT je_number)
--     description, source_type, source_id, currency, exchange_rate,
--     total_debit, total_credit, created_by (NOT posted_by)
--     reversed_by_id, reversal_of_id  (no is_reversed flag)
--   audit_logs:
--     user_id (NOT performed_by), action, entity_type (NOT table_name),
--     entity_id (NOT record_id), new_data
--
-- Also: when 1500 Input VAT doesn't exist but tax > 0, the previous code
-- credited Cr paid_from for the full inclusive total while only debiting
-- the ex-tax amount — produced an unbalanced JE. Fix: in that case fold
-- the tax into the expense-side debit so total_debit = total_credit.
--
-- void_expense is untouched — it reverses by JE id and the JE row is
-- already correct.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.confirm_expense(p_expense_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id        UUID := auth.uid();
  v_company_id     UUID;
  v_company_curr   TEXT;
  v_expense        public.expenses%ROWTYPE;
  v_lock_date      DATE;
  v_paid_coa_id    UUID;
  v_paid_coa_code  TEXT;
  v_input_vat_id   UUID;
  v_je_id          UUID;
  v_je_number      TEXT;
  v_item_count     INTEGER;
  v_total_tax      NUMERIC(15,2);
  v_rec            RECORD;
  v_seq            BIGINT;
  v_legacy_code    TEXT;
  -- When 1500 is missing, expense lines absorb the tax inline so the JE
  -- still balances. v_fold_tax flips on in that branch.
  v_fold_tax       BOOLEAN := FALSE;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_expense: no company for user %', v_user_id;
  END IF;

  SELECT currency INTO v_company_curr FROM public.companies WHERE id = v_company_id;
  v_company_curr := COALESCE(v_company_curr, 'AED');

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

  -- Resolve paid-from bank account → CoA id + code.
  SELECT ba.coa_account_id, coa.code
    INTO v_paid_coa_id, v_paid_coa_code
    FROM public.bank_accounts ba
    JOIN public.chart_of_accounts coa ON coa.id = ba.coa_account_id
   WHERE ba.id = v_expense.paid_from_account_id
     AND ba.company_id = v_company_id;
  IF v_paid_coa_id IS NULL THEN
    RAISE EXCEPTION 'confirm_expense: paid_from_account has no CoA link';
  END IF;

  -- Resolve Input VAT account (1500).
  SELECT id INTO v_input_vat_id
    FROM public.chart_of_accounts
   WHERE company_id = v_company_id AND code = '1500' LIMIT 1;

  -- Decide whether to post tax to 1500 or fold it into the expense line(s).
  v_fold_tax := (v_expense.tax_amount > 0 AND v_input_vat_id IS NULL);

  -- Allocate JE number.
  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_seq;
  v_je_number := 'JE-' || v_seq::TEXT;

  -- JE header — real columns: entry_number / total_debit / total_credit /
  -- created_by. Both totals equal expense.total_amount (the JE balances).
  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, currency, exchange_rate,
    total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_je_number, v_expense.date,
    COALESCE(v_expense.description, 'Expense ' || v_expense.expense_number),
    'expense', p_expense_id, v_company_curr, 1,
    v_expense.total_amount, v_expense.total_amount, v_user_id
  ) RETURNING id INTO v_je_id;

  -- Branch: multi-line vs single-line.
  SELECT COUNT(*) INTO v_item_count
    FROM public.expense_items WHERE expense_id = p_expense_id;

  IF v_item_count > 0 THEN
    -- Multi-line. One Dr row per unique expense account.
    -- If v_fold_tax: include tax in the per-account debit. Else: tax is
    -- posted separately to 1500 below.
    FOR v_rec IN
      SELECT
        ei.expense_account_id,
        coa.code AS account_code,
        SUM(ei.line_subtotal) AS subtotal_sum,
        SUM(ei.tax_amount)    AS tax_sum
      FROM public.expense_items ei
      JOIN public.chart_of_accounts coa ON coa.id = ei.expense_account_id
     WHERE ei.expense_id = p_expense_id
     GROUP BY ei.expense_account_id, coa.code
    LOOP
      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date,
         debit, credit, description, contact_id, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_je_id, v_rec.expense_account_id, v_rec.account_code, v_expense.date,
         v_rec.subtotal_sum + (CASE WHEN v_fold_tax THEN v_rec.tax_sum ELSE 0 END), 0,
         'Expense ' || v_expense.expense_number,
         v_expense.supplier_id, 'expense', p_expense_id);
    END LOOP;

    IF NOT v_fold_tax THEN
      SELECT COALESCE(SUM(tax_amount), 0) INTO v_total_tax
        FROM public.expense_items WHERE expense_id = p_expense_id;
    ELSE
      v_total_tax := 0;
    END IF;

  ELSE
    -- Legacy single-line. Fold tax inline if 1500 is missing.
    SELECT code INTO v_legacy_code FROM public.chart_of_accounts
     WHERE id = v_expense.expense_account_id LIMIT 1;

    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_expense.expense_account_id, v_legacy_code, v_expense.date,
       v_expense.amount + (CASE WHEN v_fold_tax THEN v_expense.tax_amount ELSE 0 END), 0,
       COALESCE(v_expense.description, 'Expense'),
       v_expense.supplier_id, 'expense', p_expense_id);

    v_total_tax := CASE WHEN v_fold_tax THEN 0 ELSE v_expense.tax_amount END;
  END IF;

  -- Dr Input VAT (only when tax > 0 AND 1500 exists, i.e. NOT folded).
  IF v_total_tax > 0 THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_input_vat_id, '1500', v_expense.date,
       v_total_tax, 0,
       'Input VAT on ' || v_expense.expense_number,
       v_expense.supplier_id, 'expense', p_expense_id);
  END IF;

  -- Cr paid-from for the full inclusive total.
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date,
     debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_paid_coa_id, v_paid_coa_code, v_expense.date,
     0, v_expense.total_amount,
     'Payment for ' || v_expense.expense_number,
     v_expense.supplier_id, 'expense', p_expense_id);

  UPDATE public.expenses
     SET status = 'confirmed', updated_at = NOW()
   WHERE id = p_expense_id;

  -- Audit log. Real columns: user_id / action / entity_type / entity_id /
  -- new_data. Wrap in BEGIN/EXCEPTION so a schema drift here never blocks
  -- the actual confirm (matches the pattern used in confirm_invoice).
  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'expense', p_expense_id,
            jsonb_build_object(
              'journal_entry_id', v_je_id,
              'entry_number',     v_je_number,
              'item_count',       v_item_count
            ));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'expense_id',       p_expense_id,
    'journal_entry_id', v_je_id,
    'entry_number',     v_je_number,
    'item_count',       v_item_count
  );
END;
$$;

COMMENT ON FUNCTION public.confirm_expense IS
  'Phase 13.01 / 13.01b — multi-line aware expense confirm with correct '
  'journal_entries column names (entry_number, total_debit, total_credit, '
  'created_by). Falls back to fold-tax-inline when 1500 Input VAT is '
  'absent so the JE always balances.';

NOTIFY pgrst, 'reload schema';
