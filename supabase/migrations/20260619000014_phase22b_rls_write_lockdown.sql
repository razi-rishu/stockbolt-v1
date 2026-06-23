-- ════════════════════════════════════════════════════════════════════════════
-- Phase 22b — RLS write lockdown (role enforcement on direct table writes)
-- ════════════════════════════════════════════════════════════════════════════
-- Adds `AS RESTRICTIVE` write policies (INSERT/UPDATE/DELETE) to every tenant
-- table, keyed to the relevant `<domain>.write` permission via has_perm().
--
-- Why RESTRICTIVE: PostgreSQL AND-s restrictive policies with the existing
-- PERMISSIVE `tenant_isolation` policies. So effective rule becomes
-- "same company AND has the write permission". SELECT is left untouched here
-- (read lockdown is phase22c). Because has_perm() short-circuits admin → TRUE,
-- and every existing user is an admin, current companies are UNAFFECTED.
--
-- Note: SECURITY DEFINER posting RPCs (confirm_invoice, post JE, etc.) run as
-- the table owner and bypass RLS, so these policies do not affect them — they
-- gate the *direct* client writes (drafts, masters, payments). Per-RPC role
-- gates are layered on separately.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tbl, perm FROM (VALUES
      -- inventory.write — catalog + stock movement
      ('products','inventory.write'),
      ('product_compatibility','inventory.write'),
      ('product_price_levels','inventory.write'),
      ('product_supplier_codes','inventory.write'),
      ('product_serials','inventory.write'),
      ('categories','inventory.write'),
      ('brands','inventory.write'),
      ('units_of_measure','inventory.write'),
      ('vehicle_makes','inventory.write'),
      ('vehicle_models','inventory.write'),
      ('stock_transfers','inventory.write'),
      ('stock_transfer_items','inventory.write'),
      ('inventory_adjustments','inventory.write'),
      ('inventory_adjustment_items','inventory.write'),
      ('stock_ledger','inventory.write'),
      -- sales.write — quotes, orders, invoices, returns, credit notes, receipts, POS
      ('sales_quotes','sales.write'),
      ('sales_quote_items','sales.write'),
      ('sales_orders','sales.write'),
      ('sales_order_items','sales.write'),
      ('invoices','sales.write'),
      ('invoice_items','sales.write'),
      ('credit_notes','sales.write'),
      ('credit_note_items','sales.write'),
      ('sales_returns','sales.write'),
      ('sales_return_items','sales.write'),
      ('pos_sessions','sales.write'),
      -- purchasing.write — PO, GRN, bills, debit notes, expenses
      ('purchase_orders','purchasing.write'),
      ('purchase_order_items','purchasing.write'),
      ('goods_receipts','purchasing.write'),
      ('goods_receipt_items','purchasing.write'),
      ('vendor_bills','purchasing.write'),
      ('vendor_bill_items','purchasing.write'),
      ('debit_notes','purchasing.write'),
      ('debit_note_items','purchasing.write'),
      ('expenses','purchasing.write'),
      ('expense_items','purchasing.write'),
      -- accounting.write — books + banking
      ('chart_of_accounts','accounting.write'),
      ('journal_entries','accounting.write'),
      ('general_ledger','accounting.write'),
      ('deferred_cogs_queue','accounting.write'),
      ('bank_accounts','accounting.write'),
      ('bank_transfers','accounting.write'),
      ('pdc_cheques','accounting.write'),
      -- payroll.write
      ('employees','payroll.write'),
      ('payroll_runs','payroll.write'),
      ('payroll_run_items','payroll.write'),
      ('leave_salary_payments','payroll.write'),
      -- settings.write — setup / master config
      ('warehouses','settings.write'),
      ('tax_rates','settings.write'),
      ('document_sequences','settings.write'),
      ('print_templates','settings.write'),
      ('payment_methods','settings.write'),
      ('price_levels','settings.write'),
      ('salespeople','settings.write'),
      ('exchange_rates','settings.write'),
      ('geographic_regions','settings.write'),
      ('geographic_areas','settings.write')
    ) AS t(tbl, perm)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'rbac_w_ins_'||r.tbl, r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'rbac_w_upd_'||r.tbl, r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'rbac_w_del_'||r.tbl, r.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT WITH CHECK (public.has_perm(%L))',
      'rbac_w_ins_'||r.tbl, r.tbl, r.perm);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE USING (public.has_perm(%L)) WITH CHECK (public.has_perm(%L))',
      'rbac_w_upd_'||r.tbl, r.tbl, r.perm, r.perm);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE USING (public.has_perm(%L))',
      'rbac_w_del_'||r.tbl, r.tbl, r.perm);
  END LOOP;
