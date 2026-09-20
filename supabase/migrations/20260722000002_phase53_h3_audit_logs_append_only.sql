-- ============================================================================
-- Phase 53 — Audit H3 (CORE)
-- Make public.audit_logs APPEND-ONLY for tenant users.
-- Replace the single FOR ALL (cmd=ALL) tenant_isolation policy with a
-- tenant-scoped SELECT policy + a tenant-scoped INSERT policy, and provide NO
-- UPDATE and NO DELETE policy so both are denied for non-BYPASSRLS roles.
-- ============================================================================
--
-- WHY
--   audit_logs currently carries one policy, tenant_isolation, with cmd = ALL.
--   Because "ALL" covers UPDATE and DELETE and `authenticated` holds the matching
--   table grants (and is not BYPASSRLS), any ordinary logged-in user can rewrite
--   or delete their own company's audit trail via PostgREST (PATCH / DELETE).
--   The one table that must be append-only is fully mutable. (Audit H3.)
--
-- WHAT THIS DOES
--   * Removes the over-broad FOR ALL policy on audit_logs.
--   * Adds a tenant-scoped SELECT policy  -> the Audit Log report and the
--     per-document Activity feed keep reading (getAuditLog / getEntityAuditLog).
--   * Adds a tenant-scoped INSERT policy  -> the posting engine keeps logging.
--     This is essential: the confirm_*/void_*/reopen_*/edit_*/post_* functions
--     are SECURITY INVOKER, so their audit_logs INSERT runs as `authenticated`
--     and IS subject to RLS. Denying INSERT would silently disable audit logging
--     (each insert is inside a best-effort BEGIN..EXCEPTION WHEN OTHERS block).
--   * Creates NO UPDATE policy and NO DELETE policy. With RLS enabled and no
--     permitting policy, UPDATE and DELETE are DENIED for authenticated / anon.
--     postgres and service_role (BYPASSRLS) retain UPDATE/DELETE, so the
--     SECURITY DEFINER reset_company_data (which deletes a company's audit_logs
--     on tenant reset) keeps working unchanged.
--
-- WHAT THIS DELIBERATELY DOES NOT DO (out of approved scope)
--   * No REVOKE of table grants (the optional defense-in-depth step is excluded).
--   * No FORCE ROW LEVEL SECURITY — it is a no-op here (the owner, postgres, is
--     BYPASSRLS, so FORCE would not reach it) and is intentionally omitted.
--   * No change to any posting RPC, trigger, report, UI, inventory or accounting
--     logic, or API.
--
-- SCOPE / RISK
--   Tier: CRITICAL (RLS policy on a financial table, hand-applied to live).
--   Table: public.audit_logs only. Additive-style policy replacement.
--   Idempotent: DROP POLICY IF EXISTS before each CREATE; safe to run twice.
--   Undo path: this is a policy replacement, not a data change — the "undo" is to
--     recreate the original policy (see the ROLLBACK block at the bottom). No row
--     is added, changed, or removed, so undo carries zero reconciliation risk.
--   The applied predicate uses current_user_company_id(), the same tenant helper
--     the previous policy used (unchanged).
-- ============================================================================

-- RLS is already enabled on audit_logs in production; this line is idempotent
-- safety so the policies below are always in force even if RLS were ever off.
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 1) Remove the over-broad FOR ALL policy (the UPDATE/DELETE tamper vector).
DROP POLICY IF EXISTS tenant_isolation ON public.audit_logs;

-- 2) Tenant-scoped SELECT (keeps the Audit Log report + Activity feed working).
--    Applies to PUBLIC, mirroring the prior policy's role targeting; anon still
--    matches no rows because current_user_company_id() is NULL for anon.
DROP POLICY IF EXISTS audit_logs_select ON public.audit_logs;
CREATE POLICY audit_logs_select ON public.audit_logs
  FOR SELECT
  USING (company_id = current_user_company_id());

-- 3) Tenant-scoped INSERT (keeps SECURITY INVOKER posting-engine logging working).
DROP POLICY IF EXISTS audit_logs_insert ON public.audit_logs;
CREATE POLICY audit_logs_insert ON public.audit_logs
  FOR INSERT
  WITH CHECK (company_id = current_user_company_id());

-- 4) No UPDATE policy and no DELETE policy are created — UPDATE and DELETE are
--    therefore denied for authenticated / anon (RLS with no permitting policy).

-- ----------------------------------------------------------------------------
-- ROLLBACK / UNDO (run manually only if this change must be reverted)
-- Recreates the exact prior policy read from live pg_policies before the change.
-- ----------------------------------------------------------------------------
--   DROP POLICY IF EXISTS audit_logs_select ON public.audit_logs;
--   DROP POLICY IF EXISTS audit_logs_insert ON public.audit_logs;
--   DROP POLICY IF EXISTS tenant_isolation  ON public.audit_logs;
--   CREATE POLICY tenant_isolation ON public.audit_logs
--     FOR ALL
--     USING (company_id = current_user_company_id())
--     WITH CHECK (company_id = current_user_company_id());
-- ----------------------------------------------------------------------------
