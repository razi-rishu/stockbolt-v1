-- =============================================================================
-- Phase 43 — Reversals carry the voucher date, never "today"
-- =============================================================================
-- Every edit / void / reopen posted its reversal JE, GL rows and stock rows
-- at CURRENT_DATE. Editing or voiding a June document in July therefore
-- injected NEGATIVE figures into July's P&L / VAT / stock reports while June
-- kept the old figures (live case: Pro_Parts P&L July = -306.66 from two
-- invoice edit-reversals). Correct behaviour: a reversal is dated at the
-- ORIGINAL posting's date, so only the voucher's own period is ever touched;
-- the replacement posting carries the (possibly new) voucher date.
--
-- 17 functions patched from live pg_get_functiondef:
--   • reversal JE date        := original JE's date
--   • reversal GL row dates   := the mirrored rows' own dates
--   • reversal stock row date := the reversed row's date
--   • edit_invoice repost COGS JE + repost stock rows := invoice date
--   • period-lock guards now test the VOUCHER date (and each original JE's
--     date inside the reversal loops) instead of today — so locked months
--     can never be rewritten, exactly as before, but open months are always
--     shown in their final edited state.
-- Plus a data repair that re-dates existing reversal / repost rows the same
-- way (rows whose original sits in a locked period are left untouched).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.edit_invoice(p_invoice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
-- Cumulative phase tags (preserved so the regression suite's per-phase
-- markers still resolve): Phase 12.20, Phase 12.21, Phase 12.22, Phase 12.27, Phase 12.28
DECLARE
  v_user_id     UUID := auth.uid();
  v_company_id  UUID;
  v_inv         public.invoices%ROWTYPE;
  v_item        public.invoice_items%ROWTYPE;
  v_product_type TEXT;
  v_lock_date   DATE;
  v_je          public.journal_entries%ROWTYPE;
  v_gl          public.general_ledger%ROWTYPE;
  v_sl          public.stock_ledger%ROWTYPE;
  v_rev_id      UUID;
  v_rev_entry   TEXT;
  v_inv_je_id   UUID;
  v_cogs_je_id  UUID;
  v_inv_entry   TEXT;
  v_cogs_entry  TEXT;
  v_seq         BIGINT;
  v_ar_id       UUID;
  v_sales_id    UUID;
  v_sales_disc_id UUID;
  v_vat_id      UUID;
  v_cogs_id     UUID;
  v_inv_acc_id  UUID;
  v_current_mac   NUMERIC(15,2);
  v_total_cogs    NUMERIC(15,2) := 0;
  v_wh_id         UUID;
  v_prev_running  NUMERIC(15,3);
  v_je_total      NUMERIC(15,2);
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'edit_invoice: no company for user'; END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'edit_invoice: invoice % not found', p_invoice_id; END IF;
  IF v_inv.status <> 'confirmed' THEN
    RAISE EXCEPTION 'edit_invoice: invoice % must be confirmed (status=%)', p_invoice_id, v_inv.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_inv.date <= v_lock_date THEN
    RAISE EXCEPTION 'edit_invoice: voucher date % on or before period lock %', v_inv.date, v_lock_date;
  END IF;

  -- Step 1 — Reverse existing sales + cogs JEs (Phase 12.21).
  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id
      AND source_id = p_invoice_id
      AND reversed_by_id IS NULL
      AND reversal_of_id IS NULL
      AND source_type IN ('sales_invoice','inventory_cogs')
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
      'Edit Reversal – ' || v_inv.invoice_number,
      v_je.source_type, p_invoice_id,
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
        'Edit Reversal – ' || v_inv.invoice_number,
        v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
      );
    END LOOP;

    UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
  END LOOP;

  -- Step 2 — Reverse stock_ledger rows (Phase 12.21).
  FOR v_sl IN
    SELECT sl.* FROM public.stock_ledger sl
    WHERE sl.company_id = v_company_id
      AND sl.related_doc_id = p_invoice_id
      AND sl.related_doc_type = 'invoice'
      AND sl.reversal_of_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id)
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
      'invoice', p_invoice_id, v_sl.id
    );
  END LOOP;

  -- Step 3 — Repost (Phase 12.22 gross method + Phase 12.27 defer + Phase 12.28 service).
  v_wh_id := v_inv.warehouse_id;
  IF v_wh_id IS NULL THEN
    SELECT id INTO v_wh_id FROM public.warehouses WHERE company_id = v_company_id AND is_default LIMIT 1;
  END IF;

  SELECT id INTO v_ar_id          FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1200' AND is_active;
  SELECT id INTO v_sales_id       FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '4100' AND is_active;
  SELECT id INTO v_sales_disc_id  FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '4150' AND is_active;
  SELECT id INTO v_cogs_id        FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '5100' AND is_active;
  SELECT id INTO v_inv_acc_id     FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1300' AND is_active;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id;

  IF v_inv.tax_amount > 0 THEN
    SELECT id INTO v_vat_id FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND code LIKE '22%' AND is_active ORDER BY code LIMIT 1;
  END IF;

  IF v_sales_disc_id IS NOT NULL AND v_inv.discount_amount > 0 THEN
    v_je_total := v_inv.total_amount + v_inv.discount_amount;
  ELSE
    v_je_total := v_inv.total_amount;
  END IF;

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
    'Sales Invoice (Edited) ' || v_inv.invoice_number,
    'sales_invoice', p_invoice_id, v_inv.currency, v_inv.exchange_rate,
    v_je_total, v_je_total, v_user_id
  ) RETURNING id INTO v_inv_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_inv_je_id, v_ar_id, '1200', v_inv.date, v_inv.total_amount, 0,
     'Invoice (Edited) ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);

  IF v_sales_disc_id IS NOT NULL AND v_inv.discount_amount > 0 THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_inv_je_id, v_sales_disc_id, '4150', v_inv.date, v_inv.discount_amount, 0,
       'Sales Discount (Edited) ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);
  END IF;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_inv_je_id, v_sales_id, '4100', v_inv.date, 0,
     CASE
       WHEN v_sales_disc_id IS NOT NULL AND v_inv.discount_amount > 0
       THEN v_inv.total_amount - v_inv.tax_amount + v_inv.discount_amount
       ELSE v_inv.total_amount - v_inv.tax_amount
     END,
     'Invoice (Edited) ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);

  IF v_inv.tax_amount > 0 AND v_vat_id IS NOT NULL THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_inv_je_id, v_vat_id, '2200', v_inv.date, 0, v_inv.tax_amount,
       'Output VAT (Edited) ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);
  END IF;

  -- Per-item: stock + COGS, with Phase 12.28 service bypass.
  FOR v_item IN SELECT * FROM public.invoice_items WHERE invoice_id = p_invoice_id LOOP
    CONTINUE WHEN v_item.product_id IS NULL;
    SELECT type INTO v_product_type FROM public.products WHERE id = v_item.product_id;
    CONTINUE WHEN v_product_type = 'service';

    SELECT COALESCE(running_avg_cost, 0)::NUMERIC(15,2) INTO v_current_mac
    FROM public.stock_ledger sl
    WHERE sl.company_id = v_company_id AND sl.product_id = v_item.product_id
      AND sl.reversal_of_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id)
    ORDER BY sl.seq DESC LIMIT 1;
    v_current_mac := COALESCE(v_current_mac, 0);

    UPDATE public.invoice_items SET cost_at_sale = v_current_mac WHERE id = v_item.id;

    SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_running
    FROM public.stock_ledger sl
    WHERE sl.company_id = v_company_id AND sl.product_id = v_item.product_id
      AND sl.warehouse_id = v_wh_id
      AND sl.reversal_of_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id)
    ORDER BY sl.seq DESC LIMIT 1;
    v_prev_running := COALESCE(v_prev_running, 0);

    INSERT INTO public.stock_ledger
      (company_id, product_id, warehouse_id, date, type, direction, quantity, unit_cost, total_cost,
       running_qty, running_avg_cost, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_item.product_id, v_wh_id, v_inv.date,
       'sale', -1, v_item.quantity, v_current_mac, v_item.quantity * v_current_mac,
       v_prev_running - v_item.quantity, v_current_mac, 'invoice', p_invoice_id);

    IF v_current_mac > 0 THEN
      v_total_cogs := v_total_cogs + v_item.quantity * v_current_mac;
    ELSE
      INSERT INTO public.deferred_cogs_queue
        (company_id, product_id, invoice_item_id, sale_invoice_id,
         sale_date, warehouse_id, quantity, status)
      VALUES
        (v_company_id, v_item.product_id, v_item.id, p_invoice_id,
         v_inv.date, v_wh_id, v_item.quantity, 'pending');
    END IF;
  END LOOP;

  IF v_total_cogs > 0 THEN
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE
      SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
    RETURNING current_value INTO v_seq;
    v_cogs_entry := 'JE-' || v_seq::TEXT;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description, source_type, source_id,
      currency, exchange_rate, total_debit, total_credit, created_by
    ) VALUES (
      v_company_id, v_cogs_entry, v_inv.date,
      'COGS (Edited) – ' || v_inv.invoice_number,
      'inventory_cogs', p_invoice_id, v_inv.currency, v_inv.exchange_rate,
      v_total_cogs, v_total_cogs, v_user_id
    ) RETURNING id INTO v_cogs_je_id;

    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_cogs_je_id, v_cogs_id, '5100', v_inv.date, v_total_cogs, 0,
       'COGS (Edited) ' || v_inv.invoice_number, 'invoice', p_invoice_id),
      (v_company_id, v_cogs_je_id, v_inv_acc_id, '1300', v_inv.date, 0, v_total_cogs,
       'COGS (Edited) ' || v_inv.invoice_number, 'invoice', p_invoice_id);
  END IF;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'edit', 'invoice', p_invoice_id,
      jsonb_build_object('invoice_number', v_inv.invoice_number, 'je', v_inv_entry, 'phase', '12.28'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id, 'invoice_number', v_inv.invoice_number,
    'je_id', v_inv_je_id, 'entry_number', v_inv_entry
  );
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


