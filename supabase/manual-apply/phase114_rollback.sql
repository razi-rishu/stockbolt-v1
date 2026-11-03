-- phase114 ROLLBACK - restores verify_invariants, record_tds_deduction and
-- edit_vendor_bill exactly as they were live before phase114.
--
-- WARNING: AP aging in the health check stops counting TDS (B2 fails for
-- every India company with a deduction), TDS can again be withheld on a
-- bill already paid in full, and bills with TDS can be edited.

BEGIN;

-- ROLLBACK GUARD - rollbacks are refused unless this block is deliberately removed.
DO $$ BEGIN
  RAISE EXCEPTION 'ROLLBACK GUARD: this rollback makes AP balances ignore TDS again. Delete this block to run it deliberately.';
END $$;

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

CREATE OR REPLACE FUNCTION public.record_tds_deduction(p_vendor_bill_id uuid, p_section_code text, p_base_amount numeric, p_rate numeric, p_deduction_date date, p_rate_reason text DEFAULT 'section'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user      uuid := auth.uid();
  v_company   uuid := public.current_user_company_id();
  v_bill      public.vendor_bills%ROWTYPE;
  v_amount    numeric;
  v_already   numeric;
  v_ap_code   text := '2100';
  v_je        jsonb;
  v_id        uuid;
BEGIN
  IF v_user IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.auth_require('accounting.write');

  IF p_rate_reason NOT IN ('section','no_pan_206aa','certificate') THEN
    RAISE EXCEPTION 'Unknown TDS rate reason %.', p_rate_reason USING ERRCODE = 'P0001';
  END IF;
  IF p_base_amount IS NULL OR p_base_amount <= 0 THEN
    RAISE EXCEPTION 'TDS base amount must be positive.' USING ERRCODE = 'P0001';
  END IF;
  IF p_rate IS NULL OR p_rate < 0 OR p_rate > 100 THEN
    RAISE EXCEPTION 'TDS rate must be between 0 and 100.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_bill FROM public.vendor_bills
    WHERE id = p_vendor_bill_id AND company_id = v_company
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vendor bill not found.' USING ERRCODE = 'P0001';
  END IF;
  IF v_bill.status <> 'confirmed' THEN
    RAISE EXCEPTION 'TDS can only be deducted against a confirmed bill (status is %).', v_bill.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Mirrors src/lib/tds.ts tdsAmount().
  v_amount := round((round(p_base_amount, 2) * p_rate) / 100, 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'TDS amount computes to zero — nothing to post.' USING ERRCODE = 'P0001';
  END IF;

  -- Never withhold more than the bill is worth.
  SELECT COALESCE(sum(amount), 0) INTO v_already
    FROM public.tds_deductions
   WHERE vendor_bill_id = p_vendor_bill_id AND status = 'posted';
  IF round(v_already + v_amount, 2) > round(v_bill.total_amount, 2) THEN
    RAISE EXCEPTION 'TDS of % would exceed the bill total % (already deducted %).',
      v_amount, v_bill.total_amount, v_already USING ERRCODE = 'P0001';
  END IF;

  -- Dr AP (reduce what is owed to the vendor) / Cr TDS Payable (owed to govt).
  v_je := public.post_journal_entry(jsonb_build_object(
    'date', p_deduction_date::text,
    'description', 'TDS ' || p_section_code || ' — ' || v_bill.bill_number,
    'source_type', 'tds_deduction',
    'source_id', p_vendor_bill_id::text,
    'lines', jsonb_build_array(
      jsonb_build_object('account_code', v_ap_code, 'debit', v_amount, 'credit', 0,
                         'contact_id', v_bill.supplier_id::text),
      jsonb_build_object('account_code', '2320',    'debit', 0,        'credit', v_amount)
    )
  ));

  INSERT INTO public.tds_deductions (
    company_id, vendor_bill_id, contact_id, section_code, base_amount, rate, rate_reason,
    amount, deduction_date, ap_account_code, tds_account_code, journal_entry_id, created_by
  ) VALUES (
    v_company, p_vendor_bill_id, v_bill.supplier_id, p_section_code,
    round(p_base_amount, 2), p_rate, p_rate_reason,
    v_amount, p_deduction_date, v_ap_code, '2320',
    (v_je->>'journal_entry_id')::uuid, v_user
  ) RETURNING id INTO v_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company, v_user, 'record_tds_deduction', 'tds_deduction', v_id,
      jsonb_build_object('vendor_bill_id', p_vendor_bill_id, 'section', p_section_code,
                         'rate', p_rate, 'amount', v_amount));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('deduction_id', v_id, 'amount', v_amount,
                            'journal_entry_id', v_je->>'journal_entry_id', 'status', 'posted');
END;
$function$;

CREATE OR REPLACE FUNCTION public.edit_vendor_bill(p_bill_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id      UUID := auth.uid();
  v_company_id   UUID;
  v_bill         public.vendor_bills%ROWTYPE;
  v_lock_date    DATE;
  v_je           public.journal_entries%ROWTYPE;
  v_gl           public.general_ledger%ROWTYPE;
  v_sl           public.stock_ledger%ROWTYPE;
  v_rev_id       UUID;
  v_rev_entry    TEXT;
  v_seq          BIGINT;
  v_prev_running NUMERIC(15,3);
  v_reversed     INT := 0;
  v_requeued     INT := 0;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'edit_vendor_bill: no company for user';
  END IF;

  SELECT * INTO v_bill FROM public.vendor_bills WHERE id = p_bill_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'edit_vendor_bill: bill % not found', p_bill_id;
  END IF;
  IF v_bill.status <> 'confirmed' THEN
    RAISE EXCEPTION 'edit_vendor_bill: bill must be confirmed (status=%)', v_bill.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_bill.date <= v_lock_date THEN
    RAISE EXCEPTION 'edit_vendor_bill: voucher date % on or before period lock %', v_bill.date, v_lock_date;
  END IF;

  -- Only hard block: payments already applied to this bill.
  IF EXISTS (
    SELECT 1 FROM public.payment_allocations
    WHERE company_id = v_company_id AND doc_type = 'vendor_bill' AND doc_id = p_bill_id
  ) THEN
    RAISE EXCEPTION 'This bill has payments applied. Void or unapply the payment(s) before editing.';
  END IF;

  -- ── Step 1+2: reverse the bill JE AND any deferred-COGS flush JE ───────
  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id
      AND source_id = p_bill_id
      AND source_type IN ('vendor_bill', 'inventory_cogs')
      AND reversed_by_id IS NULL
      AND reversal_of_id IS NULL
  LOOP
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE
      SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
    RETURNING current_value INTO v_seq;
    v_rev_entry := 'JE-' || v_seq::TEXT;
    IF v_lock_date IS NOT NULL AND v_je.date <= v_lock_date THEN
      RAISE EXCEPTION 'Cannot reverse: the original posting dated % is in a locked period (lock %).', v_je.date, v_lock_date;
    END IF;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description,
      source_type, source_id, currency, exchange_rate,
      total_debit, total_credit, reversal_of_id, created_by
    ) VALUES (
      v_company_id, v_rev_entry, v_je.date,
      'Edit Reversal – ' || v_bill.bill_number,
      v_je.source_type, p_bill_id,
      v_je.currency, v_je.exchange_rate,
      v_je.total_credit, v_je.total_debit,
      v_je.id, v_user_id
    ) RETURNING id INTO v_rev_id;

    FOR v_gl IN SELECT * FROM public.general_ledger WHERE journal_entry_id = v_je.id LOOP
      INSERT INTO public.general_ledger (
        company_id, journal_entry_id, account_id, account_code, date,
        debit, credit, description,
        contact_id, related_doc_type, related_doc_id, reversal_of_id
      ) VALUES (
        v_company_id, v_rev_id, v_gl.account_id, v_gl.account_code, v_gl.date,
        v_gl.credit, v_gl.debit,
        'Edit Reversal – ' || v_bill.bill_number,
        v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
      );
    END LOOP;

    UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
    v_reversed := v_reversed + 1;
  END LOOP;

  -- ── Step 3: re-queue deferred-COGS rows this bill flushed ─────────────
  -- They go back to 'pending' so re-confirm re-flushes them at the new MAC.
  UPDATE public.deferred_cogs_queue
  SET status = 'pending', flushed_at = NULL,
      flushed_journal_entry_id = NULL, flush_unit_cost = NULL, updated_at = NOW()
  WHERE company_id = v_company_id
    AND flushed_journal_entry_id IN (
      SELECT id FROM public.journal_entries
      WHERE company_id = v_company_id AND source_id = p_bill_id AND source_type = 'inventory_cogs'
    );
  GET DIAGNOSTICS v_requeued = ROW_COUNT;

  -- ── Step 4: reverse the bill's stock rows (un-receive the goods) ──────
  FOR v_sl IN
    SELECT sl.* FROM public.stock_ledger sl
    WHERE sl.company_id = v_company_id
      AND sl.related_doc_id = p_bill_id
      AND sl.related_doc_type = 'vendor_bill'
      AND sl.reversal_of_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id
      )
  LOOP
    SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_running
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_sl.product_id AND warehouse_id = v_sl.warehouse_id
    ORDER BY seq DESC LIMIT 1;

    INSERT INTO public.stock_ledger (
      company_id, product_id, warehouse_id, date,
      type, direction, quantity, unit_cost, total_cost,
      running_qty, running_avg_cost,
      related_doc_type, related_doc_id, reversal_of_id
    ) VALUES (
      v_company_id, v_sl.product_id, v_sl.warehouse_id, v_sl.date,
      'edit_reversal', -v_sl.direction, v_sl.quantity, v_sl.unit_cost, v_sl.total_cost,
      v_prev_running + v_sl.quantity * (-v_sl.direction),
      v_sl.running_avg_cost,
      'vendor_bill', p_bill_id, v_sl.id
    );
  END LOOP;

  -- ── Step 5: back to draft for editing + re-confirm ───────────────────
  UPDATE public.vendor_bills SET status = 'draft', updated_at = NOW() WHERE id = p_bill_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'edit_reopen', 'vendor_bill', p_bill_id,
      jsonb_build_object('bill_number', v_bill.bill_number,
                         'jes_reversed', v_reversed, 'cogs_requeued', v_requeued));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('bill_id', p_bill_id, 'bill_number', v_bill.bill_number,
                            'status', 'draft', 'cogs_requeued', v_requeued);
END;
$function$;

COMMIT;
