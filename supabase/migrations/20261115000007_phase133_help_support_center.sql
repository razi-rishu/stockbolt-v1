-- ═══════════════════════════════════════════════════════════════════════════
-- phase133 — Help & Support Center v1
--
-- Customers raise requests (assistance, bug, feature, feedback) from inside
-- StockBolt; StockBolt support operators answer them from a restricted inbox.
--
-- WHO SEES WHAT
--   • A ticket is PRIVATE to the user who raised it. Company admins do not
--     see their employees' tickets (they may hold payroll or personal data).
--   • Support operators see every ticket, across companies. An operator is a
--     row in support_operators, a list no client can read or write. It is
--     NOT a company role: a company admin is never an operator because of
--     their role. Add or remove operators with SQL (see the end of this file).
--
-- HOW WRITES HAPPEN
--   Clients get SELECT only (through RLS). Every write is a SECURITY DEFINER
--   function that takes the user and company from the session, never from
--   the request, so a client cannot raise a ticket as someone else, for
--   another company, or change ownership / company / status it may not.
--   Each function checks auth.uid(), the caller's access to the ticket and,
--   for operator actions, is_support_operator().
--
-- TABLES
--   support_operators     user_id — the operator allow-list
--   support_tickets       one request; SB-000001 numbering; read markers
--   support_messages      the conversation
--   support_attachments   files in the private 'support-attachments' bucket
--   support_activity      append-only history (status, assignment, …)
--
-- UNREAD (in-app only): last_user_message_at / last_operator_message_at vs
-- user_last_read_at / operator_last_read_at on the ticket. The shared
-- notifications table is NOT used: every user in a company can read it,
-- which would reveal a colleague's private ticket.
--
-- ATTACHMENTS: private bucket (never public URLs), PNG / JPEG / WebP / PDF,
-- 5 MB each, path '<ticket_id>/<random>.<ext>'. Storage RLS lets a user read
-- or upload only under a ticket they can access, so a signed URL is only
-- issued after that check. No client update or delete.
--
-- LIMITS (server-side): 10 new tickets per user per hour; 60 messages per
-- user per hour; 5 files per message, 20 per ticket. A repeated submit with
-- the same client_request_id returns the first ticket instead of a second.
--
-- RETENTION (procedure, not automated in v1): tickets closed more than 24
-- months ago may be deleted by the platform owner — files first through the
-- Storage API, then the ticket (messages, files and history cascade).
--
-- SAFE TO APPLY: new tables, functions, bucket and policies only. Nothing
-- existing is changed. Re-runnable. Rollback at the end of this file.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Operator allow-list ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_operators (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.support_operators ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_operators FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_support_operator()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.support_operators WHERE user_id = auth.uid());
$function$;