CREATE OR REPLACE FUNCTION public.void_invoice(p_invoice_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_inv        public.invoices%ROWTYPE;
  v_lock_date  DATE;
  v_je         public.journal_entries%ROWTYPE;
  v_gl         public.general_ledger%ROWTYPE;
  v_sl         public.stock_ledger%ROWTYPE;
  v_rev_id     UUID;
  v_rev_entry  TEXT;
  v_seq        BIGINT;
  v_prev_running NUMERIC(15,3);
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'void_invoice: no company for user';
  END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'void_invoice: invoice % not found', p_invoice_id;
  END IF;
  IF v_inv.status <> 'confirmed' THEN
    RAISE EXCEPTION 'void_invoice: invoice % not confirmed (status=%)', p_invoice_id, v_inv.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_inv.date <= v_lock_date THEN
    RAISE EXCEPTION 'void_invoice: voucher date % on or before period lock %', v_inv.date, v_lock_date;
  END IF;

  -- Reverse all unreversed JEs linked to this invoice
  -- Covers: sales_invoice, inventory_cogs, advance_application
  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id
      AND source_id = p_invoice_id
      AND reversed_by_id IS NULL
      AND source_type IN ('sales_invoice','inventory_cogs','advance_application')
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
      COALESCE(p_reason, 'Void – ' || v_inv.invoice_number),
      v_je.source_type, p_invoice_id,
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
        COALESCE(p_reason, 'Void – ' || v_inv.invoice_number),
        v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
      );
    END LOOP;

    UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
  END LOOP;

  -- Reverse stock_ledger rows
  FOR v_sl IN
    SELECT * FROM public.stock_ledger
    WHERE company_id = v_company_id
      AND related_doc_id = p_invoice_id
      AND related_doc_type = 'invoice'
      AND reversal_of_id IS NULL
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
      'void', -v_sl.direction, v_sl.quantity, v_sl.unit_cost, v_sl.total_cost,
      v_prev_running + v_sl.quantity * (-v_sl.direction),
      v_sl.running_avg_cost,
      'invoice', p_invoice_id, v_sl.id
    );
  END LOOP;

  -- Cancel pending deferred COGS
  UPDATE public.deferred_cogs_queue
  SET status = 'cancelled', updated_at = NOW()
  WHERE sale_invoice_id = p_invoice_id AND status = 'pending';

  -- Void invoice
  UPDATE public.invoices
  SET status = 'void', void_reason = p_reason,
      voided_at = NOW(), voided_by = v_user_id, updated_at = NOW()
  WHERE id = p_invoice_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'void', 'invoice', p_invoice_id,
      jsonb_build_object('invoice_number', v_inv.invoice_number, 'reason', p_reason));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'invoice_number', v_inv.invoice_number);
END;
$function$;


CREATE OR REPLACE FUNCTION public.void_credit_note(p_credit_note_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_cn         public.credit_notes%ROWTYPE;
  v_lock_date  DATE;
  v_je         public.journal_entries%ROWTYPE;
  v_gl         public.general_ledger%ROWTYPE;
  v_sl         public.stock_ledger%ROWTYPE;
  v_rev_id     UUID;
  v_rev_entry  TEXT;
  v_seq        BIGINT;
  v_prev_running NUMERIC(15,3);
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'void_credit_note: no company for user';
  END IF;

  SELECT * INTO v_cn FROM public.credit_notes WHERE id = p_credit_note_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'void_credit_note: credit note % not found', p_credit_note_id;
  END IF;
  IF v_cn.status <> 'confirmed' THEN
    RAISE EXCEPTION 'void_credit_note: not confirmed (status=%)', v_cn.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_cn.date <= v_lock_date THEN
    RAISE EXCEPTION 'void_credit_note: voucher date % on or before period lock %', v_cn.date, v_lock_date;
  END IF;

  -- Reverse all unreversed JEs linked to this credit note
  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id
      AND source_id = p_credit_note_id
      AND reversed_by_id IS NULL
      AND source_type IN ('sales_credit_note', 'inventory_cogs')
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
      COALESCE(p_reason, 'Void – ' || v_cn.credit_note_number),
      v_je.source_type, p_credit_note_id,
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
        COALESCE(p_reason, 'Void – ' || v_cn.credit_note_number),
        v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
      );
    END LOOP;

    UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
  END LOOP;

  -- Reverse stock_ledger rows
  FOR v_sl IN
    SELECT * FROM public.stock_ledger
    WHERE company_id = v_company_id
      AND related_doc_id = p_credit_note_id
      AND related_doc_type = 'credit_note'
      AND reversal_of_id IS NULL
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
      'void', -v_sl.direction, v_sl.quantity, v_sl.unit_cost, v_sl.total_cost,
      v_prev_running + v_sl.quantity * (-v_sl.direction),
      v_sl.running_avg_cost,
      'credit_note', p_credit_note_id, v_sl.id
    );
  END LOOP;

  UPDATE public.credit_notes
  SET status = 'void', updated_at = NOW()
  WHERE id = p_credit_note_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'void', 'credit_note', p_credit_note_id,
      jsonb_build_object('credit_note_number', v_cn.credit_note_number, 'reason', p_reason));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('credit_note_id', p_credit_note_id, 'credit_note_number', v_cn.credit_note_number);
END;
$function$;