END $$;

-- ── contacts: shared by sales (customers) + purchasing (suppliers) ──────────
DROP POLICY IF EXISTS rbac_w_ins_contacts ON public.contacts;
DROP POLICY IF EXISTS rbac_w_upd_contacts ON public.contacts;
DROP POLICY IF EXISTS rbac_w_del_contacts ON public.contacts;
CREATE POLICY rbac_w_ins_contacts ON public.contacts AS RESTRICTIVE FOR INSERT
  WITH CHECK (public.has_perm('sales.write') OR public.has_perm('purchasing.write'));
CREATE POLICY rbac_w_upd_contacts ON public.contacts AS RESTRICTIVE FOR UPDATE
  USING (public.has_perm('sales.write') OR public.has_perm('purchasing.write'))
  WITH CHECK (public.has_perm('sales.write') OR public.has_perm('purchasing.write'));
CREATE POLICY rbac_w_del_contacts ON public.contacts AS RESTRICTIVE FOR DELETE
  USING (public.has_perm('sales.write') OR public.has_perm('purchasing.write'));

-- ── payments + payment_allocations: shared by customer receipts (sales) and
--    vendor payments (purchasing), both written client-side as drafts. Allow
--    either side to write (RPC posting still runs as definer). ──────────────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT unnest(ARRAY['payments','payment_allocations']) AS tbl LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'rbac_w_ins_'||r.tbl, r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'rbac_w_upd_'||r.tbl, r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'rbac_w_del_'||r.tbl, r.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT WITH CHECK (public.has_perm(''sales.write'') OR public.has_perm(''purchasing.write''))',
      'rbac_w_ins_'||r.tbl, r.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE USING (public.has_perm(''sales.write'') OR public.has_perm(''purchasing.write'')) WITH CHECK (public.has_perm(''sales.write'') OR public.has_perm(''purchasing.write''))',
      'rbac_w_upd_'||r.tbl, r.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE USING (public.has_perm(''sales.write'') OR public.has_perm(''purchasing.write''))',
      'rbac_w_del_'||r.tbl, r.tbl);
  END LOOP;
END $$;

-- ── profiles: only user-managers may change rows (closes role-escalation:
--    previously any company member could UPDATE another profile's role). INSERT
--    is left to the SECURITY DEFINER onboarding / accept_invite paths. ────────
DROP POLICY IF EXISTS rbac_w_upd_profiles ON public.profiles;
DROP POLICY IF EXISTS rbac_w_del_profiles ON public.profiles;
CREATE POLICY rbac_w_upd_profiles ON public.profiles AS RESTRICTIVE FOR UPDATE
  USING (public.has_perm('users.manage')) WITH CHECK (public.has_perm('users.manage'));
CREATE POLICY rbac_w_del_profiles ON public.profiles AS RESTRICTIVE FOR DELETE
  USING (public.has_perm('users.manage'));

-- ── companies: editing the company profile needs settings.write ─────────────
DROP POLICY IF EXISTS rbac_w_upd_companies ON public.companies;
CREATE POLICY rbac_w_upd_companies ON public.companies AS RESTRICTIVE FOR UPDATE
  USING (public.has_perm('settings.write')) WITH CHECK (public.has_perm('settings.write'));

NOTIFY pgrst, 'reload schema';
