-- ═══════════════════════════════════════════════════════════════════════════
-- phase145 — Approvals engine (Part 2, batch 1: purchasing documents)
--
-- Plan approved by Rashid 2026-11-21. Routes along the phase144 team tree.
--
--   approval_rules        per company + document type: on/off and the amount
--                         from which approval is needed (0 = always).
--   approval_authorities  who may approve which document type, up to what
--                         amount (NULL = no limit). '*' = every type.
--   approval_requests     one per submission: the document, its amount in base
--                         currency, who sent it, who must act now, the outcome.
--   approval_steps        append-only history: submitted / approved (passed on)
--                         / approved / override / forwarded / rejected /
--                         cancelled / admin_reopen / admin_void.
--
-- How it behaves (all enforced here, so web, Android and the API behave the same):
--   • Once a rule applies to a document, confirming it directly is refused —
--     it must go through Submit for approval. Approve = Confirm: the final
--     approval calls the document's existing confirm function in the same
--     transaction. Nothing about posting changes; no posting function is edited.
--   • While a request is pending the document and its lines can't change.
--   • An approved document can only be voided or reopened for editing by an
--     admin (logged). After an admin reopens it, confirming needs approval again.
--   • Owner override: an admin may approve any pending request (logged as such).
--   • An approver needs authority for the document type and amount, a linked,
--     active login, and the permission to post that document.
--
-- Batch 1 document types: purchase_order (approve = mark sent), goods_receipt,
-- vendor_bill, debit_note, expense, vendor_payment (incl. post-dated cheques),
-- vendor_refund, vendor_credit_refund. Opening-balance documents and POS are
-- never routed through approval. Later batches add sales and the rest.
--
-- Tables are written only through the functions below (RLS on, no client
-- write policies); reads go through functions too, so amounts aren't exposed
-- to people who can't see the documents.
--
-- SAFE TO APPLY: new tables, functions and triggers; no existing row changes;
-- every rule starts OFF, so nothing behaves differently until an admin turns
-- one on. One transaction; re-running is safe. ROLLBACK: end of file.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Tables ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.approval_rules (
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  doc_type    text NOT NULL,
  enabled     boolean NOT NULL DEFAULT false,
  min_amount  numeric(18,2) NOT NULL DEFAULT 0 CHECK (min_amount >= 0),
  updated_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, doc_type)
);

CREATE TABLE IF NOT EXISTS public.approval_authorities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  doc_type    text NOT NULL,
  max_amount  numeric(18,2) CHECK (max_amount IS NULL OR max_amount >= 0),
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, employee_id, doc_type)
);
CREATE INDEX IF NOT EXISTS approval_authorities_employee_idx ON public.approval_authorities (employee_id);

CREATE TABLE IF NOT EXISTS public.approval_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  doc_type              text NOT NULL,
  doc_id                uuid NOT NULL,
  doc_number            text,
  amount_base           numeric(18,2) NOT NULL DEFAULT 0,
  currency              text,
  amount_doc            numeric(18,2),
  status                text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  submitted_by_user     uuid,
  submitted_by_employee uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  assignee_employee_id  uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  confirm_args          jsonb NOT NULL DEFAULT '{}'::jsonb,
  note                  text,
  decided_by_user       uuid,
  decided_at            timestamptz,
  -- clock time: "the latest request" must be unambiguous
  created_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.approval_requests ALTER COLUMN created_at SET DEFAULT clock_timestamp();
