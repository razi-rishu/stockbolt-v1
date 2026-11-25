-- ═══════════════════════════════════════════════════════════════════════════
-- phase156 — record who accepted a document's pack quantities (inventory
-- plan, Part 4)
-- ═══════════════════════════════════════════════════════════════════════════
-- Before a document with pack lines is saved, the screen shows every one of
-- them ("2 BOX = 24 PCS") and the user must accept — everyone, admins too.
-- This writes that acceptance to the document's Activity (audit_logs).
--
-- The text is built HERE from the saved lines, never from the client, so the
-- record always says what was really saved. It changes nothing else, and it
-- writes nothing for a document without pack lines.
--
-- SAFE TO APPLY: one new function. No table, data or posting changes.
-- Needs phase155. Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.product_units') IS NULL THEN
    RAISE EXCEPTION 'phase156 stopped: run phase155 first. Nothing was changed.';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.record_pack_acceptance(p_doc_type text, p_doc_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid := public.current_user_company_id();
  v_doc     text;
  v_item    text;
  v_fk      text;
  v_qty     text := 'quantity';
  v_perm    text;
  v_order   text := 'sort_order';
  v_found   boolean;
  v_lines   jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'record_pack_acceptance: not allowed';
  END IF;

  SELECT d.doc, d.item, d.fk, d.perm INTO v_doc, v_item, v_fk, v_perm
    FROM (VALUES
      ('sales_quote',    'sales_quotes',    'sales_quote_items',    'quote_id',       'sales.write'),
      ('invoice',        'invoices',        'invoice_items',        'invoice_id',     'sales.write'),
      ('credit_note',    'credit_notes',    'credit_note_items',    'credit_note_id', 'sales.write'),
      ('purchase_order', 'purchase_orders', 'purchase_order_items', 'po_id',          'purchasing.write'),
      ('goods_receipt',  'goods_receipts',  'goods_receipt_items',  'grn_id',         'purchasing.write'),
      ('vendor_bill',    'vendor_bills',    'vendor_bill_items',    'bill_id',        'purchasing.write'),
      ('debit_note',     'debit_notes',     'debit_note_items',     'debit_note_id',  'purchasing.write')
    ) AS d(kind, doc, item, fk, perm)
   WHERE d.kind = p_doc_type;
  IF v_doc IS NULL THEN
    RAISE EXCEPTION 'record_pack_acceptance: unknown document type';
  END IF;
  IF NOT public.has_perm(v_perm) THEN
    RAISE EXCEPTION 'record_pack_acceptance: not allowed';
  END IF;
  IF p_doc_type = 'goods_receipt' THEN v_qty := 'qty_received'; v_order := 'id'; END IF;

  -- The document must belong to the caller's company.
  EXECUTE format('SELECT true FROM public.%I WHERE id = $1 AND company_id = $2', v_doc)
    INTO v_found USING p_doc_id, v_company;
  IF v_found IS NOT TRUE THEN
    RAISE EXCEPTION 'record_pack_acceptance: document not found';
  END IF;

  EXECUTE format($q$
    SELECT jsonb_agg(p.sku || ': ' || trim_scale(i.%I) || CASE WHEN i.unit_label ~ '^[0-9]' THEN ' × ' ELSE ' ' END || i.unit_label || ' = ' || trim_scale(i.base_quantity)
                     || ' ' || COALESCE(u.code, 'PCS') ORDER BY i.%I)
      FROM public.%I i
      JOIN public.products p ON p.id = i.product_id
      LEFT JOIN public.units_of_measure u ON u.id = p.unit_id
     WHERE i.%I = $1 AND i.product_unit_id IS NOT NULL$q$, v_qty, v_order, v_item, v_fk)
    INTO v_lines USING p_doc_id;
  IF v_lines IS NULL THEN RETURN; END IF;

  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
  VALUES (v_company, auth.uid(), 'update', p_doc_type, p_doc_id, jsonb_build_object('packs_accepted', v_lines));
END;
$function$;

REVOKE ALL ON FUNCTION public.record_pack_acceptance(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_pack_acceptance(text, uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── VERIFY after applying (expect: 1 | false) ─────────────────────────────
-- SELECT (SELECT count(*) FROM pg_proc WHERE proname = 'record_pack_acceptance')                        AS function_expect_1,
--        has_function_privilege('anon', 'public.record_pack_acceptance(text, uuid)', 'EXECUTE')         AS anon_expect_false;
--
-- ── UNDO ──────────────────────────────────────────────────────────────────
-- Nothing to undo: an app that does not call it is unaffected.
