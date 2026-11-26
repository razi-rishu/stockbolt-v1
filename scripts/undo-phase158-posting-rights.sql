-- Undo phase158: removes exactly the line it added to each function, and the
-- audit log guard. No data changes. Safe to re-run.
BEGIN;
DO $undo$
DECLARE r record;
BEGIN
  FOR r IN SELECT oid FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosrc ~ '-- phase158' LOOP
    EXECUTE regexp_replace(pg_get_functiondef(r.oid), E'  PERFORM public\\._require_post[^\\n]*-- phase158\\n', '');
  END LOOP;
END;
$undo$;
DROP TRIGGER IF EXISTS audit_logs_guard ON public.audit_logs;
DROP FUNCTION IF EXISTS public.tg_audit_logs_guard();
DROP FUNCTION IF EXISTS public._require_post(text[]);
DROP FUNCTION IF EXISTS public._require_post_payment(uuid);
NOTIFY pgrst, 'reload schema';
COMMIT;
