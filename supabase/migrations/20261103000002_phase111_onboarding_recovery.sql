-- phase111: complete_onboarding never inserts a NULL name, explains a dead
-- session, and can be retried safely
--
-- WHAT WENT WRONG (production, 2026-11-03)
-- A user picked UAE instead of India, the operator deleted their account, and
-- they signed up again. Onboarding then failed with
--   null value in column "full_name" of relation "profiles"
-- The web wizard always sends full_name = '' and the function falls back to
-- the email's local part, which it reads from auth.users by auth.uid(). A
-- session that outlives its deleted Auth user (the token stays valid until it
-- expires) finds no auth.users row, so the email, and the name, are NULL.
-- Reproduced on local staging. The function is one transaction, so nothing
-- partial was left behind.
--
-- A second failure, "Failed to fetch", is a lost network response. If the
-- server had already committed, the retry hit "user already onboarded"
-- forever, while seeding (chart of accounts, tax rates, ...) had never run.
--
-- THE FIX (same signature and return shape, plus two new keys)
--  * No auth.users row for the caller: raise 28000 'account_not_found' with
--    instructions to sign out and back in. Nothing is inserted.
--  * Name: the wizard's full_name, then the Auth metadata (full_name, or
--    first + last, which register.tsx stores), then the email's local part.
--    If all are empty, raise 22023 'full_name_required'. No NULL, no made-up
--    name.
--  * Retry: an admin whose profile and company already exist gets
--    {company_id, resumed: true} instead of an error, so the app can finish
--    the setup steps that never ran. The function never creates a second
--    company for the same user.
--  * Country correction before activation: on a resumed call, the company's
--    country, currency and fiscal year are updated ONLY while it has no chart
--    of accounts, no journal entries, no invoices and no stock movements. Its
--    trigger-seeded default tax rates are re-seeded for the new country.
--    Once any of those exist, the country is never changed here.
--  * Grants: EXECUTE for authenticated only (it already refused anon at run
--    time; this is phase109b's rule).
--
-- Rollback: supabase/manual-apply/phase111_rollback.sql (guarded).

BEGIN;

CREATE OR REPLACE FUNCTION public.complete_onboarding(p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id    uuid;
  v_company_id uuid;
  v_email      text;
  v_meta       jsonb;
  v_name       text;
  v_role       text;
  v_country    text;
  v_set_up     boolean;
  v_updated    boolean := false;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'complete_onboarding: not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT au.email, au.raw_user_meta_data INTO v_email, v_meta FROM auth.users au WHERE au.id = v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'complete_onboarding: account_not_found: this sign-in belongs to an account that no longer exists. Sign out, then sign in again.'
      USING ERRCODE = '28000';
  END IF;

  -- Retry / resume: never a second company for the same user.
  SELECT company_id, role INTO v_company_id, v_role FROM public.profiles WHERE id = v_user_id;
  IF FOUND THEN
    IF v_company_id IS NULL OR v_role IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'complete_onboarding: user already onboarded';
    END IF;
    SELECT country_code INTO v_country FROM public.companies WHERE id = v_company_id;
    v_set_up := EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE company_id = v_company_id)
             OR EXISTS (SELECT 1 FROM public.journal_entries   WHERE company_id = v_company_id)
             OR EXISTS (SELECT 1 FROM public.invoices          WHERE company_id = v_company_id)
             OR EXISTS (SELECT 1 FROM public.stock_ledger      WHERE company_id = v_company_id);
    IF NOT v_set_up AND (p_data ->> 'country_code') IS NOT NULL AND (p_data ->> 'country_code') IS DISTINCT FROM v_country THEN
      UPDATE public.companies SET
        name              = COALESCE(NULLIF(TRIM(p_data ->> 'company_name'), ''), name),
        country_code      = p_data ->> 'country_code',
        currency          = p_data ->> 'currency',
        base_currency     = p_data ->> 'currency',
        fiscal_year_start = (p_data ->> 'fiscal_year_start')::date,
        is_tax_registered = COALESCE((p_data ->> 'is_tax_registered')::boolean, is_tax_registered),
        tax_id            = NULLIF(TRIM(p_data ->> 'tax_id'), '')
      WHERE id = v_company_id;
      -- The company trigger seeded tax rates for the old country; nothing uses them yet.
      DELETE FROM public.tax_rates WHERE company_id = v_company_id;
      PERFORM public.seed_default_tax_rates(v_company_id, p_data ->> 'country_code');
      v_updated := true;
    END IF;
    RETURN jsonb_build_object('company_id', v_company_id, 'resumed', true, 'country_updated', v_updated);
  END IF;

  v_name := COALESCE(
    NULLIF(TRIM(p_data ->> 'full_name'), ''),
    NULLIF(TRIM(v_meta ->> 'full_name'), ''),
    NULLIF(TRIM(concat_ws(' ', NULLIF(TRIM(v_meta ->> 'first_name'), ''), NULLIF(TRIM(v_meta ->> 'last_name'), ''))), ''),
    NULLIF(split_part(COALESCE(v_email, ''), '@', 1), '')
  );
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'complete_onboarding: full_name_required: enter your name to continue.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.companies (
    name, name_ar, address, country_code, currency, base_currency,
    fiscal_year_start, is_tax_registered, tax_id, costing_method
  ) VALUES (
    p_data ->> 'company_name',
    NULLIF(TRIM(p_data ->> 'company_name_ar'), ''),
    NULLIF(TRIM(p_data ->> 'address'), ''),
    p_data ->> 'country_code',
    p_data ->> 'currency',
    p_data ->> 'currency',
    (p_data ->> 'fiscal_year_start')::date,
    COALESCE((p_data ->> 'is_tax_registered')::boolean, false),
    NULLIF(TRIM(p_data ->> 'tax_id'), ''),
    'mac'
  )
  RETURNING id INTO v_company_id;

  INSERT INTO public.profiles (id, company_id, full_name, email, role)
  VALUES (v_user_id, v_company_id, v_name, v_email, 'admin');

  RETURN jsonb_build_object('company_id', v_company_id, 'resumed', false, 'country_updated', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_onboarding(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_onboarding(jsonb) TO authenticated, service_role;

COMMIT;
