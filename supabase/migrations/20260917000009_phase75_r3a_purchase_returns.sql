-- ============================================================================
-- Phase 75 (R3a) — Purchase Returns: the document the purchase side never had
--
-- THE ASYMMETRY
-- Sales has a return document: sales_returns records WHAT came back, in WHAT
-- condition, to WHICH warehouse and WHY, then confirms into a credit note which
-- does the accounting. Purchasing had none of that. Sending goods back to a
-- supplier meant typing a debit note by hand -- no record of condition, no
-- reason code, no restock warehouse, no link from the physical return to the
-- financial document.
--
-- That gap matters more on the purchase side than the sales side, because a
-- supplier claim needs evidence. "Which of these were damaged in transit, and
-- when did we tell you?" has no answer today.
--
-- WHAT THIS ADDS
--   purchase_returns        mirror of sales_returns, linked to a vendor bill
--   purchase_return_items   mirror, linked to a vendor bill LINE (phase 72)
--   confirm_purchase_return builds a debit note, then posts it through the
--                           existing confirm_debit_note engine
--   void_purchase_return    delegates to void_debit_note
--   reopen_purchase_return  delegates to void_debit_note, back to draft
--
-- DOUBLE ENTRY
-- None of these post anything themselves. Exactly like confirm_sales_return,
-- the new confirm builds a DRAFT debit note and hands it to confirm_debit_note,
-- which is already tested and already carries the phase 74 over-return guard.
-- There is no second posting path to keep in sync, and a tripwire asserts these
-- three write no general_ledger rows of their own.
--
-- The reason vocabulary deliberately differs from the sales side. A customer
-- "changed their mind"; a supplier sent the wrong part, a defective one, too
-- many, or damaged them in transit.
--
-- R3a is schema + engine only. The UI is R3b: nothing can create one of these
-- yet, so applying this changes no behaviour.
--
-- REQUIRES phase 72 (vendor_bill_item_id linkage). Additive and idempotent.
-- ============================================================================


-- ── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.purchase_returns (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  return_number  TEXT NOT NULL,
  bill_id        UUID NOT NULL REFERENCES public.vendor_bills(id) ON DELETE RESTRICT,
  date           DATE NOT NULL,
  warehouse_id   UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  -- SET NULL, not RESTRICT: voiding + deleting a debit note should not strand
  -- the return document that records what physically went back.
  debit_note_id  UUID REFERENCES public.debit_notes(id) ON DELETE SET NULL,
  reason         TEXT,
  status         TEXT NOT NULL DEFAULT 'draft',
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT purchase_returns_company_id_return_number_key UNIQUE (company_id, return_number),
  CONSTRAINT purchase_returns_status_check CHECK (status IN ('draft', 'confirmed', 'void')),
  CONSTRAINT purchase_returns_reason_check CHECK (
    reason IS NULL OR reason IN ('wrong_part', 'defective', 'damaged_in_transit',
                                 'over_shipment', 'other'))
);

CREATE TABLE IF NOT EXISTS public.purchase_return_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_return_id  UUID NOT NULL REFERENCES public.purchase_returns(id) ON DELETE CASCADE,
  -- The line this returns. RESTRICT matches phase 72: a bill line that has been
  -- returned against must not be editable out from under the return.
  vendor_bill_item_id UUID REFERENCES public.vendor_bill_items(id) ON DELETE RESTRICT,
  product_id          UUID REFERENCES public.products(id) ON DELETE RESTRICT,
  qty_returned        NUMERIC(15,3) NOT NULL,
  condition           TEXT,
  restock_warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  unit_cost           NUMERIC(15,2),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT purchase_return_items_condition_check CHECK (
    condition IS NULL OR condition IN ('resellable', 'damaged')),
  CONSTRAINT purchase_return_items_qty_check CHECK (qty_returned > 0)
);

CREATE INDEX IF NOT EXISTS purchase_returns_company_idx     ON public.purchase_returns(company_id);
CREATE INDEX IF NOT EXISTS purchase_returns_bill_idx        ON public.purchase_returns(bill_id);
CREATE INDEX IF NOT EXISTS purchase_return_items_parent_idx ON public.purchase_return_items(purchase_return_id);
CREATE INDEX IF NOT EXISTS purchase_return_items_bill_item_idx
  ON public.purchase_return_items(vendor_bill_item_id) WHERE vendor_bill_item_id IS NOT NULL;


