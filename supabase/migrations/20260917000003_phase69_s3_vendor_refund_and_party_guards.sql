-- ============================================================================
-- Phase 69 (S3) — Vendor refund, and the party guards that make refunds safe
--
-- PART 1: THE AMBIGUITY S2 EXPOSED
-- The payment layer identified a document by DIRECTION alone and assumed
-- direction implied party type. Once customer refunds existed (phase 68) that
-- assumption became actively unsafe, because BOTH directions are now shared:
--
--     money OUT + advance  ->  vendor prepayment   (Dr 1400)
--                          ->  customer refund     (Dr 2400)
--     money IN  + advance  ->  customer receipt    (Cr 2400)
--                          ->  vendor refund       (Cr 1400)
--
-- Nothing stopped the wrong engine from confirming the wrong row:
-- confirm_vendor_payment had no party check at all, and the vendor payments
-- list is a plain .eq('type','outbound') with no party filter — so a customer
-- refund draft would appear there and post Dr 1400 for a customer, crediting
-- the wrong control account and leaving 2400 untouched.
--
-- Fixed by adding a party guard to confirm_payment and confirm_vendor_payment.
-- These are GUARDS, not posting changes: every general_ledger INSERT in both
-- functions is reproduced byte-for-byte, and a tripwire asserts the leg counts
-- are unchanged. They can only refuse a combination that was already wrong —
-- verified against production, where 0 existing payments have a party that
-- mismatches their direction, and 'both' is allowed but unused (21 customer,
-- 15 supplier, 0 both).
--
-- Direction + party is now unambiguous:
--     inbound  + customer  ->  confirm_payment
--     inbound  + supplier  ->  confirm_vendor_refund   (new, below)
--     outbound + supplier  ->  confirm_vendor_payment
--     outbound + customer  ->  confirm_customer_refund (phase 68)
--
-- PART 2: THE VENDOR REFUND
-- We prepaid a supplier, the order was cut back, and they send money back.
-- Dr bank / Cr 1400 Vendor Advances, contact-attributed, capped at the balance
-- we actually hold with that supplier as read from the ledger.
--
-- DOUBLE ENTRY
-- confirm_vendor_refund composes post_journal_entry and writes no
-- general_ledger row directly. void_vendor_refund mirrors every leg with debit
-- and credit swapped at the ORIGINAL line's date (phase 43), which balances by
-- construction. je_must_balance, deferred to COMMIT, remains the structural
-- guarantee above both.
--
-- Bodies for the two patched functions are reproduced verbatim from the live
-- pg_get_functiondef. Additive and idempotent. Safe to re-run.
-- ============================================================================


