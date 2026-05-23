-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 14.13g — back-fill bank_accounts for orphan sub-CoAs
-- ─────────────────────────────────────────────────────────────────────────
-- Background:
--
--   The operator added sub-CoA rows like "1111 ADCB" and "1112 IDBI"
--   under 1110 Bank Account (Main) BEFORE Phase 14.13d shipped the
--   quick-create flow that mirrors each new sub-CoA into bank_accounts.
--   Result: those CoA rows exist, but no matching bank_accounts row
--   exists, so they don't appear in any payment / expense / bank-transfer
--   picker. The operator only sees the unrelated "Rashid" left over
--   from early testing.
--
-- What this migration does:
--
--   For every chart_of_accounts row where:
--     - is_system = false
--     - parent_id IS NOT NULL
--     - the parent row has code '1110' or '1100' (Bank Main / Cash in Hand)
--     - no bank_accounts row points at it via coa_account_id
--   …insert a bank_accounts row. Account_type is inferred from the
--   parent code (1100 → cash, 1110 → bank). Currency defaults to
--   companies.currency_code if set, otherwise AED (the StockBolt seed
--   default for the GCC market). is_default stays false to preserve
--   any existing default the operator picked; is_active mirrors the
--   CoA row's is_active.
--
-- Idempotency:
--
--   The NOT EXISTS guard makes this safe to re-run. If the operator
--   later adds 1113 NBF and runs `supabase db push` again (no-op for
--   already-applied migrations), nothing changes. The fix-up only
--   applies during this one apply.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_inserted INT;
BEGIN
  WITH ins AS (
    INSERT INTO public.bank_accounts (
      company_id,
      coa_account_id,
      account_type,
      name,
      name_ar,
      currency,
      is_active,
      is_default,
      opening_balance
    )
    SELECT
      c.company_id,
      c.id,
      CASE WHEN p.code = '1100' THEN 'cash' ELSE 'bank' END,
      c.name,
      c.name_ar,
      COALESCE(
        (SELECT NULLIF(co.base_currency, '') FROM public.companies co WHERE co.id = c.company_id),
        'AED'
      ),
      COALESCE(c.is_active, true),
      false,
      0
    FROM public.chart_of_accounts c
    JOIN public.chart_of_accounts p ON p.id = c.parent_id
    WHERE c.is_system = false
      AND p.code IN ('1110', '1100')
      AND NOT EXISTS (
        SELECT 1 FROM public.bank_accounts ba
        WHERE ba.coa_account_id = c.id
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;

  RAISE NOTICE 'Phase 14.13g back-fill: inserted % bank_accounts row(s) for orphan sub-CoAs under 1110/1100.', v_inserted;
END $$;
