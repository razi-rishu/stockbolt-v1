-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 0 — Migration 11: Section G — Banking (rest)
-- ─────────────────────────────────────────────────────────────────────────
-- Per Doc 2 §G: bank_transfers, pdc_cheques, expenses.
-- ─────────────────────────────────────────────────────────────────────────

-- ── bank_transfers ───────────────────────────────────────────────────────
CREATE TABLE public.bank_transfers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  transfer_number     TEXT NOT NULL,
  from_account_id     UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  to_account_id       UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  amount              NUMERIC(15,2) NOT NULL,
  date                DATE NOT NULL,
  reference           TEXT,
  notes               TEXT,
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','void')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, transfer_number),
  CHECK (from_account_id <> to_account_id)
);
CREATE INDEX bank_transfers_from_account_id_idx ON public.bank_transfers (from_account_id, date);
CREATE INDEX bank_transfers_to_account_id_idx   ON public.bank_transfers (to_account_id, date);
CREATE INDEX bank_transfers_status_idx          ON public.bank_transfers (status, date);
CREATE TRIGGER bank_transfers_set_updated_at BEFORE UPDATE ON public.bank_transfers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── pdc_cheques ──────────────────────────────────────────────────────────
CREATE TABLE public.pdc_cheques (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  pdc_number          TEXT NOT NULL,
  type                TEXT NOT NULL CHECK (type IN ('received','issued')),
  contact_id          UUID NOT NULL REFERENCES public.contacts(id) ON DELETE RESTRICT,
  cheque_number       TEXT NOT NULL,
  bank_name           TEXT,
  amount              NUMERIC(15,2) NOT NULL,
  currency            TEXT NOT NULL,
  issue_date          DATE NOT NULL,
  due_date            DATE NOT NULL,
  deposit_account_id  UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','deposited','cleared','bounced','cancelled','returned')),
  linked_payment_id   UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, pdc_number)
);
CREATE INDEX pdc_cheques_contact_id_idx       ON public.pdc_cheques (contact_id, due_date);
CREATE INDEX pdc_cheques_status_due_date_idx  ON public.pdc_cheques (status, due_date);
CREATE TRIGGER pdc_cheques_set_updated_at BEFORE UPDATE ON public.pdc_cheques
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── expenses ─────────────────────────────────────────────────────────────
CREATE TABLE public.expenses (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  expense_number          TEXT NOT NULL,
  date                    DATE NOT NULL,
  expense_account_id      UUID NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  paid_from_account_id    UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  amount                  NUMERIC(15,2) NOT NULL,
  tax_amount              NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_amount            NUMERIC(15,2) NOT NULL,
  supplier_id             UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  reference               TEXT,
  description             TEXT NOT NULL,
  receipt_url             TEXT,
  status                  TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','void')),
  void_reason             TEXT,
  voided_at               TIMESTAMPTZ,
  voided_by               UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, expense_number)
);
CREATE INDEX expenses_expense_account_id_idx   ON public.expenses (expense_account_id, date);
CREATE INDEX expenses_paid_from_account_id_idx ON public.expenses (paid_from_account_id, date);
CREATE INDEX expenses_supplier_id_idx          ON public.expenses (supplier_id);
CREATE INDEX expenses_status_idx               ON public.expenses (status, date);
CREATE TRIGGER expenses_set_updated_at BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
