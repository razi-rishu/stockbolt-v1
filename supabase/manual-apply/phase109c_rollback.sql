-- phase109c ROLLBACK - restores delete_bank_reconciliation as phase109 left it
-- (company-scoped, no permission check) and the service_role grant.
--
-- WARNING: this removes the accounting.write requirement, so any role in a
-- company (Viewer included) can again delete that company's unlocked
-- reconciliations. Use only if a legitimate flow breaks after phase109c, and
-- fix forward. anon and PUBLIC stay revoked: no legitimate caller is
-- unauthenticated, so the rollback does not restore that grant.

BEGIN;

-- ROLLBACK GUARD - this file was run by mistake once (2026-11-02) and silently
-- re-opened a cross-tenant hole. It now refuses to run. To roll back on purpose,
-- delete this DO block, run the file, and record why in the security report.
DO $$ BEGIN
  RAISE EXCEPTION 'ROLLBACK GUARD: this rollback re-opens phase109c: any role, Viewer included, can again delete reconciliations of its own company. Delete this block to run it deliberately.';
END $$;

CREATE OR REPLACE FUNCTION public.delete_bank_reconciliation(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_status TEXT;
BEGIN
  -- phase109 (E2): only the caller's own company; a foreign id reads as not found.
  SELECT status INTO v_status FROM public.bank_reconciliations
   WHERE id = p_id AND company_id = public.current_user_company_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'delete_bank_reconciliation: % not found', p_id USING ERRCODE = 'P0002';
  END IF;
  IF v_status = 'locked' THEN
    RAISE EXCEPTION 'delete_bank_reconciliation: reconciliation % is locked', p_id
      USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.bank_reconciliations
   WHERE id = p_id AND company_id = public.current_user_company_id();
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_bank_reconciliation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_bank_reconciliation(uuid) TO authenticated, service_role;

COMMIT;
