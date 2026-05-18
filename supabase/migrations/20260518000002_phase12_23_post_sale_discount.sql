-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 12 — Migration 23: Post-sale discount on customer receipt
-- ─────────────────────────────────────────────────────────────────────────
-- Adds support for "cash discount allowed" / "settlement discount" — the
-- post-sale flavour of discount that a customer gets when paying short of
-- the invoice's outstanding balance. Distinct from the invoice-time
-- discount (Phase 12.22) which is netted into Revenue.
--
-- Example: invoice for 1,000. Customer pays 980. We accept the 20 short
-- as a settlement discount. After this migration the entry is:
--
--   Dr Bank                  980      ← actual cash received
--   Dr Discount Allowed       20      ← new contra (Indirect Expense)
--                  Cr AR    1,000     ← invoice fully closed
--
-- Where on the P&L this lands:
--   • 6850 Discount Allowed has type='expense', sub_type='indirect', so
--     it sits BELOW Gross Profit in "Operating Expenses (Indirect)".
--   • It reduces Net Profit, not Revenue.
--   • Matches the user's intent: "later discounts in indirect expenses".
--
-- Schema additions:
--   • payment_allocations.discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0
--     CHECK >= 0. Per-allocation so a single payment can apply different
--     discounts to different invoices.
--   • 6850 Discount Allowed seeded for every existing company that doesn't
--     already have it. (For new companies, seedCOA.ts adds it from now on.)
--
-- confirm_payment changes (AED path):
--   Net cash to bank stays the same (= payment.amount).
--   New: SUM(allocations.discount_amount) gets debited to 6850.
--   AR credit becomes SUM(amount_applied + discount_amount) — the full
--   amount each invoice is settled for, including the discount portion.
--
-- Outstanding semantics:
--   The invoice is considered settled by amount_applied + discount_amount.
--   Reports / outstanding queries should subtract both — handled in the
--   adapter layer where outstanding is computed.
--
-- FX path: out of scope here. Foreign-currency receipts with a discount
-- are vanishingly rare in this user's market. If/when needed, the same
-- pattern applies: DR 6850 at the payment's exchange rate.
--
-- void_payment: no change needed. It loops over general_ledger rows of
-- the source JE and reverses each; the new 6850 row is picked up
-- automatically alongside Bank, AR, and Advance.
--
-- Phase tag `Phase 12.23` appears in confirm_payment so the regression
-- suite can verify the fix is still installed.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. Schema: discount_amount on payment_allocations ─────────────────────
ALTER TABLE public.payment_allocations
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0
    CHECK (discount_amount >= 0);

COMMENT ON COLUMN public.payment_allocations.discount_amount IS
  'Phase 12.23 — post-sale cash discount given on this allocation. '
  'Settles the invoice for amount_applied + discount_amount; bank receives '
  'amount_applied; the discount portion is debited to 6850 Discount Allowed '
  'on confirm_payment.';

-- ── 2. CoA: 6850 Discount Allowed for every existing company ──────────────
-- Idempotent: skip if the company already has it.
INSERT INTO public.chart_of_accounts
  (company_id, code, name, name_ar, type, sub_type, is_system, is_active)
SELECT c.id, '6850', 'Discount Allowed', 'الخصومات المسموح بها',
       'expense', 'indirect', true, true
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.chart_of_accounts coa
  WHERE coa.company_id = c.id AND coa.code = '6850'
);


-- ── 3. confirm_payment with post-sale discount support ────────────────────
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
$$;
