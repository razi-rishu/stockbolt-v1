-- phase123 - new companies get their country's real tax rates (Global v1, Phase 4)
--
-- Verified 2026-11-07 against each tax authority's own publication:
--   UAE 5 % (FTA, Federal Decree-Law 8/2017)      - unchanged
--   Oman 5 % (Oman Tax Authority)                  - unchanged
--   Saudi Arabia 15 % (ZATCA)                      - was seeded 5 %
--   Bahrain 10 % since 2022-01-01 (NBR)            - was seeded 5 %
--   Kuwait, Qatar: no VAT law in force             - was seeded 5 %; now NO tax
--                                                    codes at all (decision 1)
--   India GST 2.0, in force 2025-09-22 (56th GST Council): 0 / 5 / 18 / 40 %
--     plus specials 3 / 1.5 / 0.25 % (Notification 9/2025-IT(R))
--                                                  - was 0 / 5 / 12 / 18 / 28 %
--   Decisions (Rashid, 2026-11-07): 1 KW/QA no VAT codes; 2 India specials
--   selectable, never auto-applied; 3 no manual IGST row (the engine splits);
--   4 inclusive / exclusive maths tested for SA 15, BH 10, IN 18 + specials.
--
-- Only seed_default_tax_rates changes, and it only runs for a company that has
-- no tax rates yet (a NEW company). EXISTING companies' rates are not touched;
-- correcting them is a separate, approved data change. Rates are configuration,
-- not a compliance claim: Saudi Arabia, Bahrain and Oman remain "tax
-- configuration" packs (no ZATCA e-invoicing, no official return format).
--
-- Built from the live definition (production md5 32ca6cae..., verified with
-- phase118). Owner, SECURITY DEFINER, search_path, the phase65 guard and the
-- grants (no client EXECUTE) are kept. Re-runnable.
-- Rollback: supabase/manual-apply/phase123_rollback.sql.

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

  -- phase123 (decision 1): Kuwait and Qatar have no VAT in force. Seed no tax
  -- codes at all - no "Standard 0%", no zero-rated, no exempt - so ordinary
  -- documents carry no VAT. A company can still add a rate later if the law
  -- changes; nothing existing is touched.
  IF upper(coalesce(p_country, '')) IN ('KW', 'QA') THEN
    RETURN;
  END IF;

  IF upper(coalesce(p_country, '')) = 'IN' THEN
    -- phase123: GST 2.0 (56th GST Council, in force 2025-09-22): slabs 0 / 5 /
    -- 18 / 40 (12 % and 28 % abolished), plus the special rates of Notification
    -- 9/2025-Integrated Tax (Rate), 17-09-2025 (decision 2): 3 % (gold, silver,
    -- jewellery - Sch. IV), 1.5 % (cut & polished diamonds - Sch. VI), 0.25 %
    -- (rough diamonds - Sch. V). Specials are selectable only: the default line
    -- rate stays 18 %. No IGST row (decision 3): the posting engine decides
    -- CGST + SGST or IGST from the place of supply (phase122).
    INSERT INTO public.tax_rates (company_id, name, rate, tax_type, is_active) VALUES
      (p_company_id, 'GST 0%',  0,  'GST', true),
      (p_company_id, 'GST 5%',  5,  'GST', true),
      (p_company_id, 'GST 18%', 18, 'GST', true),
      (p_company_id, 'GST 40%', 40, 'GST', true),
      (p_company_id, 'GST 3% (gold, silver, jewellery)',   3,    'GST', true),
      (p_company_id, 'GST 1.5% (cut & polished diamonds)', 1.5,  'GST', true),
      (p_company_id, 'GST 0.25% (rough diamonds)',         0.25, 'GST', true);
  ELSE
    INSERT INTO public.tax_rates (company_id, name, rate, tax_type, is_active) VALUES
      -- Phase 118 - tax_type is the product tax category (products.tax_category:
      -- standard / zero_rated / exempt), which is what the invoice, bill, PO and
      -- quote editors match on to pick a line's rate. 'VAT' / 'none' matched
      -- no product, so no rate was ever picked automatically.
      -- phase123: the country's own standard rate, verified 2026-11-07 against
      -- ZATCA (SA 15), NBR (BH 10), FTA (AE 5), Oman Tax Authority (OM 5).
      -- (Kuwait / Qatar returned above.) Any other code keeps 5.
      (p_company_id,
       'Standard Rate ' || (CASE upper(coalesce(p_country, ''))
                              WHEN 'SA' THEN 15 WHEN 'BH' THEN 10 ELSE 5 END)::text || '%',
       CASE upper(coalesce(p_country, '')) WHEN 'SA' THEN 15 WHEN 'BH' THEN 10 ELSE 5 END,
       'standard', true),
      (p_company_id, 'Zero-rated 0%',    0, 'zero_rated', true),
      (p_company_id, 'Exempt',           0, 'exempt',     true);
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.seed_default_tax_rates(uuid, text) FROM PUBLIC, anon, authenticated;

COMMIT;
