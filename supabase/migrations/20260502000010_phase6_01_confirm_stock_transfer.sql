-- Phase 6 — confirm_stock_transfer RPC
-- C1: Stock Transfer is GL-neutral (company-wide MAC).
-- Posts TWO stock_ledger rows per line item (transfer_out + transfer_in).
-- Returns: { transfer_id, transfer_number }

CREATE OR REPLACE FUNCTION public.confirm_stock_transfer(p_transfer_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id        UUID := auth.uid();
  v_company_id     UUID;
  v_transfer       public.stock_transfers%ROWTYPE;
  v_item           RECORD;
  v_lock_date      DATE;
  v_from_qty       NUMERIC(15,3);
  v_to_qty         NUMERIC(15,3);
  v_mac            NUMERIC(15,2);
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_stock_transfer: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_transfer
  FROM public.stock_transfers
  WHERE id = p_transfer_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_stock_transfer: transfer % not found', p_transfer_id;
  END IF;
  IF v_transfer.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_stock_transfer: transfer % not in draft (status=%)', p_transfer_id, v_transfer.status;
  END IF;
  IF v_transfer.from_warehouse_id = v_transfer.to_warehouse_id THEN
    RAISE EXCEPTION 'confirm_stock_transfer: from and to warehouse must differ';
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_transfer.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_stock_transfer: date % on or before period lock %', v_transfer.date, v_lock_date;
  END IF;

  -- Process each line item
  FOR v_item IN
    SELECT * FROM public.stock_transfer_items WHERE transfer_id = p_transfer_id
  LOOP
    -- Current company-wide MAC for this product
    SELECT COALESCE(running_avg_cost, 0) INTO v_mac
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_item.product_id
    ORDER BY created_at DESC LIMIT 1;
    v_mac := COALESCE(v_mac, COALESCE(v_item.unit_cost, 0));

    -- Running qty at from_warehouse
    SELECT COALESCE(running_qty, 0) INTO v_from_qty
    FROM public.stock_ledger
    WHERE company_id = v_company_id
      AND product_id = v_item.product_id
      AND warehouse_id = v_transfer.from_warehouse_id
    ORDER BY created_at DESC LIMIT 1;
    v_from_qty := COALESCE(v_from_qty, 0);

    -- Running qty at to_warehouse
    SELECT COALESCE(running_qty, 0) INTO v_to_qty
    FROM public.stock_ledger
    WHERE company_id = v_company_id
      AND product_id = v_item.product_id
      AND warehouse_id = v_transfer.to_warehouse_id
    ORDER BY created_at DESC LIMIT 1;
    v_to_qty := COALESCE(v_to_qty, 0);

    -- Row 1: transfer_out (from warehouse loses stock)
    INSERT INTO public.stock_ledger
      (company_id, product_id, warehouse_id, date,
       type, direction, quantity, unit_cost, total_cost,
       running_qty, running_avg_cost,
       related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_item.product_id, v_transfer.from_warehouse_id, v_transfer.date,
       'transfer_out', -1, v_item.quantity, v_mac, v_mac * v_item.quantity,
       v_from_qty - v_item.quantity, v_mac,
       'stock_transfer', p_transfer_id);

    -- Row 2: transfer_in (to warehouse gains stock)
    INSERT INTO public.stock_ledger
      (company_id, product_id, warehouse_id, date,
       type, direction, quantity, unit_cost, total_cost,
       running_qty, running_avg_cost,
       related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_item.product_id, v_transfer.to_warehouse_id, v_transfer.date,
       'transfer_in', 1, v_item.quantity, v_mac, v_mac * v_item.quantity,
       v_to_qty + v_item.quantity, v_mac,
       'stock_transfer', p_transfer_id);
  END LOOP;

  UPDATE public.stock_transfers
  SET status = 'confirmed', updated_at = NOW()
  WHERE id = p_transfer_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'stock_transfer', p_transfer_id,
      jsonb_build_object('transfer_number', v_transfer.transfer_number));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'transfer_id',     p_transfer_id,
    'transfer_number', v_transfer.transfer_number
  );
END;
$$;
