-- ═══════════════════════════════════════════════════════════════════════════
-- StockBolt — Phase 14.14u hotfix (v2)
-- Fix: reset_company_data — wipe bank accounts + custom CoA.
--
-- v2 change: function parameters renamed from p_company_id / p_confirmation
-- to company_id / confirmation (no p_ prefix). Supabase's PostgREST strips
-- the p_ prefix when matching request body keys to function parameters, so
-- the adapter must send { company_id, confirmation } and the function must
-- accept those exact names. A v_cid local variable is used inside the body
-- to avoid SQL column-name conflicts with the parameter name.
--
-- WHAT GETS WIPED
-- ───────────────
-- All transactions (invoices, bills, payments, JEs, stock, expenses, etc.)
-- All setup masters: bank accounts, warehouses, tax rates, payment methods,
--   price levels, salespeople, brands, categories, units, print templates,
--   vehicle makes/models
-- Custom chart_of_accounts rows (is_system = false)
--
-- WHAT IS KEPT
-- ────────────
-- companies + profiles  (structurally required to stay logged in)
-- Seed CoA rows (is_system = true) — RPCs hard-code codes 1100–6200
-- document_sequences reset to 1000 (not deleted)
--
-- HOW TO RUN
-- ──────────
-- Supabase Dashboard → SQL Editor → New query → paste this → Run.
-- "Success. No rows returned." → done. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.reset_company_data(
  company_id   UUID,   -- NOTE: no p_ prefix (Supabase PostgREST strips p_)
  confirmation TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Copy parameters to local variables immediately to avoid SQL column-name
  -- conflicts. In PL/pgSQL SQL blocks, unqualified "company_id" resolves to
  -- the table column, not the function parameter. v_cid holds the caller's
  -- intended company UUID throughout.
  v_cid         UUID := company_id;
  v_conf        TEXT := confirmation;

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

  SELECT public.profiles.company_id, role INTO v_caller_co, v_caller_role
  FROM public.profiles WHERE id = v_user_id;

  IF v_caller_co IS NULL OR v_caller_co <> v_cid THEN
    RAISE EXCEPTION 'reset_company_data: caller not in company %', v_cid
      USING ERRCODE = '42501';
  END IF;

  IF v_caller_role <> 'admin' THEN
    RAISE EXCEPTION 'reset_company_data: only admin can reset (caller is %)', v_caller_role
      USING ERRCODE = '42501';
  END IF;

  SELECT name INTO v_co_name FROM public.companies WHERE id = v_cid;
  IF v_co_name IS NULL THEN
    RAISE EXCEPTION 'reset_company_data: company % not found', v_cid
      USING ERRCODE = 'P0002';
  END IF;
  IF v_conf IS NULL OR v_conf <> v_co_name THEN
    RAISE EXCEPTION
      'reset_company_data: confirmation does not match company name. Type "%" exactly.', v_co_name
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Tier A: junction / line-item / allocation rows ────────────────────
  WITH d AS (DELETE FROM public.payment_allocations WHERE public.payment_allocations.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('payment_allocations', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM public.invoices WHERE public.invoices.company_id = v_cid) RETURNING 1)
    SELECT v_counts || jsonb_build_object('invoice_items', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.sales_quote_items WHERE quote_id IN (SELECT id FROM public.sales_quotes WHERE public.sales_quotes.company_id = v_cid) RETURNING 1)
    SELECT v_counts || jsonb_build_object('sales_quote_items', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.sales_order_items WHERE order_id IN (SELECT id FROM public.sales_orders WHERE public.sales_orders.company_id = v_cid) RETURNING 1)
    SELECT v_counts || jsonb_build_object('sales_order_items', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.credit_note_items WHERE credit_note_id IN (SELECT id FROM public.credit_notes WHERE public.credit_notes.company_id = v_cid) RETURNING 1)
    SELECT v_counts || jsonb_build_object('credit_note_items', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.sales_return_items WHERE sales_return_id IN (SELECT id FROM public.sales_returns WHERE public.sales_returns.company_id = v_cid) RETURNING 1)
    SELECT v_counts || jsonb_build_object('sales_return_items', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.purchase_order_items WHERE po_id IN (SELECT id FROM public.purchase_orders WHERE public.purchase_orders.company_id = v_cid) RETURNING 1)
    SELECT v_counts || jsonb_build_object('purchase_order_items', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.goods_receipt_items WHERE grn_id IN (SELECT id FROM public.goods_receipts WHERE public.goods_receipts.company_id = v_cid) RETURNING 1)
    SELECT v_counts || jsonb_build_object('goods_receipt_items', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.vendor_bill_items WHERE bill_id IN (SELECT id FROM public.vendor_bills WHERE public.vendor_bills.company_id = v_cid) RETURNING 1)
    SELECT v_counts || jsonb_build_object('vendor_bill_items', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.debit_note_items WHERE debit_note_id IN (SELECT id FROM public.debit_notes WHERE public.debit_notes.company_id = v_cid) RETURNING 1)
    SELECT v_counts || jsonb_build_object('debit_note_items', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.stock_transfer_items WHERE transfer_id IN (SELECT id FROM public.stock_transfers WHERE public.stock_transfers.company_id = v_cid) RETURNING 1)
    SELECT v_counts || jsonb_build_object('stock_transfer_items', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.inventory_adjustment_items WHERE adjustment_id IN (SELECT id FROM public.inventory_adjustments WHERE public.inventory_adjustments.company_id = v_cid) RETURNING 1)
    SELECT v_counts || jsonb_build_object('inventory_adjustment_items', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.expense_items WHERE expense_id IN (SELECT id FROM public.expenses WHERE public.expenses.company_id = v_cid) RETURNING 1)
    SELECT v_counts || jsonb_build_object('expense_items', (SELECT COUNT(*) FROM d)) INTO v_counts;

  -- ── Tier B: GL plumbing & inventory ledger ────────────────────────────
  WITH d AS (DELETE FROM public.bank_reconciliations WHERE public.bank_reconciliations.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('bank_reconciliations', (SELECT COUNT(*) FROM d)) INTO v_counts;
  UPDATE public.general_ledger SET reversal_of_id = NULL
   WHERE public.general_ledger.company_id = v_cid AND reversal_of_id IS NOT NULL;
  UPDATE public.journal_entries SET reversed_by_id = NULL, reversal_of_id = NULL
   WHERE public.journal_entries.company_id = v_cid
     AND (reversed_by_id IS NOT NULL OR reversal_of_id IS NOT NULL);
  WITH d AS (DELETE FROM public.general_ledger WHERE public.general_ledger.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('general_ledger', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.deferred_cogs_queue WHERE public.deferred_cogs_queue.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('deferred_cogs_queue', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.stock_ledger WHERE public.stock_ledger.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('stock_ledger', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.journal_entries WHERE public.journal_entries.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('journal_entries', (SELECT COUNT(*) FROM d)) INTO v_counts;

  -- ── Tier C: Source documents ──────────────────────────────────────────
  WITH d AS (DELETE FROM public.payments WHERE public.payments.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('payments', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.invoices WHERE public.invoices.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('invoices', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.sales_quotes WHERE public.sales_quotes.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('sales_quotes', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.sales_orders WHERE public.sales_orders.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('sales_orders', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.credit_notes WHERE public.credit_notes.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('credit_notes', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.sales_returns WHERE public.sales_returns.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('sales_returns', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.vendor_bills WHERE public.vendor_bills.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('vendor_bills', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.goods_receipts WHERE public.goods_receipts.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('goods_receipts', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.purchase_orders WHERE public.purchase_orders.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('purchase_orders', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.debit_notes WHERE public.debit_notes.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('debit_notes', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.stock_transfers WHERE public.stock_transfers.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('stock_transfers', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.inventory_adjustments WHERE public.inventory_adjustments.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('inventory_adjustments', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.expenses WHERE public.expenses.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('expenses', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.bank_transfers WHERE public.bank_transfers.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('bank_transfers', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.pdc_cheques WHERE public.pdc_cheques.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('pdc_cheques', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.pos_sessions WHERE public.pos_sessions.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('pos_sessions', (SELECT COUNT(*) FROM d)) INTO v_counts;

  -- ── Tier D: operational masters ───────────────────────────────────────
  WITH d AS (DELETE FROM public.product_serials WHERE public.product_serials.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('product_serials', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.product_supplier_codes WHERE product_id IN (SELECT id FROM public.products WHERE public.products.company_id = v_cid) RETURNING 1)
    SELECT v_counts || jsonb_build_object('product_supplier_codes', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.product_price_levels WHERE product_id IN (SELECT id FROM public.products WHERE public.products.company_id = v_cid) RETURNING 1)
    SELECT v_counts || jsonb_build_object('product_price_levels', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.product_compatibility WHERE product_id IN (SELECT id FROM public.products WHERE public.products.company_id = v_cid) RETURNING 1)
    SELECT v_counts || jsonb_build_object('product_compatibility', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.products WHERE public.products.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('products', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.contacts WHERE public.contacts.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('contacts', (SELECT COUNT(*) FROM d)) INTO v_counts;

  -- ── Tier E: ambient ───────────────────────────────────────────────────
  WITH d AS (DELETE FROM public.attachments WHERE public.attachments.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('attachments', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.notifications WHERE public.notifications.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('notifications', (SELECT COUNT(*) FROM d)) INTO v_counts;

  -- ── Tier F: setup masters ─────────────────────────────────────────────
  WITH d AS (DELETE FROM public.bank_accounts WHERE public.bank_accounts.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('bank_accounts', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.salespeople WHERE public.salespeople.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('salespeople', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.price_levels WHERE public.price_levels.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('price_levels', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.tax_rates WHERE public.tax_rates.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('tax_rates', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.payment_methods WHERE public.payment_methods.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('payment_methods', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.warehouses WHERE public.warehouses.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('warehouses', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.vehicle_models WHERE public.vehicle_models.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('vehicle_models', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.vehicle_makes WHERE public.vehicle_makes.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('vehicle_makes', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.brands WHERE public.brands.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('brands', (SELECT COUNT(*) FROM d)) INTO v_counts;
  UPDATE public.categories SET parent_id = NULL
   WHERE public.categories.company_id = v_cid AND parent_id IS NOT NULL;
  WITH d AS (DELETE FROM public.categories WHERE public.categories.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('categories', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.units_of_measure WHERE public.units_of_measure.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('units_of_measure', (SELECT COUNT(*) FROM d)) INTO v_counts;
  WITH d AS (DELETE FROM public.print_templates WHERE public.print_templates.company_id = v_cid RETURNING 1)
    SELECT v_counts || jsonb_build_object('print_templates', (SELECT COUNT(*) FROM d)) INTO v_counts;

  -- ── Tier G: custom chart_of_accounts (is_system = false) ─────────────
  UPDATE public.chart_of_accounts SET parent_id = NULL
   WHERE public.chart_of_accounts.company_id = v_cid
     AND is_system = false AND parent_id IS NOT NULL;
  WITH d AS (DELETE FROM public.chart_of_accounts
              WHERE public.chart_of_accounts.company_id = v_cid AND is_system = false
              RETURNING 1)
    SELECT v_counts || jsonb_build_object('chart_of_accounts_custom', (SELECT COUNT(*) FROM d)) INTO v_counts;

  -- ── Reset document_sequences ─────────────────────────────────────────
  UPDATE public.document_sequences
     SET current_value = 1000, updated_at = NOW()
   WHERE public.document_sequences.company_id = v_cid;

  -- ── Audit ─────────────────────────────────────────────────────────────
  DELETE FROM public.audit_logs WHERE public.audit_logs.company_id = v_cid;
  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
  VALUES (v_cid, v_user_id, 'delete', 'company_reset', v_cid,
          jsonb_build_object(
            'reset_at', v_deleted_at,
            'counts',   v_counts,
            'caller',   v_user_id,
            'phase',    '14.14u_v2'
          ));

  RETURN jsonb_build_object(
    'company_id', v_cid,
    'reset_at',   v_deleted_at,
    'counts',     v_counts
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reset_company_data(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_company_data(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.reset_company_data(UUID, TEXT) IS
  'DESTRUCTIVE. Parameters: company_id (no p_ prefix, PostgREST strips it). '
  'Wipes all transactions, all setup masters, and custom CoA (is_system=false). '
  'Keeps: companies, profiles, seed CoA (is_system=true). Admin only. Atomic.';

NOTIFY pgrst, 'reload schema';
