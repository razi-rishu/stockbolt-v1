-- Phase 5 — confirm_vendor_payment + apply_vendor_advance RPCs
--
-- confirm_vendor_payment:
--   classification='against_invoice' (B5): DR 2100 AP (allocated) + DR 1400 (unallocated), CR bank
--   classification='advance'|'on_account' (B6): DR 1400 Vendor Advances, CR bank
--   Returns: { payment_id, payment_number, je_id, entry_number }
--
-- apply_vendor_advance (B7):
--   DR 2100 AP, CR 1400 Vendor Advances
--   Returns: { je_id, entry_number, payment_id, bill_id, amount }

CREATE OR REPLACE FUNCTION public.confirm_vendor_payment(p_payment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_company_id    UUID;
  v_pmt           public.payments%ROWTYPE;
  v_lock_date     DATE;
  v_je_id         UUID;
  v_entry         TEXT;
  v_seq           BIGINT;
  v_bank_coa_id   UUID;
  v_bank_code     TEXT;
  v_ap_id         UUID;   -- 2100 AP
  v_adv_id        UUID;   -- 1400 Vendor Advances
  v_allocated     NUMERIC(15,2) := 0;
  v_unallocated   NUMERIC(15,2);
  v_source_type   TEXT;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_vendor_payment: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_pmt FROM public.payments WHERE id = p_payment_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_vendor_payment: payment % not found', p_payment_id;
  END IF;
  IF v_pmt.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_vendor_payment: payment % not in draft (status=%)', p_payment_id, v_pmt.status;
  END IF;
  IF v_pmt.type <> 'outbound' THEN
    RAISE EXCEPTION 'confirm_vendor_payment: only outbound payments handled here (type=%)', v_pmt.type;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_pmt.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_vendor_payment: date % on or before period lock %', v_pmt.date, v_lock_date;
  END IF;

  SELECT ba.coa_account_id, coa.code
  INTO v_bank_coa_id, v_bank_code
  FROM public.bank_accounts ba
  JOIN public.chart_of_accounts coa ON coa.id = ba.coa_account_id
  WHERE ba.id = v_pmt.bank_account_id AND ba.company_id = v_company_id;

  IF v_bank_coa_id IS NULL THEN
    RAISE EXCEPTION 'confirm_vendor_payment: bank account % has no GL account', v_pmt.bank_account_id;
  END IF;

  SELECT id INTO v_ap_id  FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2100' AND is_active;
  SELECT id INTO v_adv_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1400' AND is_active;

  IF v_pmt.classification = 'against_invoice' THEN
    SELECT COALESCE(SUM(amount_applied), 0) INTO v_allocated
    FROM public.payment_allocations
    WHERE payment_id = p_payment_id AND company_id = v_company_id AND doc_type = 'vendor_bill';
    v_source_type := 'vendor_payment';
  ELSE
    v_source_type := 'vendor_advance';
  END IF;

  v_unallocated := v_pmt.amount - v_allocated;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_seq;
  v_entry := 'JE-' || v_seq::TEXT;

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, currency, exchange_rate,
    total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_entry, v_pmt.date,
    CASE v_pmt.classification
      WHEN 'against_invoice' THEN 'Vendor Payment ' || v_pmt.payment_number
      ELSE 'Vendor Advance ' || v_pmt.payment_number
    END,
    v_source_type, p_payment_id,
    v_pmt.currency, v_pmt.exchange_rate,
    v_pmt.amount, v_pmt.amount,
    v_user_id
  ) RETURNING id INTO v_je_id;

  IF v_pmt.classification = 'against_invoice' THEN
    -- DR 2100 AP (allocated portion)
    IF v_allocated > 0 THEN
      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date,
         debit, credit, description, contact_id, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_je_id, v_ap_id, '2100', v_pmt.date,
         v_allocated, 0,
         'Vendor Payment ' || v_pmt.payment_number,
         v_pmt.contact_id, 'payment', p_payment_id);
    END IF;

    -- DR 1400 Vendor Advances (overpayment)
    IF v_unallocated > 0 THEN
      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date,
         debit, credit, description, contact_id, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_je_id, v_adv_id, '1400', v_pmt.date,
         v_unallocated, 0,
         'Vendor Payment ' || v_pmt.payment_number || ' (unallocated)',
         v_pmt.contact_id, 'payment', p_payment_id);
    END IF;
  ELSE
    -- B6: full advance → DR 1400
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_adv_id, '1400', v_pmt.date,
       v_pmt.amount, 0,
       'Vendor Advance ' || v_pmt.payment_number,
       v_pmt.contact_id, 'payment', p_payment_id);
  END IF;

  -- CR bank
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date,
     debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_bank_coa_id, v_bank_code, v_pmt.date,
     0, v_pmt.amount,
     'Payment ' || v_pmt.payment_number,
     v_pmt.contact_id, 'payment', p_payment_id);

  UPDATE public.payments SET status = 'confirmed', updated_at = NOW() WHERE id = p_payment_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'vendor_payment', p_payment_id,
      jsonb_build_object('payment_number', v_pmt.payment_number, 'je', v_entry));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'payment_id',     p_payment_id,
    'payment_number', v_pmt.payment_number,
    'je_id',          v_je_id,
    'entry_number',   v_entry
  );
