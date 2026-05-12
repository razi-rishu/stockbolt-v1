-- Phase 12 — repair_vendor_bill_je RPC
--
-- Surgical repair for vendor_bill journal entries that were confirmed
-- under the pre-Phase-12 confirm_vendor_bill (the old RPC required
-- coa_account_id on the line; product-based lines have it NULL, so the
-- goods-side DR was never posted).
--
-- For a given JE whose source_type = 'vendor_bill':
--   1. Look up the underlying bill + line items.
--   2. For each line that has a product_id and no matching DR row in the
--      JE, derive the correct account from product.purchase_account_id
--      (falling back to 1300 Inventory) and INSERT the missing DR row.
--   3. If the resolved account is asset class, also INSERT the stock_ledger
--      inbound row + update MAC (mirrors confirm_vendor_bill's auto-receive
--      math exactly).
--   4. No-op if the JE is already balanced (idempotent).
--
-- Returns: { status: 'repaired' | 'already_balanced' | 'partial',
--            rows_added, new_body_debit, new_body_credit }.

CREATE OR REPLACE FUNCTION public.repair_vendor_bill_je(p_je_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_je              public.journal_entries%ROWTYPE;
  v_bill            public.vendor_bills%ROWTYPE;
  v_item            public.vendor_bill_items%ROWTYPE;
  v_company_id      UUID;
  v_line_acct_id    UUID;
  v_line_code       TEXT;
  v_line_class      TEXT;
  v_inv_id          UUID;
  v_body_debit      NUMERIC(15,2) := 0;
  v_body_credit     NUMERIC(15,2) := 0;
  v_wh_id           UUID;
  v_old_mac         NUMERIC(15,2);
  v_old_total_qty   NUMERIC(15,3);
  v_qty_for_mac     NUMERIC(15,3);
  v_new_mac         NUMERIC(15,2);
  v_prev_wh_qty     NUMERIC(15,3);
  v_rows_added      INT := 0;
BEGIN
  -- Load the JE
  SELECT * INTO v_je FROM public.journal_entries WHERE id = p_je_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'repair_vendor_bill_je: JE % not found', p_je_id;
  END IF;
  IF v_je.source_type <> 'vendor_bill' THEN
    RAISE EXCEPTION 'repair_vendor_bill_je: JE % is not from a vendor_bill (source_type=%)', p_je_id, v_je.source_type;
  END IF;

  v_company_id := v_je.company_id;

  -- Load the bill
  SELECT * INTO v_bill FROM public.vendor_bills WHERE id = v_je.source_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'repair_vendor_bill_je: source bill % not found', v_je.source_id;
  END IF;

  -- Already balanced?
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO v_body_debit, v_body_credit
  FROM public.general_ledger
  WHERE journal_entry_id = p_je_id;

  IF ABS(v_body_debit - v_body_credit) < 0.01 THEN
    RETURN jsonb_build_object(
      'status',          'already_balanced',
      'rows_added',      0,
      'new_body_debit',  v_body_debit,
      'new_body_credit', v_body_credit
    );
  END IF;

  -- Default warehouse
  SELECT id INTO v_wh_id FROM public.warehouses
  WHERE company_id = v_company_id AND is_default = TRUE AND is_active = TRUE
  LIMIT 1;
  IF v_wh_id IS NULL THEN
    SELECT id INTO v_wh_id FROM public.warehouses
    WHERE company_id = v_company_id AND is_active = TRUE
    ORDER BY created_at LIMIT 1;
  END IF;

  -- Default 1300 Inventory id (fallback)
  SELECT id INTO v_inv_id FROM public.chart_of_accounts
  WHERE company_id = v_company_id AND code = '1300' AND is_active;

  -- Iterate bill items
  FOR v_item IN SELECT * FROM public.vendor_bill_items WHERE bill_id = v_bill.id LOOP
    IF v_item.line_subtotal <= 0 THEN CONTINUE; END IF;
    IF v_item.product_id IS NULL THEN CONTINUE; END IF;

    -- Resolve the account: product's purchase_account_id, falling back to 1300
    SELECT purchase_account_id INTO v_line_acct_id
    FROM public.products WHERE id = v_item.product_id;
    IF v_line_acct_id IS NULL THEN
      v_line_acct_id := v_inv_id;
    END IF;

    SELECT type, code INTO v_line_class, v_line_code
    FROM public.chart_of_accounts WHERE id = v_line_acct_id;

    -- Skip lines that already have a DR row for this account on this JE
    IF EXISTS (
      SELECT 1 FROM public.general_ledger
      WHERE journal_entry_id = p_je_id
        AND account_id = v_line_acct_id
        AND debit > 0
    ) THEN
      CONTINUE;
    END IF;

    -- Insert the missing DR row
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, p_je_id, v_line_acct_id, v_line_code, v_bill.date,
       v_item.line_subtotal, 0,
       COALESCE(v_item.description, 'Vendor Bill ' || v_bill.bill_number) || ' (repair)',
       v_bill.supplier_id, 'vendor_bill', v_bill.id);

    v_rows_added := v_rows_added + 1;

    -- If asset class, also post the missing stock_ledger row + update MAC.
    -- Skips if a stock_ledger row already exists for this bill+product (idempotent).
    IF v_line_class = 'asset' AND v_item.quantity > 0 AND v_item.unit_cost > 0
       AND NOT EXISTS (
         SELECT 1 FROM public.stock_ledger
         WHERE related_doc_type = 'vendor_bill'
           AND related_doc_id = v_bill.id
           AND product_id = v_item.product_id
       )
    THEN
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
          (v_old_mac * v_qty_for_mac + v_item.unit_cost * v_item.quantity) /
          (v_qty_for_mac + v_item.quantity),
          2
        );
      ELSE
        v_new_mac := v_item.unit_cost;
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
         'purchase', 1, v_item.quantity, v_item.unit_cost,
         v_item.quantity * v_item.unit_cost,
         v_prev_wh_qty + v_item.quantity, v_new_mac,
         'vendor_bill', v_bill.id);
    END IF;
  END LOOP;

  -- Re-check
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO v_body_debit, v_body_credit
  FROM public.general_ledger
  WHERE journal_entry_id = p_je_id;

  -- Audit trail
  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, auth.uid(), 'repair', 'journal_entry', p_je_id,
      jsonb_build_object(
        'bill_number',  v_bill.bill_number,
        'rows_added',   v_rows_added,
        'body_debit',   v_body_debit,
        'body_credit',  v_body_credit
      ));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'status',          CASE WHEN ABS(v_body_debit - v_body_credit) < 0.01 THEN 'repaired' ELSE 'partial' END,
    'rows_added',      v_rows_added,
    'new_body_debit',  v_body_debit,
    'new_body_credit', v_body_credit
  );
END;
$$;
