-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 12 — Migration 17:
-- vendor_bill_items.warehouse_id + vendor_bills.landed_cost_total
-- ─────────────────────────────────────────────────────────────────────────
-- Two ERP-charter features:
--
-- 1. Per-line warehouse on vendor bills (standalone / auto-receive mode).
--    Previously every product line on a non-GRN bill posted stock to the
--    company default warehouse — impossible to receive a single bill
--    across multiple locations. Adds vendor_bill_items.warehouse_id; the
--    confirm RPC now reads it per line (falls back to default for nulls
--    so existing rows continue to work).
--
-- 2. Landed cost on vendor bills (freight, duty, customs, insurance).
--    Adds vendor_bills.landed_cost_total. On confirm, distributed across
--    PRODUCT lines by line_subtotal ratio. Effective unit cost used in
--    stock_ledger becomes (line_subtotal + alloc) / quantity, so MAC
--    correctly reflects total landed cost. GL DR Inventory rises by
--    landed_cost_total; CR AP rises by the same amount (already baked
--    into vendor_bills.total_amount by the editor).
--
-- Constraints:
--   - landed_cost_total only allowed on STANDALONE bills (linked_grn_id
--     IS NULL). GRN-linked bills already received stock at GRN time;
--     freight after the fact would need a separate adjustment.
--   - At least one product line required if landed_cost_total > 0
--     (otherwise nothing to allocate to).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.vendor_bill_items
  ADD COLUMN IF NOT EXISTS warehouse_id UUID
    REFERENCES public.warehouses(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS vendor_bill_items_warehouse_idx
  ON public.vendor_bill_items (warehouse_id);

ALTER TABLE public.vendor_bills
  ADD COLUMN IF NOT EXISTS landed_cost_total NUMERIC(15,2) NOT NULL DEFAULT 0
    CHECK (landed_cost_total >= 0);

COMMENT ON COLUMN public.vendor_bills.landed_cost_total IS
  'Freight + duty + customs + insurance baked into this bill. '
  'Allocated across product lines by subtotal ratio at confirm. '
  'Adds to inventory cost basis; must be 0 if linked_grn_id IS NOT NULL.';

COMMENT ON COLUMN public.vendor_bill_items.warehouse_id IS
  'Per-line destination warehouse for standalone (non-GRN) bills. '
  'NULL falls back to the company default at confirm.';

-- ─────────────────────────────────────────────────────────────────────────
-- Rewrite confirm_vendor_bill to honor per-line warehouse + landed cost.
-- The B3 (GRN-linked) branch is unchanged. The B4 (standalone) branch
-- gains:
--   - landed-cost allocation per product line, last line absorbs rounding
--   - per-line warehouse_id (fallback to default)
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.confirm_vendor_bill(p_bill_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id      UUID := auth.uid();
  v_company_id   UUID;
  v_bill         public.vendor_bills%ROWTYPE;
  v_item         public.vendor_bill_items%ROWTYPE;
  v_lock_date    DATE;
  v_je_id        UUID;
  v_entry        TEXT;
  v_seq          BIGINT;
  v_ap_id        UUID;
  v_accrual_id   UUID;
  v_inv_id       UUID;
  v_vat_id       UUID;
  v_grn_total    NUMERIC(15,2) := 0;
  v_debit_2150   NUMERIC(15,2) := 0;
  v_variance     NUMERIC(15,2) := 0;
  v_bill_goods   NUMERIC(15,2);
  v_line_acct_id UUID;
  v_line_code    TEXT;
  v_line_class   TEXT;
  v_line_value   NUMERIC(15,2);
  v_eff_unit     NUMERIC(15,4);
  v_old_mac        NUMERIC(15,2);
  v_old_total_qty  NUMERIC(15,3);
  v_qty_for_mac    NUMERIC(15,3);
  v_new_mac        NUMERIC(15,2);
  v_prev_wh_qty    NUMERIC(15,3);
  v_default_wh_id  UUID;
  v_line_wh_id     UUID;
  -- Landed-cost allocation state
  v_product_total  NUMERIC(15,2) := 0;   -- sum of product-line subtotals
  v_product_count  INTEGER := 0;
  v_landed_alloc   NUMERIC(15,2);
  v_landed_used    NUMERIC(15,2) := 0;    -- running tally so last line absorbs rounding
  v_is_last_prod   BOOLEAN;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_vendor_bill: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_bill FROM public.vendor_bills WHERE id = p_bill_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_vendor_bill: bill % not found', p_bill_id;
  END IF;
  IF v_bill.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_vendor_bill: bill % not in draft (status=%)', p_bill_id, v_bill.status;
  END IF;

  -- Landed cost only allowed on standalone bills (no GRN)
  IF v_bill.landed_cost_total > 0 AND v_bill.linked_grn_id IS NOT NULL THEN
    RAISE EXCEPTION
      'confirm_vendor_bill: landed_cost_total is not allowed on GRN-linked bills; post freight as a separate adjustment'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_bill.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_vendor_bill: date % on or before period lock %', v_bill.date, v_lock_date;
  END IF;

  SELECT id INTO v_ap_id      FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2100' AND is_active;
  SELECT id INTO v_accrual_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2150' AND is_active;
  SELECT id INTO v_inv_id     FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1300' AND is_active;
  IF v_ap_id IS NULL THEN
    RAISE EXCEPTION 'confirm_vendor_bill: account 2100 AP not found';
  END IF;
  IF v_bill.tax_amount > 0 THEN
    SELECT id INTO v_vat_id FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND code LIKE '15%' AND is_active
    ORDER BY code LIMIT 1;
  END IF;

  -- Company default warehouse (fallback for old rows with NULL warehouse_id)
  SELECT id INTO v_default_wh_id FROM public.warehouses
  WHERE company_id = v_company_id AND is_default = TRUE AND is_active = TRUE LIMIT 1;
  IF v_default_wh_id IS NULL THEN
    SELECT id INTO v_default_wh_id FROM public.warehouses
    WHERE company_id = v_company_id AND is_active = TRUE
    ORDER BY created_at LIMIT 1;
  END IF;

  -- ── Pre-compute landed-cost allocation totals (standalone bills only) ──
  IF v_bill.landed_cost_total > 0 THEN
    SELECT COALESCE(SUM(line_subtotal), 0), COUNT(*)
      INTO v_product_total, v_product_count
    FROM public.vendor_bill_items
    WHERE bill_id = p_bill_id
      AND product_id IS NOT NULL
      AND line_subtotal > 0;

    IF v_product_count = 0 THEN
      RAISE EXCEPTION
        'confirm_vendor_bill: landed_cost_total > 0 requires at least one product line to allocate to'
        USING ERRCODE = 'P0001';
    END IF;
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
    v_company_id, v_entry, v_bill.date,
    'Vendor Bill ' || v_bill.bill_number,
    'vendor_bill', p_bill_id,
    v_bill.currency, v_bill.exchange_rate,
    v_bill.total_amount, v_bill.total_amount,
    v_user_id
  ) RETURNING id INTO v_je_id;

  -- B3: GRN-linked bill (unchanged — landed cost forbidden here)
  IF v_bill.linked_grn_id IS NOT NULL THEN
    SELECT COALESCE(SUM(total_cost), 0) INTO v_grn_total
    FROM public.goods_receipt_items WHERE grn_id = v_bill.linked_grn_id;

    v_bill_goods := v_bill.subtotal - v_bill.discount_amount;
    v_debit_2150 := LEAST(v_grn_total, v_bill_goods);
    v_variance   := v_bill_goods - v_debit_2150;

    IF v_debit_2150 > 0 THEN
      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date,
         debit, credit, description, contact_id, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_je_id, v_accrual_id, '2150', v_bill.date,
         v_debit_2150, 0, 'Vendor Bill ' || v_bill.bill_number,
         v_bill.supplier_id, 'vendor_bill', p_bill_id);
    END IF;
    IF v_variance > 0 THEN
      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date,
         debit, credit, description, contact_id, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_je_id, v_inv_id, '1300', v_bill.date,
         v_variance, 0, 'Bill variance ' || v_bill.bill_number,
         v_bill.supplier_id, 'vendor_bill', p_bill_id);
    END IF;
    UPDATE public.goods_receipts SET status = 'billed', updated_at = NOW()
    WHERE id = v_bill.linked_grn_id AND company_id = v_company_id;

  -- B4: Standalone bill (auto-receive products + post expenses)
  ELSE
    FOR v_item IN
      SELECT * FROM public.vendor_bill_items
      WHERE bill_id = p_bill_id
      ORDER BY id
    LOOP
      v_line_value := v_item.line_subtotal;
      IF v_line_value <= 0 THEN CONTINUE; END IF;

      -- ── Landed-cost allocation for this line ─────────────────────────
      v_landed_alloc := 0;
      IF v_bill.landed_cost_total > 0
         AND v_item.product_id IS NOT NULL
         AND v_product_total > 0
      THEN
        -- Is this the last product line? If so, absorb remainder to avoid drift.
        SELECT (NOT EXISTS (
          SELECT 1 FROM public.vendor_bill_items
          WHERE bill_id = p_bill_id
            AND product_id IS NOT NULL
            AND line_subtotal > 0
            AND id > v_item.id
        )) INTO v_is_last_prod;

        IF v_is_last_prod THEN
          v_landed_alloc := v_bill.landed_cost_total - v_landed_used;
        ELSE
          v_landed_alloc := ROUND(
            (v_line_value / v_product_total) * v_bill.landed_cost_total,
            2
          );
          v_landed_used := v_landed_used + v_landed_alloc;
        END IF;
      END IF;

      v_line_acct_id := NULL;
      IF v_item.product_id IS NOT NULL THEN
        SELECT purchase_account_id INTO v_line_acct_id FROM public.products WHERE id = v_item.product_id;
        IF v_line_acct_id IS NULL THEN v_line_acct_id := v_inv_id; END IF;
      ELSIF v_item.coa_account_id IS NOT NULL THEN
        v_line_acct_id := v_item.coa_account_id;
      ELSE
        v_line_acct_id := v_inv_id;
      END IF;

      SELECT type, code INTO v_line_class, v_line_code
      FROM public.chart_of_accounts WHERE id = v_line_acct_id;

      -- DR amount = line subtotal + landed cost allocation (for product lines)
      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date,
         debit, credit, description, contact_id, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_je_id, v_line_acct_id, v_line_code, v_bill.date,
         v_line_value + v_landed_alloc, 0,
         COALESCE(v_item.description, 'Vendor Bill ' || v_bill.bill_number),
         v_bill.supplier_id, 'vendor_bill', p_bill_id);

      -- Stock movement when account class is asset.
      -- Effective unit cost includes landed cost allocation.
      IF v_item.product_id IS NOT NULL
         AND v_line_class = 'asset'
         AND v_item.quantity > 0
         AND v_line_value > 0
      THEN
        v_eff_unit := ROUND((v_line_value + v_landed_alloc) / v_item.quantity, 4);

        -- Per-line warehouse, fallback to default for old/null rows
        v_line_wh_id := COALESCE(v_item.warehouse_id, v_default_wh_id);
        IF v_line_wh_id IS NULL THEN
          RAISE EXCEPTION 'confirm_vendor_bill: no warehouse_id on line for product % and no default warehouse', v_item.product_id;
        END IF;

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
            (v_old_mac * v_qty_for_mac + v_eff_unit * v_item.quantity)
            / (v_qty_for_mac + v_item.quantity),
            2
          );
        ELSE
          v_new_mac := ROUND(v_eff_unit, 2);
        END IF;

        SELECT COALESCE(running_qty, 0) INTO v_prev_wh_qty
        FROM public.stock_ledger
        WHERE company_id = v_company_id AND product_id = v_item.product_id
          AND warehouse_id = v_line_wh_id
        ORDER BY created_at DESC LIMIT 1;
        v_prev_wh_qty := COALESCE(v_prev_wh_qty, 0);

        INSERT INTO public.stock_ledger
          (company_id, product_id, warehouse_id, date,
           type, direction, quantity, unit_cost, total_cost,
           running_qty, running_avg_cost,
           related_doc_type, related_doc_id)
        VALUES
          (v_company_id, v_item.product_id, v_line_wh_id, v_bill.date,
           'purchase', 1, v_item.quantity, v_eff_unit, v_line_value + v_landed_alloc,
           v_prev_wh_qty + v_item.quantity, v_new_mac,
           'vendor_bill', p_bill_id);
      END IF;
    END LOOP;
  END IF;

  IF v_bill.tax_amount > 0 AND v_vat_id IS NOT NULL THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_vat_id, '1500', v_bill.date,
       v_bill.tax_amount, 0,
       'Input VAT ' || v_bill.bill_number,
       v_bill.supplier_id, 'vendor_bill', p_bill_id);
  END IF;

  -- CR 2100 AP (bill.total_amount already includes landed_cost_total
  -- because the editor adds it to total_amount on save)
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date,
     debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_ap_id, '2100', v_bill.date,
     0, v_bill.total_amount,
     'Vendor Bill ' || v_bill.bill_number,
     v_bill.supplier_id, 'vendor_bill', p_bill_id);

  UPDATE public.vendor_bills SET status = 'confirmed', updated_at = NOW() WHERE id = p_bill_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'vendor_bill', p_bill_id,
      jsonb_build_object(
        'bill_number',       v_bill.bill_number,
        'je',                v_entry,
        'landed_cost_total', v_bill.landed_cost_total
      ));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'bill_id',      p_bill_id,
    'bill_number',  v_bill.bill_number,
    'je_id',        v_je_id,
    'entry_number', v_entry
  );
END;
$$;
