-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 14 — Migration 09: Opening Balances Wizard
-- ─────────────────────────────────────────────────────────────────────────
-- New customers/suppliers being migrated from an old system arrive with
-- pre-existing debt (or pre-existing credit on file). Until now there was
-- no way to record that opening position without faking it as a real
-- invoice — which would inflate Revenue, COGS, and FTA VAT obligations
-- for periods the company wasn't even on StockBolt yet.
--
-- This migration adds proper opening-balance support:
--
--   1. is_opening flag on invoices, vendor_bills, and payments. When true
--      the row was created by the opening-balance wizard, not by real
--      trade. Downstream code (Sales reports, VAT report, statements)
--      can skip / tag these rows as needed.
--
--   2. 3010 Opening Balance Equity seeded for every existing company.
--      Standard practice: every opening JE offsets to this equity
--      account. After all opening balances are entered, 3010 should
--      equal the company's net opening position from the old system.
--      Bookkeeper then clears 3010 to 3100 Retained Earnings post-
--      migration.
--
--   3. post_opening_balance(...) RPC. Per-row entry — accepts one
--      opening item and posts:
--
--      • ar_owed         → INSERT invoice (status=confirmed, is_opening=true);
--                          JE Dr 1200 AR / Cr 3010
--      • ap_owed         → INSERT vendor_bill (status=confirmed, is_opening=true);
--                          JE Cr 2100 AP / Dr 3010
--      • customer_credit → INSERT payment (status=confirmed,
--                          classification='advance', is_opening=true);
--                          JE Cr 2400 Customer Advances / Dr 3010
--      • vendor_credit   → INSERT vendor payment (status=confirmed,
--                          classification='advance', is_opening=true,
--                          type='outbound'); JE Dr 1400 Vendor Advances / Cr 3010
--
--      No revenue, no COGS, no VAT, no stock movement. Each row is its
--      own JE keyed to its original date so aging reports show the real
--      age of the migrated debt (not the day it was keyed in).
--
--      Each opening item gets a synthetic single-line invoice/bill row
--      so the existing invoice/bill listing UIs render it without
--      changes — we just tag is_opening=true and downstream code can
--      style it differently.
--
--   4. The wizard can be re-run anytime (additive). It's not gated by
--      "first transaction in the system" because solo builders onboard
--      customers gradually.
--
-- Phase tag `Phase 14.09` appears in post_opening_balance so the
-- regression suite can verify the function is installed.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. Schema: is_opening flag on invoices / vendor_bills / payments ─────

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS is_opening BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN public.invoices.is_opening IS
  'Phase 14.09 — true when this invoice was created by the opening-'
  'balance wizard (migration of an unpaid AR balance from a prior '
  'system). Excluded from Revenue and VAT reports; included in AR '
  'aging and the customer statement.';

ALTER TABLE public.vendor_bills
  ADD COLUMN IF NOT EXISTS is_opening BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN public.vendor_bills.is_opening IS
  'Phase 14.09 — true when this bill was created by the opening-balance '
  'wizard. Excluded from Purchases reports; included in AP aging.';

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS is_opening BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN public.payments.is_opening IS
  'Phase 14.09 — true when this payment represents an opening credit-on-'
  'file (customer advance or vendor advance) from a prior system. '
  'Classified as ''advance'' so the unallocated portion is visible.';

-- Indexes — opening rows are queried separately by the wizard list view.
CREATE INDEX IF NOT EXISTS invoices_is_opening_idx
  ON public.invoices (company_id, is_opening) WHERE is_opening = true;
CREATE INDEX IF NOT EXISTS vendor_bills_is_opening_idx
  ON public.vendor_bills (company_id, is_opening) WHERE is_opening = true;
CREATE INDEX IF NOT EXISTS payments_is_opening_idx
  ON public.payments (company_id, is_opening) WHERE is_opening = true;


-- ── 2. Seed 3010 Opening Balance Equity for every existing company ───────

INSERT INTO public.chart_of_accounts
  (company_id, code, name, name_ar, type, is_system, is_active)
SELECT c.id, '3010', 'Opening Balance Equity', 'حقوق الملكية الافتتاحية',
       'equity', true, true
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.chart_of_accounts coa
  WHERE coa.company_id = c.id AND coa.code = '3010'
);


-- ── 3. post_opening_balance RPC ──────────────────────────────────────────
--
-- Posts one opening item. Called in a loop from the wizard so each row
-- gets its own JE with its own date — preserving aging accuracy.
--
-- Args:
--   p_type        — 'ar_owed' | 'ap_owed' | 'customer_credit' | 'vendor_credit'
--   p_contact_id  — the customer or supplier
--   p_doc_number  — the OLD system's document number (becomes invoice_number
--                   / bill_number / payment_number for traceability). Use
--                   a prefix like 'OB-' if the original number is unknown.
--   p_date        — the original document date (used for aging)
--   p_due_date    — original due date (nullable; only meaningful for ar/ap)
--   p_amount      — positive AED amount
--   p_currency    — 3-letter code (defaults to AED)
--   p_notes       — free-text note (e.g. "migrated from Tally")
--
-- Returns: jsonb { type, doc_id, doc_number, journal_entry_id, entry_number }

