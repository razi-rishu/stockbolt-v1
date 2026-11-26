-- ═══════════════════════════════════════════════════════════════════════════
-- phase159 — Editing a confirmed invoice happens in ONE step (audit release 1B).
-- ═══════════════════════════════════════════════════════════════════════════
-- Until now the editor wrote the confirmed invoice and its lines straight into
-- the tables, then called edit_invoice to re-post. If the second call failed,
-- the invoice showed the new figures while the books still held the old ones.
-- It also meant app users must be allowed to write posted invoices directly,
-- which release 1C takes away.
--
-- save_invoice_edit does the same work in one transaction: header, lines,
-- deferred-cost queue, then the existing edit_invoice re-post, unchanged. If
-- anything fails, nothing changes.
--
-- What the caller may change: the fields the edit screen edits. Number,
-- company, status, currency, rate, source links and void fields stay as they
-- are (currency is fixed at creation, AGENTS 7.2).
--
-- Additive: a new function only. edit_invoice and every table stay the same.
-- Old apps keep their two-step path until release 1C.
-- SAFE TO RE-RUN.  UNDO: DROP FUNCTION public.save_invoice_edit(uuid, jsonb, jsonb);
-- Needs phase158 (_require_post).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.save_invoice_edit(p_invoice_id uuid, p_header jsonb, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_company uuid;
  v_inv     public.invoices%ROWTYPE;
  v_new     public.invoices%ROWTYPE;
  v_notes   text;
  v_cols    text;
  v_sel     text;
  v_lines   numeric;
BEGIN
  PERFORM public._require_post(ARRAY['sales.write']);

  v_company := public.current_user_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No company for this user.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv FROM public.invoices
   WHERE id = p_invoice_id AND company_id = v_company FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_inv.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Only a confirmed invoice can be edited here (this one is %).', v_inv.status;
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'An invoice needs at least one line.';
  END IF;
  IF p_header IS NULL OR jsonb_typeof(p_header) <> 'object' THEN
    RAISE EXCEPTION 'Invoice details are missing.';
  END IF;

  -- Lines someone has already returned cannot be re-priced (phase72 R1). Void
  -- the credit note first. Same message the app gave.
  SELECT string_agg(DISTINCT cn.credit_note_number, ', ') INTO v_notes
    FROM public.credit_note_items ci
    JOIN public.credit_notes cn ON cn.id = ci.credit_note_id
    JOIN public.invoice_items ii ON ii.id = ci.invoice_item_id
   WHERE ii.invoice_id = p_invoice_id AND cn.status = 'confirmed';
  IF v_notes IS NOT NULL THEN
    RAISE EXCEPTION 'This invoice has already been returned against (%), so its lines can no longer be edited. Void the credit note first if the return was wrong.', v_notes;
  END IF;

  -- Header: keys that are sent replace the value; keys left out keep it.
  v_new := jsonb_populate_record(v_inv, p_header);
  UPDATE public.invoices SET
    contact_id           = v_new.contact_id,
    salesperson_id       = v_new.salesperson_id,
    project_id           = v_new.project_id,
    warehouse_id         = v_new.warehouse_id,
    date                 = v_new.date,
    due_date             = v_new.due_date,
    reference            = v_new.reference,
    price_level_id       = v_new.price_level_id,
    prices_inclusive     = v_new.prices_inclusive,
    is_export            = v_new.is_export,
    place_of_supply_code = v_new.place_of_supply_code,
    subtotal             = v_new.subtotal,
    discount_amount      = v_new.discount_amount,
    tax_amount           = v_new.tax_amount,
    round_off_amount     = v_new.round_off_amount,
    total_amount         = v_new.total_amount,
    terms                = v_new.terms,
    terms_ar             = v_new.terms_ar,
    notes                = v_new.notes
  WHERE id = p_invoice_id;

  -- The deferred-cost queue points at the old lines; edit_invoice rebuilds it.
  DELETE FROM public.deferred_cogs_queue
   WHERE sale_invoice_id = p_invoice_id AND company_id = v_company;

  -- Lines: replaced. Only real columns the caller sent are written; the id,
  -- invoice, order and cost columns are set here or by edit_invoice.
  DELETE FROM public.invoice_items WHERE invoice_id = p_invoice_id;

  SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position),
         string_agg('r.' || quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position)
    INTO v_cols, v_sel
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'invoice_items'
     AND c.column_name NOT IN ('id', 'invoice_id', 'sort_order', 'created_at',
                               'cost_at_sale', 'cost_total', 'unit_factor', 'base_quantity', 'unit_label')
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) e WHERE e ? c.column_name);

  EXECUTE format(
    'INSERT INTO public.invoice_items (invoice_id, sort_order%s) '
    'SELECT $1, (e.o - 1)::int%s '
    'FROM jsonb_array_elements($2) WITH ORDINALITY AS e(j, o), '
    'LATERAL jsonb_populate_record(NULL::public.invoice_items, e.j) AS r '
    'ORDER BY e.o',
    COALESCE(', ' || v_cols, ''), COALESCE(', ' || v_sel, ''))
  USING p_invoice_id, p_lines;

  -- The total must come from the lines (audit check C6), or the books would
  -- post a figure no line explains.
  SELECT COALESCE(sum(line_total), 0) INTO v_lines FROM public.invoice_items WHERE invoice_id = p_invoice_id;
  IF abs(v_lines + COALESCE(v_new.round_off_amount, 0) - v_new.total_amount) > 0.05 THEN
    RAISE EXCEPTION 'The invoice total (%) does not match its lines (%). Nothing was saved.',
      v_new.total_amount, v_lines + COALESCE(v_new.round_off_amount, 0);
  END IF;

  -- Re-post with the existing engine (Doc 3 A1, reverse at the voucher date).
  RETURN public.edit_invoice(p_invoice_id);
END;
$fn$;

-- Owned by ledger_writer like every posting function (phase119). The owner
-- transfer needs CREATE on the schema for a moment; taken back at once.
GRANT CREATE ON SCHEMA public TO ledger_writer;
ALTER FUNCTION public.save_invoice_edit(uuid, jsonb, jsonb) OWNER TO ledger_writer;
REVOKE CREATE ON SCHEMA public FROM ledger_writer;
REVOKE ALL ON FUNCTION public.save_invoice_edit(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_invoice_edit(uuid, jsonb, jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Check: one row, owner ledger_writer, definer true, anon false, authenticated true.
SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS definer,
       has_function_privilege('anon', p.oid, 'execute') AS anon,
       has_function_privilege('authenticated', p.oid, 'execute') AS authenticated
  FROM pg_proc p WHERE p.proname = 'save_invoice_edit' AND p.pronamespace = 'public'::regnamespace;