CREATE OR REPLACE FUNCTION public.reopen_credit_note(p_credit_note_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_cn         public.credit_notes%ROWTYPE;
  v_lock_date  DATE;
  v_je         public.journal_entries%ROWTYPE;
  v_gl         public.general_ledger%ROWTYPE;
  v_sl         public.stock_ledger%ROWTYPE;
  v_rev_id     UUID;
  v_rev_entry  TEXT;
  v_seq        BIGINT;
  v_prev_running NUMERIC(15,3);
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'reopen_credit_note: no company for user'; END IF;

  SELECT * INTO v_cn FROM public.credit_notes WHERE id = p_credit_note_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'reopen_credit_note: credit note % not found', p_credit_note_id; END IF;
  IF v_cn.status <> 'confirmed' THEN RAISE EXCEPTION 'reopen_credit_note: not confirmed (status=%)', v_cn.status; END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_cn.date <= v_lock_date THEN
    RAISE EXCEPTION 'reopen_credit_note: voucher date % on or before period lock %', v_cn.date, v_lock_date;
  END IF;

  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id AND source_id = p_credit_note_id AND reversed_by_id IS NULL
      AND source_type IN ('sales_credit_note', 'inventory_cogs')
  LOOP
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
    RETURNING current_value INTO v_seq;
    v_rev_entry := 'JE-' || v_seq::TEXT;
    IF v_lock_date IS NOT NULL AND v_je.date <= v_lock_date THEN
      RAISE EXCEPTION 'Cannot reverse: the original posting dated % is in a locked period (lock %).', v_je.date, v_lock_date;
    END IF;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description, source_type, source_id,
      currency, exchange_rate, total_debit, total_credit, reversal_of_id, created_by
    ) VALUES (
      v_company_id, v_rev_entry, v_je.date, 'Reopen – ' || v_cn.credit_note_number,
      v_je.source_type, p_credit_note_id, v_je.currency, v_je.exchange_rate,
      v_je.total_credit, v_je.total_debit, v_je.id, v_user_id
    ) RETURNING id INTO v_rev_id;

    FOR v_gl IN SELECT * FROM public.general_ledger WHERE journal_entry_id = v_je.id LOOP
      INSERT INTO public.general_ledger (
        company_id, journal_entry_id, account_id, account_code, date, debit, credit,
        description, contact_id, related_doc_type, related_doc_id, reversal_of_id
      ) VALUES (
        v_company_id, v_rev_id, v_gl.account_id, v_gl.account_code, v_gl.date, v_gl.credit, v_gl.debit,
        'Reopen – ' || v_cn.credit_note_number, v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
      );
    END LOOP;

    UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
  END LOOP;

  FOR v_sl IN
    SELECT * FROM public.stock_ledger
    WHERE company_id = v_company_id AND related_doc_id = p_credit_note_id
      AND related_doc_type = 'credit_note' AND reversal_of_id IS NULL
  LOOP
    SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_running
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_sl.product_id AND warehouse_id = v_sl.warehouse_id
    ORDER BY seq DESC LIMIT 1;

    INSERT INTO public.stock_ledger (
      company_id, product_id, warehouse_id, date, type, direction, quantity, unit_cost, total_cost,
      running_qty, running_avg_cost, related_doc_type, related_doc_id, reversal_of_id
    ) VALUES (
      v_company_id, v_sl.product_id, v_sl.warehouse_id, v_sl.date,
      'void', -v_sl.direction, v_sl.quantity, v_sl.unit_cost, v_sl.total_cost,
      v_prev_running + v_sl.quantity * (-v_sl.direction), v_sl.running_avg_cost,
      'credit_note', p_credit_note_id, v_sl.id
    );
  END LOOP;

  UPDATE public.credit_notes SET status = 'draft', updated_at = NOW() WHERE id = p_credit_note_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'reopen', 'credit_note', p_credit_note_id,
      jsonb_build_object('credit_note_number', v_cn.credit_note_number));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('credit_note_id', p_credit_note_id, 'status', 'draft');
END;
$function$;


CREATE OR REPLACE FUNCTION public.void_debit_note(p_debit_note_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_dn         public.debit_notes%ROWTYPE;
  v_lock_date  DATE;
  v_je         public.journal_entries%ROWTYPE;
  v_gl         public.general_ledger%ROWTYPE;
  v_sl         public.stock_ledger%ROWTYPE;
  v_rev_id     UUID;
  v_rev_entry  TEXT;
  v_seq        BIGINT;
  v_prev_running NUMERIC(15,3);
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'void_debit_note: no company for user';
  END IF;

  SELECT * INTO v_dn FROM public.debit_notes WHERE id = p_debit_note_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'void_debit_note: debit note % not found', p_debit_note_id;
  END IF;
  IF v_dn.status <> 'confirmed' THEN
    RAISE EXCEPTION 'void_debit_note: not confirmed (status=%)', v_dn.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_dn.date <= v_lock_date THEN
    RAISE EXCEPTION 'void_debit_note: voucher date % on or before period lock %', v_dn.date, v_lock_date;
  END IF;

  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id
      AND source_id = p_debit_note_id
      AND reversed_by_id IS NULL
      AND source_type = 'vendor_debit_note'
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
      COALESCE(p_reason, 'Void – ' || v_dn.debit_note_number),
      v_je.source_type, p_debit_note_id,
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
        COALESCE(p_reason, 'Void – ' || v_dn.debit_note_number),
        v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
      );
    END LOOP;

    UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
  END LOOP;

  -- Reverse stock_ledger rows
  FOR v_sl IN
    SELECT * FROM public.stock_ledger
    WHERE company_id = v_company_id
      AND related_doc_id = p_debit_note_id
      AND related_doc_type = 'debit_note'
      AND reversal_of_id IS NULL
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
      'void', -v_sl.direction, v_sl.quantity, v_sl.unit_cost, v_sl.total_cost,
      v_prev_running + v_sl.quantity * (-v_sl.direction),
      v_sl.running_avg_cost,
      'debit_note', p_debit_note_id, v_sl.id
    );
  END LOOP;

  UPDATE public.debit_notes
  SET status = 'void', updated_at = NOW()
  WHERE id = p_debit_note_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'void', 'debit_note', p_debit_note_id,
      jsonb_build_object('debit_note_number', v_dn.debit_note_number, 'reason', p_reason));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('debit_note_id', p_debit_note_id, 'debit_note_number', v_dn.debit_note_number);
END;
$function$;


