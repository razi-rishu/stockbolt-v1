-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 19: Post-Dated Cheque (PDC) on the payment screen
-- ─────────────────────────────────────────────────────────────────────────
-- Lets a customer receipt / vendor payment be marked as a PDC from the payment
-- editor. Instead of hitting the bank, it routes to the PDC holding account
-- and creates a linked pdc_cheques record so it flows through the existing PDC
-- lifecycle (Banking → PDC Received/Issued: Deposit / Clear-to-bank / Bounce /
-- Cancel — all already built).
--
-- These RPCs mirror confirm_payment / confirm_vendor_payment EXACTLY, with two
-- differences:
--   1. the cash leg posts to 1250 PDC Receivable (received) / 2450 PDC Payable
--      (issued) instead of a bank account;
--   2. a pdc_cheques row is created (status 'pending', linked_payment_id), and
--      the JE is anchored source_type='pdc_creation', source_id=pdc_id so the
--      existing clear_pdc / cancel_pdc / bounce_pdc operate on it unchanged.
--
-- Per-invoice settlement is preserved: the draft payment already carries its
-- payment_allocations (so invoices show paid), and the AR/AP credit is posted
-- per the allocated total, with the remainder to advances — same split as the
-- normal confirm. The payment row is kept purely as the allocation anchor; it
-- has NO bank line, so it is never bank-reconcilable until the cheque clears.
--
-- Additive. confirm_payment, confirm_vendor_payment, create_pdc, clear_pdc and
-- every existing payment / PDC are untouched. Idempotent (CREATE OR REPLACE).
-- ─────────────────────────────────────────────────────────────────────────

