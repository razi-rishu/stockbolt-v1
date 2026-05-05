-- Phase 6 — confirm_inventory_adjustment RPC
-- C2: Found stock  → DR 1300 Inventory, CR 4300 Inventory Gain
-- C3: Shrinkage    → DR 6700 Inventory Loss, CR 1300 Inventory
-- Posts stock_ledger rows per line item.
-- Returns: { adjustment_id, adjustment_number, gain_je_id?, loss_je_id? }

CREATE OR REPLACE FUNCTION public.confirm_inventory_adjustment(p_adjustment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id        UUID := auth.uid();
  v_company_id     UUID;
  v_adj            public.inventory_adjustments%ROWTYPE;
  v_item           RECORD;
  v_lock_date      DATE;
  v_currency       TEXT;
  -- GL account IDs
  v_acct_1300      UUID;
  v_acct_4300      UUID;
  v_acct_6700      UUID;
  -- Totals
  v_total_gain     NUMERIC(15,2) := 0;
  v_total_loss     NUMERIC(15,2) := 0;
  -- JEs
  v_gain_je_id     UUID;
  v_loss_je_id     UUID;
  v_gain_entry     TEXT;
  v_loss_entry     TEXT;
  v_seq            BIGINT;
  -- Per-item
  v_running_qty    NUMERIC(15,3);
  v_mac            NUMERIC(15,2);
  v_item_cost      NUMERIC(15,2);
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_inventory_adjustment: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_adj
  FROM public.inventory_adjustments
  WHERE id = p_adjustment_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_inventory_adjustment: adjustment % not found', p_adjustment_id;
  END IF;
  IF v_adj.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_inventory_adjustment: already confirmed (status=%)', v_adj.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_adj.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_inventory_adjustment: date % on or before period lock %', v_adj.date, v_lock_date;
  END IF;

  SELECT COALESCE(currency, 'AED') INTO v_currency FROM public.companies WHERE id = v_company_id;

  SELECT id INTO v_acct_1300 FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND code = '1300' AND is_active LIMIT 1;
  SELECT id INTO v_acct_4300 FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND code = '4300' AND is_active LIMIT 1;
  SELECT id INTO v_acct_6700 FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND code = '6700' AND is_active LIMIT 1;

  IF v_acct_1300 IS NULL THEN RAISE EXCEPTION 'Account 1300 not found'; END IF;
  IF v_acct_4300 IS NULL THEN RAISE EXCEPTION 'Account 4300 not found'; END IF;
  IF v_acct_6700 IS NULL THEN RAISE EXCEPTION 'Account 6700 not found'; END IF;

  -- Process each line item
  FOR v_item IN
    SELECT * FROM public.inventory_adjustment_items
    WHERE adjustment_id = p_adjustment_id AND difference <> 0
  LOOP
    -- Current MAC for this product
    SELECT COALESCE(running_avg_cost, 0) INTO v_mac
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_item.product_id
    ORDER BY created_at DESC LIMIT 1;
    v_mac := COALESCE(v_mac, 0);

    -- Use provided unit_cost if available (user override), else MAC
    v_item_cost := COALESCE(NULLIF(v_item.unit_cost, 0), v_mac);

    -- Running qty at this warehouse
    SELECT COALESCE(running_qty, 0) INTO v_running_qty
    FROM public.stock_ledger
    WHERE company_id = v_company_id
      AND product_id = v_item.product_id
      AND warehouse_id = v_adj.warehouse_id
    ORDER BY created_at DESC LIMIT 1;
    v_running_qty := COALESCE(v_running_qty, 0);

    IF v_item.difference > 0 THEN
      -- C2: Found stock
      INSERT INTO public.stock_ledger
        (company_id, product_id, warehouse_id, date,
         type, direction, quantity, unit_cost, total_cost,
         running_qty, running_avg_cost,
         related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_item.product_id, v_adj.warehouse_id, v_adj.date,
         'adjustment_in', 1, v_item.difference, v_item_cost, v_item_cost * v_item.difference,
         v_running_qty + v_item.difference, v_mac,
         'inventory_adjustment', p_adjustment_id);
      v_total_gain := v_total_gain + ROUND(v_item_cost * v_item.difference, 2);

    ELSE
      -- C3: Shrinkage / damage
      INSERT INTO public.stock_ledger
        (company_id, product_id, warehouse_id, date,
         type, direction, quantity, unit_cost, total_cost,
         running_qty, running_avg_cost,
         related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_item.product_id, v_adj.warehouse_id, v_adj.date,
         'adjustment_out', -1, ABS(v_item.difference), v_item_cost, v_item_cost * ABS(v_item.difference),
         v_running_qty + v_item.difference, v_mac,
         'inventory_adjustment', p_adjustment_id);
      v_total_loss := v_total_loss + ROUND(v_item_cost * ABS(v_item.difference), 2);
    END IF;
  END LOOP;

  -- Post GL for gains (C2): DR 1300, CR 4300
  IF v_total_gain > 0 THEN
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE
      SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
    RETURNING current_value INTO v_seq;
    v_gain_entry := 'JE-' || v_seq::TEXT;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description,
      source_type, source_id, currency, exchange_rate,
      total_debit, total_credit, created_by
    ) VALUES (
      v_company_id, v_gain_entry, v_adj.date,
      'Inventory Gain — ' || v_adj.adjustment_number,
      'inventory_adjustment', p_adjustment_id,
      v_currency, 1.0, v_total_gain, v_total_gain, v_user_id
    ) RETURNING id INTO v_gain_je_id;

    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_gain_je_id, v_acct_1300, '1300', v_adj.date, v_total_gain, 0,
       'Inventory Gain — ' || v_adj.adjustment_number, 'inventory_adjustment', p_adjustment_id),
      (v_company_id, v_gain_je_id, v_acct_4300, '4300', v_adj.date, 0, v_total_gain,
       'Inventory Gain — ' || v_adj.adjustment_number, 'inventory_adjustment', p_adjustment_id);
  END IF;

  -- Post GL for losses (C3): DR 6700, CR 1300
  IF v_total_loss > 0 THEN
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE
      SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
    RETURNING current_value INTO v_seq;
    v_loss_entry := 'JE-' || v_seq::TEXT;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description,
      source_type, source_id, currency, exchange_rate,
      total_debit, total_credit, created_by
    ) VALUES (
      v_company_id, v_loss_entry, v_adj.date,
      'Inventory Loss — ' || v_adj.adjustment_number,
      'inventory_adjustment', p_adjustment_id,
      v_currency, 1.0, v_total_loss, v_total_loss, v_user_id
    ) RETURNING id INTO v_loss_je_id;

    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_loss_je_id, v_acct_6700, '6700', v_adj.date, v_total_loss, 0,
       'Inventory Loss — ' || v_adj.adjustment_number, 'inventory_adjustment', p_adjustment_id),
      (v_company_id, v_loss_je_id, v_acct_1300, '1300', v_adj.date, 0, v_total_loss,
       'Inventory Loss — ' || v_adj.adjustment_number, 'inventory_adjustment', p_adjustment_id);
  END IF;

  UPDATE public.inventory_adjustments
  SET status = 'confirmed', updated_at = NOW()
  WHERE id = p_adjustment_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'inventory_adjustment', p_adjustment_id,
      jsonb_build_object(
        'adjustment_number', v_adj.adjustment_number,
        'total_gain', v_total_gain,
        'total_loss', v_total_loss
      ));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'adjustment_id',     p_adjustment_id,
    'adjustment_number', v_adj.adjustment_number,
    'gain_je_id',        v_gain_je_id,
    'loss_je_id',        v_loss_je_id,
    'total_gain',        v_total_gain,
    'total_loss',        v_total_loss
  );
END;
$$;
