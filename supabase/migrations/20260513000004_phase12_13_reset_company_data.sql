-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 12 — Migration 13: reset_company_data RPC
-- ─────────────────────────────────────────────────────────────────────────
-- A destructive "wipe all data" RPC for test-running the ERP. After
-- the call:
--   - All transactions GONE (invoices, bills, payments, GRNs, POs,
--     credit/debit notes, returns, transfers, adjustments, expenses,
--     bank transfers, PDC, POS sessions)
--   - All GL postings GONE (journal_entries, general_ledger,
--     stock_ledger, bank_reconciliations, deferred_cogs_queue)
--   - All operational masters GONE (contacts, products and their
--     compatibility / supplier-code / price-level / serial rows)
--   - Document sequences RESET to start over from 1000
--   - Notifications & attachments CLEARED
--   - audit_logs CLEARED, then ONE row recording this reset is added
--
-- KEPT (so the user doesn't have to re-onboard):
--   - companies, profiles
--   - chart_of_accounts (without it, every future confirm_* would fail)
--   - units_of_measure, categories, brands, vehicle_makes, vehicle_models
--   - warehouses, price_levels, tax_rates, payment_methods, bank_accounts
--   - print_templates
--
-- Safety:
--   - SECURITY DEFINER but checks auth.uid() → caller must be admin
--     on this company. Anyone else gets P0001.
--   - p_confirmation MUST equal the company.name exactly (case-
--     sensitive). UI requires the user to type the company name —
--     same shape as "delete repository" confirmations on GitHub.
--   - Single atomic transaction. If any delete fails the whole thing
--     rolls back; the company is either fully wiped or untouched.
--   - Deletes children-before-parents to satisfy ON DELETE RESTRICT.
-- ─────────────────────────────────────────────────────────────────────────

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

  -- 1. Caller must be admin on this company.
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

  -- 2. Typed-confirmation must match company name exactly.
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

  -- 3. Wipe — children → parents to satisfy ON DELETE RESTRICT FKs.
  --    Capture row counts for the audit entry.

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

  -- ── Tier B: GL plumbing & inventory ledger (must precede everything
  --    that has GL-line references such as bank_reconciliations) ────────
  WITH d AS (DELETE FROM public.bank_reconciliations WHERE company_id = p_company_id RETURNING 1)
    SELECT v_counts || jsonb_build_object('bank_reconciliations', (SELECT COUNT(*) FROM d)) INTO v_counts;

  -- general_ledger and journal_entries have ON DELETE RESTRICT self-refs
  -- (reversed_by_id / reversal_of_id). Bulk DELETE would fail because
  -- Postgres doesn't define a deletion order within one statement.
  -- NULL the self-refs first so the rows can be deleted independently.
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

  -- ── Tier D: operational master rows that hold per-test data ───────────
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

  -- ── Reset document_sequences so document numbering starts fresh ───────
  UPDATE public.document_sequences
     SET current_value = 1000, updated_at = NOW()
   WHERE company_id = p_company_id;

  -- ── Audit: wipe old entries, then leave exactly one record of the reset
  DELETE FROM public.audit_logs WHERE company_id = p_company_id;
  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
  VALUES (p_company_id, v_user_id, 'delete', 'company_reset', p_company_id,
          jsonb_build_object(
            'reset_at',  v_deleted_at,
            'counts',    v_counts,
            'caller',    v_user_id
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
  'DESTRUCTIVE. Wipes all transactional + operational data for a company while '
  'preserving CoA, masters, and onboarding. Caller must be admin AND pass the '
  'company name as confirmation. Returns row counts. Atomic.';
