-- Phase 5 — confirm_grn RPC
-- B2: DR 1300 Inventory, CR 2150 GRN Accrual
-- Also posts stock_ledger inbound rows + updates running MAC per item.
-- Returns: { grn_id, grn_number, je_id, entry_number }

CREATE OR REPLACE FUNCTION public.confirm_grn(p_grn_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id        UUID := auth.uid();
  v_company_id     UUID;
  v_grn            public.goods_receipts%ROWTYPE;
  v_item           public.goods_receipt_items%ROWTYPE;
  v_lock_date      DATE;
  v_currency       TEXT;
  v_je_id          UUID;
  v_entry          TEXT;
  v_seq            BIGINT;
  -- GL accounts
  v_inv_id         UUID;   -- 1300 Inventory Asset
  v_accrual_id     UUID;   -- 2150 GRN Accrual
  -- Per-item MAC
  v_old_mac        NUMERIC(15,2);
  v_old_total_qty  NUMERIC(15,3);
  v_new_mac        NUMERIC(15,2);
  v_prev_wh_qty    NUMERIC(15,3);
  v_total_cost     NUMERIC(15,2) := 0;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_grn: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_grn FROM public.goods_receipts WHERE id = p_grn_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_grn: GRN % not found', p_grn_id;
  END IF;
  IF v_grn.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_grn: GRN % not in draft (status=%)', p_grn_id, v_grn.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_grn.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_grn: date % on or before period lock %', v_grn.date, v_lock_date;
  END IF;

  SELECT COALESCE(currency, 'AED') INTO v_currency FROM public.companies WHERE id = v_company_id;

  SELECT id INTO v_inv_id     FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1300' AND is_active;
  SELECT id INTO v_accrual_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2150' AND is_active;

  IF v_inv_id IS NULL THEN
    RAISE EXCEPTION 'confirm_grn: account 1300 not found';
  END IF;
  IF v_accrual_id IS NULL THEN
    RAISE EXCEPTION 'confirm_grn: account 2150 not found';
  END IF;

  -- Process each GRN item: compute new MAC + insert stock_ledger row
  FOR v_item IN SELECT * FROM public.goods_receipt_items WHERE grn_id = p_grn_id LOOP
    v_total_cost := v_total_cost + v_item.total_cost;

    -- Company-wide MAC (latest running_avg_cost for this product)
    SELECT COALESCE(running_avg_cost, 0) INTO v_old_mac
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_item.product_id
    ORDER BY created_at DESC LIMIT 1;
    v_old_mac := COALESCE(v_old_mac, 0);

    -- Company-wide current stock (latest running_qty per warehouse, summed)
    SELECT COALESCE(SUM(latest_qty), 0) INTO v_old_total_qty
    FROM (
      SELECT DISTINCT ON (warehouse_id) running_qty AS latest_qty
      FROM public.stock_ledger
      WHERE company_id = v_company_id AND product_id = v_item.product_id
      ORDER BY warehouse_id, created_at DESC
    ) sub;
    v_old_total_qty := COALESCE(v_old_total_qty, 0);

    -- Weighted-average MAC update
    IF v_old_total_qty + v_item.qty_received > 0 THEN
      v_new_mac := ROUND(
        (v_old_mac * v_old_total_qty + v_item.unit_cost * v_item.qty_received) /
        (v_old_total_qty + v_item.qty_received),
        2
      );
    ELSE
      v_new_mac := v_item.unit_cost;
    END IF;

    -- Running qty for this specific warehouse
    SELECT COALESCE(running_qty, 0) INTO v_prev_wh_qty
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_item.product_id
      AND warehouse_id = v_grn.warehouse_id
    ORDER BY created_at DESC LIMIT 1;
    v_prev_wh_qty := COALESCE(v_prev_wh_qty, 0);

    INSERT INTO public.stock_ledger
      (company_id, product_id, warehouse_id, date,
       type, direction, quantity, unit_cost, total_cost,
       running_qty, running_avg_cost,
       related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_item.product_id, v_grn.warehouse_id, v_grn.date,
       'purchase', 1, v_item.qty_received, v_item.unit_cost, v_item.total_cost,
       v_prev_wh_qty + v_item.qty_received, v_new_mac,
       'goods_receipt', p_grn_id);
  END LOOP;

  IF v_total_cost = 0 THEN
    RAISE EXCEPTION 'confirm_grn: GRN % has no items or zero total cost', p_grn_id;
  END IF;

  -- Sequence for JE
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
    v_company_id, v_entry, v_grn.date,
    'Goods Receipt ' || v_grn.grn_number,
    'goods_receipt', p_grn_id,
    v_currency, 1.0,
    v_total_cost, v_total_cost,
    v_user_id
  ) RETURNING id INTO v_je_id;

  -- DR 1300 Inventory
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date,
     debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_inv_id, '1300', v_grn.date,
     v_total_cost, 0,
     'Goods Receipt ' || v_grn.grn_number,
     v_grn.supplier_id, 'goods_receipt', p_grn_id);

  -- CR 2150 GRN Accrual
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date,
     debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_accrual_id, '2150', v_grn.date,
     0, v_total_cost,
     'Goods Receipt ' || v_grn.grn_number,
     v_grn.supplier_id, 'goods_receipt', p_grn_id);

  UPDATE public.goods_receipts SET status = 'received', updated_at = NOW() WHERE id = p_grn_id;

  -- Mark linked PO as received
  IF v_grn.purchase_order_id IS NOT NULL THEN
    UPDATE public.purchase_orders
    SET status = 'received', updated_at = NOW()
    WHERE id = v_grn.purchase_order_id AND company_id = v_company_id
      AND status IN ('draft','sent','partially_received');
  END IF;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'goods_receipt', p_grn_id,
      jsonb_build_object('grn_number', v_grn.grn_number, 'je', v_entry, 'total_cost', v_total_cost));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'grn_id',       p_grn_id,
    'grn_number',   v_grn.grn_number,
    'je_id',        v_je_id,
    'entry_number', v_entry
  );
END;
$$;
