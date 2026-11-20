-- ═══════════════════════════════════════════════════════════════════════════
-- phase141 — platform-owner insights: users, companies, sign-ups
--
-- The /admin page only had totals and the last 8 companies. The owner wants
-- to see every user and company, how sign-ups are trending, where people get
-- stuck, and to be alerted when someone new signs up. Five READ-ONLY functions:
--
--   admin_overview(p_days)        KPIs, daily sign-up series, funnel,
--                                 countries, business types, plan mix
--   admin_list_users(...)         every account (search, filter, page)
--   admin_list_companies(...)     every company (search, filter, page)
--   admin_company_detail(id)      one company: users, volumes, setup, plan
--   admin_recent_signups(since)   new accounts since a time (the bell alert)
--
-- All are SECURITY DEFINER (they read auth.users and every tenant) and every
-- one refuses unless the caller is signed in AND listed in platform_admins —
-- the same gate as get_admin_dashboard (phase20). EXECUTE is revoked from
-- PUBLIC and anon (Finding E rule) and granted to authenticated only; the gate
-- inside does the rest. Nothing is written.
--
-- SAFE TO APPLY: additive. Five new functions. Re-running is safe.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.admin_overview(int);
--   DROP FUNCTION IF EXISTS public.admin_list_users(text, text, int, int);
--   DROP FUNCTION IF EXISTS public.admin_list_companies(text, text, text, int, int);
--   DROP FUNCTION IF EXISTS public.admin_company_detail(uuid);
--   DROP FUNCTION IF EXISTS public.admin_recent_signups(timestamptz);
--   DROP FUNCTION IF EXISTS public._admin_gate();
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Gate ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._admin_gate()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden: platform admin only' USING ERRCODE = '42501';
  END IF;
END;
$function$;

-- One row per real account (no anonymous / deleted), with its profile & company.
CREATE OR REPLACE VIEW public._admin_accounts WITH (security_barrier = true) AS
SELECT u.id,
       u.email::text                                                AS email,
       COALESCE(p.full_name, u.raw_user_meta_data->>'full_name', '') AS full_name,
       u.created_at,
       GREATEST(u.last_sign_in_at, p.last_login_at)                 AS last_seen_at,
       (u.email_confirmed_at IS NOT NULL)                           AS verified,
       COALESCE(u.raw_app_meta_data->>'provider', 'email')          AS provider,
       p.company_id,
       p.role,
       COALESCE(p.is_active, true)                                  AS is_active
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
 WHERE u.deleted_at IS NULL AND COALESCE(u.is_anonymous, false) = false;
-- The view is only read inside the gated functions below.
REVOKE ALL ON public._admin_accounts FROM PUBLIC, anon, authenticated;

