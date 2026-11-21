-- ═══════════════════════════════════════════════════════════════════════════
-- phase149 — Approvals: stock transfers
--
-- Apply after phase147 and phase148 (phase148 made confirm_stock_transfer work;
-- before it no transfer could be confirmed, so there was nothing to approve).
--
--   stock_transfer   approve = confirm_stock_transfer (moves the stock, marks
--                    the transfer completed). Amount = quantity × the
--                    company's latest moving-average cost per product (the
--                    cost the transfer moves at; the line cost only as a
--                    fallback). Permission: inventory.write.
--
-- Guards on stock_transfers and stock_transfer_items (27 guarded tables).
-- doc_approval_state gains 'needs' and 'amount_base' for a saved document, so
-- a screen that can't value the document itself asks the server.
-- Every rule still starts OFF; no posting function edited; the functions
-- below are replaced with the same signatures (from the phase147 bodies).
-- SAFE TO APPLY: one transaction, re-runnable. ROLLBACK: end of file.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.approval_rules DROP CONSTRAINT IF EXISTS approval_rules_doc_type_check;
ALTER TABLE public.approval_rules ADD CONSTRAINT approval_rules_doc_type_check CHECK (doc_type IN (
  'purchase_order', 'goods_receipt', 'vendor_bill', 'debit_note', 'expense',
  'vendor_payment', 'vendor_refund', 'vendor_credit_refund',
  'sales_quote', 'invoice', 'credit_note', 'customer_receipt', 'customer_refund', 'customer_credit_refund',
  'inventory_adjustment', 'bank_transfer', 'fixed_asset_purchase', 'payroll_run', 'stock_transfer'));
ALTER TABLE public.approval_authorities DROP CONSTRAINT IF EXISTS approval_authorities_doc_type_check;
ALTER TABLE public.approval_authorities ADD CONSTRAINT approval_authorities_doc_type_check CHECK (doc_type IN ('*',
  'purchase_order', 'goods_receipt', 'vendor_bill', 'debit_note', 'expense',
  'vendor_payment', 'vendor_refund', 'vendor_credit_refund',
  'sales_quote', 'invoice', 'credit_note', 'customer_receipt', 'customer_refund', 'customer_credit_refund',
  'inventory_adjustment', 'bank_transfer', 'fixed_asset_purchase', 'payroll_run', 'stock_transfer'));

CREATE OR REPLACE FUNCTION public._approval_confirmed_states(p_doc_type text)
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE p_doc_type
    WHEN 'purchase_order'       THEN ARRAY['sent', 'partially_received', 'received', 'closed']
    WHEN 'goods_receipt'        THEN ARRAY['received', 'billed']
    WHEN 'sales_quote'          THEN ARRAY['sent', 'accepted', 'partially_invoiced', 'fully_invoiced']
    WHEN 'payroll_run'          THEN ARRAY['confirmed', 'paid']
    WHEN 'fixed_asset_purchase' THEN ARRAY['posted']
    WHEN 'stock_transfer'       THEN ARRAY['in_transit', 'completed']
    ELSE ARRAY['confirmed'] END;
$function$;

CREATE OR REPLACE FUNCTION public._approval_perm(p_doc_type text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_doc_type IN ('sales_quote', 'invoice', 'credit_note', 'customer_receipt',
                        'customer_refund', 'customer_credit_refund') THEN 'sales.write'
    WHEN p_doc_type IN ('inventory_adjustment', 'stock_transfer') THEN 'inventory.write'
    WHEN p_doc_type IN ('bank_transfer', 'fixed_asset_purchase') THEN 'accounting.write'
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
  WHEN 'bank_transfer'          THEN PERFORM public.confirm_bank_transfer(p_req.doc_id);
  WHEN 'fixed_asset_purchase'   THEN PERFORM public.post_fixed_asset_purchase(p_req.doc_id);
  WHEN 'payroll_run'            THEN PERFORM public.confirm_payroll_run(p_req.doc_id);
  WHEN 'customer_credit_refund' THEN PERFORM public.confirm_customer_credit_refund(p_req.doc_id);
  END CASE;
  PERFORM set_config('stockbolt.approval_doc', '', true);
END;
$function$;

-- doc_approval_state also says whether a saved document needs approval
-- (screens that can't value a document themselves, like transfers at MAC).
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

DO $$
BEGIN
  DROP TRIGGER IF EXISTS stock_transfers_approval_guard ON public.stock_transfers;
  CREATE TRIGGER stock_transfers_approval_guard BEFORE UPDATE OR DELETE ON public.stock_transfers
    FOR EACH ROW EXECUTE FUNCTION public.tg_approval_doc_guard('stock_transfer');
  DROP TRIGGER IF EXISTS stock_transfer_items_approval_guard ON public.stock_transfer_items;
  CREATE TRIGGER stock_transfer_items_approval_guard BEFORE INSERT OR UPDATE OR DELETE ON public.stock_transfer_items
    FOR EACH ROW EXECUTE FUNCTION public.tg_approval_lines_guard('transfer_id', 'stock_transfer');
END $$;

REVOKE ALL ON FUNCTION public._approval_confirmed_states(text)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._approval_perm(text)                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._approval_doc(text, uuid)                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._approval_confirm(public.approval_requests) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.doc_approval_state(text, uuid)             FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.doc_approval_state(text, uuid)          TO authenticated;

COMMIT;

-- ── Verify after applying (read-only) — expect guarded_tables = 27, transfers = true ──
-- SELECT
--   (SELECT count(DISTINCT tgrelid) FROM pg_trigger WHERE tgname LIKE '%\_approval\_guard' AND NOT tgisinternal) AS guarded_tables,
--   (SELECT count(*) FROM public.approval_rules WHERE enabled) AS rules_on,
--   pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'approval_rules_doc_type_check')) LIKE '%stock_transfer%' AS transfers;

-- ── ROLLBACK (back to phase147) ───────────────────────────────────────────
-- BEGIN;
-- DELETE FROM public.approval_rules WHERE doc_type = 'stock_transfer';
-- DELETE FROM public.approval_authorities WHERE doc_type = 'stock_transfer';
-- DROP TRIGGER IF EXISTS stock_transfers_approval_guard ON public.stock_transfers;
-- DROP TRIGGER IF EXISTS stock_transfer_items_approval_guard ON public.stock_transfer_items;
-- -- then re-run the phase147 definitions of the four replaced functions and its two CHECKs,
-- -- and the phase145 doc_approval_state (the extra keys are harmless to leave).
-- COMMIT;
