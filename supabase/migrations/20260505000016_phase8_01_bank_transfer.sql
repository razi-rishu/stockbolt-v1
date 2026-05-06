-- Phase 8 — Banking: confirm_bank_transfer + void_bank_transfer
-- D1: Bank Transfer — Dr to_account COA, Cr from_account COA (both bank/cash accounts)

-- ── confirm_bank_transfer ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.confirm_bank_transfer(p_transfer_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id      UUID := auth.uid();
  v_company_id   UUID;
  v_transfer     public.bank_transfers%ROWTYPE;
  v_lock_date    DATE;
  v_from_coa_id  UUID;
  v_to_coa_id    UUID;
  v_je_id        UUID;
  v_je_number    TEXT;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_bank_transfer: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_transfer
    FROM public.bank_transfers
   WHERE id = p_transfer_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_bank_transfer: transfer % not found', p_transfer_id;
  END IF;
  IF v_transfer.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_bank_transfer: transfer already % — cannot confirm', v_transfer.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_transfer.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_bank_transfer: date % is on or before period lock %', v_transfer.date, v_lock_date;
  END IF;

  -- Resolve COA account IDs from bank_accounts
  SELECT coa_account_id INTO v_from_coa_id
    FROM public.bank_accounts WHERE id = v_transfer.from_account_id AND company_id = v_company_id;
  IF v_from_coa_id IS NULL THEN
    RAISE EXCEPTION 'confirm_bank_transfer: from_account % has no COA link', v_transfer.from_account_id;
  END IF;

  SELECT coa_account_id INTO v_to_coa_id
    FROM public.bank_accounts WHERE id = v_transfer.to_account_id AND company_id = v_company_id;
  IF v_to_coa_id IS NULL THEN
    RAISE EXCEPTION 'confirm_bank_transfer: to_account % has no COA link', v_transfer.to_account_id;
  END IF;

  -- JE number
  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1000, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
  RETURNING 'JE-' || current_value::TEXT INTO v_je_number;

  SELECT 'JE-' || current_value::TEXT INTO v_je_number
    FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'JE';

  -- Post journal entry: D1 — Dr to_account, Cr from_account
  INSERT INTO public.journal_entries
    (company_id, je_number, date, source_type, source_id, description, posted_by, is_reversed)
  VALUES
    (v_company_id, v_je_number, v_transfer.date,
     'bank_transfer', p_transfer_id,
     COALESCE(v_transfer.reference, 'Bank Transfer ' || v_transfer.transfer_number),
     v_user_id, FALSE)
  RETURNING id INTO v_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, debit, credit, description)
  VALUES
    (v_company_id, v_je_id, v_to_coa_id,   v_transfer.amount, 0,                 'Transfer in'),
    (v_company_id, v_je_id, v_from_coa_id, 0,                  v_transfer.amount, 'Transfer out');

  -- Confirm
  UPDATE public.bank_transfers
     SET status = 'confirmed', updated_at = NOW()
   WHERE id = p_transfer_id;

  -- Audit
  INSERT INTO public.audit_logs (company_id, table_name, record_id, action, performed_by, new_data)
  VALUES (v_company_id, 'bank_transfers', p_transfer_id, 'confirm', v_user_id,
          jsonb_build_object('journal_entry_id', v_je_id));

  RETURN jsonb_build_object('transfer_id', p_transfer_id, 'journal_entry_id', v_je_id);
END;
$$;

-- ── void_bank_transfer ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.void_bank_transfer(
  p_transfer_id UUID,
  p_void_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id      UUID := auth.uid();
  v_company_id   UUID;
  v_transfer     public.bank_transfers%ROWTYPE;
  v_lock_date    DATE;
  v_je           RECORD;
  v_rev_je_id    UUID;
  v_rev_je_num   TEXT;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'void_bank_transfer: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_transfer
    FROM public.bank_transfers
   WHERE id = p_transfer_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'void_bank_transfer: transfer % not found', p_transfer_id;
  END IF;
  IF v_transfer.status <> 'confirmed' THEN
    RAISE EXCEPTION 'void_bank_transfer: only confirmed transfers can be voided (status=%)', v_transfer.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_transfer.date <= v_lock_date THEN
    RAISE EXCEPTION 'void_bank_transfer: posting date % is in a locked period', v_transfer.date;
  END IF;

  -- Find original JE
  SELECT * INTO v_je
    FROM public.journal_entries
   WHERE source_type = 'bank_transfer' AND source_id = p_transfer_id
     AND company_id = v_company_id AND is_reversed = FALSE
   ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'void_bank_transfer: no live JE found for transfer %', p_transfer_id;
  END IF;

  -- Reversal JE number
  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1000, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'JE-' || current_value::TEXT INTO v_rev_je_num
    FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'JE';

  -- Post reversal JE
  INSERT INTO public.journal_entries
    (company_id, je_number, date, source_type, source_id, description, posted_by, is_reversed, reversal_of_id)
  VALUES
    (v_company_id, v_rev_je_num, CURRENT_DATE,
     'bank_transfer', p_transfer_id,
     'VOID: ' || COALESCE(p_void_reason, 'Bank Transfer Void'),
     v_user_id, TRUE, v_je.id)
  RETURNING id INTO v_rev_je_id;

  -- Mirror GL rows
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, debit, credit, description)
  SELECT v_company_id, v_rev_je_id, account_id, credit, debit, 'VOID: ' || description
    FROM public.general_ledger
   WHERE journal_entry_id = v_je.id;

  -- Mark original JE as reversed
  UPDATE public.journal_entries SET is_reversed = TRUE WHERE id = v_je.id;

  -- Void transfer
  UPDATE public.bank_transfers
     SET status = 'void', updated_at = NOW()
   WHERE id = p_transfer_id;

  -- Audit
  INSERT INTO public.audit_logs (company_id, table_name, record_id, action, performed_by, new_data)
  VALUES (v_company_id, 'bank_transfers', p_transfer_id, 'void', v_user_id,
          jsonb_build_object('void_reason', p_void_reason, 'reversal_je_id', v_rev_je_id));

  RETURN jsonb_build_object('transfer_id', p_transfer_id, 'reversal_je_id', v_rev_je_id);
END;
$$;