-- ── 1. Overview ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_overview(p_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_days  int := LEAST(GREATEST(COALESCE(p_days, 30), 7), 365);
  v_from  timestamptz := date_trunc('day', now()) - make_interval(days => v_days - 1);
  v jsonb;
BEGIN
  PERFORM public._admin_gate();

  WITH acc AS (SELECT * FROM public._admin_accounts),
  co AS (
    SELECT c.id, c.country_code, c.created_at,
           (SELECT max(je.created_at) FROM public.journal_entries je WHERE je.company_id = c.id) AS last_activity,
           cc.primary_activity_key, (cc.company_id IS NOT NULL) AS configured,
           s.status AS sub_status, s.provider, COALESCE(s.grandfathered, false) AS grandfathered
      FROM public.companies c
      LEFT JOIN public.company_configurations cc ON cc.company_id = c.id
      LEFT JOIN public.subscriptions s ON s.company_id = c.id
  )
  SELECT jsonb_build_object(
    'days', v_days,
    'kpis', jsonb_build_object(
      'signups_total',      (SELECT count(*) FROM acc),
      'signups_today',      (SELECT count(*) FROM acc WHERE created_at >= date_trunc('day', now())),
      'signups_7d',         (SELECT count(*) FROM acc WHERE created_at >= now() - interval '7 days'),
      'signups_period',     (SELECT count(*) FROM acc WHERE created_at >= v_from),
      'signups_prev_period',(SELECT count(*) FROM acc WHERE created_at >= v_from - make_interval(days => v_days) AND created_at < v_from),
      'active_7d',          (SELECT count(*) FROM acc WHERE last_seen_at >= now() - interval '7 days'),
      'no_company',         (SELECT count(*) FROM acc WHERE company_id IS NULL),
      'unverified',         (SELECT count(*) FROM acc WHERE NOT verified),
      'companies_total',    (SELECT count(*) FROM co),
      'companies_period',   (SELECT count(*) FROM co WHERE created_at >= v_from),
      'companies_active_30d',(SELECT count(*) FROM co WHERE last_activity >= now() - interval '30 days'),
      'companies_not_configured', (SELECT count(*) FROM co WHERE NOT configured)
    ),
    'series', (SELECT COALESCE(jsonb_agg(jsonb_build_object('day', d::date,
                  'signups',   (SELECT count(*) FROM acc WHERE created_at >= d AND created_at < d + interval '1 day'),
                  'companies', (SELECT count(*) FROM co  WHERE created_at >= d AND created_at < d + interval '1 day'))
                ORDER BY d), '[]'::jsonb)
                FROM generate_series(v_from, date_trunc('day', now()), interval '1 day') d),
    -- A true funnel: every step counts only people who also passed every earlier step.
    'funnel', (SELECT jsonb_build_object(
      'signed_up',  count(*),
      'verified',   count(*) FILTER (WHERE s1),
      'in_company', count(*) FILTER (WHERE s1 AND s2),
      'configured', count(*) FILTER (WHERE s1 AND s2 AND s3),
      'active_30d', count(*) FILTER (WHERE s1 AND s2 AND s3 AND s4),
      'paying',     count(*) FILTER (WHERE s1 AND s2 AND s3 AND s4 AND s5))
      FROM (SELECT a.verified AS s1,
                   (a.company_id IS NOT NULL) AS s2,
                   COALESCE(co.configured, false) AS s3,
                   COALESCE(a.last_seen_at >= now() - interval '30 days', false) AS s4,
                   COALESCE(co.sub_status = 'active' AND co.provider IN ('paypal', 'razorpay'), false) AS s5
              FROM acc a LEFT JOIN co ON co.id = a.company_id) f),
    'countries', (SELECT COALESCE(jsonb_agg(x ORDER BY x.n DESC), '[]'::jsonb) FROM
                   (SELECT COALESCE(country_code, '—') AS code, count(*) AS n FROM co GROUP BY 1 ORDER BY 2 DESC LIMIT 10) x),
    'industries', (SELECT COALESCE(jsonb_agg(x ORDER BY x.n DESC), '[]'::jsonb) FROM
                   (SELECT COALESCE(primary_activity_key, '_not_set') AS key, count(*) AS n FROM co GROUP BY 1 ORDER BY 2 DESC LIMIT 10) x),
    'plans', jsonb_build_object(
      'trialing',      (SELECT count(*) FROM co WHERE sub_status = 'trialing'),
      'paying',        (SELECT count(*) FROM co WHERE sub_status = 'active' AND provider IN ('paypal', 'razorpay')),
      'complimentary', (SELECT count(*) FROM co WHERE sub_status = 'active' AND (grandfathered OR provider = 'manual')),
      'at_risk',       (SELECT count(*) FROM co WHERE sub_status IN ('past_due', 'payment_failed', 'suspended')),
      'ended',         (SELECT count(*) FROM co WHERE sub_status IN ('cancelled', 'expired')),
      'none',          (SELECT count(*) FROM co WHERE sub_status IS NULL)
    ),
    'generated_at', now()
  ) INTO v;
  RETURN v;
END;
$function$;

-- ── 2. Users explorer ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_users(p_search text DEFAULT NULL, p_filter text DEFAULT 'all',
                                                   p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_q text := NULLIF(trim(COALESCE(p_search, '')), '');
  v jsonb;
BEGIN
  PERFORM public._admin_gate();
  WITH f AS (
    SELECT a.*, c.name AS company_name
      FROM public._admin_accounts a
      LEFT JOIN public.companies c ON c.id = a.company_id
     WHERE (v_q IS NULL OR a.email ILIKE '%' || v_q || '%' OR a.full_name ILIKE '%' || v_q || '%' OR c.name ILIKE '%' || v_q || '%')
       AND CASE COALESCE(p_filter, 'all')
             WHEN 'new_7d'       THEN a.created_at >= now() - interval '7 days'
             WHEN 'no_company'   THEN a.company_id IS NULL
             WHEN 'unverified'   THEN NOT a.verified
             WHEN 'active_7d'    THEN a.last_seen_at >= now() - interval '7 days'
             WHEN 'inactive_30d' THEN a.company_id IS NOT NULL AND (a.last_seen_at IS NULL OR a.last_seen_at < now() - interval '30 days')
             ELSE true END
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM f),
    'rows', (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC), '[]'::jsonb) FROM
              (SELECT id, email, full_name, created_at, last_seen_at, verified, provider, company_id, company_name, role, is_active
                 FROM f ORDER BY created_at DESC
                LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100) OFFSET GREATEST(COALESCE(p_offset, 0), 0)) r)
  ) INTO v;
  RETURN v;
END;
$function$;

