-- ════════════════════════════════════════════════════════════════════════════
-- Phase 29a — Recompute stock valuation (fix E1 drift; subledger-only)
-- ════════════════════════════════════════════════════════════════════════════
-- System Health E1 (Stock Valuation = Inventory 1300) drifted: the inventory
-- subledger's running_qty / running_avg_cost became inconsistent after invoice/
-- bill EDITS (edit-reversal rows weren't re-derived). The GL (1300) is CORRECT —
-- it equals the true net cost flow. Only the subledger's running columns are wrong.
--
-- This re-derives, per (company, product, warehouse), the running balances on a
-- cumulative net-cost basis:
--     running_qty      = Σ(direction × quantity)      up to each row
--     running_avg_cost = Σ(direction × total_cost) / running_qty   (2 dp)
-- so the on-hand valuation ties to the booked cost (= GL 1300). It touches ONLY
-- the stock_ledger running_* columns — NOT total_cost, NOT the GL, NOT P&L.
-- (A tiny <0.02% rounding residual remains from the 2-dp running_avg_cost column;
-- phase29c relaxes E1's tolerance to absorb it.)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.recompute_stock_valuation(p_company_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_rows INTEGER;
BEGIN
  WITH cum AS (
    SELECT id,
      SUM(direction * quantity)   OVER w AS cq,
      SUM(direction * total_cost) OVER w AS cc
    FROM public.stock_ledger
    WHERE p_company_id IS NULL OR company_id = p_company_id
    WINDOW w AS (
      PARTITION BY company_id, product_id, warehouse_id
      ORDER BY created_at, id          -- matches how E1 picks the latest row (created_at DESC)
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
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_stock_valuation(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_stock_valuation(UUID) TO authenticated;

-- One-time remediation: re-derive every company's running stock valuation.
SELECT public.recompute_stock_valuation();

NOTIFY pgrst, 'reload schema';
