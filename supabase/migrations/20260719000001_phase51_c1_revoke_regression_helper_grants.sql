-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 51 (Audit C1): revoke EXECUTE on the regression test
-- helper from PUBLIC / anon / authenticated.
-- ─────────────────────────────────────────────────────────────────────────
-- Security fix for audit issue C1. public._regression_test_query(text) is a
-- SECURITY DEFINER helper used ONLY by the local regression suite, which calls
-- it as service_role. It was reachable by anon + authenticated, exposing an
-- arbitrary-SQL primitive over the public REST API (the anon key ships in the
-- browser bundle) → total cross-tenant read.
--
-- This removes ONLY those grants. It does not touch the function body, its
-- ownership (postgres), its signature, or its service_role/postgres EXECUTE
-- access — the regression suite and the live-def generator workflow (both
-- service_role) are unaffected.
--
-- Grant-only change: no schema, no data, no function body. REVOKE is
-- idempotent (revoking a privilege not held is a no-op), so this is safe to
-- re-run. Additive-safe: nothing is dropped or renamed.
-- ─────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public._regression_test_query(text)
  FROM PUBLIC, anon, authenticated;
