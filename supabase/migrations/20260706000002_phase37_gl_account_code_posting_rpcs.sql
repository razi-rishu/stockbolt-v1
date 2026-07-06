-- =============================================================================
-- Phase 37 — Fix GL inserts missing NOT NULL account_code / date (8 RPCs)
-- =============================================================================
-- general_ledger.account_code and general_ledger.date are NOT NULL with no
-- default. Eight posting RPCs inserted GL rows without them, so every call
-- failed with "null value in column account_code":
--
--   confirm_bank_transfer, void_bank_transfer   (bank transfers NEVER posted)
--   create_pdc, clear_pdc, bounce_pdc, cancel_pdc (PDC module NEVER posted)
--   void_expense, reopen_expense                (confirm works; void/reopen broken)
--
-- Verified live: zero journal_entries exist with source_type
-- 'bank_transfer' / 'pdc_%' in any tenant — no historical data to repair.
--
-- Each function below is the live pg_get_functiondef with the GL insert
-- brought in line with reverse_journal_entry's convention: account_code,
-- date, contact_id, related_doc_type/related_doc_id (+ reversal_of_id on
-- mirror-copy reversals). No other logic is changed.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. confirm_bank_transfer — resolve account codes, date GL at transfer date
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_bank_transfer(p_transfer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id UUID := auth.uid(); v_company_id UUID; v_transfer public.bank_transfers%ROWTYPE;
  v_lock_date DATE; v_from_coa_id UUID; v_to_coa_id UUID; v_je_id UUID; v_je_number TEXT;
  v_from_code TEXT; v_to_code TEXT;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'confirm_bank_transfer: no company for user %', v_user_id; END IF;
  SELECT * INTO v_transfer FROM public.bank_transfers WHERE id = p_transfer_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'confirm_bank_transfer: transfer % not found', p_transfer_id; END IF;
  IF v_transfer.status <> 'draft' THEN RAISE EXCEPTION 'confirm_bank_transfer: transfer already % — cannot confirm', v_transfer.status; END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_transfer.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_bank_transfer: date % is on or before period lock %', v_transfer.date, v_lock_date; END IF;

  SELECT coa_account_id INTO v_from_coa_id FROM public.bank_accounts WHERE id = v_transfer.from_account_id AND company_id = v_company_id;
  IF v_from_coa_id IS NULL THEN RAISE EXCEPTION 'confirm_bank_transfer: from_account % has no COA link', v_transfer.from_account_id; END IF;
  SELECT coa_account_id INTO v_to_coa_id FROM public.bank_accounts WHERE id = v_transfer.to_account_id AND company_id = v_company_id;
  IF v_to_coa_id IS NULL THEN RAISE EXCEPTION 'confirm_bank_transfer: to_account % has no COA link', v_transfer.to_account_id; END IF;

  SELECT code INTO v_from_code FROM public.chart_of_accounts WHERE id = v_from_coa_id;
  IF v_from_code IS NULL THEN RAISE EXCEPTION 'confirm_bank_transfer: COA account % has no code', v_from_coa_id; END IF;
  SELECT code INTO v_to_code FROM public.chart_of_accounts WHERE id = v_to_coa_id;
  IF v_to_code IS NULL THEN RAISE EXCEPTION 'confirm_bank_transfer: COA account % has no code', v_to_coa_id; END IF;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1000, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'JE-' || current_value::TEXT INTO v_je_number FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'JE';

  INSERT INTO public.journal_entries
    (company_id, entry_number, date, source_type, source_id, description, total_debit, total_credit, created_by)
  VALUES
    (v_company_id, v_je_number, v_transfer.date, 'bank_transfer', p_transfer_id,
     COALESCE(v_transfer.reference, 'Bank Transfer ' || v_transfer.transfer_number),
     v_transfer.amount, v_transfer.amount, v_user_id)
  RETURNING id INTO v_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_to_coa_id,   v_to_code,   v_transfer.date, v_transfer.amount, 0, 'Transfer in',  'bank_transfer', p_transfer_id),
    (v_company_id, v_je_id, v_from_coa_id, v_from_code, v_transfer.date, 0, v_transfer.amount, 'Transfer out', 'bank_transfer', p_transfer_id);

  UPDATE public.bank_transfers SET status = 'confirmed', updated_at = NOW() WHERE id = p_transfer_id;

  INSERT INTO public.audit_logs (company_id, entity_type, entity_id, action, user_id, new_data)
  VALUES (v_company_id, 'bank_transfers', p_transfer_id, 'confirm', v_user_id, jsonb_build_object('journal_entry_id', v_je_id));

  RETURN jsonb_build_object('transfer_id', p_transfer_id, 'journal_entry_id', v_je_id);
