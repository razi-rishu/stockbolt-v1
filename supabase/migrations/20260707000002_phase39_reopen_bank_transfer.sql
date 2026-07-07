-- =============================================================================
-- Phase 39 — Edit a CONFIRMED bank transfer (reverse + reopen as draft)
-- =============================================================================
-- Bank transfers only offered Void once confirmed. Same standard as every
-- other document (Phase 34): "Edit" reverses the live journal entry and
-- flips the transfer back to draft so it can be changed and confirmed again.
-- Mirror of the phase37 void_bank_transfer (GL rows carry account_code,
-- date, drill-down links and reversal_of_id), except the status lands on
-- 'draft' instead of 'void'.
-- Apply AFTER 20260706000002_phase37. Additive only.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.reopen_bank_transfer(p_transfer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id UUID := auth.uid(); v_company_id UUID; v_transfer public.bank_transfers%ROWTYPE;
  v_lock_date DATE; v_je RECORD; v_rev_je_id UUID; v_rev_je_num TEXT; v_total NUMERIC;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'reopen_bank_transfer: no company for user %', v_user_id; END IF;
  SELECT * INTO v_transfer FROM public.bank_transfers WHERE id = p_transfer_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'reopen_bank_transfer: transfer % not found', p_transfer_id; END IF;
  IF v_transfer.status <> 'confirmed' THEN RAISE EXCEPTION 'reopen_bank_transfer: only confirmed transfers can be reopened (status=%)', v_transfer.status; END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_transfer.date <= v_lock_date THEN RAISE EXCEPTION 'reopen_bank_transfer: posting date % is in a locked period', v_transfer.date; END IF;

  SELECT * INTO v_je FROM public.journal_entries
   WHERE source_type = 'bank_transfer' AND source_id = p_transfer_id AND company_id = v_company_id AND reversed_by_id IS NULL
   ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'reopen_bank_transfer: no live JE found for transfer %', p_transfer_id; END IF;

  SELECT COALESCE(SUM(debit), 0) INTO v_total FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1000, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'JE-' || current_value::TEXT INTO v_rev_je_num FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'JE';

  INSERT INTO public.journal_entries
    (company_id, entry_number, date, source_type, source_id, description, total_debit, total_credit, created_by, reversal_of_id)
  VALUES
    (v_company_id, v_rev_je_num, CURRENT_DATE, 'bank_transfer', p_transfer_id,
     'REOPEN: Bank Transfer ' || v_transfer.transfer_number, v_total, v_total, v_user_id, v_je.id)
  RETURNING id INTO v_rev_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id, reversal_of_id)
  SELECT v_company_id, v_rev_je_id, account_id, account_code, CURRENT_DATE, credit, debit, 'REOPEN: ' || description, contact_id, related_doc_type, related_doc_id, id
    FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  UPDATE public.journal_entries SET reversed_by_id = v_rev_je_id WHERE id = v_je.id;
  UPDATE public.bank_transfers SET status = 'draft', updated_at = NOW() WHERE id = p_transfer_id;

  INSERT INTO public.audit_logs (company_id, entity_type, entity_id, action, user_id, new_data)
  VALUES (v_company_id, 'bank_transfers', p_transfer_id, 'update', v_user_id,
          jsonb_build_object('reopened', true, 'reversal_je_id', v_rev_je_id));

  RETURN jsonb_build_object('transfer_id', p_transfer_id, 'reversal_je_id', v_rev_je_id);
END; $function$;

NOTIFY pgrst, 'reload schema';
