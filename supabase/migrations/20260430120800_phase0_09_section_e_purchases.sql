-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 0 — Migration 09: Section E (Purchases)
-- ─────────────────────────────────────────────────────────────────────────
-- Per Doc 2 §E: purchase_orders/items, goods_receipts/items,
-- vendor_bills/items, debit_notes/items.
-- ─────────────────────────────────────────────────────────────────────────

-- ── purchase_orders ──────────────────────────────────────────────────────
CREATE TABLE public.purchase_orders (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  po_number                   TEXT NOT NULL,
  supplier_id                 UUID NOT NULL REFERENCES public.contacts(id) ON DELETE RESTRICT,
  buyer_id                    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  warehouse_id                UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  date                        DATE NOT NULL,
  expected_delivery_date      DATE,
  reference                   TEXT,
  currency                    TEXT NOT NULL,
  exchange_rate               NUMERIC(12,6) NOT NULL DEFAULT 1.0,
  subtotal                    NUMERIC(15,2) NOT NULL DEFAULT 0,
  discount_amount             NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount                  NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_amount                NUMERIC(15,2) NOT NULL DEFAULT 0,
  status                      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','partially_received','received','closed','void')),
  terms                       TEXT,
  terms_ar                    TEXT,
  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, po_number)
);
CREATE INDEX purchase_orders_supplier_id_idx ON public.purchase_orders (supplier_id, date);
CREATE INDEX purchase_orders_status_idx      ON public.purchase_orders (status, date);
CREATE TRIGGER purchase_orders_set_updated_at BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.purchase_order_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id               UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  product_id          UUID REFERENCES public.products(id) ON DELETE RESTRICT,
  description         TEXT,
  description_ar      TEXT,
  quantity            NUMERIC(15,3) NOT NULL,
  unit_id             UUID REFERENCES public.units_of_measure(id) ON DELETE SET NULL,
  unit_cost           NUMERIC(15,2) NOT NULL,
  discount_percent    NUMERIC(7,2) NOT NULL DEFAULT 0,
  discount_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_category        TEXT NOT NULL DEFAULT 'standard',
  tax_rate            NUMERIC(7,2),
  tax_amount          NUMERIC(15,2) NOT NULL DEFAULT 0,
  line_subtotal       NUMERIC(15,2) NOT NULL DEFAULT 0,
  line_total          NUMERIC(15,2) NOT NULL DEFAULT 0,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX purchase_order_items_po_id_idx ON public.purchase_order_items (po_id);

-- ── goods_receipts ───────────────────────────────────────────────────────
CREATE TABLE public.goods_receipts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  grn_number          TEXT NOT NULL,
  purchase_order_id   UUID REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  supplier_id         UUID NOT NULL REFERENCES public.contacts(id) ON DELETE RESTRICT,
  warehouse_id        UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  date                DATE NOT NULL,
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','received','billed','void')),
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, grn_number)
);
CREATE INDEX goods_receipts_supplier_id_idx ON public.goods_receipts (supplier_id, date);
CREATE INDEX goods_receipts_warehouse_id_idx ON public.goods_receipts (warehouse_id, date);
CREATE INDEX goods_receipts_status_idx       ON public.goods_receipts (status);
CREATE TRIGGER goods_receipts_set_updated_at BEFORE UPDATE ON public.goods_receipts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON COLUMN public.goods_receipts.status IS
  'billed_amount is DERIVED from linked vendor_bills, NOT stored. Doc 2 §E mentions a billed_amount column but per Rule 1 we derive instead.';

CREATE TABLE public.goods_receipt_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id              UUID NOT NULL REFERENCES public.goods_receipts(id) ON DELETE CASCADE,
  product_id          UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  qty_received        NUMERIC(15,3) NOT NULL,
  unit_cost           NUMERIC(15,2) NOT NULL,
  total_cost          NUMERIC(15,2) NOT NULL DEFAULT 0,
  serial_numbers      TEXT[],
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX goods_receipt_items_grn_id_idx     ON public.goods_receipt_items (grn_id);
CREATE INDEX goods_receipt_items_product_id_idx ON public.goods_receipt_items (product_id);

