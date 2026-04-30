-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 0 — Migration 05: Section I — Chart of Accounts
-- ─────────────────────────────────────────────────────────────────────────
-- Per Doc 2 §I: chart_of_accounts.
-- COA is sequenced early because bank_accounts, expenses, tax_rates,
-- general_ledger, and journal_entries all FK to it. The full GL plumbing
-- (journal_entries, general_ledger) lands in migration 13 after all
-- transactional tables exist.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE public.chart_of_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  name_ar         TEXT,
  type            TEXT NOT NULL CHECK (type IN ('asset','liability','equity','income','expense')),
  sub_type        TEXT,
  parent_id       UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  is_system       BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, code)
);
CREATE INDEX chart_of_accounts_company_id_idx ON public.chart_of_accounts (company_id);
CREATE INDEX chart_of_accounts_parent_id_idx  ON public.chart_of_accounts (parent_id);
CREATE INDEX chart_of_accounts_type_idx       ON public.chart_of_accounts (type);
CREATE TRIGGER chart_of_accounts_set_updated_at BEFORE UPDATE ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON COLUMN public.chart_of_accounts.is_system IS
  'TRUE = pre-seeded standard account (Doc 3 Part A list). System accounts cannot be deleted.';
