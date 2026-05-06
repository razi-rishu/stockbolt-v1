-- Phase 11: Print Settings
-- Adds print_config JSONB to companies table for storing per-company print preferences.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS print_config JSONB NOT NULL DEFAULT '{
    "invoice_template": "classic",
    "quote_template": "classic",
    "statement_template": "classic",
    "credit_note_template": "classic",
    "debit_note_template": "classic",
    "po_template": "classic",
    "bill_template": "classic",
    "footer_en": "",
    "footer_ar": "",
    "show_salesperson": true,
    "show_due_date": true,
    "show_bank_details": true,
    "accent_color": "#4f46e5"
  }'::jsonb;

COMMENT ON COLUMN companies.print_config IS
  'Per-company print template preferences: default template per doc type, footer text, field toggles, accent color.';
