-- global01: persist the Global v1 company configuration (DRAFT — NOT APPLIED)
--
-- StockBolt Global Architecture v1.0, Phases 1 and 5. Stores what the
-- configuration engine (src/core/global-config) decided for a company: its
-- business activities and its enabled modules.
--
-- DESIGN
--  * One row per company, keyed by company_id (one legal entity per workspace).
--  * NO ROW = LEGACY. Every existing company has no row and keeps exactly what
--    it has today: the app reads a missing row as legacyConfiguration() (every
--    current module on, Projects following companies.projects_enabled). There
--    is no backfill and no change to existing data.
--  * The country is NOT stored here: companies.country_code stays the single
--    source of truth.
--  * Writes go only through save_company_configuration(). Clients get SELECT
--    for their own company and no INSERT/UPDATE/DELETE grant (the Finding C
--    lesson: no direct table writes). The function takes no company id: it
--    always writes the caller's own company, so there is no cross-tenant
--    parameter to guard.
--  * The function checks what the database can check: it needs settings.write,
--    the activity/module keys must be well formed, the three essential modules
--    must be on, there are at most 10 activities, and the primary activity is
--    one of them. The engine in the app does the recommendation logic.
--
-- Applies to LOCAL STAGING first. Production needs separate approval.
-- Rollback: the commented block at the end.

BEGIN;

CREATE TABLE IF NOT EXISTS public.company_configurations (
  company_id            uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  taxonomy_version      text        NOT NULL,
  activity_keys         text[]      NOT NULL,
  primary_activity_key  text        NOT NULL,
  enabled_modules       text[]      NOT NULL,
  configured_by         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_configurations_activities_ck
    CHECK (cardinality(activity_keys) BETWEEN 1 AND 10 AND primary_activity_key = ANY (activity_keys)),
  CONSTRAINT company_configurations_essentials_ck
    CHECK (enabled_modules @> ARRAY['accounting', 'contacts', 'banking']::text[])
);

CREATE TRIGGER company_configurations_set_updated_at
  BEFORE UPDATE ON public.company_configurations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.company_configurations ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON public.company_configurations
  FOR SELECT TO authenticated
  USING (company_id = public.current_user_company_id());

-- Reads for the company's own users; writes only through the function below.
REVOKE ALL ON public.company_configurations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.company_configurations TO authenticated;
GRANT ALL ON public.company_configurations TO service_role;

CREATE OR REPLACE FUNCTION public.save_company_configuration(
  p_taxonomy_version     text,
  p_activity_keys        text[],
  p_primary_activity_key text,
  p_enabled_modules      text[]
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_company uuid;
BEGIN
  -- Signed-in users only, permission first: a refused caller learns nothing.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'forbidden: sign in required' USING ERRCODE = '42501';
  END IF;
  PERFORM public.auth_require('settings.write');
  v_company := public.current_user_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'forbidden: no company' USING ERRCODE = '42501';
  END IF;

  IF p_taxonomy_version IS NULL OR p_taxonomy_version !~ '^[a-z0-9._-]{1,40}$' THEN
    RAISE EXCEPTION 'invalid taxonomy version' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_activity_keys || p_enabled_modules) k WHERE k !~ '^[a-z][a-z0-9_]{0,59}$') THEN
    RAISE EXCEPTION 'invalid activity or module key' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) <> count(DISTINCT k) FROM unnest(p_activity_keys) k) THEN
    RAISE EXCEPTION 'duplicate activity' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.company_configurations
    (company_id, taxonomy_version, activity_keys, primary_activity_key, enabled_modules, configured_by)
  VALUES (v_company, p_taxonomy_version, p_activity_keys, p_primary_activity_key,
          ARRAY(SELECT DISTINCT unnest(p_enabled_modules) ORDER BY 1), auth.uid())
  ON CONFLICT (company_id) DO UPDATE SET
    taxonomy_version     = EXCLUDED.taxonomy_version,
    activity_keys        = EXCLUDED.activity_keys,
    primary_activity_key = EXCLUDED.primary_activity_key,
    enabled_modules      = EXCLUDED.enabled_modules,
    configured_by        = EXCLUDED.configured_by;
  -- The CHECK constraints reject <1 or >10 activities, a primary that isn't
  -- selected, and missing essential modules.
END;
$function$;

-- Supabase's default privileges grant EXECUTE to anon on new functions; take it back.
REVOKE ALL ON FUNCTION public.save_company_configuration(text, text[], text, text[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_company_configuration(text, text[], text, text[]) TO authenticated;

COMMIT;

-- ── Rollback (dev/staging) ──────────────────────────────────────────────────
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.save_company_configuration(text, text[], text, text[]);
-- DROP TABLE IF EXISTS public.company_configurations;
-- COMMIT;
