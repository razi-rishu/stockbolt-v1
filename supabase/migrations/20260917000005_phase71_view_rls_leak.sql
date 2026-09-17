-- ============================================================================
-- Phase 71 — CRITICAL: gl_active and stock_active leak every tenant's ledger
--
-- WHAT WAS WRONG
-- A Postgres view does NOT inherit row-level security from its base tables. By
-- default it runs with the VIEW OWNER's rights, so RLS on the underlying table
-- is bypassed entirely. Both views are owned by postgres, neither set
-- security_invoker, and both were granted SELECT to `anon`.
--
-- The anon key is public by design -- it ships inside the browser bundle. So
-- anyone who opened the deployed app could extract it and read these views.
--
-- Confirmed by querying with the anon key and no session:
--     gl_active     -> 336 general-ledger rows readable
--     stock_active  ->  55 stock rows readable, across 3 different companies
--     general_ledger (base table, control) -> 0 rows   <- RLS working correctly
--
-- The base tables were never exposed. Only the views bypassed them.
--
-- THE FIX
-- security_invoker = true makes the view run as the QUERYING user, so the base
-- tables' RLS applies normally: an authenticated user sees only their own
-- company, and anon sees nothing. The REVOKE is belt-and-braces -- with
-- security_invoker alone anon would already get zero rows, but nothing should
-- be reaching for these views unauthenticated in the first place.
--
-- BLAST RADIUS: NONE. Verified before writing -- no reference to either view in
-- src/data, src/modules, src/core or src/lib, and no database function depends
-- on them. Only the auto-generated database.ts types mention them, and those
-- are never called.
--
-- NO KEY ROTATION NEEDED. The anon key is meant to be public; security comes
-- from RLS. RLS was intact everywhere except these two views, so closing them
-- closes the hole.
--
-- Checked while here: every table in public has RLS enabled, and the anon
-- SELECT grants on tables are the standard Supabase pattern (grant broadly,
-- rely on RLS). The control test above proves those are held correctly.
--
-- Additive and idempotent. Safe to re-run.
-- ============================================================================

ALTER VIEW public.gl_active    SET (security_invoker = true);
ALTER VIEW public.stock_active SET (security_invoker = true);

REVOKE ALL ON public.gl_active    FROM anon;
REVOKE ALL ON public.stock_active FROM anon;