END; $function$;


-- ---------------------------------------------------------------------------
-- 2. void_bank_transfer — mirror-copy carries account_code/date/links
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.void_bank_transfer(p_transfer_id uuid, p_void_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id UUID := auth.uid(); v_company_id UUID; v_transfer public.bank_transfers%ROWTYPE;
  v_lock_date DATE; v_je RECORD; v_rev_je_id UUID; v_rev_je_num TEXT; v_total NUMERIC;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'void_bank_transfer: no company for user %', v_user_id; END IF;
  SELECT * INTO v_transfer FROM public.bank_transfers WHERE id = p_transfer_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'void_bank_transfer: transfer % not found', p_transfer_id; END IF;
  IF v_transfer.status <> 'confirmed' THEN RAISE EXCEPTION 'void_bank_transfer: only confirmed transfers can be voided (status=%)', v_transfer.status; END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_transfer.date <= v_lock_date THEN RAISE EXCEPTION 'void_bank_transfer: posting date % is in a locked period', v_transfer.date; END IF;

  SELECT * INTO v_je FROM public.journal_entries
   WHERE source_type = 'bank_transfer' AND source_id = p_transfer_id AND company_id = v_company_id AND reversed_by_id IS NULL
   ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'void_bank_transfer: no live JE found for transfer %', p_transfer_id; END IF;

  SELECT COALESCE(SUM(debit), 0) INTO v_total FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1000, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'JE-' || current_value::TEXT INTO v_rev_je_num FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'JE';

  INSERT INTO public.journal_entries
    (company_id, entry_number, date, source_type, source_id, description, total_debit, total_credit, created_by, reversal_of_id)
  VALUES
    (v_company_id, v_rev_je_num, CURRENT_DATE, 'bank_transfer', p_transfer_id,
     'VOID: ' || COALESCE(p_void_reason, 'Bank Transfer Void'), v_total, v_total, v_user_id, v_je.id)
  RETURNING id INTO v_rev_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id, reversal_of_id)
  SELECT v_company_id, v_rev_je_id, account_id, account_code, CURRENT_DATE, credit, debit, 'VOID: ' || description, contact_id, related_doc_type, related_doc_id, id
    FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  UPDATE public.journal_entries SET reversed_by_id = v_rev_je_id WHERE id = v_je.id;
  UPDATE public.bank_transfers SET status = 'void', updated_at = NOW() WHERE id = p_transfer_id;

  INSERT INTO public.audit_logs (company_id, entity_type, entity_id, action, user_id, new_data)
  VALUES (v_company_id, 'bank_transfers', p_transfer_id, 'void', v_user_id, jsonb_build_object('void_reason', p_void_reason, 'reversal_je_id', v_rev_je_id));

  RETURN jsonb_build_object('transfer_id', p_transfer_id, 'reversal_je_id', v_rev_je_id);
END; $function$;