CREATE UNIQUE INDEX IF NOT EXISTS approval_requests_one_pending
  ON public.approval_requests (doc_type, doc_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS approval_requests_doc_idx      ON public.approval_requests (doc_id, created_at DESC);
CREATE INDEX IF NOT EXISTS approval_requests_assignee_idx ON public.approval_requests (assignee_employee_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS approval_requests_company_idx  ON public.approval_requests (company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS approval_requests_submitter_idx ON public.approval_requests (submitted_by_user, created_at DESC);

CREATE TABLE IF NOT EXISTS public.approval_steps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  request_id   uuid REFERENCES public.approval_requests(id) ON DELETE CASCADE,
  doc_type     text NOT NULL,
  doc_id       uuid NOT NULL,
  action       text NOT NULL CHECK (action IN ('submitted', 'passed_on', 'approved', 'override', 'forwarded',
                                               'rejected', 'cancelled', 'admin_reopen', 'admin_void')),
  by_user      uuid,
  by_employee  uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  to_employee  uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  amount_base  numeric(18,2),
  note         text,
  -- clock time, not transaction time: several steps can happen in one transaction
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.approval_steps ALTER COLUMN created_at SET DEFAULT clock_timestamp();
CREATE INDEX IF NOT EXISTS approval_steps_doc_idx     ON public.approval_steps (doc_id, created_at);
CREATE INDEX IF NOT EXISTS approval_steps_request_idx ON public.approval_steps (request_id);
CREATE INDEX IF NOT EXISTS approval_steps_by_idx      ON public.approval_steps (by_user, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_rules_doc_type_check') THEN
    ALTER TABLE public.approval_rules ADD CONSTRAINT approval_rules_doc_type_check CHECK (doc_type IN (
      'purchase_order', 'goods_receipt', 'vendor_bill', 'debit_note', 'expense',
      'vendor_payment', 'vendor_refund', 'vendor_credit_refund'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_authorities_doc_type_check') THEN
    ALTER TABLE public.approval_authorities ADD CONSTRAINT approval_authorities_doc_type_check CHECK (doc_type IN (
      '*', 'purchase_order', 'goods_receipt', 'vendor_bill', 'debit_note', 'expense',
      'vendor_payment', 'vendor_refund', 'vendor_credit_refund'));
  END IF;
END $$;

-- Reads and writes only through the functions below.
ALTER TABLE public.approval_rules       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_steps       ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.approval_rules, public.approval_authorities, public.approval_requests, public.approval_steps
  FROM anon, authenticated;

-- ── 2. Helpers ─────────────────────────────────────────────────────────────
-- Statuses that count as "confirmed" for each document type.
CREATE OR REPLACE FUNCTION public._approval_confirmed_states(p_doc_type text)
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE p_doc_type
    WHEN 'purchase_order' THEN ARRAY['sent', 'partially_received', 'received', 'closed']
    WHEN 'goods_receipt'  THEN ARRAY['received', 'billed']
    ELSE ARRAY['confirmed'] END;
$function$;

-- The permission needed to post a document type.
CREATE OR REPLACE FUNCTION public._approval_perm(p_doc_type text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $function$
  SELECT 'purchasing.write'::text;   -- batch 1: every type is a purchasing document
$function$;

-- has_perm() for any user of the company (the Terms check stays with has_perm,
-- which the approver passes at approval time).
CREATE OR REPLACE FUNCTION public._user_has_perm(p_user uuid, p_permission text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_role text; v_active boolean; v_company uuid; v_ovr text;
BEGIN
  SELECT role, is_active, company_id INTO v_role, v_active, v_company FROM public.profiles WHERE id = p_user;
  IF v_role IS NULL OR v_active IS NOT TRUE THEN RETURN false; END IF;
  IF v_role = 'admin' THEN RETURN true; END IF;
  IF p_permission LIKE 'payroll.%' THEN RETURN false; END IF;
  SELECT mode INTO v_ovr FROM public.user_permission_overrides WHERE user_id = p_user AND permission = p_permission;
  IF v_ovr = 'deny'  THEN RETURN false; END IF;
  IF v_ovr = 'allow' THEN RETURN true;  END IF;
  RETURN EXISTS (SELECT 1 FROM public.role_permissions
                  WHERE role = v_role AND permission = p_permission
                    AND (company_id IS NULL OR company_id = v_company));
END;
$function$;

-- Which approval document types a payment row can be (it shares the table
-- with customer receipts and refunds).
CREATE OR REPLACE FUNCTION public._approval_payment_types(p_type text, p_classification text, p_contact uuid)
RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_ct text;
BEGIN
  SELECT type INTO v_ct FROM public.contacts WHERE id = p_contact;
  IF v_ct = 'customer' THEN RETURN ARRAY[]::text[]; END IF;     -- customer side: a later batch
  IF p_type = 'outbound' THEN RETURN ARRAY['vendor_payment']; END IF;
  IF p_classification = 'advance'    THEN RETURN ARRAY['vendor_refund']; END IF;
  IF p_classification = 'on_account' THEN RETURN ARRAY['vendor_credit_refund']; END IF;
  RETURN ARRAY[]::text[];
END;
$function$;

-- One document, as approvals sees it.
CREATE OR REPLACE FUNCTION public._approval_doc(p_doc_type text, p_doc_id uuid)
RETURNS TABLE(company_id uuid, status text, doc_number text, amount_doc numeric, currency text,
              amount_base numeric, is_opening boolean, kinds text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE r record;
BEGIN
  CASE p_doc_type
  WHEN 'purchase_order' THEN
    SELECT d.company_id, d.status, d.po_number AS num, d.total_amount AS amt, d.currency AS cur,
           COALESCE(d.exchange_rate, 1) AS fx, false AS op, NULL::text[] AS kinds INTO r FROM public.purchase_orders d WHERE d.id = p_doc_id;
  WHEN 'goods_receipt' THEN
    SELECT g.company_id, g.status, g.grn_number AS num,
           COALESCE((SELECT sum(i.qty_received * i.unit_cost) FROM public.goods_receipt_items i WHERE i.grn_id = g.id), 0) AS amt,
           po.currency AS cur, COALESCE(po.exchange_rate, 1) AS fx, false AS op, NULL::text[] AS kinds
      INTO r FROM public.goods_receipts g LEFT JOIN public.purchase_orders po ON po.id = g.purchase_order_id
     WHERE g.id = p_doc_id;
  WHEN 'vendor_bill' THEN
    SELECT d.company_id, d.status, d.bill_number AS num, d.total_amount AS amt, d.currency AS cur,
           COALESCE(d.exchange_rate, 1) AS fx, COALESCE(d.is_opening, false) AS op, NULL::text[] AS kinds INTO r FROM public.vendor_bills d WHERE d.id = p_doc_id;
  WHEN 'debit_note' THEN
    SELECT d.company_id, d.status, d.debit_note_number AS num, d.total_amount AS amt, d.currency AS cur,
           COALESCE(d.exchange_rate, 1) AS fx, false AS op, NULL::text[] AS kinds INTO r FROM public.debit_notes d WHERE d.id = p_doc_id;
  WHEN 'expense' THEN
    SELECT d.company_id, d.status, d.expense_number AS num, d.total_amount AS amt, NULL::text AS cur,
           1::numeric AS fx, false AS op, NULL::text[] AS kinds INTO r FROM public.expenses d WHERE d.id = p_doc_id;
  WHEN 'vendor_payment', 'vendor_refund', 'vendor_credit_refund' THEN
    SELECT d.company_id, d.status, d.payment_number AS num, d.amount AS amt, d.currency AS cur,
           COALESCE(d.exchange_rate, 1) AS fx, COALESCE(d.is_opening, false) AS op,
           public._approval_payment_types(d.type, d.classification, d.contact_id) AS kinds
      INTO r FROM public.payments d WHERE d.id = p_doc_id;
  ELSE
    RAISE EXCEPTION 'Approvals don''t cover % documents yet.', p_doc_type USING ERRCODE = 'P0001';
  END CASE;
  IF NOT FOUND THEN RETURN; END IF;
  company_id  := r.company_id;
  status      := r.status;
  doc_number  := r.num;
  amount_doc  := round(COALESCE(r.amt, 0), 2);
  currency    := r.cur;
  amount_base := round(COALESCE(r.amt, 0) * COALESCE(r.fx, 1), 2);
  is_opening  := r.op;
  kinds       := CASE WHEN p_doc_type IN ('vendor_payment', 'vendor_refund', 'vendor_credit_refund')
                      THEN r.kinds ELSE ARRAY[p_doc_type] END;
  RETURN NEXT;
END;
$function$;

-- Does an enabled rule apply to this amount?
CREATE OR REPLACE FUNCTION public._approval_rule_applies(p_company uuid, p_doc_types text[], p_amount numeric)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.approval_rules
                  WHERE company_id = p_company AND doc_type = ANY (p_doc_types)
                    AND enabled AND COALESCE(p_amount, 0) >= min_amount);
$function$;

-- The approved state of a document: its latest request was approved.
CREATE OR REPLACE FUNCTION public._approval_is_approved(p_doc_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT status = 'approved' FROM public.approval_requests
                    WHERE doc_id = p_doc_id ORDER BY created_at DESC, decided_at DESC NULLS FIRST LIMIT 1), false);
$function$;

-- The approval in progress (set only by approve_request for its own document).
CREATE OR REPLACE FUNCTION public._approval_in_flight(p_doc_id uuid)
RETURNS boolean
LANGUAGE sql VOLATILE
AS $function$
  SELECT COALESCE(current_setting('stockbolt.approval_doc', true), '') = p_doc_id::text;
$function$;

-- Can this employee approve this document type for this amount (and post it)?
-- Returns NULL when they can, otherwise the reason.
CREATE OR REPLACE FUNCTION public._approver_problem(p_employee uuid, p_doc_type text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE e record;
BEGIN
  SELECT em.id, em.is_active, em.user_id, p.is_active AS login_active
    INTO e FROM public.employees em LEFT JOIN public.profiles p ON p.id = em.user_id
   WHERE em.id = p_employee;
  IF e.id IS NULL OR NOT e.is_active THEN RETURN 'inactive'; END IF;
  IF e.user_id IS NULL THEN RETURN 'no_login'; END IF;
  IF e.login_active IS NOT TRUE THEN RETURN 'login_disabled'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.approval_authorities a
                  WHERE a.employee_id = p_employee AND a.doc_type IN (p_doc_type, '*')) THEN
    RETURN 'no_authority';
  END IF;
  IF NOT public._user_has_perm(e.user_id, public._approval_perm(p_doc_type)) THEN RETURN 'no_permission'; END IF;
  RETURN NULL;
END;
$function$;

-- The highest amount an employee may approve for a type (NULL = no limit).
-- A row for the specific type wins over the '*' (every type) row, so "Manager:
-- everything, but expenses only up to 50" means exactly that. Callers check
-- _approver_problem first: no authority at all is not "no limit".
CREATE OR REPLACE FUNCTION public._approver_limit(p_employee uuid, p_doc_type text)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT max_amount FROM public.approval_authorities
   WHERE employee_id = p_employee AND doc_type IN (p_doc_type, '*')
   ORDER BY (doc_type = '*'), max_amount DESC NULLS FIRST
   LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public._my_employee()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT id FROM public.employees WHERE user_id = auth.uid() AND company_id = public.current_user_company_id();
$function$;

CREATE OR REPLACE FUNCTION public._approval_guard_company()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_company uuid := public.current_user_company_id();
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  RETURN v_company;
END;
$function$;

CREATE OR REPLACE FUNCTION public._approval_step(p_req public.approval_requests, p_action text,
                                                 p_to uuid, p_note text)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  INSERT INTO public.approval_steps (company_id, request_id, doc_type, doc_id, action, by_user, by_employee,
                                     to_employee, amount_base, note)
  VALUES (p_req.company_id, p_req.id, p_req.doc_type, p_req.doc_id, p_action, auth.uid(),
          public._my_employee(), p_to, p_req.amount_base, NULLIF(btrim(p_note), ''));
$function$;

-- ── 3. Guards on the documents ─────────────────────────────────────────────
-- TG_ARGV[0] = document type, or 'payment' (resolved per row).
CREATE OR REPLACE FUNCTION public.tg_approval_doc_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row     jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  v_old     jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  v_id      uuid  := (v_row->>'id')::uuid;
  v_type    text  := TG_ARGV[0];
  v_kinds   text[];
  v_states  text[];
  v_info    record;
  v_admin   boolean;
  v_reason  text;
BEGIN
  IF public._approval_in_flight(v_id) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF COALESCE((v_row->>'is_opening')::boolean, false) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  -- Waiting for approval: frozen.
  IF EXISTS (SELECT 1 FROM public.approval_requests WHERE doc_id = v_id AND status = 'pending') THEN
    RAISE EXCEPTION 'This document is waiting for approval and can''t be changed. Cancel the request first to edit it.'
      USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP <> 'UPDATE' THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF;

  IF v_type = 'payment' THEN
    v_kinds := public._approval_payment_types(NEW.type, NEW.classification, NEW.contact_id);
    IF cardinality(v_kinds) = 0 THEN RETURN NEW; END IF;
    v_states := ARRAY['confirmed'];
  ELSE
    v_kinds  := ARRAY[v_type];
    v_states := public._approval_confirmed_states(v_type);
  END IF;

  -- Confirming: needs approval when a rule applies.
  IF (v_old->>'status') = 'draft' AND (v_row->>'status') = ANY (v_states) THEN
    SELECT * INTO v_info FROM public._approval_doc(v_kinds[1], v_id);
    IF public._approval_rule_applies(NEW.company_id, v_kinds, v_info.amount_base) THEN
      RAISE EXCEPTION 'This document needs approval before it is confirmed. Use Submit for approval.'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  -- An approved, confirmed document: void / reopen and edits are admin-only.
  IF (v_old->>'status') = ANY (v_states) AND public._approval_is_approved(v_id) THEN
    v_admin := public.has_perm('users.manage');
    IF (v_row->>'status') IN ('draft', 'void') THEN
      IF NOT v_admin THEN
        RAISE EXCEPTION 'This document was approved. Only an admin can void it or reopen it for editing.'
          USING ERRCODE = '42501';
      END IF;
      v_reason := COALESCE(v_row->>'void_reason', NULL);
      INSERT INTO public.approval_steps (company_id, request_id, doc_type, doc_id, action, by_user, by_employee, note)
      SELECT r.company_id, r.id, r.doc_type, r.doc_id,
             CASE WHEN (v_row->>'status') = 'void' THEN 'admin_void' ELSE 'admin_reopen' END,
             auth.uid(), public._my_employee(), v_reason
        FROM public.approval_requests r WHERE r.doc_id = v_id ORDER BY r.created_at DESC, r.decided_at DESC NULLS FIRST LIMIT 1;
      RETURN NEW;
    END IF;
    -- A purchase order stays editable after it is sent; once approved, only an admin edits it.
    IF v_type = 'purchase_order' AND NOT v_admin
       AND (v_row - 'status' - 'updated_at') IS DISTINCT FROM (v_old - 'status' - 'updated_at') THEN
      RAISE EXCEPTION 'This purchase order was approved. Only an admin can change it.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Lines: TG_ARGV[0] = the column holding the document id, TG_ARGV[1] = document type.
CREATE OR REPLACE FUNCTION public.tg_approval_lines_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_doc uuid := (to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END) ->> TG_ARGV[0])::uuid;
  v_po_status text;
BEGIN
  IF v_doc IS NULL OR public._approval_in_flight(v_doc) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF EXISTS (SELECT 1 FROM public.approval_requests WHERE doc_id = v_doc AND status = 'pending') THEN
    RAISE EXCEPTION 'This document is waiting for approval and can''t be changed. Cancel the request first to edit it.'
      USING ERRCODE = 'P0001';
  END IF;
  IF TG_ARGV[1] = 'purchase_order' THEN
    SELECT status INTO v_po_status FROM public.purchase_orders WHERE id = v_doc;
    IF v_po_status IS DISTINCT FROM 'draft' AND public._approval_is_approved(v_doc)
       AND NOT public.has_perm('users.manage') THEN
      RAISE EXCEPTION 'This purchase order was approved. Only an admin can change it.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
      ('purchase_orders', 'purchase_order'), ('goods_receipts', 'goods_receipt'),
      ('vendor_bills', 'vendor_bill'), ('debit_notes', 'debit_note'),
      ('expenses', 'expense'), ('payments', 'payment')) AS v(tbl, kind)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t.tbl || '_approval_guard', t.tbl);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW '
                   'EXECUTE FUNCTION public.tg_approval_doc_guard(%L)', t.tbl || '_approval_guard', t.tbl, t.kind);
  END LOOP;
  FOR t IN SELECT * FROM (VALUES
      ('purchase_order_items', 'po_id', 'purchase_order'), ('goods_receipt_items', 'grn_id', 'goods_receipt'),
      ('vendor_bill_items', 'bill_id', 'vendor_bill'), ('vendor_bill_landed_costs', 'bill_id', 'vendor_bill'),
      ('debit_note_items', 'debit_note_id', 'debit_note'), ('expense_items', 'expense_id', 'expense'),
      ('payment_allocations', 'payment_id', 'payment')) AS v(tbl, col, kind)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t.tbl || '_approval_guard', t.tbl);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW '
                   'EXECUTE FUNCTION public.tg_approval_lines_guard(%L, %L)', t.tbl || '_approval_guard', t.tbl, t.col, t.kind);
  END LOOP;
END $$;

-- ── 4. Confirm, the existing way ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._approval_confirm(p_req public.approval_requests)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM set_config('stockbolt.approval_doc', p_req.doc_id::text, true);
  CASE p_req.doc_type
  WHEN 'purchase_order' THEN
    UPDATE public.purchase_orders SET status = 'sent', updated_at = now()
     WHERE id = p_req.doc_id AND status = 'draft';
    IF NOT FOUND THEN RAISE EXCEPTION 'The purchase order is no longer a draft.' USING ERRCODE = 'P0001'; END IF;
  WHEN 'goods_receipt' THEN PERFORM public.confirm_grn(p_req.doc_id);
  WHEN 'vendor_bill'   THEN PERFORM public.confirm_vendor_bill(p_req.doc_id);
  WHEN 'debit_note'    THEN PERFORM public.confirm_debit_note(p_req.doc_id);
  WHEN 'expense'       THEN PERFORM public.confirm_expense(p_req.doc_id);
  WHEN 'vendor_payment' THEN
    IF COALESCE(p_req.confirm_args->>'cheque_number', '') <> '' THEN
      PERFORM public.confirm_pdc_vendor_payment(p_req.doc_id, p_req.confirm_args->>'cheque_number',
        p_req.confirm_args->>'bank_name', (p_req.confirm_args->>'due_date')::date);
    ELSE
      PERFORM public.confirm_vendor_payment(p_req.doc_id);
    END IF;
  WHEN 'vendor_refund'        THEN PERFORM public.confirm_vendor_refund(p_req.doc_id);
  WHEN 'vendor_credit_refund' THEN PERFORM public.confirm_vendor_credit_refund(p_req.doc_id);
  END CASE;
  PERFORM set_config('stockbolt.approval_doc', '', true);
END;
$function$;

-- ── 5. Settings (admin) ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approval_config()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_company uuid := public._approval_guard_company();
BEGIN
  RETURN jsonb_build_object(
    'rules', COALESCE((SELECT jsonb_agg(jsonb_build_object('doc_type', doc_type, 'enabled', enabled, 'min_amount', min_amount))
                         FROM public.approval_rules WHERE company_id = v_company), '[]'::jsonb),
    'authorities', CASE WHEN public.has_perm('users.manage') THEN COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', a.id, 'employee_id', a.employee_id, 'code', e.code, 'name', e.name,
                 'designation', e.designation, 'doc_type', a.doc_type, 'max_amount', a.max_amount,
                 'problem', public._approver_problem(a.employee_id, CASE WHEN a.doc_type = '*' THEN 'vendor_bill' ELSE a.doc_type END))
                 ORDER BY e.code, a.doc_type)
          FROM public.approval_authorities a JOIN public.employees e ON e.id = a.employee_id
         WHERE a.company_id = v_company), '[]'::jsonb) ELSE '[]'::jsonb END);
