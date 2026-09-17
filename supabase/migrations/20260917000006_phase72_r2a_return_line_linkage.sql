-- ============================================================================
-- Phase 72 (R2a) — line-level linkage for returns
--
-- THE PROBLEM
-- Returns are linked at the HEADER only (credit_notes.linked_invoice_id,
-- debit_notes.linked_bill_id). No return line points at the line it came from.
-- Everything that is wrong with partial returns follows from that:
--
--   1. WRONG PRICE. confirm_sales_return matches the source line by product:
--        LEFT JOIN LATERAL (SELECT * FROM invoice_items
--          WHERE invoice_id = ... AND product_id = sri.product_id
--          ORDER BY sort_order LIMIT 1)
--      When the same product appears twice on an invoice at different prices it
--      always takes the FIRST. Live today: Pro_Parts INV-1012 carries the same
--      brake pad kit at 83 and 125. Returning the cheap ones credits 125.
--
--   2. UNLIMITED OVER-RETURN. Nothing totals what has already been returned, so
--      10 units sold can be returned 4 + 4 + 4, each restocking and crediting.
--
--   3. SILENT ZERO CREDIT. A product not on the invoice yields NULL from that
--      join, COALESCE(...,0) makes the price 0, and the customer is credited
--      nothing while the stock comes back.
--
-- This migration adds the missing link and the arithmetic to use it. It changes
-- NO posting logic and reads nothing new yet -- R2b/R2c wire the guards in.
--
-- WHY NOW
-- sales_return_items = 2 rows, credit_note_items = 2, debit_note_items = 0, and
-- the backfill below resolves 2 of 2 unambiguously with 0 conflicts. The model
-- can be corrected with effectively no legacy risk. That stops being true as
-- soon as real return volume accumulates.
--
-- ON DELETE RESTRICT -- and the one behaviour change
-- invoices.update DELETES and recreates invoice_items. RESTRICT therefore means
-- an invoice that already has a return against it can no longer be edited; the
-- database refuses. That is the accounting-correct outcome (you should not be
-- able to re-price a line someone has already returned), and it matches the
-- precedent set by deferred_cogs_queue.invoice_item_id, which is also RESTRICT.
--
-- It is, however, a real behaviour change, and until R2b it surfaces as a raw
-- foreign-key error rather than a friendly message. R2b adds the pre-check.
--
-- NOTE FOR ANYONE TEMPTED TO "FIX" THAT ERROR: the adapter works around the
-- deferred_cogs_queue RESTRICT by clearing the queue before replacing items. Do
-- NOT do the same here. Nulling these links would silently reset returned-to-
-- date to zero and re-open unlimited over-return -- the exact bug this exists
-- to close.
--
-- Additive and idempotent. Safe to re-run.
-- ============================================================================


-- ── 1. The missing links ────────────────────────────────────────────────────
-- Nullable so every existing row and code path stays valid.

ALTER TABLE public.sales_return_items
  ADD COLUMN IF NOT EXISTS invoice_item_id UUID
  REFERENCES public.invoice_items(id) ON DELETE RESTRICT;

ALTER TABLE public.credit_note_items
  ADD COLUMN IF NOT EXISTS invoice_item_id UUID
  REFERENCES public.invoice_items(id) ON DELETE RESTRICT;

ALTER TABLE public.debit_note_items
  ADD COLUMN IF NOT EXISTS vendor_bill_item_id UUID
  REFERENCES public.vendor_bill_items(id) ON DELETE RESTRICT;

-- The returnable views aggregate by these columns on every lookup.
CREATE INDEX IF NOT EXISTS sales_return_items_invoice_item_idx
  ON public.sales_return_items(invoice_item_id) WHERE invoice_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS credit_note_items_invoice_item_idx
  ON public.credit_note_items(invoice_item_id) WHERE invoice_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS debit_note_items_bill_item_idx
  ON public.debit_note_items(vendor_bill_item_id) WHERE vendor_bill_item_id IS NOT NULL;


-- ── 2. Backfill, only where there is exactly ONE candidate ──────────────────
-- A product appearing twice on the source document is precisely the ambiguity
-- this migration exists to remove, so those rows are deliberately left NULL for
-- a human to resolve rather than guessed at.

UPDATE public.sales_return_items sri
SET invoice_item_id = (
      SELECT ii.id FROM public.invoice_items ii
      JOIN public.sales_returns sr ON sr.id = sri.sales_return_id
      WHERE ii.invoice_id = sr.invoice_id AND ii.product_id = sri.product_id)
