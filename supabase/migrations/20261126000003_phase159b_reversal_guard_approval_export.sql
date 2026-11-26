-- ═══════════════════════════════════════════════════════════════════════════
-- phase159b — Two small fixes found by the production regression run on
-- 2026-11-26. Additive. No row, amount or posting rule changes.
-- ═══════════════════════════════════════════════════════════════════════════
-- A. A reversal can no longer be reversed (regression "Phase 92 — never reverse
--    a reversal"). Until commit 82225ce, opening Edit on a journal reversed it
--    at once; one company reversed a journal, then its reversal, then that one
--    (JE-1028 → 1050 → 1051 → 1053). The screen stopped offering it, but
--    reverse_journal_entry still accepted it. Every internal caller passes an
--    original entry (year-end reopen, payroll, bank opening, approved journal
--    correction), so none is affected. One check is added to the CURRENT body
--    (read from this database), right after the "already reversed" check.
--
-- B. "Download my data" can include the approval setup and history (regression
--    phase102). The four approval tables are closed to direct reads (phase145),
--    so the backup reads them through this one read-only function, for the
--    caller's own company, with the same right the backup screen asks for.
--
-- SAFE TO RE-RUN.
-- UNDO A: CREATE OR REPLACE the function from pg_get_functiondef with the
--         block marked "phase159b" removed.
-- UNDO B: DROP FUNCTION public.export_approval_records();
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── A ──────────────────────────────────────────────────────────────────────
DO $patch$
DECLARE
  v_def text := pg_get_functiondef('public.reverse_journal_entry(uuid, text)'::regprocedure);
  v_new text;
BEGIN
  IF v_def ~ 'phase159b' THEN
    RAISE NOTICE 'phase159b: reverse_journal_entry already guarded';
    RETURN;
  END IF;
  v_new := regexp_replace(v_def,
    -- \r?: some live bodies were created from Windows (CRLF) text.
    '(IF v_orig\.reversed_by_id IS NOT NULL THEN.*?END IF;\r?\n)',
    E'\\1\n  -- phase159b: a reversal is never reversed; post a new entry instead.\n'
    || E'  IF v_orig.reversal_of_id IS NOT NULL THEN\n'
    || E'    RAISE EXCEPTION ''Journal entry % is itself a reversal and cannot be reversed. Post a new entry instead.'', v_orig.entry_number\n'
    || E'      USING ERRCODE = ''P0001'';\n'
    || E'  END IF;\n');
  IF v_new = v_def THEN
    RAISE EXCEPTION 'phase159b: the "already reversed" check was not found in reverse_journal_entry';
  END IF;
  -- Same name, arguments, owner (ledger_writer), grants and settings.
  EXECUTE v_new;
END;
$patch$;

-- ── B ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.export_approval_records()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company uuid := public.current_user_company_id();
BEGIN
  -- Finding E shape: no user, or no company, is refused outright.
  IF auth.uid() IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_perm('settings.write') THEN
    RAISE EXCEPTION 'You do not have permission to do this (needs settings.write).' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'approval_rules',       COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at) FROM public.approval_rules t       WHERE t.company_id = v_company), '[]'::jsonb),
    'approval_authorities', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at) FROM public.approval_authorities t WHERE t.company_id = v_company), '[]'::jsonb),
    'approval_requests',    COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at) FROM public.approval_requests t    WHERE t.company_id = v_company), '[]'::jsonb),
    'approval_steps',       COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at) FROM public.approval_steps t       WHERE t.company_id = v_company), '[]'::jsonb));
END;
$fn$;
REVOKE ALL ON FUNCTION public.export_approval_records() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.export_approval_records() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Check: guarded = true, export_fn = 1, anon = false.
SELECT pg_get_functiondef('public.reverse_journal_entry(uuid, text)'::regprocedure) ~ 'phase159b' AS guarded,
       (SELECT count(*) FROM pg_proc WHERE proname = 'export_approval_records') AS export_fn,
       has_function_privilege('anon', 'public.export_approval_records()', 'execute') AS anon;
