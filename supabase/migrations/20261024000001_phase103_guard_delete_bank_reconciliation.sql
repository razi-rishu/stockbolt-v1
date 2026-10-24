-- phase103: delete_bank_reconciliation refuses callers it should refuse
--
-- The function was SECURITY DEFINER with NO guard of any kind - no
-- permission check, no company scope, no caller check:
--
--     SELECT status INTO v_status FROM bank_reconciliations WHERE id = p_id;
--     ...
--     DELETE FROM bank_reconciliations WHERE id = p_id;
--
-- and EXECUTE was granted to anon, whose publishable key ships inside the
-- browser bundle. So an unauthenticated request could delete any tenant's
-- reconciliation given its id. A UUID is 122 bits, so this was not
-- brute-forceable - but unguessability is not access control, and ids leak:
-- through logs, screenshots, and the company backup added in phase102,
-- which exports bank_reconciliations rows with their ids.
--
-- TWO HALVES, AND NEITHER IS SUFFICIENT ALONE
--   1. the in-function guard, so the check travels with the function
--      regardless of who is granted EXECUTE later;
--   2. REVOKE from anon, because has_perm() returns FALSE when auth.uid()
--      is NULL and ANON ALSO HAS A NULL uid. Phase 65's established
--      carve-out - skip the tenant check when there is no authenticated
--      user, so service_role and the test harness still work - would
--      therefore wave anon straight through. The REVOKE is what makes
--      'no auth.uid()' mean 'trusted service role' rather than 'anyone'.
--
-- Permission-first ordering: a caller without accounting.write is refused
-- before the not-found error can tell them whether an id exists.
--
-- SAFE TO APPLY: there are currently ZERO rows in bank_reconciliations in
-- every company, so this cannot break an existing workflow. Verified live
-- before writing.
--
-- Body read from the live database with pg_get_functiondef and patched by
-- anchor, the anchor required to match exactly once.
--
-- Rollback: re-apply the previous definition from migration history and
-- re-grant anon, though there is no good reason to.

BEGIN;

CREATE OR REPLACE FUNCTION public.delete_bank_reconciliation(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_status TEXT; v_company UUID;
BEGIN
  -- ---- Phase 103 authorisation guard --------------------------------------
  -- This function is SECURITY DEFINER, so RLS does not apply. It previously
  -- had no permission check, no tenant check and no caller check at all: it
  -- took an id and deleted the row. EXECUTE was granted to anon, whose key
  -- ships in the browser bundle, so the only thing standing between an
  -- unauthenticated request and another tenant's reconciliation was the
  -- unguessability of a UUID. That is obscurity, not access control.
  --
  -- Ordered permission-first so a caller without accounting.write cannot use
  -- the not-found error to probe which ids exist.
  --
  -- The auth.uid() IS NOT NULL condition follows the Phase 65 carve-out for
  -- service_role / maintenance / the test harness, and is only safe BECAUSE
  -- the grant below removes anon: anon also has a NULL auth.uid(), so without
  -- the REVOKE this check would wave through exactly the caller it is meant
  -- to stop.
  IF auth.uid() IS NOT NULL THEN
    PERFORM public.auth_require('accounting.write');
  END IF;

  SELECT status, company_id INTO v_status, v_company
  FROM public.bank_reconciliations WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'delete_bank_reconciliation: % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  IF auth.uid() IS NOT NULL
     AND public.current_user_company_id() IS NOT NULL
     AND v_company IS DISTINCT FROM public.current_user_company_id() THEN
    RAISE EXCEPTION 'delete_bank_reconciliation: cross-tenant access denied'
      USING ERRCODE = '42501';
  END IF;
  -- ---- end Phase 103 ------------------------------------------------------
  IF v_status = 'locked' THEN
    RAISE EXCEPTION 'delete_bank_reconciliation: reconciliation % is locked', p_id
      USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.bank_reconciliations WHERE id = p_id;
END;
$function$;

-- Lock the surface down. CREATE OR REPLACE does not alter existing grants,
-- so the anon grant would otherwise survive the fix.
REVOKE ALL ON FUNCTION public.delete_bank_reconciliation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_bank_reconciliation(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_bank_reconciliation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_bank_reconciliation(uuid) TO service_role;

COMMIT;