-- ---------------------------------------------------------------------------
-- 3. void_expense — mirror-copy carries account_code/date/links
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.void_expense(p_expense_id uuid, p_void_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id UUID := auth.uid(); v_company_id UUID; v_expense public.expenses%ROWTYPE;
  v_lock_date DATE; v_je RECORD; v_rev_je_id UUID; v_rev_je_num TEXT; v_total NUMERIC;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'void_expense: no company for user %', v_user_id; END IF;
  SELECT * INTO v_expense FROM public.expenses WHERE id = p_expense_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'void_expense: expense % not found', p_expense_id; END IF;
  IF v_expense.status <> 'confirmed' THEN RAISE EXCEPTION 'void_expense: only confirmed expenses can be voided (status=%)', v_expense.status; END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_expense.date <= v_lock_date THEN RAISE EXCEPTION 'void_expense: posting date % is in a locked period', v_expense.date; END IF;

  SELECT * INTO v_je FROM public.journal_entries
   WHERE source_type = 'expense' AND source_id = p_expense_id AND company_id = v_company_id AND reversed_by_id IS NULL
   ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'void_expense: no live JE found for expense %', p_expense_id; END IF;

  SELECT COALESCE(SUM(debit), 0) INTO v_total FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1000, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'JE-' || current_value::TEXT INTO v_rev_je_num FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'JE';

  INSERT INTO public.journal_entries
    (company_id, entry_number, date, source_type, source_id, description, total_debit, total_credit, created_by, reversal_of_id)
  VALUES
    (v_company_id, v_rev_je_num, CURRENT_DATE, 'expense', p_expense_id,
     'VOID: ' || COALESCE(p_void_reason, 'Expense Void'), v_total, v_total, v_user_id, v_je.id)
  RETURNING id INTO v_rev_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id, reversal_of_id)
  SELECT v_company_id, v_rev_je_id, account_id, account_code, CURRENT_DATE, credit, debit, 'VOID: ' || description, contact_id, related_doc_type, related_doc_id, id
    FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  UPDATE public.journal_entries SET reversed_by_id = v_rev_je_id WHERE id = v_je.id;
  UPDATE public.expenses SET status = 'void', void_reason = p_void_reason, voided_at = NOW(), voided_by = v_user_id, updated_at = NOW() WHERE id = p_expense_id;

  INSERT INTO public.audit_logs (company_id, entity_type, entity_id, action, user_id, new_data)
  VALUES (v_company_id, 'expenses', p_expense_id, 'void', v_user_id, jsonb_build_object('void_reason', p_void_reason, 'reversal_je_id', v_rev_je_id));

  RETURN jsonb_build_object('expense_id', p_expense_id, 'reversal_je_id', v_rev_je_id);
END; $function$;


-- ---------------------------------------------------------------------------
-- 4. reopen_expense — mirror-copy carries account_code/date/links
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reopen_expense(p_expense_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id, reversal_of_id)
  SELECT v_company_id, v_rev_je_id, account_id, account_code, CURRENT_DATE, credit, debit, 'REOPEN: ' || description, contact_id, related_doc_type, related_doc_id, id
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
$function$;


-- ---------------------------------------------------------------------------
-- 5. create_pdc — resolve account codes, date GL at issue date
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_pdc(p_type text, p_contact_id uuid, p_cheque_number text, p_amount numeric, p_issue_date date, p_due_date date, p_bank_name text DEFAULT NULL::text, p_currency text DEFAULT 'AED'::text, p_deposit_account_id uuid DEFAULT NULL::uuid, p_linked_payment_id uuid DEFAULT NULL::uuid, p_is_advance boolean DEFAULT false, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_company_id UUID; v_lock_date DATE; v_pdc_id UUID; v_pdc_number TEXT;
  v_je_id UUID; v_je_number TEXT; v_dr_account_id UUID; v_cr_account_id UUID;
  v_dr_code TEXT; v_cr_code TEXT;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'create_pdc: no company for user %', v_user_id; END IF;
  IF p_type NOT IN ('received','issued') THEN RAISE EXCEPTION 'create_pdc: type must be received or issued, got %', p_type; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'create_pdc: amount must be positive'; END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND p_issue_date <= v_lock_date THEN
    RAISE EXCEPTION 'create_pdc: issue_date % is on or before period lock %', p_issue_date, v_lock_date; END IF;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'PDC', 1000, 'PDC-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'PDC-' || current_value::TEXT INTO v_pdc_number FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'PDC';

  INSERT INTO public.pdc_cheques
    (company_id, pdc_number, type, contact_id, cheque_number, bank_name, amount, currency,
     issue_date, due_date, deposit_account_id, linked_payment_id, notes, status)
  VALUES
    (v_company_id, v_pdc_number, p_type, p_contact_id, p_cheque_number, p_bank_name, p_amount, p_currency,
     p_issue_date, p_due_date, p_deposit_account_id, p_linked_payment_id, p_notes, 'pending')
  RETURNING id INTO v_pdc_id;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1000, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'JE-' || current_value::TEXT INTO v_je_number FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'JE';

  IF p_type = 'received' THEN
    SELECT id INTO v_dr_account_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1250' LIMIT 1;
    IF v_dr_account_id IS NULL THEN RAISE EXCEPTION 'create_pdc: COA account 1250 (PDC Receivable) not found'; END IF;
    IF p_is_advance THEN
      SELECT id INTO v_cr_account_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2400' LIMIT 1;
    ELSE
      SELECT id INTO v_cr_account_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1200' LIMIT 1;
    END IF;
    IF v_cr_account_id IS NULL THEN RAISE EXCEPTION 'create_pdc: credit COA account not found (1200 or 2400)'; END IF;
  ELSE
    SELECT id INTO v_dr_account_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2100' LIMIT 1;
    IF v_dr_account_id IS NULL THEN RAISE EXCEPTION 'create_pdc: COA account 2100 (AP) not found'; END IF;
    SELECT id INTO v_cr_account_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2450' LIMIT 1;
    IF v_cr_account_id IS NULL THEN RAISE EXCEPTION 'create_pdc: COA account 2450 (PDC Payable) not found'; END IF;
  END IF;

  SELECT code INTO v_dr_code FROM public.chart_of_accounts WHERE id = v_dr_account_id;
  SELECT code INTO v_cr_code FROM public.chart_of_accounts WHERE id = v_cr_account_id;

  INSERT INTO public.journal_entries
    (company_id, entry_number, date, source_type, source_id, description, total_debit, total_credit, created_by)
  VALUES
    (v_company_id, v_je_number, p_issue_date, 'pdc_creation', v_pdc_id,
     p_type || ' PDC ' || v_pdc_number || ' — ' || p_cheque_number, p_amount, p_amount, v_user_id)
  RETURNING id INTO v_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_dr_account_id, v_dr_code, p_issue_date, p_amount, 0, 'PDC ' || v_pdc_number, p_contact_id, 'pdc', v_pdc_id),
    (v_company_id, v_je_id, v_cr_account_id, v_cr_code, p_issue_date, 0, p_amount, 'PDC ' || v_pdc_number, p_contact_id, 'pdc', v_pdc_id);

  INSERT INTO public.audit_logs (company_id, entity_type, entity_id, action, user_id, new_data)
  VALUES (v_company_id, 'pdc_cheques', v_pdc_id, 'create', v_user_id,
          jsonb_build_object('pdc_number', v_pdc_number, 'journal_entry_id', v_je_id));

  RETURN jsonb_build_object('pdc_id', v_pdc_id, 'pdc_number', v_pdc_number, 'journal_entry_id', v_je_id);
