-- ═══════════════════════════════════════════════════════════════════════════
-- phase135 — versioned Terms of Service / Privacy Policy agreement system
--
-- ENFORCEMENT IS OFF. This migration publishes no document and blocks nobody.
-- Turning enforcement on is a separate, explicit SQL step (end of this file).
--
-- legal_documents   what is published: type, version, effective date, the
--                   SHA-256 of the exact published text, whether acceptance is
--                   required, change summary (EN/AR). Written only with SQL by
--                   the platform owner; readable by everyone (also signed out).
-- legal_events      append-only history: user, document, version, fingerprint,
--                   accepted / acknowledged / declined, server time, platform,
--                   app version, and company + role only when an admin accepts
--                   on behalf of the business. No client can insert, change or
--                   delete a row; UPDATE/DELETE are blocked by trigger.
-- legal_settings    one row: enforcement on/off. SQL only.
--
-- accept_legal(...)    records acceptance for the CALLER only, and only for the
--                      currently published version whose fingerprint matches
--                      what the client displayed — a stale or modified client
--                      cannot record acceptance of anything else.
-- decline_legal(...)   records a decline. Nothing is deleted.
-- legal_status()       what the caller still owes.
-- legal_write_allowed() true unless enforcement is on and the caller has not
--                      accepted. Background jobs (no auth.uid()) always pass.
--
-- ENFORCEMENT POINTS (all inert while enforcement is off)
--   has_perm()          every *.write / users.manage permission → this covers
--                       every RLS write rule, auth_require() and has_any_write()
--   journal_entries / stock_ledger BEFORE INSERT → every posting path,
--                       including functions that bypass RLS
--   Still open with enforcement on: reading, export, logout, support tickets,
--   onboarding / invites, legal pages, the user's own setup draft.
--
-- PRE-CHECK on prod (CR-stripped md5) — has_perm expected 62fbb70436c08fe1fc901bd653ae4fb8
-- (the phase131 version):
--   SELECT md5(replace(pg_get_functiondef('public.has_perm(text)'::regprocedure), chr(13), ''));
-- If it differs, STOP and send the result.
--
-- SAFE TO APPLY: new tables/functions/triggers, has_perm gains one inert
-- check. No data changes. Re-runnable. Rollback at the end.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Tables ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.legal_documents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type           text NOT NULL CHECK (doc_type IN ('terms', 'privacy')),
  version            text NOT NULL CHECK (length(version) BETWEEN 1 AND 20),
  effective_at       timestamptz NOT NULL,
  sha256             text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  requires_acceptance boolean NOT NULL DEFAULT true,
  change_summary_en  text,
  change_summary_ar  text,
  published          boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doc_type, version)
);

CREATE TABLE IF NOT EXISTS public.legal_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL,          -- no FK: evidence outlives a deleted login
  doc_type             text NOT NULL CHECK (doc_type IN ('terms', 'privacy')),
  version              text NOT NULL,
  sha256               text NOT NULL,
  event                text NOT NULL CHECK (event IN ('accepted', 'acknowledged', 'declined')),
  on_behalf_company_id uuid,
  on_behalf_role       text,
  platform             text NOT NULL CHECK (platform IN ('web', 'android', 'unknown')),
  app_version          text CHECK (app_version IS NULL OR length(app_version) <= 40),
  created_at           timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS legal_events_user_idx ON public.legal_events (user_id, doc_type, version);

