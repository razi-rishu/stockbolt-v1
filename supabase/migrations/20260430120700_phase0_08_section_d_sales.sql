-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 0 — Migration 08: Section D (Sales)
-- ─────────────────────────────────────────────────────────────────────────
-- Per Doc 2 §D: sales_quotes/items, sales_orders/items, invoices/items,
-- credit_notes/items, sales_returns/items.
-- invoices.pos_session_id is added in migration 14 once pos_sessions exists.
-- Per AGENTS.md Rule 1: NO paid_amount on invoices. Derived.
-- Per AGENTS.md Rule 1: NO outstanding_balance on customers. Derived.
-- ─────────────────────────────────────────────────────────────────────────

-- ── sales_quotes ─────────────────────────────────────────────────────────
CREATE TABLE public.sales_quotes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  quote_number        TEXT NOT NULL,
  contact_id          UUID NOT NULL REFERENCES public.contacts(id) ON DELETE RESTRICT,
  salesperson_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  date                DATE NOT NULL,
  expiry_date         DATE,
  reference           TEXT,
  price_level_id      UUID REFERENCES public.price_levels(id) ON DELETE SET NULL,
  currency            TEXT NOT NULL,
  exchange_rate       NUMERIC(12,6) NOT NULL DEFAULT 1.0,
  prices_inclusive    BOOLEAN NOT NULL DEFAULT FALSE,
  subtotal            NUMERIC(15,2) NOT NULL DEFAULT 0,
  discount_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount          NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_amount        NUMERIC(15,2) NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','rejected','expired','partially_invoiced','fully_invoiced','void')),
  invoiced_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
  terms               TEXT,
  terms_ar            TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, quote_number)
);
CREATE INDEX sales_quotes_contact_id_idx     ON public.sales_quotes (contact_id, date);
CREATE INDEX sales_quotes_status_idx         ON public.sales_quotes (status, date);
CREATE TRIGGER sales_quotes_set_updated_at BEFORE UPDATE ON public.sales_quotes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.sales_quote_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id            UUID NOT NULL REFERENCES public.sales_quotes(id) ON DELETE CASCADE,
  product_id          UUID REFERENCES public.products(id) ON DELETE RESTRICT,
  description         TEXT,
  description_ar      TEXT,
  quantity            NUMERIC(15,3) NOT NULL,
  unit_id             UUID REFERENCES public.units_of_measure(id) ON DELETE SET NULL,
  unit_price          NUMERIC(15,2) NOT NULL,
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
CREATE INDEX sales_quote_items_quote_id_idx ON public.sales_quote_items (quote_id);

-- ── sales_orders ─────────────────────────────────────────────────────────
CREATE TABLE public.sales_orders (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  order_number                TEXT NOT NULL,
  contact_id                  UUID NOT NULL REFERENCES public.contacts(id) ON DELETE RESTRICT,
  salesperson_id              UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  warehouse_id                UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  source_quote_id             UUID REFERENCES public.sales_quotes(id) ON DELETE SET NULL,
  date                        DATE NOT NULL,
  expected_delivery_date      DATE,
  reference                   TEXT,
  price_level_id              UUID REFERENCES public.price_levels(id) ON DELETE SET NULL,
  currency                    TEXT NOT NULL,
  exchange_rate               NUMERIC(12,6) NOT NULL DEFAULT 1.0,
  prices_inclusive            BOOLEAN NOT NULL DEFAULT FALSE,
  subtotal                    NUMERIC(15,2) NOT NULL DEFAULT 0,
  discount_amount             NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount                  NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_amount                NUMERIC(15,2) NOT NULL DEFAULT 0,
  status                      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','partially_fulfilled','fulfilled','partially_invoiced','fully_invoiced','void')),
  terms                       TEXT,
  terms_ar                    TEXT,
  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, order_number)
);
CREATE INDEX sales_orders_contact_id_idx ON public.sales_orders (contact_id, date);
CREATE INDEX sales_orders_status_idx     ON public.sales_orders (status, date);
CREATE TRIGGER sales_orders_set_updated_at BEFORE UPDATE ON public.sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.sales_order_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  product_id          UUID REFERENCES public.products(id) ON DELETE RESTRICT,
  description         TEXT,
  description_ar      TEXT,
  quantity            NUMERIC(15,3) NOT NULL,
  unit_id             UUID REFERENCES public.units_of_measure(id) ON DELETE SET NULL,
  unit_price          NUMERIC(15,2) NOT NULL,
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
CREATE INDEX sales_order_items_order_id_idx ON public.sales_order_items (order_id);

-- ── invoices ─────────────────────────────────────────────────────────────
-- pos_session_id FK added in migration 14 once pos_sessions exists.
CREATE TABLE public.invoices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  invoice_number      TEXT NOT NULL,
  contact_id          UUID NOT NULL REFERENCES public.contacts(id) ON DELETE RESTRICT,
  salesperson_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  warehouse_id        UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  date                DATE NOT NULL,
  due_date            DATE,
  reference           TEXT,
  price_level_id      UUID REFERENCES public.price_levels(id) ON DELETE SET NULL,
  currency            TEXT NOT NULL,
  exchange_rate       NUMERIC(12,6) NOT NULL DEFAULT 1.0,
  prices_inclusive    BOOLEAN NOT NULL DEFAULT FALSE,
  subtotal            NUMERIC(15,2) NOT NULL DEFAULT 0,
  discount_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount          NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_amount        NUMERIC(15,2) NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','void')),
  source_quote_id     UUID REFERENCES public.sales_quotes(id) ON DELETE SET NULL,
  source_order_id     UUID REFERENCES public.sales_orders(id) ON DELETE SET NULL,
  sale_channel        TEXT NOT NULL DEFAULT 'standard' CHECK (sale_channel IN ('standard','pos_cash','pos_card','pos_credit')),
  pos_session_id      UUID,                                  -- FK added in migration 14
  terms               TEXT,
  terms_ar            TEXT,
  notes               TEXT,
  void_reason         TEXT,
  voided_at           TIMESTAMPTZ,
  voided_by           UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, invoice_number)
);
CREATE INDEX invoices_contact_id_idx       ON public.invoices (contact_id, date);
CREATE INDEX invoices_warehouse_id_idx     ON public.invoices (warehouse_id, date);
CREATE INDEX invoices_status_idx           ON public.invoices (status, date);
CREATE INDEX invoices_pos_session_id_idx   ON public.invoices (pos_session_id);
CREATE TRIGGER invoices_set_updated_at BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON COLUMN public.invoices.status IS
  'Just draft/confirmed/void. paid/partial/overdue states are DERIVED from payment_allocations + due_date — never stored.';

