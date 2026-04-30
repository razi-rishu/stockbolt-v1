-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 0 — Migration 03: Section B (Master Data)
-- ─────────────────────────────────────────────────────────────────────────
-- Per Doc 2 §B: warehouses, categories, brands, units_of_measure,
-- vehicle_makes, vehicle_models, products, product_compatibility,
-- price_levels, product_price_levels.
--
-- product_supplier_codes lives in migration 04 (depends on contacts).
-- product_serials lives in migration 04 (forward FKs to invoices/bills
-- which arrive later, but we add core FKs here-style).
-- ─────────────────────────────────────────────────────────────────────────

-- ── warehouses ───────────────────────────────────────────────────────────
CREATE TABLE public.warehouses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  name_ar         TEXT,
  address         TEXT,
  city            TEXT,
  phone           TEXT,
  is_default      BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, code)
);
CREATE INDEX warehouses_company_id_idx ON public.warehouses (company_id);
CREATE TRIGGER warehouses_set_updated_at BEFORE UPDATE ON public.warehouses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Now wire the deferred FK on profiles.assigned_warehouse_id.
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_assigned_warehouse_id_fkey
  FOREIGN KEY (assigned_warehouse_id)
  REFERENCES public.warehouses(id)
  ON DELETE SET NULL;

-- ── categories ───────────────────────────────────────────────────────────
CREATE TABLE public.categories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  parent_id       UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  name_ar         TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX categories_company_id_idx ON public.categories (company_id);
CREATE INDEX categories_parent_id_idx  ON public.categories (parent_id);
CREATE TRIGGER categories_set_updated_at BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── brands ───────────────────────────────────────────────────────────────
CREATE TABLE public.brands (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  name            TEXT NOT NULL,
  name_ar         TEXT,
  logo_url        TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, name)
);
CREATE INDEX brands_company_id_idx ON public.brands (company_id);
CREATE TRIGGER brands_set_updated_at BEFORE UPDATE ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── units_of_measure ─────────────────────────────────────────────────────
CREATE TABLE public.units_of_measure (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  name_ar         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, code)
);
CREATE INDEX units_of_measure_company_id_idx ON public.units_of_measure (company_id);
CREATE TRIGGER units_of_measure_set_updated_at BEFORE UPDATE ON public.units_of_measure
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── vehicle_makes ────────────────────────────────────────────────────────
-- company_id NULLABLE per Doc 2 §B: NULL = system-wide list shared across tenants.
CREATE TABLE public.vehicle_makes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  logo_url        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX vehicle_makes_company_id_idx ON public.vehicle_makes (company_id);
CREATE INDEX vehicle_makes_name_idx       ON public.vehicle_makes (name);

-- ── vehicle_models ───────────────────────────────────────────────────────
CREATE TABLE public.vehicle_models (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  make_id         UUID NOT NULL REFERENCES public.vehicle_makes(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  chassis_code    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX vehicle_models_make_id_idx ON public.vehicle_models (make_id);

-- ── products ─────────────────────────────────────────────────────────────
-- Per AGENTS.md Rule 1: NO cost_price, NO stock_quantity columns.
CREATE TABLE public.products (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  sku                     TEXT NOT NULL,
  barcode                 TEXT,
  name                    TEXT NOT NULL,
  name_ar                 TEXT,
  description             TEXT,
  description_ar          TEXT,
  oe_number               TEXT,
  replacement_numbers     TEXT[],
  brand_id                UUID REFERENCES public.brands(id) ON DELETE SET NULL,
  category_id             UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  unit_id                 UUID REFERENCES public.units_of_measure(id) ON DELETE RESTRICT,
  quality_tier            TEXT CHECK (quality_tier IS NULL OR quality_tier IN ('genuine','oem','premium','economy')),
  selling_price           NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_category            TEXT NOT NULL DEFAULT 'standard' CHECK (tax_category IN ('standard','zero_rated','exempt')),
  min_stock_level         NUMERIC(15,3) NOT NULL DEFAULT 0,
  max_stock_level         NUMERIC(15,3),
  requires_serial         BOOLEAN NOT NULL DEFAULT FALSE,
  weight_kg               NUMERIC(10,3),
  image_urls              TEXT[],
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, sku)
);
CREATE INDEX products_company_id_idx       ON public.products (company_id);
CREATE INDEX products_oe_number_idx        ON public.products (oe_number);
CREATE INDEX products_name_idx             ON public.products (name);
CREATE INDEX products_name_ar_idx          ON public.products (name_ar);
CREATE INDEX products_barcode_idx          ON public.products (barcode);
CREATE INDEX products_brand_id_idx         ON public.products (brand_id);
CREATE INDEX products_category_id_idx      ON public.products (category_id);
CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── product_compatibility ────────────────────────────────────────────────
CREATE TABLE public.product_compatibility (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  make_id         UUID NOT NULL REFERENCES public.vehicle_makes(id) ON DELETE RESTRICT,
  model_id        UUID REFERENCES public.vehicle_models(id) ON DELETE RESTRICT,
  year_from       INTEGER,
  year_to         INTEGER,
  engine          TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX product_compatibility_product_id_idx  ON public.product_compatibility (product_id);
CREATE INDEX product_compatibility_make_model_idx  ON public.product_compatibility (make_id, model_id, year_from, year_to);

-- ── price_levels ─────────────────────────────────────────────────────────
CREATE TABLE public.price_levels (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  name                TEXT NOT NULL,
  name_ar             TEXT,
  markup_percent      NUMERIC(7,2),
  is_default          BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX price_levels_company_id_idx ON public.price_levels (company_id);
CREATE TRIGGER price_levels_set_updated_at BEFORE UPDATE ON public.price_levels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── product_price_levels ─────────────────────────────────────────────────
CREATE TABLE public.product_price_levels (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  price_level_id      UUID NOT NULL REFERENCES public.price_levels(id) ON DELETE CASCADE,
  price               NUMERIC(15,2) NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, price_level_id)
);
CREATE INDEX product_price_levels_product_id_idx     ON public.product_price_levels (product_id);
CREATE INDEX product_price_levels_price_level_id_idx ON public.product_price_levels (price_level_id);