-- ── vendor_bills ─────────────────────────────────────────────────────────
CREATE TABLE public.vendor_bills (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  bill_number             TEXT NOT NULL,
  supplier_bill_number    TEXT,
  supplier_id             UUID NOT NULL REFERENCES public.contacts(id) ON DELETE RESTRICT,
  date                    DATE NOT NULL,
  due_date                DATE,
  reference               TEXT,
  currency                TEXT NOT NULL,
  exchange_rate           NUMERIC(12,6) NOT NULL DEFAULT 1.0,
  subtotal                NUMERIC(15,2) NOT NULL DEFAULT 0,
  discount_amount         NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount              NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_amount            NUMERIC(15,2) NOT NULL DEFAULT 0,
  status                  TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','void')),
  linked_grn_id           UUID REFERENCES public.goods_receipts(id) ON DELETE SET NULL,
  void_reason             TEXT,
  voided_at               TIMESTAMPTZ,
  voided_by               UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, bill_number)
);
CREATE INDEX vendor_bills_supplier_id_idx ON public.vendor_bills (supplier_id, date);
CREATE INDEX vendor_bills_status_idx      ON public.vendor_bills (status, date);
CREATE INDEX vendor_bills_linked_grn_idx  ON public.vendor_bills (linked_grn_id);
CREATE TRIGGER vendor_bills_set_updated_at BEFORE UPDATE ON public.vendor_bills
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.vendor_bill_items (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id                 UUID NOT NULL REFERENCES public.vendor_bills(id) ON DELETE CASCADE,
  product_id              UUID REFERENCES public.products(id) ON DELETE RESTRICT,
  description             TEXT,
  description_ar          TEXT,
  quantity                NUMERIC(15,3) NOT NULL,
  unit_id                 UUID REFERENCES public.units_of_measure(id) ON DELETE SET NULL,
  unit_cost               NUMERIC(15,2) NOT NULL,
  discount_percent        NUMERIC(7,2) NOT NULL DEFAULT 0,
  discount_amount         NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_category            TEXT NOT NULL DEFAULT 'standard',
  tax_rate                NUMERIC(7,2),
  tax_amount              NUMERIC(15,2) NOT NULL DEFAULT 0,
  line_subtotal           NUMERIC(15,2) NOT NULL DEFAULT 0,
  line_total              NUMERIC(15,2) NOT NULL DEFAULT 0,
  sort_order              INTEGER NOT NULL DEFAULT 0,
  linked_grn_item_id      UUID REFERENCES public.goods_receipt_items(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX vendor_bill_items_bill_id_idx          ON public.vendor_bill_items (bill_id);
CREATE INDEX vendor_bill_items_linked_grn_item_idx  ON public.vendor_bill_items (linked_grn_item_id);

-- ── debit_notes ──────────────────────────────────────────────────────────
CREATE TABLE public.debit_notes (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  debit_note_number       TEXT NOT NULL,
  supplier_id             UUID NOT NULL REFERENCES public.contacts(id) ON DELETE RESTRICT,
  warehouse_id            UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  linked_bill_id          UUID REFERENCES public.vendor_bills(id) ON DELETE SET NULL,
  date                    DATE NOT NULL,
  reason                  TEXT CHECK (reason IS NULL OR reason IN ('return','rebate','price_correction','damage')),
  currency                TEXT NOT NULL,
  exchange_rate           NUMERIC(12,6) NOT NULL DEFAULT 1.0,
  subtotal                NUMERIC(15,2) NOT NULL DEFAULT 0,
  discount_amount         NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount              NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_amount            NUMERIC(15,2) NOT NULL DEFAULT 0,
  status                  TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','void')),
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, debit_note_number)
);
CREATE INDEX debit_notes_supplier_id_idx     ON public.debit_notes (supplier_id, date);
CREATE INDEX debit_notes_linked_bill_id_idx  ON public.debit_notes (linked_bill_id);
CREATE INDEX debit_notes_status_idx          ON public.debit_notes (status, date);
CREATE TRIGGER debit_notes_set_updated_at BEFORE UPDATE ON public.debit_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.debit_note_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  debit_note_id       UUID NOT NULL REFERENCES public.debit_notes(id) ON DELETE CASCADE,
  product_id          UUID REFERENCES public.products(id) ON DELETE RESTRICT,
  description         TEXT,
  description_ar      TEXT,
  quantity            NUMERIC(15,3) NOT NULL,
  unit_id             UUID REFERENCES public.units_of_measure(id) ON DELETE SET NULL,
  unit_cost           NUMERIC(15,2) NOT NULL,
  discount_percent    NUMERIC(7,2) NOT NULL DEFAULT 0,
  discount_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_category        TEXT NOT NULL DEFAULT 'standard',
  tax_rate            NUMERIC(7,2),
  tax_amount          NUMERIC(15,2) NOT NULL DEFAULT 0,
  line_subtotal       NUMERIC(15,2) NOT NULL DEFAULT 0,
  line_total          NUMERIC(15,2) NOT NULL DEFAULT 0,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX debit_note_items_debit_note_id_idx ON public.debit_note_items (debit_note_id);
