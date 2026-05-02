-- Phase 4 — apply_advance RPC
-- A6: DR 2400 Customer Advances, CR 1200 AR.
-- source_type='advance_application', source_id=p_invoice_id so void_invoice can reverse it.
-- Validates available advance balance before applying.
-- Returns: { je_id, entry_number, payment_id, invoice_id, amount }

CREATE OR REPLACE FUNCTION public.apply_advance(
  p_payment_id  UUID,
  p_invoice_id  UUID,
  p_amount      NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id         UUID := auth.uid();
  v_company_id      UUID;
  v_pmt             public.payments%ROWTYPE;
  v_inv             public.invoices%ROWTYPE;
  v_lock_date       DATE;
  v_je_id           UUID;
  v_entry           TEXT;
  v_seq             BIGINT;
  v_ar_id           UUID;
  v_adv_id          UUID;
  v_already_applied NUMERIC(15,2);
  v_available       NUMERIC(15,2);
BEGIN
  -- Resolve company
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'apply_advance: no company for user %', v_user_id;
  END IF;

  -- Load payment
  SELECT * INTO v_pmt FROM public.payments WHERE id = p_payment_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_advance: payment % not found', p_payment_id;
  END IF;
  IF v_pmt.status <> 'confirmed' THEN
    RAISE EXCEPTION 'apply_advance: payment % is not confirmed (status=%)', p_payment_id, v_pmt.status;
  END IF;
  IF v_pmt.type <> 'inbound' THEN
    RAISE EXCEPTION 'apply_advance: only inbound payments can be applied (type=%)', v_pmt.type;
  END IF;

  -- Load invoice
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_advance: invoice % not found', p_invoice_id;
  END IF;
  IF v_inv.status <> 'confirmed' THEN
    RAISE EXCEPTION 'apply_advance: invoice % is not confirmed (status=%)', p_invoice_id, v_inv.status;
  END IF;

  -- Period lock: use today's date for the application JE
  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND CURRENT_DATE <= v_lock_date THEN
    RAISE EXCEPTION 'apply_advance: today % on or before period lock %', CURRENT_DATE, v_lock_date;
  END IF;

  -- Check available advance balance
  SELECT COALESCE(SUM(amount_applied), 0) INTO v_already_applied
  FROM public.payment_allocations
  WHERE payment_id = p_payment_id AND company_id = v_company_id;

  v_available := v_pmt.amount - v_already_applied;
  IF p_amount > v_available THEN
    RAISE EXCEPTION 'apply_advance: amount % exceeds available balance % on payment %',
      p_amount, v_available, p_payment_id;
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'apply_advance: amount must be positive, got %', p_amount;
  END IF;

  -- Resolve GL accounts
  SELECT id INTO v_ar_id  FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1200' AND is_active;
  SELECT id INTO v_adv_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2400' AND is_active;

  -- Advance JE sequence
  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_seq;
  v_entry := 'JE-' || v_seq::TEXT;

  -- Insert A6 JE header
  -- source_id = invoice_id so void_invoice can find and reverse this entry
  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, currency, exchange_rate,
    total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_entry, CURRENT_DATE,
    'Advance Applied – ' || v_inv.invoice_number,
    'advance_application', p_invoice_id,
    v_pmt.currency, v_pmt.exchange_rate,
    p_amount, p_amount,
    v_user_id
  ) RETURNING id INTO v_je_id;

  -- DR 2400 Customer Advances
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date,
     debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_adv_id, '2400', CURRENT_DATE,
     p_amount, 0,
     'Advance Applied – ' || v_inv.invoice_number,
     v_pmt.contact_id, 'invoice', p_invoice_id);

  -- CR 1200 AR
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date,
     debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_ar_id, '1200', CURRENT_DATE,
     0, p_amount,
     'Advance Applied – ' || v_inv.invoice_number,
     v_pmt.contact_id, 'invoice', p_invoice_id);

  -- Record allocation
  INSERT INTO public.payment_allocations
    (company_id, payment_id, doc_type, doc_id, amount_applied)
  VALUES
    (v_company_id, p_payment_id, 'invoice', p_invoice_id, p_amount);

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'apply_advance', 'payment', p_payment_id,
      jsonb_build_object('invoice_id', p_invoice_id, 'amount', p_amount, 'je', v_entry));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'je_id',        v_je_id,
    'entry_number', v_entry,
    'payment_id',   p_payment_id,
    'invoice_id',   p_invoice_id,
    'amount',       p_amount
  );
END;
$$;