END;
$function$;

-- The default chain: the top person and every manager with a login may approve
-- everything (no limit). Only when the company has no authority yet.
CREATE OR REPLACE FUNCTION public._approval_seed_defaults(p_company uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.approval_authorities WHERE company_id = p_company) THEN RETURN; END IF;
  INSERT INTO public.approval_authorities (company_id, employee_id, doc_type, max_amount, created_by)
  SELECT p_company, e.id, '*', NULL, auth.uid()
    FROM public.employees e
   WHERE e.company_id = p_company AND e.is_active
     AND (e.reports_to_id IS NULL
          OR (e.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.employees x
                                                 WHERE x.reports_to_id = e.id AND x.is_active)))
  ON CONFLICT DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_approval_rule(p_doc_type text, p_enabled boolean, p_min_amount numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_company uuid := public._approval_guard_company();
BEGIN
  IF NOT public.has_perm('users.manage') THEN
    RAISE EXCEPTION 'forbidden: only an admin can change approval rules' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_min_amount, 0) < 0 THEN
    RAISE EXCEPTION 'The amount can''t be negative.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.approval_rules (company_id, doc_type, enabled, min_amount, updated_by)
  VALUES (v_company, p_doc_type, COALESCE(p_enabled, false), COALESCE(p_min_amount, 0), auth.uid())
  ON CONFLICT (company_id, doc_type) DO UPDATE
    SET enabled = EXCLUDED.enabled, min_amount = EXCLUDED.min_amount,
        updated_by = auth.uid(), updated_at = now();
  IF p_enabled THEN PERFORM public._approval_seed_defaults(v_company); END IF;
  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
  VALUES (v_company, auth.uid(), 'update', 'approval_rule', NULL,
          jsonb_build_object('doc_type', p_doc_type, 'enabled', p_enabled, 'min_amount', p_min_amount, 'phase', 'phase145'));
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_approval_authority(p_employee_id uuid, p_doc_type text, p_max_amount numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_company uuid := public._approval_guard_company();
BEGIN
  IF NOT public.has_perm('users.manage') THEN
    RAISE EXCEPTION 'forbidden: only an admin can change approval authority' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_employee_id AND company_id = v_company) THEN
    RAISE EXCEPTION 'Employee not found.' USING ERRCODE = 'P0002';
  END IF;
  IF p_max_amount IS NOT NULL AND p_max_amount < 0 THEN
    RAISE EXCEPTION 'The limit can''t be negative.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.approval_authorities (company_id, employee_id, doc_type, max_amount, created_by)
  VALUES (v_company, p_employee_id, p_doc_type, p_max_amount, auth.uid())
  ON CONFLICT (company_id, employee_id, doc_type) DO UPDATE
    SET max_amount = EXCLUDED.max_amount, updated_at = now();
  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
  VALUES (v_company, auth.uid(), 'update', 'approval_authority', p_employee_id,
          jsonb_build_object('doc_type', p_doc_type, 'max_amount', p_max_amount, 'phase', 'phase145'));