WHERE sri.invoice_item_id IS NULL
  AND sri.product_id IS NOT NULL
  AND (SELECT count(*) FROM public.invoice_items ii
       JOIN public.sales_returns sr ON sr.id = sri.sales_return_id
       WHERE ii.invoice_id = sr.invoice_id AND ii.product_id = sri.product_id) = 1;

UPDATE public.credit_note_items cni
SET invoice_item_id = (
      SELECT ii.id FROM public.invoice_items ii
      JOIN public.credit_notes cn ON cn.id = cni.credit_note_id
      WHERE ii.invoice_id = cn.linked_invoice_id AND ii.product_id = cni.product_id)
WHERE cni.invoice_item_id IS NULL
  AND cni.product_id IS NOT NULL
  AND (SELECT count(*) FROM public.invoice_items ii
       JOIN public.credit_notes cn ON cn.id = cni.credit_note_id
       WHERE ii.invoice_id = cn.linked_invoice_id AND ii.product_id = cni.product_id) = 1;

UPDATE public.debit_note_items dni
SET vendor_bill_item_id = (
      SELECT vbi.id FROM public.vendor_bill_items vbi
      JOIN public.debit_notes dn ON dn.id = dni.debit_note_id
      WHERE vbi.bill_id = dn.linked_bill_id AND vbi.product_id = dni.product_id)
WHERE dni.vendor_bill_item_id IS NULL
  AND dni.product_id IS NOT NULL
  AND (SELECT count(*) FROM public.vendor_bill_items vbi
       JOIN public.debit_notes dn ON dn.id = dni.debit_note_id
       WHERE vbi.bill_id = dn.linked_bill_id AND vbi.product_id = dni.product_id) = 1;


-- ── 3. Returnable quantity, per source line ────────────────────────────────
-- Counts CONFIRMED notes only. A draft has not returned anything and a void has
-- been reversed, so neither consumes quantity. Two drafts could therefore both
-- claim the same units; R2b's confirm-time guard is what settles that race,
-- which is the right place for it -- reserving stock on a draft would strand
-- quantity behind abandoned paperwork.
--
-- security_invoker = true: a view does NOT inherit RLS from its base tables.
-- Without this it would run as the owner and expose every tenant's lines, which
-- is exactly the leak phase 71 just closed on gl_active / stock_active.

CREATE OR REPLACE VIEW public.v_invoice_line_returnable
WITH (security_invoker = true) AS
SELECT ii.id                                                   AS invoice_item_id,
       ii.invoice_id,
       ii.product_id,
       ii.quantity                                             AS qty_sold,
       COALESCE(r.qty_returned, 0)                             AS qty_returned,
       GREATEST(ii.quantity - COALESCE(r.qty_returned, 0), 0)  AS qty_returnable
FROM public.invoice_items ii
LEFT JOIN LATERAL (
  SELECT SUM(cni.quantity) AS qty_returned
  FROM public.credit_note_items cni
  JOIN public.credit_notes cn ON cn.id = cni.credit_note_id
  WHERE cni.invoice_item_id = ii.id
    AND cn.status = 'confirmed'
) r ON TRUE;

CREATE OR REPLACE VIEW public.v_bill_line_returnable
WITH (security_invoker = true) AS
SELECT vbi.id                                                   AS vendor_bill_item_id,
       vbi.bill_id,
       vbi.product_id,
       vbi.quantity                                             AS qty_billed,
       COALESCE(r.qty_returned, 0)                              AS qty_returned,
       GREATEST(vbi.quantity - COALESCE(r.qty_returned, 0), 0)  AS qty_returnable
FROM public.vendor_bill_items vbi
LEFT JOIN LATERAL (
  SELECT SUM(dni.quantity) AS qty_returned
  FROM public.debit_note_items dni
  JOIN public.debit_notes dn ON dn.id = dni.debit_note_id
  WHERE dni.vendor_bill_item_id = vbi.id
    AND dn.status = 'confirmed'
) r ON TRUE;

REVOKE ALL ON public.v_invoice_line_returnable FROM anon;
REVOKE ALL ON public.v_bill_line_returnable    FROM anon;
GRANT SELECT ON public.v_invoice_line_returnable TO authenticated;
GRANT SELECT ON public.v_bill_line_returnable    TO authenticated;
