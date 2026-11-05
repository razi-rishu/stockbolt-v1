-- phase118: one tax-rate seed per company, typed by product tax category
--
-- WHAT WENT WRONG
-- A new company got its tax rates from two places. The trigger on companies
-- (phase21, seed_default_tax_rates) inserted 'Standard Rate 5%', 'Zero-rated
-- 0%' and 'Exempt'; then the browser's onboarding seed (seedTaxRates) inserted
-- 'UAE VAT 5%' as well. Every UAE company has had two 5% rates since phase21
-- (India: duplicate GST 5/12/18%). The trigger also typed the rates 'VAT' and
-- 'none', but documents pick a line's rate by matching tax_type to the
-- product's tax_category (standard / zero_rated / exempt), so on those
-- companies no rate was ever picked automatically.
--
-- THE FIX
--  * seed_default_tax_rates stays the single source of a new company's rates
--    and now types the non-India set by product tax category. India's GST
--    set is unchanged.
--  * The browser seed no longer inserts a second set: it links the existing
--    rates to the tax accounts (1500/2200; India 1510/2210, IGST 1530/2230)
--    and adds only India's IGST 18%. That code also understands the old
--    'VAT' rows, so it creates no duplicate before or after this migration.
--
-- Rates stay 5% for every non-India country exactly as before (correcting
-- Saudi 15% / Bahrain 10% / no VAT in Kuwait and Qatar is a separate,
-- approval-gated change). Existing companies are NOT changed: no rows are
-- updated or deleted. Body = live definition (phase65 guard kept) plus the
-- marked block; grants are kept by CREATE OR REPLACE.
-- Rollback: supabase/manual-apply/phase118_rollback.sql (guarded).

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

-- Trigger-only (Finding E): no client may call the seed directly.
REVOKE ALL ON FUNCTION public.seed_default_tax_rates(uuid, text) FROM PUBLIC, anon, authenticated;

COMMIT;
