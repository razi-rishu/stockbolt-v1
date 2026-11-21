-- ═══════════════════════════════════════════════════════════════════════════
-- phase150 — Approvals: manual journal entries
--
-- Apply after phase149. A manual journal posts the moment it is saved (no
-- draft), so a journal that needs approval waits INSIDE its approval request:
--   approval_requests.confirm_args = { "data":  <the post_journal_entry payload>,
--                                      "dates": [one or more posting dates],
--                                      "reverse_je_id": <journal being corrected, optional> }
-- and doc_id is an id the screen picks for the pending journal.
--
--   submit   checks the journal with a dry run of post_journal_entry (balance,
--            accounts, period lock) that is rolled back, so an invalid journal
--            is refused when it is sent, not when it is approved.
--   approve  = reverse the corrected journal (if any) + post_journal_entry once
--            per date, in the approval's transaction; the posted ids are kept
--            in confirm_args.posted_ids.
--   amount   = total debit × exchange rate of ONE entry (a recurring journal
--            is judged per entry).
--
-- Guard on journal_entries:
--   • a NEW manual journal (source_type 'manual', not a reversal) whose amount
--     needs approval is refused unless the approval itself is posting it;
--   • reversing an APPROVED journal is admin-only (logged as admin_void).
-- Other journals (documents' own postings, depreciation, year-end, opening
-- balances…) never go through this rule.
--
-- pending_journal(id) returns a pending / decided journal for its review page.
-- Every rule still starts OFF; post_journal_entry and reverse_journal_entry
-- are not edited. SAFE TO APPLY: one transaction, re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.approval_rules DROP CONSTRAINT IF EXISTS approval_rules_doc_type_check;
ALTER TABLE public.approval_rules ADD CONSTRAINT approval_rules_doc_type_check CHECK (doc_type IN (
  'purchase_order', 'goods_receipt', 'vendor_bill', 'debit_note', 'expense',
  'vendor_payment', 'vendor_refund', 'vendor_credit_refund',
  'sales_quote', 'invoice', 'credit_note', 'customer_receipt', 'customer_refund', 'customer_credit_refund',
  'inventory_adjustment', 'bank_transfer', 'fixed_asset_purchase', 'payroll_run', 'stock_transfer', 'journal_entry'));
ALTER TABLE public.approval_authorities DROP CONSTRAINT IF EXISTS approval_authorities_doc_type_check;
ALTER TABLE public.approval_authorities ADD CONSTRAINT approval_authorities_doc_type_check CHECK (doc_type IN ('*',
  'purchase_order', 'goods_receipt', 'vendor_bill', 'debit_note', 'expense',
  'vendor_payment', 'vendor_refund', 'vendor_credit_refund',
  'sales_quote', 'invoice', 'credit_note', 'customer_receipt', 'customer_refund', 'customer_credit_refund',
  'inventory_adjustment', 'bank_transfer', 'fixed_asset_purchase', 'payroll_run', 'stock_transfer', 'journal_entry'));