CREATE OR REPLACE FUNCTION public.reopen_debit_note(p_debit_note_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_dn         public.debit_notes%ROWTYPE;
  v_lock_date  DATE;
  v_je         public.journal_entries%ROWTYPE;
  v_gl         public.general_ledger%ROWTYPE;
  v_sl         public.stock_ledger%ROWTYPE;
  v_rev_id     UUID;
  v_rev_entry  TEXT;
  v_seq        BIGINT;
  v_prev_running NUMERIC(15,3);
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'reopen_debit_note: no company for user'; END IF;

  SELECT * INTO v_dn FROM public.debit_notes WHERE id = p_debit_note_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'reopen_debit_note: debit note % not found', p_debit_note_id; END IF;
  IF v_dn.status <> 'confirmed' THEN RAISE EXCEPTION 'reopen_debit_note: not confirmed (status=%)', v_dn.status; END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_dn.date <= v_lock_date THEN
    RAISE EXCEPTION 'reopen_debit_note: voucher date % on or before period lock %', v_dn.date, v_lock_date;
  END IF;

  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id AND source_id = p_debit_note_id AND reversed_by_id IS NULL
      AND source_type = 'vendor_debit_note'
  LOOP
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
    RETURNING current_value INTO v_seq;
    v_rev_entry := 'JE-' || v_seq::TEXT;
    IF v_lock_date IS NOT NULL AND v_je.date <= v_lock_date THEN
      RAISE EXCEPTION 'Cannot reverse: the original posting dated % is in a locked period (lock %).', v_je.date, v_lock_date;
    END IF;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description, source_type, source_id,
      currency, exchange_rate, total_debit, total_credit, reversal_of_id, created_by
    ) VALUES (
      v_company_id, v_rev_entry, v_je.date, 'Reopen – ' || v_dn.debit_note_number,
      v_je.source_type, p_debit_note_id, v_je.currency, v_je.exchange_rate,
      v_je.total_credit, v_je.total_debit, v_je.id, v_user_id
    ) RETURNING id INTO v_rev_id;

    FOR v_gl IN SELECT * FROM public.general_ledger WHERE journal_entry_id = v_je.id LOOP
      INSERT INTO public.general_ledger (
        company_id, journal_entry_id, account_id, account_code, date, debit, credit,
        description, contact_id, related_doc_type, related_doc_id, reversal_of_id
      ) VALUES (
        v_company_id, v_rev_id, v_gl.account_id, v_gl.account_code, v_gl.date, v_gl.credit, v_gl.debit,
        'Reopen – ' || v_dn.debit_note_number, v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
      );
    END LOOP;

    UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
  END LOOP;

  FOR v_sl IN
    SELECT * FROM public.stock_ledger
    WHERE company_id = v_company_id AND related_doc_id = p_debit_note_id
      AND related_doc_type = 'debit_note' AND reversal_of_id IS NULL
  LOOP
    SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_running
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_sl.product_id AND warehouse_id = v_sl.warehouse_id
    ORDER BY seq DESC LIMIT 1;

    INSERT INTO public.stock_ledger (
      company_id, product_id, warehouse_id, date, type, direction, quantity, unit_cost, total_cost,
      running_qty, running_avg_cost, related_doc_type, related_doc_id, reversal_of_id
    ) VALUES (
      v_company_id, v_sl.product_id, v_sl.warehouse_id, v_sl.date,
      'void', -v_sl.direction, v_sl.quantity, v_sl.unit_cost, v_sl.total_cost,
      v_prev_running + v_sl.quantity * (-v_sl.direction), v_sl.running_avg_cost,
      'debit_note', p_debit_note_id, v_sl.id
    );
  END LOOP;

  UPDATE public.debit_notes SET status = 'draft', updated_at = NOW() WHERE id = p_debit_note_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'reopen', 'debit_note', p_debit_note_id,
      jsonb_build_object('debit_note_number', v_dn.debit_note_number));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('debit_note_id', p_debit_note_id, 'status', 'draft');
END;
$function$;


CREATE OR REPLACE FUNCTION public.void_payment(p_payment_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id     UUID := auth.uid();
  v_company_id  UUID;
  v_pmt         public.payments%ROWTYPE;
  v_lock_date   DATE;
  v_je          public.journal_entries%ROWTYPE;
  v_gl          public.general_ledger%ROWTYPE;
  v_rev_id      UUID;
  v_rev_entry   TEXT;
  v_seq         BIGINT;
  v_alloc       RECORD;
  v_aje_count   INTEGER;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'void_payment: no company for user';
  END IF;

  SELECT * INTO v_pmt FROM public.payments WHERE id = p_payment_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'void_payment: payment % not found', p_payment_id;
  END IF;
  IF v_pmt.status <> 'confirmed' THEN
    RAISE EXCEPTION 'void_payment: payment % is not confirmed (status=%)', p_payment_id, v_pmt.status;
  END IF;
  IF v_pmt.type <> 'inbound' THEN
    RAISE EXCEPTION 'void_payment: only inbound receipts are handled here (type=%)', v_pmt.type;
  END IF;

  -- Period lock (reversal posts with today's date)
  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_pmt.date <= v_lock_date THEN
    RAISE EXCEPTION 'void_payment: voucher date % is on or before the period lock %', v_pmt.date, v_lock_date;
  END IF;

  -- Reconciliation guard — refuse if any GL line of this payment is reconciled
  IF EXISTS (
    SELECT 1
    FROM public.general_ledger gl
    JOIN public.journal_entries je ON je.id = gl.journal_entry_id
    WHERE je.company_id = v_company_id
      AND je.source_id = p_payment_id
      AND je.source_type IN ('customer_receipt','customer_advance')
      AND gl.reconciliation_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'void_payment: payment % is bank-reconciled. Un-reconcile it first, then void.', p_payment_id;
  END IF;

  -- ── CASCADE: reverse advance-application JEs for invoices this payment paid ──
  -- ONLY for advance/on_account receipts. An against_invoice receipt settles
  -- via the 1200 credit inside its own confirm JE (reversed below) — its
  -- allocations are NOT advance applications, so we must not touch any
  -- advance_application JE that happens to sit on the same invoice (it could
  -- belong to a different payment).
  -- Phase 18d: cascade runs for ALL classifications. An against_invoice
  -- receipt's unallocated portion can later be applied as an advance; the
  -- per-invoice count guard below still protects the ambiguous case.
  FOR v_alloc IN
    SELECT doc_id FROM public.payment_allocations
    WHERE payment_id = p_payment_id AND company_id = v_company_id AND doc_type = 'invoice'
  LOOP
    SELECT COUNT(*) INTO v_aje_count
    FROM public.journal_entries
    WHERE company_id = v_company_id
      AND source_id = v_alloc.doc_id
      AND source_type = 'advance_application'
      AND reversed_by_id IS NULL;

    IF v_aje_count > 1 THEN
      RAISE EXCEPTION 'void_payment: invoice % has multiple advance applications; reverse them manually first.', v_alloc.doc_id;
    END IF;

    IF v_aje_count = 1 THEN
      SELECT * INTO v_je
      FROM public.journal_entries
      WHERE company_id = v_company_id
        AND source_id = v_alloc.doc_id
        AND source_type = 'advance_application'
        AND reversed_by_id IS NULL
      AND reversal_of_id IS NULL
      LIMIT 1;

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
        COALESCE(p_reason, 'Void receipt – reverse advance application'),
        v_je.source_type, v_je.source_id,
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
          COALESCE(p_reason, 'Void receipt – reverse advance application'),
          v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
        );
      END LOOP;

      UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
    END IF;
  END LOOP;

  -- ── Reverse the receipt's own JE (customer_receipt | customer_advance) ──
  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id
      AND source_id = p_payment_id
      AND reversed_by_id IS NULL
      AND reversal_of_id IS NULL
      AND source_type IN ('customer_receipt','customer_advance')
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
      COALESCE(p_reason, 'Void – ' || v_pmt.payment_number),
      v_je.source_type, p_payment_id,
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
        COALESCE(p_reason, 'Void – ' || v_pmt.payment_number),
        v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
      );
    END LOOP;

    UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
  END LOOP;

  -- Drop allocations so any invoice this receipt paid reopens.
  DELETE FROM public.payment_allocations
  WHERE payment_id = p_payment_id AND company_id = v_company_id;

  -- Void the payment
  UPDATE public.payments
  SET status = 'void', void_reason = p_reason,
      voided_at = NOW(), voided_by = v_user_id, updated_at = NOW()
  WHERE id = p_payment_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'void', 'payment', p_payment_id,
      jsonb_build_object('payment_number', v_pmt.payment_number, 'reason', p_reason));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('payment_id', p_payment_id, 'payment_number', v_pmt.payment_number);
END;
$function$;


