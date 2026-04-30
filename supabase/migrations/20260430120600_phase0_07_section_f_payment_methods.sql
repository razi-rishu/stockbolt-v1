-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 0 — Migration 07: Section F — Payment Methods
-- ─────────────────────────────────────────────────────────────────────────
-- Per Doc 2 §F: payment_methods (the lookup). Sequenced before payments
-- which FKs here. payments + payment_allocations land in migration 10.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE public.payment_methods (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  name            TEXT NOT NULL,
  name_ar         TEXT,
  type            TEXT NOT NULL CHECK (type IN ('cash','bank','cheque','card','online')),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX payment_methods_company_id_idx ON public.payment_methods (company_id);
CREATE TRIGGER payment_methods_set_updated_at BEFORE UPDATE ON public.payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