-- ══ confirm_pdc_payment — customer / inbound (received cheque) ════════════
CREATE OR REPLACE FUNCTION public.confirm_pdc_payment(
  p_payment_id    UUID,
  p_cheque_number TEXT,
  p_bank_name     TEXT,
  p_due_date      DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_company_id  UUID;
  v_pmt         public.payments%ROWTYPE;
  v_lock_date   DATE;
  v_pdc_id      UUID;
  v_pdc_number  TEXT;
  v_je_id       UUID;
  v_entry       TEXT;
  v_seq         BIGINT;
  v_pdc_acc_id  UUID;   -- 1250 PDC Receivable
  v_ar_id       UUID;   -- 1200 AR
  v_adv_id      UUID;   -- 2400 Customer Advances
  v_allocated   NUMERIC(15,2) := 0;
  v_unallocated NUMERIC(15,2);
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'confirm_pdc_payment: no company for user %', v_user_id; END IF;

  SELECT * INTO v_pmt FROM public.payments WHERE id = p_payment_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'confirm_pdc_payment: payment % not found', p_payment_id; END IF;
  IF v_pmt.status <> 'draft' THEN RAISE EXCEPTION 'confirm_pdc_payment: payment % not in draft (status=%)', p_payment_id, v_pmt.status; END IF;
  IF v_pmt.type <> 'inbound' THEN RAISE EXCEPTION 'confirm_pdc_payment: only inbound receipts handled here (type=%)', v_pmt.type; END IF;
  IF p_cheque_number IS NULL OR length(trim(p_cheque_number)) = 0 THEN RAISE EXCEPTION 'confirm_pdc_payment: cheque number is required'; END IF;
  IF p_due_date IS NULL THEN RAISE EXCEPTION 'confirm_pdc_payment: cheque due date is required'; END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_pmt.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_pdc_payment: date % on or before period lock %', v_pmt.date, v_lock_date; END IF;

  SELECT id INTO v_pdc_acc_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1250' AND is_active LIMIT 1;
  IF v_pdc_acc_id IS NULL THEN RAISE EXCEPTION 'confirm_pdc_payment: COA 1250 (PDC Receivable) not found'; END IF;
  SELECT id INTO v_ar_id  FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1200' AND is_active LIMIT 1;
  SELECT id INTO v_adv_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2400' AND is_active LIMIT 1;

  IF v_pmt.classification = 'against_invoice' THEN
    SELECT COALESCE(SUM(amount_applied), 0) INTO v_allocated
    FROM public.payment_allocations
    WHERE payment_id = p_payment_id AND company_id = v_company_id AND doc_type = 'invoice';
  END IF;
  v_unallocated := v_pmt.amount - v_allocated;

  -- PDC sequence + record
  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'PDC', 1000, 'PDC-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'PDC-' || current_value::TEXT INTO v_pdc_number FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'PDC';

  INSERT INTO public.pdc_cheques
    (company_id, pdc_number, type, contact_id, cheque_number, bank_name, amount, currency,
     issue_date, due_date, deposit_account_id, linked_payment_id, notes, status)
  VALUES
    (v_company_id, v_pdc_number, 'received', v_pmt.contact_id, p_cheque_number, p_bank_name, v_pmt.amount, v_pmt.currency,
     v_pmt.date, p_due_date, v_pmt.bank_account_id, p_payment_id,
     'PDC for receipt ' || v_pmt.payment_number, 'pending')
  RETURNING id INTO v_pdc_id;

  -- JE — anchored to the PDC so clear_pdc / cancel_pdc work unchanged.
  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_seq;
  v_entry := 'JE-' || v_seq::TEXT;

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, currency, exchange_rate,
    total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_entry, v_pmt.date,
    'PDC ' || v_pdc_number || ' — receipt ' || v_pmt.payment_number || ' (chq ' || p_cheque_number || ')',
    'pdc_creation', v_pdc_id, v_pmt.currency, v_pmt.exchange_rate,
    v_pmt.amount, v_pmt.amount, v_user_id
  ) RETURNING id INTO v_je_id;

  -- DR 1250 PDC Receivable (full amount)
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_pdc_acc_id, '1250', v_pmt.date, v_pmt.amount, 0,
     'PDC ' || v_pdc_number, v_pmt.contact_id, 'pdc', v_pdc_id);

  -- CR 1200 AR (allocated portion)
  IF v_allocated > 0 THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_ar_id, '1200', v_pmt.date, 0, v_allocated,
       'PDC ' || v_pdc_number || ' — settle invoices', v_pmt.contact_id, 'payment', p_payment_id);
  END IF;
  -- CR 2400 Customer Advances (unallocated portion)
  IF v_unallocated > 0 THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_adv_id, '2400', v_pmt.date, 0, v_unallocated,
       'PDC ' || v_pdc_number || ' (advance)', v_pmt.contact_id, 'payment', p_payment_id);
  END IF;

  UPDATE public.payments SET status = 'confirmed', updated_at = NOW() WHERE id = p_payment_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'payment', p_payment_id,
      jsonb_build_object('payment_number', v_pmt.payment_number, 'pdc', v_pdc_number, 'je', v_entry));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'payment_id', p_payment_id, 'payment_number', v_pmt.payment_number,
    'pdc_id', v_pdc_id, 'pdc_number', v_pdc_number, 'je_id', v_je_id, 'entry_number', v_entry
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_pdc_payment(UUID, TEXT, TEXT, DATE) TO authenticated;


