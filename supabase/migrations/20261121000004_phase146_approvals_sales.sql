-- ═══════════════════════════════════════════════════════════════════════════
-- phase146 — Approvals, batch 2: sales documents
--
-- Extends the phase145 engine (apply after phase145) to:
--   sales_quote             approve = mark "sent" (approved, can go to the
--                           customer and be invoiced). A quote that needs
--                           approval can't become an invoice before it.
--   invoice                 approve = confirm_invoice
--   credit_note             approve = confirm_credit_note
--   customer_receipt        approve = confirm_payment, or confirm_pdc_payment
--                           with the cheque details captured at submit
--   customer_refund         approve = confirm_customer_refund   (advance)
--   customer_credit_refund  approve = confirm_customer_credit_refund
--
-- Never routed through approval: counter sales (POS invoices are written
-- confirmed by confirm_pos_sale and carry pos_session_id) and opening balances.
-- After approval a quote can still be invoiced by staff (status and invoiced
-- amount move on); its content can only be changed by an admin, like a PO.
-- A confirmed invoice is edited in place (edit_invoice reposts it), so an
-- approved invoice's header and lines are admin-only too.
--
-- Same rules as phase145: every rule starts OFF; no posting function edited;
-- approve calls the existing confirm in the same transaction. Only the
-- functions listed below are replaced, each with the same signature.
-- SAFE TO APPLY: one transaction, re-runnable. ROLLBACK: end of file.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The new document types ─────────────────────────────────────────────
ALTER TABLE public.approval_rules DROP CONSTRAINT IF EXISTS approval_rules_doc_type_check;
ALTER TABLE public.approval_rules ADD CONSTRAINT approval_rules_doc_type_check CHECK (doc_type IN (
  'purchase_order', 'goods_receipt', 'vendor_bill', 'debit_note', 'expense',
  'vendor_payment', 'vendor_refund', 'vendor_credit_refund',
  'sales_quote', 'invoice', 'credit_note', 'customer_receipt', 'customer_refund', 'customer_credit_refund'));
ALTER TABLE public.approval_authorities DROP CONSTRAINT IF EXISTS approval_authorities_doc_type_check;
ALTER TABLE public.approval_authorities ADD CONSTRAINT approval_authorities_doc_type_check CHECK (doc_type IN ('*',
  'purchase_order', 'goods_receipt', 'vendor_bill', 'debit_note', 'expense',
  'vendor_payment', 'vendor_refund', 'vendor_credit_refund',
  'sales_quote', 'invoice', 'credit_note', 'customer_receipt', 'customer_refund', 'customer_credit_refund'));

CREATE OR REPLACE FUNCTION public._approval_confirmed_states(p_doc_type text)
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE p_doc_type
    WHEN 'purchase_order' THEN ARRAY['sent', 'partially_received', 'received', 'closed']
    WHEN 'goods_receipt'  THEN ARRAY['received', 'billed']
    WHEN 'sales_quote'    THEN ARRAY['sent', 'accepted', 'partially_invoiced', 'fully_invoiced']
    ELSE ARRAY['confirmed'] END;
$function$;

