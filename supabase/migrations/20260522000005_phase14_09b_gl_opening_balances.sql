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