-- ══ confirm_pdc_vendor_payment — vendor / outbound (issued cheque) ════════
CREATE OR REPLACE FUNCTION public.confirm_pdc_vendor_payment(
  p_payment_id    UUID,
  p_cheque_number TEXT,
  p_bank_name     TEXT,
  p_due_date      DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_company_id  UUID;
  v_pmt         public.payments%ROWTYPE;
  v_lock_date   DATE;
  v_pdc_id      UUID;
  v_pdc_number  TEXT;
  v_je_id       UUID;
  v_entry       TEXT;
  v_seq         BIGINT;
  v_pdc_acc_id  UUID;   -- 2450 PDC Payable
  v_ap_id       UUID;   -- 2100 AP
  v_adv_id      UUID;   -- 1400 Vendor Advances
  v_allocated   NUMERIC(15,2) := 0;
  v_unallocated NUMERIC(15,2);
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'confirm_pdc_vendor_payment: no company for user %', v_user_id; END IF;

  SELECT * INTO v_pmt FROM public.payments WHERE id = p_payment_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'confirm_pdc_vendor_payment: payment % not found', p_payment_id; END IF;
  IF v_pmt.status <> 'draft' THEN RAISE EXCEPTION 'confirm_pdc_vendor_payment: payment % not in draft (status=%)', p_payment_id, v_pmt.status; END IF;
  IF v_pmt.type <> 'outbound' THEN RAISE EXCEPTION 'confirm_pdc_vendor_payment: only outbound payments handled here (type=%)', v_pmt.type; END IF;
  IF p_cheque_number IS NULL OR length(trim(p_cheque_number)) = 0 THEN RAISE EXCEPTION 'confirm_pdc_vendor_payment: cheque number is required'; END IF;
  IF p_due_date IS NULL THEN RAISE EXCEPTION 'confirm_pdc_vendor_payment: cheque due date is required'; END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_pmt.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_pdc_vendor_payment: date % on or before period lock %', v_pmt.date, v_lock_date; END IF;

  SELECT id INTO v_pdc_acc_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2450' AND is_active LIMIT 1;
  IF v_pdc_acc_id IS NULL THEN RAISE EXCEPTION 'confirm_pdc_vendor_payment: COA 2450 (PDC Payable) not found'; END IF;
  SELECT id INTO v_ap_id  FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2100' AND is_active LIMIT 1;
  SELECT id INTO v_adv_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1400' AND is_active LIMIT 1;

  IF v_pmt.classification = 'against_invoice' THEN
    SELECT COALESCE(SUM(amount_applied), 0) INTO v_allocated
    FROM public.payment_allocations
    WHERE payment_id = p_payment_id AND company_id = v_company_id AND doc_type = 'vendor_bill';
  END IF;
  v_unallocated := v_pmt.amount - v_allocated;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'PDC', 1000, 'PDC-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'PDC-' || current_value::TEXT INTO v_pdc_number FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'PDC';

  INSERT INTO public.pdc_cheques
    (company_id, pdc_number, type, contact_id, cheque_number, bank_name, amount, currency,
     issue_date, due_date, deposit_account_id, linked_payment_id, notes, status)
  VALUES
    (v_company_id, v_pdc_number, 'issued', v_pmt.contact_id, p_cheque_number, p_bank_name, v_pmt.amount, v_pmt.currency,
     v_pmt.date, p_due_date, v_pmt.bank_account_id, p_payment_id,
     'PDC for payment ' || v_pmt.payment_number, 'pending')
  RETURNING id INTO v_pdc_id;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_seq;
  v_entry := 'JE-' || v_seq::TEXT;

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, currency, exchange_rate,
    total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_entry, v_pmt.date,
    'PDC ' || v_pdc_number || ' — payment ' || v_pmt.payment_number || ' (chq ' || p_cheque_number || ')',
    'pdc_creation', v_pdc_id, v_pmt.currency, v_pmt.exchange_rate,
    v_pmt.amount, v_pmt.amount, v_user_id
  ) RETURNING id INTO v_je_id;

  -- DR 2100 AP (allocated portion)
  IF v_allocated > 0 THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_ap_id, '2100', v_pmt.date, v_allocated, 0,
       'PDC ' || v_pdc_number || ' — settle bills', v_pmt.contact_id, 'payment', p_payment_id);
  END IF;
  -- DR 1400 Vendor Advances (unallocated portion)
  IF v_unallocated > 0 THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_adv_id, '1400', v_pmt.date, v_unallocated, 0,
       'PDC ' || v_pdc_number || ' (advance)', v_pmt.contact_id, 'payment', p_payment_id);
  END IF;

  -- CR 2450 PDC Payable (full amount)
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_pdc_acc_id, '2450', v_pmt.date, 0, v_pmt.amount,
     'PDC ' || v_pdc_number, v_pmt.contact_id, 'pdc', v_pdc_id);

  UPDATE public.payments SET status = 'confirmed', updated_at = NOW() WHERE id = p_payment_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'vendor_payment', p_payment_id,
      jsonb_build_object('payment_number', v_pmt.payment_number, 'pdc', v_pdc_number, 'je', v_entry));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'payment_id', p_payment_id, 'payment_number', v_pmt.payment_number,
    'pdc_id', v_pdc_id, 'pdc_number', v_pdc_number, 'je_id', v_je_id, 'entry_number', v_entry
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_pdc_vendor_payment(UUID, TEXT, TEXT, DATE) TO authenticated;