END; $function$;


-- ---------------------------------------------------------------------------
-- 6. clear_pdc — resolve account codes, date GL at JE date (due date)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clear_pdc(p_pdc_id uuid, p_deposit_account_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id UUID := auth.uid(); v_company_id UUID; v_pdc public.pdc_cheques%ROWTYPE;
  v_lock_date DATE; v_bank_coa_id UUID; v_pdc_acc_id UUID; v_je_id UUID; v_je_number TEXT; v_dep_acc_id UUID;
  v_bank_code TEXT; v_pdc_code TEXT; v_gl_date DATE;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'clear_pdc: no company for user %', v_user_id; END IF;
  SELECT * INTO v_pdc FROM public.pdc_cheques WHERE id = p_pdc_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'clear_pdc: PDC % not found', p_pdc_id; END IF;
  IF v_pdc.type = 'received' AND v_pdc.status NOT IN ('pending','deposited') THEN
    RAISE EXCEPTION 'clear_pdc: received PDC must be pending/deposited to clear (status=%)', v_pdc.status; END IF;
  IF v_pdc.type = 'issued' AND v_pdc.status <> 'pending' THEN
    RAISE EXCEPTION 'clear_pdc: issued PDC must be pending to clear (status=%)', v_pdc.status; END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_pdc.due_date <= v_lock_date THEN
    RAISE EXCEPTION 'clear_pdc: due_date % is in a locked period', v_pdc.due_date; END IF;

  v_dep_acc_id := COALESCE(p_deposit_account_id, v_pdc.deposit_account_id);
  IF v_dep_acc_id IS NULL THEN RAISE EXCEPTION 'clear_pdc: no deposit_account_id provided or stored on PDC'; END IF;
  SELECT coa_account_id INTO v_bank_coa_id FROM public.bank_accounts WHERE id = v_dep_acc_id AND company_id = v_company_id;
  IF v_bank_coa_id IS NULL THEN RAISE EXCEPTION 'clear_pdc: deposit account has no COA link'; END IF;

  IF v_pdc.type = 'received' THEN
    SELECT id INTO v_pdc_acc_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1250' LIMIT 1;
    IF v_pdc_acc_id IS NULL THEN RAISE EXCEPTION 'clear_pdc: COA 1250 not found'; END IF;
  ELSE
    SELECT id INTO v_pdc_acc_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2450' LIMIT 1;
    IF v_pdc_acc_id IS NULL THEN RAISE EXCEPTION 'clear_pdc: COA 2450 not found'; END IF;
  END IF;

  SELECT code INTO v_bank_code FROM public.chart_of_accounts WHERE id = v_bank_coa_id;
  IF v_bank_code IS NULL THEN RAISE EXCEPTION 'clear_pdc: COA account % has no code', v_bank_coa_id; END IF;
  SELECT code INTO v_pdc_code FROM public.chart_of_accounts WHERE id = v_pdc_acc_id;

  v_gl_date := COALESCE(v_pdc.due_date, CURRENT_DATE);

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1000, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'JE-' || current_value::TEXT INTO v_je_number FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'JE';

  INSERT INTO public.journal_entries
    (company_id, entry_number, date, source_type, source_id, description, total_debit, total_credit, created_by)
  VALUES
    (v_company_id, v_je_number, v_gl_date, 'pdc_clear', p_pdc_id,
     'PDC Cleared: ' || v_pdc.pdc_number, v_pdc.amount, v_pdc.amount, v_user_id)
  RETURNING id INTO v_je_id;

  IF v_pdc.type = 'received' THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_bank_coa_id, v_bank_code, v_gl_date, v_pdc.amount, 0, 'PDC Cleared: ' || v_pdc.pdc_number, v_pdc.contact_id, 'pdc', p_pdc_id),
      (v_company_id, v_je_id, v_pdc_acc_id, v_pdc_code, v_gl_date, 0, v_pdc.amount, 'PDC Cleared: ' || v_pdc.pdc_number, v_pdc.contact_id, 'pdc', p_pdc_id);
  ELSE
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_pdc_acc_id, v_pdc_code, v_gl_date, v_pdc.amount, 0, 'PDC Paid: ' || v_pdc.pdc_number, v_pdc.contact_id, 'pdc', p_pdc_id),
      (v_company_id, v_je_id, v_bank_coa_id, v_bank_code, v_gl_date, 0, v_pdc.amount, 'PDC Paid: ' || v_pdc.pdc_number, v_pdc.contact_id, 'pdc', p_pdc_id);
  END IF;

  UPDATE public.pdc_cheques SET status = 'cleared', deposit_account_id = v_dep_acc_id, updated_at = NOW() WHERE id = p_pdc_id;

  INSERT INTO public.audit_logs (company_id, entity_type, entity_id, action, user_id, new_data)
  VALUES (v_company_id, 'pdc_cheques', p_pdc_id, 'update', v_user_id, jsonb_build_object('status','cleared','journal_entry_id', v_je_id));

  RETURN jsonb_build_object('pdc_id', p_pdc_id, 'status', 'cleared', 'journal_entry_id', v_je_id);
