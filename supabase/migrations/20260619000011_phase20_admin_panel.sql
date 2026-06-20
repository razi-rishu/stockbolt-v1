-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 20: Platform Admin Panel (owner-only, cross-tenant)
-- ─────────────────────────────────────────────────────────────────────────
-- A SEPARATE admin surface for the platform owner only. It deliberately reads
-- ACROSS all tenants (bypassing the per-company RLS that protects customers),
-- so access is locked down two ways:
--   1. platform_admins(user_id) — the allow-list of platform owners. RLS is
--      enabled with NO policies, so the table is invisible to PostgREST; it is
--      only ever read inside SECURITY DEFINER functions.
--   2. get_admin_dashboard() is SECURITY DEFINER and RAISES unless the caller
--      is a platform admin — so even if a customer guesses the RPC name, it
--      refuses to return anything.
-- No tenant role ('admin','accountant',…) grants this; it is fully separate.
--
-- Stubbed (no data model yet — Phase 20b): subscription status, error logs,
-- support tickets. Returned as null so the UI shows "Not set up yet".
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────────

-- ── platform_admins allow-list ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: the table is only reachable via SECURITY DEFINER fns.

-- Seed the owner by email (safe to re-run).
INSERT INTO public.platform_admins (user_id)
SELECT id FROM auth.users WHERE lower(email) = lower('rashidpattaratil333@gmail.com')
ON CONFLICT (user_id) DO NOTHING;

-- ── is_platform_admin() — used by the RPC + (read) by the UI guard ───────
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid());
$$;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

-- ── get_admin_dashboard() — cross-tenant metrics, owner-only ─────────────
CREATE OR REPLACE FUNCTION public.get_admin_dashboard()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total_companies   BIGINT := 0;
  v_active_companies  BIGINT := 0;
  v_new_regs          BIGINT := 0;
  v_total_users       BIGINT := 0;
  v_total_invoices    BIGINT := 0;
  v_total_products    BIGINT := 0;
  v_db_bytes          BIGINT := 0;
  v_storage_bytes     BIGINT := 0;
  v_failed_logins     BIGINT := 0;
  v_recent            JSONB  := '[]'::jsonb;
BEGIN
  -- Hard gate: only platform owners may read cross-tenant data.
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'get_admin_dashboard: forbidden — platform admin only';
  END IF;

  SELECT COUNT(*) INTO v_total_companies FROM public.companies;
  SELECT COUNT(*) INTO v_new_regs        FROM public.companies WHERE created_at >= NOW() - INTERVAL '30 days';
  SELECT COUNT(*) INTO v_total_users     FROM public.profiles;
  SELECT COUNT(*) INTO v_total_invoices  FROM public.invoices;
  SELECT COUNT(*) INTO v_total_products  FROM public.products;

  -- Active = posted at least one journal entry in the last 30 days.
  SELECT COUNT(DISTINCT company_id) INTO v_active_companies
  FROM public.journal_entries
  WHERE created_at >= NOW() - INTERVAL '30 days';

  -- Recent registrations (last 8) with their user count.
  SELECT COALESCE(jsonb_agg(r ORDER BY r.created_at DESC), '[]'::jsonb) INTO v_recent
  FROM (
    SELECT c.id, c.name, c.created_at,
           (SELECT COUNT(*) FROM public.profiles p WHERE p.company_id = c.id) AS users
    FROM public.companies c
    ORDER BY c.created_at DESC
    LIMIT 8
  ) r;

  -- ── Infra metrics — best-effort; never fail the whole call ──
  BEGIN
    v_db_bytes := pg_database_size(current_database());
  EXCEPTION WHEN OTHERS THEN v_db_bytes := 0; END;

  BEGIN
    SELECT COALESCE(SUM((metadata->>'size')::BIGINT), 0) INTO v_storage_bytes
    FROM storage.objects;
  EXCEPTION WHEN OTHERS THEN v_storage_bytes := 0; END;

  BEGIN
    SELECT COUNT(*) INTO v_failed_logins
    FROM auth.audit_log_entries
    WHERE created_at >= NOW() - INTERVAL '30 days'
      AND (payload->>'action') IN ('login_failed','user_repeated_signup');
  EXCEPTION WHEN OTHERS THEN v_failed_logins := 0; END;

  RETURN jsonb_build_object(
    'total_companies',   v_total_companies,
    'active_companies',  v_active_companies,
    'new_registrations', v_new_regs,
    'total_users',       v_total_users,
    'total_invoices',    v_total_invoices,
    'total_products',    v_total_products,
    'database_bytes',    v_db_bytes,
    'storage_bytes',     v_storage_bytes,
    'failed_logins_30d', v_failed_logins,
    -- Phase 20b — not modelled yet; UI shows "Not set up yet".
    'subscription_status', NULL,
    'error_logs_count',    NULL,
    'support_tickets_open', NULL,
    'recent_companies',  v_recent,
    'generated_at',      to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_dashboard() TO authenticated;

COMMENT ON FUNCTION public.get_admin_dashboard IS
  'Platform-owner cross-tenant metrics. SECURITY DEFINER; raises unless the '
  'caller is in platform_admins. Not for tenant use.';
