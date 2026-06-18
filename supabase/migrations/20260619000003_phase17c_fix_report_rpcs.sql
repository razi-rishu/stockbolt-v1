-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Fix two more broken report RPCs (found via plpgsql_check)
-- ─────────────────────────────────────────────────────────────────────────
-- Read-only reports — NO posting/GL-engine change.
--
-- 1) get_daily_cash_report — queried the nonexistent `journal_entry_lines`
--    table and `journal_entries.is_reversed` column (same bug class as
--    get_bank_recon). Rewritten to read `general_ledger`, excluding reversed
--    pairs. The Daily Cash report (/reports/daily-cash) was returning nothing.
--
-- 2) find_stock_mismatches — `column reference "product_id" is ambiguous`
--    (the RETURNS TABLE OUT column vs the CTE column). Qualified with the
--    CTE alias `latest`. The stock-value reconciliation report errored.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1) get_daily_cash_report → general_ledger ────────────────────────────
CREATE OR REPLACE FUNCTION get_daily_cash_report(
  p_company_id  UUID,
  p_date        DATE
)
RETURNS TABLE (
  account_id       UUID,
  account_code     TEXT,
  account_name     TEXT,
  opening_balance  NUMERIC,
  total_in         NUMERIC,
  total_out        NUMERIC,
  closing_balance  NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH bank_coa AS (
    SELECT DISTINCT ba.coa_account_id
    FROM   bank_accounts ba
    WHERE  ba.company_id = p_company_id
      AND  ba.coa_account_id IS NOT NULL
  ),
  opening AS (
    SELECT gl.account_id,
           SUM(gl.debit - gl.credit) AS opening_balance
    FROM   general_ledger gl
    JOIN   bank_coa bc ON bc.coa_account_id = gl.account_id
    WHERE  gl.company_id = p_company_id
      AND  gl.date < p_date
      AND  gl.reversal_of_id IS NULL
      AND  gl.id NOT IN (SELECT r.reversal_of_id FROM general_ledger r
                          WHERE r.company_id = p_company_id AND r.reversal_of_id IS NOT NULL)
    GROUP  BY gl.account_id
  ),
  day_flows AS (
    SELECT gl.account_id,
           SUM(CASE WHEN gl.debit  > 0 THEN gl.debit  ELSE 0 END) AS total_in,
           SUM(CASE WHEN gl.credit > 0 THEN gl.credit ELSE 0 END) AS total_out
    FROM   general_ledger gl
    JOIN   bank_coa bc ON bc.coa_account_id = gl.account_id
    WHERE  gl.company_id = p_company_id
      AND  gl.date = p_date
      AND  gl.reversal_of_id IS NULL
      AND  gl.id NOT IN (SELECT r.reversal_of_id FROM general_ledger r
                          WHERE r.company_id = p_company_id AND r.reversal_of_id IS NOT NULL)
    GROUP  BY gl.account_id
  )
  SELECT
    ca.id, ca.code, ca.name,
    COALESCE(o.opening_balance, 0),
    COALESCE(d.total_in,  0),
    COALESCE(d.total_out, 0),
    COALESCE(o.opening_balance, 0) + COALESCE(d.total_in, 0) - COALESCE(d.total_out, 0)
  FROM   bank_coa bc
  JOIN   chart_of_accounts ca ON ca.id = bc.coa_account_id
  LEFT   JOIN opening   o ON o.account_id = bc.coa_account_id
  LEFT   JOIN day_flows d ON d.account_id = bc.coa_account_id
  WHERE  ca.company_id = p_company_id
  ORDER  BY ca.code;
END;
$$;

GRANT EXECUTE ON FUNCTION get_daily_cash_report(UUID, DATE) TO authenticated;

-- ── 2) find_stock_mismatches → qualify ambiguous product_id ───────────────
CREATE OR REPLACE FUNCTION public.find_stock_mismatches(
  p_company_id  UUID,
  p_as_of_date  DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  product_id     UUID,
  product_name   TEXT,
  sku            TEXT,
  stock_value    NUMERIC,
  stock_txn_sum  NUMERIC,
  difference     NUMERIC
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_tol NUMERIC := 0.01;
BEGIN
  RETURN QUERY
  WITH
    latest AS (
      SELECT DISTINCT ON (sl.product_id, sl.warehouse_id)
        sl.product_id, sl.running_qty, sl.running_avg_cost
      FROM stock_ledger sl
      WHERE sl.company_id = p_company_id
        AND sl.date <= p_as_of_date
      ORDER BY sl.product_id, sl.warehouse_id, sl.created_at DESC
    ),
    stock_val_per_product AS (
      -- qualify with the CTE alias so it is unambiguous vs the OUT column
      SELECT latest.product_id AS pid, SUM(latest.running_qty * latest.running_avg_cost) AS val
      FROM latest
      GROUP BY latest.product_id
    ),
    txn_sum_per_product AS (
      SELECT sl.product_id AS pid,
             SUM(sl.quantity * sl.direction * sl.unit_cost) AS txn_sum
      FROM stock_ledger sl
      WHERE sl.company_id = p_company_id
        AND sl.date <= p_as_of_date
      GROUP BY sl.product_id
    ),
    combined AS (
      SELECT COALESCE(v.pid, t.pid) AS pid,
             COALESCE(v.val, 0)     AS stock_value,
             COALESCE(t.txn_sum, 0) AS stock_txn_sum
      FROM stock_val_per_product v
      FULL OUTER JOIN txn_sum_per_product t ON t.pid = v.pid
    )
  SELECT
    cb.pid,
    COALESCE(p.name, '—'),
    COALESCE(p.sku, '—'),
    cb.stock_value,
    cb.stock_txn_sum,
    cb.stock_value - cb.stock_txn_sum
  FROM combined cb
  LEFT JOIN products p ON p.id = cb.pid
  WHERE ABS(cb.stock_value - cb.stock_txn_sum) > v_tol
  ORDER BY ABS(cb.stock_value - cb.stock_txn_sum) DESC;
END;
$$;