CREATE OR REPLACE FUNCTION public.post_opening_balance(
  p_type        TEXT,
  p_contact_id  UUID,
  p_doc_number  TEXT,
  p_date        DATE,
  p_due_date    DATE,
  p_amount      NUMERIC,
  p_currency    TEXT DEFAULT 'AED',
  p_notes       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
-- Phase 14.09 — opening-balance posting.
DECLARE
  v_company_id    UUID;
  v_user_id       UUID;
  v_je_id         UUID;
  v_entry_number  TEXT;
  v_seq           INT;
  v_doc_id        UUID;
  v_ar_id         UUID;
  v_ap_id         UUID;
  v_adv_cust_id   UUID;
  v_adv_vend_id   UUID;
  v_ob_eq_id      UUID;
BEGIN
  -- Resolve company from the contact (and use this for RLS).
  SELECT company_id INTO v_company_id
  FROM public.contacts WHERE id = p_contact_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Contact % not found', p_contact_id;
  END IF;

  v_user_id := auth.uid();
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Opening balance amount must be positive, got %', p_amount;
  END IF;
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'Opening balance date is required';
  END IF;
  IF p_type NOT IN ('ar_owed','ap_owed','customer_credit','vendor_credit') THEN
    RAISE EXCEPTION 'Invalid opening type: %', p_type;
  END IF;

  -- Resolve control accounts. All must exist for the company.
  SELECT id INTO v_ar_id       FROM public.chart_of_accounts
   WHERE company_id = v_company_id AND code = '1200';
  SELECT id INTO v_ap_id       FROM public.chart_of_accounts
   WHERE company_id = v_company_id AND code = '2100';
  SELECT id INTO v_adv_cust_id FROM public.chart_of_accounts
   WHERE company_id = v_company_id AND code = '2400';
  SELECT id INTO v_adv_vend_id FROM public.chart_of_accounts
   WHERE company_id = v_company_id AND code = '1400';
  SELECT id INTO v_ob_eq_id    FROM public.chart_of_accounts
   WHERE company_id = v_company_id AND code = '3010';

  IF v_ob_eq_id IS NULL THEN
    RAISE EXCEPTION '3010 Opening Balance Equity not seeded for company';
  END IF;

  -- Reserve a JE number.
  INSERT INTO public.document_sequences
    (company_id, prefix, current_value, format, padding_length, allow_reset)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1,
        updated_at    = NOW()
  RETURNING current_value INTO v_seq;
  v_entry_number := 'JE-' || v_seq::TEXT;

  -- ── Branch per opening type ───────────────────────────────────────────
  IF p_type = 'ar_owed' THEN
    -- Insert a confirmed invoice with is_opening=true and no items.
    INSERT INTO public.invoices (
      company_id, contact_id, invoice_number, date, due_date,
      currency, exchange_rate, status,
      subtotal, discount_amount, tax_amount, total_amount,
      notes, is_opening
    ) VALUES (
      v_company_id, p_contact_id, p_doc_number, p_date, p_due_date,
      p_currency, 1.0, 'confirmed',
      p_amount, 0, 0, p_amount,
      p_notes, true
    ) RETURNING id INTO v_doc_id;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description,
      source_type, source_id, currency, exchange_rate,
      total_debit, total_credit, created_by
    ) VALUES (
      v_company_id, v_entry_number, p_date,
      'Opening AR — ' || p_doc_number,
      'opening_balance', v_doc_id, p_currency, 1.0,
      p_amount, p_amount, v_user_id
    ) RETURNING id INTO v_je_id;

    -- Dr 1200 AR
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_ar_id, '1200', p_date,
       p_amount, 0, 'Opening AR — ' || p_doc_number,
       p_contact_id, 'invoice', v_doc_id);

    -- Cr 3010
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_ob_eq_id, '3010', p_date,
       0, p_amount, 'Opening AR — ' || p_doc_number,
       p_contact_id, 'invoice', v_doc_id);

  ELSIF p_type = 'ap_owed' THEN
    INSERT INTO public.vendor_bills (
      company_id, supplier_id, bill_number, date, due_date,
      currency, exchange_rate, status,
      subtotal, discount_amount, tax_amount, total_amount,
      notes, is_opening
    ) VALUES (
      v_company_id, p_contact_id, p_doc_number, p_date, p_due_date,
      p_currency, 1.0, 'confirmed',
      p_amount, 0, 0, p_amount,
      p_notes, true
    ) RETURNING id INTO v_doc_id;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description,
      source_type, source_id, currency, exchange_rate,
      total_debit, total_credit, created_by
    ) VALUES (
      v_company_id, v_entry_number, p_date,
      'Opening AP — ' || p_doc_number,
      'opening_balance', v_doc_id, p_currency, 1.0,
      p_amount, p_amount, v_user_id
    ) RETURNING id INTO v_je_id;

    -- Dr 3010
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_ob_eq_id, '3010', p_date,
       p_amount, 0, 'Opening AP — ' || p_doc_number,
       p_contact_id, 'vendor_bill', v_doc_id);

    -- Cr 2100 AP
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_ap_id, '2100', p_date,
       0, p_amount, 'Opening AP — ' || p_doc_number,
       p_contact_id, 'vendor_bill', v_doc_id);

  ELSIF p_type = 'customer_credit' THEN
    -- Customer has credit on file (overpaid us in the prior system).
    -- Record as a confirmed payment of classification 'advance' so it
    -- shows up as available credit in the existing Phase 12.24 / 14.08
    -- machinery (banner, apply modal, advance balance).
    INSERT INTO public.payments (
      company_id, contact_id, type, classification,
      payment_number, date, amount, currency, exchange_rate,
      bank_account_id, status, notes, is_opening
    ) VALUES (
      v_company_id, p_contact_id, 'inbound', 'advance',
      p_doc_number, p_date, p_amount, p_currency, 1.0,
      NULL, 'confirmed', p_notes, true
    ) RETURNING id INTO v_doc_id;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description,
      source_type, source_id, currency, exchange_rate,
      total_debit, total_credit, created_by
    ) VALUES (
      v_company_id, v_entry_number, p_date,
      'Opening customer credit — ' || p_doc_number,
      'opening_balance', v_doc_id, p_currency, 1.0,
      p_amount, p_amount, v_user_id
    ) RETURNING id INTO v_je_id;

    -- Dr 3010 (the opening equity side absorbs the credit)
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_ob_eq_id, '3010', p_date,
       p_amount, 0, 'Opening customer credit — ' || p_doc_number,
       p_contact_id, 'payment', v_doc_id);

    -- Cr 2400 Customer Advances
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_adv_cust_id, '2400', p_date,
       0, p_amount, 'Opening customer credit — ' || p_doc_number,
       p_contact_id, 'payment', v_doc_id);

  ELSE  -- vendor_credit
    -- We paid this supplier in advance / overpaid them in the prior
    -- system — they're carrying our credit. Record as a confirmed
    -- vendor payment of classification 'advance'.
    INSERT INTO public.payments (
      company_id, contact_id, type, classification,
      payment_number, date, amount, currency, exchange_rate,
      bank_account_id, status, notes, is_opening
    ) VALUES (
      v_company_id, p_contact_id, 'outbound', 'advance',
      p_doc_number, p_date, p_amount, p_currency, 1.0,
      NULL, 'confirmed', p_notes, true
    ) RETURNING id INTO v_doc_id;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description,
      source_type, source_id, currency, exchange_rate,
      total_debit, total_credit, created_by
    ) VALUES (
      v_company_id, v_entry_number, p_date,
      'Opening vendor credit — ' || p_doc_number,
      'opening_balance', v_doc_id, p_currency, 1.0,
      p_amount, p_amount, v_user_id
    ) RETURNING id INTO v_je_id;

    -- Dr 1400 Vendor Advances (asset — supplier owes us this credit)
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_adv_vend_id, '1400', p_date,
       p_amount, 0, 'Opening vendor credit — ' || p_doc_number,
       p_contact_id, 'payment', v_doc_id);

    -- Cr 3010
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_ob_eq_id, '3010', p_date,
       0, p_amount, 'Opening vendor credit — ' || p_doc_number,
       p_contact_id, 'payment', v_doc_id);
  END IF;

  -- Audit log — best-effort, never fail the post.
  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'post_opening_balance', 'journal_entry', v_je_id,
            jsonb_build_object(
              'type', p_type, 'amount', p_amount, 'date', p_date,
              'contact_id', p_contact_id, 'doc_number', p_doc_number,
              'doc_id', v_doc_id, 'entry_number', v_entry_number));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'type',             p_type,
    'doc_id',           v_doc_id,
    'doc_number',       p_doc_number,
    'journal_entry_id', v_je_id,
    'entry_number',     v_entry_number
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_opening_balance(
  TEXT, UUID, TEXT, DATE, DATE, NUMERIC, TEXT, TEXT
) TO authenticated;

COMMENT ON FUNCTION public.post_opening_balance IS
  'Phase 14.09 — posts one opening-balance row (AR/AP/customer-credit/'
  'vendor-credit) as its own JE keyed to the original document date, '
  'with the contra leg landing on 3010 Opening Balance Equity. Called '
  'in a loop from the /settings/opening-balances wizard.';

NOTIFY pgrst, 'reload schema';
