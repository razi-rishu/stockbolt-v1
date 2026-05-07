-- Phase 12 — Product purchase account + Vendor Bill auto-receive stock
--
-- Purpose: small auto-parts shops in GCC/India typically receive parts and
-- the supplier's invoice on the same truck. Forcing a separate GRN step is
-- unnecessary friction. Instead, each PRODUCT carries its own "purchase
-- account" (default 1300 Inventory), and the Vendor Bill confirmation
-- automatically:
--   • DRs that account per-line
--   • writes a stock_ledger inbound row + updates MAC when the account is an
--     asset class (1xxx) — i.e. the line represents stock
--   • behaves as a pure expense (no stock movement) when the account is 5xxx
--     or 6xxx — useful for items like "Customs Duty", "Transport Charges"
--     that come on supplier invoices but aren't physical stock
--
-- Existing B3 flow (linked_grn_id IS NOT NULL) is preserved unchanged for
-- shops that DO use the formal PO → GRN → Bill chain.

-- ── 1. Schema change ─────────────────────────────────────────────────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS purchase_account_id UUID
  REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.products.purchase_account_id IS
  'COA account used when this product appears on a vendor bill line. '
  'If account class is 1xxx (asset), confirm_vendor_bill writes a stock '
  'inbound row + updates MAC. If 5xxx/6xxx, posts as a pure expense with '
  'no stock movement. NULL falls back to 1300 Inventory.';

-- ── 2. Replace confirm_vendor_bill ──────────────────────────────────────────

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
  -- GL accounts
  v_ap_id        UUID;
  v_accrual_id   UUID;
  v_inv_id       UUID;
  v_vat_id       UUID;
  -- B3 amounts
  v_grn_total    NUMERIC(15,2) := 0;
  v_debit_2150   NUMERIC(15,2) := 0;
  v_variance     NUMERIC(15,2) := 0;
  v_bill_goods   NUMERIC(15,2);
  -- Per-line resolution (auto-receive path)
  v_line_acct_id UUID;
  v_line_code    TEXT;
  v_line_class   TEXT;          -- 'asset' | 'expense' | 'cogs' | etc.
  v_line_value   NUMERIC(15,2);
  -- MAC update
  v_old_mac        NUMERIC(15,2);
  v_old_total_qty  NUMERIC(15,3);
  v_qty_for_mac    NUMERIC(15,3);
  v_new_mac        NUMERIC(15,2);
  v_prev_wh_qty    NUMERIC(15,3);
  v_wh_id          UUID;
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

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_bill.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_vendor_bill: date % on or before period lock %', v_bill.date, v_lock_date;
  END IF;

  -- Resolve the standard GL accounts
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

  -- vendor_bills has no warehouse column — stock lands in the default warehouse
  SELECT id INTO v_wh_id FROM public.warehouses
  WHERE company_id = v_company_id AND is_default = TRUE AND is_active = TRUE
  LIMIT 1;
  IF v_wh_id IS NULL THEN
    -- Fall back to any active warehouse if no default is set
    SELECT id INTO v_wh_id FROM public.warehouses
    WHERE company_id = v_company_id AND is_active = TRUE
    ORDER BY created_at LIMIT 1;
  END IF;

  -- JE sequence
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

  -- ── B3: GRN-linked bill (existing flow, unchanged) ──────────────────────
  IF v_bill.linked_grn_id IS NOT NULL THEN
    SELECT COALESCE(SUM(total_cost), 0) INTO v_grn_total
    FROM public.goods_receipt_items
    WHERE grn_id = v_bill.linked_grn_id;

    v_bill_goods := v_bill.subtotal - v_bill.discount_amount;
    v_debit_2150 := LEAST(v_grn_total, v_bill_goods);
    v_variance   := v_bill_goods - v_debit_2150;

    IF v_debit_2150 > 0 THEN
      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date,
         debit, credit, description, contact_id, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_je_id, v_accrual_id, '2150', v_bill.date,
         v_debit_2150, 0,
         'Vendor Bill ' || v_bill.bill_number,
         v_bill.supplier_id, 'vendor_bill', p_bill_id);
    END IF;

    IF v_variance > 0 THEN
      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date,
         debit, credit, description, contact_id, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_je_id, v_inv_id, '1300', v_bill.date,
         v_variance, 0,
         'Bill variance ' || v_bill.bill_number,
         v_bill.supplier_id, 'vendor_bill', p_bill_id);
    END IF;

    UPDATE public.goods_receipts SET status = 'billed', updated_at = NOW()
    WHERE id = v_bill.linked_grn_id AND company_id = v_company_id;

  -- ── Auto-receive: no GRN linked — resolve per-line account from product ──
  ELSE
    FOR v_item IN SELECT * FROM public.vendor_bill_items WHERE bill_id = p_bill_id LOOP
      v_line_value := v_item.line_subtotal;
      IF v_line_value <= 0 THEN CONTINUE; END IF;

      -- 1. Resolve the account for this line
      v_line_acct_id := NULL;

      IF v_item.product_id IS NOT NULL THEN
        -- Use product.purchase_account_id, fall back to 1300 Inventory
        SELECT purchase_account_id INTO v_line_acct_id
        FROM public.products WHERE id = v_item.product_id;

        IF v_line_acct_id IS NULL THEN
          v_line_acct_id := v_inv_id;
        END IF;
      ELSIF v_item.coa_account_id IS NOT NULL THEN
        -- No product — user picked the expense account directly
        v_line_acct_id := v_item.coa_account_id;
      ELSE
        -- No product, no account — fall back to 1300 Inventory if the line
        -- has any value (defensive; UI should prevent this state)
        v_line_acct_id := v_inv_id;
      END IF;

      -- 2. Look up account class + code
      SELECT type, code INTO v_line_class, v_line_code
      FROM public.chart_of_accounts WHERE id = v_line_acct_id;

      -- 3. DR the resolved account
      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date,
         debit, credit, description, contact_id, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_je_id, v_line_acct_id, v_line_code, v_bill.date,
         v_line_value, 0,
         COALESCE(v_item.description, 'Vendor Bill ' || v_bill.bill_number),
         v_bill.supplier_id, 'vendor_bill', p_bill_id);

      -- 4. If line has a product AND the account is an asset, also move stock
      IF v_item.product_id IS NOT NULL
         AND v_line_class = 'asset'
         AND v_item.quantity > 0
         AND v_item.unit_cost > 0
      THEN
        -- Company-wide latest MAC
        SELECT COALESCE(running_avg_cost, 0) INTO v_old_mac
        FROM public.stock_ledger
        WHERE company_id = v_company_id AND product_id = v_item.product_id
        ORDER BY created_at DESC LIMIT 1;
        v_old_mac := COALESCE(v_old_mac, 0);

        -- Company-wide on-hand qty
        SELECT COALESCE(SUM(latest_qty), 0) INTO v_old_total_qty
        FROM (
          SELECT DISTINCT ON (warehouse_id) running_qty AS latest_qty
          FROM public.stock_ledger
          WHERE company_id = v_company_id AND product_id = v_item.product_id
          ORDER BY warehouse_id, created_at DESC
        ) sub;
        v_old_total_qty := COALESCE(v_old_total_qty, 0);

        -- Clamp negative stock to 0 for MAC weighting (back-orders shouldn't poison MAC)
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

        -- This warehouse's running qty
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
           'vendor_bill', p_bill_id);
      END IF;
    END LOOP;
  END IF;

  -- DR 1500 Input VAT (both paths)
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

  -- CR 2100 AP
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
      jsonb_build_object('bill_number', v_bill.bill_number, 'je', v_entry));
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
