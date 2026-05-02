-- Phase 4 — confirm_payment RPC
-- Inbound payments only.
-- classification='against_invoice' → A5: DR bank, CR 1200 (allocated), CR 2400 (overpayment)
-- classification='advance'|'on_account' → A7: DR bank, CR 2400
-- Returns: { payment_id, payment_number, je_id, entry_number }

CREATE OR REPLACE FUNCTION public.confirm_payment(p_payment_id UUID)
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
  -- GL accounts
  v_bank_coa_id   UUID;
  v_bank_code     TEXT;
  v_ar_id         UUID;
  v_adv_id        UUID;
  -- Allocation
  v_allocated     NUMERIC(15,2) := 0;
  v_unallocated   NUMERIC(15,2);
  v_source_type   TEXT;
BEGIN
  -- Resolve company
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_payment: no company for user %', v_user_id;
  END IF;

  -- Load payment
  SELECT * INTO v_pmt FROM public.payments WHERE id = p_payment_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_payment: payment % not found', p_payment_id;
  END IF;
  IF v_pmt.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_payment: payment % not in draft (status=%)', p_payment_id, v_pmt.status;
  END IF;
  IF v_pmt.type <> 'inbound' THEN
    RAISE EXCEPTION 'confirm_payment: only inbound payments handled here (type=%)', v_pmt.type;
  END IF;

  -- Period lock
  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_pmt.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_payment: date % on or before period lock %', v_pmt.date, v_lock_date;
  END IF;

  -- Resolve bank account GL account
  SELECT ba.coa_account_id, coa.code
  INTO v_bank_coa_id, v_bank_code
  FROM public.bank_accounts ba
  JOIN public.chart_of_accounts coa ON coa.id = ba.coa_account_id
  WHERE ba.id = v_pmt.bank_account_id AND ba.company_id = v_company_id;

  IF v_bank_coa_id IS NULL THEN
    RAISE EXCEPTION 'confirm_payment: bank account % has no GL account', v_pmt.bank_account_id;
  END IF;

  -- Resolve AR (1200) + Customer Advances (2400)
  SELECT id INTO v_ar_id  FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1200' AND is_active;
  SELECT id INTO v_adv_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2400' AND is_active;

  -- For against_invoice: sum allocations already recorded in draft
  IF v_pmt.classification = 'against_invoice' THEN
    SELECT COALESCE(SUM(amount_applied), 0) INTO v_allocated
    FROM public.payment_allocations
    WHERE payment_id = p_payment_id AND company_id = v_company_id AND doc_type = 'invoice';
    v_source_type := 'customer_receipt';
  ELSE
    v_source_type := 'customer_advance';
  END IF;

  v_unallocated := v_pmt.amount - v_allocated;

  -- Advance JE sequence
  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_seq;
  v_entry := 'JE-' || v_seq::TEXT;

  -- Insert JE header
  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, currency, exchange_rate,
    total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_entry, v_pmt.date,
    CASE v_pmt.classification
      WHEN 'against_invoice' THEN 'Customer Receipt ' || v_pmt.payment_number
      ELSE 'Customer Advance ' || v_pmt.payment_number
    END,
    v_source_type, p_payment_id,
    v_pmt.currency, v_pmt.exchange_rate,
    v_pmt.amount, v_pmt.amount,
    v_user_id
  ) RETURNING id INTO v_je_id;

  -- DR bank account (always the full amount)
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date,
     debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_bank_coa_id, v_bank_code, v_pmt.date,
     v_pmt.amount, 0,
     'Payment ' || v_pmt.payment_number,
     v_pmt.contact_id, 'payment', p_payment_id);

  IF v_pmt.classification = 'against_invoice' THEN
    -- CR 1200 AR for allocated portion
    IF v_allocated > 0 THEN
      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date,
         debit, credit, description, contact_id, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_je_id, v_ar_id, '1200', v_pmt.date,
         0, v_allocated,
         'Payment ' || v_pmt.payment_number,
         v_pmt.contact_id, 'payment', p_payment_id);
    END IF;

    -- CR 2400 Customer Advances for unallocated (overpayment)
    IF v_unallocated > 0 THEN
      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date,
         debit, credit, description, contact_id, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_je_id, v_adv_id, '2400', v_pmt.date,
         0, v_unallocated,
         'Payment ' || v_pmt.payment_number || ' (unallocated)',
         v_pmt.contact_id, 'payment', p_payment_id);
    END IF;
  ELSE
    -- A7: full amount to 2400 (advance or on_account)
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_adv_id, '2400', v_pmt.date,
       0, v_pmt.amount,
       'Customer Advance ' || v_pmt.payment_number,
       v_pmt.contact_id, 'payment', p_payment_id);
  END IF;

  -- Confirm payment
  UPDATE public.payments SET status = 'confirmed', updated_at = NOW() WHERE id = p_payment_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'payment', p_payment_id,
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
