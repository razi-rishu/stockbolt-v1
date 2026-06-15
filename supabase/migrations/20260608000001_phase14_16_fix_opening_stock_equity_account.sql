-- ─────────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 14.16 — fix post_opening_stock equity account
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Root cause:
--   Phase 12.28 wrote post_opening_stock to credit 3200 (Owner's Equity).
--   All other opening balance entries (banks, GL brought-forward) credit 3010
--   (Opening Balance Equity) — the standard "plug" account used during
--   system go-live migration.
--
--   This caused the Balance Sheet to show two equity lines:
--     3010  Opening Balance Equity   500,000  ← bank openings
--     3200  Owner's Equity           300,000  ← inventory opening (wrong)
--
-- Fix:
--   Change the equity account lookup from code '3200' → '3010' so every
--   opening-balance entry — banks, GL, AND inventory — credits the same
--   plug account.
--
-- After running this fix:
--   • New inventory opening stock entries will DR 1300 / CR 3010 ✓
--   • Existing JE-1003 (the 300k lump sum) still sits in 3200 — the user
--     must void it from Settings → Opening Balances → Already posted (GL)
--     and re-enter the inventory items via the Opening Inventory CSV upload.
-- ─────────────────────────────────────────────────────────────────────────────

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

  -- Resolve GL accounts.
  -- Phase 14.16: credit 3010 Opening Balance Equity (not 3200 Owner's Equity).
  -- All go-live migration entries use 3010 as the standard plug account.
  -- Once setup is complete the operator closes 3010 → 3200 in one final JE.
  SELECT id INTO v_inv_id    FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1300' AND is_active;
  SELECT id INTO v_equity_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '3010' AND is_active;
  IF v_inv_id    IS NULL THEN RAISE EXCEPTION 'post_opening_stock: 1300 Inventory account not found'; END IF;
  IF v_equity_id IS NULL THEN RAISE EXCEPTION 'post_opening_stock: 3010 Opening Balance Equity account not found'; END IF;

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
     'opening_balance', NULL, 'Opening stock (Phase 14.16)')
  RETURNING id INTO v_sl_id;

  -- 2) Journal entry — Dr 1300 Inventory / Cr 3010 Opening Balance Equity
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
    -- DR 1300 Inventory
    (v_company_id, v_je_id, v_inv_id, '1300', v_date,
     v_total, 0,
     'Opening stock — product ' || p_product_id::TEXT,
     'product', p_product_id),
    -- CR 3010 Opening Balance Equity  (was 3200 — fixed Phase 14.16)
    (v_company_id, v_je_id, v_equity_id, '3010', v_date,
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

COMMENT ON FUNCTION public.post_opening_stock IS
  'Phase 14.16 — credits 3010 Opening Balance Equity instead of 3200 '
  'Owner''s Equity, consistent with all other go-live migration entries.';