CREATE OR REPLACE FUNCTION public._approval_perm(p_doc_type text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE WHEN p_doc_type IN ('sales_quote', 'invoice', 'credit_note', 'customer_receipt',
                                  'customer_refund', 'customer_credit_refund')
              THEN 'sales.write' ELSE 'purchasing.write' END;
$function$;

-- What a payment row can be, from its direction, classification and contact.
-- A contact marked "both" keeps every candidate (the screen says which one it
-- is when submitting; the guard asks for approval if any candidate's rule applies).
CREATE OR REPLACE FUNCTION public._approval_payment_types(p_type text, p_classification text, p_contact uuid)
RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ct   text;
  v_cust boolean;
  v_supp boolean;
  v_out  text[] := ARRAY[]::text[];
BEGIN
  SELECT type INTO v_ct FROM public.contacts WHERE id = p_contact;
  v_cust := v_ct IS NULL OR v_ct IN ('customer', 'both');
  v_supp := v_ct IS NULL OR v_ct IN ('supplier', 'both');
  IF p_type = 'outbound' THEN
    IF v_supp THEN v_out := array_append(v_out, 'vendor_payment'); END IF;
    IF v_cust AND p_classification = 'advance'    THEN v_out := array_append(v_out, 'customer_refund'); END IF;
    IF v_cust AND p_classification = 'on_account' THEN v_out := array_append(v_out, 'customer_credit_refund'); END IF;
  ELSE
    IF v_cust THEN v_out := array_append(v_out, 'customer_receipt'); END IF;
    IF v_supp AND p_classification = 'advance'    THEN v_out := array_append(v_out, 'vendor_refund'); END IF;
    IF v_supp AND p_classification = 'on_account' THEN v_out := array_append(v_out, 'vendor_credit_refund'); END IF;
  END IF;
  RETURN v_out;
END;
$function$;

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
  WHEN 'sales_quote' THEN
    SELECT d.company_id, d.status, d.quote_number AS num, d.total_amount AS amt, d.currency AS cur,
           COALESCE(d.exchange_rate, 1) AS fx, false AS op, NULL::text[] AS kinds INTO r FROM public.sales_quotes d WHERE d.id = p_doc_id;
  WHEN 'invoice' THEN
    SELECT d.company_id, d.status, d.invoice_number AS num, d.total_amount AS amt, d.currency AS cur,
           COALESCE(d.exchange_rate, 1) AS fx,
           (COALESCE(d.is_opening, false) OR d.pos_session_id IS NOT NULL) AS op, NULL::text[] AS kinds
      INTO r FROM public.invoices d WHERE d.id = p_doc_id;
  WHEN 'credit_note' THEN
    SELECT d.company_id, d.status, d.credit_note_number AS num, d.total_amount AS amt, d.currency AS cur,
           COALESCE(d.exchange_rate, 1) AS fx, false AS op, NULL::text[] AS kinds INTO r FROM public.credit_notes d WHERE d.id = p_doc_id;
  WHEN 'vendor_payment', 'vendor_refund', 'vendor_credit_refund',
       'customer_receipt', 'customer_refund', 'customer_credit_refund' THEN
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
  kinds       := COALESCE(r.kinds, ARRAY[p_doc_type]);
  RETURN NEXT;
END;
$function$;

-- ── 2. Guards: same rules, now also quotes, invoices, credit notes ─────────
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
  -- Opening balances and counter (POS) sales never go through approval.
  IF COALESCE((v_row->>'is_opening')::boolean, false) OR (v_row->>'pos_session_id') IS NOT NULL THEN
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
    -- POs and quotes stay editable after they go out, and a confirmed invoice
    -- is edited in place (edit_invoice reposts it). Once approved, only an
    -- admin changes their content (status and invoiced amount still move on).
    IF v_type IN ('purchase_order', 'sales_quote', 'invoice') AND NOT v_admin
       AND (v_row - 'status' - 'updated_at' - 'invoiced_amount') IS DISTINCT FROM (v_old - 'status' - 'updated_at' - 'invoiced_amount') THEN
      RAISE EXCEPTION 'This document was approved. Only an admin can change it.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_approval_lines_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_doc    uuid := (to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END) ->> TG_ARGV[0])::uuid;
  v_status text;
BEGIN
  IF v_doc IS NULL OR public._approval_in_flight(v_doc) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF EXISTS (SELECT 1 FROM public.approval_requests WHERE doc_id = v_doc AND status = 'pending') THEN
    RAISE EXCEPTION 'This document is waiting for approval and can''t be changed. Cancel the request first to edit it.'
      USING ERRCODE = 'P0001';
  END IF;
  IF TG_ARGV[1] IN ('purchase_order', 'sales_quote', 'invoice') THEN
    IF TG_ARGV[1] = 'purchase_order' THEN
      SELECT status INTO v_status FROM public.purchase_orders WHERE id = v_doc;
    ELSIF TG_ARGV[1] = 'sales_quote' THEN
      SELECT status INTO v_status FROM public.sales_quotes WHERE id = v_doc;
    ELSE
      SELECT status INTO v_status FROM public.invoices WHERE id = v_doc;
    END IF;
    IF v_status IS DISTINCT FROM 'draft' AND public._approval_is_approved(v_doc)
       AND NOT public.has_perm('users.manage') THEN
      RAISE EXCEPTION 'This document was approved. Only an admin can change it.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
      ('sales_quotes', 'sales_quote'), ('invoices', 'invoice'), ('credit_notes', 'credit_note')) AS v(tbl, kind)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t.tbl || '_approval_guard', t.tbl);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW '
                   'EXECUTE FUNCTION public.tg_approval_doc_guard(%L)', t.tbl || '_approval_guard', t.tbl, t.kind);
  END LOOP;
  FOR t IN SELECT * FROM (VALUES
      ('sales_quote_items', 'quote_id', 'sales_quote'), ('invoice_items', 'invoice_id', 'invoice'),
      ('credit_note_items', 'credit_note_id', 'credit_note')) AS v(tbl, col, kind)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t.tbl || '_approval_guard', t.tbl);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW '
                   'EXECUTE FUNCTION public.tg_approval_lines_guard(%L, %L)', t.tbl || '_approval_guard', t.tbl, t.col, t.kind);
  END LOOP;
