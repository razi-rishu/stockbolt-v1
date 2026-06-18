-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 17 — Exchange rates (multi-currency foundation)
-- ─────────────────────────────────────────────────────────────────────────
-- SAFE foundation only — NO posting-math changes. Adds a tenant-scoped table
-- for manual exchange rates plus a backward-compat backfill of base_currency.
-- The GL posting engine is untouched; foreign-currency posting is enabled in a
-- later, test-driven phase.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.exchange_rates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  from_currency  text NOT NULL,
  to_currency    text NOT NULL,
  exchange_rate  numeric(18,8) NOT NULL CHECK (exchange_rate > 0),
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS exchange_rates_lookup_idx
  ON public.exchange_rates (company_id, from_currency, to_currency, effective_date DESC);

-- One rate per pair per day (latest write wins via upsert).
CREATE UNIQUE INDEX IF NOT EXISTS exchange_rates_unique_day
  ON public.exchange_rates (company_id, from_currency, to_currency, effective_date);

ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.exchange_rates;
CREATE POLICY tenant_isolation ON public.exchange_rates
  FOR ALL
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

-- Backward-compat safety net: onboarding already sets base_currency = currency,
-- but ensure every existing company has a base currency.
UPDATE public.companies
   SET base_currency = currency
 WHERE base_currency IS NULL OR base_currency = '';
