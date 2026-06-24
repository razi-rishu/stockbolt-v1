-- ════════════════════════════════════════════════════════════════════════════
-- Phase 24 — FIX: posting-engine tables must not be gated to one domain
-- ════════════════════════════════════════════════════════════════════════════
-- All the confirm/post functions (confirm_invoice, confirm_expense,
-- confirm_pos_sale, confirm_vendor_bill, create_pdc, reverse_journal_entry, …)
-- are SECURITY INVOKER, so RLS applies inside them. phase22b wrongly gated the
-- posting side-effect tables to a single domain permission, which would BLOCK
-- non-admin roles from confirming anything:
--   • a Sales user confirming an invoice writes general_ledger / journal_entries
--     / stock_ledger / deferred_cogs_queue / document_sequences — none of which
--     are 'accounting'/'inventory' actions from their point of view;
--   • a Counter user at POS, a Purchasing user confirming a bill, etc. likewise.
-- (Invisible today because every existing user is admin → has_perm short-circuits.)
--
-- Fix: these tables are written as a SIDE EFFECT of an operation the user is
-- already allowed to perform (the draft/document tables remain domain-gated).
-- So gate them with has_any_write() — true for any role with ANY *.write — which
-- still blocks a pure Viewer from hand-crafting GL rows via the API.
-- Also unlock SELECT on deferred_cogs_queue (the MAC flush reads it during a
-- Sales/Purchasing confirm).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.has_any_write()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_perm('sales.write')      OR public.has_perm('purchasing.write')
      OR public.has_perm('inventory.write')  OR public.has_perm('accounting.write')
      OR public.has_perm('payroll.write');
$$;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT unnest(ARRAY[
    'journal_entries','general_ledger','stock_ledger','deferred_cogs_queue',
    'document_sequences','pdc_cheques'
  ]) AS tbl
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'rbac_w_ins_'||r.tbl, r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'rbac_w_upd_'||r.tbl, r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'rbac_w_del_'||r.tbl, r.tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT WITH CHECK (public.has_any_write())', 'rbac_w_ins_'||r.tbl, r.tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE USING (public.has_any_write()) WITH CHECK (public.has_any_write())', 'rbac_w_upd_'||r.tbl, r.tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE USING (public.has_any_write())', 'rbac_w_del_'||r.tbl, r.tbl);
  END LOOP;
END $$;

-- deferred_cogs_queue is read during Sales/Purchasing confirms (MAC flush), so
-- it can't be accounting.read-only. Drop the phase22c read lock on it.
DROP POLICY IF EXISTS rbac_r_sel_deferred_cogs_queue ON public.deferred_cogs_queue;

GRANT EXECUTE ON FUNCTION public.has_any_write() TO authenticated;

NOTIFY pgrst, 'reload schema';
