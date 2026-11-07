-- phase123 ROLLBACK - restores seed_default_tax_rates exactly as phase118 left it
-- (md5 32ca6cae...). Touches no rows: companies created meanwhile keep the
-- rates they were seeded with.

BEGIN;

CREATE OR REPLACE FUNCTION public.seed_default_tax_rates(p_company_id uuid, p_country text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN

  -- ---- Phase 65 (AC-V2) cross-tenant guard --------------------------------
  -- This function is SECURITY DEFINER, so it bypasses RLS. Without this check
  -- any authenticated user could pass another company's UUID and read or
  -- write that tenant's data.
  --
  -- Two deliberate carve-outs keep existing behaviour intact:
  --   * auth.uid() IS NULL  -> service_role / maintenance / the test harness
  --   * caller has no company yet -> onboarding, where seed_default_tax_rates
  --     runs from a trigger on companies INSERT before the profile is linked
  IF auth.uid() IS NOT NULL
     AND public.current_user_company_id() IS NOT NULL
     AND p_company_id IS DISTINCT FROM public.current_user_company_id() THEN
    RAISE EXCEPTION 'seed_default_tax_rates: cross-tenant access denied'
      USING ERRCODE = '42501';
  END IF;
  -- ---- end Phase 65 -------------------------------------------------------
  -- Never duplicate: only seed when this company has no tax rates at all.
  IF EXISTS (SELECT 1 FROM public.tax_rates WHERE company_id = p_company_id) THEN
    RETURN;
  END IF;

  IF upper(coalesce(p_country, '')) = 'IN' THEN
    INSERT INTO public.tax_rates (company_id, name, rate, tax_type, is_active) VALUES
      (p_company_id, 'GST 0%',  0,  'GST', true),
      (p_company_id, 'GST 5%',  5,  'GST', true),
      (p_company_id, 'GST 12%', 12, 'GST', true),
      (p_company_id, 'GST 18%', 18, 'GST', true),
      (p_company_id, 'GST 28%', 28, 'GST', true);
  ELSE
    INSERT INTO public.tax_rates (company_id, name, rate, tax_type, is_active) VALUES
      -- Phase 118 - tax_type is the product tax category (products.tax_category:
      -- standard / zero_rated / exempt), which is what the invoice, bill, PO and
      -- quote editors match on to pick a line's rate. 'VAT' / 'none' matched
      -- no product, so no rate was ever picked automatically.
      (p_company_id, 'Standard Rate 5%', 5, 'standard',   true),
      (p_company_id, 'Zero-rated 0%',    0, 'zero_rated', true),
      (p_company_id, 'Exempt',           0, 'exempt',     true);
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.seed_default_tax_rates(uuid, text) FROM PUBLIC, anon, authenticated;

COMMIT;