-- ── 3. Companies explorer ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_companies(p_search text DEFAULT NULL, p_filter text DEFAULT 'all',
                                                       p_country text DEFAULT NULL, p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_q text := NULLIF(trim(COALESCE(p_search, '')), '');
  v jsonb;
BEGIN
  PERFORM public._admin_gate();
  WITH co AS (
    SELECT c.id, c.name, c.country_code, c.created_at,
           (SELECT count(*) FROM public.profiles p WHERE p.company_id = c.id) AS users,
           (SELECT max(je.created_at) FROM public.journal_entries je WHERE je.company_id = c.id) AS last_activity,
           cc.primary_activity_key, (cc.company_id IS NOT NULL) AS configured,
           s.status AS sub_status, s.provider, COALESCE(s.grandfathered, false) AS grandfathered, s.trial_end
      FROM public.companies c
      LEFT JOIN public.company_configurations cc ON cc.company_id = c.id
      LEFT JOIN public.subscriptions s ON s.company_id = c.id
  ), f AS (
    SELECT * FROM co
     WHERE (v_q IS NULL OR name ILIKE '%' || v_q || '%')
       AND (p_country IS NULL OR COALESCE(country_code, '—') = p_country)
       AND CASE COALESCE(p_filter, 'all')
             WHEN 'new_30d'        THEN created_at >= now() - interval '30 days'
             WHEN 'active_30d'     THEN last_activity >= now() - interval '30 days'
             WHEN 'dormant'        THEN last_activity IS NULL OR last_activity < now() - interval '30 days'
             WHEN 'trial'          THEN sub_status = 'trialing'
             WHEN 'paying'         THEN sub_status = 'active' AND provider IN ('paypal', 'razorpay')
             WHEN 'not_configured' THEN NOT configured
             ELSE true END
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM f),
    'rows', (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC), '[]'::jsonb) FROM
              (SELECT * FROM f ORDER BY created_at DESC
                LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100) OFFSET GREATEST(COALESCE(p_offset, 0), 0)) r)
  ) INTO v;
  RETURN v;
END;
$function$;

-- ── 4. One company ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_company_detail(p_company uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v jsonb;
BEGIN
  PERFORM public._admin_gate();
  SELECT jsonb_build_object(
    'company', jsonb_build_object('id', c.id, 'name', c.name, 'country_code', c.country_code,
                                  'currency', COALESCE(c.base_currency, c.currency), 'created_at', c.created_at),
    'users', (SELECT COALESCE(jsonb_agg(jsonb_build_object('email', a.email, 'full_name', a.full_name, 'role', a.role,
                       'last_seen_at', a.last_seen_at, 'is_active', a.is_active) ORDER BY a.created_at), '[]'::jsonb)
                FROM public._admin_accounts a WHERE a.company_id = c.id),
    'counts', jsonb_build_object(
      'invoices',  (SELECT count(*) FROM public.invoices     WHERE company_id = c.id),
      'bills',     (SELECT count(*) FROM public.vendor_bills WHERE company_id = c.id),
      'products',  (SELECT count(*) FROM public.products     WHERE company_id = c.id),
      'contacts',  (SELECT count(*) FROM public.contacts     WHERE company_id = c.id),
      'journal_entries', (SELECT count(*) FROM public.journal_entries WHERE company_id = c.id)),
    'last_activity', (SELECT max(created_at) FROM public.journal_entries WHERE company_id = c.id),
    'config', (SELECT jsonb_build_object('activities', cc.activity_keys, 'primary', cc.primary_activity_key,
                                         'modules', cc.enabled_modules)
                 FROM public.company_configurations cc WHERE cc.company_id = c.id),
    'subscription', (SELECT jsonb_build_object('status', s.status, 'provider', s.provider, 'cycle', s.billing_cycle,
                            'trial_end', s.trial_end, 'next_billing_date', s.next_billing_date, 'grandfathered', s.grandfathered)
                       FROM public.subscriptions s WHERE s.company_id = c.id)
  ) INTO v
  FROM public.companies c WHERE c.id = p_company;
  RETURN v;
END;
$function$;

-- ── 5. New sign-ups since a time (bell alert) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_recent_signups(p_since timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v jsonb;
BEGIN
  PERFORM public._admin_gate();
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'email', a.email, 'full_name', a.full_name,
                                              'created_at', a.created_at) ORDER BY a.created_at DESC), '[]'::jsonb)
    INTO v
    FROM (SELECT * FROM public._admin_accounts
           WHERE created_at >= GREATEST(COALESCE(p_since, now() - interval '7 days'), now() - interval '30 days')
           ORDER BY created_at DESC LIMIT 50) a;
  RETURN v;
END;
$function$;

-- ── Grants ─────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._admin_gate()                                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_overview(int)                             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_users(text, text, int, int)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_companies(text, text, text, int, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_company_detail(uuid)                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_recent_signups(timestamptz)               FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_overview(int)                             TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users(text, text, int, int)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_companies(text, text, text, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_company_detail(uuid)                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_recent_signups(timestamptz)               TO authenticated;

COMMIT;

-- ── Verify after applying (read-only) ──────────────────────────────────────
-- SELECT count(*) FROM pg_proc WHERE proname IN ('admin_overview','admin_list_users','admin_list_companies',
--        'admin_company_detail','admin_recent_signups','_admin_gate');                      -- expect 6
-- SELECT has_function_privilege('anon', 'public.admin_overview(int)', 'EXECUTE');           -- expect false
-- Your own login must be a platform owner for /admin to work:
-- SELECT u.email FROM public.platform_admins pa JOIN auth.users u ON u.id = pa.user_id;