END;
$$;


-- ── apply_vendor_advance ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_vendor_advance(
  p_payment_id UUID,
  p_bill_id    UUID,
  p_amount     NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_company_id  UUID;
  v_pmt         public.payments%ROWTYPE;
  v_bill        public.vendor_bills%ROWTYPE;
  v_je_id       UUID;
  v_entry       TEXT;
  v_seq         BIGINT;
  v_ap_id       UUID;
  v_adv_id      UUID;
  v_used        NUMERIC(15,2);
  v_available   NUMERIC(15,2);
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'apply_vendor_advance: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_pmt FROM public.payments WHERE id = p_payment_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_vendor_advance: payment % not found', p_payment_id;
  END IF;
  IF v_pmt.type <> 'outbound' THEN
    RAISE EXCEPTION 'apply_vendor_advance: only outbound payments can be applied (type=%)', v_pmt.type;
  END IF;
  IF v_pmt.status <> 'confirmed' THEN
    RAISE EXCEPTION 'apply_vendor_advance: payment % must be confirmed first', p_payment_id;
  END IF;

  SELECT * INTO v_bill FROM public.vendor_bills WHERE id = p_bill_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_vendor_advance: bill % not found', p_bill_id;
  END IF;
  IF v_bill.status <> 'confirmed' THEN
    RAISE EXCEPTION 'apply_vendor_advance: bill % must be confirmed', p_bill_id;
  END IF;

  -- Check available balance
  SELECT COALESCE(SUM(amount_applied), 0) INTO v_used
  FROM public.payment_allocations
  WHERE payment_id = p_payment_id AND company_id = v_company_id;

  v_available := v_pmt.amount - v_used;
  IF p_amount > v_available THEN
    RAISE EXCEPTION 'apply_vendor_advance: amount % exceeds available balance %', p_amount, v_available;
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'apply_vendor_advance: amount must be positive';
  END IF;

  SELECT id INTO v_ap_id  FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2100' AND is_active;
  SELECT id INTO v_adv_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1400' AND is_active;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_seq;
  v_entry := 'JE-' || v_seq::TEXT;

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, currency, exchange_rate,
    total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_entry, v_bill.date,
    'Vendor Advance Applied – ' || v_bill.bill_number,
    'advance_application', p_bill_id,
    v_pmt.currency, 1.0,
    p_amount, p_amount,
    v_user_id
  ) RETURNING id INTO v_je_id;

  -- DR 2100 AP
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date,
     debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_ap_id, '2100', v_bill.date,
     p_amount, 0,
     'Vendor Advance Applied – ' || v_bill.bill_number,
     v_pmt.contact_id, 'vendor_bill', p_bill_id);

  -- CR 1400 Vendor Advances
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date,
     debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_adv_id, '1400', v_bill.date,
     0, p_amount,
     'Vendor Advance Applied – ' || v_bill.bill_number,
     v_pmt.contact_id, 'vendor_bill', p_bill_id);

  INSERT INTO public.payment_allocations
    (company_id, payment_id, doc_type, doc_id, amount_applied)
  VALUES
    (v_company_id, p_payment_id, 'vendor_bill', p_bill_id, p_amount);

  RETURN jsonb_build_object(
    'je_id',        v_je_id,
    'entry_number', v_entry,
    'payment_id',   p_payment_id,
    'bill_id',      p_bill_id,
    'amount',       p_amount
  );
END;
$$;
