-- ════════════════════════════════════════════════════════════════════════════
-- Phase 25 — reopen_expense: edit a confirmed expense (reverse + reopen to draft)
-- ════════════════════════════════════════════════════════════════════════════
-- Mirrors void_expense (Phase 17d) exactly, EXCEPT the final state is 'draft'
-- (not 'void') and the void_* fields are cleared. The user then edits the draft
-- and re-confirms — reusing the proven confirm_expense path. SECURITY INVOKER,
-- so RLS enforces it: the expenses UPDATE requires purchasing.write and the GL
-- reversal requires has_any_write (Phase 24). Period-lock guarded.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.reopen_expense(p_expense_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER
AS $$
DECLARE
  v_user_id UUID := auth.uid(); v_company_id UUID; v_expense public.expenses%ROWTYPE;
  v_lock_date DATE; v_je RECORD; v_rev_je_id UUID; v_rev_je_num TEXT; v_total NUMERIC;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'reopen_expense: no company for user %', v_user_id; END IF;

  SELECT * INTO v_expense FROM public.expenses WHERE id = p_expense_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'reopen_expense: expense % not found', p_expense_id; END IF;
  IF v_expense.status <> 'confirmed' THEN
    RAISE EXCEPTION 'reopen_expense: only confirmed expenses can be reopened (status=%)', v_expense.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_expense.date <= v_lock_date THEN
    RAISE EXCEPTION 'reopen_expense: posting date % is in a locked period', v_expense.date;
  END IF;

  -- Find the live posting JE for this expense.
  SELECT * INTO v_je FROM public.journal_entries
   WHERE source_type = 'expense' AND source_id = p_expense_id AND company_id = v_company_id AND reversed_by_id IS NULL
   ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'reopen_expense: no live JE found for expense %', p_expense_id; END IF;

  SELECT COALESCE(SUM(debit), 0) INTO v_total FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  -- Allocate a reversal JE number.
  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1000, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'JE-' || current_value::TEXT INTO v_rev_je_num FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'JE';

  -- Post the mirror-image reversal.
  INSERT INTO public.journal_entries
    (company_id, entry_number, date, source_type, source_id, description, total_debit, total_credit, created_by, reversal_of_id)
  VALUES
    (v_company_id, v_rev_je_num, CURRENT_DATE, 'expense', p_expense_id,
     'REOPEN: ' || COALESCE(v_expense.expense_number, 'Expense'), v_total, v_total, v_user_id, v_je.id)
  RETURNING id INTO v_rev_je_id;

  INSERT INTO public.general_ledger (company_id, journal_entry_id, account_id, debit, credit, description)
  SELECT v_company_id, v_rev_je_id, account_id, credit, debit, 'REOPEN: ' || description
    FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  UPDATE public.journal_entries SET reversed_by_id = v_rev_je_id WHERE id = v_je.id;

  -- Flip the expense back to draft (clearing any void fields).
  UPDATE public.expenses
     SET status = 'draft', void_reason = NULL, voided_at = NULL, voided_by = NULL, updated_at = NOW()
   WHERE id = p_expense_id;

  INSERT INTO public.audit_logs (company_id, entity_type, entity_id, action, user_id, new_data)
  VALUES (v_company_id, 'expenses', p_expense_id, 'update', v_user_id,
          jsonb_build_object('reopened', true, 'reversal_je_id', v_rev_je_id));

  RETURN jsonb_build_object('expense_id', p_expense_id, 'reversal_je_id', v_rev_je_id);
END;
$$;

NOTIFY pgrst, 'reload schema';