CREATE OR REPLACE FUNCTION public.reopen_payment(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id     UUID := auth.uid();
  v_company_id  UUID;
  v_pmt         public.payments%ROWTYPE;
  v_lock_date   DATE;
  v_je          public.journal_entries%ROWTYPE;
  v_gl          public.general_ledger%ROWTYPE;
  v_rev_id      UUID;
  v_rev_entry   TEXT;
  v_seq         BIGINT;
  v_alloc       RECORD;
  v_aje_count   INTEGER;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'reopen_payment: no company for user';
  END IF;

  SELECT * INTO v_pmt FROM public.payments WHERE id = p_payment_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reopen_payment: payment % not found', p_payment_id;
  END IF;
  IF v_pmt.status <> 'confirmed' THEN
    RAISE EXCEPTION 'reopen_payment: payment % is not confirmed (status=%)', p_payment_id, v_pmt.status;
  END IF;
  IF v_pmt.type <> 'inbound' THEN
    RAISE EXCEPTION 'reopen_payment: only inbound receipts are handled here (type=%)', v_pmt.type;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_pmt.date <= v_lock_date THEN
    RAISE EXCEPTION 'reopen_payment: voucher date % is on or before the period lock %', v_pmt.date, v_lock_date;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.general_ledger gl
    JOIN public.journal_entries je ON je.id = gl.journal_entry_id
    WHERE je.company_id = v_company_id
      AND je.source_id = p_payment_id
      AND je.source_type IN ('customer_receipt','customer_advance')
      AND gl.reconciliation_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'reopen_payment: payment % is bank-reconciled. Un-reconcile it first, then edit.', p_payment_id;
  END IF;

  -- CASCADE: reverse advance-application JEs for invoices this payment paid
  -- (advance/on_account only). reversal_of_id IS NULL → never re-reverse a
  -- prior reversal.
  -- Phase 18d: cascade runs for ALL classifications. An against_invoice
  -- receipt's unallocated portion can later be applied as an advance; the
  -- per-invoice count guard below still protects the ambiguous case.
  FOR v_alloc IN
    SELECT doc_id FROM public.payment_allocations
    WHERE payment_id = p_payment_id AND company_id = v_company_id AND doc_type = 'invoice'
  LOOP
    SELECT COUNT(*) INTO v_aje_count
    FROM public.journal_entries
    WHERE company_id = v_company_id
      AND source_id = v_alloc.doc_id
      AND source_type = 'advance_application'
      AND reversed_by_id IS NULL
      AND reversal_of_id IS NULL;

    IF v_aje_count > 1 THEN
      RAISE EXCEPTION 'reopen_payment: invoice % has multiple advance applications; reverse them manually first.', v_alloc.doc_id;
    END IF;

    IF v_aje_count = 1 THEN
      SELECT * INTO v_je
      FROM public.journal_entries
      WHERE company_id = v_company_id
        AND source_id = v_alloc.doc_id
        AND source_type = 'advance_application'
        AND reversed_by_id IS NULL
        AND reversal_of_id IS NULL
      LIMIT 1;

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
        'Edit reopen – reverse advance application',
        v_je.source_type, v_je.source_id,
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
          'Edit reopen – reverse advance application',
          v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
        );
      END LOOP;

      UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
    END IF;
  END LOOP;

  -- Reverse the receipt's own live JE(s). reversal_of_id IS NULL is the key
  -- fix: never re-reverse a reversal entry created by a prior reopen.
  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id
      AND source_id = p_payment_id
      AND reversed_by_id IS NULL
      AND reversal_of_id IS NULL
      AND source_type IN ('customer_receipt','customer_advance')
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
      'Edit reopen – ' || v_pmt.payment_number,
      v_je.source_type, p_payment_id,
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
        'Edit reopen – ' || v_pmt.payment_number,
        v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
      );
    END LOOP;

    UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
  END LOOP;

  DELETE FROM public.payment_allocations
  WHERE payment_id = p_payment_id AND company_id = v_company_id;

  UPDATE public.payments
  SET status = 'draft', void_reason = NULL,
      voided_at = NULL, voided_by = NULL, updated_at = NOW()
  WHERE id = p_payment_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'edit', 'payment', p_payment_id,
      jsonb_build_object('payment_number', v_pmt.payment_number, 'reopened', true));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('payment_id', p_payment_id, 'payment_number', v_pmt.payment_number, 'status', 'draft');
END;
$function$;


CREATE OR REPLACE FUNCTION public.reopen_vendor_payment(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id     UUID := auth.uid();
  v_company_id  UUID;
  v_pmt         public.payments%ROWTYPE;
  v_lock_date   DATE;
  v_je          public.journal_entries%ROWTYPE;
  v_gl          public.general_ledger%ROWTYPE;
  v_rev_id      UUID;
  v_rev_entry   TEXT;
  v_seq         BIGINT;
  v_alloc       RECORD;
  v_aje_count   INTEGER;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'reopen_vendor_payment: no company for user';
  END IF;

  SELECT * INTO v_pmt FROM public.payments WHERE id = p_payment_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reopen_vendor_payment: payment % not found', p_payment_id;
  END IF;
  IF v_pmt.status <> 'confirmed' THEN
    RAISE EXCEPTION 'reopen_vendor_payment: payment % is not confirmed (status=%)', p_payment_id, v_pmt.status;
  END IF;
  IF v_pmt.type <> 'outbound' THEN
    RAISE EXCEPTION 'reopen_vendor_payment: only outbound payments are handled here (type=%)', v_pmt.type;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_pmt.date <= v_lock_date THEN
    RAISE EXCEPTION 'reopen_vendor_payment: voucher date % is on or before the period lock %', v_pmt.date, v_lock_date;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.general_ledger gl
    JOIN public.journal_entries je ON je.id = gl.journal_entry_id
    WHERE je.company_id = v_company_id
      AND je.source_id = p_payment_id
      AND je.source_type IN ('vendor_payment','vendor_advance')
      AND gl.reconciliation_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'reopen_vendor_payment: payment % is bank-reconciled. Un-reconcile it first, then edit.', p_payment_id;
  END IF;

  -- Phase 18d: cascade runs for ALL classifications. An against_invoice
  -- receipt's unallocated portion can later be applied as an advance; the
  -- per-invoice count guard below still protects the ambiguous case.
  FOR v_alloc IN
    SELECT doc_id FROM public.payment_allocations
    WHERE payment_id = p_payment_id AND company_id = v_company_id AND doc_type = 'vendor_bill'
  LOOP
    SELECT COUNT(*) INTO v_aje_count
    FROM public.journal_entries
    WHERE company_id = v_company_id
      AND source_id = v_alloc.doc_id
      AND source_type = 'advance_application'
      AND reversed_by_id IS NULL
      AND reversal_of_id IS NULL;

    IF v_aje_count > 1 THEN
      RAISE EXCEPTION 'reopen_vendor_payment: bill % has multiple advance applications; reverse them manually first.', v_alloc.doc_id;
    END IF;

    IF v_aje_count = 1 THEN
      SELECT * INTO v_je
      FROM public.journal_entries
      WHERE company_id = v_company_id
        AND source_id = v_alloc.doc_id
        AND source_type = 'advance_application'
        AND reversed_by_id IS NULL
        AND reversal_of_id IS NULL
      LIMIT 1;

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
        'Edit reopen – reverse advance application',
        v_je.source_type, v_je.source_id,
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
          'Edit reopen – reverse advance application',
          v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
        );
      END LOOP;

      UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
    END IF;
  END LOOP;

  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id
      AND source_id = p_payment_id
      AND reversed_by_id IS NULL
      AND reversal_of_id IS NULL
      AND source_type IN ('vendor_payment','vendor_advance')
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
      'Edit reopen – ' || v_pmt.payment_number,
      v_je.source_type, p_payment_id,
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
        'Edit reopen – ' || v_pmt.payment_number,
        v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
      );
    END LOOP;

    UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
  END LOOP;

  DELETE FROM public.payment_allocations
  WHERE payment_id = p_payment_id AND company_id = v_company_id;

  UPDATE public.payments
  SET status = 'draft', void_reason = NULL,
      voided_at = NULL, voided_by = NULL, updated_at = NOW()
  WHERE id = p_payment_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'edit', 'vendor_payment', p_payment_id,
      jsonb_build_object('payment_number', v_pmt.payment_number, 'reopened', true));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('payment_id', p_payment_id, 'payment_number', v_pmt.payment_number, 'status', 'draft');
END;
$function$;