END;
$function$;

CREATE OR REPLACE FUNCTION public.remove_approval_authority(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_company uuid := public._approval_guard_company(); v_row public.approval_authorities;
BEGIN
  IF NOT public.has_perm('users.manage') THEN
    RAISE EXCEPTION 'forbidden: only an admin can change approval authority' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.approval_authorities WHERE id = p_id AND company_id = v_company RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Not found.' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, old_data)
  VALUES (v_company, auth.uid(), 'delete', 'approval_authority', v_row.employee_id,
          jsonb_build_object('doc_type', v_row.doc_type, 'max_amount', v_row.max_amount, 'phase', 'phase145'));
END;
$function$;

-- ── 6. People who can approve a document type (for "Send to") ─────────────
CREATE OR REPLACE FUNCTION public.list_approvers(p_doc_type text)
RETURNS TABLE(employee_id uuid, code text, name text, designation text, max_amount numeric,
              problem text, is_default boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid := public._approval_guard_company();
  v_me      uuid := public._my_employee();
  v_default uuid;
  v_cur     uuid;
  v_steps   int := 0;
BEGIN
  IF NOT public.has_perm(public._approval_perm(p_doc_type)) THEN
    RAISE EXCEPTION 'forbidden: you can''t submit % documents', p_doc_type USING ERRCODE = '42501';
  END IF;
  -- Default: the nearest manager up the chain who can approve.
  SELECT reports_to_id INTO v_cur FROM public.employees WHERE id = v_me;
  IF v_me IS NULL THEN
    SELECT id INTO v_cur FROM public.employees WHERE company_id = v_company AND reports_to_id IS NULL;
  END IF;
  WHILE v_cur IS NOT NULL AND v_default IS NULL AND v_steps < 100 LOOP
    IF public._approver_problem(v_cur, p_doc_type) IS NULL THEN v_default := v_cur; END IF;
    SELECT reports_to_id INTO v_cur FROM public.employees WHERE id = v_cur;
    v_steps := v_steps + 1;
  END LOOP;
  RETURN QUERY
    SELECT e.id, e.code, e.name, e.designation, public._approver_limit(e.id, p_doc_type),
           public._approver_problem(e.id, p_doc_type), e.id = v_default
      FROM public.employees e
     WHERE e.company_id = v_company AND e.is_active AND e.id IS DISTINCT FROM v_me
       AND EXISTS (SELECT 1 FROM public.approval_authorities a
                    WHERE a.employee_id = e.id AND a.doc_type IN (p_doc_type, '*'))
     ORDER BY (e.id = v_default) DESC, e.code;
END;
$function$;

-- ── 7. The workflow ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_for_approval(p_doc_type text, p_doc_id uuid, p_assignee uuid,
                                                      p_note text DEFAULT NULL, p_confirm_args jsonb DEFAULT '{}'::jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid := public._approval_guard_company();
  v_me      uuid := public._my_employee();
  v_doc     record;
  v_problem text;
  v_req     public.approval_requests;
BEGIN
  IF NOT public.has_perm(public._approval_perm(p_doc_type)) THEN
    RAISE EXCEPTION 'forbidden: you can''t submit % documents', p_doc_type USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_doc FROM public._approval_doc(p_doc_type, p_doc_id);
  IF NOT FOUND OR v_doc.company_id IS DISTINCT FROM v_company THEN
    RAISE EXCEPTION 'Document not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (p_doc_type = ANY (v_doc.kinds)) THEN
    RAISE EXCEPTION 'This document isn''t a % .', p_doc_type USING ERRCODE = 'P0001';
  END IF;
  IF v_doc.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft can be submitted for approval.' USING ERRCODE = 'P0001';
  END IF;
  IF v_doc.is_opening THEN
    RAISE EXCEPTION 'Opening balances don''t go through approval.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._approval_rule_applies(v_company, ARRAY[p_doc_type], v_doc.amount_base) THEN
    RAISE EXCEPTION 'This document doesn''t need approval — confirm it directly.' USING ERRCODE = 'P0001';
  END IF;
  IF p_assignee IS NULL OR p_assignee IS NOT DISTINCT FROM v_me THEN
    RAISE EXCEPTION 'Choose someone else to approve it.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_assignee AND company_id = v_company) THEN
    RAISE EXCEPTION 'Approver not found.' USING ERRCODE = 'P0002';
  END IF;
  v_problem := public._approver_problem(p_assignee, p_doc_type);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'That person can''t approve this document (%).', v_problem USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    INSERT INTO public.approval_requests (company_id, doc_type, doc_id, doc_number, amount_base, currency, amount_doc,
                                          submitted_by_user, submitted_by_employee, assignee_employee_id, confirm_args, note)
    VALUES (v_company, p_doc_type, p_doc_id, v_doc.doc_number, v_doc.amount_base, v_doc.currency, v_doc.amount_doc,
            auth.uid(), v_me, p_assignee, COALESCE(p_confirm_args, '{}'::jsonb), NULLIF(btrim(p_note), ''))
    RETURNING * INTO v_req;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'This document is already waiting for approval.' USING ERRCODE = 'P0001';
  END;
  PERFORM public._approval_step(v_req, 'submitted', p_assignee, p_note);
  RETURN v_req.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public._approval_load(p_request_id uuid, p_company uuid)
RETURNS public.approval_requests
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_req public.approval_requests;
BEGIN
  SELECT * INTO v_req FROM public.approval_requests WHERE id = p_request_id AND company_id = p_company FOR UPDATE;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'Approval request not found.' USING ERRCODE = 'P0002'; END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'This request was already %.', v_req.status USING ERRCODE = 'P0001';
  END IF;
  RETURN v_req;
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_request(p_request_id uuid, p_next uuid DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company  uuid := public._approval_guard_company();
  v_me       uuid := public._my_employee();
  v_req      public.approval_requests;
  v_admin    boolean := public.has_perm('users.manage');
  v_assigned boolean;
  v_limit    numeric;
  v_doc      record;
  v_next     uuid;
  v_cur      uuid;
  v_steps    int := 0;
BEGIN
  v_req := public._approval_load(p_request_id, v_company);
  v_assigned := v_me IS NOT NULL AND v_me = v_req.assignee_employee_id;
  IF NOT v_assigned AND NOT v_admin THEN
    RAISE EXCEPTION 'forbidden: this request is waiting for someone else' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_perm(public._approval_perm(v_req.doc_type)) THEN
    RAISE EXCEPTION 'forbidden: you don''t have permission to post this document' USING ERRCODE = '42501';
  END IF;
  -- Authority may have been removed since the request reached this person.
  IF v_assigned AND NOT v_admin AND public._approver_problem(v_me, v_req.doc_type) IS NOT NULL THEN
    RAISE EXCEPTION 'You can no longer approve % documents. Forward it or ask an admin.', v_req.doc_type USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_doc FROM public._approval_doc(v_req.doc_type, v_req.doc_id);
  IF NOT FOUND OR v_doc.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'The document is no longer a draft.' USING ERRCODE = 'P0001';
  END IF;

  v_limit := CASE WHEN v_assigned THEN public._approver_limit(v_me, v_req.doc_type) END;
  IF v_admin OR (v_assigned AND (v_limit IS NULL OR v_doc.amount_base <= v_limit)) THEN
    -- Final approval = confirm, in this transaction. If confirming fails, nothing is kept.
    PERFORM public._approval_confirm(v_req);
    UPDATE public.approval_requests
       SET status = 'approved', decided_by_user = auth.uid(), decided_at = now(), updated_at = now(),
           amount_base = v_doc.amount_base
     WHERE id = v_req.id
     RETURNING * INTO v_req;
    PERFORM public._approval_step(v_req, CASE WHEN v_assigned THEN 'approved' ELSE 'override' END, NULL, p_note);
    RETURN jsonb_build_object('status', 'approved');
  END IF;

  -- Above this approver's limit: approve their part and pass it on.
  v_next := p_next;
  IF v_next IS NULL THEN
    SELECT reports_to_id INTO v_cur FROM public.employees WHERE id = v_me;
    WHILE v_cur IS NOT NULL AND v_next IS NULL AND v_steps < 100 LOOP
      IF public._approver_problem(v_cur, v_req.doc_type) IS NULL
         AND v_cur IS DISTINCT FROM v_req.submitted_by_employee THEN
        v_next := v_cur;
      END IF;
      SELECT reports_to_id INTO v_cur FROM public.employees WHERE id = v_cur;
      v_steps := v_steps + 1;
    END LOOP;
  END IF;
  IF v_next IS NULL THEN
    RAISE EXCEPTION 'The amount is above your limit and there is no one above you who can approve it. Ask an admin.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_next = v_me OR v_next IS NOT DISTINCT FROM v_req.submitted_by_employee
     OR NOT EXISTS (SELECT 1 FROM public.employees WHERE id = v_next AND company_id = v_company)
     OR public._approver_problem(v_next, v_req.doc_type) IS NOT NULL THEN
    RAISE EXCEPTION 'That person can''t take this approval.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.approval_requests SET assignee_employee_id = v_next, updated_at = now()
   WHERE id = v_req.id RETURNING * INTO v_req;
  PERFORM public._approval_step(v_req, 'passed_on', v_next, p_note);
  RETURN jsonb_build_object('status', 'pending', 'next_employee_id', v_next);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reject_request(p_request_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid := public._approval_guard_company();
  v_me      uuid := public._my_employee();
  v_req     public.approval_requests;
BEGIN
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Give a reason for rejecting.' USING ERRCODE = 'P0001';
  END IF;
  v_req := public._approval_load(p_request_id, v_company);
  IF NOT (v_me IS NOT NULL AND v_me = v_req.assignee_employee_id) AND NOT public.has_perm('users.manage') THEN
    RAISE EXCEPTION 'forbidden: this request is waiting for someone else' USING ERRCODE = '42501';
  END IF;
  UPDATE public.approval_requests SET status = 'rejected', decided_by_user = auth.uid(), decided_at = now(), updated_at = now()
   WHERE id = v_req.id RETURNING * INTO v_req;
  PERFORM public._approval_step(v_req, 'rejected', NULL, p_reason);
END;
$function$;

CREATE OR REPLACE FUNCTION public.forward_request(p_request_id uuid, p_to uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid := public._approval_guard_company();
  v_me      uuid := public._my_employee();
  v_req     public.approval_requests;
  v_problem text;
BEGIN
  v_req := public._approval_load(p_request_id, v_company);
  IF NOT (v_me IS NOT NULL AND v_me = v_req.assignee_employee_id) AND NOT public.has_perm('users.manage') THEN
    RAISE EXCEPTION 'forbidden: this request is waiting for someone else' USING ERRCODE = '42501';
  END IF;
  IF p_to IS NULL OR p_to = v_req.assignee_employee_id OR p_to IS NOT DISTINCT FROM v_req.submitted_by_employee
     OR NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_to AND company_id = v_company) THEN
    RAISE EXCEPTION 'Choose someone else to forward it to.' USING ERRCODE = 'P0001';
  END IF;
  v_problem := public._approver_problem(p_to, v_req.doc_type);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'That person can''t approve this document (%).', v_problem USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.approval_requests SET assignee_employee_id = p_to, updated_at = now()
   WHERE id = v_req.id RETURNING * INTO v_req;
  PERFORM public._approval_step(v_req, 'forwarded', p_to, p_note);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_approval_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid := public._approval_guard_company();
  v_req     public.approval_requests;
BEGIN
  v_req := public._approval_load(p_request_id, v_company);
  IF v_req.submitted_by_user IS DISTINCT FROM auth.uid() AND NOT public.has_perm('users.manage') THEN
    RAISE EXCEPTION 'forbidden: only the person who sent it, or an admin, can cancel it' USING ERRCODE = '42501';
  END IF;
  UPDATE public.approval_requests SET status = 'cancelled', decided_by_user = auth.uid(), decided_at = now(), updated_at = now()
   WHERE id = v_req.id RETURNING * INTO v_req;
  PERFORM public._approval_step(v_req, 'cancelled', NULL, NULL);
END;
$function$;

-- ── 8. Reading ─────────────────────────────────────────────────────────────
-- What an editor needs for one document.
CREATE OR REPLACE FUNCTION public.doc_approval_state(p_doc_type text, p_doc_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid := public._approval_guard_company();
  v_me      uuid := public._my_employee();
  v_rule    public.approval_rules;
  v_req     public.approval_requests;
  v_doc     record;
BEGIN
  SELECT * INTO v_rule FROM public.approval_rules WHERE company_id = v_company AND doc_type = p_doc_type;
  IF p_doc_id IS NOT NULL THEN
    SELECT * INTO v_doc FROM public._approval_doc(p_doc_type, p_doc_id);
    IF NOT FOUND OR v_doc.company_id IS DISTINCT FROM v_company THEN
      RAISE EXCEPTION 'Document not found.' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_req FROM public.approval_requests WHERE doc_id = p_doc_id
     ORDER BY created_at DESC, decided_at DESC NULLS FIRST LIMIT 1;
  END IF;
  RETURN jsonb_build_object(
    'rule_enabled', COALESCE(v_rule.enabled, false),
    'min_amount', COALESCE(v_rule.min_amount, 0),
    'is_admin', public.has_perm('users.manage'),
    'my_employee_id', v_me,
    'request', CASE WHEN v_req.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', v_req.id, 'status', v_req.status, 'amount_base', v_req.amount_base,
        'assignee_employee_id', v_req.assignee_employee_id,
        'assignee', (SELECT code || ' · ' || name FROM public.employees WHERE id = v_req.assignee_employee_id),
        'submitted_by', COALESCE((SELECT code || ' · ' || name FROM public.employees WHERE id = v_req.submitted_by_employee),
                                 (SELECT COALESCE(full_name, email) FROM public.profiles WHERE id = v_req.submitted_by_user)),
        'submitted_by_me', v_req.submitted_by_user = auth.uid(),
        'can_act', v_req.status = 'pending' AND (v_me = v_req.assignee_employee_id OR public.has_perm('users.manage')),
        'assigned_to_me', v_req.status = 'pending' AND v_me IS NOT NULL AND v_me = v_req.assignee_employee_id,
        'decided_by', (SELECT COALESCE(full_name, email) FROM public.profiles WHERE id = v_req.decided_by_user),
        'decided_at', v_req.decided_at, 'created_at', v_req.created_at,
        'reason', (SELECT s.note FROM public.approval_steps s WHERE s.request_id = v_req.id
                     AND s.action = 'rejected' ORDER BY s.created_at DESC LIMIT 1)) END);
END;
$function$;

-- The history of one document (Activity panel).
CREATE OR REPLACE FUNCTION public.doc_approval_steps(p_doc_id uuid)
RETURNS TABLE(action text, created_at timestamptz, by_user uuid, by_name text, to_name text, note text, amount_base numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_company uuid := public._approval_guard_company();
BEGIN
  RETURN QUERY
    SELECT s.action, s.created_at, s.by_user,
           COALESCE((SELECT e.code || ' · ' || e.name FROM public.employees e WHERE e.id = s.by_employee),
                    (SELECT COALESCE(p.full_name, p.email) FROM public.profiles p WHERE p.id = s.by_user)),
           (SELECT e.code || ' · ' || e.name FROM public.employees e WHERE e.id = s.to_employee),
           s.note, s.amount_base
      FROM public.approval_steps s
     WHERE s.doc_id = p_doc_id AND s.company_id = v_company
     ORDER BY s.created_at;
END;
$function$;

-- The Approvals inbox: 'waiting' (for me; admins may ask for all), 'mine'
-- (requests I sent), 'history' (decided, involving me; admins see all).
CREATE OR REPLACE FUNCTION public.list_approval_requests(p_scope text, p_all boolean DEFAULT false, p_limit integer DEFAULT 100)
RETURNS TABLE(id uuid, doc_type text, doc_id uuid, doc_number text, amount_base numeric, currency text, amount_doc numeric,
              status text, submitted_by text, assignee text, assignee_employee_id uuid, created_at timestamptz,
              decided_at timestamptz, note text, can_act boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid := public._approval_guard_company();
  v_me      uuid := public._my_employee();
  v_admin   boolean := public.has_perm('users.manage');
BEGIN
  RETURN QUERY
    SELECT r.id, r.doc_type, r.doc_id, r.doc_number, r.amount_base, r.currency, r.amount_doc, r.status,
           COALESCE((SELECT e.code || ' · ' || e.name FROM public.employees e WHERE e.id = r.submitted_by_employee),
                    (SELECT COALESCE(p.full_name, p.email) FROM public.profiles p WHERE p.id = r.submitted_by_user)),
           (SELECT e.code || ' · ' || e.name FROM public.employees e WHERE e.id = r.assignee_employee_id),
           r.assignee_employee_id, r.created_at, r.decided_at, r.note,
           r.status = 'pending' AND (r.assignee_employee_id = v_me OR v_admin)
      FROM public.approval_requests r
     WHERE r.company_id = v_company
       AND CASE p_scope
             WHEN 'waiting' THEN r.status = 'pending' AND ((v_me IS NOT NULL AND r.assignee_employee_id = v_me) OR (p_all AND v_admin))
             WHEN 'mine'    THEN r.submitted_by_user = auth.uid()
             WHEN 'history' THEN r.status <> 'pending' AND (v_admin OR r.submitted_by_user = auth.uid()
                                  OR EXISTS (SELECT 1 FROM public.approval_steps s WHERE s.request_id = r.id AND s.by_user = auth.uid()))
             ELSE false END
     ORDER BY r.created_at DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
END;
$function$;

-- ── 9. Grants ──────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._approval_confirmed_states(text)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._approval_perm(text)                           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._user_has_perm(uuid, text)                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._approval_payment_types(text, text, uuid)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._approval_doc(text, uuid)                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._approval_rule_applies(uuid, text[], numeric)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._approval_is_approved(uuid)                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._approval_in_flight(uuid)                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._approver_problem(uuid, text)                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._approver_limit(uuid, text)                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._my_employee()                                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._approval_guard_company()                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._approval_step(public.approval_requests, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_approval_doc_guard()                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_approval_lines_guard()                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._approval_confirm(public.approval_requests)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._approval_seed_defaults(uuid)                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._approval_load(uuid, uuid)                     FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.approval_config()                                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_approval_rule(text, boolean, numeric)           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_approval_authority(uuid, text, numeric)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_approval_authority(uuid)                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_approvers(text)                                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_for_approval(text, uuid, uuid, text, jsonb)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_request(uuid, uuid, text)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_request(uuid, text)                           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.forward_request(uuid, uuid, text)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_approval_request(uuid)                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.doc_approval_state(text, uuid)                       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.doc_approval_steps(uuid)                             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_approval_requests(text, boolean, integer)       FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approval_config()                                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_approval_rule(text, boolean, numeric)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_approval_authority(uuid, text, numeric)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_approval_authority(uuid)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_approvers(text)                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_for_approval(text, uuid, uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_request(uuid, uuid, text)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_request(uuid, text)                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.forward_request(uuid, uuid, text)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_approval_request(uuid)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.doc_approval_state(text, uuid)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.doc_approval_steps(uuid)                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_approval_requests(text, boolean, integer)    TO authenticated;

COMMIT;

-- ── Verify after applying (read-only) — expect: tables = 4, guarded_tables = 13,
--    rules_on = 0 (every rule starts OFF) ───────────────────────────────────────
-- SELECT
--   (SELECT count(*) FROM pg_tables WHERE schemaname = 'public'
--      AND tablename IN ('approval_rules','approval_authorities','approval_requests','approval_steps')) AS tables,
--   (SELECT count(DISTINCT tgrelid) FROM pg_trigger WHERE tgname LIKE '%\_approval\_guard' AND NOT tgisinternal) AS guarded_tables,
--   (SELECT count(*) FROM public.approval_rules WHERE enabled) AS rules_on;

-- ── ROLLBACK ───────────────────────────────────────────────────────────────
-- BEGIN;
-- DO $$ DECLARE t text; BEGIN
--   FOREACH t IN ARRAY ARRAY['purchase_orders','goods_receipts','vendor_bills','debit_notes','expenses','payments',
--     'purchase_order_items','goods_receipt_items','vendor_bill_items','vendor_bill_landed_costs','debit_note_items',
--     'expense_items','payment_allocations'] LOOP
--     EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_approval_guard', t);
--   END LOOP; END $$;
-- DROP TABLE IF EXISTS public.approval_steps, public.approval_requests, public.approval_authorities, public.approval_rules;
-- DROP FUNCTION IF EXISTS public.tg_approval_doc_guard(), public.tg_approval_lines_guard(), public._approval_confirm(public.approval_requests);
-- -- (the remaining phase145 functions can be dropped the same way; none is used by anything else)
-- COMMIT;
