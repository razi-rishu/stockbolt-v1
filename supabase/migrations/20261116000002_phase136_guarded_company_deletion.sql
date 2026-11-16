-- phase136 — guarded, auditable deletion of a company or a team member's account
--
-- DRAFT. Local staging only until Rashid approves it. It deletes nothing when
-- applied: it only creates the procedure. Every deletion is a separate,
-- deliberate call that a person types in the SQL Editor.
--
-- WHY A PROCEDURE
-- The public "Delete your account" page promises that a deletion request is
-- handled by hand. Doing that with ad-hoc DELETEs is how records of the wrong
-- company get removed, or how half a company is left behind. A company is held
-- by 46 ON DELETE RESTRICT/NO ACTION foreign keys and ~27 CASCADE ones; a team
-- member's profile is referenced by 17 NO ACTION keys (journal_entries.created_by,
-- audit_logs.user_id, invoices.voided_by, …), so "delete the login" fails for
-- anyone who ever posted anything.
--
-- WHAT IT PROVIDES (all callable ONLY from the SQL Editor — session user
-- postgres / supabase_admin; EXECUTE is revoked from every API role)
--
--   platform_company_deletion_preview(company_id)
--       read-only: company, members, blockers, rows per table, storage prefix.
--
--   platform_delete_company(company_id, confirm_name, request_ref)
--       one transaction: refuses on any blocker or name mismatch; deletes the
--       company's rows in FK order, the company, then its members' logins;
--       re-checks that no company_id row is left; writes one
--       platform_deletion_log row (ids and counts only — no names or emails).
--       Any failure rolls the WHOLE deletion back.
--
--   platform_close_member_account(user_id, request_ref)
--       a team member (not the company's last admin): if nothing references
--       them, the login is deleted; otherwise the login is pseudonymised and
--       disabled (email replaced, password, identities, sessions and MFA
--       removed, banned) and the profile is renamed "Deleted user" and
--       deactivated, so the company's books keep a stable, anonymous author.
--
-- WHAT IT DOES NOT DO
--   * Storage files (logos, product images, attachments, support files) —
--     Supabase forbids deleting storage.objects with SQL. The procedure returns
--     (and logs) every folder to empty; scripts/delete-company-storage.mjs
--     empties them (dry run by default) AFTER this.
--   * legal_events are KEPT (append-only proof of what was accepted; they hold
--     a user id but no name or email once the login is gone). Decision for the
--     lawyer: keep for the dispute period, or purge with the maintenance flag.
--   * Backups: copies expire on the provider's schedule.
--   * Any platform admin / support operator is refused — remove that role first.
--
-- SAFE TO APPLY: new table + six functions, no data change, no existing
-- object altered.
BEGIN;

CREATE TABLE IF NOT EXISTS public.platform_deletion_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('company', 'member_deleted', 'member_pseudonymised')),
  subject_id    uuid NOT NULL,
  company_id    uuid,
  request_ref   text NOT NULL CHECK (length(btrim(request_ref)) BETWEEN 3 AND 100),
  rows_deleted  jsonb NOT NULL DEFAULT '{}'::jsonb,
  users_removed integer NOT NULL DEFAULT 0,
  -- Storage folders still to empty (SQL cannot delete storage objects).
  -- Support files live under the ticket id, which is gone after the delete,
  -- so the list is captured here first.
  storage       jsonb NOT NULL DEFAULT '[]'::jsonb,
  executed_by   name NOT NULL DEFAULT session_user,
  executed_at   timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.platform_deletion_log ENABLE ROW LEVEL SECURITY;  -- no policies: no API access
REVOKE ALL ON public.platform_deletion_log FROM PUBLIC, anon, authenticated, service_role;

-- Only a person in the SQL Editor. PostgREST connects as authenticator, so
-- session_user there is never postgres even for the service_role key.
CREATE OR REPLACE FUNCTION public._platform_require_sql_editor()
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF session_user NOT IN ('postgres', 'supabase_admin') OR current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'platform deletion: run this from the SQL Editor as postgres' USING ERRCODE = '42501';
  END IF;
END $$;