-- ── RLS — mirrors sales_returns exactly, on purchasing.write ────────────────

ALTER TABLE public.purchase_returns      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_return_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.purchase_returns;
CREATE POLICY tenant_isolation ON public.purchase_returns
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

DROP POLICY IF EXISTS rbac_w_ins_purchase_returns ON public.purchase_returns;
CREATE POLICY rbac_w_ins_purchase_returns ON public.purchase_returns
  FOR INSERT WITH CHECK (public.has_perm('purchasing.write'));
DROP POLICY IF EXISTS rbac_w_upd_purchase_returns ON public.purchase_returns;
CREATE POLICY rbac_w_upd_purchase_returns ON public.purchase_returns
  FOR UPDATE USING (public.has_perm('purchasing.write'))
  WITH CHECK (public.has_perm('purchasing.write'));
DROP POLICY IF EXISTS rbac_w_del_purchase_returns ON public.purchase_returns;
CREATE POLICY rbac_w_del_purchase_returns ON public.purchase_returns
  FOR DELETE USING (public.has_perm('purchasing.write'));

-- Items carry no company_id of their own, so isolation rides on the parent.
DROP POLICY IF EXISTS tenant_isolation ON public.purchase_return_items;
CREATE POLICY tenant_isolation ON public.purchase_return_items
  USING (EXISTS (SELECT 1 FROM public.purchase_returns pr
                  WHERE pr.id = purchase_return_id
                    AND pr.company_id = public.current_user_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.purchase_returns pr
                       WHERE pr.id = purchase_return_id
                         AND pr.company_id = public.current_user_company_id()));

DROP POLICY IF EXISTS rbac_w_ins_purchase_return_items ON public.purchase_return_items;
CREATE POLICY rbac_w_ins_purchase_return_items ON public.purchase_return_items
  FOR INSERT WITH CHECK (public.has_perm('purchasing.write'));
DROP POLICY IF EXISTS rbac_w_upd_purchase_return_items ON public.purchase_return_items;
CREATE POLICY rbac_w_upd_purchase_return_items ON public.purchase_return_items
  FOR UPDATE USING (public.has_perm('purchasing.write'))
  WITH CHECK (public.has_perm('purchasing.write'));
