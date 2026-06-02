-- ═══════════════════════════════════════════════════════════════════════════
-- StockBolt — Phase 14.14f hotfix
-- Fix: opening-balance RPCs referenced non-existent columns padding_length /
--      allow_reset on document_sequences. The real columns are pad_zeros +
--      reset_yearly (both with DEFAULTs), so this hotfix drops them from the
--      INSERT entirely.
--
-- Error this fixes (seen by the operator on /settings/opening-balances):
--   openingBalances.postBank: column "padding_length" of relation
--                             "document_sequences" does not exist
--
-- HOW TO RUN
-- ──────────
-- 1. Supabase Dashboard → SQL Editor → New query
-- 2. Paste this entire file → click Run
-- 3. You should see "Success. No rows returned."
-- 4. Refresh /settings/opening-balances → click Post → it works now.
--
-- All three function bodies are CREATE OR REPLACE — re-running is safe.
-- ═══════════════════════════════════════════════════════════════════════════



-- ╔═══ 20260522000004_phase14_09_opening_balances.sql ═══╗

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
  -- Phase 14.14f fix: original column names `padding_length, allow_reset`
  -- don't exist on document_sequences. The real columns are `pad_zeros` +
  -- `reset_yearly`; both have DEFAULTs, so we just omit them.
  INSERT INTO public.document_sequences
    (company_id, prefix, current_value, format)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}')
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

-- ╔═══ 20260522000005_phase14_09b_gl_opening_balances.sql ═══╗

