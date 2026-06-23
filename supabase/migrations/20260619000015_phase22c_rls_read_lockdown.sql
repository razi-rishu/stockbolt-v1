-- ════════════════════════════════════════════════════════════════════════════
-- Phase 22c — RLS read lockdown for sensitive, single-module tables
-- ════════════════════════════════════════════════════════════════════════════
-- Adds `AS RESTRICTIVE FOR SELECT` policies so only roles with the matching
-- read permission can SELECT these tables. AND-ed with tenant_isolation; admin
-- short-circuits has_perm() → existing companies unaffected.
--
-- SCOPE NOTE (deliberate): we only lock tables read by exactly ONE module:
--   • payroll.*           → confidential salaries; read only in the payroll UI.
--   • bank_transfers /
--     bank_reconciliations → banking screens only.
--   • deferred_cogs_queue  → internal MAC plumbing, never read cross-module.
--
-- We intentionally DO NOT lock SELECT on general_ledger / journal_entries /
-- chart_of_accounts / bank_accounts / pdc_cheques here: they are read directly
-- by cross-module features (customer & supplier statements, AR/AP aging, the
-- cash-flow/TB/BS reports, payment bank pickers) that Sales and Purchasing roles
-- legitimately use. Locking them at the DB level would break those screens.
-- For non-accounting roles those areas are gated at the UI layer (the Accounting
-- nav + routes are hidden in phase22 app changes). Tightening GL/JE reads at the
-- DB level is a future refinement that first needs the statement queries moved
-- behind SECURITY DEFINER RPCs.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tbl, perm FROM (VALUES
      ('deferred_cogs_queue','accounting.read'),
      ('bank_transfers','accounting.read'),
      ('bank_reconciliations','accounting.read'),
      ('employees','payroll.read'),
      ('payroll_runs','payroll.read'),
      ('payroll_run_items','payroll.read'),
      ('leave_salary_payments','payroll.read')
    ) AS t(tbl, perm)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'rbac_r_sel_'||r.tbl, r.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT USING (public.has_perm(%L))',
      'rbac_r_sel_'||r.tbl, r.tbl, r.perm);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
