-- Phase 12 hot-fix — confirm_invoice always writes stock_ledger
--
-- BUG: when a product had MAC=0 (no purchases yet), confirm_invoice posted
-- the sales JE but skipped stock_ledger entirely, only queueing a deferred
-- COGS row. Stock Ledger therefore showed "no movements" for genuinely-sold
-- product, breaking the invariant that every confirmed sale leaves a stock
-- trail. Negative stock must still be visible — that's how an auto-parts
-- shop tracks back-orders.
--
-- FIX: always insert stock_ledger outbound row. unit_cost = current MAC
-- (which is 0 if no prior cost basis). The deferred_cogs_queue still tracks
-- the pending COGS adjustment for later resolution by a GRN.
--
-- Companion change: confirm_grn now uses GREATEST(old_qty, 0) for MAC
-- weighting so a negative running_qty (from a back-ordered sale) doesn't
-- distort the new MAC. The negative stock is still recorded in the ledger,
-- it's just excluded from the value-weighted-average input.

CREATE OR REPLACE FUNCTION public.confirm_invoice(p_invoice_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_company_id  UUID;
  v_inv         public.invoices%ROWTYPE;
  v_item        public.invoice_items%ROWTYPE;
  v_lock_date   DATE;
  v_inv_je_id   UUID;
  v_cogs_je_id  UUID;
  v_inv_entry   TEXT;
  v_cogs_entry  TEXT;
  v_seq         BIGINT;
  v_ar_id       UUID;
  v_sales_id    UUID;
  v_vat_id      UUID;
  v_cogs_id     UUID;
  v_inv_acc_id  UUID;
  v_current_mac   NUMERIC(15,2);
  v_total_cogs    NUMERIC(15,2) := 0;
  v_wh_id         UUID;
  v_prev_running  NUMERIC(15,3);
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_invoice: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_invoice: invoice % not found', p_invoice_id;
  END IF;
  IF v_inv.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_invoice: invoice % not in draft (status=%)', p_invoice_id, v_inv.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_inv.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_invoice: date % on or before period lock %', v_inv.date, v_lock_date;
  END IF;

  v_wh_id := v_inv.warehouse_id;
  IF v_wh_id IS NULL THEN
    SELECT id INTO v_wh_id FROM public.warehouses WHERE company_id = v_company_id AND is_default = TRUE LIMIT 1;
  END IF;

  SELECT id INTO v_ar_id      FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1200' AND is_active;
  SELECT id INTO v_sales_id   FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '4100' AND is_active;
  SELECT id INTO v_cogs_id    FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '5100' AND is_active;
  SELECT id INTO v_inv_acc_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1300' AND is_active;

  IF v_inv.tax_amount > 0 THEN
    SELECT id INTO v_vat_id FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND code LIKE '22%' AND is_active
    ORDER BY code LIMIT 1;
  END IF;

  -- Sales JE sequence
  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_seq;
  v_inv_entry := 'JE-' || v_seq::TEXT;

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, currency, exchange_rate,
    total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_inv_entry, v_inv.date,
    'Sales Invoice ' || v_inv.invoice_number,
    'sales_invoice', p_invoice_id,
    v_inv.currency, v_inv.exchange_rate,
    v_inv.total_amount, v_inv.total_amount,
    v_user_id
  ) RETURNING id INTO v_inv_je_id;

  -- DR 1200 AR
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date,
     debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_inv_je_id, v_ar_id, '1200', v_inv.date,
     v_inv.total_amount, 0,
     'Sales Invoice ' || v_inv.invoice_number,
     v_inv.contact_id, 'invoice', p_invoice_id);

  -- CR 4100 Sales Revenue
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date,
     debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_inv_je_id, v_sales_id, '4100', v_inv.date,
     0, v_inv.subtotal - v_inv.discount_amount,
     'Sales Invoice ' || v_inv.invoice_number,
     v_inv.contact_id, 'invoice', p_invoice_id);

  -- CR 2200 Output VAT (if any)
  IF v_inv.tax_amount > 0 AND v_vat_id IS NOT NULL THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_inv_je_id, v_vat_id, '2200', v_inv.date,
       0, v_inv.tax_amount,
       'Output VAT ' || v_inv.invoice_number,
       v_inv.contact_id, 'invoice', p_invoice_id);
  END IF;

  -- ── Per-item: ALWAYS write stock_ledger; defer COGS only when MAC=0 ──────
  FOR v_item IN SELECT * FROM public.invoice_items WHERE invoice_id = p_invoice_id LOOP
    CONTINUE WHEN v_item.product_id IS NULL;

    -- Current MAC (company-wide latest running_avg_cost)
    SELECT COALESCE(running_avg_cost, 0)::NUMERIC(15,2) INTO v_current_mac
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_item.product_id
    ORDER BY created_at DESC LIMIT 1;
    v_current_mac := COALESCE(v_current_mac, 0);

    -- Snapshot MAC on the line
    UPDATE public.invoice_items SET cost_at_sale = v_current_mac WHERE id = v_item.id;

    -- Previous running qty for this product+warehouse
    SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_running
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_item.product_id AND warehouse_id = v_wh_id
    ORDER BY created_at DESC LIMIT 1;
    v_prev_running := COALESCE(v_prev_running, 0);

    -- ALWAYS insert stock_ledger outbound row (negative running allowed)
    INSERT INTO public.stock_ledger
      (company_id, product_id, warehouse_id, date,
       type, direction, quantity, unit_cost, total_cost,
       running_qty, running_avg_cost,
       related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_item.product_id, v_wh_id, v_inv.date,
       'sale', -1, v_item.quantity, v_current_mac, v_item.quantity * v_current_mac,
       v_prev_running - v_item.quantity, v_current_mac,
       'invoice', p_invoice_id);

    IF v_current_mac > 0 THEN
      v_total_cogs := v_total_cogs + v_item.quantity * v_current_mac;
    ELSE
      -- MAC unknown — defer COGS posting until first GRN sets a MAC
      INSERT INTO public.deferred_cogs_queue
        (company_id, product_id, invoice_item_id, sale_invoice_id,
         sale_date, warehouse_id, quantity, status)
      VALUES
        (v_company_id, v_item.product_id, v_item.id, p_invoice_id,
         v_inv.date, v_wh_id, v_item.quantity, 'pending');
    END IF;
  END LOOP;

  -- COGS JE (only if any line had MAC > 0)
  IF v_total_cogs > 0 THEN
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE
      SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
    RETURNING current_value INTO v_seq;
    v_cogs_entry := 'JE-' || v_seq::TEXT;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description,
      source_type, source_id, currency, exchange_rate,
      total_debit, total_credit, created_by
    ) VALUES (
      v_company_id, v_cogs_entry, v_inv.date,
      'COGS – Invoice ' || v_inv.invoice_number,
      'inventory_cogs', p_invoice_id,
      v_inv.currency, v_inv.exchange_rate,
      v_total_cogs, v_total_cogs, v_user_id
    ) RETURNING id INTO v_cogs_je_id;

    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_cogs_je_id, v_cogs_id, '5100', v_inv.date,
       v_total_cogs, 0,
       'COGS ' || v_inv.invoice_number, 'invoice', p_invoice_id);

    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_cogs_je_id, v_inv_acc_id, '1300', v_inv.date,
       0, v_total_cogs,
       'COGS ' || v_inv.invoice_number, 'invoice', p_invoice_id);
  END IF;

  UPDATE public.invoices SET status = 'confirmed', updated_at = NOW() WHERE id = p_invoice_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'invoice', p_invoice_id,
      jsonb_build_object('invoice_number', v_inv.invoice_number, 'je', v_inv_entry));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'invoice_id',      p_invoice_id,
    'invoice_number',  v_inv.invoice_number,
    'je_id',           v_inv_je_id,
    'entry_number',    v_inv_entry
  );