CREATE TABLE public.invoice_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id          UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  product_id          UUID REFERENCES public.products(id) ON DELETE RESTRICT,
  description         TEXT,
  description_ar      TEXT,
  quantity            NUMERIC(15,3) NOT NULL,
  unit_id             UUID REFERENCES public.units_of_measure(id) ON DELETE SET NULL,
  unit_price          NUMERIC(15,2) NOT NULL,
  discount_percent    NUMERIC(7,2) NOT NULL DEFAULT 0,
  discount_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_category        TEXT NOT NULL DEFAULT 'standard',
  tax_rate            NUMERIC(7,2),
  tax_amount          NUMERIC(15,2) NOT NULL DEFAULT 0,
  line_subtotal       NUMERIC(15,2) NOT NULL DEFAULT 0,
  line_total          NUMERIC(15,2) NOT NULL DEFAULT 0,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  cost_at_sale        NUMERIC(15,2),
  serial_id           UUID REFERENCES public.product_serials(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX invoice_items_invoice_id_idx ON public.invoice_items (invoice_id);
CREATE INDEX invoice_items_product_id_idx ON public.invoice_items (product_id);

COMMENT ON COLUMN public.invoice_items.cost_at_sale IS
  'Snapshot of MAC at time of sale (Doc 3 Part O). Used for COGS posting and sales-return restock cost.';

-- ── credit_notes ─────────────────────────────────────────────────────────
CREATE TABLE public.credit_notes (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  credit_note_number      TEXT NOT NULL,
  contact_id              UUID NOT NULL REFERENCES public.contacts(id) ON DELETE RESTRICT,
  salesperson_id          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  warehouse_id            UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  linked_invoice_id       UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  date                    DATE NOT NULL,
  reason                  TEXT CHECK (reason IS NULL OR reason IN ('return','rebate','price_correction','damage','bad_debt')),
  restock                 BOOLEAN NOT NULL DEFAULT TRUE,
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
  UNIQUE (company_id, credit_note_number)
);
CREATE INDEX credit_notes_contact_id_idx       ON public.credit_notes (contact_id, date);
CREATE INDEX credit_notes_linked_invoice_idx   ON public.credit_notes (linked_invoice_id);
CREATE INDEX credit_notes_status_idx           ON public.credit_notes (status, date);
CREATE TRIGGER credit_notes_set_updated_at BEFORE UPDATE ON public.credit_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.credit_note_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id      UUID NOT NULL REFERENCES public.credit_notes(id) ON DELETE CASCADE,
  product_id          UUID REFERENCES public.products(id) ON DELETE RESTRICT,
  description         TEXT,
  description_ar      TEXT,
  quantity            NUMERIC(15,3) NOT NULL,
  unit_id             UUID REFERENCES public.units_of_measure(id) ON DELETE SET NULL,
  unit_price          NUMERIC(15,2) NOT NULL,
  discount_percent    NUMERIC(7,2) NOT NULL DEFAULT 0,
  discount_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_category        TEXT NOT NULL DEFAULT 'standard',
  tax_rate            NUMERIC(7,2),
  tax_amount          NUMERIC(15,2) NOT NULL DEFAULT 0,
  line_subtotal       NUMERIC(15,2) NOT NULL DEFAULT 0,
  line_total          NUMERIC(15,2) NOT NULL DEFAULT 0,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  cost_at_sale        NUMERIC(15,2),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX credit_note_items_credit_note_id_idx ON public.credit_note_items (credit_note_id);

-- ── sales_returns ────────────────────────────────────────────────────────
CREATE TABLE public.sales_returns (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  return_number       TEXT NOT NULL,
  invoice_id          UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  date                DATE NOT NULL,
  warehouse_id        UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  credit_note_id      UUID REFERENCES public.credit_notes(id) ON DELETE SET NULL,
  reason              TEXT CHECK (reason IS NULL OR reason IN ('wrong_part','defective','customer_changed_mind','other')),
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','void')),
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, return_number)
);
CREATE INDEX sales_returns_invoice_id_idx ON public.sales_returns (invoice_id);
CREATE INDEX sales_returns_status_idx     ON public.sales_returns (status, date);
CREATE TRIGGER sales_returns_set_updated_at BEFORE UPDATE ON public.sales_returns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.sales_return_items (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_return_id         UUID NOT NULL REFERENCES public.sales_returns(id) ON DELETE CASCADE,
  product_id              UUID REFERENCES public.products(id) ON DELETE RESTRICT,
  qty_returned            NUMERIC(15,3) NOT NULL,
  condition               TEXT CHECK (condition IS NULL OR condition IN ('resellable','damaged')),
  restock_warehouse_id    UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  unit_cost               NUMERIC(15,2),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX sales_return_items_sales_return_id_idx ON public.sales_return_items (sales_return_id);