-- ── 2. Tables ─────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.support_ticket_seq;

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number            text NOT NULL UNIQUE,
  company_id               uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category                 text NOT NULL CHECK (category IN ('assistance','bug','feature','feedback')),
  subject                  text NOT NULL CHECK (length(btrim(subject)) BETWEEN 3 AND 200),
  description              text NOT NULL CHECK (length(btrim(description)) BETWEEN 10 AND 10000),
  module                   text CHECK (module IS NULL OR length(module) <= 60),
  contact_preference       text NOT NULL DEFAULT 'in_app' CHECK (contact_preference IN ('in_app','email')),
  status                   text NOT NULL DEFAULT 'submitted'
                             CHECK (status IN ('submitted','in_progress','waiting_for_user','resolved','closed')),
  priority                 text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  assigned_to              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  client_request_id        uuid,
  last_user_message_at     timestamptz NOT NULL DEFAULT now(),
  last_operator_message_at timestamptz,
  user_last_read_at        timestamptz NOT NULL DEFAULT now(),
  operator_last_read_at    timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  resolved_at              timestamptz,
  closed_at                timestamptz,
  CONSTRAINT support_tickets_request_once UNIQUE (created_by, client_request_id)
);
CREATE INDEX IF NOT EXISTS support_tickets_created_by_idx ON public.support_tickets (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_company_idx    ON public.support_tickets (company_id);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx     ON public.support_tickets (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_assigned_idx   ON public.support_tickets (assigned_to);

CREATE TABLE IF NOT EXISTS public.support_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_type text NOT NULL CHECK (sender_type IN ('user','operator')),
  message     text NOT NULL CHECK (length(btrim(message)) BETWEEN 1 AND 10000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_messages_ticket_idx ON public.support_messages (ticket_id, created_at);
CREATE INDEX IF NOT EXISTS support_messages_sender_idx ON public.support_messages (sender_id, created_at);

CREATE TABLE IF NOT EXISTS public.support_attachments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id         uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  message_id        uuid REFERENCES public.support_messages(id) ON DELETE CASCADE,
  storage_path      text NOT NULL UNIQUE,
  original_filename text NOT NULL CHECK (length(original_filename) BETWEEN 1 AND 200),
  mime_type         text NOT NULL CHECK (mime_type IN ('image/png','image/jpeg','image/webp','application/pdf')),
  file_size         integer NOT NULL CHECK (file_size > 0 AND file_size <= 5242880),
  uploaded_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_attachments_ticket_idx  ON public.support_attachments (ticket_id);
CREATE INDEX IF NOT EXISTS support_attachments_message_idx ON public.support_attachments (message_id);

CREATE TABLE IF NOT EXISTS public.support_activity (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id      uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  actor_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_type     text NOT NULL CHECK (actor_type IN ('user','operator')),
  action         text NOT NULL CHECK (action IN ('created','replied','status_changed','assigned',
                                                 'priority_changed','attachment_added','reopened')),
  previous_value text,
  new_value      text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_activity_ticket_idx ON public.support_activity (ticket_id, created_at);

DROP TRIGGER IF EXISTS set_updated_at ON public.support_tickets;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3. Access (read-only for clients) ─────────────────────────────────────
-- The ticket's creator, while still in the ticket's company; or an operator.
CREATE OR REPLACE FUNCTION public.support_can_access_ticket(p_ticket_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_support_operator()
    OR EXISTS (SELECT 1 FROM public.support_tickets t
                WHERE t.id = p_ticket_id
                  AND t.created_by = auth.uid()
                  AND t.company_id = public.current_user_company_id()));
$function$;

ALTER TABLE public.support_tickets     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_activity    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_tickets_read     ON public.support_tickets;
DROP POLICY IF EXISTS support_messages_read    ON public.support_messages;
DROP POLICY IF EXISTS support_attachments_read ON public.support_attachments;
DROP POLICY IF EXISTS support_activity_read    ON public.support_activity;
CREATE POLICY support_tickets_read ON public.support_tickets FOR SELECT
  USING ((created_by = auth.uid() AND company_id = public.current_user_company_id()) OR public.is_support_operator());
CREATE POLICY support_messages_read    ON public.support_messages    FOR SELECT USING (public.support_can_access_ticket(ticket_id));
CREATE POLICY support_attachments_read ON public.support_attachments FOR SELECT USING (public.support_can_access_ticket(ticket_id));
CREATE POLICY support_activity_read    ON public.support_activity    FOR SELECT USING (public.support_can_access_ticket(ticket_id));

REVOKE ALL ON public.support_tickets, public.support_messages, public.support_attachments, public.support_activity
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.support_tickets, public.support_messages, public.support_attachments, public.support_activity
  TO authenticated;
REVOKE ALL ON SEQUENCE public.support_ticket_seq FROM PUBLIC, anon, authenticated;

-- ── 4. Helpers ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._support_log(p_ticket uuid, p_actor_type text, p_action text, p_prev text, p_new text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  INSERT INTO public.support_activity (ticket_id, actor_id, actor_type, action, previous_value, new_value)
  VALUES (p_ticket, auth.uid(), p_actor_type, p_action, p_prev, p_new);
$function$;

-- ── 5. Create a ticket ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.support_create_ticket(
  p_category text, p_subject text, p_description text,
  p_module text DEFAULT NULL, p_contact_preference text DEFAULT 'in_app',
  p_client_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_company uuid := public.current_user_company_id();
  v_t       public.support_tickets%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'support: not signed in to a company' USING ERRCODE = '42501';
  END IF;

  -- The same submit twice (double click, retry after a lost response).
  IF p_client_request_id IS NOT NULL THEN
    SELECT * INTO v_t FROM public.support_tickets
     WHERE created_by = v_uid AND client_request_id = p_client_request_id;
    IF FOUND THEN
      RETURN jsonb_build_object('id', v_t.id, 'ticket_number', v_t.ticket_number, 'duplicate', true);
    END IF;
  END IF;

  IF p_category NOT IN ('assistance','bug','feature','feedback')
     OR length(btrim(COALESCE(p_subject, ''))) NOT BETWEEN 3 AND 200
     OR length(btrim(COALESCE(p_description, ''))) NOT BETWEEN 10 AND 10000
     OR length(COALESCE(p_module, '')) > 60
     OR COALESCE(p_contact_preference, 'in_app') NOT IN ('in_app','email') THEN
    RAISE EXCEPTION 'support: invalid_input' USING ERRCODE = '22023';
  END IF;

  IF (SELECT count(*) FROM public.support_tickets
       WHERE created_by = v_uid AND created_at > now() - interval '1 hour') >= 10 THEN
    RAISE EXCEPTION 'support: rate_limited' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.support_tickets (ticket_number, company_id, created_by, category, subject, description,
                                      module, contact_preference, client_request_id)
  VALUES ('SB-' || lpad(nextval('public.support_ticket_seq')::text, 6, '0'), v_company, v_uid,
          p_category, btrim(p_subject), btrim(p_description), NULLIF(btrim(p_module), ''),
          COALESCE(p_contact_preference, 'in_app'), p_client_request_id)
  RETURNING * INTO v_t;

  PERFORM public._support_log(v_t.id, 'user', 'created', NULL, 'submitted');
  RETURN jsonb_build_object('id', v_t.id, 'ticket_number', v_t.ticket_number, 'duplicate', false);
END;
$function$;

-- ── 6. Reply (user or operator) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.support_add_message(p_ticket_id uuid, p_message text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  v_op   boolean := public.is_support_operator();
  v_t    public.support_tickets%ROWTYPE;
  v_id   uuid;
  v_new  text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'support: not signed in' USING ERRCODE = '42501'; END IF;
  IF NOT public.support_can_access_ticket(p_ticket_id) THEN
    RAISE EXCEPTION 'support: ticket not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_t FROM public.support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF v_t.status = 'closed' THEN
    RAISE EXCEPTION 'support: ticket_closed' USING ERRCODE = 'P0001';
  END IF;
  IF length(btrim(COALESCE(p_message, ''))) NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'support: invalid_input' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.support_messages
       WHERE sender_id = v_uid AND created_at > now() - interval '1 hour') >= 60 THEN
    RAISE EXCEPTION 'support: rate_limited' USING ERRCODE = 'P0001';
  END IF;

  -- An operator answering the request they raised themselves counts as the user.
  IF v_op AND v_t.created_by <> v_uid THEN
    INSERT INTO public.support_messages (ticket_id, sender_id, sender_type, message)
    VALUES (p_ticket_id, v_uid, 'operator', btrim(p_message)) RETURNING id INTO v_id;
    v_new := CASE WHEN v_t.status = 'submitted' THEN 'in_progress' ELSE v_t.status END;
    UPDATE public.support_tickets
       SET last_operator_message_at = clock_timestamp(), operator_last_read_at = clock_timestamp(), status = v_new
     WHERE id = p_ticket_id;
    PERFORM public._support_log(p_ticket_id, 'operator', 'replied', NULL, NULL);
  ELSE
    INSERT INTO public.support_messages (ticket_id, sender_id, sender_type, message)
    VALUES (p_ticket_id, v_uid, 'user', btrim(p_message)) RETURNING id INTO v_id;
    -- Answering a question moves it back to support; replying to a resolved
    -- ticket reopens it.
    v_new := CASE v_t.status WHEN 'waiting_for_user' THEN 'in_progress'
                             WHEN 'resolved' THEN 'submitted' ELSE v_t.status END;
    UPDATE public.support_tickets
       SET last_user_message_at = clock_timestamp(), user_last_read_at = clock_timestamp(), status = v_new,
           resolved_at = CASE WHEN v_new = 'submitted' AND v_t.status = 'resolved' THEN NULL ELSE resolved_at END
     WHERE id = p_ticket_id;
    PERFORM public._support_log(p_ticket_id, 'user', CASE WHEN v_t.status = 'resolved' THEN 'reopened' ELSE 'replied' END,
                                CASE WHEN v_new <> v_t.status THEN v_t.status END,
                                CASE WHEN v_new <> v_t.status THEN v_new END);
  END IF;
  RETURN jsonb_build_object('id', v_id, 'status', v_new);
END;
$function$;

-- ── 7. Attachments ────────────────────────────────────────────────────────
-- Path must be '<ticket_id>/<name>.<ext>' under a ticket the caller can use.
CREATE OR REPLACE FUNCTION public.support_path_ticket(p_path text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}\.(png|jpg|jpeg|webp|pdf)$' THEN
    RETURN NULL;
  END IF;
  RETURN split_part(p_path, '/', 1)::uuid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.support_register_attachment(
  p_ticket_id uuid, p_message_id uuid, p_storage_path text,
  p_filename text, p_mime_type text, p_file_size integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_status text;
  v_id     uuid;
  v_meta   jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'support: not signed in' USING ERRCODE = '42501'; END IF;
  IF NOT public.support_can_access_ticket(p_ticket_id) THEN
    RAISE EXCEPTION 'support: ticket not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT status INTO v_status FROM public.support_tickets WHERE id = p_ticket_id;
  IF v_status = 'closed' THEN RAISE EXCEPTION 'support: ticket_closed' USING ERRCODE = 'P0001'; END IF;
  IF public.support_path_ticket(p_storage_path) IS DISTINCT FROM p_ticket_id THEN
    RAISE EXCEPTION 'support: bad_path' USING ERRCODE = '42501';
  END IF;
  IF p_mime_type NOT IN ('image/png','image/jpeg','image/webp','application/pdf') THEN
    RAISE EXCEPTION 'support: file_type' USING ERRCODE = 'P0001';
  END IF;
  IF p_file_size IS NULL OR p_file_size <= 0 OR p_file_size > 5242880 THEN
    RAISE EXCEPTION 'support: file_size' USING ERRCODE = 'P0001';
  END IF;
  IF p_message_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.support_messages WHERE id = p_message_id AND ticket_id = p_ticket_id AND sender_id = v_uid) THEN
    RAISE EXCEPTION 'support: bad_message' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM public.support_attachments WHERE ticket_id = p_ticket_id) >= 20
     OR (p_message_id IS NOT NULL AND (SELECT count(*) FROM public.support_attachments WHERE message_id = p_message_id) >= 5)
     OR (p_message_id IS NULL AND (SELECT count(*) FROM public.support_attachments
                                    WHERE ticket_id = p_ticket_id AND message_id IS NULL) >= 5) THEN
    RAISE EXCEPTION 'support: too_many_files' USING ERRCODE = 'P0001';
  END IF;

  -- When Storage is present the uploaded object must exist under that path,
  -- uploaded by this user, with the stated size and type.
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'SELECT metadata FROM storage.objects WHERE bucket_id = $1 AND name = $2 AND owner = $3'
       INTO v_meta USING 'support-attachments', p_storage_path, v_uid;
    IF v_meta IS NULL THEN RAISE EXCEPTION 'support: file_missing' USING ERRCODE = 'P0001'; END IF;
    IF (v_meta->>'size')::bigint IS DISTINCT FROM p_file_size::bigint
       OR (v_meta->>'mimetype') IS DISTINCT FROM p_mime_type THEN
      RAISE EXCEPTION 'support: file_mismatch' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.support_attachments (ticket_id, message_id, storage_path, original_filename, mime_type, file_size, uploaded_by)
  VALUES (p_ticket_id, p_message_id, p_storage_path, left(btrim(p_filename), 200), p_mime_type, p_file_size, v_uid)
  RETURNING id INTO v_id;
  PERFORM public._support_log(p_ticket_id, CASE WHEN public.is_support_operator() THEN 'operator' ELSE 'user' END,
                              'attachment_added', NULL, left(btrim(p_filename), 200));
  RETURN jsonb_build_object('id', v_id);
END;
$function$;

-- ── 8. Read markers and unread counts ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.support_mark_read(p_ticket_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'support: not signed in' USING ERRCODE = '42501'; END IF;
  IF NOT public.support_can_access_ticket(p_ticket_id) THEN
    RAISE EXCEPTION 'support: ticket not found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.support_tickets
     SET user_last_read_at     = CASE WHEN created_by = v_uid THEN clock_timestamp() ELSE user_last_read_at END,
         operator_last_read_at = CASE WHEN created_by <> v_uid AND public.is_support_operator()
                                      THEN clock_timestamp() ELSE operator_last_read_at END
   WHERE id = p_ticket_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.support_unread_counts()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'mine', (SELECT count(*) FROM public.support_tickets
              WHERE created_by = auth.uid() AND company_id = public.current_user_company_id()
                AND last_operator_message_at IS NOT NULL
                AND last_operator_message_at > user_last_read_at),
    'inbox', CASE WHEN public.is_support_operator() THEN
              (SELECT count(*) FROM public.support_tickets
                WHERE created_by <> auth.uid()
                  AND status NOT IN ('closed')
                  AND (operator_last_read_at IS NULL OR last_user_message_at > operator_last_read_at))
             ELSE 0 END,
    'is_operator', public.is_support_operator())
  WHERE auth.uid() IS NOT NULL;
$function$;

-- ── 9. User: close or reopen their own ticket ─────────────────────────────
CREATE OR REPLACE FUNCTION public.support_user_set_status(p_ticket_id uuid, p_action text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_t   public.support_tickets%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'support: not signed in' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_t FROM public.support_tickets
   WHERE id = p_ticket_id AND created_by = v_uid AND company_id = public.current_user_company_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'support: ticket not found' USING ERRCODE = 'P0002'; END IF;
  IF p_action = 'close' AND v_t.status <> 'closed' THEN
    UPDATE public.support_tickets SET status = 'closed', closed_at = now() WHERE id = v_t.id;
    PERFORM public._support_log(v_t.id, 'user', 'status_changed', v_t.status, 'closed');
  ELSIF p_action = 'reopen' AND v_t.status = 'resolved' THEN
    UPDATE public.support_tickets SET status = 'submitted', resolved_at = NULL WHERE id = v_t.id;
    PERFORM public._support_log(v_t.id, 'user', 'reopened', 'resolved', 'submitted');
  ELSE
    RAISE EXCEPTION 'support: status_not_allowed' USING ERRCODE = 'P0001';
  END IF;
END;
$function$;

-- ── 10. Operator actions ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.support_operator_update(
  p_ticket_id uuid, p_status text DEFAULT NULL, p_priority text DEFAULT NULL,
  p_assign boolean DEFAULT false, p_assigned_to uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_t public.support_tickets%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_support_operator() THEN
    RAISE EXCEPTION 'support: operators only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_t FROM public.support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'support: ticket not found' USING ERRCODE = 'P0002'; END IF;

  IF p_status IS NOT NULL AND p_status IS DISTINCT FROM v_t.status THEN
    IF p_status NOT IN ('submitted','in_progress','waiting_for_user','resolved','closed') THEN
      RAISE EXCEPTION 'support: bad_status' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.support_tickets
       SET status = p_status,
           resolved_at = CASE WHEN p_status = 'resolved' THEN now()
                              WHEN p_status IN ('submitted','in_progress','waiting_for_user') THEN NULL
                              ELSE resolved_at END,
           closed_at = CASE WHEN p_status = 'closed' THEN now() ELSE NULL END
     WHERE id = v_t.id;
    PERFORM public._support_log(v_t.id, 'operator', 'status_changed', v_t.status, p_status);
  END IF;

  IF p_priority IS NOT NULL AND p_priority IS DISTINCT FROM v_t.priority THEN
    IF p_priority NOT IN ('low','normal','high','urgent') THEN
      RAISE EXCEPTION 'support: bad_priority' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.support_tickets SET priority = p_priority WHERE id = v_t.id;
    PERFORM public._support_log(v_t.id, 'operator', 'priority_changed', v_t.priority, p_priority);
  END IF;

  IF p_assign AND p_assigned_to IS DISTINCT FROM v_t.assigned_to THEN
    IF p_assigned_to IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.support_operators WHERE user_id = p_assigned_to) THEN
      RAISE EXCEPTION 'support: not_an_operator' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.support_tickets SET assigned_to = p_assigned_to WHERE id = v_t.id;
    PERFORM public._support_log(v_t.id, 'operator', 'assigned', v_t.assigned_to::text, p_assigned_to::text);
  END IF;
END;
$function$;

-- Inbox list with the requester and company, which RLS on profiles and
-- companies would otherwise hide from an operator.
CREATE OR REPLACE FUNCTION public.support_inbox(
  p_status text DEFAULT NULL, p_category text DEFAULT NULL, p_priority text DEFAULT NULL,
  p_search text DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
)
RETURNS TABLE (id uuid, ticket_number text, category text, subject text, status text, priority text,
               assigned_to uuid, company_name text, requester_name text, requester_email text,
               created_at timestamptz, updated_at timestamptz, unread boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_support_operator() THEN
    RAISE EXCEPTION 'support: operators only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT t.id, t.ticket_number, t.category, t.subject, t.status, t.priority, t.assigned_to,
           c.name, p.full_name, p.email, t.created_at, t.updated_at,
           (t.created_by <> auth.uid()
            AND (t.operator_last_read_at IS NULL OR t.last_user_message_at > t.operator_last_read_at))
      FROM public.support_tickets t
      JOIN public.companies c ON c.id = t.company_id
      LEFT JOIN public.profiles p ON p.id = t.created_by
     WHERE (p_status   IS NULL OR t.status   = p_status)
       AND (p_category IS NULL OR t.category = p_category)
       AND (p_priority IS NULL OR t.priority = p_priority)
       AND (COALESCE(btrim(p_search), '') = ''
            OR t.ticket_number ILIKE '%' || btrim(p_search) || '%'
            OR t.subject       ILIKE '%' || btrim(p_search) || '%'
            OR c.name          ILIKE '%' || btrim(p_search) || '%'
            OR p.email         ILIKE '%' || btrim(p_search) || '%')
     ORDER BY t.updated_at DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100) OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$function$;

-- Requester, company and the operator list for one ticket (operators only).
CREATE OR REPLACE FUNCTION public.support_ticket_context(p_ticket_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_support_operator() THEN
    RAISE EXCEPTION 'support: operators only' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
           'company_name', c.name, 'country_code', c.country_code,
           'requester_name', p.full_name, 'requester_email', p.email,
           'operators', (SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', o.user_id,
                                   'name', COALESCE(op.full_name, op.email)) ORDER BY op.full_name), '[]'::jsonb)
                           FROM public.support_operators o LEFT JOIN public.profiles op ON op.id = o.user_id))
    INTO v
    FROM public.support_tickets t
    JOIN public.companies c ON c.id = t.company_id
    LEFT JOIN public.profiles p ON p.id = t.created_by
   WHERE t.id = p_ticket_id;
  IF v IS NULL THEN RAISE EXCEPTION 'support: ticket not found' USING ERRCODE = 'P0002'; END IF;
  RETURN v;
END;
$function$;

-- ── 11. Grants ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.is_support_operator()                                          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.support_can_access_ticket(uuid)                                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._support_log(uuid, text, text, text, text)                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.support_path_ticket(text)                                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.support_create_ticket(text, text, text, text, text, uuid)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.support_add_message(uuid, text)                                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.support_register_attachment(uuid, uuid, text, text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.support_mark_read(uuid)                                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.support_unread_counts()                                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.support_user_set_status(uuid, text)                            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.support_operator_update(uuid, text, text, boolean, uuid)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.support_inbox(text, text, text, text, integer, integer)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.support_ticket_context(uuid)                                   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_support_operator()                                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_can_access_ticket(uuid)                                TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_path_ticket(text)                                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_create_ticket(text, text, text, text, text, uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_add_message(uuid, text)                                TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_register_attachment(uuid, uuid, text, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_mark_read(uuid)                                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_unread_counts()                                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_user_set_status(uuid, text)                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_operator_update(uuid, text, text, boolean, uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_inbox(text, text, text, text, integer, integer)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_ticket_context(uuid)                                   TO authenticated;

-- ── 12. Private storage bucket + policies (skipped where Storage is absent)
DO $storage$
BEGIN
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'phase133: Storage not installed here — bucket and storage policies skipped';
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('support-attachments', 'support-attachments', false, 5242880,
          ARRAY['image/png','image/jpeg','image/webp','application/pdf'])
  ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 5242880,
          allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp','application/pdf'];

  EXECUTE 'DROP POLICY IF EXISTS support_attachments_select ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS support_attachments_insert ON storage.objects';
  -- Reading (and so a signed URL) needs access to the ticket in the path.
  EXECUTE $p$CREATE POLICY support_attachments_select ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'support-attachments'
           AND public.support_can_access_ticket(public.support_path_ticket(name)))$p$;
  -- Uploading: same, a well-formed path, and the ticket not closed.
  EXECUTE $p$CREATE POLICY support_attachments_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'support-attachments'
                AND public.support_path_ticket(name) IS NOT NULL
                AND public.support_can_access_ticket(public.support_path_ticket(name))
                AND EXISTS (SELECT 1 FROM public.support_tickets t
                             WHERE t.id = public.support_path_ticket(name) AND t.status <> 'closed'))$p$;
  -- No UPDATE / DELETE policy: clients can neither replace nor remove files.
END
$storage$;

COMMIT;

-- ── Make someone a support operator (run by the platform owner) ───────────
--   INSERT INTO public.support_operators (user_id)
--   SELECT id FROM auth.users WHERE email = '<operator email>'
--   ON CONFLICT DO NOTHING;
-- Remove: DELETE FROM public.support_operators WHERE user_id = '<uuid>';
--
-- ── Verify after applying (read-only) — expect all true ───────────────────
-- SELECT to_regclass('public.support_tickets') IS NOT NULL AS tickets,
--        (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.support_tickets'::regclass) AS rls,
--        NOT has_table_privilege('authenticated', 'public.support_tickets', 'INSERT') AS no_client_insert,
--        (SELECT NOT public FROM storage.buckets WHERE id = 'support-attachments') AS bucket_private,
--        (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage'
--          AND policyname IN ('support_attachments_select','support_attachments_insert')) = 2 AS storage_policies;
--
-- ── ROLLBACK (deletes all tickets) ────────────────────────────────────────
--   DROP POLICY IF EXISTS support_attachments_select ON storage.objects;
--   DROP POLICY IF EXISTS support_attachments_insert ON storage.objects;
--   (empty and delete the 'support-attachments' bucket from the Storage UI)
--   DROP TABLE public.support_activity, public.support_attachments, public.support_messages,
--              public.support_tickets, public.support_operators;
--   DROP SEQUENCE public.support_ticket_seq;
--   DROP FUNCTION public.support_ticket_context(uuid), public.support_inbox(text,text,text,text,integer,integer),
--     public.support_operator_update(uuid,text,text,boolean,uuid), public.support_user_set_status(uuid,text),
--     public.support_unread_counts(), public.support_mark_read(uuid),
--     public.support_register_attachment(uuid,uuid,text,text,text,integer), public.support_path_ticket(text),
--     public.support_add_message(uuid,text), public.support_create_ticket(text,text,text,text,text,uuid),
--     public._support_log(uuid,text,text,text,text), public.support_can_access_ticket(uuid),
--     public.is_support_operator();
