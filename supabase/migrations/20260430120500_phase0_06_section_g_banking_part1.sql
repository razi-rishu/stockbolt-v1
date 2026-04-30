-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 0 — Migration 06: Section G — Bank Accounts
-- ─────────────────────────────────────────────────────────────────────────
-- Per Doc 2 §G: bank_accounts.
-- Sequenced before payments because payments.bank_account_id FKs here.
-- Per AGENTS.md Rule 1: NO balance column. Derived from GL postings to
-- the linked coa_account_id.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE public.bank_accounts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  name                    TEXT NOT NULL,
  name_ar                 TEXT,
  account_type            TEXT NOT NULL CHECK (account_type IN ('bank','cash')),
  account_number          TEXT,
  iban                    TEXT,
  swift_code              TEXT,
  bank_name               TEXT,
  branch                  TEXT,
  currency                TEXT NOT NULL,
  coa_account_id          UUID NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  opening_balance         NUMERIC(15,2) NOT NULL DEFAULT 0,
  opening_balance_date    DATE,
  is_default              BOOLEAN NOT NULL DEFAULT FALSE,
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX bank_accounts_company_id_idx     ON public.bank_accounts (company_id);
CREATE INDEX bank_accounts_coa_account_id_idx ON public.bank_accounts (coa_account_id);
CREATE TRIGGER bank_accounts_set_updated_at BEFORE UPDATE ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
