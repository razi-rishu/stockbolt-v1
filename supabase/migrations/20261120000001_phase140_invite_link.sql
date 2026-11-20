-- ═══════════════════════════════════════════════════════════════════════════
-- phase140 — invite links
--
-- "Send invite" only stored a company_invites row; nobody was told. The admin
-- now shares a link (copy / WhatsApp / email): https://www.stockbolt.online/invite/<token>.
-- company_invites.token (phase22, random uuid) is the secret in that link.
--
-- The invite page is opened BEFORE the person has an account, so it needs one
-- read that works without signing in:
--
--   get_invite_preview(p_token) → { company_name, role_key, role_name, email }
--                                 for a PENDING invite with that token, else NULL.
--
-- Read-only (STABLE), returns nothing but those four values, and only to
-- someone holding the 122-bit random token — the same person the invite was
-- for. Joining is unchanged: accept_invite() still requires the signed-in
-- user's own email to match a pending invite.
--
-- SECURITY DEFINER because company_invites / companies are tenant-scoped by
-- RLS and the caller has no company yet. EXECUTE goes to anon + authenticated
-- on purpose (the page is public); nothing is written.
--
-- SAFE TO APPLY: additive. One new function. Re-running is safe.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.get_invite_preview(uuid);
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.get_invite_preview(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v jsonb;
BEGIN
  IF p_token IS NULL THEN RETURN NULL; END IF;
  SELECT jsonb_build_object(
           'company_name', c.name,
           'role_key',     ci.role,
           'role_name',    COALESCE(
                             (SELECT r.name FROM public.roles r
                               WHERE r.key = ci.role AND (r.company_id IS NULL OR r.company_id = ci.company_id)
                               ORDER BY r.company_id NULLS LAST LIMIT 1),
                             ci.role),
           'email',        ci.email)
    INTO v
    FROM public.company_invites ci
    JOIN public.companies c ON c.id = ci.company_id
   WHERE ci.token = p_token AND ci.status = 'pending';
  RETURN v;   -- NULL: unknown, revoked or already accepted
END;
$function$;

REVOKE ALL ON FUNCTION public.get_invite_preview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invite_preview(uuid) TO anon, authenticated;

COMMIT;

-- ── Verify after applying (read-only) ──────────────────────────────────────
-- SELECT public.get_invite_preview(gen_random_uuid());                       -- expect NULL
-- SELECT has_function_privilege('anon', 'public.get_invite_preview(uuid)', 'EXECUTE');  -- expect true