-- ============================================================================
-- PART 1a — confirm_payment (live body + party guard)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.confirm_payment(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id           UUID := auth.uid();
  v_company_id        UUID;
  v_pmt               public.payments%ROWTYPE;
  v_contact_type      TEXT;   -- Phase 69
  v_lock_date         DATE;
  v_je_id             UUID;
  v_entry             TEXT;
  v_seq               BIGINT;
  v_source_type       TEXT;
  v_bank_coa_id       UUID;
  v_bank_code         TEXT;
  v_ar_id             UUID;
  v_adv_id            UUID;
  v_fx_gain_id        UUID;
  v_fx_loss_id        UUID;
  v_disc_allowed_id   UUID;   -- Phase 12.23 — 6850 Discount Allowed
  v_alloc             RECORD;
  v_inv_rate          NUMERIC(12,6);
  v_inv_currency      TEXT;
  v_ar_aed_this       NUMERIC(15,2);
  v_fx_diff_this      NUMERIC(15,2);
  v_bank_aed          NUMERIC(15,2);
  v_total_ar_aed      NUMERIC(15,2) := 0;
  v_total_fx_gain     NUMERIC(15,2) := 0;
  v_total_fx_loss     NUMERIC(15,2) := 0;
  v_allocated_foreign NUMERIC(15,2) := 0;
  v_unallocated_aed   NUMERIC(15,2);
  v_je_total          NUMERIC(15,2);
  v_allocated_aed     NUMERIC(15,2) := 0;
  v_total_discount    NUMERIC(15,2) := 0;   -- Phase 12.23
  v_unallocated_plain NUMERIC(15,2);
  v_is_fx_payment     BOOLEAN;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_payment: no company for user %', v_user_id;
  END IF;

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

  -- ---- Phase 69 (S3) party guard -----------------------------------------
  -- Direction alone never identified the document. Money OUT can be a vendor
  -- payment or a customer refund; money IN can be a customer receipt or a
  -- vendor refund. Only direction + party is unambiguous, so refuse the
  -- wrong party here rather than posting to the wrong control account.
  SELECT type INTO v_contact_type FROM public.contacts
   WHERE id = v_pmt.contact_id AND company_id = v_company_id;
  IF v_contact_type IS NOT NULL AND v_contact_type NOT IN ('customer', 'both') THEN
    RAISE EXCEPTION 'confirm_payment: contact is not a customer (type=%) — use confirm_vendor_refund instead', v_contact_type;
  END IF;
  -- ---- end Phase 69 ------------------------------------------------------


  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_pmt.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_payment: date % on or before period lock %', v_pmt.date, v_lock_date;
  END IF;

  -- Bank GL account
  SELECT ba.coa_account_id, coa.code
  INTO v_bank_coa_id, v_bank_code
  FROM public.bank_accounts ba
  JOIN public.chart_of_accounts coa ON coa.id = ba.coa_account_id
  WHERE ba.id = v_pmt.bank_account_id AND ba.company_id = v_company_id;

  IF v_bank_coa_id IS NULL THEN
    RAISE EXCEPTION 'confirm_payment: bank account % has no GL account', v_pmt.bank_account_id;
  END IF;

  -- Resolve all the GL accounts we may touch
  SELECT id INTO v_ar_id           FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1200' AND is_active;
  SELECT id INTO v_adv_id          FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2400' AND is_active;
  SELECT id INTO v_fx_gain_id      FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '4400' AND is_active;
  SELECT id INTO v_fx_loss_id      FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '6900' AND is_active;
  -- Phase 12.23 — Discount Allowed. NULL fallback if missing.
  SELECT id INTO v_disc_allowed_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '6850' AND is_active;

  v_is_fx_payment := (v_pmt.currency <> 'AED' AND v_pmt.exchange_rate <> 1.0);
  v_bank_aed := ROUND(v_pmt.amount * v_pmt.exchange_rate, 2);

  -- ── Compute allocations ────────────────────────────────────────────────────
  IF v_pmt.classification = 'against_invoice' THEN
    v_source_type := 'customer_receipt';

    IF v_is_fx_payment THEN
      -- ── FX PATH (unchanged from Phase 12.01) ─────────────────────────────
      FOR v_alloc IN
        SELECT pa.amount_applied, pa.doc_id
        FROM   public.payment_allocations pa
        WHERE  pa.payment_id    = p_payment_id
          AND  pa.company_id    = v_company_id
          AND  pa.doc_type      = 'invoice'
      LOOP
        SELECT COALESCE(exchange_rate, 1.0), COALESCE(currency, 'AED')
        INTO   v_inv_rate, v_inv_currency
        FROM   public.invoices
        WHERE  id = v_alloc.doc_id AND company_id = v_company_id;

        IF NOT FOUND THEN
          v_inv_rate     := v_pmt.exchange_rate;
          v_inv_currency := v_pmt.currency;
        END IF;

        v_ar_aed_this  := ROUND(v_alloc.amount_applied * v_inv_rate, 2);
        v_total_ar_aed := v_total_ar_aed + v_ar_aed_this;
        v_allocated_foreign := v_allocated_foreign + v_alloc.amount_applied;

        IF v_inv_currency = v_pmt.currency THEN
          v_fx_diff_this := ROUND(v_alloc.amount_applied * (v_pmt.exchange_rate - v_inv_rate), 2);
          IF v_fx_diff_this > 0.01 THEN
            v_total_fx_gain := v_total_fx_gain + v_fx_diff_this;
          ELSIF v_fx_diff_this < -0.01 THEN
            v_total_fx_loss := v_total_fx_loss + ABS(v_fx_diff_this);
          END IF;
        END IF;
      END LOOP;

      v_unallocated_aed := GREATEST(
        ROUND((v_pmt.amount - v_allocated_foreign) * v_pmt.exchange_rate, 2),
        0
      );

      v_je_total := v_bank_aed + v_total_fx_loss;

    ELSE
      -- ── AED PATH — includes Phase 12.23 post-sale discount ───────────────
      -- Total cash applied to invoices (excludes any discount portion).
      SELECT COALESCE(SUM(amount_applied),  0),
             COALESCE(SUM(discount_amount), 0)
      INTO   v_allocated_aed, v_total_discount
      FROM   public.payment_allocations
      WHERE  payment_id  = p_payment_id
        AND  company_id  = v_company_id
        AND  doc_type    = 'invoice';

      -- AR clearing total = cash applied + discount. This is what closes
      -- each invoice on the receivable side.
      v_total_ar_aed      := v_allocated_aed + v_total_discount;
      -- Unallocated portion of the cash (overpayment → goes to Customer Advances).
      v_unallocated_plain := v_pmt.amount - v_allocated_aed;
      -- JE total = bank + discount  (both DR sides)
      v_je_total          := v_pmt.amount + v_total_discount;
    END IF;

  ELSE
    -- advance / on_account — no discount semantics here
    v_source_type := 'customer_advance';
    v_je_total    := v_bank_aed;
  END IF;

  -- ── JE header ──────────────────────────────────────────────────────────────
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
      WHEN 'against_invoice' THEN 'Customer Receipt ' || v_pmt.payment_number
      ELSE                        'Customer Advance ' || v_pmt.payment_number
    END,
    v_source_type, p_payment_id,
    v_pmt.currency, v_pmt.exchange_rate,
    v_je_total, v_je_total,
    v_user_id
  ) RETURNING id INTO v_je_id;

  -- DR Bank (the actual cash received — never includes discount portion)
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date,
     debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_bank_coa_id, v_bank_code, v_pmt.date,
     v_bank_aed, 0,
     'Payment ' || v_pmt.payment_number,
     v_pmt.contact_id, 'payment', p_payment_id);

  -- DR Discount Allowed (Phase 12.23) — AED path only
  IF v_pmt.classification = 'against_invoice' AND NOT v_is_fx_payment
     AND v_total_discount > 0 AND v_disc_allowed_id IS NOT NULL THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_disc_allowed_id, '6850', v_pmt.date,
       v_total_discount, 0,
       'Discount Allowed – ' || v_pmt.payment_number,
       v_pmt.contact_id, 'payment', p_payment_id);
  END IF;

  IF v_pmt.classification = 'against_invoice' THEN

    IF v_is_fx_payment THEN
      IF v_total_ar_aed > 0 THEN
        INSERT INTO public.general_ledger
          (company_id, journal_entry_id, account_id, account_code, date,
           debit, credit, description, contact_id, related_doc_type, related_doc_id)
        VALUES
          (v_company_id, v_je_id, v_ar_id, '1200', v_pmt.date,
           0, v_total_ar_aed,
           'Payment ' || v_pmt.payment_number,
           v_pmt.contact_id, 'payment', p_payment_id);
      END IF;

      IF v_total_fx_loss > 0 AND v_fx_loss_id IS NOT NULL THEN
        INSERT INTO public.general_ledger
          (company_id, journal_entry_id, account_id, account_code, date,
           debit, credit, description, contact_id, related_doc_type, related_doc_id)
        VALUES
          (v_company_id, v_je_id, v_fx_loss_id, '6900', v_pmt.date,
           v_total_fx_loss, 0,
           'FX Loss – ' || v_pmt.payment_number,
           v_pmt.contact_id, 'payment', p_payment_id);
      END IF;

      IF v_total_fx_gain > 0 AND v_fx_gain_id IS NOT NULL THEN
        INSERT INTO public.general_ledger
          (company_id, journal_entry_id, account_id, account_code, date,
           debit, credit, description, contact_id, related_doc_type, related_doc_id)
        VALUES
          (v_company_id, v_je_id, v_fx_gain_id, '4400', v_pmt.date,
           0, v_total_fx_gain,
           'FX Gain – ' || v_pmt.payment_number,
           v_pmt.contact_id, 'payment', p_payment_id);
      END IF;

      IF v_unallocated_aed > 0 THEN
        INSERT INTO public.general_ledger
          (company_id, journal_entry_id, account_id, account_code, date,
           debit, credit, description, contact_id, related_doc_type, related_doc_id)
        VALUES
          (v_company_id, v_je_id, v_adv_id, '2400', v_pmt.date,
           0, v_unallocated_aed,
           'Payment ' || v_pmt.payment_number || ' (unallocated)',
           v_pmt.contact_id, 'payment', p_payment_id);
      END IF;

    ELSE
      -- AED path
      -- CR AR — full settlement amount (cash + discount)
      IF v_total_ar_aed > 0 THEN
        INSERT INTO public.general_ledger
          (company_id, journal_entry_id, account_id, account_code, date,
           debit, credit, description, contact_id, related_doc_type, related_doc_id)
        VALUES
          (v_company_id, v_je_id, v_ar_id, '1200', v_pmt.date,
           0, v_total_ar_aed,
           'Payment ' || v_pmt.payment_number,
           v_pmt.contact_id, 'payment', p_payment_id);
      END IF;

      -- CR Customer Advance (any overpayment of CASH portion)
      IF v_unallocated_plain > 0 THEN
        INSERT INTO public.general_ledger
          (company_id, journal_entry_id, account_id, account_code, date,
           debit, credit, description, contact_id, related_doc_type, related_doc_id)
        VALUES
          (v_company_id, v_je_id, v_adv_id, '2400', v_pmt.date,
           0, v_unallocated_plain,
           'Payment ' || v_pmt.payment_number || ' (unallocated)',
           v_pmt.contact_id, 'payment', p_payment_id);
      END IF;
    END IF;

  ELSE
    -- advance / on_account
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_adv_id, '2400', v_pmt.date,
       0, v_bank_aed,
       'Customer Advance ' || v_pmt.payment_number,
       v_pmt.contact_id, 'payment', p_payment_id);
  END IF;

  UPDATE public.payments SET status = 'confirmed', updated_at = NOW() WHERE id = p_payment_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'payment', p_payment_id,
      jsonb_build_object(
        'payment_number', v_pmt.payment_number,
        'je',             v_entry,
        'fx_gain',        v_total_fx_gain,
        'fx_loss',        v_total_fx_loss,
        'discount',       v_total_discount,         -- Phase 12.23
        'phase',          '12.23'
      ));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'payment_id',     p_payment_id,
    'payment_number', v_pmt.payment_number,
    'je_id',          v_je_id,
    'entry_number',   v_entry,
    'fx_gain',        v_total_fx_gain,
    'fx_loss',        v_total_fx_loss,
    'discount',       v_total_discount   -- Phase 12.23
  );