CREATE TABLE IF NOT EXISTS public.legal_settings (
  id          integer PRIMARY KEY CHECK (id = 1),
  enforcement boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.legal_settings (id, enforcement) VALUES (1, false) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.legal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_settings  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legal_documents_read ON public.legal_documents;
DROP POLICY IF EXISTS legal_events_read    ON public.legal_events;
DROP POLICY IF EXISTS legal_settings_read  ON public.legal_settings;
CREATE POLICY legal_documents_read ON public.legal_documents FOR SELECT USING (published);
CREATE POLICY legal_events_read    ON public.legal_events    FOR SELECT USING (user_id = auth.uid());
CREATE POLICY legal_settings_read  ON public.legal_settings  FOR SELECT USING (true);
REVOKE ALL ON public.legal_documents, public.legal_events, public.legal_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.legal_documents, public.legal_settings TO anon, authenticated;
GRANT SELECT ON public.legal_events TO authenticated;

-- Append-only: no one changes or removes history. A documented maintenance
-- procedure (account deletion) can lift this for one transaction with
-- SET LOCAL stockbolt.legal_maintenance = 'on'.
CREATE OR REPLACE FUNCTION public.tg_legal_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('stockbolt.legal_maintenance', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'legal_events is append-only' USING ERRCODE = '42501';
END;
$function$;
DROP TRIGGER IF EXISTS legal_events_append_only ON public.legal_events;
CREATE TRIGGER legal_events_append_only BEFORE UPDATE OR DELETE ON public.legal_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_legal_events_append_only();

-- ── 2. Current documents and status ───────────────────────────────────────
-- The latest published version of each type that is already in effect.
CREATE OR REPLACE FUNCTION public._legal_current_documents()
RETURNS SETOF public.legal_documents
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT DISTINCT ON (doc_type) *
    FROM public.legal_documents
   WHERE published AND effective_at <= now()
   ORDER BY doc_type, effective_at DESC, created_at DESC;
$function$;

-- Has p_user accepted (terms) / acknowledged-or-accepted (privacy) every
-- current document that requires it?
CREATE OR REPLACE FUNCTION public._legal_all_accepted(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT NOT EXISTS (
    SELECT 1 FROM public._legal_current_documents() d
     WHERE d.requires_acceptance
       AND NOT EXISTS (SELECT 1 FROM public.legal_events e
                        WHERE e.user_id = p_user AND e.doc_type = d.doc_type
                          AND e.version = d.version AND e.sha256 = d.sha256
                          AND e.event IN ('accepted', 'acknowledged')));
$function$;

CREATE OR REPLACE FUNCTION public.legal_write_allowed()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NULL
      OR NOT COALESCE((SELECT enforcement FROM public.legal_settings WHERE id = 1), false)
      OR public._legal_all_accepted(auth.uid());
$function$;

CREATE OR REPLACE FUNCTION public.legal_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_docs jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'doc_type', d.doc_type, 'version', d.version, 'sha256', d.sha256,
           'effective_at', d.effective_at, 'requires_acceptance', d.requires_acceptance,
           'change_summary_en', d.change_summary_en, 'change_summary_ar', d.change_summary_ar,
           'accepted', v_uid IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.legal_events e
               WHERE e.user_id = v_uid AND e.doc_type = d.doc_type AND e.version = d.version
                 AND e.sha256 = d.sha256 AND e.event IN ('accepted', 'acknowledged')),
           'declined', v_uid IS NOT NULL AND (
              SELECT e.event FROM public.legal_events e
               WHERE e.user_id = v_uid AND e.doc_type = d.doc_type AND e.version = d.version
               ORDER BY e.created_at DESC LIMIT 1) = 'declined'
         ) ORDER BY d.doc_type), '[]'::jsonb)
    INTO v_docs
    FROM public._legal_current_documents() d;

  RETURN jsonb_build_object(
    'enforcement', COALESCE((SELECT enforcement FROM public.legal_settings WHERE id = 1), false),
    'documents', v_docs,
    'all_accepted', v_uid IS NOT NULL AND public._legal_all_accepted(v_uid));
END;
$function$;

