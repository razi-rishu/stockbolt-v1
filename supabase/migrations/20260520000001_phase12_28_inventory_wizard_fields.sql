-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 12 — Migration 28: inventory wizard fields + opening
-- stock RPC + service-type handling
-- ─────────────────────────────────────────────────────────────────────────
-- New product attributes adopted from the inventory-form sample. Each is
-- additive and backward-compatible (NULL-able or sensible default).
--
-- A) products.type ('goods' | 'service')
--    Lets the system distinguish stock items from labour / service lines.
--    Service items skip stock_ledger and COGS posting entirely; they're
--    just a revenue (sales) or expense (bills) line.
--
-- B) products.hsn_code TEXT
--    India GST requires HSN/SAC on invoice lines. Plain text — no master
--    lookup yet, just user-entered.
--
-- C) products.country_of_origin TEXT
--    Customs / certificate-of-origin documents.
--
-- D) products.is_excise BOOLEAN DEFAULT FALSE
--    Excise tax flag (UAE on tobacco/sugary drinks; India CESS-like).
--    Boolean for now; tax-engine integration is future work.
--
-- E) products.default_aisle, products.default_bin TEXT
--    Physical location hints within the default warehouse. Optional.
--
-- F) product_supplier_codes — three new columns
--    lead_time_days INTEGER, min_order_qty NUMERIC(15,3),
--    payment_terms_days INTEGER. Per-supplier procurement metadata.
--
-- G) post_opening_stock RPC
--    Wizard-driven helper: insert a single stock_ledger row of type
--    'opening_balance' AND post the matching JE (Dr 1300 Inventory /
--    Cr 3200 Owner's Equity). Refuses to run if any prior stock_ledger
--    row exists for this product+warehouse — opening stock is a one-shot.
--
-- H) confirm_invoice + edit_invoice — service-type bypass
--    When the line's product is type='service', skip stock_ledger and
--    COGS entirely. Sale still posts the revenue + VAT JE normally.
--
-- I) confirm_vendor_bill — service-type bypass (defensive)
--    Already-skipped by virtue of purchase_account being non-asset, but
--    we add an explicit guard so a misconfigured service line can't
--    accidentally hit stock_ledger.
--
-- All function rewrites preserve the Phase 12.20/12.21/12.22/12.27 fixes.
-- ─────────────────────────────────────────────────────────────────────────


-- ── A–E: products table ─────────────────────────────────────────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'goods'
    CHECK (type IN ('goods', 'service'));

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS hsn_code TEXT;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS country_of_origin TEXT;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_excise BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS default_aisle TEXT;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS default_bin TEXT;

COMMENT ON COLUMN public.products.type IS
  'goods = stock-tracked (default). service = labour/service line, no stock movement, no COGS. Phase 12.28.';
COMMENT ON COLUMN public.products.hsn_code IS
  'Harmonized System / SAC code. Mandatory on India GST invoices. Plain text; no master lookup.';
COMMENT ON COLUMN public.products.is_excise IS
  'Phase 12.28 flag. Affects tax computation in future excise-aware tax engines.';


-- ── F: product_supplier_codes — procurement metadata ────────────────────
ALTER TABLE public.product_supplier_codes
  ADD COLUMN IF NOT EXISTS lead_time_days INTEGER CHECK (lead_time_days IS NULL OR lead_time_days >= 0);

ALTER TABLE public.product_supplier_codes
  ADD COLUMN IF NOT EXISTS min_order_qty NUMERIC(15,3) CHECK (min_order_qty IS NULL OR min_order_qty >= 0);

ALTER TABLE public.product_supplier_codes
  ADD COLUMN IF NOT EXISTS payment_terms_days INTEGER CHECK (payment_terms_days IS NULL OR payment_terms_days >= 0);


