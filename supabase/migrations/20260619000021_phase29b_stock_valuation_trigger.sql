-- ════════════════════════════════════════════════════════════════════════════
-- Phase 29b — Keep stock valuation self-consistent (prevents E1 recurrence)
-- ════════════════════════════════════════════════════════════════════════════
-- Root cause of the E1 drift: editing a posted invoice/bill inserts reversal +
-- repost rows, but the running_qty / running_avg_cost columns weren't re-derived
-- across the affected product's whole chain — so the "latest" running value went
-- stale. Rather than patch every posting RPC, this AFTER INSERT statement trigger
-- re-derives the running columns for exactly the (company, product, warehouse)
-- partitions touched by each insert — covering confirm, edit, reopen, adjustments,
-- transfers, POS, everything.
--
-- Safety:
--   • Only running_qty / running_avg_cost are rewritten — NEVER total_cost or the
--     GL. COGS already computed by the posting RPC is untouched, so the GL stays
--     correct and this never changes P&L.
--   • It fires on INSERT only; its UPDATE of the running columns does not re-fire
--     it (no INSERT) → no recursion.
--   • Statement-level with a transition table → one pass per posting, not per row.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.tg_recompute_stock_valuation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  WITH affected AS (
    SELECT DISTINCT company_id, product_id, warehouse_id FROM new_rows
  ),
  cum AS (
    SELECT sl.id,
      SUM(sl.direction * sl.quantity)   OVER w AS cq,
      SUM(sl.direction * sl.total_cost) OVER w AS cc
    FROM public.stock_ledger sl
    JOIN affected a
      ON a.company_id = sl.company_id AND a.product_id = sl.product_id AND a.warehouse_id = sl.warehouse_id
    WINDOW w AS (
      PARTITION BY sl.company_id, sl.product_id, sl.warehouse_id
      ORDER BY sl.created_at, sl.id          -- matches how E1 picks the latest row (created_at DESC)
      ROWS UNBOUNDED PRECEDING
    )
  )
  UPDATE public.stock_ledger sl
     SET running_qty      = cum.cq,
         running_avg_cost = CASE WHEN cum.cq <> 0 THEN ROUND(cum.cc / cum.cq, 2) ELSE 0 END
    FROM cum
   WHERE sl.id = cum.id
     AND ( sl.running_qty IS DISTINCT FROM cum.cq
        OR sl.running_avg_cost IS DISTINCT FROM CASE WHEN cum.cq <> 0 THEN ROUND(cum.cc / cum.cq, 2) ELSE 0 END );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS stock_ledger_recompute_valuation ON public.stock_ledger;
CREATE TRIGGER stock_ledger_recompute_valuation
  AFTER INSERT ON public.stock_ledger
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.tg_recompute_stock_valuation();

NOTIFY pgrst, 'reload schema';
