-- ═══════════════════════════════════════════════════════════════════════════
-- phase142 — Platform Control Center: Overview (any date range) and
--            Businesses (filter, sort, page, drill-down)
--
-- Builds on phase141 (requires its _admin_gate() and _admin_accounts — apply
-- phase141 first). Three READ-ONLY functions, each SECURITY DEFINER, STABLE,
-- gated on platform_admins, EXECUTE revoked from anon:
--
--   admin_overview_range(p_from, p_to)
--       KPIs for any date range + the previous range of equal length, daily
--       series, nested funnel, countries, business types, plan mix, and
--       whether a billing provider is switched on (payment_provider_configs).
--   admin_businesses(search, filter, country, activities[], from, to,
--                    sort, dir, limit, offset)
--       Every company with owner, users, last activity, business type and
--       plan; whitelisted sort columns; plus summary counts.
--   admin_business_detail(p_company)
--       One company: owner (name + email), members (name, role, MASKED email,
--       last seen), usage counts, file storage used (when the storage schema
--       is present), 12-month activity series, setup and plan.
--
-- Privacy (requirement 11): member emails are masked (ra•••@gmail.com) in the
-- company view; only the owner's address is shown in full — the contact the
-- platform owner needs. No new data is collected or tracked: every figure is
-- derived from rows that already exist (companies, profiles, auth.users,
-- journal_entries, documents, subscriptions, company_configurations,
-- payment_provider_configs, storage.objects).
--
-- "Owner" = the company's earliest-created admin profile (there is no owner
-- column). "Active" = a journal entry created in the last 30 days.
--
-- SAFE TO APPLY: additive. Three new functions + one helper. Re-running is safe.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.admin_overview_range(date, date);
--   DROP FUNCTION IF EXISTS public.admin_businesses(text, text, text, text[], date, date, text, text, int, int);
--   DROP FUNCTION IF EXISTS public.admin_business_detail(uuid);
--   DROP FUNCTION IF EXISTS public._admin_mask_email(text);
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._admin_mask_email(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN p IS NULL OR position('@' in p) = 0 THEN p
              ELSE left(split_part(p, '@', 1), 2) || '•••@' || split_part(p, '@', 2) END;
$function$;

-- ── 1. Overview for any range ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_overview_range(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_to   date := LEAST(COALESCE(p_to, current_date), current_date);
  v_from date := COALESCE(p_from, v_to - 29);
  v_len  int;
  v jsonb;
BEGIN
  PERFORM public._admin_gate();
  IF v_from > v_to THEN v_from := v_to; END IF;
  IF v_to - v_from > 365 THEN v_from := v_to - 365; END IF;   -- daily series stays readable
  v_len := (v_to - v_from) + 1;

  WITH acc AS (SELECT * FROM public._admin_accounts),
  co AS (
    SELECT c.id, c.country_code, c.created_at,
           (SELECT max(je.created_at) FROM public.journal_entries je WHERE je.company_id = c.id) AS last_activity,
           cc.primary_activity_key, (cc.company_id IS NOT NULL) AS configured,
           s.status AS sub_status, s.provider, COALESCE(s.grandfathered, false) AS grandfathered
      FROM public.companies c
      LEFT JOIN public.company_configurations cc ON cc.company_id = c.id
      LEFT JOIN public.subscriptions s ON s.company_id = c.id
  ),
  billing AS (SELECT provider FROM public.payment_provider_configs WHERE is_active LIMIT 1)
  SELECT jsonb_build_object(
    'from', v_from, 'to', v_to, 'days', v_len,
    'billing', jsonb_build_object('configured', EXISTS (SELECT 1 FROM billing), 'provider', (SELECT provider FROM billing)),
    'kpis', jsonb_build_object(
      'signups_total',        (SELECT count(*) FROM acc),
      'signups_range',        (SELECT count(*) FROM acc WHERE created_at::date BETWEEN v_from AND v_to),
      'signups_prev_range',   (SELECT count(*) FROM acc WHERE created_at::date BETWEEN v_from - v_len AND v_from - 1),
      'signups_today',        (SELECT count(*) FROM acc WHERE created_at >= date_trunc('day', now())),
      'active_7d',            (SELECT count(*) FROM acc WHERE last_seen_at >= now() - interval '7 days'),
      'no_company',           (SELECT count(*) FROM acc WHERE company_id IS NULL),
      'unverified',           (SELECT count(*) FROM acc WHERE NOT verified),
      'companies_total',      (SELECT count(*) FROM co),
      'companies_range',      (SELECT count(*) FROM co WHERE created_at::date BETWEEN v_from AND v_to),
      'companies_prev_range', (SELECT count(*) FROM co WHERE created_at::date BETWEEN v_from - v_len AND v_from - 1),
      'companies_active_30d', (SELECT count(*) FROM co WHERE last_activity >= now() - interval '30 days'),
      'companies_not_configured', (SELECT count(*) FROM co WHERE NOT configured)
    ),
    'series', (SELECT COALESCE(jsonb_agg(jsonb_build_object('day', d::date,
                  'signups',   (SELECT count(*) FROM acc WHERE created_at::date = d::date),
                  'companies', (SELECT count(*) FROM co  WHERE created_at::date = d::date))
                ORDER BY d), '[]'::jsonb)
                FROM generate_series(v_from::timestamp, v_to::timestamp, interval '1 day') d),
    'funnel', (SELECT jsonb_build_object(
      'signed_up',  count(*),
      'verified',   count(*) FILTER (WHERE s1),
      'in_company', count(*) FILTER (WHERE s1 AND s2),
      'configured', count(*) FILTER (WHERE s1 AND s2 AND s3),
      'active_30d', count(*) FILTER (WHERE s1 AND s2 AND s3 AND s4),
      'paying',     count(*) FILTER (WHERE s1 AND s2 AND s3 AND s4 AND s5))
      FROM (SELECT a.verified AS s1, (a.company_id IS NOT NULL) AS s2, COALESCE(co.configured, false) AS s3,
                   COALESCE(a.last_seen_at >= now() - interval '30 days', false) AS s4,
                   COALESCE(co.sub_status = 'active' AND co.provider IN ('paypal', 'razorpay'), false) AS s5
              FROM acc a LEFT JOIN co ON co.id = a.company_id) f),
    'countries', (SELECT COALESCE(jsonb_agg(x ORDER BY x.n DESC), '[]'::jsonb) FROM
                   (SELECT COALESCE(country_code, '—') AS code, count(*) AS n FROM co GROUP BY 1 ORDER BY 2 DESC LIMIT 12) x),
    'industries', (SELECT COALESCE(jsonb_agg(x ORDER BY x.n DESC), '[]'::jsonb) FROM
                   (SELECT COALESCE(primary_activity_key, '_not_set') AS key, count(*) AS n FROM co GROUP BY 1 ORDER BY 2 DESC LIMIT 12) x),
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

-- ── 2. Businesses list ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_businesses(
  p_search text DEFAULT NULL, p_filter text DEFAULT 'all', p_country text DEFAULT NULL,
  p_activities text[] DEFAULT NULL, p_from date DEFAULT NULL, p_to date DEFAULT NULL,
  p_sort text DEFAULT 'created_at', p_dir text DEFAULT 'desc', p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_q    text := NULLIF(trim(COALESCE(p_search, '')), '');
  v_sort text := CASE WHEN p_sort IN ('name', 'created_at', 'users', 'last_activity', 'country_code') THEN p_sort ELSE 'created_at' END;
  v_asc  boolean := lower(COALESCE(p_dir, 'desc')) = 'asc';
  v jsonb;
BEGIN
  PERFORM public._admin_gate();
  WITH co AS (
    SELECT c.id, c.name, c.country_code, c.created_at,
           (SELECT count(*) FROM public.profiles p WHERE p.company_id = c.id) AS users,
           (SELECT max(je.created_at) FROM public.journal_entries je WHERE je.company_id = c.id) AS last_activity,
           (SELECT COALESCE(NULLIF(a.full_name, ''), a.email) FROM public._admin_accounts a
             WHERE a.company_id = c.id AND a.role = 'admin' ORDER BY a.created_at LIMIT 1) AS owner_name,
           cc.primary_activity_key, (cc.company_id IS NOT NULL) AS configured,
           s.status AS sub_status, s.provider, COALESCE(s.grandfathered, false) AS grandfathered, s.trial_end
      FROM public.companies c
      LEFT JOIN public.company_configurations cc ON cc.company_id = c.id
      LEFT JOIN public.subscriptions s ON s.company_id = c.id
  ), f AS (
    SELECT * FROM co
     WHERE (v_q IS NULL OR name ILIKE '%' || v_q || '%' OR owner_name ILIKE '%' || v_q || '%')
       AND (p_country IS NULL OR COALESCE(country_code, '—') = p_country)
       AND (p_activities IS NULL OR cardinality(p_activities) = 0 OR primary_activity_key = ANY (p_activities))
       AND (p_from IS NULL OR created_at::date >= p_from)
       AND (p_to IS NULL OR created_at::date <= p_to)
       AND CASE COALESCE(p_filter, 'all')
             WHEN 'active_30d'     THEN last_activity >= now() - interval '30 days'
             WHEN 'dormant'        THEN last_activity IS NULL OR last_activity < now() - interval '30 days'
             WHEN 'trial'          THEN sub_status = 'trialing'
             WHEN 'paying'         THEN sub_status = 'active' AND provider IN ('paypal', 'razorpay')
             WHEN 'not_configured' THEN NOT configured
             ELSE true END
  ), page AS (
    SELECT * FROM f
     ORDER BY
       CASE WHEN v_asc AND v_sort = 'name' THEN lower(name) END ASC,
       CASE WHEN NOT v_asc AND v_sort = 'name' THEN lower(name) END DESC,
       CASE WHEN v_asc AND v_sort = 'country_code' THEN country_code END ASC,
       CASE WHEN NOT v_asc AND v_sort = 'country_code' THEN country_code END DESC,
       CASE WHEN v_asc AND v_sort = 'users' THEN users END ASC,
       CASE WHEN NOT v_asc AND v_sort = 'users' THEN users END DESC,
       CASE WHEN v_asc AND v_sort = 'last_activity' THEN last_activity END ASC NULLS FIRST,
       CASE WHEN NOT v_asc AND v_sort = 'last_activity' THEN last_activity END DESC NULLS LAST,
       CASE WHEN v_asc AND v_sort = 'created_at' THEN created_at END ASC,
       CASE WHEN NOT v_asc AND v_sort = 'created_at' THEN created_at END DESC,
       id
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100) OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM f),
    'rows', (SELECT COALESCE(jsonb_agg(to_jsonb(page.*)), '[]'::jsonb) FROM page),
    'summary', jsonb_build_object(
      'total',          (SELECT count(*) FROM co),
      'active_30d',     (SELECT count(*) FROM co WHERE last_activity >= now() - interval '30 days'),
      'dormant',        (SELECT count(*) FROM co WHERE last_activity IS NULL OR last_activity < now() - interval '30 days'),
      'not_configured', (SELECT count(*) FROM co WHERE NOT configured),
      'trialing',       (SELECT count(*) FROM co WHERE sub_status = 'trialing'),
      'countries',      (SELECT COALESCE(jsonb_agg(DISTINCT COALESCE(country_code, '—')), '[]'::jsonb) FROM co))
  ) INTO v;
  RETURN v;
END;
$function$;

-- ── 3. One business ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_business_detail(p_company uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v jsonb;
  v_storage bigint;
  v_owner uuid;
BEGIN
  PERFORM public._admin_gate();
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company) THEN RETURN NULL; END IF;

  SELECT a.id INTO v_owner FROM public._admin_accounts a
   WHERE a.company_id = p_company AND a.role = 'admin' ORDER BY a.created_at LIMIT 1;

  -- File storage under the company's path ({bucket}/{company_id}/…). NULL when
  -- the storage schema is not present (e.g. a local database).
  BEGIN
    EXECUTE 'SELECT COALESCE(sum((metadata->>''size'')::bigint), 0) FROM storage.objects WHERE split_part(name, ''/'', 1) = $1'
      INTO v_storage USING p_company::text;
  EXCEPTION WHEN OTHERS THEN v_storage := NULL;
  END;

  SELECT jsonb_build_object(
    'company', jsonb_build_object('id', c.id, 'name', c.name, 'country_code', c.country_code,
                                  'currency', COALESCE(c.base_currency, c.currency), 'created_at', c.created_at,
                                  'legal_form', c.legal_form, 'city', c.city),
    'owner', (SELECT jsonb_build_object('name', a.full_name, 'email', a.email, 'last_seen_at', a.last_seen_at, 'provider', a.provider)
                FROM public._admin_accounts a WHERE a.id = v_owner),
    'members', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'name', a.full_name, 'email_masked', public._admin_mask_email(a.email), 'role', a.role,
                    'last_seen_at', a.last_seen_at, 'is_active', a.is_active, 'is_owner', a.id = v_owner)
                  ORDER BY (a.id = v_owner) DESC, a.created_at), '[]'::jsonb)
                  FROM public._admin_accounts a WHERE a.company_id = c.id),
    'counts', jsonb_build_object(
      'users',           (SELECT count(*) FROM public.profiles        WHERE company_id = c.id),
      'invoices',        (SELECT count(*) FROM public.invoices        WHERE company_id = c.id),
      'quotes',          (SELECT count(*) FROM public.sales_quotes    WHERE company_id = c.id),
      'bills',           (SELECT count(*) FROM public.vendor_bills    WHERE company_id = c.id),
      'payments',        (SELECT count(*) FROM public.payments        WHERE company_id = c.id),
      'products',        (SELECT count(*) FROM public.products        WHERE company_id = c.id),
      'contacts',        (SELECT count(*) FROM public.contacts        WHERE company_id = c.id),
      'journal_entries', (SELECT count(*) FROM public.journal_entries WHERE company_id = c.id)),
    'storage_bytes', v_storage,
    'last_activity', (SELECT max(created_at) FROM public.journal_entries WHERE company_id = c.id),
    'activity', (SELECT COALESCE(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM-01'),
                    'journal_entries', (SELECT count(*) FROM public.journal_entries je WHERE je.company_id = c.id
                                         AND je.created_at >= m AND je.created_at < m + interval '1 month'),
                    'invoices', (SELECT count(*) FROM public.invoices i WHERE i.company_id = c.id
                                  AND i.created_at >= m AND i.created_at < m + interval '1 month'))
                  ORDER BY m), '[]'::jsonb)
                  FROM generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m),
    'config', (SELECT jsonb_build_object('activities', cc.activity_keys, 'primary', cc.primary_activity_key,
                                         'modules', cc.enabled_modules, 'configured_at', cc.created_at)
                 FROM public.company_configurations cc WHERE cc.company_id = c.id),
    'subscription', (SELECT jsonb_build_object('status', s.status, 'provider', s.provider, 'cycle', s.billing_cycle,
                            'trial_end', s.trial_end, 'next_billing_date', s.next_billing_date, 'grandfathered', s.grandfathered)
                       FROM public.subscriptions s WHERE s.company_id = c.id),
    'billing', jsonb_build_object('configured', EXISTS (SELECT 1 FROM public.payment_provider_configs WHERE is_active))
  ) INTO v
  FROM public.companies c WHERE c.id = p_company;
  RETURN v;
END;
$function$;

REVOKE ALL ON FUNCTION public._admin_mask_email(text)                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_overview_range(date, date)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_businesses(text, text, text, text[], date, date, text, text, int, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_business_detail(uuid)             FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_overview_range(date, date)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_businesses(text, text, text, text[], date, date, text, text, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_business_detail(uuid)          TO authenticated;

COMMIT;

-- ── Verify after applying (read-only) ──────────────────────────────────────
-- SELECT count(*) FROM pg_proc WHERE proname IN ('admin_overview_range','admin_businesses','admin_business_detail'); -- expect 3
-- SELECT has_function_privilege('anon', 'public.admin_businesses(text,text,text,text[],date,date,text,text,int,int)', 'EXECUTE'); -- expect false
