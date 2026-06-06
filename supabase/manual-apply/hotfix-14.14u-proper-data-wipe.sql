-- ═══════════════════════════════════════════════════════════════════════════
-- StockBolt — Phase 14.14u hotfix
-- Fix: reset_company_data did not wipe bank accounts or custom CoA rows.
--
-- Old behaviour (Phase 12.13 on the live DB):
--   - Wiped transactions (invoices, JEs, payments, stock, etc.)
--   - KEPT bank accounts, contacts, products, warehouses, tax rates,
--     categories, brands, units, CoA custom rows — everything the operator
--     entered. After a wipe, banks and custom accounts were still visible.
--
-- New behaviour (Phase 14.13e + 14.13f merged here):
--   - Wipes ALL transactions (Tier A–E, unchanged)
--   - ALSO wipes ALL setup masters: bank accounts, salespeople, price levels,
--     tax rates, payment methods, warehouses, vehicle makes/models, brands,
--     categories, units of measure, print templates   ← new Tier F
--   - ALSO wipes custom chart_of_accounts rows (is_system = false)          ← new Tier G
--   - KEEPS the 39 seeded default CoA rows (is_system = true) — RPCs
--     reference codes 1100–6200 and a re-seed is out of scope for reset
--   - KEEPS companies + profiles (structurally required to stay logged in)
--   - Resets document_sequences so numbering starts fresh at INV-1001, etc.
--
-- Standard rule: caller must be admin AND type the company name exactly
-- as confirmation to prevent accidental wipes.
--
-- HOW TO RUN
-- ──────────
-- Supabase Dashboard → SQL Editor → New query → paste this → Run.
-- "Success. No rows returned." → done. Idempotent (CREATE OR REPLACE).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.reset_company_data(
  p_company_id   UUID,
  p_confirmation TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id     UUID;
  v_caller_co   UUID;
  v_caller_role TEXT;
  v_co_name     TEXT;
  v_counts      JSONB := '{}'::jsonb;
  v_deleted_at  TIMESTAMPTZ := NOW();
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'reset_company_data: not authenticated'
      USING ERRCODE = '42501';
  END IF;

  -- Caller must be admin on this company.
  SELECT company_id, role INTO v_caller_co, v_caller_role
  FROM public.profiles WHERE id = v_user_id;

  IF v_caller_co IS NULL OR v_caller_co <> p_company_id THEN
    RAISE EXCEPTION 'reset_company_data: caller not in company %', p_company_id
      USING ERRCODE = '42501';
  END IF;

  IF v_caller_role <> 'admin' THEN
    RAISE EXCEPTION 'reset_company_data: only admin can reset (caller is %)', v_caller_role
      USING ERRCODE = '42501';
  END IF;

  -- Typed-confirmation must match company name exactly.
  SELECT name INTO v_co_name FROM public.companies WHERE id = p_company_id;
  IF v_co_name IS NULL THEN
    RAISE EXCEPTION 'reset_company_data: company % not found', p_company_id
      USING ERRCODE = 'P0002';
  END IF;
  IF p_confirmation IS NULL OR p_confirmation <> v_co_name THEN
    RAISE EXCEPTION
      'reset_company_data: confirmation does not match company name. Type "%" exactly.', v_co_name
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Tier A: junction / line-item / allocation rows ────────────────────
  WITH d AS (DELETE FROM public.payment_allocations WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('payment_allocations', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM public.invoices WHERE company_id = p_company_id) RETURNING 1)
    SELECT v_counts || jsonb_build_object('invoice_items', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.sales_quote_items WHERE quote_id IN (SELECT id FROM public.sales_quotes WHERE company_id = p_company_id) RETURNING 1)
    SELECT v_counts || jsonb_build_object('sales_quote_items', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.sales_order_items WHERE order_id IN (SELECT id FROM public.sales_orders WHERE company_id = p_company_id) RETURNING 1)
    SELECT v_counts || jsonb_build_object('sales_order_items', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.credit_note_items WHERE credit_note_id IN (SELECT id FROM public.credit_notes WHERE company_id = p_company_id) RETURNING 1)
    SELECT v_counts || jsonb_build_object('credit_note_items', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.sales_return_items WHERE sales_return_id IN (SELECT id FROM public.sales_returns WHERE company_id = p_company_id) RETURNING 1)
    SELECT v_counts || jsonb_build_object('sales_return_items', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.purchase_order_items WHERE po_id IN (SELECT id FROM public.purchase_orders WHERE company_id = p_company_id) RETURNING 1)
    SELECT v_counts || jsonb_build_object('purchase_order_items', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.goods_receipt_items WHERE grn_id IN (SELECT id FROM public.goods_receipts WHERE company_id = p_company_id) RETURNING 1)
    SELECT v_counts || jsonb_build_object('goods_receipt_items', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.vendor_bill_items WHERE bill_id IN (SELECT id FROM public.vendor_bills WHERE company_id = p_company_id) RETURNING 1)
    SELECT v_counts || jsonb_build_object('vendor_bill_items', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.debit_note_items WHERE debit_note_id IN (SELECT id FROM public.debit_notes WHERE company_id = p_company_id) RETURNING 1)
    SELECT v_counts || jsonb_build_object('debit_note_items', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.stock_transfer_items WHERE transfer_id IN (SELECT id FROM public.stock_transfers WHERE company_id = p_company_id) RETURNING 1)
    SELECT v_counts || jsonb_build_object('stock_transfer_items', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.inventory_adjustment_items WHERE adjustment_id IN (SELECT id FROM public.inventory_adjustments WHERE company_id = p_company_id) RETURNING 1)
    SELECT v_counts || jsonb_build_object('inventory_adjustment_items', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.expense_items WHERE expense_id IN (SELECT id FROM public.expenses WHERE company_id = p_company_id) RETURNING 1)
    SELECT v_counts || jsonb_build_object('expense_items', (SELECT COUNT(*) FROM d)) INTO v_counts;

  -- ── Tier B: GL plumbing & inventory ledger ────────────────────────────
  WITH d AS (DELETE FROM public.bank_reconciliations WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('bank_reconciliations', (SELECT COUNT(*) FROM d)) INTO v_counts;

  -- general_ledger and journal_entries have ON DELETE RESTRICT self-refs.
  UPDATE public.general_ledger
     SET reversal_of_id = NULL
   WHERE company_id = p_company_id AND reversal_of_id IS NOT NULL;
  UPDATE public.journal_entries
     SET reversed_by_id = NULL, reversal_of_id = NULL
   WHERE company_id = p_company_id
     AND (reversed_by_id IS NOT NULL OR reversal_of_id IS NOT NULL);

  WITH d AS (DELETE FROM public.general_ledger WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('general_ledger', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.deferred_cogs_queue WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('deferred_cogs_queue', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.stock_ledger WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('stock_ledger', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.journal_entries WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('journal_entries', (SELECT COUNT(*) FROM d)) INTO v_counts;

  -- ── Tier C: Source documents ──────────────────────────────────────────
  WITH d AS (DELETE FROM public.payments WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('payments', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.invoices WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('invoices', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.sales_quotes WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('sales_quotes', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.sales_orders WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('sales_orders', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.credit_notes WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('credit_notes', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.sales_returns WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('sales_returns', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.vendor_bills WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('vendor_bills', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.goods_receipts WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('goods_receipts', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.purchase_orders WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('purchase_orders', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.debit_notes WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('debit_notes', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.stock_transfers WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('stock_transfers', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.inventory_adjustments WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('inventory_adjustments', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.expenses WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('expenses', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.bank_transfers WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('bank_transfers', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.pdc_cheques WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('pdc_cheques', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.pos_sessions WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('pos_sessions', (SELECT COUNT(*) FROM d)) INTO v_counts;

  -- ── Tier D: operational masters ───────────────────────────────────────
  WITH d AS (DELETE FROM public.product_serials WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('product_serials', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.product_supplier_codes WHERE product_id IN (SELECT id FROM public.products WHERE company_id = p_company_id) RETURNING 1)
    SELECT v_counts || jsonb_build_object('product_supplier_codes', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.product_price_levels WHERE product_id IN (SELECT id FROM public.products WHERE company_id = p_company_id) RETURNING 1)
    SELECT v_counts || jsonb_build_object('product_price_levels', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.product_compatibility WHERE product_id IN (SELECT id FROM public.products WHERE company_id = p_company_id) RETURNING 1)
    SELECT v_counts || jsonb_build_object('product_compatibility', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.products WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('products', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.contacts WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('contacts', (SELECT COUNT(*) FROM d)) INTO v_counts;

  -- ── Tier E: ambient ───────────────────────────────────────────────────
  WITH d AS (DELETE FROM public.attachments WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('attachments', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.notifications WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('notifications', (SELECT COUNT(*) FROM d)) INTO v_counts;

  -- ── Tier F: setup masters ─────────────────────────────────────────────
  -- All transactions referencing these tables are gone (Tiers A–E done).
  -- Bank accounts — the main fix: user-created banks now get deleted.
  WITH d AS (DELETE FROM public.bank_accounts WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('bank_accounts', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.salespeople WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('salespeople', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.price_levels WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('price_levels', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.tax_rates WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('tax_rates', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.payment_methods WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('payment_methods', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.warehouses WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('warehouses', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.vehicle_models WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('vehicle_models', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.vehicle_makes WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('vehicle_makes', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.brands WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('brands', (SELECT COUNT(*) FROM d)) INTO v_counts;
  -- Categories: self-referential parent_id — NULL children first, then delete.
  UPDATE public.categories SET parent_id = NULL
   WHERE company_id = p_company_id AND parent_id IS NOT NULL;
  WITH d AS (DELETE FROM public.categories WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('categories', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.units_of_measure WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('units_of_measure', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.print_templates WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('print_templates', (SELECT COUNT(*) FROM d)) INTO v_counts;

  -- ── Tier G: custom chart_of_accounts (is_system = false) ─────────────
  -- The 39 seed accounts (is_system = true) survive — RPCs reference their
  -- codes (1100, 1200, 2100, 3010, etc.) and re-seeding would need its own
  -- migration. Everything the operator added (extra bank sub-accounts, custom
  -- expense heads, etc.) is deleted.
  UPDATE public.chart_of_accounts
     SET parent_id = NULL
   WHERE company_id = p_company_id
     AND is_system = false
     AND parent_id IS NOT NULL;

  WITH d AS (DELETE FROM public.chart_of_accounts
              WHERE company_id = p_company_id
                AND is_system = false
              RETURNING 1)
    SELECT v_counts || jsonb_build_object('chart_of_accounts_custom', (SELECT COUNT(*) FROM d)) INTO v_counts;

  -- ── Reset document_sequences so numbering starts fresh ───────────────
  UPDATE public.document_sequences
     SET current_value = 1000, updated_at = NOW()
   WHERE company_id = p_company_id;

  -- ── Audit: wipe old entries, leave exactly one record of this reset ───
  DELETE FROM public.audit_logs WHERE company_id = p_company_id;
  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
  VALUES (p_company_id, v_user_id, 'delete', 'company_reset', p_company_id,
          jsonb_build_object(
            'reset_at', v_deleted_at,
            'counts',   v_counts,
            'caller',   v_user_id,
            'phase',    '14.14u_full_wipe'
          ));

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'reset_at',   v_deleted_at,
    'counts',     v_counts
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reset_company_data(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_company_data(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.reset_company_data(UUID, TEXT) IS
  'DESTRUCTIVE. True clean slate — wipes ALL transactions, ALL setup masters '
  '(bank accounts, units, categories, brands, vehicles, warehouses, price levels, '
  'tax rates, payment methods, salespeople, print templates), AND custom '
  'chart_of_accounts rows (is_system=false). Only preserved: company, profiles, '
  'and the 39 seed CoA rows (is_system=true). Caller must be admin AND type '
  'the company name exactly as confirmation. Atomic.';


NOTIFY pgrst, 'reload schema';