-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 14 — Migration 09b: GL Opening Balances
-- ─────────────────────────────────────────────────────────────────────────
-- Extends Phase 14.09 (which handled per-document subsidiary opening
-- balances: AR / AP / customer-credit / vendor-credit) with DIRECT GL
-- postings against any chart-of-accounts row. Needed for a complete
-- trial-balance migration:
--
--   • Cash on hand (1000)             Dr
--   • Bank balances (1100, 1110, …)   Dr
--   • Fixed assets (1500+)            Dr
--   • Accumulated depreciation (15xx) Cr (contra-asset)
--   • Long-term assets (1800+)        Dr
--   • Long-term liabilities (2500+)   Cr
--   • Owner's capital (3200)          Cr
--   • Retained earnings (3100)        Cr (or Dr if accumulated losses)
--
-- Each row posts a 2-line JE: Dr/Cr the target account + opposite leg
-- to 3010 Opening Balance Equity. After ALL opening balances (both
-- subsidiary 14.09 rows AND these GL rows) are entered, 3010 should
-- balance to ZERO — because the source system's trial balance was
-- already in equilibrium.
--
-- source_type = 'opening_gl' so listPosted can distinguish these from
-- the subsidiary opening JEs (source_type='opening_balance' from 14.09).
-- Both share the visual concept of "opening migration" but the wizard
-- shows them in separate sections.
--
-- No subsidiary doc is created — these JEs stand alone. Side effects
-- on other modules:
--   • Trial Balance, Balance Sheet, Cash Flow: pick up the new GL
--     balances automatically (they aggregate general_ledger).
--   • Bank reconciliation: if the target account is a bank's COA
--     account, the opening Dr balance shows up in the recon's
--     starting balance via the standard GL aggregation. The legacy
--     bank_accounts.opening_balance column stays separate and is
--     only used by the bank-accounts settings page.
--
-- Guardrails (enforced client-side, not in the RPC):
--   • Discourage posting GL openings to control accounts (1200 AR,
--     2100 AP, 2400 Customer Advances, 1400 Vendor Advances) —
--     those should go through the 14.09 subsidiary wizard so they
--     carry contact + aging detail. RPC accepts them anyway; UI
--     warns.
--   • Discourage Inventory (1300) — opening stock has its own
--     dedicated mechanism that handles MAC + stock_ledger. RPC
--     accepts; UI warns.
--
-- Phase tag `Phase 14.09b` appears in post_gl_opening_balance so the
-- regression suite can verify the function is installed.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.post_gl_opening_balance(
  p_account_id  UUID,
  p_direction   TEXT,
  p_amount      NUMERIC,
  p_date        DATE,
  p_notes       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
-- Phase 14.09b — GL opening balance posting.
DECLARE
  v_company_id    UUID;
  v_user_id       UUID;
  v_je_id         UUID;
  v_entry_number  TEXT;
  v_seq           INT;
  v_acct_code     TEXT;
  v_acct_name     TEXT;
  v_ob_eq_id      UUID;
  v_descr         TEXT;
BEGIN
  -- Resolve and validate the target account; gives us the company_id too.
  SELECT company_id, code, name
    INTO v_company_id, v_acct_code, v_acct_name
  FROM public.chart_of_accounts WHERE id = p_account_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Chart-of-accounts row % not found', p_account_id;
  END IF;

  v_user_id := auth.uid();

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Opening amount must be positive, got %', p_amount;
  END IF;
  IF p_direction NOT IN ('debit','credit') THEN
    RAISE EXCEPTION 'Direction must be debit or credit, got %', p_direction;
  END IF;
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'Opening date is required';
  END IF;

  -- The 3010 contra account — must exist (seeded by Phase 14.09).
  SELECT id INTO v_ob_eq_id FROM public.chart_of_accounts
   WHERE company_id = v_company_id AND code = '3010';
  IF v_ob_eq_id IS NULL THEN
    RAISE EXCEPTION '3010 Opening Balance Equity not seeded for this company';
  END IF;

  -- Reserve a JE number.
  -- Phase 14.14f fix: see note in 20260522000004; padding_length/allow_reset
  -- don't exist — using defaults via column omission instead.
  INSERT INTO public.document_sequences
    (company_id, prefix, current_value, format)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}')
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1,
        updated_at    = NOW()
  RETURNING current_value INTO v_seq;
  v_entry_number := 'JE-' || v_seq::TEXT;

  v_descr := 'Opening balance — ' || v_acct_code || ' ' || v_acct_name;

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, currency, exchange_rate,
    total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_entry_number, p_date,
    v_descr,
    'opening_gl', NULL, 'AED', 1.0,
    p_amount, p_amount, v_user_id
  ) RETURNING id INTO v_je_id;

  IF p_direction = 'debit' THEN
    -- Dr the target account, Cr 3010
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description)
    VALUES
      (v_company_id, v_je_id, p_account_id, v_acct_code, p_date,
       p_amount, 0, COALESCE(p_notes, v_descr));
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description)
    VALUES
      (v_company_id, v_je_id, v_ob_eq_id, '3010', p_date,
       0, p_amount, COALESCE(p_notes, v_descr));
  ELSE
    -- Cr the target account, Dr 3010
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description)
    VALUES
      (v_company_id, v_je_id, p_account_id, v_acct_code, p_date,
       0, p_amount, COALESCE(p_notes, v_descr));
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description)
    VALUES
      (v_company_id, v_je_id, v_ob_eq_id, '3010', p_date,
       p_amount, 0, COALESCE(p_notes, v_descr));
  END IF;

  -- Best-effort audit log.
  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'post_gl_opening_balance', 'journal_entry', v_je_id,
            jsonb_build_object(
              'account_code', v_acct_code, 'direction', p_direction,
              'amount', p_amount, 'date', p_date,
              'entry_number', v_entry_number));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'journal_entry_id', v_je_id,
    'entry_number',     v_entry_number,
    'account_code',     v_acct_code,
    'account_name',     v_acct_name,
    'direction',        p_direction,
    'amount',           p_amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_gl_opening_balance(
  UUID, TEXT, NUMERIC, DATE, TEXT
) TO authenticated;

COMMENT ON FUNCTION public.post_gl_opening_balance IS
  'Phase 14.09b — posts one direct-GL opening balance (Dr/Cr any CoA '
  'row, with the opposite leg landing on 3010 Opening Balance Equity). '
  'Used by the /settings/opening-balances wizard for fixed assets, '
  'long-term assets / liabilities, capital, and retained earnings.';