CREATE OR REPLACE FUNCTION public.cancel_pdc(p_pdc_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id UUID := auth.uid(); v_company_id UUID; v_pdc public.pdc_cheques%ROWTYPE;
  v_lock_date DATE; v_je RECORD; v_rev_je_id UUID; v_rev_je_num TEXT; v_total NUMERIC;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'cancel_pdc: no company for user %', v_user_id; END IF;
  SELECT * INTO v_pdc FROM public.pdc_cheques WHERE id = p_pdc_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'cancel_pdc: PDC % not found', p_pdc_id; END IF;
  IF v_pdc.status NOT IN ('pending','deposited') THEN RAISE EXCEPTION 'cancel_pdc: cannot cancel PDC in status %', v_pdc.status; END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_pdc.issue_date <= v_lock_date THEN RAISE EXCEPTION 'cancel_pdc: issue_date % is in a locked period', v_pdc.issue_date; END IF;

  SELECT * INTO v_je FROM public.journal_entries
   WHERE source_type = 'pdc_creation' AND source_id = p_pdc_id AND company_id = v_company_id AND reversed_by_id IS NULL
   ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'cancel_pdc: no live creation JE found for PDC %', p_pdc_id; END IF;

  SELECT COALESCE(SUM(debit), 0) INTO v_total FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1000, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'JE-' || current_value::TEXT INTO v_rev_je_num FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'JE';

  INSERT INTO public.journal_entries
    (company_id, entry_number, date, source_type, source_id, description, total_debit, total_credit, created_by, reversal_of_id)
  VALUES
    (v_company_id, v_rev_je_num, v_je.date, 'pdc_creation', p_pdc_id,
     'CANCELLED PDC: ' || v_pdc.pdc_number, v_total, v_total, v_user_id, v_je.id)
  RETURNING id INTO v_rev_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id, reversal_of_id)
  SELECT v_company_id, v_rev_je_id, account_id, account_code, date, credit, debit, 'CANCEL: ' || description, contact_id, related_doc_type, related_doc_id, id
    FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  UPDATE public.journal_entries SET reversed_by_id = v_rev_je_id WHERE id = v_je.id;
  UPDATE public.pdc_cheques SET status = 'cancelled', updated_at = NOW() WHERE id = p_pdc_id;

  INSERT INTO public.audit_logs (company_id, entity_type, entity_id, action, user_id, new_data)
  VALUES (v_company_id, 'pdc_cheques', p_pdc_id, 'void', v_user_id, jsonb_build_object('reversal_je_id', v_rev_je_id));

  RETURN jsonb_build_object('pdc_id', p_pdc_id, 'status', 'cancelled', 'reversal_je_id', v_rev_je_id);
END; $function$;


CREATE OR REPLACE FUNCTION public.void_bank_transfer(p_transfer_id uuid, p_void_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id UUID := auth.uid(); v_company_id UUID; v_transfer public.bank_transfers%ROWTYPE;
  v_lock_date DATE; v_je RECORD; v_rev_je_id UUID; v_rev_je_num TEXT; v_total NUMERIC;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'void_bank_transfer: no company for user %', v_user_id; END IF;
  SELECT * INTO v_transfer FROM public.bank_transfers WHERE id = p_transfer_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'void_bank_transfer: transfer % not found', p_transfer_id; END IF;
  IF v_transfer.status <> 'confirmed' THEN RAISE EXCEPTION 'void_bank_transfer: only confirmed transfers can be voided (status=%)', v_transfer.status; END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_transfer.date <= v_lock_date THEN RAISE EXCEPTION 'void_bank_transfer: posting date % is in a locked period', v_transfer.date; END IF;

  SELECT * INTO v_je FROM public.journal_entries
   WHERE source_type = 'bank_transfer' AND source_id = p_transfer_id AND company_id = v_company_id AND reversed_by_id IS NULL
   ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'void_bank_transfer: no live JE found for transfer %', p_transfer_id; END IF;

  SELECT COALESCE(SUM(debit), 0) INTO v_total FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1000, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'JE-' || current_value::TEXT INTO v_rev_je_num FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'JE';

  INSERT INTO public.journal_entries
    (company_id, entry_number, date, source_type, source_id, description, total_debit, total_credit, created_by, reversal_of_id)
  VALUES
    (v_company_id, v_rev_je_num, v_je.date, 'bank_transfer', p_transfer_id,
     'VOID: ' || COALESCE(p_void_reason, 'Bank Transfer Void'), v_total, v_total, v_user_id, v_je.id)
  RETURNING id INTO v_rev_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id, reversal_of_id)
  SELECT v_company_id, v_rev_je_id, account_id, account_code, date, credit, debit, 'VOID: ' || description, contact_id, related_doc_type, related_doc_id, id
    FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  UPDATE public.journal_entries SET reversed_by_id = v_rev_je_id WHERE id = v_je.id;
  UPDATE public.bank_transfers SET status = 'void', updated_at = NOW() WHERE id = p_transfer_id;

  INSERT INTO public.audit_logs (company_id, entity_type, entity_id, action, user_id, new_data)
  VALUES (v_company_id, 'bank_transfers', p_transfer_id, 'void', v_user_id, jsonb_build_object('void_reason', p_void_reason, 'reversal_je_id', v_rev_je_id));

  RETURN jsonb_build_object('transfer_id', p_transfer_id, 'reversal_je_id', v_rev_je_id);
END; $function$;


CREATE OR REPLACE FUNCTION public.reopen_bank_transfer(p_transfer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id UUID := auth.uid(); v_company_id UUID; v_transfer public.bank_transfers%ROWTYPE;
  v_lock_date DATE; v_je RECORD; v_rev_je_id UUID; v_rev_je_num TEXT; v_total NUMERIC;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'reopen_bank_transfer: no company for user %', v_user_id; END IF;
  SELECT * INTO v_transfer FROM public.bank_transfers WHERE id = p_transfer_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'reopen_bank_transfer: transfer % not found', p_transfer_id; END IF;
  IF v_transfer.status <> 'confirmed' THEN RAISE EXCEPTION 'reopen_bank_transfer: only confirmed transfers can be reopened (status=%)', v_transfer.status; END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_transfer.date <= v_lock_date THEN RAISE EXCEPTION 'reopen_bank_transfer: posting date % is in a locked period', v_transfer.date; END IF;

  SELECT * INTO v_je FROM public.journal_entries
   WHERE source_type = 'bank_transfer' AND source_id = p_transfer_id AND company_id = v_company_id AND reversed_by_id IS NULL
   ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'reopen_bank_transfer: no live JE found for transfer %', p_transfer_id; END IF;

  SELECT COALESCE(SUM(debit), 0) INTO v_total FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1000, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'JE-' || current_value::TEXT INTO v_rev_je_num FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'JE';

  INSERT INTO public.journal_entries
    (company_id, entry_number, date, source_type, source_id, description, total_debit, total_credit, created_by, reversal_of_id)
  VALUES
    (v_company_id, v_rev_je_num, v_je.date, 'bank_transfer', p_transfer_id,
     'REOPEN: Bank Transfer ' || v_transfer.transfer_number, v_total, v_total, v_user_id, v_je.id)
  RETURNING id INTO v_rev_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id, reversal_of_id)
  SELECT v_company_id, v_rev_je_id, account_id, account_code, date, credit, debit, 'REOPEN: ' || description, contact_id, related_doc_type, related_doc_id, id
    FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  UPDATE public.journal_entries SET reversed_by_id = v_rev_je_id WHERE id = v_je.id;
  UPDATE public.bank_transfers SET status = 'draft', updated_at = NOW() WHERE id = p_transfer_id;

  INSERT INTO public.audit_logs (company_id, entity_type, entity_id, action, user_id, new_data)
  VALUES (v_company_id, 'bank_transfers', p_transfer_id, 'update', v_user_id,
          jsonb_build_object('reopened', true, 'reversal_je_id', v_rev_je_id));

  RETURN jsonb_build_object('transfer_id', p_transfer_id, 'reversal_je_id', v_rev_je_id);