-- ── 3. Accept / decline (the caller only) ─────────────────────────────────
-- p_items: [{"doc_type":"terms","version":"1.0","sha256":"…"}, …]
CREATE OR REPLACE FUNCTION public.accept_legal(
  p_items jsonb, p_on_behalf_of_company boolean DEFAULT false,
  p_platform text DEFAULT 'unknown', p_app_version text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_item  jsonb;
  v_doc   public.legal_documents%ROWTYPE;
  v_co    uuid;
  v_role  text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'legal: not signed in' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 4 THEN
    RAISE EXCEPTION 'legal: invalid_request' USING ERRCODE = '22023';
  END IF;
  IF p_platform NOT IN ('web', 'android', 'unknown') THEN p_platform := 'unknown'; END IF;

  -- Acceptance for the business: only a company admin, and recorded as such.
  IF p_on_behalf_of_company THEN
    SELECT company_id, role INTO v_co, v_role FROM public.profiles WHERE id = v_uid;
    IF v_co IS NULL OR v_role <> 'admin' THEN
      RAISE EXCEPTION 'legal: not_company_admin' USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_doc FROM public._legal_current_documents() d WHERE d.doc_type = v_item->>'doc_type';
    -- Only the version in effect, with the exact text the client showed.
    IF NOT FOUND OR v_doc.version IS DISTINCT FROM v_item->>'version'
       OR v_doc.sha256 IS DISTINCT FROM lower(v_item->>'sha256') THEN
      RAISE EXCEPTION 'legal: stale_document' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.legal_events (user_id, doc_type, version, sha256, event,
                                     on_behalf_company_id, on_behalf_role, platform, app_version)
    VALUES (v_uid, v_doc.doc_type, v_doc.version, v_doc.sha256,
            CASE v_doc.doc_type WHEN 'terms' THEN 'accepted' ELSE 'acknowledged' END,
            CASE WHEN v_doc.doc_type = 'terms' THEN v_co END,
            CASE WHEN v_doc.doc_type = 'terms' THEN v_role END,
            p_platform, left(p_app_version, 40));
  END LOOP;
  RETURN public.legal_status();
END;
$function$;

CREATE OR REPLACE FUNCTION public.decline_legal(p_platform text DEFAULT 'unknown', p_app_version text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_doc public.legal_documents%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'legal: not signed in' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_doc FROM public._legal_current_documents() d WHERE d.doc_type = 'terms';
  IF NOT FOUND THEN RAISE EXCEPTION 'legal: nothing_to_decline' USING ERRCODE = 'P0001'; END IF;
  IF p_platform NOT IN ('web', 'android', 'unknown') THEN p_platform := 'unknown'; END IF;
  INSERT INTO public.legal_events (user_id, doc_type, version, sha256, event, platform, app_version)
  VALUES (v_uid, 'terms', v_doc.version, v_doc.sha256, 'declined', p_platform, left(p_app_version, 40));
  RETURN public.legal_status();
END;
$function$;

-- ── 4. Enforcement points (inert while enforcement is off) ────────────────
CREATE OR REPLACE FUNCTION public.has_perm(p_permission text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_role TEXT; v_active BOOLEAN; v_company UUID; v_ovr TEXT;
BEGIN
  SELECT role, is_active, company_id INTO v_role, v_active, v_company
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active IS NOT TRUE THEN RETURN FALSE; END IF;
  -- phase135: while Terms enforcement is ON, write permissions wait until the
  -- user has accepted the current required documents (reading never does).
  IF (p_permission LIKE '%.write' OR p_permission = 'users.manage')
     AND NOT public.legal_write_allowed() THEN
    RETURN FALSE;
  END IF;
  IF v_role = 'admin' THEN RETURN TRUE; END IF;
  -- phase131: payroll is confidential (salaries, bank details) — admin only.
  -- Neither a role grant nor a per-user override can open it.
  IF p_permission LIKE 'payroll.%' THEN RETURN FALSE; END IF;

  SELECT mode INTO v_ovr FROM public.user_permission_overrides
   WHERE user_id = auth.uid() AND permission = p_permission;
  IF v_ovr = 'deny'  THEN RETURN FALSE; END IF;
  IF v_ovr = 'allow' THEN RETURN TRUE;  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.role_permissions
     WHERE role = v_role AND permission = p_permission
       AND (company_id IS NULL OR company_id = v_company)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_legal_posting_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- Postings made for a signed-in user wait for accepted Terms when
  -- enforcement is on. Background jobs (no user) are never blocked.
  IF auth.uid() IS NOT NULL AND NOT public.legal_write_allowed() THEN
    RAISE EXCEPTION 'legal_acceptance_required: accept the updated Terms of Service to continue'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS legal_posting_guard ON public.journal_entries;
CREATE TRIGGER legal_posting_guard BEFORE INSERT ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_legal_posting_guard();
DROP TRIGGER IF EXISTS legal_posting_guard ON public.stock_ledger;
CREATE TRIGGER legal_posting_guard BEFORE INSERT ON public.stock_ledger
  FOR EACH ROW EXECUTE FUNCTION public.tg_legal_posting_guard();

-- ── 5. Grants ─────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._legal_current_documents() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._legal_all_accepted(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_legal_events_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_legal_posting_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.legal_write_allowed() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.legal_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_legal(jsonb, boolean, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decline_legal(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legal_write_allowed() TO authenticated;
GRANT EXECUTE ON FUNCTION public.legal_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_legal(jsonb, boolean, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_legal(text, text) TO authenticated;
-- has_perm runs inside RLS for every role, including ledger_writer.
GRANT EXECUTE ON FUNCTION public._legal_all_accepted(uuid) TO ledger_writer;

COMMIT;

-- ── PUBLISH a document (platform owner, SQL; after legal review) ──────────
--   sha256 = SHA-256 of the exact published text (the app shows it on the page).
--   INSERT INTO public.legal_documents (doc_type, version, effective_at, sha256, requires_acceptance,
--                                       change_summary_en, change_summary_ar, published)
--   VALUES ('terms', '1.0', '<effective timestamp>', '<sha256>', true, '<summary>', '<ملخص>', true);
--
-- ── TURN ENFORCEMENT ON / OFF (separate approval) ─────────────────────────
--   UPDATE public.legal_settings SET enforcement = true,  updated_at = now() WHERE id = 1;
--   UPDATE public.legal_settings SET enforcement = false, updated_at = now() WHERE id = 1;  -- emergency off
--   History in legal_events is never touched by either.
--
-- ── Verify after applying — expect true, false, true ──────────────────────
-- SELECT to_regclass('public.legal_events') IS NOT NULL AS tables,
--        (SELECT enforcement FROM public.legal_settings WHERE id = 1) AS enforcement_on,
--        pg_get_functiondef('public.has_perm(text)'::regprocedure) LIKE '%legal_write_allowed%' AS has_perm_hook;
--
-- ── ROLLBACK ──────────────────────────────────────────────────────────────
--   re-create has_perm from the phase131 definition (without the phase135 lines);
--   DROP TRIGGER legal_posting_guard ON public.journal_entries;
--   DROP TRIGGER legal_posting_guard ON public.stock_ledger;
--   DROP FUNCTION public.tg_legal_posting_guard(), public.decline_legal(text,text),
--     public.accept_legal(jsonb,boolean,text,text), public.legal_status(), public.legal_write_allowed(),
--     public._legal_all_accepted(uuid), public._legal_current_documents();
--   (keep legal_events — it is evidence; drop the tables only if nothing was ever recorded)
