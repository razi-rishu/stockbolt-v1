-- phase94: AR/AP aging nets off a note that has already been settled
--
-- B1 (AR Aging = 1200) reported a 131.25 difference on Pro_Parts while every
-- contact's receivable reconciled exactly and the trial balance balanced. The
-- data was right and the CHECK was wrong.
--
-- CN-1004 (JUMA ARIF, 131.25) was refunded in cash by CCR-1002. The credit
-- note credits 1200; the refund debits 1200 straight back. Net effect on the
-- receivable: zero, which is exactly what the control account showed. But the
-- invariant subtracted every confirmed credit note at FULL value regardless,
-- so it reported aging of 0.10 - 131.25 = -131.15 against a control of 0.10.
-- A negative aging total is not a thing; that was the tell.
--
-- Both sides are fixed, because B2 carried the identical formula for debit
-- notes. It had never fired for the uninteresting reason that no debit note
-- has ever been raised. Fixed rather than left as a landmine, which is the
-- same call phase93 made on confirm_debit_note.
--
-- The settlement subqueries are DATE-FILTERED, so an as-of date before the
-- refund still sees the note as outstanding. Aging as at a past date has to
-- answer as at that date.
--
-- Body read from the live database with pg_get_functiondef and patched by
-- anchor, each anchor required to match exactly once.
--
-- Rollback: re-apply the previous definition from migration history; this
-- function is pure derivation and holds no state.

BEGIN;

CREATE OR REPLACE FUNCTION public.verify_invariants(p_company_id uuid, p_as_of_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tol         NUMERIC := 0.01;
  v_stock_tol   NUMERIC := 0.01;
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
  v_unattributed INTEGER := 0;   -- Phase 70 (S6)
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

  -- 3. AR Aging = AR (1200) — open invoices, less any credit note still owed
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

  -- Phase 94 - a credit note only stands against the receivable while it is
  -- UNSETTLED. Once it has been refunded in cash the refund debits 1200
  -- straight back (source_type 'customer_credit_refund'), so the credit is
  -- already gone from the control account; subtracting the note's full value
  -- here counts it a second time and drives the aging negative. Applying the
  -- note to another document has the same effect. Both are netted off, and
  -- both are dated, so an as-of date BEFORE the settlement still sees the
  -- note as outstanding.
  v_ar_aging := v_ar_aging - COALESCE((
    SELECT SUM(
      cn.total_amount
      - COALESCE((SELECT SUM(p.amount) FROM payments p
                   WHERE p.source_doc_type = 'credit_note'
                     AND p.source_doc_id   = cn.id
                     AND p.status           = 'confirmed'
                     AND p.date            <= p_as_of_date), 0)
      - COALESCE((SELECT SUM(pa.amount_applied)
                    FROM payment_allocations pa
                    JOIN payments p2 ON p2.id = pa.payment_id
                   WHERE pa.doc_type = 'credit_note'
                     AND pa.doc_id   = cn.id
                     AND p2.status   = 'confirmed'
                     AND p2.date    <= p_as_of_date), 0)
    )
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

  -- Phase 94 - the vendor-side mirror. This one had not fired yet only
  -- because no debit note exists in any company; the arithmetic was just as
  -- wrong as the AR side, waiting for the first refunded debit note.
  v_ap_aging := v_ap_aging - COALESCE((
    SELECT SUM(
      dn.total_amount
      - COALESCE((SELECT SUM(p.amount) FROM payments p
                   WHERE p.source_doc_type = 'debit_note'
                     AND p.source_doc_id   = dn.id
                     AND p.status           = 'confirmed'
                     AND p.date            <= p_as_of_date), 0)
      - COALESCE((SELECT SUM(pa.amount_applied)
                    FROM payment_allocations pa
                    JOIN payments p2 ON p2.id = pa.payment_id
                   WHERE pa.doc_type = 'debit_note'
                     AND pa.doc_id   = dn.id
                     AND p2.status   = 'confirmed'
                     AND p2.date    <= p_as_of_date), 0)
    )
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
    ORDER BY product_id, warehouse_id, seq DESC
  ) latest;

  SELECT COALESCE(SUM(debit - credit), 0)
  INTO v_inv_tb
  FROM general_ledger
  WHERE company_id = p_company_id AND account_code = '1300' AND date <= p_as_of_date;

  -- E1 tolerance: 0.01% of inventory value, min 1.00 — absorbs 2-dp running_avg_cost
  -- rounding across large quantities while still catching material drift.
  v_stock_tol := GREATEST(1.00, 0.0001 * ABS(v_inv_tb));

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

  -- 7b. Control-account attribution (Phase 70 / S6)
  -- 1200, 2100, 2400 and 1400 are per-party accounts: each is the control
  -- total for a sub-ledger kept per customer or supplier. A line on one of
  -- them with no contact moves the control account while nobody's
  -- sub-ledger moves, so the two disagree from then on.
  --
  -- Nothing else catches this. The entry still balances, the trial balance
  -- still nets to zero, and B1/B2 compare TOTALS which both shift together.
  -- Only attribution coverage exposes it.
  SELECT COUNT(*)
  INTO v_unattributed
  FROM general_ledger
  WHERE company_id    = p_company_id
    AND date         <= p_as_of_date
    AND account_code IN ('1200', '2100', '2400', '1400')
    AND contact_id IS NULL;

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
      'pass', ABS(v_stock_val - v_inv_tb) <= v_stock_tol,
      'stock_val', v_stock_val, 'inv_tb', v_inv_tb, 'difference', ABS(v_stock_val - v_inv_tb),
      'tolerance', v_stock_tol),
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
      'pass', v_bad_je_cnt = 0, 'bad_je_count', v_bad_je_cnt, 'difference', v_bad_je_cnt),
    jsonb_build_object('name','Control accounts name a party (1200/2100/2400/1400)','invariant','B3',
      'pass', v_unattributed = 0,
      'unattributed_lines', v_unattributed, 'difference', v_unattributed)
  );
END;
$function$;

COMMIT;