END $$;

-- ── 3. Confirm, the existing way ───────────────────────────────────────────
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
  WHEN 'sales_quote' THEN
    UPDATE public.sales_quotes SET status = 'sent', updated_at = now()
     WHERE id = p_req.doc_id AND status = 'draft';
    IF NOT FOUND THEN RAISE EXCEPTION 'The quote is no longer a draft.' USING ERRCODE = 'P0001'; END IF;
  WHEN 'invoice'     THEN PERFORM public.confirm_invoice(p_req.doc_id);
  WHEN 'credit_note' THEN PERFORM public.confirm_credit_note(p_req.doc_id);
  WHEN 'customer_receipt' THEN
    IF COALESCE(p_req.confirm_args->>'cheque_number', '') <> '' THEN
      PERFORM public.confirm_pdc_payment(p_req.doc_id, p_req.confirm_args->>'cheque_number',
        p_req.confirm_args->>'bank_name', (p_req.confirm_args->>'due_date')::date);
    ELSE
      PERFORM public.confirm_payment(p_req.doc_id);
    END IF;
  WHEN 'customer_refund'        THEN PERFORM public.confirm_customer_refund(p_req.doc_id);
  WHEN 'customer_credit_refund' THEN PERFORM public.confirm_customer_credit_refund(p_req.doc_id);
  END CASE;
  PERFORM set_config('stockbolt.approval_doc', '', true);
END;
$function$;

-- ── 4. Settings: an "All documents" approver is fine if they can post either side ──
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
                 'problem', CASE WHEN a.doc_type <> '*' THEN public._approver_problem(a.employee_id, a.doc_type)
                                 WHEN public._approver_problem(a.employee_id, 'vendor_bill') IS NULL
                                   OR public._approver_problem(a.employee_id, 'invoice') IS NULL THEN NULL
                                 ELSE public._approver_problem(a.employee_id, 'invoice') END)
                 ORDER BY e.code, a.doc_type)
          FROM public.approval_authorities a JOIN public.employees e ON e.id = a.employee_id
         WHERE a.company_id = v_company), '[]'::jsonb) ELSE '[]'::jsonb END);
END;
$function$;

REVOKE ALL ON FUNCTION public._approval_confirmed_states(text)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._approval_perm(text)                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._approval_payment_types(text, text, uuid)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._approval_doc(text, uuid)                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_approval_doc_guard()                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_approval_lines_guard()                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._approval_confirm(public.approval_requests) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approval_config()                          FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approval_config()                       TO authenticated;

COMMIT;

-- ── Verify after applying (read-only) — expect guarded_tables = 19, rules_on unchanged ──
-- SELECT
--   (SELECT count(DISTINCT tgrelid) FROM pg_trigger WHERE tgname LIKE '%\_approval\_guard' AND NOT tgisinternal) AS guarded_tables,
--   (SELECT count(*) FROM public.approval_rules WHERE enabled) AS rules_on,
--   pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'approval_rules_doc_type_check')) LIKE '%customer_receipt%' AS sales_types;

-- ── ROLLBACK (back to phase145: purchasing only) ──────────────────────────
-- BEGIN;
-- DELETE FROM public.approval_rules WHERE doc_type IN ('sales_quote','invoice','credit_note','customer_receipt','customer_refund','customer_credit_refund');
-- DELETE FROM public.approval_authorities WHERE doc_type IN ('sales_quote','invoice','credit_note','customer_receipt','customer_refund','customer_credit_refund');
-- DO $$ DECLARE t text; BEGIN
--   FOREACH t IN ARRAY ARRAY['sales_quotes','invoices','credit_notes','sales_quote_items','invoice_items','credit_note_items'] LOOP
--     EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_approval_guard', t);
--   END LOOP; END $$;
-- -- then re-run the phase145 definitions of _approval_confirmed_states, _approval_perm,
-- -- _approval_payment_types, _approval_doc, tg_approval_doc_guard, tg_approval_lines_guard,
-- -- _approval_confirm, approval_config and its two doc-type CHECKs.
-- COMMIT;