END; $function$;


CREATE OR REPLACE FUNCTION public.void_expense(p_expense_id uuid, p_void_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id UUID := auth.uid(); v_company_id UUID; v_expense public.expenses%ROWTYPE;
  v_lock_date DATE; v_je RECORD; v_rev_je_id UUID; v_rev_je_num TEXT; v_total NUMERIC;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'void_expense: no company for user %', v_user_id; END IF;
  SELECT * INTO v_expense FROM public.expenses WHERE id = p_expense_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'void_expense: expense % not found', p_expense_id; END IF;
  IF v_expense.status <> 'confirmed' THEN RAISE EXCEPTION 'void_expense: only confirmed expenses can be voided (status=%)', v_expense.status; END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_expense.date <= v_lock_date THEN RAISE EXCEPTION 'void_expense: posting date % is in a locked period', v_expense.date; END IF;

  SELECT * INTO v_je FROM public.journal_entries
   WHERE source_type = 'expense' AND source_id = p_expense_id AND company_id = v_company_id AND reversed_by_id IS NULL
   ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'void_expense: no live JE found for expense %', p_expense_id; END IF;

  SELECT COALESCE(SUM(debit), 0) INTO v_total FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1000, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'JE-' || current_value::TEXT INTO v_rev_je_num FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'JE';

  INSERT INTO public.journal_entries
    (company_id, entry_number, date, source_type, source_id, description, total_debit, total_credit, created_by, reversal_of_id)
  VALUES
    (v_company_id, v_rev_je_num, v_je.date, 'expense', p_expense_id,
     'VOID: ' || COALESCE(p_void_reason, 'Expense Void'), v_total, v_total, v_user_id, v_je.id)
  RETURNING id INTO v_rev_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id, reversal_of_id)
  SELECT v_company_id, v_rev_je_id, account_id, account_code, date, credit, debit, 'VOID: ' || description, contact_id, related_doc_type, related_doc_id, id
    FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  UPDATE public.journal_entries SET reversed_by_id = v_rev_je_id WHERE id = v_je.id;
  UPDATE public.expenses SET status = 'void', void_reason = p_void_reason, voided_at = NOW(), voided_by = v_user_id, updated_at = NOW() WHERE id = p_expense_id;

  INSERT INTO public.audit_logs (company_id, entity_type, entity_id, action, user_id, new_data)
  VALUES (v_company_id, 'expenses', p_expense_id, 'void', v_user_id, jsonb_build_object('void_reason', p_void_reason, 'reversal_je_id', v_rev_je_id));

  RETURN jsonb_build_object('expense_id', p_expense_id, 'reversal_je_id', v_rev_je_id);
END; $function$;


CREATE OR REPLACE FUNCTION public.reopen_expense(p_expense_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id UUID := auth.uid(); v_company_id UUID; v_expense public.expenses%ROWTYPE;
  v_lock_date DATE; v_je RECORD; v_rev_je_id UUID; v_rev_je_num TEXT; v_total NUMERIC;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'reopen_expense: no company for user %', v_user_id; END IF;

  SELECT * INTO v_expense FROM public.expenses WHERE id = p_expense_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'reopen_expense: expense % not found', p_expense_id; END IF;
  IF v_expense.status <> 'confirmed' THEN
    RAISE EXCEPTION 'reopen_expense: only confirmed expenses can be reopened (status=%)', v_expense.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_expense.date <= v_lock_date THEN
    RAISE EXCEPTION 'reopen_expense: posting date % is in a locked period', v_expense.date;
  END IF;

  -- Find the live posting JE for this expense.
  SELECT * INTO v_je FROM public.journal_entries
   WHERE source_type = 'expense' AND source_id = p_expense_id AND company_id = v_company_id AND reversed_by_id IS NULL
   ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'reopen_expense: no live JE found for expense %', p_expense_id; END IF;

  SELECT COALESCE(SUM(debit), 0) INTO v_total FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  -- Allocate a reversal JE number.
  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1000, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'JE-' || current_value::TEXT INTO v_rev_je_num FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'JE';

  -- Post the mirror-image reversal.
  INSERT INTO public.journal_entries
    (company_id, entry_number, date, source_type, source_id, description, total_debit, total_credit, created_by, reversal_of_id)
  VALUES
    (v_company_id, v_rev_je_num, v_je.date, 'expense', p_expense_id,
     'REOPEN: ' || COALESCE(v_expense.expense_number, 'Expense'), v_total, v_total, v_user_id, v_je.id)
  RETURNING id INTO v_rev_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id, reversal_of_id)
  SELECT v_company_id, v_rev_je_id, account_id, account_code, date, credit, debit, 'REOPEN: ' || description, contact_id, related_doc_type, related_doc_id, id
    FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  UPDATE public.journal_entries SET reversed_by_id = v_rev_je_id WHERE id = v_je.id;

  -- Flip the expense back to draft (clearing any void fields).
  UPDATE public.expenses
     SET status = 'draft', void_reason = NULL, voided_at = NULL, voided_by = NULL, updated_at = NOW()
   WHERE id = p_expense_id;

  INSERT INTO public.audit_logs (company_id, entity_type, entity_id, action, user_id, new_data)
  VALUES (v_company_id, 'expenses', p_expense_id, 'update', v_user_id,
          jsonb_build_object('reopened', true, 'reversal_je_id', v_rev_je_id));

  RETURN jsonb_build_object('expense_id', p_expense_id, 'reversal_je_id', v_rev_je_id);
END;
$function$;


