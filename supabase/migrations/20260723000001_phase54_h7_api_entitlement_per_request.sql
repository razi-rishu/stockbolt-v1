-- ============================================================================
-- Phase 54 — Audit H7-P1
-- Per-request API entitlement: a company_id-parameterized company_has_api_access.
-- ============================================================================
--
-- WHY
--   The public API Edge Function authenticates by API KEY (service_role client,
--   no user JWT), so auth.uid() is NULL there. The existing zero-arg
--   public.company_has_api_access() resolves the company via
--   current_user_company_id() = profiles.company_id WHERE id = auth.uid(), so it
--   returns FALSE in the API context and cannot be reused (it would deny every
--   request). This adds an OVERLOAD that takes the key's company_id explicitly so
--   authenticate() can re-check entitlement on every request (Audit H7).
--
-- WHAT
--   public.company_has_api_access(p_company_id uuid) -> boolean, applying the
--   SAME entitlement rule as the zero-arg version (single source of truth):
--     an active/trialing OR grandfathered subscription on a plan with api_access.
--   The existing zero-arg function is left UNTOUCHED. No key creation, UI, or
--   subscription logic changes.
--
-- SECURITY
--   SECURITY DEFINER, search_path pinned. Because it takes an arbitrary
--   company_id, EXECUTE is revoked from PUBLIC/anon/authenticated (a tenant must
--   not probe another tenant's entitlement) and granted ONLY to service_role —
--   the role the Edge Function uses.
--
-- SAFETY
--   Additive + idempotent (CREATE OR REPLACE; distinct signature from the zero-arg
--   overload). No data change. Verified read-only before delivery: the query
--   returns TRUE for the one live key's company and FALSE for a non-entitled id.
--
-- APPLY BY HAND in the Supabase SQL Editor (plain statements; no CONCURRENTLY).
-- ROLLBACK:  DROP FUNCTION IF EXISTS public.company_has_api_access(uuid);
-- ============================================================================

CREATE OR REPLACE FUNCTION public.company_has_api_access(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.subscriptions s
    JOIN public.subscription_plans p ON p.id = s.plan_id
    WHERE s.company_id = p_company_id
      AND (s.status IN ('active','trialing') OR s.grandfathered = TRUE)
      AND COALESCE((p.features ->> 'api_access')::boolean, FALSE) = TRUE
  );
$$;

REVOKE ALL     ON FUNCTION public.company_has_api_access(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.company_has_api_access(uuid) TO service_role;
