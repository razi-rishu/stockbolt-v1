-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 15 — Customizable Print Template engine
-- ─────────────────────────────────────────────────────────────────────────
-- Adds a multi-tenant `print_templates` table (one company → many named
-- templates) plus a `print_template_defaults` map (which template is the
-- default for each document type). This is the storage layer behind the
-- Zoho/Odoo-style print customization engine.
--
-- BACKWARD COMPATIBILITY (critical):
--   • companies.print_config (the old JSONB blob) is LEFT UNTOUCHED and
--     remains the runtime fallback when no print_templates row resolves.
--   • This migration seeds ONE "Default Template" per existing company,
--     style='classic', is_default=true, with colours/toggles mapped from
--     that company's current print_config so printed output is unchanged.
--   • All new section toggles default to TRUE so nothing disappears.
-- ─────────────────────────────────────────────────────────────────────────

-- ── Table: print_templates ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.print_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name            text NOT NULL,
  template_style  text NOT NULL DEFAULT 'classic'
                    CHECK (template_style IN ('classic','modern','minimal','corporate','gcc','india_gst')),
  primary_color   text NOT NULL DEFAULT '#1E3A8A',
  secondary_color text NOT NULL DEFAULT '#64748B',
  accent_color    text NOT NULL DEFAULT '#F5C242',
  text_color      text NOT NULL DEFAULT '#111827',
  font_family     text NOT NULL DEFAULT 'Inter'
                    CHECK (font_family IN ('Inter','Roboto','Poppins','Open Sans')),
  font_size       text NOT NULL DEFAULT 'medium'
                    CHECK (font_size IN ('small','medium','large')),
  logo_position   text NOT NULL DEFAULT 'left'
                    CHECK (logo_position IN ('left','center','right')),
  logo_size       text NOT NULL DEFAULT 'medium'
                    CHECK (logo_size IN ('small','medium','large')),
  is_default      boolean NOT NULL DEFAULT false,
  settings        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS print_templates_company_idx
  ON public.print_templates (company_id);

-- At most one global default per company.
CREATE UNIQUE INDEX IF NOT EXISTS print_templates_one_default_per_company
  ON public.print_templates (company_id)
  WHERE is_default;

-- ── Table: print_template_defaults (per-document-type override) ───────────
CREATE TABLE IF NOT EXISTS public.print_template_defaults (
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  document_type text NOT NULL,           -- sales_invoice | quotation | credit_note | debit_note | delivery_note | purchase_order | purchase_invoice | statement
  template_id   uuid NOT NULL REFERENCES public.print_templates(id) ON DELETE CASCADE,
  PRIMARY KEY (company_id, document_type)
);

CREATE INDEX IF NOT EXISTS print_template_defaults_company_idx
  ON public.print_template_defaults (company_id);

-- ── RLS — tenant isolation (mirrors every other tenant-scoped table) ──────
ALTER TABLE public.print_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.print_templates;
CREATE POLICY tenant_isolation ON public.print_templates
  FOR ALL
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.print_template_defaults ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.print_template_defaults;
CREATE POLICY tenant_isolation ON public.print_template_defaults
  FOR ALL
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

-- ── updated_at trigger ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.print_templates_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS print_templates_set_updated_at ON public.print_templates;
CREATE TRIGGER print_templates_set_updated_at
  BEFORE UPDATE ON public.print_templates
  FOR EACH ROW EXECUTE FUNCTION public.print_templates_touch_updated_at();

-- ── Backward-compat seed: one classic "Default Template" per company ──────
-- Maps the company's existing print_config (accent colour, footer text, the
-- three legacy toggles) into the new model. All other section toggles default
-- to true. Only seeds companies that don't already have a default template,
-- so re-running is safe.
INSERT INTO public.print_templates
  (company_id, name, template_style, accent_color, is_default, settings)
SELECT
  c.id,
  'Default Template',
  'classic',
  COALESCE(NULLIF(c.print_config->>'accent_color', ''), '#F5C242'),
  true,
  jsonb_build_object(
    'showLogo',              true,
    'showDueDate',           COALESCE((c.print_config->>'show_due_date')::boolean, true),
    'showBankDetails',       COALESCE((c.print_config->>'show_bank_details')::boolean, true),
    'showSalesperson',       COALESCE((c.print_config->>'show_salesperson')::boolean, true),
    'showPaymentTerms',      true,
    'showCustomerTaxNumber', true,
    'showQR',                true,
    'showSignature',         true,
    'showFooter',            true,
    'showItemSku',           true,
    'showItemDescription',   true,
    'showUnitPrice',         true,
    'showDiscount',          true,
    'showTaxBreakdown',      true,
    'showWarehouse',         false,
    'showReferenceNumber',   true,
    'footerEn',              COALESCE(c.print_config->>'footer_en', ''),
    'footerAr',              COALESCE(c.print_config->>'footer_ar', '')
  )
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.print_templates pt
  WHERE pt.company_id = c.id AND pt.is_default
);
