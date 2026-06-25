-- ════════════════════════════════════════════════════════════════════════════
-- Phase 30 — Negative-stock guard + "Allow backorders" toggle
-- ════════════════════════════════════════════════════════════════════════════
-- Root problem (diagnosed on COM-001 / Al Noor): selling an item BEFORE it is
-- purchased (negative stock) books COGS at a stale/zero cost and later distorts
-- valuation and profit. This guard refuses a SALE that would drive on-hand stock
-- below zero — unless the company has explicitly opted into backorders.
--
-- Design choice — a BEFORE INSERT row trigger on stock_ledger, NOT edits to the
-- large SECURITY INVOKER posting RPCs (confirm_invoice / edit_invoice /
-- confirm_pos_sale). Reproducing those whole functions just to insert one check
-- is high-risk; a trigger leaves the accounting engine completely untouched and
-- puts the rule in one place. It fires for genuine sale out-rows only:
--   • type = 'sale'            → invoice + POS sales only; NOT purchases, GRN,
--                                returns, credit/debit notes, transfers,
--                                adjustments (those add stock or are corrections)
--   • reversal_of_id IS NULL   → never an edit/void reversal row
--   • running_qty < 0          → this move drives the (product, warehouse) negative
-- When companies.allow_negative_stock = true the trigger is a no-op, so the
-- existing deferred-COGS sell-before-buy path still works for opted-in tenants.
--
-- Scope note: confirm_pos_sale does NOT write a stock row when MAC = 0 (a
-- never-purchased item), so that single edge is not caught here — to be closed
-- in the Stage-2 re-cost work. Invoice sales ALWAYS write the row (Phase 12.20)
-- and are fully guarded, which is the case that bit COM-001.
--
-- Back-compat: only NEW inserts are checked; historical negative rows untouched.
-- Default false (block) for every company — intended; the toggle is the per-tenant
-- escape hatch for invoice-first customers.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS allow_negative_stock BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.tg_block_negative_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allow BOOLEAN;
  v_sku   TEXT;
  v_avail NUMERIC(15,3);
BEGIN
  -- Guard genuine sale out-moves only; everything else passes straight through.
  IF NEW.type <> 'sale'
     OR NEW.reversal_of_id IS NOT NULL
     OR NEW.running_qty >= 0 THEN
    RETURN NEW;
  END IF;

  SELECT allow_negative_stock INTO v_allow
  FROM public.companies WHERE id = NEW.company_id;

  IF COALESCE(v_allow, false) THEN
    RETURN NEW;   -- backorders permitted for this company
  END IF;

  SELECT sku INTO v_sku FROM public.products WHERE id = NEW.product_id;
  v_avail := NEW.running_qty + NEW.quantity;   -- on-hand BEFORE this sale

  RAISE EXCEPTION
    'Not enough stock for %: % available, % requested. Enable "Allow backorders" in Settings to override.',
    COALESCE(v_sku, NEW.product_id::TEXT), v_avail, NEW.quantity
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS stock_ledger_block_negative ON public.stock_ledger;
CREATE TRIGGER stock_ledger_block_negative
  BEFORE INSERT ON public.stock_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_block_negative_stock();

NOTIFY pgrst, 'reload schema';
