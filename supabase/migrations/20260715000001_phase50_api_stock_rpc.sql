-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 50: Public API read endpoints (M-API 2) — stock RPC
-- ─────────────────────────────────────────────────────────────────────────
-- One aggregate for the API's `GET /v1/products?include=stock`: current
-- on-hand qty per product, summed across warehouses, computed the same way
-- the app does (SUM(direction × quantity) over stock_ledger) so API numbers
-- always match the dashboard/valuation.
--
-- SERVICE-ROLE ONLY: the Edge Function passes the tenant's company_id after
-- validating their API key. Not callable by authenticated/anon clients, so
-- it can't be used to probe another company (the function takes an arbitrary
-- company_id — that is exactly why clients must never reach it directly).
-- Additive + idempotent.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.api_current_stock(p_company_id uuid)
RETURNS TABLE(product_id uuid, qty numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT sl.product_id, COALESCE(SUM(sl.direction * sl.quantity), 0) AS qty
  FROM public.stock_ledger sl
  WHERE sl.company_id = p_company_id
    AND sl.product_id IS NOT NULL
  GROUP BY sl.product_id
$$;

REVOKE ALL ON FUNCTION public.api_current_stock(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_current_stock(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.api_current_stock(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.api_current_stock(uuid) TO service_role;

COMMENT ON FUNCTION public.api_current_stock(uuid) IS
  'Phase 50 — per-product on-hand qty for the public API (service_role only; Edge Function enforces tenant).';
