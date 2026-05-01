-- Phase 1 Migration 01: SECURITY DEFINER onboarding bootstrap function
--
-- Problem: the `companies` RLS policy (tenant_isolation) checks
-- `id = current_user_company_id()`, which reads from `profiles`. A brand-new
-- user has no profile, so current_user_company_id() = NULL and every INSERT
-- into `companies` is blocked. This is the classic chicken-and-egg: you need
-- a profile to create a company, but a company to create a profile.
--
-- Solution: this SECURITY DEFINER function runs as the DB owner, bypassing
-- RLS for the atomic company + profile creation. After it returns, the
-- caller's profile exists and all subsequent seed inserts (COA, tax_rates,
-- warehouses …) work normally via the anon key + RLS.

CREATE OR REPLACE FUNCTION public.complete_onboarding(p_data JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    UUID;
  v_company_id UUID;
  v_email      TEXT;
BEGIN
  -- Caller must be authenticated.
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'complete_onboarding: not authenticated';
  END IF;

  -- Idempotency guard: each auth user may only onboard once.
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'complete_onboarding: user already onboarded';
  END IF;

  -- Pull email from auth.users (only accessible at SECURITY DEFINER level).
  SELECT au.email INTO v_email FROM auth.users au WHERE au.id = v_user_id;

  -- 1. Create the company row.
  INSERT INTO public.companies (
    name,
    name_ar,
    address,
    country_code,
    currency,
    base_currency,
    fiscal_year_start,
    is_tax_registered,
    tax_id,
    costing_method
  ) VALUES (
    p_data ->> 'company_name',
    NULLIF(TRIM(p_data ->> 'company_name_ar'), ''),
    NULLIF(TRIM(p_data ->> 'address'), ''),
    p_data ->> 'country_code',
    p_data ->> 'currency',
    p_data ->> 'currency',    -- base_currency == currency for v1
    p_data ->> 'fiscal_year_start',
    COALESCE((p_data ->> 'is_tax_registered')::BOOLEAN, FALSE),
    NULLIF(TRIM(p_data ->> 'tax_id'), ''),
    'mac'                     -- Per Doc 3 Part O: MAC locked for v1
  )
  RETURNING id INTO v_company_id;

  -- 2. Create the profile row for this user.
  INSERT INTO public.profiles (
    id,
    company_id,
    full_name,
    email,
    role
  ) VALUES (
    v_user_id,
    v_company_id,
    COALESCE(NULLIF(TRIM(p_data ->> 'full_name'), ''), split_part(v_email, '@', 1)),
    v_email,
    'admin'
  );

  RETURN jsonb_build_object('company_id', v_company_id);
END;
$$;

-- Restrict to authenticated callers only.
REVOKE ALL ON FUNCTION public.complete_onboarding(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_onboarding(JSONB) TO authenticated;