-- Tables that carry company_id, split by how their FK to companies behaves.
CREATE OR REPLACE FUNCTION public._platform_company_tables(OUT table_name text, OUT goes_with_company boolean)
RETURNS SETOF record LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT c.relname::text,
         EXISTS (SELECT 1 FROM pg_constraint k
                  WHERE k.conrelid = c.oid AND k.contype = 'f'
                    AND k.confrelid = 'public.companies'::regclass AND k.confdeltype = 'c')
    FROM pg_class c
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'company_id' AND NOT a.attisdropped
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
     AND c.relname NOT IN ('companies', 'platform_deletion_log')
   ORDER BY 1
$$;

CREATE OR REPLACE FUNCTION public._platform_company_storage(p_company_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_agg(x ORDER BY x->>'bucket', x->>'prefix') FROM (
    SELECT jsonb_build_object('bucket', b, 'prefix', p_company_id::text || '/') AS x
      FROM unnest(ARRAY['logos', 'products', 'attachments']) AS b
    UNION ALL
    SELECT jsonb_build_object('bucket', 'support-attachments', 'prefix', t.id::text || '/')
      FROM public.support_tickets t WHERE t.company_id = p_company_id
  ) s
$$;

CREATE OR REPLACE FUNCTION public.platform_company_deletion_preview(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_co record; v_t record; v_n bigint; v_rows jsonb := '{}'::jsonb;
  v_members jsonb; v_blockers jsonb;
BEGIN
  PERFORM public._platform_require_sql_editor();
  SELECT id, name, created_at INTO v_co FROM public.companies WHERE id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'platform deletion: company % not found', p_company_id; END IF;

  FOR v_t IN SELECT * FROM public._platform_company_tables() LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE company_id = $1', v_t.table_name) INTO v_n USING p_company_id;
    IF v_n > 0 THEN v_rows := v_rows || jsonb_build_object(v_t.table_name, v_n); END IF;
  END LOOP;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', p.id, 'email', p.email, 'role', p.role, 'is_active', p.is_active)
                            ORDER BY p.created_at), '[]'::jsonb)
    INTO v_members FROM public.profiles p WHERE p.company_id = p_company_id;

  SELECT COALESCE(jsonb_agg(x.reason), '[]'::jsonb) INTO v_blockers FROM (
    SELECT 'member ' || p.id || ' is a platform admin' AS reason
      FROM public.profiles p JOIN public.platform_admins a ON a.user_id = p.id WHERE p.company_id = p_company_id
    UNION ALL
    SELECT 'member ' || p.id || ' is a support operator'
      FROM public.profiles p JOIN public.support_operators s ON s.user_id = p.id WHERE p.company_id = p_company_id
  ) x;

  RETURN jsonb_build_object(
    'company_id', v_co.id, 'company_name', v_co.name, 'created_at', v_co.created_at,
    'members', v_members, 'blockers', v_blockers, 'rows', v_rows,
    'storage', public._platform_company_storage(p_company_id),
    'note', 'Nothing was changed. Download the company''s data first if it was requested.');
END $$;