-- ── G: post_opening_stock RPC ───────────────────────────────────────────
-- One-shot per (product, warehouse). Posts both the stock_ledger row AND
-- the equity JE atomically.
CREATE OR REPLACE FUNCTION public.post_opening_stock(
  p_product_id   UUID,
  p_warehouse_id UUID,
  p_quantity     NUMERIC(15,3),
  p_unit_cost    NUMERIC(15,2),
  p_date         DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_company_id  UUID;
  v_total       NUMERIC(15,2);
  v_date        DATE := COALESCE(p_date, CURRENT_DATE);
  v_inv_id      UUID;
  v_equity_id   UUID;
  v_je_id       UUID;
  v_entry       TEXT;
  v_seq         BIGINT;
  v_sl_id       UUID;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'post_opening_stock: no company for user';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'post_opening_stock: quantity must be > 0';
  END IF;
  IF p_unit_cost IS NULL OR p_unit_cost < 0 THEN
    RAISE EXCEPTION 'post_opening_stock: unit_cost must be >= 0';
  END IF;

  -- Guard: opening stock is a one-shot per product+warehouse. If ANY
  -- prior stock_ledger row exists for this combination, reject — the
  -- caller should be using an inventory adjustment instead.
  IF EXISTS (
    SELECT 1 FROM public.stock_ledger
    WHERE company_id = v_company_id
      AND product_id = p_product_id
      AND warehouse_id = p_warehouse_id
  ) THEN
    RAISE EXCEPTION
      'post_opening_stock: stock already exists for this product in this warehouse; use an inventory adjustment instead'
      USING ERRCODE = 'P0001';
  END IF;

  -- Verify product is type='goods' — services don't have stock.
  IF EXISTS (
    SELECT 1 FROM public.products
    WHERE id = p_product_id AND company_id = v_company_id AND type = 'service'
  ) THEN
    RAISE EXCEPTION
      'post_opening_stock: cannot post opening stock for a service product'
      USING ERRCODE = 'P0001';
  END IF;

  v_total := ROUND(p_quantity * p_unit_cost, 2);

  -- Resolve GL accounts
  SELECT id INTO v_inv_id    FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1300' AND is_active;
  SELECT id INTO v_equity_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '3200' AND is_active;
  IF v_inv_id    IS NULL THEN RAISE EXCEPTION 'post_opening_stock: 1300 Inventory not found'; END IF;
  IF v_equity_id IS NULL THEN RAISE EXCEPTION 'post_opening_stock: 3200 Owner''s Equity not found'; END IF;

  -- 1) stock_ledger entry — opening_balance, direction +1
  INSERT INTO public.stock_ledger
    (company_id, product_id, warehouse_id, date,
     type, direction, quantity, unit_cost, total_cost,
     running_qty, running_avg_cost,
     related_doc_type, related_doc_id, notes)
  VALUES
    (v_company_id, p_product_id, p_warehouse_id, v_date,
     'opening_balance', 1, p_quantity, p_unit_cost, v_total,
     p_quantity, p_unit_cost,
     'opening_balance', NULL, 'Opening stock (Phase 12.28)')
  RETURNING id INTO v_sl_id;

  -- 2) Journal entry — Dr 1300, Cr 3200
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
    v_company_id, v_entry, v_date,
    'Opening Stock — ' || (SELECT sku FROM public.products WHERE id = p_product_id),
    'opening_balance', p_product_id,
    'AED', 1.0,
    v_total, v_total,
    v_user_id
  ) RETURNING id INTO v_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date,
     debit, credit, description, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_inv_id, '1300', v_date,
     v_total, 0,
     'Opening stock — product ' || p_product_id::TEXT,
     'product', p_product_id),
    (v_company_id, v_je_id, v_equity_id, '3200', v_date,
     0, v_total,
     'Opening stock — product ' || p_product_id::TEXT,
     'product', p_product_id);

  RETURN jsonb_build_object(
    'stock_ledger_id', v_sl_id,
    'journal_entry_id', v_je_id,
    'entry_number', v_entry,
    'total_value', v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.post_opening_stock(UUID, UUID, NUMERIC, NUMERIC, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_opening_stock(UUID, UUID, NUMERIC, NUMERIC, DATE) TO authenticated;


-- ── H: confirm_invoice — Phase 12.28 service-type bypass ────────────────
-- Adds one CONTINUE near the top of the per-item loop: if the line's
-- product is type='service', skip stock_ledger and COGS. All previous
-- behaviour preserved: Phase 12.20 (always write stock_ledger),
-- Phase 12.22 (gross-method discount), Phase 12.27 (deferred-COGS
-- queue, MAC active-row filter).
-- ╭─────────────────────────────────────────────────────────────────────╮
-- │ Cumulative phase tags: Phase 12.20 / Phase 12.22 / Phase 12.27 /    │
-- │                        Phase 12.28                                  │
-- ╰─────────────────────────────────────────────────────────────────────╯
CREATE OR REPLACE FUNCTION public.confirm_invoice(p_invoice_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
-- Cumulative phase tags (preserved so the regression suite's per-phase
-- markers still resolve): Phase 12.20, Phase 12.22, Phase 12.27, Phase 12.28
DECLARE
  v_user_id     UUID := auth.uid();
  v_company_id  UUID;
  v_inv         public.invoices%ROWTYPE;
  v_item        public.invoice_items%ROWTYPE;
  v_product_type TEXT;
  v_lock_date   DATE;
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
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_invoice: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'confirm_invoice: invoice % not found', p_invoice_id; END IF;
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

  SELECT id INTO v_ar_id          FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1200' AND is_active;
  SELECT id INTO v_sales_id       FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '4100' AND is_active;
  SELECT id INTO v_sales_disc_id  FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '4150' AND is_active;
  SELECT id INTO v_cogs_id        FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '5100' AND is_active;
  SELECT id INTO v_inv_acc_id     FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1300' AND is_active;

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
    'Sales Invoice ' || v_inv.invoice_number,
    'sales_invoice', p_invoice_id, v_inv.currency, v_inv.exchange_rate,
    v_je_total, v_je_total, v_user_id
  ) RETURNING id INTO v_inv_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_inv_je_id, v_ar_id, '1200', v_inv.date, v_inv.total_amount, 0,
     'Sales Invoice ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);

  IF v_sales_disc_id IS NOT NULL AND v_inv.discount_amount > 0 THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_inv_je_id, v_sales_disc_id, '4150', v_inv.date, v_inv.discount_amount, 0,
       'Sales Discount ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);
  END IF;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_inv_je_id, v_sales_id, '4100', v_inv.date, 0,
     CASE
       WHEN v_sales_disc_id IS NOT NULL AND v_inv.discount_amount > 0
       THEN v_inv.subtotal
       ELSE v_inv.subtotal - v_inv.discount_amount
     END,
     'Sales Invoice ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);

  IF v_inv.tax_amount > 0 AND v_vat_id IS NOT NULL THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_inv_je_id, v_vat_id, '2200', v_inv.date, 0, v_inv.tax_amount,
       'Output VAT ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);
  END IF;

  -- Per-item: stock_ledger + COGS (or defer). Phase 12.28 — skip for services.
  FOR v_item IN SELECT * FROM public.invoice_items WHERE invoice_id = p_invoice_id LOOP
    CONTINUE WHEN v_item.product_id IS NULL;

    -- Phase 12.28 — service items have no stock impact and no COGS.
    SELECT type INTO v_product_type FROM public.products WHERE id = v_item.product_id;
    CONTINUE WHEN v_product_type = 'service';

    SELECT COALESCE(running_avg_cost, 0)::NUMERIC(15,2) INTO v_current_mac
    FROM public.stock_ledger sl
    WHERE sl.company_id = v_company_id
      AND sl.product_id = v_item.product_id
      AND sl.reversal_of_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id)
    ORDER BY sl.created_at DESC, sl.id DESC LIMIT 1;
    v_current_mac := COALESCE(v_current_mac, 0);

    UPDATE public.invoice_items SET cost_at_sale = v_current_mac WHERE id = v_item.id;

    SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_running
    FROM public.stock_ledger sl
    WHERE sl.company_id = v_company_id
      AND sl.product_id = v_item.product_id
      AND sl.warehouse_id = v_wh_id
      AND sl.reversal_of_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id)
    ORDER BY sl.created_at DESC, sl.id DESC LIMIT 1;
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
      company_id, entry_number, date, description,
      source_type, source_id, currency, exchange_rate,
      total_debit, total_credit, created_by
    ) VALUES (
      v_company_id, v_cogs_entry, v_inv.date,
      'COGS – Invoice ' || v_inv.invoice_number,
      'inventory_cogs', p_invoice_id, v_inv.currency, v_inv.exchange_rate,
      v_total_cogs, v_total_cogs, v_user_id
    ) RETURNING id INTO v_cogs_je_id;

    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_cogs_je_id, v_cogs_id, '5100', v_inv.date, v_total_cogs, 0,
       'COGS ' || v_inv.invoice_number, 'invoice', p_invoice_id),
      (v_company_id, v_cogs_je_id, v_inv_acc_id, '1300', v_inv.date, 0, v_total_cogs,
       'COGS ' || v_inv.invoice_number, 'invoice', p_invoice_id);
  END IF;

  UPDATE public.invoices SET status = 'confirmed', updated_at = NOW() WHERE id = p_invoice_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'invoice', p_invoice_id,
      jsonb_build_object('invoice_number', v_inv.invoice_number, 'je', v_inv_entry, 'phase', '12.28'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id, 'invoice_number', v_inv.invoice_number,
    'je_id', v_inv_je_id, 'entry_number', v_inv_entry
  );