CREATE OR REPLACE FUNCTION public.reverse_journal_entry(p_je_id uuid, p_description text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id     UUID := auth.uid();
  v_company_id  UUID;
  v_orig        public.journal_entries%ROWTYPE;
  v_rev_id      UUID;
  v_entry_number TEXT;
  v_seq         BIGINT;
  v_today       DATE := CURRENT_DATE;
  v_lock_date   DATE;
  v_gl          public.general_ledger%ROWTYPE;
BEGIN
  -- Resolve caller's company
  SELECT company_id INTO v_company_id
  FROM public.profiles
  WHERE id = v_user_id;
  -- Phase 14.14s — friendlier error messages with ERRCODEs so the front
  -- end can distinguish "no permission" vs "not found" vs "period locked"
  -- vs "already reversed" instead of showing raw Postgres strings.
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'You are not signed in to a company. Sign out and sign back in.'
      USING ERRCODE = '42501';
  END IF;

  -- Load original JE (must belong to same company)
  SELECT * INTO v_orig
  FROM public.journal_entries
  WHERE id = p_je_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry not found, or it belongs to a different company.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_orig.reversed_by_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Journal entry % is already reversed (entry %s). Refresh the page to see the current state.',
      v_orig.entry_number, v_orig.reversed_by_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Period lock guard on REVERSAL date (today)
  SELECT period_lock_date INTO v_lock_date
  FROM public.companies
  WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_orig.date <= v_lock_date THEN
    RAISE EXCEPTION
      'Period is locked. Cannot post a reversal on or before %s. Unlock the period (Accounting → Period Lock) or wait until after the lock date.',
      v_lock_date
      USING ERRCODE = 'P0001';
  END IF;

  -- Advance sequence
  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1,
        updated_at    = NOW()
  RETURNING current_value INTO v_seq;

  v_entry_number := 'JE-' || v_seq::TEXT;

  -- Insert reversal JE header
  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id,
    currency, exchange_rate,
    total_debit, total_credit,
    reversal_of_id,
    created_by
  ) VALUES (
    v_company_id,
    v_entry_number,
    v_orig.date,
    COALESCE(p_description, 'Reversal of ' || v_orig.entry_number),
    v_orig.source_type,
    v_orig.source_id,
    v_orig.currency,
    v_orig.exchange_rate,
    v_orig.total_credit,   -- swapped
    v_orig.total_debit,    -- swapped
    p_je_id,
    v_user_id
  )
  RETURNING id INTO v_rev_id;

  -- Mirror each GL line with Dr↔Cr flipped
  FOR v_gl IN
    SELECT * FROM public.general_ledger
    WHERE journal_entry_id = p_je_id
  LOOP
    INSERT INTO public.general_ledger (
      company_id, journal_entry_id, account_id, account_code, date,
      debit, credit, description,
      contact_id, related_doc_type, related_doc_id,
      reversal_of_id
    ) VALUES (
      v_company_id,
      v_rev_id,
      v_gl.account_id,
      v_gl.account_code,
      v_gl.date,
      v_gl.credit,  -- flipped
      v_gl.debit,   -- flipped
      COALESCE(p_description, 'Reversal of ' || v_orig.entry_number),
      v_gl.contact_id,
      v_gl.related_doc_type,
      v_gl.related_doc_id,
      v_gl.id
    );
  END LOOP;

  -- Mark original as reversed
  UPDATE public.journal_entries
  SET reversed_by_id = v_rev_id
  WHERE id = p_je_id;

  -- Audit log
  BEGIN
    INSERT INTO public.audit_logs (
      company_id, user_id, action, entity_type, entity_id, new_data
    ) VALUES (
      v_company_id, v_user_id, 'reverse_gl', 'journal_entry', v_rev_id,
      jsonb_build_object(
        'entry_number',    v_entry_number,
        'reversal_of_id',  p_je_id,
        'original_number', v_orig.entry_number
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'journal_entry_id', v_rev_id,
    'entry_number',     v_entry_number
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.void_opening_stock(p_stock_ledger_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_sl         RECORD;
  v_je_id      UUID;
  v_orig       public.journal_entries%ROWTYPE;
  v_rev_id     UUID;
  v_rev_entry  TEXT;
  v_seq        BIGINT;
  v_gl         public.general_ledger%ROWTYPE;
BEGIN
  -- Resolve caller's company
  SELECT company_id INTO v_company_id
  FROM public.profiles
  WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'void_opening_stock: not signed in to a company'
      USING ERRCODE = '42501';
  END IF;

  -- Load the stock_ledger row — must belong to this company and be opening_balance type
  SELECT * INTO v_sl
  FROM public.stock_ledger
  WHERE id = p_stock_ledger_id
    AND company_id = v_company_id
    AND type = 'opening_balance';

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'void_opening_stock: stock ledger row % not found or is not an opening balance entry',
      p_stock_ledger_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Find the journal entry that corresponds to this opening stock.
  -- post_opening_stock sets source_type='opening_balance', source_id=product_id.
  -- We match on product_id (source_id) and exclude already-reversed entries.
  SELECT je.id INTO v_je_id
  FROM public.journal_entries je
  WHERE je.company_id   = v_company_id
    AND je.source_type  = 'opening_balance'
    AND je.source_id    = v_sl.product_id
    AND je.reversal_of_id  IS NULL
    AND je.reversed_by_id  IS NULL
  ORDER BY je.created_at DESC
  LIMIT 1;

  -- Reverse the JE if found (safe to skip if it was already reversed manually)
  IF v_je_id IS NOT NULL THEN
    SELECT * INTO v_orig
    FROM public.journal_entries
    WHERE id = v_je_id AND company_id = v_company_id;

    -- Advance document sequence for the reversal entry
    INSERT INTO public.document_sequences
      (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES
      (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE
      SET current_value = public.document_sequences.current_value + 1,
          updated_at    = NOW()
    RETURNING current_value INTO v_seq;

    v_rev_entry := 'JE-' || v_seq::TEXT;

    -- Insert reversal JE header
    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description,
      source_type, source_id,
      currency, exchange_rate,
      total_debit, total_credit,
      reversal_of_id,
      created_by
    ) VALUES (
      v_company_id,
      v_rev_entry,
      v_orig.date,
      'Void opening stock — ' || v_orig.description,
      v_orig.source_type,
      v_orig.source_id,
      v_orig.currency,
      v_orig.exchange_rate,
      v_orig.total_credit,  -- swapped
      v_orig.total_debit,   -- swapped
      v_je_id,
      v_user_id
    )
    RETURNING id INTO v_rev_id;

    -- Mirror GL lines with Dr↔Cr flipped
    FOR v_gl IN
      SELECT * FROM public.general_ledger
      WHERE journal_entry_id = v_je_id
    LOOP
      INSERT INTO public.general_ledger (
        company_id, journal_entry_id, account_id, account_code, date,
        debit, credit, description,
        contact_id, related_doc_type, related_doc_id,
        reversal_of_id
      ) VALUES (
        v_company_id,
        v_rev_id,
        v_gl.account_id,
        v_gl.account_code,
        v_gl.date,
        v_gl.credit,  -- flipped
        v_gl.debit,   -- flipped
        'Void opening stock — ' || v_orig.description,
        v_gl.contact_id,
        v_gl.related_doc_type,
        v_gl.related_doc_id,
        v_gl.id
      );
    END LOOP;

    -- Mark original JE as reversed
    UPDATE public.journal_entries
    SET reversed_by_id = v_rev_id
    WHERE id = v_je_id;
  END IF;

  -- Hard-delete the stock_ledger row so the one-shot guard is cleared.
  -- This allows post_opening_stock to be called again for the same product+warehouse.
  DELETE FROM public.stock_ledger
  WHERE id = p_stock_ledger_id;

  RETURN jsonb_build_object(
    'voided',         true,
    'reversal_entry', COALESCE(v_rev_entry, 'no-je-found')
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- Data repair — re-date existing rows to the voucher date (idempotent).
-- Order matters: fix repost JEs first, then reversal JEs, then GL follows
-- its JE, then stock rows.
-- ---------------------------------------------------------------------------

-- 1. COGS JEs belonging to an invoice follow the invoice date (edit reposts
--    were stamped with the edit day). Deferred-COGS flush JEs reference a
--    bill or product, not an invoice, so they are untouched.
UPDATE public.journal_entries je
   SET date = i.date
  FROM public.invoices i, public.companies co
 WHERE je.source_type = 'inventory_cogs'
   AND je.source_id = i.id
   AND je.reversal_of_id IS NULL
   AND je.date <> i.date
   AND co.id = je.company_id
   AND (co.period_lock_date IS NULL OR i.date > co.period_lock_date);

-- 2. Reversal JEs take their original JE's date.
UPDATE public.journal_entries rev
   SET date = orig.date
  FROM public.journal_entries orig, public.companies co
 WHERE rev.reversal_of_id = orig.id
   AND co.id = rev.company_id
   AND rev.date <> orig.date
   AND (co.period_lock_date IS NULL OR orig.date > co.period_lock_date);

-- 3. GL rows always carry their JE's date.
UPDATE public.general_ledger gl
   SET date = je.date
  FROM public.journal_entries je
 WHERE gl.journal_entry_id = je.id
   AND gl.date <> je.date;

-- 4. Reversal stock rows take the reversed row's date.
UPDATE public.stock_ledger rev
   SET date = orig.date
  FROM public.stock_ledger orig, public.companies co
 WHERE rev.reversal_of_id = orig.id
   AND co.id = rev.company_id
   AND rev.date <> orig.date
   AND (co.period_lock_date IS NULL OR orig.date > co.period_lock_date);

-- 5. Live invoice stock rows follow the invoice date (edit reposts).
UPDATE public.stock_ledger sl
   SET date = i.date
  FROM public.invoices i, public.companies co
 WHERE sl.related_doc_type = 'invoice'
   AND sl.related_doc_id = i.id
   AND sl.reversal_of_id IS NULL
   AND sl.date <> i.date
   AND co.id = sl.company_id
   AND (co.period_lock_date IS NULL OR i.date > co.period_lock_date);

NOTIFY pgrst, 'reload schema';
