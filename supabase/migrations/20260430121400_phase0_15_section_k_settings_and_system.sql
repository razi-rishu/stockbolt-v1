-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 0 — Migration 15: Sections K + L
-- ─────────────────────────────────────────────────────────────────────────
-- Per Doc 2 §K: print_templates, document_sequences, tax_rates.
-- Per Doc 2 §L: attachments, notifications.
-- Also wires up deferred FKs on product_serials (purchase_bill_id,
-- sale_invoice_id) now that vendor_bills and invoices both exist.
-- ─────────────────────────────────────────────────────────────────────────

-- ── print_templates ──────────────────────────────────────────────────────
CREATE TABLE public.print_templates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  document_type       TEXT NOT NULL CHECK (document_type IN ('invoice','quote','order','bill','receipt','statement','pos_receipt','credit_note','debit_note','purchase_order')),
  template_name       TEXT NOT NULL,
  is_default          BOOLEAN NOT NULL DEFAULT FALSE,
  primary_color       TEXT,
  accent_color        TEXT,
  footer_text_en      TEXT,
  footer_text_ar      TEXT,
  show_salesperson    BOOLEAN NOT NULL DEFAULT TRUE,
  show_due_date       BOOLEAN NOT NULL DEFAULT TRUE,
  show_terms          BOOLEAN NOT NULL DEFAULT TRUE,
  bilingual_print     BOOLEAN NOT NULL DEFAULT FALSE,
  paper_size          TEXT NOT NULL DEFAULT 'A4' CHECK (paper_size IN ('A4','80mm','58mm')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, document_type, template_name)
);
CREATE INDEX print_templates_company_id_idx ON public.print_templates (company_id);
CREATE TRIGGER print_templates_set_updated_at BEFORE UPDATE ON public.print_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── document_sequences ───────────────────────────────────────────────────
-- Composite PK (company_id, prefix). Drives auto-numbering.
CREATE TABLE public.document_sequences (
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  prefix              TEXT NOT NULL,
  current_value       BIGINT NOT NULL DEFAULT 1000,
  format              TEXT NOT NULL DEFAULT 'PREFIX-{NUMBER}',
  pad_zeros           INTEGER NOT NULL DEFAULT 0,
  reset_yearly        BOOLEAN NOT NULL DEFAULT FALSE,
  last_reset_year     INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, prefix)
);
CREATE TRIGGER document_sequences_set_updated_at BEFORE UPDATE ON public.document_sequences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── tax_rates ────────────────────────────────────────────────────────────
CREATE TABLE public.tax_rates (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  name                        TEXT NOT NULL,
  rate                        NUMERIC(7,2) NOT NULL,
  tax_type                    TEXT NOT NULL CHECK (tax_type IN ('VAT','GST','CGST','SGST','IGST','none')),
  coa_output_account_id       UUID REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  coa_input_account_id        UUID REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX tax_rates_company_id_idx ON public.tax_rates (company_id);
CREATE TRIGGER tax_rates_set_updated_at BEFORE UPDATE ON public.tax_rates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── attachments ──────────────────────────────────────────────────────────
CREATE TABLE public.attachments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  entity_type         TEXT NOT NULL,
  entity_id           UUID NOT NULL,
  file_name           TEXT NOT NULL,
  file_url            TEXT NOT NULL,
  file_size           BIGINT,
  mime_type           TEXT,
  uploaded_by         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX attachments_company_id_idx ON public.attachments (company_id);
CREATE INDEX attachments_entity_idx     ON public.attachments (entity_type, entity_id);

-- ── notifications ────────────────────────────────────────────────────────
CREATE TABLE public.notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  user_id         UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('low_stock','overdue_invoice','pdc_due','period_close_reminder','other')),
  title           TEXT NOT NULL,
  message         TEXT,
  link_to         TEXT,
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX notifications_company_id_idx     ON public.notifications (company_id);
CREATE INDEX notifications_user_id_idx        ON public.notifications (user_id, is_read);

-- ─────────────────────────────────────────────────────────────────────────
-- Wire up deferred FKs on product_serials now that vendor_bills + invoices exist.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.product_serials
  ADD CONSTRAINT product_serials_purchase_bill_id_fkey
  FOREIGN KEY (purchase_bill_id)
  REFERENCES public.vendor_bills(id)
  ON DELETE SET NULL;

ALTER TABLE public.product_serials
  ADD CONSTRAINT product_serials_sale_invoice_id_fkey
  FOREIGN KEY (sale_invoice_id)
  REFERENCES public.invoices(id)
  ON DELETE SET NULL;
