-- ============================================================================
-- Phase 67 (S1) — advance availability must come from the LEDGER
--
-- PROBLEM
-- apply_advance and apply_vendor_advance size the remaining advance from the
-- PAYMENT ROW alone:
--
--     v_available := v_pmt.amount - v_already_applied;
--
-- That is blind to everything else that moves a contact's advance balance. If
-- 200 is received as an advance and 50 is later refunded, the payment row still
-- says 200 and nothing has been "applied", so the full 200 stays applicable.
-- Applying it would drive that customer's 2400 balance to -50 — a debit balance
-- on a liability account for a single contact — and overstate the settlement of
-- the invoice it was applied to.
--
-- The same blindness applies to opening-balance customer credits, PDC advances,
-- and any manual journal entry that touches the contact's advance account.
--
-- FIX
--     v_available := LEAST( v_pmt.amount - v_already_applied,
--                           <ledger balance on 2400/1400 for this contact> );
--
-- NOT pure ledger derivation. A contact holding two separate advances has a
-- ledger balance covering both, so deriving from the ledger alone would be
-- LOOSER than today and would let one payment be over-drawn. LEAST keeps the
-- per-payment cap AND respects the contact's real remaining balance.
--
-- The new bound can only ever REDUCE what is applicable. It cannot enable an
-- operation that was previously blocked, so no currently-valid application can
-- break — only ones that were already wrong.
--
-- Sign convention matches contacts.getAdvanceBalance:
--   2400 customer advance = liability, credit balance -> SUM(credit - debit)
--   1400 vendor   advance = asset,     debit  balance -> SUM(debit - credit)
--
-- DOUBLE ENTRY IS UNAFFECTED. This changes a guard, not a posting. Both
-- functions' general_ledger INSERTs are reproduced byte-for-byte; a tripwire
-- asserts each still posts exactly 2 legs, and je_must_balance (a DEFERRABLE
-- CONSTRAINT TRIGGER on general_ledger, checked at COMMIT) remains the
-- structural guarantee that no unbalanced entry can ever be committed.
--
-- Bodies reproduced verbatim from the live pg_get_functiondef.
-- Additive and idempotent. Safe to re-run.
-- ============================================================================


CREATE OR REPLACE FUNCTION public.apply_advance(p_payment_id uuid, p_invoice_id uuid, p_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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
  v_ledger_avail    NUMERIC(15,2);   -- Phase 67
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


  -- ---- Phase 67 (S1) ledger-derived ceiling ------------------------------
  -- The payment row alone cannot see refunds, opening-balance credits, PDC
  -- advances or manual journal entries that move this contact's 2400.
  -- LEAST keeps the per-payment cap and adds the contact's real remaining
  -- balance as a second bound. It can only reduce what is applicable.
  SELECT COALESCE(SUM(gl.credit - gl.debit), 0)::NUMERIC(15,2) INTO v_ledger_avail
  FROM public.general_ledger gl
  WHERE gl.company_id    = v_company_id
    AND gl.contact_id    = v_pmt.contact_id
    AND gl.account_code  = '2400';
  v_available := LEAST(v_pmt.amount - v_already_applied, v_ledger_avail);
  -- ---- end Phase 67 ------------------------------------------------------
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
$function$;


CREATE OR REPLACE FUNCTION public.apply_vendor_advance(p_payment_id uuid, p_bill_id uuid, p_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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
  v_ledger_avail NUMERIC(15,2);   -- Phase 67
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


  -- ---- Phase 67 (S1) ledger-derived ceiling ------------------------------
  -- The payment row alone cannot see refunds, opening-balance credits, PDC
  -- advances or manual journal entries that move this contact's 1400.
  -- LEAST keeps the per-payment cap and adds the contact's real remaining
  -- balance as a second bound. It can only reduce what is applicable.
  SELECT COALESCE(SUM(gl.debit - gl.credit), 0)::NUMERIC(15,2) INTO v_ledger_avail
  FROM public.general_ledger gl
  WHERE gl.company_id    = v_company_id
    AND gl.contact_id    = v_pmt.contact_id
    AND gl.account_code  = '1400';
  v_available := LEAST(v_pmt.amount - v_used, v_ledger_avail);
  -- ---- end Phase 67 ------------------------------------------------------
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
$function$;
