-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 0 — Migration 12: Section H (Inventory Movement)
-- ─────────────────────────────────────────────────────────────────────────
-- Per Doc 2 §H: stock_ledger, stock_transfers/items, inventory_adjustments/items.
-- (deferred_cogs_queue lands in migration 13 with the GL since it FKs to
-- journal_entries.)
--
-- stock_ledger is the source of truth for stock per AGENTS.md Rule 1.
-- Per Doc 2: every product/warehouse stock balance is DERIVED from it.
-- ─────────────────────────────────────────────────────────────────────────

-- ── stock_ledger ─────────────────────────────────────────────────────────
CREATE TABLE public.stock_ledger (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  product_id          UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  warehouse_id        UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  date                DATE NOT NULL,
  type                TEXT NOT NULL CHECK (type IN (
                          'purchase','sale','sales_return','purchase_return',
                          'transfer_out','transfer_in','adjustment_in','adjustment_out',
                          'opening_balance')),
  quantity            NUMERIC(15,3) NOT NULL CHECK (quantity > 0),
  direction           SMALLINT NOT NULL CHECK (direction IN (-1, 1)),
  unit_cost           NUMERIC(15,2) NOT NULL,
  total_cost          NUMERIC(15,2) NOT NULL,
  running_qty         NUMERIC(15,3),
  running_avg_cost    NUMERIC(15,2),
  related_doc_type    TEXT,
  related_doc_id      UUID,
  notes               TEXT,
  reversal_of_id      UUID REFERENCES public.stock_ledger(id) ON DELETE RESTRICT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX stock_ledger_product_warehouse_date_idx ON public.stock_ledger (product_id, warehouse_id, date);
CREATE INDEX stock_ledger_company_id_idx             ON public.stock_ledger (company_id);
CREATE INDEX stock_ledger_related_doc_idx            ON public.stock_ledger (related_doc_type, related_doc_id);
CREATE INDEX stock_ledger_reversal_of_id_idx         ON public.stock_ledger (reversal_of_id);

COMMENT ON TABLE public.stock_ledger IS
  'Source of truth for stock per AGENTS.md Rule 1. Every movement is a row. Stock per warehouse is derived: SUM(quantity * direction) excluding reversed rows. See stock_active view.';

-- ── stock_transfers ──────────────────────────────────────────────────────
CREATE TABLE public.stock_transfers (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  transfer_number         TEXT NOT NULL,
  from_warehouse_id       UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  to_warehouse_id         UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  date                    DATE NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_transit','completed','void')),
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, transfer_number),
  CHECK (from_warehouse_id <> to_warehouse_id)
);
CREATE INDEX stock_transfers_from_warehouse_idx ON public.stock_transfers (from_warehouse_id, date);
CREATE INDEX stock_transfers_to_warehouse_idx   ON public.stock_transfers (to_warehouse_id, date);
CREATE INDEX stock_transfers_status_idx         ON public.stock_transfers (status, date);
CREATE TRIGGER stock_transfers_set_updated_at BEFORE UPDATE ON public.stock_transfers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.stock_transfer_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id         UUID NOT NULL REFERENCES public.stock_transfers(id) ON DELETE CASCADE,
  product_id          UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity            NUMERIC(15,3) NOT NULL CHECK (quantity > 0),
  unit_cost           NUMERIC(15,2),
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX stock_transfer_items_transfer_id_idx ON public.stock_transfer_items (transfer_id);
CREATE INDEX stock_transfer_items_product_id_idx  ON public.stock_transfer_items (product_id);

-- ── inventory_adjustments ────────────────────────────────────────────────
CREATE TABLE public.inventory_adjustments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  adjustment_number   TEXT NOT NULL,
  warehouse_id        UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  date                DATE NOT NULL,
  reason              TEXT NOT NULL CHECK (reason IN ('stock_count','damage','shrinkage','found','other')),
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','void')),
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, adjustment_number)
);
CREATE INDEX inventory_adjustments_warehouse_id_idx ON public.inventory_adjustments (warehouse_id, date);
CREATE INDEX inventory_adjustments_status_idx       ON public.inventory_adjustments (status, date);
CREATE TRIGGER inventory_adjustments_set_updated_at BEFORE UPDATE ON public.inventory_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.inventory_adjustment_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_id       UUID NOT NULL REFERENCES public.inventory_adjustments(id) ON DELETE CASCADE,
  product_id          UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  system_qty          NUMERIC(15,3) NOT NULL,
  actual_qty          NUMERIC(15,3) NOT NULL,
  difference          NUMERIC(15,3) NOT NULL,
  unit_cost           NUMERIC(15,2),
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX inventory_adjustment_items_adjustment_id_idx ON public.inventory_adjustment_items (adjustment_id);
CREATE INDEX inventory_adjustment_items_product_id_idx    ON public.inventory_adjustment_items (product_id);
