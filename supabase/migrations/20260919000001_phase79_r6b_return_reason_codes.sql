-- ============================================================================
-- Phase 79 (R6b) — Four reason codes the return documents were missing
--
-- HONEST FRAMING
-- R6a was supposed to show which reasons were hiding under 'other' before this
-- list was extended. It showed nothing: the whole database contains ONE
-- confirmed sales return (customer_changed_mind), no purchase returns, and not
-- a single document coded 'other'. There is no usage evidence, so this is
-- judgement, not data. Each addition therefore has to justify itself, and the
-- codes that could not are deliberately left out -- expired_stock,
-- superseded_part, quality_issue, duplicate_order, late_delivery,
-- excess_quantity. All plausible, none justified by anything but a guess, and
-- a speculative code is cheap to add and awkward to remove once documents
-- carry it.
--
-- WHAT IS ADDED, AND WHY
--
--   sales_returns.reason
--     + warranty            A part that failed under warranty is neither
--                           "defective on arrival" nor "changed their mind".
--                           Auto parts is a warranty-heavy trade and the
--                           commercial handling differs: usually no restocking
--                           fee, often a claim against the supplier.
--
--     + damaged_in_transit  The purchase side has had this code since phase 75.
--                           Its absence on the sales side was an asymmetry, not
--                           a decision -- goods are just as capable of being
--                           damaged on the way OUT.
--
--     + ordered_in_error    Distinct from customer_changed_mind, and the
--                           distinction became load-bearing with R4b. A
--                           restocking fee turns on WHOSE mistake it was:
--                           wrong_part / defective / damaged_in_transit are
--                           ours and carry no fee; changed_mind and
--                           ordered_in_error are the customer's and do. Folding
--                           a clerical slip into "changed their mind" reads as
--                           a complaint about the customer when it was a typo.
--
--   purchase_returns.reason
--     + warranty            Same trade reality in the other direction: failed
--                           parts go back to the supplier under warranty
--                           constantly, and that is not "defective on arrival".
--
-- WHAT IS NOT TOUCHED
-- credit_notes.reason and debit_notes.reason keep their own vocabulary
-- (return / rebate / price_correction / damage / bad_debt). Those are FINANCIAL
-- reasons on a different axis -- a credit note can exist with no goods movement
-- at all -- so harmonising them with the document reasons would be wrong, not
-- tidier.
--
-- sales_return_items.condition and purchase_return_items.condition are also
-- untouched. A third condition needs a PARTIAL value split, which is an
-- accounting change rather than a vocabulary one.
--
-- SAFETY
-- Both new sets are strict SUPERSETS of the old ones, so no existing row can
-- fail the new constraint and no backfill is needed. Each table's drop and add
-- happen inside one DO block, which is a single statement and therefore atomic:
-- the table is never left without its constraint, even if the script is
-- interrupted between tables.
--
-- ROLLBACK (only safe while no document carries a new code)
--   ALTER TABLE public.sales_returns DROP CONSTRAINT sales_returns_reason_check;
--   ALTER TABLE public.sales_returns ADD CONSTRAINT sales_returns_reason_check
--     CHECK (reason IS NULL OR reason IN ('wrong_part','defective',
--                                         'customer_changed_mind','other'));
--   ALTER TABLE public.purchase_returns DROP CONSTRAINT purchase_returns_reason_check;
--   ALTER TABLE public.purchase_returns ADD CONSTRAINT purchase_returns_reason_check
--     CHECK (reason IS NULL OR reason IN ('wrong_part','defective',
--                                         'damaged_in_transit','over_shipment','other'));
--
-- Additive and idempotent. Safe to re-run.
-- ============================================================================

DO $$
BEGIN
  ALTER TABLE public.sales_returns
    DROP CONSTRAINT IF EXISTS sales_returns_reason_check;
  ALTER TABLE public.sales_returns
    ADD CONSTRAINT sales_returns_reason_check
    CHECK (reason IS NULL OR reason IN (
      'wrong_part',
      'defective',
      'customer_changed_mind',
      'damaged_in_transit',   -- phase 79: the purchase side already had it
      'ordered_in_error',     -- phase 79: not the same as changing their mind
      'warranty',             -- phase 79: failed in service, not on arrival
      'other'));
END $$;

DO $$
BEGIN
  ALTER TABLE public.purchase_returns
    DROP CONSTRAINT IF EXISTS purchase_returns_reason_check;
  ALTER TABLE public.purchase_returns
    ADD CONSTRAINT purchase_returns_reason_check
    CHECK (reason IS NULL OR reason IN (
      'wrong_part',
      'defective',
      'damaged_in_transit',
      'over_shipment',
      'warranty',             -- phase 79: goes back to the supplier under claim
      'other'));
END $$;

NOTIFY pgrst, 'reload schema';