-- ── 3010 balance check helper ────────────────────────────────────────────
-- Returns the current net balance on 3010 for a company. Used by the
-- wizard's "3010 zero-check" indicator to tell the operator whether
-- their migration is complete (target = 0 after all openings entered).
CREATE OR REPLACE FUNCTION public.opening_balance_3010(p_company_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT COALESCE(SUM(debit - credit), 0)::NUMERIC
  FROM public.general_ledger gl
  WHERE gl.company_id = p_company_id
    AND gl.account_code = '3010';
$$;

GRANT EXECUTE ON FUNCTION public.opening_balance_3010(UUID) TO authenticated;

COMMENT ON FUNCTION public.opening_balance_3010 IS
  'Phase 14.09b — net balance of 3010 Opening Balance Equity. Should '
  'be zero after a complete migration. Non-zero means an opening row '
  'is missing or duplicated.';

NOTIFY pgrst, 'reload schema';

-- ╔═══ 20260523000001_phase14_09c_bank_opening_and_void.sql ═══╗

-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 14 — Migration 09c: Per-bank openings + void RPC
-- ─────────────────────────────────────────────────────────────────────────
-- Two improvements to the opening-balances wizard (14.09 + 14.09b):
--
-- 1. post_bank_opening_balance(...) — dedicated RPC for opening a SPECIFIC
--    bank account (chosen from bank_accounts, not the raw CoA picker).
--    Does three things atomically:
--      a) posts a 2-line JE to the bank's coa_account_id + 3010 contra
--      b) updates bank_accounts.opening_balance / opening_balance_date so
--         the bank reconciliation report and bank-accounts settings page
--         agree with the GL
--      c) tags the JE with source_type='opening_bank' so listPosted can
--         distinguish bank openings from generic GL openings
--
--    Without this, the operator either (i) had to manually edit
--    bank_accounts.opening_balance separately from posting a GL JE — two
--    sources of truth — or (ii) posted to the bank's CoA row but the
--    bank_accounts.opening_balance field stayed at zero, breaking the
--    reconciliation report.
--
-- 2. void_opening_balance(p_doc_id, p_doc_type) — corrects mistakes on a
--    posted opening row. Reverses the underlying JE (creates a mirror JE
--    with debit/credit flipped, links them via reversed_by_id) and marks
--    the source doc (invoice / vendor_bill / payment) status='void' so it
--    drops out of open-invoice / open-bill / advance lists. GL-only
--    openings (no source doc) just get the JE reversed.
--
--    Conservative by design: we never DELETE; the audit trail keeps both
--    the original and the reversal. The wizard's "Already posted" panel
--    will start excluding voided rows so the operator can re-post a
--    corrected entry without seeing the wrong one alongside.
--
-- Phase tag `Phase 14.09c` appears in both functions for the regression
-- suite.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. post_bank_opening_balance ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_bank_opening_balance(
  p_bank_account_id UUID,
  p_direction       TEXT,
  p_amount          NUMERIC,
  p_date            DATE,
  p_notes           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
-- Phase 14.09c — per-bank opening balance.
DECLARE
  v_company_id    UUID;
  v_user_id       UUID;
  v_bank_name     TEXT;
  v_coa_id        UUID;
  v_coa_code      TEXT;
  v_coa_name      TEXT;
  v_ob_eq_id      UUID;
  v_je_id         UUID;
  v_entry_number  TEXT;
  v_seq           INT;
  v_descr         TEXT;
BEGIN
  -- Resolve the bank — gives us company_id, the linked CoA row, and the
  -- bank's display name (for the JE description).
  SELECT b.company_id, b.name, b.coa_account_id, coa.code, coa.name
    INTO v_company_id, v_bank_name, v_coa_id, v_coa_code, v_coa_name
  FROM public.bank_accounts b
  JOIN public.chart_of_accounts coa ON coa.id = b.coa_account_id
  WHERE b.id = p_bank_account_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Bank account % not found', p_bank_account_id;
  END IF;

  v_user_id := auth.uid();

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Opening amount must be positive, got %', p_amount;
  END IF;
  IF p_direction NOT IN ('debit','credit') THEN
    RAISE EXCEPTION 'Direction must be debit or credit, got %', p_direction;
  END IF;
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'Opening date is required';
  END IF;

  -- 3010 contra (seeded by 14.09).
  SELECT id INTO v_ob_eq_id FROM public.chart_of_accounts
   WHERE company_id = v_company_id AND code = '3010';
  IF v_ob_eq_id IS NULL THEN
    RAISE EXCEPTION '3010 Opening Balance Equity not seeded for this company';
  END IF;

  -- JE number.
  -- Phase 14.14f fix: see note in 20260522000004; padding_length/allow_reset
  -- don't exist — using defaults via column omission instead.
  INSERT INTO public.document_sequences
    (company_id, prefix, current_value, format)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}')
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1,
        updated_at    = NOW()
  RETURNING current_value INTO v_seq;
  v_entry_number := 'JE-' || v_seq::TEXT;

  v_descr := 'Opening balance — ' || v_bank_name || ' (' || v_coa_code || ')';

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, currency, exchange_rate,
    total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_entry_number, p_date,
    v_descr,
    'opening_bank', p_bank_account_id, 'AED', 1.0,
    p_amount, p_amount, v_user_id
  ) RETURNING id INTO v_je_id;

  IF p_direction = 'debit' THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description)
    VALUES
      (v_company_id, v_je_id, v_coa_id, v_coa_code, p_date,
       p_amount, 0, COALESCE(p_notes, v_descr));
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description)
    VALUES
      (v_company_id, v_je_id, v_ob_eq_id, '3010', p_date,
       0, p_amount, COALESCE(p_notes, v_descr));
  ELSE
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description)
    VALUES
      (v_company_id, v_je_id, v_coa_id, v_coa_code, p_date,
       0, p_amount, COALESCE(p_notes, v_descr));
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description)
    VALUES
      (v_company_id, v_je_id, v_ob_eq_id, '3010', p_date,
       p_amount, 0, COALESCE(p_notes, v_descr));
  END IF;

  -- Sync the legacy column so the bank-accounts settings page + bank
  -- reconciliation report agree with the GL. The column is informational
  -- (reports aggregate general_ledger for the real balance), but keeping
  -- both in sync prevents operator confusion.
  UPDATE public.bank_accounts
     SET opening_balance      = CASE WHEN p_direction = 'debit'
                                     THEN p_amount ELSE -p_amount END,
         opening_balance_date = p_date,
         updated_at           = NOW()
   WHERE id = p_bank_account_id;

  -- Best-effort audit.
  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'post_bank_opening_balance', 'journal_entry', v_je_id,
            jsonb_build_object(
              'bank_account_id', p_bank_account_id, 'bank_name', v_bank_name,
              'coa_code', v_coa_code, 'direction', p_direction,
              'amount', p_amount, 'date', p_date,
              'entry_number', v_entry_number));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'journal_entry_id', v_je_id,
    'entry_number',     v_entry_number,
    'bank_account_id',  p_bank_account_id,
    'bank_name',        v_bank_name,
    'account_code',     v_coa_code,
    'direction',        p_direction,
    'amount',           p_amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_bank_opening_balance(
  UUID, TEXT, NUMERIC, DATE, TEXT
) TO authenticated;

