-- phase110: audit_logs accepts every action the posting functions write
--
-- WHAT WENT WRONG
-- audit_logs.action has had the same CHECK since phase0: create, update,
-- delete, post_gl, reverse_gl, login, void, confirm, setup_completed. Since
-- then 40 functions have started writing other action names (file_tax_return,
-- close_fiscal_year, run_depreciation, edit, reopen, writeoff, ...). Every one
-- of them wraps its audit insert in EXCEPTION WHEN OTHERS THEN NULL, so the
-- CHECK violation is swallowed: the business operation succeeds and its audit
-- entry is silently dropped. Production has never recorded those events. Found
-- 2026-11-03 by the tax-return suite on local staging (AC-3C G1/G2). This is
-- the same shape as phase87's source_type drift.
--
-- THE FIX
-- Replace the CHECK with one that keeps all 9 original actions and adds the 29
-- that the latest function definitions actually write. The list was derived
-- from the repo (the last definition of every function) and is identical to
-- the live definitions exported 2026-11-02. Nothing is loosened beyond what
-- the code uses: the action is still restricted to a fixed list.
--
-- Additive. No function changes, no data changes, and no audit history is
-- backfilled: events that were dropped stay missing. Existing rows all hold
-- one of the 9 original actions, so the new CHECK validates them.
--
-- tests/unit/audit-action-check.test.ts fails if a function ever writes an
-- action this CHECK doesn't list.
--
-- Rollback: supabase/manual-apply/phase110_rollback.sql (guarded).

BEGIN;

ALTER TABLE public.audit_logs DROP CONSTRAINT audit_logs_action_check;

ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_action_check CHECK (action = ANY (ARRAY[
  -- phase0 originals (kept)
  'create', 'update', 'delete', 'post_gl', 'reverse_gl', 'login', 'void', 'confirm', 'setup_completed',
  -- written by the posting functions since, previously rejected
  'apply_advance', 'cancel_amortization_schedule', 'cancel_einvoice_document', 'close_fiscal_year',
  'dispose_fixed_asset', 'edit', 'edit_reopen', 'file_tax_return', 'gratuity_settlement',
  'mark_einvoice_submitted', 'merge', 'pay', 'post_bank_opening_balance', 'post_gl_opening_balance',
  'post_opening_balance', 'record_einvoice_document', 'record_tds_deduction', 'reopen',
  'reopen_fiscal_year', 'reopen_tax_return', 'repair', 'restocking_fee', 'restocking_fee_reversal',
  'reverse_tds_deduction', 'run_amortization', 'run_depreciation', 'void_opening_balance',
  'writeoff', 'writeoff_reversal'
]::text[]));

COMMIT;