DROP POLICY IF EXISTS rbac_w_del_purchase_return_items ON public.purchase_return_items;
CREATE POLICY rbac_w_del_purchase_return_items ON public.purchase_return_items
  FOR DELETE USING (public.has_perm('purchasing.write'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_returns      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_return_items TO authenticated;
REVOKE ALL ON public.purchase_returns      FROM anon;
REVOKE ALL ON public.purchase_return_items FROM anon;


-- ============================================================================
-- confirm_purchase_return — build a debit note, then post it through the
-- existing engine. Mirror of confirm_sales_return.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.confirm_purchase_return(p_purchase_return_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_pr         public.purchase_returns%ROWTYPE;
  v_bill       public.vendor_bills%ROWTYPE;
  v_dn_id      UUID;
  v_dn_number  TEXT;
  v_item       RECORD;
  v_unit_cost  NUMERIC(15,2);
  v_disc_pct   NUMERIC(7,2);
  v_disc_amt   NUMERIC(15,2);
  v_tax_rate   NUMERIC(7,2);
  v_tax_cat    TEXT;
  v_line_sub   NUMERIC(15,2);
  v_line_tax   NUMERIC(15,2);
  v_sort       INTEGER := 0;
  v_sum_gross  NUMERIC(15,2) := 0;
  v_sum_disc   NUMERIC(15,2) := 0;
  v_sum_tax    NUMERIC(15,2) := 0;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'confirm_purchase_return: no company for user'; END IF;

  SELECT * INTO v_pr FROM public.purchase_returns
   WHERE id = p_purchase_return_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'confirm_purchase_return: return % not found', p_purchase_return_id; END IF;
  IF v_pr.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_purchase_return: not in draft (status=%)', v_pr.status;
  END IF;
  IF v_pr.debit_note_id IS NOT NULL THEN
    RAISE EXCEPTION 'confirm_purchase_return: already posted (has a debit note)';
  END IF;

  SELECT * INTO v_bill FROM public.vendor_bills WHERE id = v_pr.bill_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'confirm_purchase_return: linked bill not found'; END IF;

  v_dn_number := public.get_next_document_number(v_company_id, 'DN');

  INSERT INTO public.debit_notes (
    company_id, debit_note_number, supplier_id, warehouse_id, linked_bill_id,
    date, reason, currency, exchange_rate,
    subtotal, discount_amount, tax_amount, total_amount, status, notes
  ) VALUES (
    v_company_id, v_dn_number, v_bill.supplier_id,
    v_pr.warehouse_id, v_pr.bill_id,
    v_pr.date, 'return', v_bill.currency, COALESCE(v_bill.exchange_rate, 1),
    0, 0, 0, 0, 'draft',
    COALESCE(v_pr.notes, 'From purchase return ' || v_pr.return_number)
  ) RETURNING id INTO v_dn_id;

  -- Cost and tax come from the BILL LINE the operator selected (phase 72/74),
  -- never from a product match: a product can appear twice on one bill at two
  -- costs, and matching by product would silently pick the wrong one.
  FOR v_item IN
    SELECT pri.vendor_bill_item_id,
           pri.product_id, pri.qty_returned, pri.condition, pri.unit_cost,
           vbi.bill_id          AS bill_bill_id,
           vbi.unit_cost        AS bill_unit_cost,
           vbi.discount_percent AS bill_disc_pct,
           vbi.tax_rate         AS bill_tax_rate,
           vbi.tax_category     AS bill_tax_cat,
           vbi.unit_id          AS bill_unit_id,
           vbi.description      AS bill_desc,
           vbi.description_ar   AS bill_desc_ar,
           vr.qty_returnable
    FROM public.purchase_return_items pri
    LEFT JOIN public.vendor_bill_items vbi ON vbi.id = pri.vendor_bill_item_id
    LEFT JOIN public.v_bill_line_returnable vr ON vr.vendor_bill_item_id = pri.vendor_bill_item_id
    WHERE pri.purchase_return_id = p_purchase_return_id
  LOOP
    IF v_item.vendor_bill_item_id IS NULL THEN
      RAISE EXCEPTION 'confirm_purchase_return: a return line does not say which bill line it came from. Re-import the lines from the bill.';
    END IF;
    IF v_item.bill_bill_id IS DISTINCT FROM v_pr.bill_id THEN
      RAISE EXCEPTION 'confirm_purchase_return: a return line points at a line on a different bill';
    END IF;
    IF v_item.qty_returned > COALESCE(v_item.qty_returnable, 0) THEN
      RAISE EXCEPTION 'confirm_purchase_return: returning % of "%" but only % remain returnable on that bill line',
        v_item.qty_returned, COALESCE(v_item.bill_desc, '(line)'), COALESCE(v_item.qty_returnable, 0);
    END IF;

    v_unit_cost := COALESCE(v_item.bill_unit_cost, 0);
    v_disc_pct  := COALESCE(v_item.bill_disc_pct, 0);
    v_tax_rate  := v_item.bill_tax_rate;
    v_tax_cat   := COALESCE(v_item.bill_tax_cat, 'standard');

    v_disc_amt := ROUND(v_unit_cost * v_item.qty_returned * v_disc_pct / 100.0, 2);
    v_line_sub := ROUND(v_unit_cost * v_item.qty_returned - v_disc_amt, 2);
    v_line_tax := ROUND(v_line_sub * COALESCE(v_tax_rate, 0) / 100.0, 2);

    INSERT INTO public.debit_note_items (
      debit_note_id, product_id, description, description_ar, quantity, unit_id,
      unit_cost, discount_percent, discount_amount, tax_category, tax_rate, tax_amount,
      line_subtotal, line_total, sort_order, vendor_bill_item_id
    ) VALUES (
      v_dn_id, v_item.product_id, v_item.bill_desc, v_item.bill_desc_ar,
      v_item.qty_returned, v_item.bill_unit_id,
      v_unit_cost, v_disc_pct, v_disc_amt, v_tax_cat, v_tax_rate, v_line_tax,
      v_line_sub, v_line_sub + v_line_tax, v_sort, v_item.vendor_bill_item_id
    );

    v_sum_gross := v_sum_gross + v_line_sub + v_disc_amt;
    v_sum_disc  := v_sum_disc + v_disc_amt;
    v_sum_tax   := v_sum_tax + v_line_tax;
    v_sort := v_sort + 1;
  END LOOP;

  IF v_sort = 0 THEN
    RAISE EXCEPTION 'confirm_purchase_return: the return has no lines';
  END IF;

  UPDATE public.debit_notes
  SET subtotal        = v_sum_gross,
      discount_amount = v_sum_disc,
      tax_amount      = v_sum_tax,
      total_amount    = (v_sum_gross - v_sum_disc) + v_sum_tax
  WHERE id = v_dn_id;

  -- Post it through the existing, tested engine (GL + stock relief). This is
  -- the only thing that touches the ledger; nothing above wrote to it.
  PERFORM public.confirm_debit_note(v_dn_id);

  UPDATE public.purchase_returns
  SET status = 'confirmed', debit_note_id = v_dn_id, updated_at = NOW()
  WHERE id = p_purchase_return_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'purchase_return', p_purchase_return_id,
      jsonb_build_object('return_number', v_pr.return_number,
                         'debit_note_id', v_dn_id, 'debit_note_number', v_dn_number,
                         'phase', '75'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'purchase_return_id', p_purchase_return_id,
    'debit_note_id',      v_dn_id,
    'debit_note_number',  v_dn_number);
END;
$function$;

REVOKE ALL    ON FUNCTION public.confirm_purchase_return(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_purchase_return(uuid) TO authenticated;


-- ============================================================================
-- void_purchase_return / reopen_purchase_return — delegate the reversal to the
-- debit-note engine, exactly as the sales side delegates to the credit note.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.void_purchase_return(
  p_purchase_return_id uuid,
  p_reason             text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_pr         public.purchase_returns%ROWTYPE;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'void_purchase_return: no company for user'; END IF;

  SELECT * INTO v_pr FROM public.purchase_returns
   WHERE id = p_purchase_return_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'void_purchase_return: return % not found', p_purchase_return_id; END IF;
  IF v_pr.status = 'void' THEN RAISE EXCEPTION 'void_purchase_return: already void'; END IF;

  -- Reversing the debit note is what unwinds the ledger and the stock.
  IF v_pr.debit_note_id IS NOT NULL THEN
    PERFORM public.void_debit_note(v_pr.debit_note_id, p_reason);
  END IF;

  UPDATE public.purchase_returns
  SET status = 'void', notes = COALESCE(p_reason, notes), updated_at = NOW()
  WHERE id = p_purchase_return_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'void', 'purchase_return', p_purchase_return_id,
      jsonb_build_object('return_number', v_pr.return_number, 'reason', p_reason, 'phase', '75'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END;
$function$;

REVOKE ALL    ON FUNCTION public.void_purchase_return(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_purchase_return(uuid, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.reopen_purchase_return(p_purchase_return_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_pr         public.purchase_returns%ROWTYPE;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'reopen_purchase_return: no company for user'; END IF;

  SELECT * INTO v_pr FROM public.purchase_returns
   WHERE id = p_purchase_return_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'reopen_purchase_return: return % not found', p_purchase_return_id; END IF;
  IF v_pr.status <> 'confirmed' THEN
    RAISE EXCEPTION 'reopen_purchase_return: not confirmed (status=%)', v_pr.status;
  END IF;

  IF v_pr.debit_note_id IS NOT NULL THEN
    PERFORM public.void_debit_note(v_pr.debit_note_id, 'Reopened purchase return ' || v_pr.return_number);
  END IF;

  -- Drop the link as well as the status: leaving it would trip the
  -- "already posted" guard when the return is confirmed again.
  UPDATE public.purchase_returns
  SET status = 'draft', debit_note_id = NULL, updated_at = NOW()
  WHERE id = p_purchase_return_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'reopen', 'purchase_return', p_purchase_return_id,
      jsonb_build_object('return_number', v_pr.return_number, 'phase', '75'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END;
$function$;

REVOKE ALL    ON FUNCTION public.reopen_purchase_return(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_purchase_return(uuid) TO authenticated;