END;
$$;


-- ────────────────────────────────────────────────────────────────────────────
-- confirm_grn: clamp old_qty to >=0 for MAC weighting so a back-ordered sale
-- (negative running_qty) doesn't poison the new MAC.
-- ────────────────────────────────────────────────────────────────────────────

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
  v_inv_id         UUID;
  v_accrual_id     UUID;
  v_old_mac        NUMERIC(15,2);
  v_old_total_qty  NUMERIC(15,3);
  v_qty_for_mac    NUMERIC(15,3);
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

  FOR v_item IN SELECT * FROM public.goods_receipt_items WHERE grn_id = p_grn_id LOOP
    v_total_cost := v_total_cost + v_item.total_cost;

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

    -- Clamp to zero for MAC weighting — negative stock from a back-ordered
    -- sale shouldn't pollute the average cost we're about to record.
    v_qty_for_mac := GREATEST(v_old_total_qty, 0);

    IF v_qty_for_mac + v_item.qty_received > 0 THEN
      v_new_mac := ROUND(
        (v_old_mac * v_qty_for_mac + v_item.unit_cost * v_item.qty_received) /
        (v_qty_for_mac + v_item.qty_received),
        2
      );
    ELSE
      v_new_mac := v_item.unit_cost;
    END IF;

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

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date,
     debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_inv_id, '1300', v_grn.date,
     v_total_cost, 0,
     'Goods Receipt ' || v_grn.grn_number,
     v_grn.supplier_id, 'goods_receipt', p_grn_id);

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date,
     debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_accrual_id, '2150', v_grn.date,
     0, v_total_cost,
     'Goods Receipt ' || v_grn.grn_number,
     v_grn.supplier_id, 'goods_receipt', p_grn_id);

  UPDATE public.goods_receipts SET status = 'received', updated_at = NOW() WHERE id = p_grn_id;

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
