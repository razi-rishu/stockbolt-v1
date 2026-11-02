-- phase109c: delete_bank_reconciliation requires accounting.write again
--
-- WHAT WENT WRONG
-- phase103 (2026-10-24) gave this SECURITY DEFINER function a permission-first
-- guard - auth_require('accounting.write') before any lookup - plus a company
-- check and an anon revoke. It never reached production: the live definition
-- exported 2026-11-02 had no check of any kind, and anon could execute it.
-- phase109 was built from that live definition, so it added company scoping but
-- not the permission check, and because it sorts after phase103 the repo lost
-- phase103's intent too. Today any role in a company - Viewer included - can
-- delete that company's unlocked reconciliations, un-reconciling their GL lines.
-- See docs/STOCKBOLT_SECURITY_INVESTIGATION_2026-11-01.md.
--
-- THE FIX
--  * Signed-in caller: auth_require('accounting.write') FIRST, so a refused
--    caller learns nothing about which ids exist; then the row must belong to
--    the caller's company (phase109's isolation, kept). A user with no company
--    fails the permission check (has_perm needs a profile).
--  * No signed-in user: only a direct database session (SQL editor, migration,
--    operator) - session_user is not PostgREST's 'authenticator'. Every API
--    caller without a user is refused, the service_role key included: nothing
--    in the app, the Edge Function or the test suites deletes a reconciliation
--    through the service role, so there is no maintenance need to keep.
--  * Grants: EXECUTE for authenticated only. Revoked from PUBLIC, anon and
--    service_role. The owner (postgres) keeps it, which is what the operator
--    path uses.
--
-- Signature, return type and error codes are unchanged (P0002 not found,
-- P0001 locked), so the web app and Android 1.0.3 need nothing. The only
-- behaviour change for a signed-in user: without accounting.write the call now
-- fails with 42501 "forbidden: requires accounting.write permission".
--
-- No data is changed. Deleting a reconciliation un-reconciles its GL lines
-- through the existing foreign key; that behaviour is untouched.
--
-- Depends on public.auth_require (phase22, applied) and phase109 (applied).
-- Rollback: supabase/manual-apply/phase109c_rollback.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.delete_bank_reconciliation(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_status TEXT; v_company UUID;
BEGIN
  -- phase109c: authorise before touching any data.
  IF auth.uid() IS NULL THEN
    -- Only a direct database session; every API caller without a user is refused.
    IF session_user = 'authenticator' THEN
      RAISE EXCEPTION 'delete_bank_reconciliation: not signed in' USING ERRCODE = '42501';
    END IF;
    SELECT status, company_id INTO v_status, v_company
      FROM public.bank_reconciliations WHERE id = p_id;
  ELSE
    PERFORM public.auth_require('accounting.write');
    -- phase109: only the caller's own company; a foreign id reads as not found.
    SELECT status, company_id INTO v_status, v_company
      FROM public.bank_reconciliations
     WHERE id = p_id AND company_id = public.current_user_company_id();
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'delete_bank_reconciliation: % not found', p_id USING ERRCODE = 'P0002';
  END IF;
  IF v_status = 'locked' THEN
    RAISE EXCEPTION 'delete_bank_reconciliation: reconciliation % is locked', p_id
      USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.bank_reconciliations
   WHERE id = p_id AND company_id = v_company;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_bank_reconciliation(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_bank_reconciliation(uuid) TO authenticated;

COMMIT;
