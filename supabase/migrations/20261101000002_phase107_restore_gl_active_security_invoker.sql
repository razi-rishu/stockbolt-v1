-- phase107: CRITICAL — restore security_invoker on gl_active
--
-- WHAT WENT WRONG
-- phase104 recreated gl_active with CREATE OR REPLACE VIEW in order to append
-- the project_id and reconciliation_id columns. CREATE OR REPLACE VIEW keeps a
-- view's GRANTS but RESETS its reloptions, so it silently discarded
--
--     security_invoker = true
--
-- which phase71 had set on this exact view, in a migration literally named
-- view_rls_leak. A Postgres view does not inherit row-level security from its
-- base tables: by default it runs with the VIEW OWNER's rights, and the owner
-- here is postgres, so RLS on general_ledger was bypassed entirely.
--
-- MEASURED, NOT ASSUMED, before writing this:
--
--     gl_active     reloptions = (none)                  <- the regression
--     stock_active  reloptions = security_invoker=true   <- untouched, fine
--     SELECT COUNT(*) FROM gl_active -> 456 rows across 4 companies
--     has_table_privilege('authenticated','gl_active','SELECT') -> true
--     has_table_privilege('anon','gl_active','SELECT')          -> false
--
-- BLAST RADIUS: authenticated cross-tenant read. Any signed-in user could
-- SELECT from gl_active and see every other company's general ledger. NOT
-- public: phase71's REVOKE ... FROM anon survived, because CREATE OR REPLACE
-- VIEW does not alter grants — so the anon key in the browser bundle could not
-- reach it. That is the one thing that keeps this off the internet.
--
-- NO KEY ROTATION NEEDED, for the same reason phase71 gave: the anon key is
-- public by design and security comes from RLS. anon never had access here.
--
-- THE FIX is one line. The tripwire that comes with it is the point: this is
-- the second time this view has lost its RLS, and the mechanism — a later
-- CREATE OR REPLACE quietly dropping reloptions — will keep working on anyone
-- who adds a column in future. A test now asserts both views carry
-- security_invoker, so stripping it fails the suite instead of shipping.
--
-- Additive and idempotent. Safe to re-run. Nothing is dropped or redefined —
-- deliberately NOT another CREATE OR REPLACE VIEW, since that is what caused
-- this; ALTER VIEW SET touches only the option.
--
-- UNDO PATH: none wanted. Reverting re-opens a cross-tenant read.

BEGIN;

-- 1. Close it -----------------------------------------------------------------
-- security_invoker = true makes the view run as the QUERYING user, so
-- general_ledger's own RLS applies: an authenticated user sees only their
-- company's rows and anon sees none.
ALTER VIEW public.gl_active SET (security_invoker = true);

-- stock_active still has it (phase104 never touched that view), but setting it
-- again costs nothing and means this file leaves BOTH views in a known state
-- rather than relying on a reader knowing which one was affected.
ALTER VIEW public.stock_active SET (security_invoker = true);

-- 2. Re-assert the grants phase71 set -----------------------------------------
-- These did survive, and are re-stated so the file is self-contained: a reader
-- restoring from migrations alone should not have to find phase71 to learn
-- that anon must not reach these views.
REVOKE ALL ON public.gl_active    FROM anon;
REVOKE ALL ON public.stock_active FROM anon;
GRANT SELECT ON public.gl_active    TO authenticated;
GRANT SELECT ON public.stock_active TO authenticated;

COMMENT ON VIEW public.gl_active IS
  'Active general-ledger rows: excludes both reversed entries and the '
  'reversals themselves. MUST keep security_invoker = true — without it the '
  'view runs as its owner (postgres) and bypasses general_ledger RLS, leaking '
  'every tenant''s ledger. Set by phase71, silently stripped by a '
  'CREATE OR REPLACE VIEW in phase104, restored here in phase107. If you add a '
  'column to this view, use CREATE OR REPLACE VIEW and then RE-SET the option, '
  'or the leak returns. A regression test asserts it.';

COMMIT;
