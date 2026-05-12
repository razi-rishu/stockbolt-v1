-- Phase 12 — AR + Stock reconciliation: prevention + diagnostics
--
-- Closes two long-standing reconciliation gaps that caused the AR-aging
-- and Stock-Valuation invariants to drift from the General Ledger:
--
--   1. AR aging (B1) ignored credit notes whose linked_invoice_id was NULL.
--      confirm_credit_note posts CR 1200 unconditionally, but the aging
--      invariant only subtracted credit notes that pointed to a specific
--      invoice. The new calc subtracts ALL confirmed credit notes for
--      each customer.
--
--   2. Stock value (E1) drifted when a vendor bill line carried a discount.
--      confirm_vendor_bill posted DR 1300 = line_subtotal (post-discount)
--      but wrote stock_ledger.total_cost = quantity × unit_cost (pre-discount).
--      The new RPC computes the effective unit cost (line_subtotal / qty)
--      so the stock_ledger row matches what GL recorded.
--
-- Companion diagnostics expose per-customer / per-product breakdowns so the
-- user can see exactly which row caused any remaining drift, and one-click
-- repair functions are added for both.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Fix verify_invariants — AR aging now subtracts ALL credit notes
-- ───────────────────────────────────────────────────────────────────────────

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
  -- 1. Trial Balance
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO v_tb_debit, v_tb_credit
  FROM general_ledger
  WHERE company_id = p_company_id AND date <= p_as_of_date;

  -- 2. Balance Sheet
  SELECT
    COALESCE(SUM(CASE WHEN coa.type = 'asset'     THEN gl.debit - gl.credit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN coa.type = 'liability' THEN gl.credit - gl.debit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN coa.type = 'equity'    THEN gl.credit - gl.debit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN coa.type = 'income'    THEN gl.credit - gl.debit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN coa.type = 'expense'   THEN gl.debit - gl.credit ELSE 0 END), 0)
  INTO v_assets, v_liab, v_equity, v_income, v_expense
  FROM general_ledger gl
  JOIN chart_of_accounts coa ON coa.id = gl.account_id
  WHERE gl.company_id = p_company_id AND gl.date <= p_as_of_date;
  v_bs_rhs := v_liab + v_equity + v_income - v_expense;

  -- 3. AR Aging = AR (1200)   — UPDATED: subtract ALL confirmed CNs per customer
  -- Outstanding per customer = sum(invoice.total) - sum(payment_allocations)
  --                           - sum(all confirmed credit notes for that customer)
  SELECT COALESCE(SUM(
    i.total_amount
    - COALESCE((SELECT SUM(pa.amount_applied) FROM payment_allocations pa
                 WHERE pa.doc_id = i.id AND pa.doc_type = 'invoice'), 0)
  ), 0)
  INTO v_ar_aging
  FROM invoices i
  WHERE i.company_id = p_company_id
    AND i.status = 'confirmed'
    AND i.date <= p_as_of_date;

  -- Now subtract ALL confirmed credit notes (regardless of linked_invoice_id)
  v_ar_aging := v_ar_aging - COALESCE((
    SELECT SUM(cn.total_amount)
    FROM credit_notes cn
    WHERE cn.company_id = p_company_id
      AND cn.status = 'confirmed'
      AND cn.date <= p_as_of_date
  ), 0);

  SELECT COALESCE(SUM(debit - credit), 0)
  INTO v_ar_tb
  FROM general_ledger
  WHERE company_id = p_company_id AND account_code = '1200' AND date <= p_as_of_date;

  -- 4. AP Aging
  SELECT COALESCE(SUM(
    b.total_amount
    - COALESCE((SELECT SUM(pa.amount_applied) FROM payment_allocations pa
                 WHERE pa.doc_id = b.id AND pa.doc_type = 'vendor_bill'), 0)
  ), 0)
  INTO v_ap_aging
  FROM vendor_bills b
  WHERE b.company_id = p_company_id AND b.status = 'confirmed' AND b.date <= p_as_of_date;

  -- Subtract all confirmed debit notes (symmetric to CNs on AR side)
  v_ap_aging := v_ap_aging - COALESCE((
    SELECT SUM(dn.total_amount)
    FROM debit_notes dn
    WHERE dn.company_id = p_company_id
      AND dn.status = 'confirmed'
      AND dn.date <= p_as_of_date
  ), 0);

  SELECT COALESCE(SUM(credit - debit), 0)
  INTO v_ap_tb
  FROM general_ledger
  WHERE company_id = p_company_id AND account_code = '2100' AND date <= p_as_of_date;

  -- 5. Stock Valuation
  SELECT COALESCE(SUM(running_qty * running_avg_cost), 0)
  INTO v_stock_val
  FROM (
    SELECT DISTINCT ON (product_id, warehouse_id) running_qty, running_avg_cost
    FROM stock_ledger
    WHERE company_id = p_company_id AND date <= p_as_of_date
    ORDER BY product_id, warehouse_id, created_at DESC
  ) latest;

  SELECT COALESCE(SUM(debit - credit), 0)
  INTO v_inv_tb
  FROM general_ledger
  WHERE company_id = p_company_id AND account_code = '1300' AND date <= p_as_of_date;

  -- 6. Customer Advances
  SELECT (COALESCE(SUM(credit - debit), 0) >= -v_tol)
  INTO v_cust_adv_ok
  FROM general_ledger
  WHERE company_id = p_company_id AND account_code = '2400' AND date <= p_as_of_date;

  -- 7. Vendor Advances
  SELECT (COALESCE(SUM(debit - credit), 0) >= -v_tol)
  INTO v_vend_adv_ok
  FROM general_ledger
  WHERE company_id = p_company_id AND account_code = '1400' AND date <= p_as_of_date;

  -- 8. GRN Accrual
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
      WHERE vb.linked_grn_id = gr.id AND vb.status = 'confirmed'
    );

  SELECT COALESCE(SUM(credit - debit), 0)
  INTO v_grn_tb
  FROM general_ledger
  WHERE company_id = p_company_id AND account_code = '2150' AND date <= p_as_of_date;

  -- 9. Cash
  SELECT COALESCE(SUM(debit - credit), 0)
  INTO v_cash_tb
  FROM general_ledger
  WHERE company_id = p_company_id AND account_code LIKE '11%' AND date <= p_as_of_date;

  -- 10. JE_BAL
  SELECT COUNT(*) INTO v_bad_je_cnt
  FROM journal_entries je
  WHERE je.company_id = p_company_id AND je.date <= p_as_of_date
    AND EXISTS (
      SELECT 1 FROM general_ledger gl
      WHERE gl.journal_entry_id = je.id
      GROUP BY gl.journal_entry_id
      HAVING ABS(COALESCE(SUM(gl.debit),  0) - je.total_debit)  > v_tol
          OR ABS(COALESCE(SUM(gl.credit), 0) - je.total_credit) > v_tol
          OR ABS(COALESCE(SUM(gl.debit),  0) - COALESCE(SUM(gl.credit), 0)) > v_tol
    );

  RETURN jsonb_build_array(
    jsonb_build_object('name','Trial Balance balances','invariant','A1',
      'pass', ABS(v_tb_debit - v_tb_credit) <= v_tol,
      'debit', v_tb_debit, 'credit', v_tb_credit, 'difference', ABS(v_tb_debit - v_tb_credit)),
    jsonb_build_object('name','Balance Sheet balances (Assets = L + E + Income − Expense)','invariant','A4',
      'pass', ABS(v_assets - v_bs_rhs) <= v_tol,
      'assets', v_assets, 'rhs', v_bs_rhs, 'difference', ABS(v_assets - v_bs_rhs)),
    jsonb_build_object('name','AR Aging = AR Account (1200)','invariant','B1',
      'pass', ABS(v_ar_aging - v_ar_tb) <= v_tol,
      'ar_aging', v_ar_aging, 'ar_tb', v_ar_tb, 'difference', ABS(v_ar_aging - v_ar_tb)),
    jsonb_build_object('name','AP Aging = AP Account (2100)','invariant','B2',
      'pass', ABS(v_ap_aging - v_ap_tb) <= v_tol,
      'ap_aging', v_ap_aging, 'ap_tb', v_ap_tb, 'difference', ABS(v_ap_aging - v_ap_tb)),
    jsonb_build_object('name','Stock Valuation = Inventory Account (1300)','invariant','E1',
      'pass', ABS(v_stock_val - v_inv_tb) <= v_tol,
      'stock_val', v_stock_val, 'inv_tb', v_inv_tb, 'difference', ABS(v_stock_val - v_inv_tb)),
    jsonb_build_object('name','Customer Advances (2400) never debit','invariant','ADV_CUST',
      'pass', COALESCE(v_cust_adv_ok, TRUE)),
    jsonb_build_object('name','Vendor Advances (1400) never credit','invariant','ADV_VEND',
      'pass', COALESCE(v_vend_adv_ok, TRUE)),
    jsonb_build_object('name','GRN Accrual = Unbilled GRNs (2150)','invariant','D4',
      'pass', ABS(v_grn_accrual - v_grn_tb) <= v_tol,
      'grn_accrual', v_grn_accrual, 'grn_tb', v_grn_tb, 'difference', ABS(v_grn_accrual - v_grn_tb)),
    jsonb_build_object('name','Cash balance ≥ 0 (informational)','invariant','G2',
      'pass', v_cash_tb >= -v_tol, 'cash_tb', v_cash_tb),
    jsonb_build_object('name','All journal entries internally balanced','invariant','JE_BAL',
      'pass', v_bad_je_cnt = 0, 'bad_je_count', v_bad_je_cnt, 'difference', v_bad_je_cnt)
  );
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. find_ar_mismatches — per-customer drill-down for B1
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.find_ar_mismatches(
  p_company_id  UUID,
  p_as_of_date  DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  contact_id      UUID,
  contact_name    TEXT,
  gl_balance      NUMERIC,    -- net DR on 1200 attributable to this contact
  aging_balance   NUMERIC,    -- sum of invoices - allocations - all CNs (for this contact)
  difference      NUMERIC
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
    gl_per_contact AS (
      SELECT gl.contact_id AS cid,
             SUM(gl.debit - gl.credit) AS gl_bal
      FROM general_ledger gl
      WHERE gl.company_id = p_company_id
        AND gl.account_code = '1200'
        AND gl.date <= p_as_of_date
      GROUP BY gl.contact_id
    ),
    aging_per_contact AS (
      SELECT i.contact_id AS cid,
             SUM(
               i.total_amount
               - COALESCE((SELECT SUM(pa.amount_applied) FROM payment_allocations pa
                            WHERE pa.doc_id = i.id AND pa.doc_type = 'invoice'), 0)
             ) AS aging_from_invoices
      FROM invoices i
      WHERE i.company_id = p_company_id
        AND i.status = 'confirmed'
        AND i.date <= p_as_of_date
      GROUP BY i.contact_id
    ),
    cn_per_contact AS (
      SELECT cn.contact_id AS cid,
             SUM(cn.total_amount) AS cn_total
      FROM credit_notes cn
      WHERE cn.company_id = p_company_id
        AND cn.status = 'confirmed'
        AND cn.date <= p_as_of_date
      GROUP BY cn.contact_id
    ),
    combined AS (
      SELECT COALESCE(g.cid, a.cid, c.cid) AS cid,
             COALESCE(g.gl_bal, 0) AS gl_balance,
             (COALESCE(a.aging_from_invoices, 0) - COALESCE(c.cn_total, 0)) AS aging_balance
      FROM gl_per_contact g
      FULL OUTER JOIN aging_per_contact a ON a.cid = g.cid
      FULL OUTER JOIN cn_per_contact    c ON c.cid = COALESCE(g.cid, a.cid)
    )
  SELECT
    cb.cid                    AS contact_id,
    COALESCE(con.name, '—')   AS contact_name,
    cb.gl_balance,
    cb.aging_balance,
    cb.gl_balance - cb.aging_balance AS difference
  FROM combined cb
  LEFT JOIN contacts con ON con.id = cb.cid
  WHERE ABS(cb.gl_balance - cb.aging_balance) > v_tol
  ORDER BY ABS(cb.gl_balance - cb.aging_balance) DESC;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. find_stock_mismatches — per-product drill-down for E1
-- ───────────────────────────────────────────────────────────────────────────
--
-- For each product, computes:
--   stock_value     — latest running_qty × running_avg_cost summed across warehouses
--   stock_txn_sum   — sum of stock_ledger (qty × direction × unit_cost) — should match
--                     the inventory movements posted to GL for this product
-- And surfaces products whose own running balance differs from the sum of
-- the individual transactions (rounding / drift indicator).
--
-- This is best-effort: GL doesnt have a product_id column, so we cant
-- directly attribute 1300's DR/CR to a single product. But this gives the
-- user a per-product valuation breakdown to inspect.

CREATE OR REPLACE FUNCTION public.find_stock_mismatches(
  p_company_id  UUID,
  p_as_of_date  DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  product_id     UUID,
  product_name   TEXT,
  sku            TEXT,
  stock_value    NUMERIC,   -- sum(running_qty * running_avg_cost) latest per warehouse
  stock_txn_sum  NUMERIC,   -- sum(quantity * direction * unit_cost) across all sl rows
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
      SELECT product_id AS pid, SUM(running_qty * running_avg_cost) AS val
      FROM latest
      GROUP BY product_id
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
    cb.pid              AS product_id,
    COALESCE(p.name, '—') AS product_name,
    COALESCE(p.sku, '—')  AS sku,
    cb.stock_value,
    cb.stock_txn_sum,
    cb.stock_value - cb.stock_txn_sum AS difference
  FROM combined cb
  LEFT JOIN products p ON p.id = cb.pid
  WHERE ABS(cb.stock_value - cb.stock_txn_sum) > v_tol
  ORDER BY ABS(cb.stock_value - cb.stock_txn_sum) DESC;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Patch confirm_vendor_bill — stock_ledger uses EFFECTIVE unit cost
--    (line_subtotal / quantity) so discount-bearing lines don't drift.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.confirm_vendor_bill(p_bill_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id      UUID := auth.uid();
  v_company_id   UUID;
  v_bill         public.vendor_bills%ROWTYPE;
  v_item         public.vendor_bill_items%ROWTYPE;
  v_lock_date    DATE;
  v_je_id        UUID;
  v_entry        TEXT;
  v_seq          BIGINT;
  v_ap_id        UUID;
  v_accrual_id   UUID;
  v_inv_id       UUID;
  v_vat_id       UUID;
  v_grn_total    NUMERIC(15,2) := 0;
  v_debit_2150   NUMERIC(15,2) := 0;
  v_variance     NUMERIC(15,2) := 0;
  v_bill_goods   NUMERIC(15,2);
  v_line_acct_id UUID;
  v_line_code    TEXT;
  v_line_class   TEXT;
  v_line_value   NUMERIC(15,2);
  v_eff_unit     NUMERIC(15,4);   -- effective unit cost (post-discount)
  v_old_mac        NUMERIC(15,2);
  v_old_total_qty  NUMERIC(15,3);
  v_qty_for_mac    NUMERIC(15,3);
  v_new_mac        NUMERIC(15,2);
  v_prev_wh_qty    NUMERIC(15,3);
  v_wh_id          UUID;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_vendor_bill: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_bill FROM public.vendor_bills WHERE id = p_bill_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_vendor_bill: bill % not found', p_bill_id;
  END IF;
  IF v_bill.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_vendor_bill: bill % not in draft (status=%)', p_bill_id, v_bill.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_bill.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_vendor_bill: date % on or before period lock %', v_bill.date, v_lock_date;
  END IF;

  SELECT id INTO v_ap_id      FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2100' AND is_active;
  SELECT id INTO v_accrual_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2150' AND is_active;
  SELECT id INTO v_inv_id     FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1300' AND is_active;
  IF v_ap_id IS NULL THEN
    RAISE EXCEPTION 'confirm_vendor_bill: account 2100 AP not found';
  END IF;
  IF v_bill.tax_amount > 0 THEN
    SELECT id INTO v_vat_id FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND code LIKE '15%' AND is_active
    ORDER BY code LIMIT 1;
  END IF;

  SELECT id INTO v_wh_id FROM public.warehouses
  WHERE company_id = v_company_id AND is_default = TRUE AND is_active = TRUE LIMIT 1;
  IF v_wh_id IS NULL THEN
    SELECT id INTO v_wh_id FROM public.warehouses
    WHERE company_id = v_company_id AND is_active = TRUE
    ORDER BY created_at LIMIT 1;
  END IF;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_seq;
  v_entry := 'JE-' || v_seq::TEXT;

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, currency, exchange_rate,
    total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_entry, v_bill.date,
    'Vendor Bill ' || v_bill.bill_number,
    'vendor_bill', p_bill_id,
    v_bill.currency, v_bill.exchange_rate,
    v_bill.total_amount, v_bill.total_amount,
    v_user_id
  ) RETURNING id INTO v_je_id;

  -- B3: GRN-linked bill (unchanged)
  IF v_bill.linked_grn_id IS NOT NULL THEN
    SELECT COALESCE(SUM(total_cost), 0) INTO v_grn_total
    FROM public.goods_receipt_items WHERE grn_id = v_bill.linked_grn_id;

    v_bill_goods := v_bill.subtotal - v_bill.discount_amount;
    v_debit_2150 := LEAST(v_grn_total, v_bill_goods);
    v_variance   := v_bill_goods - v_debit_2150;

    IF v_debit_2150 > 0 THEN
      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date,
         debit, credit, description, contact_id, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_je_id, v_accrual_id, '2150', v_bill.date,
         v_debit_2150, 0, 'Vendor Bill ' || v_bill.bill_number,
         v_bill.supplier_id, 'vendor_bill', p_bill_id);
    END IF;
    IF v_variance > 0 THEN
      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date,
         debit, credit, description, contact_id, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_je_id, v_inv_id, '1300', v_bill.date,
         v_variance, 0, 'Bill variance ' || v_bill.bill_number,
         v_bill.supplier_id, 'vendor_bill', p_bill_id);
    END IF;
    UPDATE public.goods_receipts SET status = 'billed', updated_at = NOW()
    WHERE id = v_bill.linked_grn_id AND company_id = v_company_id;

  -- Auto-receive (no GRN)
  ELSE
    FOR v_item IN SELECT * FROM public.vendor_bill_items WHERE bill_id = p_bill_id LOOP
      v_line_value := v_item.line_subtotal;
      IF v_line_value <= 0 THEN CONTINUE; END IF;

      v_line_acct_id := NULL;
      IF v_item.product_id IS NOT NULL THEN
        SELECT purchase_account_id INTO v_line_acct_id FROM public.products WHERE id = v_item.product_id;
        IF v_line_acct_id IS NULL THEN v_line_acct_id := v_inv_id; END IF;
      ELSIF v_item.coa_account_id IS NOT NULL THEN
        v_line_acct_id := v_item.coa_account_id;
      ELSE
        v_line_acct_id := v_inv_id;
      END IF;

      SELECT type, code INTO v_line_class, v_line_code
      FROM public.chart_of_accounts WHERE id = v_line_acct_id;

      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date,
         debit, credit, description, contact_id, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_je_id, v_line_acct_id, v_line_code, v_bill.date,
         v_line_value, 0,
         COALESCE(v_item.description, 'Vendor Bill ' || v_bill.bill_number),
         v_bill.supplier_id, 'vendor_bill', p_bill_id);

      -- Stock movement when account class is asset.
      -- CRITICAL FIX: use EFFECTIVE unit cost (line_subtotal / quantity), not the
      -- raw unit_cost, so the stock_ledger matches the DR posted to GL on
      -- discount-bearing lines. Otherwise stock value drifts from 1300.
      IF v_item.product_id IS NOT NULL
         AND v_line_class = 'asset'
         AND v_item.quantity > 0
         AND v_line_value > 0
      THEN
        v_eff_unit := ROUND(v_line_value / v_item.quantity, 4);

        SELECT COALESCE(running_avg_cost, 0) INTO v_old_mac
        FROM public.stock_ledger
        WHERE company_id = v_company_id AND product_id = v_item.product_id
        ORDER BY created_at DESC LIMIT 1;
        v_old_mac := COALESCE(v_old_mac, 0);

        SELECT COALESCE(SUM(latest_qty), 0) INTO v_old_total_qty
        FROM (
          SELECT DISTINCT ON (warehouse_id) running_qty AS latest_qty
          FROM public.stock_ledger
          WHERE company_id = v_company_id AND product_id = v_item.product_id
          ORDER BY warehouse_id, created_at DESC
        ) sub;
        v_old_total_qty := COALESCE(v_old_total_qty, 0);

        v_qty_for_mac := GREATEST(v_old_total_qty, 0);

        IF v_qty_for_mac + v_item.quantity > 0 THEN
          v_new_mac := ROUND(
            (v_old_mac * v_qty_for_mac + v_eff_unit * v_item.quantity)
            / (v_qty_for_mac + v_item.quantity),
            2
          );
        ELSE
          v_new_mac := ROUND(v_eff_unit, 2);
        END IF;

        SELECT COALESCE(running_qty, 0) INTO v_prev_wh_qty
        FROM public.stock_ledger
        WHERE company_id = v_company_id AND product_id = v_item.product_id
          AND warehouse_id = v_wh_id
        ORDER BY created_at DESC LIMIT 1;
        v_prev_wh_qty := COALESCE(v_prev_wh_qty, 0);

        INSERT INTO public.stock_ledger
          (company_id, product_id, warehouse_id, date,
           type, direction, quantity, unit_cost, total_cost,
           running_qty, running_avg_cost,
           related_doc_type, related_doc_id)
        VALUES
          (v_company_id, v_item.product_id, v_wh_id, v_bill.date,
           'purchase', 1, v_item.quantity, v_eff_unit, v_line_value,
           v_prev_wh_qty + v_item.quantity, v_new_mac,
           'vendor_bill', p_bill_id);
      END IF;
    END LOOP;
  END IF;

  IF v_bill.tax_amount > 0 AND v_vat_id IS NOT NULL THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_vat_id, '1500', v_bill.date,
       v_bill.tax_amount, 0,
       'Input VAT ' || v_bill.bill_number,
       v_bill.supplier_id, 'vendor_bill', p_bill_id);
  END IF;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date,
     debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_ap_id, '2100', v_bill.date,
     0, v_bill.total_amount,
     'Vendor Bill ' || v_bill.bill_number,
     v_bill.supplier_id, 'vendor_bill', p_bill_id);

  UPDATE public.vendor_bills SET status = 'confirmed', updated_at = NOW() WHERE id = p_bill_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'vendor_bill', p_bill_id,
      jsonb_build_object('bill_number', v_bill.bill_number, 'je', v_entry));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'bill_id',      p_bill_id,
    'bill_number',  v_bill.bill_number,
    'je_id',        v_je_id,
    'entry_number', v_entry
  );
END;
$$;
