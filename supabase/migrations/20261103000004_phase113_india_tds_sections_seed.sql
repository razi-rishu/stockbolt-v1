-- phase113: every India company gets the standard TDS sections
--
-- WHAT WENT WRONG
-- phase62 (AC-7A) seeded the six common TDS sections with a one-time
-- INSERT ... SELECT over the India companies that existed when it ran. Nothing
-- seeds them for an India company created later, so its TDS screen starts
-- empty and a TDS deduction has no section to pick. Found 2026-11-03 by the
-- TDS suite on local staging ("IN company has seeded TDS sections").
--
-- THE FIX
--  * seed_default_tds_sections(p_company_id): adds phase62's six sections,
--    with phase62's exact codes, descriptions, rates and thresholds, to an
--    India company, skipping any code it already has. Existing sections and
--    any rates a company edited are never touched. Non-India companies get
--    nothing. Trigger-only: EXECUTE is revoked from every client role, like
--    seed_default_tax_rates.
--  * A trigger on companies runs it after INSERT, and after UPDATE OF
--    country_code. phase111 lets a company switch to India before it is set
--    up, and it then gets the sections too.
--  * Backfill: every existing India company is passed through the same
--    function, which only adds codes that are missing.
--
-- No deletes, no updates to existing rows, no posting. Rollback:
-- supabase/manual-apply/phase113_rollback.sql (guarded; it keeps the seeded
-- rows, which may already be referenced by deductions).

BEGIN;

CREATE OR REPLACE FUNCTION public.seed_default_tds_sections(p_company_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_added integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id AND country_code = 'IN') THEN
    RETURN 0;
  END IF;
  INSERT INTO public.tds_sections
    (company_id, code, description, rate_individual, rate_other, single_threshold, annual_threshold)
  SELECT p_company_id, v.code, v.description, v.ri, v.ro, v.st, v.at
  FROM (VALUES
    ('194C', 'Payment to contractors',                  1.0,  2.0,  30000, 100000),
    ('194J', 'Professional / technical services',      10.0, 10.0,      0,  30000),
    ('194H', 'Commission or brokerage',                 2.0,  2.0,      0,  20000),
    ('194I', 'Rent — plant, machinery or equipment',    2.0,  2.0,      0, 240000),
    ('194IB','Rent — land, building or furniture',     10.0, 10.0,      0, 240000),
    ('194Q', 'Purchase of goods',                       0.1,  0.1,      0,5000000)
  ) AS v(code, description, ri, ro, st, at)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.tds_sections x WHERE x.company_id = p_company_id AND x.code = v.code
  );
  GET DIAGNOSTICS v_added = ROW_COUNT;
  RETURN v_added;
END;
$function$;

REVOKE ALL ON FUNCTION public.seed_default_tds_sections(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_seed_tds_sections()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.country_code = 'IN' THEN
    PERFORM public.seed_default_tds_sections(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_seed_tds_sections() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS companies_seed_tds_sections ON public.companies;
CREATE TRIGGER companies_seed_tds_sections
  AFTER INSERT OR UPDATE OF country_code ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.tg_seed_tds_sections();

-- Backfill: existing India companies get only the codes they are missing.
SELECT public.seed_default_tds_sections(c.id) FROM public.companies c WHERE c.country_code = 'IN';

COMMIT;
