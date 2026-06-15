-- ─────────────────────────────────────────────────────────────────────────
-- Phase 14.17 — Tax Rates seed + prices_inclusive on purchasing docs
-- ─────────────────────────────────────────────────────────────────────────
-- 1. Add prices_inclusive to vendor_bills + purchase_orders.
-- 2. Expand tax_rates.tax_type CHECK to include VAT-category values that
--    match products.tax_category ('standard','zero_rated','exempt').
-- 3. Seed three default UAE VAT rates for every company that has none.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1a. vendor_bills ─────────────────────────────────────────────────────
ALTER TABLE public.vendor_bills
  ADD COLUMN IF NOT EXISTS prices_inclusive BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 1b. purchase_orders ──────────────────────────────────────────────────
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS prices_inclusive BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. Widen tax_type CHECK constraint ───────────────────────────────────
-- The original constraint only allowed tax-system names (VAT, GST…).
-- We now also need VAT-category values (standard, zero_rated, exempt)
-- so that tax rates can be matched to products by their tax_category.
ALTER TABLE public.tax_rates
  DROP CONSTRAINT IF EXISTS tax_rates_tax_type_check;

ALTER TABLE public.tax_rates
  ADD CONSTRAINT tax_rates_tax_type_check
  CHECK (tax_type IN (
    'VAT','GST','CGST','SGST','IGST','none',
    'standard','zero_rated','exempt'
  ));

-- ── 3. Seed default UAE tax rates ────────────────────────────────────────
-- Inserts Standard 5%, Zero-rated 0%, Exempt 0% for every company that
-- currently has NO tax_rates rows at all. Safe to run multiple times.
INSERT INTO public.tax_rates (company_id, name, tax_type, rate, is_active)
SELECT c.id, v.name, v.tax_type, v.rate, true
FROM   public.companies c
CROSS JOIN (VALUES
  ('VAT 5%',          'standard',   5.00),
  ('Zero-rated (0%)', 'zero_rated', 0.00),
  ('Exempt',          'exempt',     0.00)
) AS v(name, tax_type, rate)
WHERE NOT EXISTS (
  SELECT 1 FROM public.tax_rates t WHERE t.company_id = c.id
);