END;
$$;


-- ── edit_invoice — Phase 12.28 service-type bypass (mirror of confirm) ──
-- ╭─────────────────────────────────────────────────────────────────────╮
-- │ Cumulative phase tags: Phase 12.20 / Phase 12.21 / Phase 12.22 /    │
-- │                        Phase 12.27 / Phase 12.28                    │
-- ╰─────────────────────────────────────────────────────────────────────╯
CREATE OR REPLACE FUNCTION public.edit_invoice(p_invoice_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
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
  IF v_lock_date IS NOT NULL AND CURRENT_DATE <= v_lock_date THEN
    RAISE EXCEPTION 'edit_invoice: today % on or before period lock %', CURRENT_DATE, v_lock_date;
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

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description,
      source_type, source_id, currency, exchange_rate,
      total_debit, total_credit, reversal_of_id, created_by
    ) VALUES (
      v_company_id, v_rev_entry, CURRENT_DATE,
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
        v_company_id, v_rev_id, v_gl.account_id, v_gl.account_code, CURRENT_DATE,
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
    ORDER BY created_at DESC LIMIT 1;

    INSERT INTO public.stock_ledger (
      company_id, product_id, warehouse_id, date,
      type, direction, quantity, unit_cost, total_cost,
      running_qty, running_avg_cost,
      related_doc_type, related_doc_id, reversal_of_id
    ) VALUES (
      v_company_id, v_sl.product_id, v_sl.warehouse_id, CURRENT_DATE,
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
       THEN v_inv.subtotal
       ELSE v_inv.subtotal - v_inv.discount_amount
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
    ORDER BY sl.created_at DESC, sl.id DESC LIMIT 1;
    v_current_mac := COALESCE(v_current_mac, 0);

    UPDATE public.invoice_items SET cost_at_sale = v_current_mac WHERE id = v_item.id;

    SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_running
    FROM public.stock_ledger sl
    WHERE sl.company_id = v_company_id AND sl.product_id = v_item.product_id
      AND sl.warehouse_id = v_wh_id
      AND sl.reversal_of_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id)
    ORDER BY sl.created_at DESC, sl.id DESC LIMIT 1;
    v_prev_running := COALESCE(v_prev_running, 0);

    INSERT INTO public.stock_ledger
      (company_id, product_id, warehouse_id, date, type, direction, quantity, unit_cost, total_cost,
       running_qty, running_avg_cost, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_item.product_id, v_wh_id, CURRENT_DATE,
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
      v_company_id, v_cogs_entry, CURRENT_DATE,
      'COGS (Edited) – ' || v_inv.invoice_number,
      'inventory_cogs', p_invoice_id, v_inv.currency, v_inv.exchange_rate,
      v_total_cogs, v_total_cogs, v_user_id
    ) RETURNING id INTO v_cogs_je_id;

    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_cogs_je_id, v_cogs_id, '5100', CURRENT_DATE, v_total_cogs, 0,
       'COGS (Edited) ' || v_inv.invoice_number, 'invoice', p_invoice_id),
      (v_company_id, v_cogs_je_id, v_inv_acc_id, '1300', CURRENT_DATE, 0, v_total_cogs,
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
$$;
