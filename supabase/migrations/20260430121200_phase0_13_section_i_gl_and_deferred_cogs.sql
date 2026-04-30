-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 0 — Migration 13: GL plumbing + deferred COGS queue
-- ─────────────────────────────────────────────────────────────────────────
-- Per Doc 2 §I: journal_entries, general_ledger.
-- Per Doc 2 §H: deferred_cogs_queue (here because it FKs to journal_entries).
--
-- general_ledger has DB-level CHECKs:
--   - debit/credit non-negative
--   - never both debit > 0 AND credit > 0 on the same row
-- journal_entries enforces total_debit = total_credit at the header.
--
-- Per AGENTS.md Rule 2: ALL inserts to these tables go through
-- src/core/accountingEngine.ts:postJournalEntry(). Never direct.
-- ─────────────────────────────────────────────────────────────────────────

-- ── journal_entries ──────────────────────────────────────────────────────
CREATE TABLE public.journal_entries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  entry_number        TEXT NOT NULL,
  date                DATE NOT NULL,
  description         TEXT NOT NULL,
  source_type         TEXT NOT NULL CHECK (source_type IN (
                          'sales_invoice','pos_cash_sale','pos_card_sale','inventory_cogs',
                          'customer_receipt','customer_advance','advance_application','advance_refund',
                          'sales_credit_note','sales_return',
                          'vendor_bill','goods_receipt','vendor_payment','vendor_advance','vendor_debit_note',
                          'stock_transfer','inventory_adjustment',
                          'opening_balance','bank_transfer','direct_receipt','expense',
                          'pdc_creation','pdc_bank_post','pdc_clear','pdc_bounce',
                          'manual','year_end_close')),
  source_id           UUID,
  currency            TEXT,
  exchange_rate       NUMERIC(12,6) NOT NULL DEFAULT 1.0,
  total_debit         NUMERIC(15,2) NOT NULL,
  total_credit        NUMERIC(15,2) NOT NULL,
  reversed_by_id      UUID REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  reversal_of_id      UUID REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  created_by          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, entry_number),
  CHECK (total_debit = total_credit)
);
CREATE INDEX journal_entries_company_id_idx       ON public.journal_entries (company_id);
CREATE INDEX journal_entries_date_idx             ON public.journal_entries (date);
CREATE INDEX journal_entries_source_idx           ON public.journal_entries (source_type, source_id);
CREATE INDEX journal_entries_reversed_by_idx      ON public.journal_entries (reversed_by_id);
CREATE INDEX journal_entries_reversal_of_idx      ON public.journal_entries (reversal_of_id);

COMMENT ON TABLE public.journal_entries IS
  'Header for batched GL postings. Per AGENTS.md Rule 2, all inserts route through postJournalEntry(). DB CHECK enforces total_debit = total_credit.';

-- ── general_ledger ───────────────────────────────────────────────────────
CREATE TABLE public.general_ledger (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  journal_entry_id    UUID NOT NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  account_id          UUID NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  account_code        TEXT NOT NULL,
  date                DATE NOT NULL,
  debit               NUMERIC(15,2) NOT NULL DEFAULT 0,
  credit              NUMERIC(15,2) NOT NULL DEFAULT 0,
  description         TEXT,
  contact_id          UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  related_doc_type    TEXT,
  related_doc_id      UUID,
  reversal_of_id      UUID REFERENCES public.general_ledger(id) ON DELETE RESTRICT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (debit >= 0 AND credit >= 0),
  CHECK (NOT (debit > 0 AND credit > 0))
);
CREATE INDEX general_ledger_journal_entry_id_idx   ON public.general_ledger (journal_entry_id);
CREATE INDEX general_ledger_account_id_date_idx    ON public.general_ledger (account_id, date);
CREATE INDEX general_ledger_contact_account_idx    ON public.general_ledger (contact_id, account_id);
CREATE INDEX general_ledger_related_doc_idx        ON public.general_ledger (related_doc_type, related_doc_id);
CREATE INDEX general_ledger_company_id_idx         ON public.general_ledger (company_id);
CREATE INDEX general_ledger_reversal_of_idx        ON public.general_ledger (reversal_of_id);

COMMENT ON TABLE public.general_ledger IS
  'Source of truth for everything financial per AGENTS.md Rule 1. CHECK constraints enforce debit/credit hygiene per row.';

-- ── deferred_cogs_queue ──────────────────────────────────────────────────
-- Per Doc 3 A1.b: when a sale lacks a cost basis, COGS is deferred and
-- flushed when the product is next purchased.
CREATE TABLE public.deferred_cogs_queue (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  product_id                  UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  invoice_item_id             UUID NOT NULL REFERENCES public.invoice_items(id) ON DELETE RESTRICT,
  sale_invoice_id             UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  sale_date                   DATE NOT NULL,
  warehouse_id                UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  quantity                    NUMERIC(15,3) NOT NULL CHECK (quantity > 0),
  status                      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','flushed','cancelled')),
  flushed_at                  TIMESTAMPTZ,
  flushed_journal_entry_id    UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  flush_unit_cost             NUMERIC(15,2),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX deferred_cogs_queue_company_status_idx ON public.deferred_cogs_queue (company_id, product_id, status);
CREATE INDEX deferred_cogs_queue_sale_date_idx      ON public.deferred_cogs_queue (sale_date);
CREATE TRIGGER deferred_cogs_queue_set_updated_at BEFORE UPDATE ON public.deferred_cogs_queue
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