END; $function$;


-- ---------------------------------------------------------------------------
-- 7. bounce_pdc — resolve account codes, date GL at bounce date (today)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bounce_pdc(p_pdc_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id UUID := auth.uid(); v_company_id UUID; v_pdc public.pdc_cheques%ROWTYPE;
  v_lock_date DATE; v_bounced_id UUID; v_pdc_recv_id UUID; v_je_id UUID; v_je_number TEXT;
  v_bounced_code TEXT; v_recv_code TEXT;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'bounce_pdc: no company for user %', v_user_id; END IF;
  SELECT * INTO v_pdc FROM public.pdc_cheques WHERE id = p_pdc_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'bounce_pdc: PDC % not found', p_pdc_id; END IF;
  IF v_pdc.type <> 'received' THEN RAISE EXCEPTION 'bounce_pdc: only received PDCs can bounce'; END IF;
  IF v_pdc.status NOT IN ('pending','deposited') THEN RAISE EXCEPTION 'bounce_pdc: PDC must be pending/deposited to bounce (status=%)', v_pdc.status; END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND CURRENT_DATE <= v_lock_date THEN RAISE EXCEPTION 'bounce_pdc: posting date is in a locked period'; END IF;

  SELECT id INTO v_bounced_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1260' LIMIT 1;
  IF v_bounced_id IS NULL THEN RAISE EXCEPTION 'bounce_pdc: COA 1260 (Bounced Cheques) not found'; END IF;
  SELECT id INTO v_pdc_recv_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1250' LIMIT 1;
  IF v_pdc_recv_id IS NULL THEN RAISE EXCEPTION 'bounce_pdc: COA 1250 not found'; END IF;

  SELECT code INTO v_bounced_code FROM public.chart_of_accounts WHERE id = v_bounced_id;
  SELECT code INTO v_recv_code FROM public.chart_of_accounts WHERE id = v_pdc_recv_id;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1000, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'JE-' || current_value::TEXT INTO v_je_number FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'JE';

  INSERT INTO public.journal_entries
    (company_id, entry_number, date, source_type, source_id, description, total_debit, total_credit, created_by)
  VALUES
    (v_company_id, v_je_number, CURRENT_DATE, 'pdc_bounce', p_pdc_id,
     'PDC Bounced: ' || v_pdc.pdc_number, v_pdc.amount, v_pdc.amount, v_user_id)
  RETURNING id INTO v_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_bounced_id, v_bounced_code, CURRENT_DATE, v_pdc.amount, 0, 'Bounced PDC: ' || v_pdc.pdc_number, v_pdc.contact_id, 'pdc', p_pdc_id),
    (v_company_id, v_je_id, v_pdc_recv_id, v_recv_code, CURRENT_DATE, 0, v_pdc.amount, 'Bounced PDC: ' || v_pdc.pdc_number, v_pdc.contact_id, 'pdc', p_pdc_id);

  UPDATE public.pdc_cheques SET status = 'bounced', updated_at = NOW() WHERE id = p_pdc_id;

  INSERT INTO public.audit_logs (company_id, entity_type, entity_id, action, user_id, new_data)
  VALUES (v_company_id, 'pdc_cheques', p_pdc_id, 'update', v_user_id, jsonb_build_object('status','bounced','journal_entry_id', v_je_id));

  RETURN jsonb_build_object('pdc_id', p_pdc_id, 'status', 'bounced', 'journal_entry_id', v_je_id);