CREATE OR REPLACE FUNCTION public.platform_delete_company(p_company_id uuid, p_confirm_name text, p_request_ref text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_name text; v_members uuid[]; v_preview jsonb;
  v_pending text[]; v_left text[]; v_t text; v_n bigint; v_progress boolean;
  v_rows jsonb := '{}'::jsonb; v_users integer := 0; v_pass integer := 0; v_storage jsonb;
BEGIN
  PERFORM public._platform_require_sql_editor();
  IF p_company_id IS NULL THEN RAISE EXCEPTION 'platform deletion: company id is required'; END IF;
  IF p_request_ref IS NULL OR length(btrim(p_request_ref)) NOT BETWEEN 3 AND 100 THEN
    RAISE EXCEPTION 'platform deletion: give the request reference (ticket or email date), 3-100 characters';
  END IF;

  SELECT name INTO v_name FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'platform deletion: company % not found', p_company_id; END IF;
  IF p_confirm_name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'platform deletion: confirm_name does not match the company name exactly — nothing deleted';
  END IF;

  v_preview := public.platform_company_deletion_preview(p_company_id);
  IF jsonb_array_length(v_preview->'blockers') > 0 THEN
    RAISE EXCEPTION 'platform deletion: blocked — %', v_preview->'blockers';
  END IF;
  SELECT array_agg(id) INTO v_members FROM public.profiles WHERE company_id = p_company_id;
  v_storage := public._platform_company_storage(p_company_id);

  -- Delete the tables whose company FK does not cascade, children first. The
  -- order is found by retrying: a table still referenced by another fails with
  -- a FK violation inside its own savepoint and is tried again next pass.
  SELECT array_agg(table_name) INTO v_pending FROM public._platform_company_tables() WHERE NOT goes_with_company;
  LOOP
    v_pass := v_pass + 1; v_progress := false; v_left := '{}';
    FOREACH v_t IN ARRAY COALESCE(v_pending, '{}') LOOP
      BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE company_id = $1', v_t) USING p_company_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n > 0 THEN v_rows := v_rows || jsonb_build_object(v_t, COALESCE((v_rows->>v_t)::bigint, 0) + v_n); END IF;
        v_progress := true;
      -- raise_exception: a lock trigger that only lets the rows go with their
      -- parent (payroll lines go when their run does) — retried next pass.
      EXCEPTION WHEN foreign_key_violation OR raise_exception THEN
        v_left := v_left || v_t;
      END;
    END LOOP;
    v_pending := v_left;
    EXIT WHEN cardinality(v_pending) = 0;
    IF NOT v_progress OR v_pass > 60 THEN
      RAISE EXCEPTION 'platform deletion: could not order the delete; still referenced: % — nothing deleted', v_pending;
    END IF;
  END LOOP;

  -- The rest goes with the company (ON DELETE CASCADE).
  FOR v_t IN SELECT table_name FROM public._platform_company_tables() WHERE goes_with_company LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE company_id = $1', v_t) INTO v_n USING p_company_id;
    IF v_n > 0 THEN v_rows := v_rows || jsonb_build_object(v_t, v_n); END IF;
  END LOOP;
  DELETE FROM public.companies WHERE id = p_company_id;

  IF v_members IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = ANY (v_members);
    GET DIAGNOSTICS v_users = ROW_COUNT;
  END IF;

  -- Re-check rather than trust the deletes.
  FOR v_t IN SELECT table_name FROM public._platform_company_tables() LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE company_id = $1', v_t) INTO v_n USING p_company_id;
    IF v_n > 0 THEN RAISE EXCEPTION 'platform deletion: % rows left in % — rolled back', v_n, v_t; END IF;
  END LOOP;

  INSERT INTO public.platform_deletion_log (kind, subject_id, company_id, request_ref, rows_deleted, users_removed, storage)
  VALUES ('company', p_company_id, p_company_id, btrim(p_request_ref), v_rows, v_users, v_storage);

  RETURN jsonb_build_object('deleted_company', p_company_id, 'users_removed', v_users, 'rows', v_rows,
    'storage', v_storage,
    'next', 'Save "storage" to a file and run scripts/delete-company-storage.mjs with it (dry run first).');
END $$;

CREATE OR REPLACE FUNCTION public.platform_close_member_account(p_user_id uuid, p_request_ref text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_p record; v_admins integer; v_ref record; v_n bigint; v_refs integer := 0; v_kind text;
BEGIN
  PERFORM public._platform_require_sql_editor();
  IF p_request_ref IS NULL OR length(btrim(p_request_ref)) NOT BETWEEN 3 AND 100 THEN
    RAISE EXCEPTION 'platform deletion: give the request reference, 3-100 characters';
  END IF;
  SELECT * INTO v_p FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'platform deletion: no profile for user %', p_user_id; END IF;
  IF EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = p_user_id)
     OR EXISTS (SELECT 1 FROM public.support_operators WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'platform deletion: user is a platform admin or support operator — remove that role first';
  END IF;
  SELECT count(*) INTO v_admins FROM public.profiles
   WHERE company_id = v_p.company_id AND role = 'admin' AND is_active AND id <> p_user_id;
  IF v_p.role = 'admin' AND v_admins = 0 THEN
    RAISE EXCEPTION 'platform deletion: this is the company''s only admin — use platform_delete_company, or make another admin first';
  END IF;

  -- Does anything the company keeps point at this person?
  FOR v_ref IN
    SELECT k.conrelid::regclass AS tbl, a.attname AS col
      FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
     WHERE k.contype = 'f' AND k.confrelid IN ('public.profiles'::regclass, 'auth.users'::regclass)
       AND k.confdeltype <> 'c' AND cardinality(k.conkey) = 1
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', v_ref.tbl, v_ref.col) INTO v_n USING p_user_id;
    v_refs := v_refs + v_n;
  END LOOP;

  IF v_refs = 0 THEN
    DELETE FROM auth.users WHERE id = p_user_id;   -- profile, notifications, overrides cascade
    v_kind := 'member_deleted';
  ELSE
    UPDATE public.profiles
       SET full_name = 'Deleted user', email = 'deleted-' || p_user_id || '@deleted.invalid',
           phone = NULL, is_active = false, updated_at = now()
     WHERE id = p_user_id;
    DELETE FROM auth.identities WHERE user_id = p_user_id;
    DELETE FROM auth.sessions WHERE user_id = p_user_id;
    DELETE FROM auth.mfa_factors WHERE user_id = p_user_id;
    DELETE FROM public.setup_drafts WHERE user_id = p_user_id;
    DELETE FROM public.notifications WHERE user_id = p_user_id;
    UPDATE auth.users
       SET email = 'deleted-' || p_user_id || '@deleted.invalid', phone = NULL,
           encrypted_password = NULL, raw_user_meta_data = '{}'::jsonb,
           email_confirmed_at = NULL, banned_until = 'infinity', updated_at = now()
     WHERE id = p_user_id;
    v_kind := 'member_pseudonymised';
  END IF;

  INSERT INTO public.platform_deletion_log (kind, subject_id, company_id, request_ref, rows_deleted, users_removed)
  VALUES (v_kind, p_user_id, v_p.company_id, btrim(p_request_ref), jsonb_build_object('references_kept', v_refs), 1);
  RETURN jsonb_build_object('user_id', p_user_id, 'result', v_kind, 'references_kept', v_refs);
END $$;

REVOKE ALL ON FUNCTION public._platform_require_sql_editor() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._platform_company_tables() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._platform_company_storage(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.platform_company_deletion_preview(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.platform_delete_company(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.platform_close_member_account(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

-- ── HOW TO USE (SQL Editor, one request at a time) ───────────────────────────
-- 1. Confirm the request came from the account's own email.
-- 2. If asked, export their data first (Settings → Import / Export as them, or
--    ask them to download it).
-- 3. SELECT public.platform_company_deletion_preview('<company uuid>');
--    Read it: right company? right members? no blockers?
-- 4. SELECT public.platform_delete_company('<company uuid>', '<exact company name>', '<request ref>');
-- 5. Copy the "storage" array from the result into a file, e.g. storage.json, then
--    node scripts/delete-company-storage.mjs --env .env.local storage.json            (dry run: lists)
--    node scripts/delete-company-storage.mjs --env .env.local storage.json --execute  (deletes)
--    The same list stays in platform_deletion_log.storage if the step is interrupted.
-- 6. Reply to the requester. The log row is the proof:
--    SELECT * FROM public.platform_deletion_log ORDER BY executed_at DESC LIMIT 5;
-- Team member only:  SELECT public.platform_close_member_account('<user uuid>', '<request ref>');
--
-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- SELECT p.proname, has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
--        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon
--   FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
--    AND (p.proname LIKE 'platform\_%' OR p.proname LIKE '\_platform\_%');
--   -- expect every column false
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.platform_close_member_account(uuid, text);
-- DROP FUNCTION IF EXISTS public.platform_delete_company(uuid, text, text);
-- DROP FUNCTION IF EXISTS public.platform_company_deletion_preview(uuid);
-- DROP FUNCTION IF EXISTS public._platform_company_tables();
-- DROP FUNCTION IF EXISTS public._platform_company_storage(uuid);
-- DROP FUNCTION IF EXISTS public._platform_require_sql_editor();
-- DROP TABLE IF EXISTS public.platform_deletion_log;   -- loses the deletion proof; export it first
-- COMMIT;
