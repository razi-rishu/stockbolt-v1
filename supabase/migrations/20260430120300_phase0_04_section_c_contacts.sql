-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 0 — Migration 04: Section C (Contacts)
-- ─────────────────────────────────────────────────────────────────────────
-- Per Doc 2 §C: contacts (one table for both customers and suppliers).
-- Also lands product_supplier_codes (depends on contacts) and
-- product_serials (depends on warehouses; forward FKs to invoices and
-- vendor_bills are wired up in migration 15 once those tables exist).
-- ─────────────────────────────────────────────────────────────────────────

-- ── contacts ─────────────────────────────────────────────────────────────
-- Per AGENTS.md Rule 1: NO outstanding_balance column. Derived from GL.
CREATE TABLE public.contacts (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  code                        TEXT,
  name                        TEXT NOT NULL,
  name_ar                     TEXT,
  type                        TEXT NOT NULL CHECK (type IN ('customer','supplier','both')),
  email                       TEXT,
  phone                       TEXT,
  mobile                      TEXT,
  currency                    TEXT NOT NULL,
  tax_id                      TEXT,
  address_street              TEXT,
  address_city                TEXT,
  address_state               TEXT,
  address_country             TEXT,
  address_postal              TEXT,
  billing_address_ar          TEXT,
  contact_person_name         TEXT,
  contact_person_phone        TEXT,
  contact_person_email        TEXT,
  credit_limit                NUMERIC(15,2) NOT NULL DEFAULT 0,
  payment_terms_days          INTEGER NOT NULL DEFAULT 0,
  default_price_level_id      UUID REFERENCES public.price_levels(id) ON DELETE SET NULL,
  is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX contacts_company_id_idx     ON public.contacts (company_id);
CREATE INDEX contacts_type_active_idx    ON public.contacts (type, is_active, name);
CREATE INDEX contacts_name_idx           ON public.contacts (name);
CREATE INDEX contacts_email_idx          ON public.contacts (email);
CREATE INDEX contacts_phone_idx          ON public.contacts (phone);
CREATE TRIGGER contacts_set_updated_at BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── product_supplier_codes ───────────────────────────────────────────────
CREATE TABLE public.product_supplier_codes (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  product_id              UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  supplier_id             UUID NOT NULL REFERENCES public.contacts(id) ON DELETE RESTRICT,
  supplier_sku            TEXT NOT NULL,
  last_purchase_price     NUMERIC(15,2),
  last_purchase_date      DATE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, supplier_id)
);
CREATE INDEX product_supplier_codes_company_id_idx    ON public.product_supplier_codes (company_id);
CREATE INDEX product_supplier_codes_supplier_sku_idx  ON public.product_supplier_codes (supplier_sku);
CREATE TRIGGER product_supplier_codes_set_updated_at BEFORE UPDATE ON public.product_supplier_codes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── product_serials ──────────────────────────────────────────────────────
-- purchase_bill_id / sale_invoice_id FKs added in migration 15 (after
-- vendor_bills and invoices exist). Stored as plain UUIDs until then.
CREATE TABLE public.product_serials (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  product_id          UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  warehouse_id        UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  serial_number       TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('available','reserved','sold','returned')),
  purchase_bill_id    UUID,    -- FK added in migration 15
  sale_invoice_id     UUID,    -- FK added in migration 15
  purchase_date       DATE,
  sale_date           DATE,
  warranty_expiry     DATE,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, product_id, serial_number)
);
CREATE INDEX product_serials_product_id_idx        ON public.product_serials (product_id);
CREATE INDEX product_serials_warehouse_id_idx      ON public.product_serials (warehouse_id);
CREATE INDEX product_serials_status_idx            ON public.product_serials (status);
CREATE TRIGGER product_serials_set_updated_at BEFORE UPDATE ON public.product_serials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