COMMENT ON FUNCTION public.post_bank_opening_balance IS
  'Phase 14.09c — posts an opening balance against a SPECIFIC bank '
  'account (resolves to bank.coa_account_id), updates the bank''s '
  'opening_balance + opening_balance_date columns, and tags the JE '
  'with source_type=''opening_bank''.';


-- ── 2. void_opening_balance ─────────────────────────────────────────────
-- Corrects a mistake on a posted opening row. Reverses the underlying JE
-- and marks the source doc void so it stops affecting open-balance lists.
-- Accepts the doc_id + a doc_type discriminator so a single client call
-- can void any of the four shapes (invoice / vendor_bill / payment /
-- pure GL JE).
CREATE OR REPLACE FUNCTION public.void_opening_balance(
  p_doc_id    UUID,
  p_doc_type  TEXT,
  p_reason    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
-- Phase 14.09c — void an opening balance row.
DECLARE
  v_company_id   UUID;
  v_user_id      UUID;
  v_je_id        UUID;
  v_was_opening  BOOLEAN := false;
  v_bank_id      UUID;
  v_rev_result   JSONB;
BEGIN
  v_user_id := auth.uid();
  IF p_doc_type NOT IN ('invoice','vendor_bill','payment','opening_gl','opening_bank') THEN
    RAISE EXCEPTION 'void_opening_balance: invalid doc_type %', p_doc_type;
  END IF;

  -- Find the source JE for this doc + verify it's an opening row before
  -- we touch anything. void_opening_balance refuses to void non-opening
  -- documents — there are dedicated void_invoice / void_payment RPCs for
  -- those, with different side-effects (stock reversal, allocation
  -- unwinding, etc.) that don't apply to opening rows.
  IF p_doc_type = 'invoice' THEN
    SELECT company_id, is_opening INTO v_company_id, v_was_opening
    FROM public.invoices WHERE id = p_doc_id;
    SELECT id INTO v_je_id FROM public.journal_entries
     WHERE source_type = 'opening_balance' AND source_id = p_doc_id;
  ELSIF p_doc_type = 'vendor_bill' THEN
    SELECT company_id, is_opening INTO v_company_id, v_was_opening
    FROM public.vendor_bills WHERE id = p_doc_id;
    SELECT id INTO v_je_id FROM public.journal_entries
     WHERE source_type = 'opening_balance' AND source_id = p_doc_id;
  ELSIF p_doc_type = 'payment' THEN
    SELECT company_id, is_opening INTO v_company_id, v_was_opening
    FROM public.payments WHERE id = p_doc_id;
    SELECT id INTO v_je_id FROM public.journal_entries
     WHERE source_type = 'opening_balance' AND source_id = p_doc_id;
  ELSIF p_doc_type = 'opening_gl' THEN
    -- For pure-GL openings the doc_id IS the JE id.
    SELECT company_id INTO v_company_id
    FROM public.journal_entries WHERE id = p_doc_id AND source_type = 'opening_gl';
    v_je_id := p_doc_id;
    v_was_opening := v_je_id IS NOT NULL;
  ELSE  -- opening_bank
    SELECT id, source_id INTO v_je_id, v_bank_id
    FROM public.journal_entries WHERE id = p_doc_id AND source_type = 'opening_bank';
    SELECT company_id INTO v_company_id
    FROM public.journal_entries WHERE id = v_je_id;
    v_was_opening := v_je_id IS NOT NULL;
  END IF;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'void_opening_balance: doc % (%) not found', p_doc_id, p_doc_type;
  END IF;
  IF NOT v_was_opening THEN
    RAISE EXCEPTION 'void_opening_balance: doc % is not an opening row — '
      'use the regular void_invoice / void_payment RPC instead', p_doc_id;
  END IF;
  IF v_je_id IS NULL THEN
    RAISE EXCEPTION 'void_opening_balance: no JE linked to doc %', p_doc_id;
  END IF;

  -- Reverse the JE (creates a mirror entry with debit/credit flipped and
  -- links them via reversed_by_id). Errors propagate (period lock, etc.).
  v_rev_result := public.reverse_journal_entry(
    v_je_id,
    COALESCE('Void opening — ' || p_reason, 'Void opening balance')
  );

  -- Mark the source doc void so it drops out of open lists.
  IF p_doc_type = 'invoice' THEN
    UPDATE public.invoices
       SET status = 'void', void_reason = p_reason, voided_at = NOW(), voided_by = v_user_id,
           updated_at = NOW()
     WHERE id = p_doc_id;
  ELSIF p_doc_type = 'vendor_bill' THEN
    UPDATE public.vendor_bills
       SET status = 'void', void_reason = p_reason, voided_at = NOW(), voided_by = v_user_id,
           updated_at = NOW()
     WHERE id = p_doc_id;
  ELSIF p_doc_type = 'payment' THEN
    UPDATE public.payments
       SET status = 'void', void_reason = p_reason, voided_at = NOW(), voided_by = v_user_id,
           updated_at = NOW()
     WHERE id = p_doc_id;
  ELSIF p_doc_type = 'opening_bank' AND v_bank_id IS NOT NULL THEN
    -- Reset the bank's legacy opening_balance column so the bank-accounts
    -- page reverts to zero (the operator can re-post a corrected entry).
    UPDATE public.bank_accounts
       SET opening_balance = 0, opening_balance_date = NULL, updated_at = NOW()
     WHERE id = v_bank_id;
  END IF;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'void_opening_balance', 'journal_entry', v_je_id,
            jsonb_build_object('doc_type', p_doc_type, 'doc_id', p_doc_id,
                               'reason', p_reason, 'reversal', v_rev_result));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'doc_id',           p_doc_id,
    'doc_type',         p_doc_type,
    'journal_entry_id', v_je_id,
    'reversal',         v_rev_result
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.void_opening_balance(UUID, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.void_opening_balance IS
  'Phase 14.09c — voids one opening-balance row by reversing its JE and '
  'marking the source doc void. Refuses to void non-opening documents '
  '(those have their own void_* RPCs with stock/allocation side-effects).';

NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════════════
-- Refresh PostgREST so the corrected RPCs are immediately callable.
-- ═══════════════════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';
