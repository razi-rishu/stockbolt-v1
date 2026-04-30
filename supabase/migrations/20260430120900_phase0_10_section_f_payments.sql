-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 0 — Migration 10: Section F (Payments + Allocations)
-- ─────────────────────────────────────────────────────────────────────────
-- Per Doc 2 §F: payments, payment_allocations.
-- payment_allocations.doc_id is polymorphic — references either invoices,
-- vendor_bills, credit_notes, or debit_notes. No DB FK; integrity is
-- enforced by the engine in Phase 4+.
-- ─────────────────────────────────────────────────────────────────────────

-- ── payments ─────────────────────────────────────────────────────────────
CREATE TABLE public.payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  payment_number      TEXT NOT NULL,
  type                TEXT NOT NULL CHECK (type IN ('inbound','outbound')),
  contact_id          UUID NOT NULL REFERENCES public.contacts(id) ON DELETE RESTRICT,
  date                DATE NOT NULL,
  amount              NUMERIC(15,2) NOT NULL,
  currency            TEXT NOT NULL,
  exchange_rate       NUMERIC(12,6) NOT NULL DEFAULT 1.0,
  payment_method_id   UUID REFERENCES public.payment_methods(id) ON DELETE RESTRICT,
  bank_account_id     UUID REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  reference           TEXT,
  classification      TEXT NOT NULL CHECK (classification IN ('against_invoice','advance','on_account')),
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','void')),
  void_reason         TEXT,
  voided_at           TIMESTAMPTZ,
  voided_by           UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, payment_number)
);
CREATE INDEX payments_contact_id_idx       ON public.payments (contact_id, date);
CREATE INDEX payments_type_status_idx      ON public.payments (type, status);
CREATE INDEX payments_bank_account_id_idx  ON public.payments (bank_account_id, date);
CREATE TRIGGER payments_set_updated_at BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── payment_allocations ──────────────────────────────────────────────────
-- Polymorphic doc_id: no FK because Postgres doesn't support polymorphic FKs.
-- Engine validates doc_id matches an existing row in the doc_type table.
CREATE TABLE public.payment_allocations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  payment_id          UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  doc_type            TEXT NOT NULL CHECK (doc_type IN ('invoice','vendor_bill','credit_note','debit_note')),
  doc_id              UUID NOT NULL,
  amount_applied      NUMERIC(15,2) NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX payment_allocations_payment_id_idx ON public.payment_allocations (payment_id);
CREATE INDEX payment_allocations_doc_idx        ON public.payment_allocations (doc_type, doc_id);
