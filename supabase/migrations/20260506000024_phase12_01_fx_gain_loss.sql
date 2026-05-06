-- Phase 12 — FX Gain/Loss on Customer Receipts (Doc 3 J2)
--
-- Replaces confirm_payment with an FX-aware version.
-- When payment.currency ≠ 'AED' the engine calculates the AED equivalent of
-- each invoice allocation at both the invoice rate and the payment rate.
-- The difference is posted to 4400 (FX Gain) or 6900 (FX Loss).
--
-- Backward-compatible: all existing payments have exchange_rate = 1.0 and
-- currency = 'AED', so the AED path runs unchanged.
--
-- Doc 3 J2 example:
--   Invoice $1,000 USD at 3.6725 → AR Dr 3,672.50 AED
--   Receipt $1,000 USD at 3.6750 → Bank Dr 3,675.00 AED
--   FX Gain = $1,000 × (3.6750 – 3.6725) = 2.50 AED → Cr 4400

CREATE OR REPLACE FUNCTION public.confirm_payment(p_payment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id           UUID := auth.uid();
  v_company_id        UUID;
  v_pmt               public.payments%ROWTYPE;
  v_lock_date         DATE;
  v_je_id             UUID;
  v_entry             TEXT;
  v_seq               BIGINT;
  v_source_type       TEXT;
  -- GL account IDs
  v_bank_coa_id       UUID;
  v_bank_code         TEXT;
  v_ar_id             UUID;
  v_adv_id            UUID;
  v_fx_gain_id        UUID;   -- 4400
  v_fx_loss_id        UUID;   -- 6900
  -- FX loop variables
  v_alloc             RECORD;
  v_inv_rate          NUMERIC(12,6);
  v_inv_currency      TEXT;
  v_ar_aed_this       NUMERIC(15,2);
  v_fx_diff_this      NUMERIC(15,2);
  -- AED totals
  v_bank_aed          NUMERIC(15,2);
  v_total_ar_aed      NUMERIC(15,2) := 0;
  v_total_fx_gain     NUMERIC(15,2) := 0;
  v_total_fx_loss     NUMERIC(15,2) := 0;
  v_allocated_foreign NUMERIC(15,2) := 0;   -- running sum of amount_applied (foreign units)
  v_unallocated_aed   NUMERIC(15,2);
  v_je_total          NUMERIC(15,2);
  -- AED (non-FX) path
  v_allocated_aed     NUMERIC(15,2) := 0;
  v_unallocated_plain NUMERIC(15,2);
  v_is_fx_payment     BOOLEAN;
BEGIN
  -- ── Resolve company ────────────────────────────────────────────────────────
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_payment: no company for user %', v_user_id;
  END IF;

  -- ── Load payment ───────────────────────────────────────────────────────────
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

  -- ── Period lock ────────────────────────────────────────────────────────────
  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_pmt.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_payment: date % on or before period lock %', v_pmt.date, v_lock_date;
  END IF;

  -- ── Resolve bank GL account ────────────────────────────────────────────────
  SELECT ba.coa_account_id, coa.code
  INTO v_bank_coa_id, v_bank_code
  FROM public.bank_accounts ba
  JOIN public.chart_of_accounts coa ON coa.id = ba.coa_account_id
  WHERE ba.id = v_pmt.bank_account_id AND ba.company_id = v_company_id;

  IF v_bank_coa_id IS NULL THEN
    RAISE EXCEPTION 'confirm_payment: bank account % has no GL account', v_pmt.bank_account_id;
  END IF;

  -- ── Resolve GL accounts ────────────────────────────────────────────────────
  SELECT id INTO v_ar_id      FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1200' AND is_active;
  SELECT id INTO v_adv_id     FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2400' AND is_active;
  SELECT id INTO v_fx_gain_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '4400' AND is_active;
  SELECT id INTO v_fx_loss_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '6900' AND is_active;

  -- ── Determine FX path ──────────────────────────────────────────────────────
  -- FX path activates only when the payment is in a foreign currency with a
  -- real exchange rate.  All current AED payments (exchange_rate = 1.0) use
  -- the plain AED path and behave exactly as before.
  v_is_fx_payment := (v_pmt.currency <> 'AED' AND v_pmt.exchange_rate <> 1.0);

  -- Bank debit in AED = payment amount × rate  (for AED payments, rate = 1)
  v_bank_aed := ROUND(v_pmt.amount * v_pmt.exchange_rate, 2);

  -- ── Compute allocations ────────────────────────────────────────────────────
  IF v_pmt.classification = 'against_invoice' THEN
    v_source_type := 'customer_receipt';

    IF v_is_fx_payment THEN
      -- ── FX PATH ─────────────────────────────────────────────────────────────
      -- amount_applied is in the payment's foreign currency (e.g. USD).
      -- AR is cleared at the invoice's original exchange rate.
      -- The rate difference posts to 4400 / 6900.
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

        -- AR clearing amount in AED (booked at invoice rate)
        v_ar_aed_this  := ROUND(v_alloc.amount_applied * v_inv_rate, 2);
        v_total_ar_aed := v_total_ar_aed + v_ar_aed_this;
        v_allocated_foreign := v_allocated_foreign + v_alloc.amount_applied;

        -- FX difference (only when invoice was in the same foreign currency)
        IF v_inv_currency = v_pmt.currency THEN
          v_fx_diff_this := ROUND(v_alloc.amount_applied * (v_pmt.exchange_rate - v_inv_rate), 2);
          IF v_fx_diff_this > 0.01 THEN
            v_total_fx_gain := v_total_fx_gain + v_fx_diff_this;
          ELSIF v_fx_diff_this < -0.01 THEN
            v_total_fx_loss := v_total_fx_loss + ABS(v_fx_diff_this);
          END IF;
        END IF;
      END LOOP;

      -- Unallocated advance portion in AED
      v_unallocated_aed := GREATEST(
        ROUND((v_pmt.amount - v_allocated_foreign) * v_pmt.exchange_rate, 2),
        0
      );

      -- JE total (debit side = bank + fx_loss; credit side = ar + fx_gain + advance)
      v_je_total := v_bank_aed + v_total_fx_loss;

    ELSE
      -- ── AED PATH (original logic) ─────────────────────────────────────────
      -- All amounts are already in the functional currency; no conversion needed.
      SELECT COALESCE(SUM(amount_applied), 0)
      INTO   v_allocated_aed
      FROM   public.payment_allocations
      WHERE  payment_id  = p_payment_id
        AND  company_id  = v_company_id
        AND  doc_type    = 'invoice';

      v_total_ar_aed  := v_allocated_aed;
      v_unallocated_plain := v_pmt.amount - v_allocated_aed;
      v_je_total      := v_pmt.amount;
    END IF;

  ELSE
    -- advance / on_account: full amount goes to 2400
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

  -- ── GL lines ───────────────────────────────────────────────────────────────
  -- DR Bank (always the full AED equivalent)
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date,
     debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_bank_coa_id, v_bank_code, v_pmt.date,
     v_bank_aed, 0,
     'Payment ' || v_pmt.payment_number,
     v_pmt.contact_id, 'payment', p_payment_id);

  IF v_pmt.classification = 'against_invoice' THEN

    IF v_is_fx_payment THEN
      -- CR 1200 AR (total AED at invoice exchange rates)
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

      -- DR 6900 FX Loss (when payment rate < invoice rate)
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

      -- CR 4400 FX Gain (when payment rate > invoice rate)
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

      -- CR 2400 Customer Advances (unallocated / overpayment portion)
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
      -- AED path: original logic, amounts are already in functional currency
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
    -- A7: advance / on_account → full AED amount to 2400
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_adv_id, '2400', v_pmt.date,
       0, v_bank_aed,
       'Customer Advance ' || v_pmt.payment_number,
       v_pmt.contact_id, 'payment', p_payment_id);
  END IF;

  -- ── Confirm payment ────────────────────────────────────────────────────────
  UPDATE public.payments SET status = 'confirmed', updated_at = NOW() WHERE id = p_payment_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'payment', p_payment_id,
      jsonb_build_object(
        'payment_number', v_pmt.payment_number,
        'je',             v_entry,
        'fx_gain',        v_total_fx_gain,
        'fx_loss',        v_total_fx_loss
      ));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'payment_id',     p_payment_id,
    'payment_number', v_pmt.payment_number,
    'je_id',          v_je_id,
    'entry_number',   v_entry,
    'fx_gain',        v_total_fx_gain,
    'fx_loss',        v_total_fx_loss
  );
END;
$$;