CREATE OR REPLACE FUNCTION public._approval_perm(p_doc_type text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_doc_type IN ('sales_quote', 'invoice', 'credit_note', 'customer_receipt',
                        'customer_refund', 'customer_credit_refund') THEN 'sales.write'
    WHEN p_doc_type IN ('inventory_adjustment', 'stock_transfer') THEN 'inventory.write'
    WHEN p_doc_type IN ('bank_transfer', 'fixed_asset_purchase', 'journal_entry') THEN 'accounting.write'
    WHEN p_doc_type = 'payroll_run' THEN 'payroll.write'
    ELSE 'purchasing.write' END;
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
  WHEN 'inventory_adjustment' THEN
    SELECT d.company_id, d.status, d.adjustment_number AS num,
           COALESCE((SELECT sum(abs(i.difference) * COALESCE(i.unit_cost, 0)) FROM public.inventory_adjustment_items i
                      WHERE i.adjustment_id = d.id), 0) AS amt,
           NULL::text AS cur, 1::numeric AS fx, false AS op, NULL::text[] AS kinds
      INTO r FROM public.inventory_adjustments d WHERE d.id = p_doc_id;
  WHEN 'stock_transfer' THEN
    -- Value moved, at the cost the transfer will use: the company's latest
    -- moving average for each product (the line's own cost only as a fallback).
    SELECT d.company_id, d.status, d.transfer_number AS num,
           COALESCE((SELECT sum(i.quantity * COALESCE(
                      (SELECT sl.running_avg_cost FROM public.stock_ledger sl
                        WHERE sl.company_id = d.company_id AND sl.product_id = i.product_id
                        ORDER BY sl.seq DESC LIMIT 1), i.unit_cost, 0))
                      FROM public.stock_transfer_items i WHERE i.transfer_id = d.id), 0) AS amt,
           NULL::text AS cur, 1::numeric AS fx, false AS op, NULL::text[] AS kinds
      INTO r FROM public.stock_transfers d WHERE d.id = p_doc_id;
  WHEN 'journal_entry' THEN
    -- A journal waiting for approval exists only as its request (it posts on
    -- approval). Found by the request's id for the journal, or by a posted
    -- journal's id once approved.
    SELECT q.company_id, CASE WHEN q.status = 'approved' THEN 'posted' ELSE 'draft' END AS status,
           q.doc_number AS num, q.amount_doc AS amt, q.currency AS cur,
           CASE WHEN COALESCE(q.amount_doc, 0) = 0 THEN 1 ELSE q.amount_base / q.amount_doc END AS fx,
           false AS op, NULL::text[] AS kinds
      INTO r FROM public.approval_requests q
     WHERE q.doc_type = 'journal_entry'
       AND (q.doc_id = p_doc_id OR q.confirm_args->'posted_ids' ? p_doc_id::text)
     ORDER BY q.created_at DESC, q.decided_at DESC NULLS FIRST LIMIT 1;
  WHEN 'bank_transfer' THEN
    SELECT d.company_id, d.status, d.transfer_number AS num, d.amount AS amt, NULL::text AS cur,
           1::numeric AS fx, false AS op, NULL::text[] AS kinds INTO r FROM public.bank_transfers d WHERE d.id = p_doc_id;
  WHEN 'fixed_asset_purchase' THEN
    SELECT d.company_id, d.status,
           COALESCE(b.bill_number, x.expense_number) AS num,
           COALESCE(b.total_amount, x.total_amount, 0) AS amt,
           b.currency AS cur, COALESCE(b.exchange_rate, 1) AS fx, false AS op, NULL::text[] AS kinds
      INTO r FROM public.fixed_asset_purchases d
      LEFT JOIN public.vendor_bills b ON d.doc_type = 'vendor_bill' AND b.id = d.doc_id
      LEFT JOIN public.expenses x     ON d.doc_type = 'expense'     AND x.id = d.doc_id
     WHERE d.id = p_doc_id;
  WHEN 'payroll_run' THEN
    SELECT d.company_id, d.status, d.run_number AS num, d.total_net AS amt, NULL::text AS cur,
           1::numeric AS fx, false AS op, NULL::text[] AS kinds INTO r FROM public.payroll_runs d WHERE d.id = p_doc_id;
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

-- ── 1. A journal sent for approval: checked, valued, not posted ───────────
CREATE OR REPLACE FUNCTION public._approval_journal_draft(p_company uuid, p_doc_id uuid, p_args jsonb)
RETURNS TABLE(company_id uuid, status text, doc_number text, amount_doc numeric, currency text,
              amount_base numeric, is_opening boolean, kinds text[])
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_data   jsonb := p_args->'data';
  v_dates  jsonb := COALESCE(p_args->'dates', jsonb_build_array(COALESCE(p_args->'data'->>'date', CURRENT_DATE::text)));
  v_debit  numeric := 0;
  v_credit numeric := 0;
  v_fx     numeric := COALESCE((p_args->'data'->>'exchange_rate')::numeric, 1);
  v_line   jsonb;
  v_d      jsonb;
  v_rev    uuid := NULLIF(p_args->>'reverse_je_id', '')::uuid;
BEGIN
  IF v_data IS NULL OR jsonb_typeof(v_data->'lines') IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_data->'lines') < 2 THEN
    RAISE EXCEPTION 'A journal needs at least two lines.' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(v_data->>'source_type', 'manual') <> 'manual' THEN
    RAISE EXCEPTION 'Only manual journals go through approval.' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(v_dates) <> 'array' OR jsonb_array_length(v_dates) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'A journal can be sent for 1 to 60 dates.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.approval_requests q WHERE q.doc_type = 'journal_entry' AND q.doc_id = p_doc_id
                AND q.status IN ('approved', 'pending')) THEN
    RAISE EXCEPTION 'This journal was already sent or posted.' USING ERRCODE = 'P0001';
  END IF;
  IF v_rev IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.journal_entries j
       WHERE j.id = v_rev AND j.company_id = p_company AND j.reversed_by_id IS NULL AND j.source_type = 'manual') THEN
    RAISE EXCEPTION 'The journal being corrected is no longer active.' USING ERRCODE = 'P0001';
  END IF;
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_data->'lines') LOOP
    v_debit  := v_debit  + COALESCE((v_line->>'debit')::numeric, 0);
    v_credit := v_credit + COALESCE((v_line->>'credit')::numeric, 0);
  END LOOP;
  IF abs(v_debit - v_credit) > 0.01 OR v_debit <= 0 THEN
    RAISE EXCEPTION 'The journal doesn''t balance (debit %, credit %).', v_debit, v_credit USING ERRCODE = 'P0001';
  END IF;

  -- Dry run: post each date exactly as approval will, then undo it all.
  BEGIN
    PERFORM set_config('stockbolt.approval_journal', '1', true);
    FOR v_d IN SELECT * FROM jsonb_array_elements(v_dates) LOOP
      PERFORM public.post_journal_entry(v_data || jsonb_build_object('date', v_d #>> '{}', 'source_type', 'manual'));
    END LOOP;
    RAISE EXCEPTION 'journal dry run ok' USING ERRCODE = 'P0950';
  EXCEPTION WHEN SQLSTATE 'P0950' THEN NULL;   -- rolled back: nothing posted
  END;

  company_id  := p_company;
  status      := 'draft';
  doc_number  := left(COALESCE(NULLIF(btrim(v_data->>'description'), ''), 'Journal'), 60);
  amount_doc  := round(v_debit, 2);
  currency    := v_data->>'currency';
  amount_base := round(v_debit * v_fx, 2);
  is_opening  := false;
  kinds       := ARRAY['journal_entry'];
  RETURN NEXT;
END;
$function$;

-- Approval: reverse the corrected journal (if any) and post once per date.
CREATE OR REPLACE FUNCTION public._approval_post_journal(p_req public.approval_requests)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_data  jsonb := p_req.confirm_args->'data';
  v_dates jsonb := COALESCE(p_req.confirm_args->'dates', jsonb_build_array(COALESCE(v_data->>'date', CURRENT_DATE::text)));
  v_rev   uuid := NULLIF(p_req.confirm_args->>'reverse_je_id', '')::uuid;
  v_d     jsonb;
  v_res   jsonb;
  v_ids   jsonb := '[]'::jsonb;
BEGIN
  PERFORM set_config('stockbolt.approval_journal', '1', true);
  IF v_rev IS NOT NULL THEN
    PERFORM public.reverse_journal_entry(v_rev, 'Reversed to edit (approved correction)');
  END IF;
  FOR v_d IN SELECT * FROM jsonb_array_elements(v_dates) LOOP
    v_res := public.post_journal_entry(v_data || jsonb_build_object('date', v_d #>> '{}', 'source_type', 'manual'));
    v_ids := v_ids || to_jsonb(COALESCE(v_res->>'journal_entry_id', v_res->>'id'));
  END LOOP;
  UPDATE public.approval_requests SET confirm_args = confirm_args || jsonb_build_object('posted_ids', v_ids)
   WHERE id = p_req.id;
  PERFORM set_config('stockbolt.approval_journal', '', true);
END;
$function$;

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
  WHEN 'inventory_adjustment'   THEN PERFORM public.confirm_inventory_adjustment(p_req.doc_id);
  WHEN 'stock_transfer'         THEN PERFORM public.confirm_stock_transfer(p_req.doc_id);
  WHEN 'journal_entry'          THEN PERFORM public._approval_post_journal(p_req);
  WHEN 'bank_transfer'          THEN PERFORM public.confirm_bank_transfer(p_req.doc_id);
  WHEN 'fixed_asset_purchase'   THEN PERFORM public.post_fixed_asset_purchase(p_req.doc_id);
  WHEN 'payroll_run'            THEN PERFORM public.confirm_payroll_run(p_req.doc_id);
  WHEN 'customer_credit_refund' THEN PERFORM public.confirm_customer_credit_refund(p_req.doc_id);
  END CASE;
  PERFORM set_config('stockbolt.approval_doc', '', true);
END;
$function$;

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
  IF p_doc_type = 'journal_entry' THEN
    -- The journal is in p_confirm_args; it posts only when approved.
    SELECT * INTO v_doc FROM public._approval_journal_draft(v_company, p_doc_id, p_confirm_args);
  ELSE
    SELECT * INTO v_doc FROM public._approval_doc(p_doc_type, p_doc_id);
  END IF;
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
    SELECT * INTO v_req FROM public.approval_requests
     WHERE doc_id = p_doc_id
        OR (p_doc_type = 'journal_entry' AND doc_type = 'journal_entry' AND confirm_args->'posted_ids' ? p_doc_id::text)
     ORDER BY created_at DESC, decided_at DESC NULLS FIRST LIMIT 1;
  END IF;
  RETURN jsonb_build_object(
    'rule_enabled', COALESCE(v_rule.enabled, false),
    -- phase149 — the server's own answer for a saved document: does its amount
    -- (valued the way the guard values it) need approval?
    'amount_base', CASE WHEN p_doc_id IS NULL THEN NULL ELSE v_doc.amount_base END,
    'needs', CASE WHEN p_doc_id IS NULL THEN NULL
                  ELSE public._approval_rule_applies(v_company, v_doc.kinds, v_doc.amount_base) END,
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

-- ── 2. Guard on journal_entries ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_journal_entries_approval()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_req public.approval_requests;
BEGIN
  IF COALESCE(current_setting('stockbolt.approval_journal', true), '') = '1' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.source_type = 'manual' AND NEW.reversal_of_id IS NULL
       AND public._approval_rule_applies(NEW.company_id, ARRAY['journal_entry'],
             round(COALESCE(NEW.total_debit, 0) * COALESCE(NEW.exchange_rate, 1), 2)) THEN
      RAISE EXCEPTION 'This journal needs approval before it is posted. Use Submit for approval.' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  -- Being reversed: an approved journal is reversed only by an admin.
  IF OLD.reversed_by_id IS NULL AND NEW.reversed_by_id IS NOT NULL AND OLD.source_type = 'manual' THEN
    SELECT * INTO v_req FROM public.approval_requests
     WHERE doc_type = 'journal_entry' AND status = 'approved' AND confirm_args->'posted_ids' ? OLD.id::text
     ORDER BY created_at DESC LIMIT 1;
    IF v_req.id IS NOT NULL THEN
      IF NOT public.has_perm('users.manage') THEN
        RAISE EXCEPTION 'This journal was approved. Only an admin can reverse it.' USING ERRCODE = '42501';
      END IF;
      INSERT INTO public.approval_steps (company_id, request_id, doc_type, doc_id, action, by_user, by_employee, note)
      VALUES (v_req.company_id, v_req.id, 'journal_entry', v_req.doc_id, 'admin_void', auth.uid(), public._my_employee(),
              OLD.entry_number);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS journal_entries_approval_guard ON public.journal_entries;
CREATE TRIGGER journal_entries_approval_guard
  BEFORE INSERT OR UPDATE OF reversed_by_id ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_journal_entries_approval();

-- ── 3. Reading a pending journal ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pending_journal(p_doc_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid := public._approval_guard_company();
  v_me      uuid := public._my_employee();
  v_req     public.approval_requests;
BEGIN
  SELECT * INTO v_req FROM public.approval_requests
   WHERE company_id = v_company AND doc_type = 'journal_entry' AND doc_id = p_doc_id
   ORDER BY created_at DESC, decided_at DESC NULLS FIRST LIMIT 1;
  IF v_req.id IS NULL THEN RETURN NULL; END IF;
  IF NOT (public.has_perm('accounting.read') OR v_req.submitted_by_user = auth.uid()
          OR (v_me IS NOT NULL AND v_me = v_req.assignee_employee_id)) THEN
    RAISE EXCEPTION 'forbidden: you can''t see this journal' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'doc_id', v_req.doc_id, 'status', v_req.status, 'amount_base', v_req.amount_base,
    'data', v_req.confirm_args->'data', 'dates', v_req.confirm_args->'dates',
    'reverse_je_id', v_req.confirm_args->'reverse_je_id',
    'reverse_entry_number', (SELECT entry_number FROM public.journal_entries
                              WHERE id = NULLIF(v_req.confirm_args->>'reverse_je_id', '')::uuid),
    'posted', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', j.id, 'entry_number', j.entry_number, 'date', j.date)
                                         ORDER BY j.date, j.entry_number)
                          FROM public.journal_entries j
                         WHERE j.company_id = v_company
                           AND (v_req.confirm_args->'posted_ids') ? j.id::text), '[]'::jsonb),
    -- Names for the review page (account codes and parties used by the lines).
    'accounts', COALESCE((SELECT jsonb_object_agg(a.code, a.name)
                            FROM public.chart_of_accounts a
                           WHERE a.company_id = v_company
                             AND a.code IN (SELECT l->>'account_code'
                                              FROM jsonb_array_elements(v_req.confirm_args->'data'->'lines') l)), '{}'::jsonb),
    'contacts', COALESCE((SELECT jsonb_object_agg(c.id, c.name)
                            FROM public.contacts c
                           WHERE c.company_id = v_company
                             AND c.id::text IN (SELECT l->>'contact_id'
                                                  FROM jsonb_array_elements(v_req.confirm_args->'data'->'lines') l
                                                 WHERE COALESCE(l->>'contact_id', '') <> '')), '{}'::jsonb),
    'submitted_by_me', v_req.submitted_by_user = auth.uid());
END;
$function$;

REVOKE ALL ON FUNCTION public._approval_perm(text)                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._approval_doc(text, uuid)                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._approval_journal_draft(uuid, uuid, jsonb)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._approval_post_journal(public.approval_requests) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._approval_confirm(public.approval_requests)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_journal_entries_approval()               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_for_approval(text, uuid, uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.doc_approval_state(text, uuid)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pending_journal(uuid)                       FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_for_approval(text, uuid, uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.doc_approval_state(text, uuid)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.pending_journal(uuid)                    TO authenticated;

COMMIT;

-- ── Verify after applying (read-only) — expect journals = true, guard = 1 ──
-- SELECT
--   pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'approval_rules_doc_type_check')) LIKE '%journal_entry%' AS journals,
--   (SELECT count(*) FROM pg_trigger WHERE tgname = 'journal_entries_approval_guard' AND NOT tgisinternal) AS guard,
--   (SELECT count(*) FROM public.approval_rules WHERE enabled) AS rules_on;

-- ── ROLLBACK (back to phase149) ───────────────────────────────────────────
-- BEGIN;
-- DELETE FROM public.approval_rules WHERE doc_type = 'journal_entry';
-- DELETE FROM public.approval_authorities WHERE doc_type = 'journal_entry';
-- DROP TRIGGER IF EXISTS journal_entries_approval_guard ON public.journal_entries;
-- DROP FUNCTION IF EXISTS public.tg_journal_entries_approval(), public.pending_journal(uuid),
--   public._approval_post_journal(public.approval_requests), public._approval_journal_draft(uuid, uuid, jsonb);
-- -- then re-run the phase149 / phase145 definitions of _approval_perm, _approval_doc,
-- -- _approval_confirm, doc_approval_state, submit_for_approval and the two CHECKs.
-- COMMIT;