END;
$function$;


-- ============================================================================
-- PART 1b — confirm_vendor_payment (live body + party guard)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.confirm_vendor_payment(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id       UUID := auth.uid();
  v_company_id    UUID;
  v_pmt           public.payments%ROWTYPE;
  v_contact_type  TEXT;   -- Phase 69
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

  -- ---- Phase 69 (S3) party guard -----------------------------------------
  -- Direction alone never identified the document. Money OUT can be a vendor
  -- payment or a customer refund; money IN can be a customer receipt or a
  -- vendor refund. Only direction + party is unambiguous, so refuse the
  -- wrong party here rather than posting to the wrong control account.
  SELECT type INTO v_contact_type FROM public.contacts
   WHERE id = v_pmt.contact_id AND company_id = v_company_id;
  IF v_contact_type IS NOT NULL AND v_contact_type NOT IN ('supplier', 'both') THEN
    RAISE EXCEPTION 'confirm_vendor_payment: contact is not a supplier (type=%) — use confirm_customer_refund instead', v_contact_type;
  END IF;
  -- ---- end Phase 69 ------------------------------------------------------


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
$function$;


-- ============================================================================
-- confirm_vendor_refund
--
-- We prepaid a supplier, the order was cut back, and they send money back.
-- Mirror of confirm_customer_refund: Dr bank / Cr 1400 Vendor Advances.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.confirm_vendor_refund(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id     UUID := auth.uid();
  v_company_id  UUID;
  v_pmt         public.payments%ROWTYPE;
  v_contact     public.contacts%ROWTYPE;
  v_lock_date   DATE;
  v_bank_coa_id UUID;
  v_bank_code   TEXT;
  v_amount      NUMERIC(15,2);
  v_available   NUMERIC(15,2);
  v_desc        TEXT;
  v_res         JSONB;
  v_je_id       UUID;
BEGIN
  PERFORM public.auth_require('accounting.write');

  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_vendor_refund: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_pmt FROM public.payments
   WHERE id = p_payment_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_vendor_refund: payment % not found', p_payment_id;
  END IF;
  IF v_pmt.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_vendor_refund: payment % is not draft (status=%)',
      p_payment_id, v_pmt.status;
  END IF;

  -- Money coming IN, against a vendor advance we are holding with them.
  IF v_pmt.type <> 'inbound' THEN
    RAISE EXCEPTION 'confirm_vendor_refund: expects an inbound payment (type=%)', v_pmt.type;
  END IF;
  IF v_pmt.classification <> 'advance' THEN
    RAISE EXCEPTION 'confirm_vendor_refund: expects classification=advance (got %)', v_pmt.classification;
  END IF;
  IF COALESCE(v_pmt.amount, 0) <= 0 THEN
    RAISE EXCEPTION 'confirm_vendor_refund: amount must be positive (got %)', v_pmt.amount;
  END IF;
  IF v_pmt.bank_account_id IS NULL THEN
    RAISE EXCEPTION 'confirm_vendor_refund: a bank or cash account is required — the money has to land in one';
  END IF;

  SELECT * INTO v_contact FROM public.contacts
   WHERE id = v_pmt.contact_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_vendor_refund: contact % not found', v_pmt.contact_id;
  END IF;
  IF v_contact.type NOT IN ('supplier', 'both') THEN
    RAISE EXCEPTION 'confirm_vendor_refund: % is not a supplier (type=%) — use the customer refund instead',
      v_contact.name, v_contact.type;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_pmt.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_vendor_refund: date % is on or before the period lock %',
      v_pmt.date, v_lock_date;
  END IF;

  SELECT ba.coa_account_id, coa.code
    INTO v_bank_coa_id, v_bank_code
  FROM public.bank_accounts ba
  JOIN public.chart_of_accounts coa ON coa.id = ba.coa_account_id
  WHERE ba.id = v_pmt.bank_account_id AND ba.company_id = v_company_id;
  IF v_bank_coa_id IS NULL THEN
    RAISE EXCEPTION 'confirm_vendor_refund: bank account % has no GL account',
      v_pmt.bank_account_id;
  END IF;

  v_amount := ROUND(v_pmt.amount * COALESCE(v_pmt.exchange_rate, 1), 2);

  -- 1400 is an ASSET (money we are holding with the supplier), so the natural
  -- balance is debit. Same sign convention as contacts.getAdvanceBalance and
  -- the ceiling phase 67 made apply_vendor_advance respect.
  SELECT COALESCE(SUM(gl.debit - gl.credit), 0)::NUMERIC(15,2)
    INTO v_available
  FROM public.general_ledger gl
  WHERE gl.company_id   = v_company_id
    AND gl.contact_id   = v_pmt.contact_id
    AND gl.account_code = '1400';

  IF v_amount > v_available THEN
    RAISE EXCEPTION 'confirm_vendor_refund: refund % exceeds the advance balance % held with %',
      v_amount, v_available, v_contact.name;
  END IF;

  v_desc := 'Vendor Refund ' || v_pmt.payment_number;

  v_res := public.post_journal_entry(jsonb_build_object(
    'date',          v_pmt.date,
    'description',   v_desc,
    'source_type',   'vendor_refund',
    'source_id',     p_payment_id,
    'currency',      v_pmt.currency,
    'exchange_rate', COALESCE(v_pmt.exchange_rate, 1),
    'lines', jsonb_build_array(
      jsonb_build_object(
        'account_code', v_bank_code,
        'debit',        v_amount,
        'credit',       0,
        'description',  v_desc,
        'contact_id',   v_pmt.contact_id
      ),
      jsonb_build_object(
        'account_code', '1400',
        'debit',        0,
        'credit',       v_amount,
        'description',  v_desc,
        'contact_id',   v_pmt.contact_id
      )
    )
  ));
  v_je_id := (v_res ->> 'journal_entry_id')::UUID;

  UPDATE public.payments
     SET status = 'confirmed', updated_at = NOW()
   WHERE id = p_payment_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'vendor_refund', p_payment_id,
      jsonb_build_object(
        'payment_number', v_pmt.payment_number,
        'contact_id',     v_pmt.contact_id,
        'amount',         v_amount,
        'advance_before', v_available,
        'advance_after',  v_available - v_amount,
        'entry_number',   v_res ->> 'entry_number',
        'phase',          '69'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'payment_id',       p_payment_id,
    'payment_number',   v_pmt.payment_number,
    'journal_entry_id', v_je_id,
    'entry_number',     v_res ->> 'entry_number',
    'amount',           v_amount,
    'advance_after',    v_available - v_amount
  );
END;
$function$;

REVOKE ALL    ON FUNCTION public.confirm_vendor_refund(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_vendor_refund(uuid) TO authenticated;


-- ============================================================================
-- void_vendor_refund — mirrors every leg at the voucher date (phase 43).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.void_vendor_refund(
  p_payment_id uuid,
  p_reason     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_pmt        public.payments%ROWTYPE;
  v_je         public.journal_entries%ROWTYPE;
  v_gl         public.general_ledger%ROWTYPE;
  v_lock_date  DATE;
  v_seq        BIGINT;
  v_rev_entry  TEXT;
  v_rev_id     UUID;
BEGIN
  PERFORM public.auth_require('accounting.write');

  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'void_vendor_refund: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_pmt FROM public.payments
   WHERE id = p_payment_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'void_vendor_refund: payment % not found', p_payment_id;
  END IF;
  IF v_pmt.status <> 'confirmed' THEN
    RAISE EXCEPTION 'void_vendor_refund: payment % is not confirmed (status=%)',
      p_payment_id, v_pmt.status;
  END IF;
  IF v_pmt.type <> 'inbound' OR v_pmt.classification <> 'advance' THEN
    RAISE EXCEPTION 'void_vendor_refund: % is not a vendor refund (type=%, classification=%)',
      p_payment_id, v_pmt.type, v_pmt.classification;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.general_ledger gl
    JOIN public.journal_entries je ON je.id = gl.journal_entry_id
    WHERE je.company_id = v_company_id
      AND je.source_id  = p_payment_id
      AND gl.reconciliation_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'void_vendor_refund: refund % is bank-reconciled. Un-reconcile it first, then void.',
      p_payment_id;
  END IF;

  SELECT * INTO v_je FROM public.journal_entries
   WHERE company_id     = v_company_id
     AND source_id      = p_payment_id
     AND source_type    = 'vendor_refund'
     AND reversed_by_id IS NULL
     AND reversal_of_id IS NULL
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'void_vendor_refund: no live journal entry found for refund %', p_payment_id;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_je.date <= v_lock_date THEN
    RAISE EXCEPTION 'void_vendor_refund: the original posting dated % is in a locked period (lock %)',
      v_je.date, v_lock_date;
  END IF;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_seq;
  v_rev_entry := 'JE-' || v_seq::TEXT;

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, currency, exchange_rate,
    total_debit, total_credit, reversal_of_id, created_by
  ) VALUES (
    v_company_id, v_rev_entry, v_je.date,
    COALESCE(p_reason, 'Void vendor refund – ' || v_pmt.payment_number),
    'vendor_refund', p_payment_id, v_je.currency, v_je.exchange_rate,
    v_je.total_credit, v_je.total_debit, v_je.id, v_user_id
  ) RETURNING id INTO v_rev_id;

  FOR v_gl IN SELECT * FROM public.general_ledger WHERE journal_entry_id = v_je.id LOOP
    INSERT INTO public.general_ledger (
      company_id, journal_entry_id, account_id, account_code, date,
      debit, credit, description,
      contact_id, related_doc_type, related_doc_id, reversal_of_id
    ) VALUES (
      v_company_id, v_rev_id, v_gl.account_id, v_gl.account_code, v_gl.date,
      v_gl.credit, v_gl.debit,
      COALESCE(p_reason, 'Void vendor refund – ' || v_pmt.payment_number),
      v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
    );
  END LOOP;

  UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;

  UPDATE public.payments
     SET status      = 'void',
         void_reason = p_reason,
         voided_at   = NOW(),
         voided_by   = v_user_id,
         updated_at  = NOW()
   WHERE id = p_payment_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'void', 'vendor_refund', p_payment_id,
      jsonb_build_object(
        'payment_number', v_pmt.payment_number,
        'reason',         p_reason,
        'reversal_entry', v_rev_entry,
        'reversed_je',    v_je.entry_number,
        'phase',          '69'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'payment_id',     p_payment_id,
    'reversal_je_id', v_rev_id,
    'reversal_entry', v_rev_entry
  );
END;
$function$;

REVOKE ALL    ON FUNCTION public.void_vendor_refund(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_vendor_refund(uuid, text) TO authenticated;
