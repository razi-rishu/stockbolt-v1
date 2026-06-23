-- ════════════════════════════════════════════════════════════════════════════
-- Phase 21 — Seed country-appropriate tax rates per company
-- ════════════════════════════════════════════════════════════════════════════
-- Problem: the onboarding function (phase1_01) never actually inserted any rows
-- into public.tax_rates — despite its comment claiming it does. So every company,
-- GCC or India, started with an EMPTY tax_rates table. Every tax picker in the app
-- (invoice / quote / PO / bill / credit-note / debit-note lines + POS) builds its
-- options from that table, so the only option left was the hard-coded "No Tax (0%)"
-- — making the tax field look frozen at 0% and ignore the registered country.
--
-- Fix (Zoho/Odoo style):
--   1. seed_default_tax_rates() — inserts the right set for a country, but ONLY
--      when the company has none yet (idempotent; safe to re-run / backfill).
--   2. An AFTER INSERT trigger on companies seeds every NEW company automatically.
--   3. A one-time backfill seeds every EXISTING company that has no tax rates.
--
-- Backward compatible: never touches a company that already has tax rates, never
-- alters a posted document. Existing invoices keep their stored tax_rate.
--
-- Sets:
--   India (country_code = 'IN'): GST 0 / 5 / 12 / 18 (standard) / 28
--   GCC + everything else:       Standard Rate 5% (standard) / Zero-rated 0% / Exempt
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.seed_default_tax_rates(p_company_id uuid, p_country text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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
      (p_company_id, 'Standard Rate 5%', 5, 'VAT',  true),
      (p_company_id, 'Zero-rated 0%',    0, 'VAT',  true),
      (p_company_id, 'Exempt',           0, 'none', true);
  END IF;
END;
$$;

-- ── Auto-seed every new company ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_seed_tax_rates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_default_tax_rates(NEW.id, NEW.country_code);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS companies_seed_tax_rates ON public.companies;
CREATE TRIGGER companies_seed_tax_rates
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.tg_seed_tax_rates();

-- ── One-time backfill of existing companies ─────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, country_code FROM public.companies LOOP
    PERFORM public.seed_default_tax_rates(r.id, r.country_code);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
