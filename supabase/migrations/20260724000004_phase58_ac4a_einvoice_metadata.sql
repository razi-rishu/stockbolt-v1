-- ============================================================================
-- Phase 58 — AC-4A: E-invoice / tax classification metadata
--   Shared foundation for e-invoicing (AC-4) AND AC-3 full-fidelity.
-- ============================================================================
-- Adds document-classification columns that the invoice model does not yet
-- carry but a schema-valid e-invoice / a complete VAT201-GSTR return needs:
-- per-line tax TREATMENT, product default, buyer type + place-of-supply state,
-- and an export marker. Reuses what already exists (products.hsn_code,
-- contacts.tax_id, contacts.address_state, units_of_measure.code).
--
-- POSTING-SAFE: verified from the LIVE definitions that confirm_invoice /
-- edit_invoice / confirm_pos_sale / confirm_vendor_bill read NEITHER
-- tax_category NOR tax_treatment — these columns are inert to the GL. That is
-- why a NEW tax_treatment column is added rather than overloading tax_category.
--
-- All columns are nullable or have a constant default → metadata-only, no table
-- rewrite, no existing row changes behaviour. Additive + idempotent. Apply BY
-- HAND in the Supabase SQL editor.
-- ROLLBACK:
--   ALTER TABLE public.invoice_items DROP COLUMN IF EXISTS tax_treatment;
--   ALTER TABLE public.products      DROP COLUMN IF EXISTS default_tax_treatment;
--   ALTER TABLE public.contacts      DROP COLUMN IF EXISTS place_of_supply_code, DROP COLUMN IF EXISTS buyer_type;
--   ALTER TABLE public.invoices      DROP COLUMN IF EXISTS is_export, DROP COLUMN IF EXISTS place_of_supply_code;
-- ============================================================================

-- 1. Per-line supply treatment (default 'standard' — matches current behaviour)
ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS tax_treatment text NOT NULL DEFAULT 'standard';
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS default_tax_treatment text;   -- NULL ⇒ 'standard' at use

-- 2. Buyer classification + place of supply (India state code)
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS buyer_type text NOT NULL DEFAULT 'registered';
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS place_of_supply_code text;    -- India 2-digit GST state code

-- 3. Invoice header export / place-of-supply markers
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS is_export boolean NOT NULL DEFAULT false;
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS place_of_supply_code text;

-- 4. Value CHECKs (idempotent) ------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_items_tax_treatment_check') THEN
    ALTER TABLE public.invoice_items ADD CONSTRAINT invoice_items_tax_treatment_check
      CHECK (tax_treatment IN ('standard','zero_rated','exempt','reverse_charge','export','out_of_scope'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_default_tax_treatment_check') THEN
    ALTER TABLE public.products ADD CONSTRAINT products_default_tax_treatment_check
      CHECK (default_tax_treatment IS NULL OR default_tax_treatment IN ('standard','zero_rated','exempt','reverse_charge','export','out_of_scope'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_buyer_type_check') THEN
    ALTER TABLE public.contacts ADD CONSTRAINT contacts_buyer_type_check
      CHECK (buyer_type IN ('registered','unregistered','export','sez','composition'));
  END IF;
END$$;
