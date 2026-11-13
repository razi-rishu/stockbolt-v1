-- ═══════════════════════════════════════════════════════════════════════════
-- phase125 — let the payroll engines post
--
-- Confirming a payroll run failed at the database with:
--
--     payroll.confirmRun: new row for relation "journal_entries" violates
--     check constraint "journal_entries_source_type_check"
--
-- The same gap phase87 closed for thirteen engines. Checking every function
-- that inserts into journal_entries against the constraint (on the local
-- staging copy of the production schema) found exactly three source types the
-- table rejects, all payroll, all shipped in 2026-06 without widening the
-- constraint:
--
--   confirm_payroll_run   payroll_run           payroll_p1 / p2
--       Dr 6100 Salaries & Benefits / Cr 1450 Employee Advances (loans)
--       / Cr 2350 Salaries Payable (net) [+ gratuity accrual, p2]
--   pay_payroll_run       payroll_run           payroll_p1
--       Dr 2350 Salaries Payable / Cr bank
--   settle_gratuity       gratuity_settlement   20260613000006
--   pay_leave_salary      leave_salary          20260613000006
--
-- None of them has ever posted, so no journal entry carries these names.
--
-- HOW: the new constraint is BUILT FROM THE LIVE ONE. Every value the current
-- constraint allows is kept and the three are added, so this cannot drop a
-- value that production has and the repo does not know about. Re-running it
-- is a no-op (the values are already there).
--
-- SAFE TO APPLY: widening only; existing rows already satisfy the narrower
-- check. No function is changed, no data written. Run as one transaction.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_def      text;
  v_existing text[];
  v_all      text[];
  v_list     text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.journal_entries'::regclass
     AND conname  = 'journal_entries_source_type_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'phase125: journal_entries_source_type_check not found — stop and investigate';
  END IF;

  SELECT array_agg(m[1]) INTO v_existing
    FROM regexp_matches(v_def, '''([a-z_]+)''::text', 'g') AS m;

  IF coalesce(array_length(v_existing, 1), 0) < 29 THEN
    RAISE EXCEPTION 'phase125: could not read the current source types (found %) — stop and investigate',
      coalesce(array_length(v_existing, 1), 0);
  END IF;

  SELECT array_agg(st ORDER BY ord) INTO v_all FROM (
    SELECT st, min(ord) AS ord FROM (
      SELECT unnest(v_existing) AS st, generate_subscripts(v_existing, 1) AS ord
      UNION ALL SELECT 'payroll_run',         10001
      UNION ALL SELECT 'gratuity_settlement', 10002
      UNION ALL SELECT 'leave_salary',        10003
    ) x GROUP BY st
  ) y;

  SELECT string_agg(quote_literal(st) || '::text', ', ') INTO v_list FROM unnest(v_all) AS st;

  ALTER TABLE public.journal_entries DROP CONSTRAINT journal_entries_source_type_check;
  EXECUTE format(
    'ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_source_type_check CHECK (source_type = ANY (ARRAY[%s]))',
    v_list);

  RAISE NOTICE 'phase125: source types % → %', array_length(v_existing, 1), array_length(v_all, 1);
END $$;

-- Verify inside the same transaction: all three must now be accepted.
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conname = 'journal_entries_source_type_check';
  IF v_def NOT LIKE '%''payroll_run''%' OR v_def NOT LIKE '%''gratuity_settlement''%'
     OR v_def NOT LIKE '%''leave_salary''%' THEN
    RAISE EXCEPTION 'phase125: verification failed — %', v_def;
  END IF;
END $$;

COMMIT;

-- ── Verify after applying (read-only) ──────────────────────────────────────
-- SELECT pg_get_constraintdef(oid) LIKE '%payroll_run%'          AS payroll_ok,
--        pg_get_constraintdef(oid) LIKE '%gratuity_settlement%'  AS gratuity_ok,
--        pg_get_constraintdef(oid) LIKE '%leave_salary%'         AS leave_ok
--   FROM pg_constraint WHERE conname = 'journal_entries_source_type_check';
--
-- ── Rollback (dev only; refuses if any payroll entry exists) ───────────────
-- BEGIN;
-- DO $$ BEGIN
--   IF EXISTS (SELECT 1 FROM public.journal_entries
--              WHERE source_type IN ('payroll_run','gratuity_settlement','leave_salary')) THEN
--     RAISE EXCEPTION 'Payroll journal entries exist; reverse them before rolling back.';
--   END IF;
-- END $$;
-- -- then rebuild the constraint without the three values (same DO-block shape as above).
-- COMMIT;
