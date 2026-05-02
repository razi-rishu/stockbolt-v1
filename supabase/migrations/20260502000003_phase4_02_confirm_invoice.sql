-- Phase 4 — confirm_invoice RPC
-- Atomically posts A1 (sales_invoice JE) + A1.b (inventory_cogs JE) + stock_ledger rows.
-- Handles deferred COGS when MAC = 0.
-- Returns: { invoice_id, invoice_number, je_id, entry_number }

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
  -- Account IDs
  v_ar_id       UUID;
  v_sales_id    UUID;
  v_vat_id      UUID;
  v_cogs_id     UUID;
  v_inv_acc_id  UUID;
  -- Per-item
  v_current_mac   NUMERIC(15,2);
  v_total_cogs    NUMERIC(15,2) := 0;
  v_wh_id         UUID;
  v_prev_running  NUMERIC(15,3);
BEGIN
  -- Resolve company
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_invoice: no company for user %', v_user_id;
  END IF;

  -- Load invoice
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_invoice: invoice % not found', p_invoice_id;
  END IF;
  IF v_inv.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_invoice: invoice % not in draft (status=%)', p_invoice_id, v_inv.status;
  END IF;

  -- Period lock
  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_inv.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_invoice: date % on or before period lock %', v_inv.date, v_lock_date;
  END IF;

  -- Default warehouse fallback
  v_wh_id := v_inv.warehouse_id;
  IF v_wh_id IS NULL THEN
    SELECT id INTO v_wh_id FROM public.warehouses WHERE company_id = v_company_id AND is_default = TRUE LIMIT 1;
  END IF;

  -- Resolve GL account IDs
  SELECT id INTO v_ar_id      FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1200' AND is_active;
  SELECT id INTO v_sales_id   FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '4100' AND is_active;
  SELECT id INTO v_cogs_id    FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '5100' AND is_active;
  SELECT id INTO v_inv_acc_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1300' AND is_active;

  IF v_inv.tax_amount > 0 THEN
    SELECT id INTO v_vat_id FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND code LIKE '22%' AND is_active
    ORDER BY code LIMIT 1;
  END IF;

  -- Advance JE sequence for A1 (sales_invoice)
  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_seq;
  v_inv_entry := 'JE-' || v_seq::TEXT;

  -- Insert A1 JE header
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

  -- A1 GL lines
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

  -- CR 2200 Output VAT (if applicable)
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

  -- Process items for COGS + stock
  FOR v_item IN SELECT * FROM public.invoice_items WHERE invoice_id = p_invoice_id LOOP
    CONTINUE WHEN v_item.product_id IS NULL;

    -- Get current MAC (company-wide: most recent running_avg_cost)
    SELECT COALESCE(running_avg_cost, 0)::NUMERIC(15,2) INTO v_current_mac
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_item.product_id
    ORDER BY created_at DESC LIMIT 1;

    v_current_mac := COALESCE(v_current_mac, 0);

    -- Snapshot MAC on the item
    UPDATE public.invoice_items SET cost_at_sale = v_current_mac WHERE id = v_item.id;

    IF v_current_mac > 0 THEN
      v_total_cogs := v_total_cogs + v_item.quantity * v_current_mac;

      -- Previous running qty for this product+warehouse
      SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_running
      FROM public.stock_ledger
      WHERE company_id = v_company_id AND product_id = v_item.product_id AND warehouse_id = v_wh_id
      ORDER BY created_at DESC LIMIT 1;

      v_prev_running := COALESCE(v_prev_running, 0);

      -- Insert stock_ledger outbound row
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
    ELSE
      -- Deferred COGS
      INSERT INTO public.deferred_cogs_queue
        (company_id, product_id, invoice_item_id, sale_invoice_id,
         sale_date, warehouse_id, quantity, status)
      VALUES
        (v_company_id, v_item.product_id, v_item.id, p_invoice_id,
         v_inv.date, v_wh_id, v_item.quantity, 'pending');
    END IF;
  END LOOP;

  -- Post A1.b COGS JE if there is cost
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

    -- DR 5100 COGS
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_cogs_je_id, v_cogs_id, '5100', v_inv.date,
       v_total_cogs, 0,
       'COGS ' || v_inv.invoice_number, 'invoice', p_invoice_id);

    -- CR 1300 Inventory
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_cogs_je_id, v_inv_acc_id, '1300', v_inv.date,
       0, v_total_cogs,
       'COGS ' || v_inv.invoice_number, 'invoice', p_invoice_id);
  END IF;

  -- Confirm invoice
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
