-- Fix: cast fiscal_year_start text to DATE in complete_onboarding.
-- The original migration passed the JSONB ->> text value directly into
-- a DATE column without an explicit cast, causing:
--   "column fiscal_year_start is of type date but expression is of type text"

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
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'complete_onboarding: not authenticated';
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'complete_onboarding: user already onboarded';
  END IF;

  SELECT au.email INTO v_email FROM auth.users au WHERE au.id = v_user_id;

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
    p_data ->> 'currency',
    (p_data ->> 'fiscal_year_start')::DATE,
    COALESCE((p_data ->> 'is_tax_registered')::BOOLEAN, FALSE),
    NULLIF(TRIM(p_data ->> 'tax_id'), ''),
    'mac'
  )
  RETURNING id INTO v_company_id;

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

REVOKE ALL ON FUNCTION public.complete_onboarding(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_onboarding(JSONB) TO authenticated;
