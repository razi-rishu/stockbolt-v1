-- ═══════════════════════════════════════════════════════════════════════════
-- phase88 (Z1) — the credit note absorbs the sales return's two missing fields
--
-- A sales return and its credit note are one business event recorded twice.
-- The credit note is already the real document: it posts the AR, the VAT, the
-- restock and the COGS reversal, and v_invoice_line_returnable already counts
-- credit_note_items to cap over-returns. The sales return is a UI wrapper that
-- fills one in.
--
-- credit_note_items already carries invoice_item_id, restock_warehouse_id and
-- cost_at_sale; credit_notes already carries linked_invoice_id, warehouse_id,
-- restock and reason. Exactly two fields were missing, and this adds them:
--
--   credit_note_items.condition   resellable | damaged  (R4a)
--   credit_notes.restocking_fee   kept out of the credit (R4b)
--
-- Nothing reads them yet. The triggers that act on them — the damaged-goods
-- write-off (Dr 6700 / Cr 5100) and the restocking fee (Dr 1200 / Cr 2200 +
-- Cr 4200) — still hang off sales_returns and move in Z2. Adding the columns
-- first keeps this migration additive and reversible: no posting function is
-- touched, no trigger fires, no existing row changes meaning.
--
-- WHY 'resellable' IS THE DEFAULT
-- It is what every credit note has effectively been doing since the feature
-- existed: the restock puts goods back at full value. Defaulting to 'damaged'
-- would silently rewrite the meaning of every historic note.
--
-- SAFE TO APPLY: two additive columns with defaults. No data is rewritten
-- beyond the default fill, and both are backward-compatible with code that
-- does not know about them.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.credit_note_items
  ADD COLUMN IF NOT EXISTS condition text NOT NULL DEFAULT 'resellable';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'credit_note_items_condition_check'
       AND conrelid = 'public.credit_note_items'::regclass
  ) THEN
    ALTER TABLE public.credit_note_items
      ADD CONSTRAINT credit_note_items_condition_check
      CHECK (condition IN ('resellable', 'damaged'));
  END IF;
END $$;

COMMENT ON COLUMN public.credit_note_items.condition IS
  'R4a - resellable goods restock at full value; damaged goods restock and are then written off Dr 6700 / Cr 5100 by the Z2 trigger. Mirrors sales_return_items.condition, which this replaces.';

ALTER TABLE public.credit_notes
  ADD COLUMN IF NOT EXISTS restocking_fee numeric(15,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.credit_notes.restocking_fee IS
  'R4b - a charge kept OUT of the credit, entered INCLUSIVE of tax. The note still reverses the sale in full; the fee is clawed back separately as Dr 1200 / Cr 2200 + Cr 4200. Mirrors sales_returns.restocking_fee.';

COMMIT;

-- ── ROLLBACK ───────────────────────────────────────────────────────────────
-- Safe unconditionally while Z2 has not moved the triggers: nothing reads
-- either column, so dropping them cannot strand a posting.
--
-- BEGIN;
--
-- ALTER TABLE public.credit_notes      DROP COLUMN IF EXISTS restocking_fee;
-- ALTER TABLE public.credit_note_items DROP CONSTRAINT IF EXISTS credit_note_items_condition_check;
-- ALTER TABLE public.credit_note_items DROP COLUMN IF EXISTS condition;
--
-- COMMIT;
