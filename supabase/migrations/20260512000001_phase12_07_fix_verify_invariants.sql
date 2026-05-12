-- Phase 12 — fix verify_invariants RPC + add find_malformed_jes diagnostic
--
-- The previous verify_invariants RPC (Phase 10) referenced columns that do
-- not exist in the actual schema:
--   gl.debit_credit / gl.amount    -> real columns are gl.debit / gl.credit
--   coa.account_type / .account_code -> real columns are coa.type / coa.code
--   vendor_payment_allocations       -> doesn't exist; allocations all live in
--                                       payment_allocations with doc_type filter
-- This made every health check fail silently and is why the Trial Balance
-- imbalance (real GL bug) was undetected for so long.
--
-- This migration:
--   1. Drops + re-creates verify_invariants with correct column names and
--      adds one new invariant: JE_BAL — every journal entry's GL rows sum to
--      the JE header's totals AND debit-side = credit-side per JE.
--   2. Adds a new companion RPC find_malformed_jes(company_id) that returns
--      the specific journal entries that fail JE_BAL, so the user can drill
--      in and void / repost them.

-- ── 1. Replace verify_invariants ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION verify_invariants(
  p_company_id  UUID,
  p_as_of_date  DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_tol         NUMERIC := 0.01;
  v_tb_debit    NUMERIC := 0;
  v_tb_credit   NUMERIC := 0;
  v_assets      NUMERIC := 0;
  v_liab        NUMERIC := 0;
  v_equity      NUMERIC := 0;
  v_income      NUMERIC := 0;
  v_expense     NUMERIC := 0;
  v_bs_rhs      NUMERIC := 0;
  v_ar_aging    NUMERIC := 0;
  v_ar_tb       NUMERIC := 0;
  v_ap_aging    NUMERIC := 0;
  v_ap_tb       NUMERIC := 0;
  v_stock_val   NUMERIC := 0;
  v_inv_tb      NUMERIC := 0;
  v_cust_adv_ok BOOLEAN := TRUE;
  v_vend_adv_ok BOOLEAN := TRUE;
  v_grn_accrual NUMERIC := 0;
  v_grn_tb      NUMERIC := 0;
  v_cash_tb     NUMERIC := 0;
  v_bad_je_cnt  INTEGER := 0;
BEGIN
  -- ── 1. Trial Balance balances ─────────────────────────────────────────────
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO v_tb_debit, v_tb_credit
  FROM general_ledger
  WHERE company_id = p_company_id
    AND date <= p_as_of_date;

  -- ── 2. Balance Sheet balances ────────────────────────────────────────────
  -- Assets (net DR) = Liabilities + Equity (net CR) + Net Income (income net CR − expense net DR)
  SELECT
    COALESCE(SUM(CASE WHEN coa.type = 'asset'     THEN gl.debit - gl.credit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN coa.type = 'liability' THEN gl.credit - gl.debit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN coa.type = 'equity'    THEN gl.credit - gl.debit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN coa.type = 'income'    THEN gl.credit - gl.debit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN coa.type = 'expense'   THEN gl.debit - gl.credit ELSE 0 END), 0)
  INTO v_assets, v_liab, v_equity, v_income, v_expense
  FROM general_ledger gl
  JOIN chart_of_accounts coa ON coa.id = gl.account_id
  WHERE gl.company_id = p_company_id
    AND gl.date <= p_as_of_date;

  v_bs_rhs := v_liab + v_equity + v_income - v_expense;

  -- ── 3. AR Aging = AR (1200) ──────────────────────────────────────────────
  -- AR aging = sum over confirmed invoices of [total - sum(payment_allocations) - linked credit notes]
  SELECT COALESCE(SUM(
    i.total_amount
    - COALESCE((SELECT SUM(pa.amount_applied) FROM payment_allocations pa
                 WHERE pa.doc_id = i.id AND pa.doc_type = 'invoice'), 0)
    - COALESCE((SELECT SUM(cn.total_amount) FROM credit_notes cn
                 WHERE cn.linked_invoice_id = i.id AND cn.status = 'confirmed'), 0)
  ), 0)
  INTO v_ar_aging
  FROM invoices i
  WHERE i.company_id = p_company_id
    AND i.status = 'confirmed'
    AND i.date <= p_as_of_date;

  SELECT COALESCE(SUM(debit - credit), 0)
  INTO v_ar_tb
  FROM general_ledger
  WHERE company_id = p_company_id
    AND account_code = '1200'
    AND date <= p_as_of_date;

  -- ── 4. AP Aging = AP (2100) ──────────────────────────────────────────────
  SELECT COALESCE(SUM(
    b.total_amount
    - COALESCE((SELECT SUM(pa.amount_applied) FROM payment_allocations pa
                 WHERE pa.doc_id = b.id AND pa.doc_type = 'vendor_bill'), 0)
  ), 0)
  INTO v_ap_aging
  FROM vendor_bills b
  WHERE b.company_id = p_company_id
    AND b.status = 'confirmed'
    AND b.date <= p_as_of_date;

  SELECT COALESCE(SUM(credit - debit), 0)
  INTO v_ap_tb
  FROM general_ledger
  WHERE company_id = p_company_id
    AND account_code = '2100'
    AND date <= p_as_of_date;

  -- ── 5. Stock Valuation = Inventory (1300) ────────────────────────────────
  -- Stock value = sum of latest running_qty × running_avg_cost per (product, warehouse)
  SELECT COALESCE(SUM(running_qty * running_avg_cost), 0)
  INTO v_stock_val
  FROM (
    SELECT DISTINCT ON (product_id, warehouse_id) running_qty, running_avg_cost
    FROM stock_ledger
    WHERE company_id = p_company_id
      AND date <= p_as_of_date
    ORDER BY product_id, warehouse_id, created_at DESC
  ) latest_per_pair;

  SELECT COALESCE(SUM(debit - credit), 0)
  INTO v_inv_tb
  FROM general_ledger
  WHERE company_id = p_company_id
    AND account_code = '1300'
    AND date <= p_as_of_date;

  -- ── 6. Customer Advances (2400) never DR balance ─────────────────────────
  SELECT (COALESCE(SUM(credit - debit), 0) >= -v_tol)
  INTO v_cust_adv_ok
  FROM general_ledger
  WHERE company_id = p_company_id
    AND account_code = '2400'
    AND date <= p_as_of_date;

  -- ── 7. Vendor Advances (1400) never CR balance ───────────────────────────
  SELECT (COALESCE(SUM(debit - credit), 0) >= -v_tol)
  INTO v_vend_adv_ok
  FROM general_ledger
  WHERE company_id = p_company_id
    AND account_code = '1400'
    AND date <= p_as_of_date;

  -- ── 8. GRN Accrual = unbilled GRNs (2150) ────────────────────────────────
  SELECT COALESCE(SUM(
    (SELECT COALESCE(SUM(gri.total_cost), 0)
       FROM goods_receipt_items gri
       WHERE gri.grn_id = gr.id)
  ), 0)
  INTO v_grn_accrual
  FROM goods_receipts gr
  WHERE gr.company_id = p_company_id
    AND gr.status IN ('received', 'billed', 'confirmed')
    AND gr.date <= p_as_of_date
    AND NOT EXISTS (
      SELECT 1 FROM vendor_bills vb
      WHERE vb.linked_grn_id = gr.id
        AND vb.status = 'confirmed'
    );

  SELECT COALESCE(SUM(credit - debit), 0)
  INTO v_grn_tb
  FROM general_ledger
  WHERE company_id = p_company_id
    AND account_code = '2150'
    AND date <= p_as_of_date;

  -- ── 9. Cash = 11xx balance ───────────────────────────────────────────────
  SELECT COALESCE(SUM(debit - credit), 0)
  INTO v_cash_tb
  FROM general_ledger
  WHERE company_id = p_company_id
    AND account_code LIKE '11%'
    AND date <= p_as_of_date;

  -- ── 10. NEW — JE_BAL: every journal entry must be internally balanced ────
  -- Counts JEs where header totals don't match the body's sum, OR where the
  -- body itself is debit ≠ credit. Either is a posting bug; use
  -- find_malformed_jes() to see which ones.
  SELECT COUNT(*) INTO v_bad_je_cnt
  FROM journal_entries je
  WHERE je.company_id = p_company_id
    AND je.date <= p_as_of_date
    AND EXISTS (
      SELECT 1
      FROM general_ledger gl
      WHERE gl.journal_entry_id = je.id
      GROUP BY gl.journal_entry_id
      HAVING ABS(COALESCE(SUM(gl.debit),  0) - je.total_debit)  > v_tol
          OR ABS(COALESCE(SUM(gl.credit), 0) - je.total_credit) > v_tol
          OR ABS(COALESCE(SUM(gl.debit),  0) - COALESCE(SUM(gl.credit), 0)) > v_tol
    );

  -- ── Return ────────────────────────────────────────────────────────────────
  RETURN jsonb_build_array(
    jsonb_build_object(
      'name',       'Trial Balance balances',
      'invariant',  'A1',
      'pass',       ABS(v_tb_debit - v_tb_credit) <= v_tol,
      'debit',      v_tb_debit,
      'credit',     v_tb_credit,
      'difference', ABS(v_tb_debit - v_tb_credit)
    ),
    jsonb_build_object(
      'name',       'Balance Sheet balances (Assets = L + E + Income − Expense)',
      'invariant',  'A4',
      'pass',       ABS(v_assets - v_bs_rhs) <= v_tol,
      'assets',     v_assets,
      'rhs',        v_bs_rhs,
      'difference', ABS(v_assets - v_bs_rhs)
    ),
    jsonb_build_object(
      'name',       'AR Aging = AR Account (1200)',
      'invariant',  'B1',
      'pass',       ABS(v_ar_aging - v_ar_tb) <= v_tol,
      'ar_aging',   v_ar_aging,
      'ar_tb',      v_ar_tb,
      'difference', ABS(v_ar_aging - v_ar_tb)
    ),
    jsonb_build_object(
      'name',       'AP Aging = AP Account (2100)',
      'invariant',  'B2',
      'pass',       ABS(v_ap_aging - v_ap_tb) <= v_tol,
      'ap_aging',   v_ap_aging,
      'ap_tb',      v_ap_tb,
      'difference', ABS(v_ap_aging - v_ap_tb)
    ),
    jsonb_build_object(
      'name',       'Stock Valuation = Inventory Account (1300)',
      'invariant',  'E1',
      'pass',       ABS(v_stock_val - v_inv_tb) <= v_tol,
      'stock_val',  v_stock_val,
      'inv_tb',     v_inv_tb,
      'difference', ABS(v_stock_val - v_inv_tb)
    ),
    jsonb_build_object(
      'name',      'Customer Advances (2400) never debit',
      'invariant', 'ADV_CUST',
      'pass',      COALESCE(v_cust_adv_ok, TRUE)
    ),
    jsonb_build_object(
      'name',      'Vendor Advances (1400) never credit',
      'invariant', 'ADV_VEND',
      'pass',      COALESCE(v_vend_adv_ok, TRUE)
    ),
    jsonb_build_object(
      'name',        'GRN Accrual = Unbilled GRNs (2150)',
      'invariant',   'D4',
      'pass',        ABS(v_grn_accrual - v_grn_tb) <= v_tol,
      'grn_accrual', v_grn_accrual,
      'grn_tb',      v_grn_tb,
      'difference',  ABS(v_grn_accrual - v_grn_tb)
    ),
    jsonb_build_object(
      'name',      'Cash balance ≥ 0 (informational)',
      'invariant', 'G2',
      'pass',      v_cash_tb >= -v_tol,
      'cash_tb',   v_cash_tb
    ),
    jsonb_build_object(
      'name',         'All journal entries internally balanced',
      'invariant',    'JE_BAL',
      'pass',         v_bad_je_cnt = 0,
      'bad_je_count', v_bad_je_cnt,
      'difference',   v_bad_je_cnt
    )
  );
END;
$$;

-- ── 2. find_malformed_jes — drill-down for the JE_BAL failure ───────────────

CREATE OR REPLACE FUNCTION find_malformed_jes(
  p_company_id  UUID,
  p_as_of_date  DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  je_id            UUID,
  entry_number     TEXT,
  date             DATE,
  source_type      TEXT,
  source_id        UUID,
  header_debit     NUMERIC,
  header_credit    NUMERIC,
  body_debit       NUMERIC,
  body_credit      NUMERIC,
  delta_vs_header  NUMERIC,
  delta_internal   NUMERIC,
  problem          TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_tol NUMERIC := 0.01;
BEGIN
  RETURN QUERY
  SELECT
    je.id                  AS je_id,
    je.entry_number,
    je.date,
    je.source_type,
    je.source_id,
    je.total_debit         AS header_debit,
    je.total_credit        AS header_credit,
    COALESCE(SUM(gl.debit),  0) AS body_debit,
    COALESCE(SUM(gl.credit), 0) AS body_credit,
    -- max of the two header-mismatch deltas, signed (positive = body > header)
    GREATEST(
      ABS(COALESCE(SUM(gl.debit),  0) - je.total_debit),
      ABS(COALESCE(SUM(gl.credit), 0) - je.total_credit)
    )                      AS delta_vs_header,
    ABS(COALESCE(SUM(gl.debit), 0) - COALESCE(SUM(gl.credit), 0))
                           AS delta_internal,
    CASE
      WHEN COUNT(gl.id) = 0
        THEN 'orphan: JE header has no GL rows'
      WHEN ABS(COALESCE(SUM(gl.debit), 0) - COALESCE(SUM(gl.credit), 0)) > v_tol
        THEN 'unbalanced: body debit ≠ body credit'
      WHEN ABS(COALESCE(SUM(gl.debit),  0) - je.total_debit)  > v_tol
        THEN 'header mismatch: body debit ≠ header total_debit'
      WHEN ABS(COALESCE(SUM(gl.credit), 0) - je.total_credit) > v_tol
        THEN 'header mismatch: body credit ≠ header total_credit'
      ELSE 'ok'
    END                    AS problem
  FROM journal_entries je
  LEFT JOIN general_ledger gl ON gl.journal_entry_id = je.id
  WHERE je.company_id = p_company_id
    AND je.date <= p_as_of_date
  GROUP BY je.id, je.entry_number, je.date, je.source_type, je.source_id,
           je.total_debit, je.total_credit
  HAVING
       COUNT(gl.id) = 0
    OR ABS(COALESCE(SUM(gl.debit),  0) - je.total_debit)  > v_tol
    OR ABS(COALESCE(SUM(gl.credit), 0) - je.total_credit) > v_tol
    OR ABS(COALESCE(SUM(gl.debit),  0) - COALESCE(SUM(gl.credit), 0)) > v_tol
  ORDER BY je.date DESC, je.entry_number DESC;
END;
$$;