END; $function$;


-- ---------------------------------------------------------------------------
-- 8. cancel_pdc — mirror-copy carries account_code/date/links
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_pdc(p_pdc_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id UUID := auth.uid(); v_company_id UUID; v_pdc public.pdc_cheques%ROWTYPE;
  v_lock_date DATE; v_je RECORD; v_rev_je_id UUID; v_rev_je_num TEXT; v_total NUMERIC;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'cancel_pdc: no company for user %', v_user_id; END IF;
  SELECT * INTO v_pdc FROM public.pdc_cheques WHERE id = p_pdc_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'cancel_pdc: PDC % not found', p_pdc_id; END IF;
  IF v_pdc.status NOT IN ('pending','deposited') THEN RAISE EXCEPTION 'cancel_pdc: cannot cancel PDC in status %', v_pdc.status; END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_pdc.issue_date <= v_lock_date THEN RAISE EXCEPTION 'cancel_pdc: issue_date % is in a locked period', v_pdc.issue_date; END IF;

  SELECT * INTO v_je FROM public.journal_entries
   WHERE source_type = 'pdc_creation' AND source_id = p_pdc_id AND company_id = v_company_id AND reversed_by_id IS NULL
   ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'cancel_pdc: no live creation JE found for PDC %', p_pdc_id; END IF;

  SELECT COALESCE(SUM(debit), 0) INTO v_total FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1000, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'JE-' || current_value::TEXT INTO v_rev_je_num FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'JE';

  INSERT INTO public.journal_entries
    (company_id, entry_number, date, source_type, source_id, description, total_debit, total_credit, created_by, reversal_of_id)
  VALUES
    (v_company_id, v_rev_je_num, CURRENT_DATE, 'pdc_creation', p_pdc_id,
     'CANCELLED PDC: ' || v_pdc.pdc_number, v_total, v_total, v_user_id, v_je.id)
  RETURNING id INTO v_rev_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id, reversal_of_id)
  SELECT v_company_id, v_rev_je_id, account_id, account_code, CURRENT_DATE, credit, debit, 'CANCEL: ' || description, contact_id, related_doc_type, related_doc_id, id
    FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  UPDATE public.journal_entries SET reversed_by_id = v_rev_je_id WHERE id = v_je.id;
  UPDATE public.pdc_cheques SET status = 'cancelled', updated_at = NOW() WHERE id = p_pdc_id;

  INSERT INTO public.audit_logs (company_id, entity_type, entity_id, action, user_id, new_data)
  VALUES (v_company_id, 'pdc_cheques', p_pdc_id, 'void', v_user_id, jsonb_build_object('reversal_je_id', v_rev_je_id));

  RETURN jsonb_build_object('pdc_id', p_pdc_id, 'status', 'cancelled', 'reversal_je_id', v_rev_je_id);
END; $function$;


NOTIFY pgrst, 'reload schema';
