-- phase109b: the public anon key cannot execute the Finding E functions
--
-- WHY THIS FILE EXISTS
-- Finding E (docs/STOCKBOLT_SECURITY_INVESTIGATION_2026-11-01.md) was contained
-- in two steps on 2026-11-02. E2 is phase109. E1 - revoking EXECUTE from anon on
-- the eight affected SECURITY DEFINER functions - was run by hand in the SQL
-- editor before phase109 and so was never in a migration. This file records it,
-- so a database rebuilt from migrations (staging, disaster recovery) gets the
-- same grants as production, and so tests/unit/finding-e-definer-guards.test.ts
-- can check the repo states the intended grants.
--
-- Supabase's default privileges grant EXECUTE on every new public function to
-- anon explicitly. REVOKE ... FROM PUBLIC alone does not remove that grant, which
-- is how these functions stayed anon-callable after phase65.
--
-- DEPLOYMENT STATUS
--   * Section 1 (the eight E1 functions): ALREADY APPLIED on production
--     2026-11-02 and verified (anon_exec = false on all eight). Re-running is a
--     no-op.
--   * Section 2 (delete_bank_reconciliation): APPLIED on production 2026-11-02
--     ~21:40 IST and verified (anon_exec = false), after phase109 was
--     re-applied following the accidental rollback (see the security report).
--
-- Idempotent: REVOKE of a privilege that is not held is a no-op.
-- Rollback: GRANT EXECUTE ON FUNCTION <fn> TO anon - re-opens the unauthenticated
-- path; never needed by the web app or Android 1.0.3, which always call these
-- functions signed in.

BEGIN;

-- 1. E1 (applied 2026-11-02) ------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('search_contacts','search_products','get_daily_cash_report','get_bank_recon',
                        'save_bank_reconciliation','recompute_stock_valuation','seed_default_tax_rates',
                        'get_project_profitability')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, PUBLIC', r.sig);
  END LOOP;
END $$;

-- 2. delete_bank_reconciliation (NOT YET APPLIED) ----------------------------
REVOKE EXECUTE ON FUNCTION public.delete_bank_reconciliation(uuid) FROM anon, PUBLIC;

COMMIT;
