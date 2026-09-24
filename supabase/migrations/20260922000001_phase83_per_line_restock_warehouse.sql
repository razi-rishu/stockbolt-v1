-- ============================================================================
-- Phase 83 — A return line can say WHICH warehouse the goods go to
--
-- THE GAP
-- sales_return_items.restock_warehouse_id has existed since Phase 0 and
-- purchase_return_items.restock_warehouse_id since phase 75. Neither was ever
-- read. Both posting engines resolve ONE warehouse for the whole document:
--
--     v_wh_id := v_cn.warehouse_id;            -- or v_dn.warehouse_id
--     IF v_wh_id IS NULL THEN ...default...    -- then used for every line
--
-- So returned goods always landed in the document's warehouse. Damaged stock
-- could not be routed to a quarantine bin, and a return spanning two branches
-- could not be split. The column was a control that looked like it worked.
--
-- It could not have worked: credit_note_items and debit_note_items have no
-- restock_warehouse_id at all, so the value had nowhere to travel between the
-- return document and the engine that actually moves stock.
--
-- WHAT THIS DOES
--   1. Adds restock_warehouse_id to credit_note_items and debit_note_items.
--   2. confirm_sales_return / confirm_purchase_return carry the return line's
--      warehouse onto the note line.
--   3. confirm_credit_note / confirm_debit_note resolve, PER LINE:
--          v_line_wh_id := COALESCE(v_item.restock_warehouse_id, v_wh_id);
--      and use that for both the running-quantity lookup and the ledger row.
--
-- The fallback is what makes this safe: a line with no warehouse behaves
-- exactly as before, so every existing document and every document created
-- without touching the new field posts identically.
--
-- NOT AN ACCOUNTING CHANGE
-- A warehouse decides WHERE stock sits, never what it is worth. The GL legs
-- are untouched: all 6 general_ledger INSERT blocks in confirm_credit_note and
-- all 5 in confirm_debit_note are byte-identical to the live definitions,
-- verified by hashing each block before and after the edit. Only the
-- stock_ledger row's warehouse_id and the running-qty lookup changed.
--
-- Stock valuation is company-wide (moving average across warehouses), so
-- directing a line elsewhere moves quantity, not value. E1 is unaffected.
--
-- REGIONS
-- Nothing here is region-specific. Warehouses behave identically under GCC VAT
-- and India GST; no tax treatment is touched.
--
-- Reconstructed from the LIVE pg_get_functiondef of all four functions, not
-- from migration files. Additive and idempotent.
-- ============================================================================

ALTER TABLE public.credit_note_items
  ADD COLUMN IF NOT EXISTS restock_warehouse_id UUID
  REFERENCES public.warehouses(id) ON DELETE SET NULL;

ALTER TABLE public.debit_note_items
  ADD COLUMN IF NOT EXISTS restock_warehouse_id UUID
  REFERENCES public.warehouses(id) ON DELETE SET NULL;


CREATE OR REPLACE FUNCTION public.confirm_sales_return(p_sales_return_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_sr         public.sales_returns%ROWTYPE;
  v_inv        public.invoices%ROWTYPE;
  v_cn_id      UUID;
  v_cn_number  TEXT;
  v_item       RECORD;
  v_unit_price NUMERIC(15,2);
  v_disc_pct   NUMERIC(7,2);
  v_disc_amt   NUMERIC(15,2);
  v_tax_rate   NUMERIC(7,2);
  v_tax_cat    TEXT;
  v_line_sub   NUMERIC(15,2);
  v_line_tax   NUMERIC(15,2);
  v_cost       NUMERIC(15,2);
  v_sort       INTEGER := 0;
  v_sum_gross  NUMERIC(15,2) := 0;
  v_sum_disc   NUMERIC(15,2) := 0;
  v_sum_tax    NUMERIC(15,2) := 0;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'confirm_sales_return: no company for user'; END IF;

  SELECT * INTO v_sr FROM public.sales_returns WHERE id = p_sales_return_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'confirm_sales_return: return % not found', p_sales_return_id; END IF;
  IF v_sr.status <> 'draft' THEN RAISE EXCEPTION 'confirm_sales_return: not in draft (status=%)', v_sr.status; END IF;
  IF v_sr.credit_note_id IS NOT NULL THEN RAISE EXCEPTION 'confirm_sales_return: already posted (has a credit note)'; END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = v_sr.invoice_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'confirm_sales_return: linked invoice not found'; END IF;

  v_cn_number := public.get_next_document_number(v_company_id, 'CN');

  -- Credit-note header (draft; totals filled after the lines)
  INSERT INTO public.credit_notes (
    company_id, credit_note_number, contact_id, warehouse_id, linked_invoice_id,
    salesperson_id,
    date, reason, restock, currency, exchange_rate,
    subtotal, discount_amount, tax_amount, total_amount, status, notes
  ) VALUES (
    v_company_id, v_cn_number, v_inv.contact_id,
    COALESCE(v_sr.warehouse_id, v_inv.warehouse_id), v_sr.invoice_id,
    v_inv.salesperson_id,
    v_sr.date, 'return', TRUE, v_inv.currency, 1.0,
    0, 0, 0, 0, 'draft',
    COALESCE(v_sr.notes, 'From sales return ' || v_sr.return_number)
  ) RETURNING id INTO v_cn_id;

  -- Lines: price/tax from the original invoice line, cost from the return item.
  -- ---- Phase 73 (R2b) ----------------------------------------------------
  -- Was: LEFT JOIN LATERAL ... WHERE product_id = sri.product_id
  --      ORDER BY sort_order LIMIT 1
  -- That matched by PRODUCT, so a product appearing twice on one invoice at
  -- two prices always priced against the first line. Pro_Parts INV-1012
  -- carries the same pad kit at 83 and 125; returning either credited 83.
  -- Now the join is on the line the operator actually selected.
  FOR v_item IN
    SELECT sri.invoice_item_id,
           sri.product_id, sri.qty_returned, sri.condition, sri.unit_cost,
           sri.restock_warehouse_id,
           ii.invoice_id       AS inv_invoice_id,
           ii.unit_price       AS inv_unit_price,
           ii.discount_percent AS inv_disc_pct,
           ii.tax_rate         AS inv_tax_rate,
           ii.tax_category     AS inv_tax_cat,
           ii.unit_id          AS inv_unit_id,
           ii.description      AS inv_desc,
           ii.description_ar   AS inv_desc_ar,
           vr.qty_returnable
    FROM public.sales_return_items sri
    LEFT JOIN public.invoice_items ii
           ON ii.id = sri.invoice_item_id
    LEFT JOIN public.v_invoice_line_returnable vr
           ON vr.invoice_item_id = sri.invoice_item_id
    WHERE sri.sales_return_id = p_sales_return_id
  LOOP
    -- G1. No source line means we cannot price it. Previously this produced
    -- a silent zero credit: stock came back and the customer got nothing.
    IF v_item.invoice_item_id IS NULL THEN
      RAISE EXCEPTION 'confirm_sales_return: a return line does not say which invoice line it came from. Re-import the lines from the invoice.';
    END IF;

    -- G2. The chosen line must belong to THIS invoice.
    IF v_item.inv_invoice_id IS DISTINCT FROM v_sr.invoice_id THEN
      RAISE EXCEPTION 'confirm_sales_return: a return line points at a line on a different invoice';
    END IF;

    -- G3. Never return more than remains. qty_returnable counts CONFIRMED
    -- credit notes only, so this return (still a draft note) is excluded.
    IF v_item.qty_returned > COALESCE(v_item.qty_returnable, 0) THEN
      RAISE EXCEPTION 'confirm_sales_return: returning % of "%" but only % remain returnable on that invoice line',
        v_item.qty_returned, COALESCE(v_item.inv_desc, '(line)'), COALESCE(v_item.qty_returnable, 0);
    END IF;
    -- ---- end Phase 73 ----------------------------------------------------

    v_unit_price := COALESCE(v_item.inv_unit_price, 0);
    v_disc_pct   := COALESCE(v_item.inv_disc_pct, 0);
    v_tax_rate   := v_item.inv_tax_rate;
    v_tax_cat    := COALESCE(v_item.inv_tax_cat, 'standard');

    v_disc_amt := ROUND(v_unit_price * v_item.qty_returned * v_disc_pct / 100.0, 2);
    v_line_sub := ROUND(v_unit_price * v_item.qty_returned - v_disc_amt, 2);
    v_line_tax := ROUND(v_line_sub * COALESCE(v_tax_rate, 0) / 100.0, 2);
    -- Damaged goods: credit the customer but DON'T restock (cost_at_sale = 0 skips it).
    v_cost := CASE WHEN v_item.condition = 'damaged' THEN 0 ELSE COALESCE(v_item.unit_cost, 0) END;

    INSERT INTO public.credit_note_items (
      credit_note_id, product_id, description, description_ar, quantity, unit_id,
      unit_price, discount_percent, discount_amount, tax_category, tax_rate, tax_amount,
      line_subtotal, line_total, sort_order, cost_at_sale,
      invoice_item_id,  -- Phase 73: what makes returned-to-date countable
      restock_warehouse_id   -- phase83: where these goods actually go back
    ) VALUES (
      v_cn_id, v_item.product_id, v_item.inv_desc, v_item.inv_desc_ar, v_item.qty_returned, v_item.inv_unit_id,
      v_unit_price, v_disc_pct, v_disc_amt, v_tax_cat, v_tax_rate, v_line_tax,
      v_line_sub, v_line_sub + v_line_tax, v_sort, v_cost,
      v_item.invoice_item_id,
      v_item.restock_warehouse_id
    );

    v_sum_gross := v_sum_gross + v_line_sub + v_disc_amt;  -- gross (before line discount)
    v_sum_disc  := v_sum_disc + v_disc_amt;
    v_sum_tax   := v_sum_tax + v_line_tax;
    v_sort := v_sort + 1;
  END LOOP;

  UPDATE public.credit_notes
  SET subtotal = v_sum_gross,
      discount_amount = v_sum_disc,
      tax_amount = v_sum_tax,
      total_amount = (v_sum_gross - v_sum_disc) + v_sum_tax
  WHERE id = v_cn_id;

  -- Post it through the existing, tested engine (GL + restock + COGS reversal).
  PERFORM public.confirm_credit_note(v_cn_id);

  -- Link + confirm the return.
  UPDATE public.sales_returns
  SET status = 'confirmed', credit_note_id = v_cn_id, updated_at = NOW()
  WHERE id = p_sales_return_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'sales_return', p_sales_return_id,
      jsonb_build_object('return_number', v_sr.return_number,
                         'credit_note_id', v_cn_id, 'credit_note_number', v_cn_number));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'sales_return_id', p_sales_return_id,
    'credit_note_id', v_cn_id,
    'credit_note_number', v_cn_number);
END;
$function$;


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
           pri.restock_warehouse_id,
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
      line_subtotal, line_total, sort_order, vendor_bill_item_id,
      restock_warehouse_id   -- phase83
    ) VALUES (
      v_dn_id, v_item.product_id, v_item.bill_desc, v_item.bill_desc_ar,
      v_item.qty_returned, v_item.bill_unit_id,
      v_unit_cost, v_disc_pct, v_disc_amt, v_tax_cat, v_tax_rate, v_line_tax,
      v_line_sub, v_line_sub + v_line_tax, v_sort, v_item.vendor_bill_item_id,
      v_item.restock_warehouse_id
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


CREATE OR REPLACE FUNCTION public.confirm_credit_note(p_credit_note_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id       UUID := auth.uid();
  v_company_id    UUID;
  v_cn            public.credit_notes%ROWTYPE;
  v_item          public.credit_note_items%ROWTYPE;
  v_over          RECORD;   -- Phase 73
  v_lock_date     DATE;
  v_currency      TEXT;
  -- JE tracking
  v_je_id         UUID;
  v_je_entry      TEXT;
  v_cogs_je_id    UUID;
  v_cogs_entry    TEXT;
  v_seq           BIGINT;
  -- COA account IDs
  v_ar_id         UUID;  -- 1200
  v_revenue_id    UUID;  -- 4100
  v_vat_id        UUID;  -- 2200
  v_inv_id        UUID;  -- 1300
  v_cogs_id       UUID;  -- 5100
  -- Per-item
  v_restock_cost  NUMERIC(15,2);
  v_total_restock NUMERIC(15,2) := 0;
  v_prev_wh_qty   NUMERIC(15,3);
  v_new_mac       NUMERIC(15,2);
  v_old_qty       NUMERIC(15,3);
  v_old_value     NUMERIC(15,2);
  v_wh_id         UUID;
  v_line_wh_id    UUID;   -- phase83: per-line restock warehouse
  v_round_off_acc UUID;
BEGIN
  -- 1. Resolve company
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_credit_note: no company for user %', v_user_id;
  END IF;

  -- 2. Load credit note
  SELECT * INTO v_cn FROM public.credit_notes WHERE id = p_credit_note_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_credit_note: credit note % not found', p_credit_note_id;
  END IF;
  IF v_cn.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_credit_note: not in draft (status=%)', v_cn.status;
  END IF;

  -- 3. Period lock
  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_cn.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_credit_note: date % on or before period lock %', v_cn.date, v_lock_date;
  END IF;

  -- ---- Phase 73 (R2b) over-return guard ----------------------------------
  -- A credit note can be raised directly, without ever passing through a
  -- sales return, so the check has to live here too. Only lines that name a
  -- source line are checked: a standalone credit note (goodwill, price
  -- adjustment, no linked invoice) is deliberately unaffected.
  FOR v_over IN
    SELECT cni.quantity,
           COALESCE(cni.description, '(line)') AS descr,
           vr.qty_returnable
    FROM public.credit_note_items cni
    JOIN public.v_invoice_line_returnable vr
      ON vr.invoice_item_id = cni.invoice_item_id
    WHERE cni.credit_note_id = p_credit_note_id
      AND cni.invoice_item_id IS NOT NULL
  LOOP
    IF v_over.quantity > COALESCE(v_over.qty_returnable, 0) THEN
      RAISE EXCEPTION 'confirm_credit_note: crediting % of "%" but only % remain returnable on that invoice line',
        v_over.quantity, v_over.descr, COALESCE(v_over.qty_returnable, 0);
    END IF;
  END LOOP;
  -- ---- end Phase 73 ------------------------------------------------------

  SELECT COALESCE(currency, 'AED') INTO v_currency FROM public.companies WHERE id = v_company_id;

  -- 4. Resolve COA
  SELECT id INTO v_ar_id      FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1200' AND is_active;
  SELECT id INTO v_revenue_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '4100' AND is_active;
  SELECT id INTO v_inv_id     FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1300' AND is_active;
  SELECT id INTO v_cogs_id    FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '5100' AND is_active;
  IF v_cn.tax_amount > 0 THEN
    SELECT id INTO v_vat_id FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND code LIKE '22%' AND is_active ORDER BY code LIMIT 1;
  END IF;

  IF v_ar_id IS NULL THEN RAISE EXCEPTION 'confirm_credit_note: account 1200 not found'; END IF;
  IF v_revenue_id IS NULL THEN RAISE EXCEPTION 'confirm_credit_note: account 4100 not found'; END IF;

  -- 5. Default warehouse
  v_wh_id := v_cn.warehouse_id;
  IF v_wh_id IS NULL THEN
    SELECT id INTO v_wh_id FROM public.warehouses WHERE company_id = v_company_id AND is_default LIMIT 1;
  END IF;

  -- 6. Generate JE for the header (sales_credit_note)
  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_seq;
  v_je_entry := 'JE-' || v_seq::TEXT;

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, currency, exchange_rate,
    total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_je_entry, v_cn.date,
    'Credit Note ' || v_cn.credit_note_number,
    'sales_credit_note', p_credit_note_id,
    v_currency, 1.0,
    v_cn.total_amount + GREATEST(-COALESCE(v_cn.round_off_amount, 0), 0),
    v_cn.total_amount + GREATEST(-COALESCE(v_cn.round_off_amount, 0), 0),
    v_user_id
  ) RETURNING id INTO v_je_id;

  -- 6a. Dr 4100 Sales Revenue reversal
  IF (v_cn.total_amount - v_cn.tax_amount - COALESCE(v_cn.round_off_amount, 0)) > 0 THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
       description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_revenue_id, '4100', v_cn.date,
       v_cn.total_amount - v_cn.tax_amount - COALESCE(v_cn.round_off_amount, 0), 0,
       'Revenue reversal ' || v_cn.credit_note_number,
       v_cn.contact_id, 'credit_note', p_credit_note_id);
  END IF;

  -- 6b. Dr 2200 Output VAT reversal
  IF v_cn.tax_amount > 0 AND v_vat_id IS NOT NULL THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
       description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_vat_id, '2200', v_cn.date,
       v_cn.tax_amount, 0,
       'VAT reversal ' || v_cn.credit_note_number,
       v_cn.contact_id, 'credit_note', p_credit_note_id);
  END IF;

  -- 6c. Cr 1200 AR reduction
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
     description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_ar_id, '1200', v_cn.date,
     0, v_cn.total_amount,
     'AR reduction ' || v_cn.credit_note_number,
     v_cn.contact_id, 'credit_note', p_credit_note_id);

  -- Phase 46 — round-off reversal (Dr 5900 when the original rounded up).
  IF COALESCE(v_cn.round_off_amount, 0) <> 0 THEN
    v_round_off_acc := public.ensure_round_off_account(v_company_id);
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
       description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_round_off_acc, '5900', v_cn.date,
       GREATEST(v_cn.round_off_amount, 0), GREATEST(-v_cn.round_off_amount, 0),
       'Round Off ' || v_cn.credit_note_number,
       v_cn.contact_id, 'credit_note', p_credit_note_id);
  END IF;

  -- 7. If restock=true: per-line COGS reversal + stock_ledger (A9)
  IF v_cn.restock THEN
    FOR v_item IN SELECT * FROM public.credit_note_items WHERE credit_note_id = p_credit_note_id LOOP
      CONTINUE WHEN v_item.product_id IS NULL;
      CONTINUE WHEN COALESCE(v_item.cost_at_sale, 0) = 0;

      v_restock_cost := v_item.quantity * v_item.cost_at_sale;
      v_total_restock := v_total_restock + v_restock_cost;

      -- phase83: the line may nominate its own warehouse (quarantine for
      -- damaged goods, a different branch); fall back to the document.
      v_line_wh_id := COALESCE(v_item.restock_warehouse_id, v_wh_id);

      -- Stock ledger: restock at original cost_at_sale
      SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_wh_qty
      FROM public.stock_ledger
      WHERE company_id = v_company_id AND product_id = v_item.product_id AND warehouse_id = v_line_wh_id
      ORDER BY seq DESC LIMIT 1;
      v_prev_wh_qty := COALESCE(v_prev_wh_qty, 0);

      -- Company-wide MAC update for return
      SELECT COALESCE(SUM(latest_qty), 0), COALESCE(SUM(latest_value), 0)
      INTO v_old_qty, v_old_value
      FROM (
        SELECT DISTINCT ON (warehouse_id)
          running_qty AS latest_qty,
          running_qty * running_avg_cost AS latest_value
        FROM public.stock_ledger
        WHERE company_id = v_company_id AND product_id = v_item.product_id
        ORDER BY warehouse_id, seq DESC
      ) sub;

      v_old_qty   := COALESCE(v_old_qty, 0);
      v_old_value := COALESCE(v_old_value, 0);

      IF (v_old_qty + v_item.quantity) = 0 THEN
        v_new_mac := v_item.cost_at_sale;
      ELSE
        v_new_mac := (v_old_value + v_restock_cost) / (v_old_qty + v_item.quantity);
      END IF;

      INSERT INTO public.stock_ledger
        (company_id, product_id, warehouse_id, date,
         type, direction, quantity, unit_cost, total_cost,
         running_qty, running_avg_cost,
         related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_item.product_id, v_line_wh_id, v_cn.date,
         'sales_return', 1, v_item.quantity, v_item.cost_at_sale, v_restock_cost,
         v_prev_wh_qty + v_item.quantity, v_new_mac,
         'credit_note', p_credit_note_id);
    END LOOP;

    -- Post COGS reversal JE if any items restocked
    IF v_total_restock > 0 THEN
      IF v_inv_id IS NULL THEN RAISE EXCEPTION 'confirm_credit_note: account 1300 not found'; END IF;
      IF v_cogs_id IS NULL THEN RAISE EXCEPTION 'confirm_credit_note: account 5100 not found'; END IF;

      INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
      VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
      ON CONFLICT (company_id, prefix) DO UPDATE
        SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
      RETURNING current_value INTO v_seq;
      v_cogs_entry := 'JE-' || v_seq::TEXT;

      INSERT INTO public.journal_entries (
        company_id, entry_number, date, description,
        source_type, source_id, currency, exchange_rate,
        total_debit, total_credit, created_by
      ) VALUES (
        v_company_id, v_cogs_entry, v_cn.date,
        'COGS Reversal – ' || v_cn.credit_note_number,
        'inventory_cogs', p_credit_note_id,
        v_currency, 1.0,
        v_total_restock, v_total_restock,
        v_user_id
      ) RETURNING id INTO v_cogs_je_id;

      -- Dr 1300 Inventory Asset
      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
         description, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_cogs_je_id, v_inv_id, '1300', v_cn.date,
         v_total_restock, 0,
         'Restock ' || v_cn.credit_note_number, 'credit_note', p_credit_note_id);

      -- Cr 5100 COGS
      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
         description, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_cogs_je_id, v_cogs_id, '5100', v_cn.date,
         0, v_total_restock,
         'COGS reversal ' || v_cn.credit_note_number, 'credit_note', p_credit_note_id);
    END IF;
  END IF;

  -- 8. Confirm
  UPDATE public.credit_notes
  SET status = 'confirmed', updated_at = NOW()
  WHERE id = p_credit_note_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'credit_note', p_credit_note_id,
      jsonb_build_object('credit_note_number', v_cn.credit_note_number, 'je', v_je_entry));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'credit_note_id',     p_credit_note_id,
    'credit_note_number', v_cn.credit_note_number,
    'journal_entry_id',   v_je_id,
    'entry_number',       v_je_entry
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.confirm_debit_note(p_debit_note_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id       UUID := auth.uid();
  v_company_id    UUID;
  v_dn            public.debit_notes%ROWTYPE;
  v_item          public.debit_note_items%ROWTYPE;
  v_over          RECORD;   -- Phase 74
  v_lock_date     DATE;
  v_currency      TEXT;
  -- JE
  v_je_id         UUID;
  v_je_entry      TEXT;
  v_seq           BIGINT;
  -- COA
  v_ap_id         UUID;  -- 2100 AP
  v_inv_id        UUID;  -- 1300 Inventory
  v_vat_id        UUID;  -- 1500 Input VAT
  v_cogs_id       UUID;  -- 5100, phase81 fallback for services
  v_svc_exp_id    UUID;  -- phase81: first active 5xxx expense
  v_product_type  TEXT;  -- phase81
  v_line_acct_id  UUID;  -- phase81
  v_line_class    TEXT;  -- phase81
  v_line_code     TEXT;  -- phase81
  -- Per-item stock
  v_prev_wh_qty   NUMERIC(15,3);
  v_old_qty       NUMERIC(15,3);
  v_old_value     NUMERIC(15,2);
  v_new_mac       NUMERIC(15,2);
  v_item_cost     NUMERIC(15,2);
  v_total_inv_credit NUMERIC(15,2) := 0;
  v_eff_unit      NUMERIC(15,4);   -- phase80
  v_wh_id         UUID;
  v_line_wh_id    UUID;   -- phase83: per-line restock warehouse
  v_round_off_acc UUID;
BEGIN
  -- 1. Resolve company
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_debit_note: no company for user %', v_user_id;
  END IF;

  -- 2. Load debit note
  SELECT * INTO v_dn FROM public.debit_notes WHERE id = p_debit_note_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_debit_note: debit note % not found', p_debit_note_id;
  END IF;
  IF v_dn.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_debit_note: not in draft (status=%)', v_dn.status;
  END IF;

  -- 3. Period lock
  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_dn.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_debit_note: date % on or before period lock %', v_dn.date, v_lock_date;
  END IF;

  -- ---- Phase 74 (R2c) over-return guard ----------------------------------
  -- Mirror of the sales side, with one deliberate difference: the link is
  -- OPTIONAL here. A debit note is typed directly rather than generated from
  -- a return document, and legitimately carries lines that were never on the
  -- bill -- a freight adjustment, a short-shipment claim -- as well as
  -- standalone notes with no linked bill at all. So only lines that NAME a
  -- bill line are bound; everything else passes untouched.
  --
  -- Note the other asymmetry: unit_cost is entered by the operator on this
  -- side, so there is no equivalent of the sales-side mis-pricing bug. What
  -- was missing was any notion of how much of a bill line had already gone
  -- back, which is what this closes.
  FOR v_over IN
    SELECT dni.quantity,
           COALESCE(dni.description, '(line)') AS descr,
           vr.qty_returnable
    FROM public.debit_note_items dni
    JOIN public.v_bill_line_returnable vr
      ON vr.vendor_bill_item_id = dni.vendor_bill_item_id
    WHERE dni.debit_note_id = p_debit_note_id
      AND dni.vendor_bill_item_id IS NOT NULL
  LOOP
    IF v_over.quantity > COALESCE(v_over.qty_returnable, 0) THEN
      RAISE EXCEPTION 'confirm_debit_note: returning % of "%" but only % remain returnable on that bill line',
        v_over.quantity, v_over.descr, COALESCE(v_over.qty_returnable, 0);
    END IF;
  END LOOP;
  -- ---- end Phase 74 ------------------------------------------------------

  SELECT COALESCE(currency, 'AED') INTO v_currency FROM public.companies WHERE id = v_company_id;

  -- 4. Resolve COA
  SELECT id INTO v_ap_id  FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2100' AND is_active;
  SELECT id INTO v_inv_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1300' AND is_active;
  IF v_dn.tax_amount > 0 THEN
    SELECT id INTO v_vat_id FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND code = '1500' AND is_active;
  END IF;

  -- phase81: the same two the inbound side keeps for service lines.
  SELECT id INTO v_cogs_id FROM public.chart_of_accounts
   WHERE company_id = v_company_id AND code = '5100' AND is_active;
  SELECT id INTO v_svc_exp_id FROM public.chart_of_accounts
   WHERE company_id = v_company_id AND type = 'expense' AND code LIKE '5%' AND is_active
   ORDER BY code LIMIT 1;

  IF v_ap_id IS NULL THEN RAISE EXCEPTION 'confirm_debit_note: account 2100 not found'; END IF;

  -- 5. Default warehouse
  v_wh_id := v_dn.warehouse_id;
  IF v_wh_id IS NULL THEN
    SELECT id INTO v_wh_id FROM public.warehouses WHERE company_id = v_company_id AND is_default LIMIT 1;
  END IF;

  -- 6. Generate JE number
  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_seq;
  v_je_entry := 'JE-' || v_seq::TEXT;

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, currency, exchange_rate,
    total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_je_entry, v_dn.date,
    'Debit Note ' || v_dn.debit_note_number,
    'vendor_debit_note', p_debit_note_id,
    v_currency, 1.0,
    v_dn.total_amount + GREATEST(-COALESCE(v_dn.round_off_amount, 0), 0),
    v_dn.total_amount + GREATEST(-COALESCE(v_dn.round_off_amount, 0), 0),
    v_user_id
  ) RETURNING id INTO v_je_id;

  -- 7. Dr 2100 AP
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
     description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_ap_id, '2100', v_dn.date,
     v_dn.total_amount, 0,
     'AP reduction ' || v_dn.debit_note_number,
     v_dn.supplier_id, 'debit_note', p_debit_note_id);

  -- Phase 46 — round-off reversal (Cr 5900 when the original bill rounded up).
  IF COALESCE(v_dn.round_off_amount, 0) <> 0 THEN
    v_round_off_acc := public.ensure_round_off_account(v_company_id);
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
       description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_round_off_acc, '5900', v_dn.date,
       GREATEST(-v_dn.round_off_amount, 0), GREATEST(v_dn.round_off_amount, 0),
       'Round Off ' || v_dn.debit_note_number,
       v_dn.supplier_id, 'debit_note', p_debit_note_id);
  END IF;

  -- 8. Cr 1500 Input VAT reversal
  IF v_dn.tax_amount > 0 AND v_vat_id IS NOT NULL THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
       description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_vat_id, '1500', v_dn.date,
       0, v_dn.tax_amount,
       'Input VAT reversal ' || v_dn.debit_note_number,
       v_dn.supplier_id, 'debit_note', p_debit_note_id);
  END IF;

  -- 9. Process items: stock return + compute total inventory credit
  FOR v_item IN SELECT * FROM public.debit_note_items WHERE debit_note_id = p_debit_note_id LOOP
    v_item_cost := v_item.line_total - v_item.tax_amount;

    -- phase81: resolve the account this line belongs to, by exactly the rule
    -- confirm_vendor_bill uses on the way in. Crediting everything to 1300
    -- meant a returned SERVICE reduced inventory that never held it.
    v_product_type := NULL;
    v_line_acct_id := NULL;
    IF v_item.product_id IS NOT NULL THEN
      SELECT p.type, p.purchase_account_id INTO v_product_type, v_line_acct_id
        FROM public.products p WHERE p.id = v_item.product_id;
      IF v_line_acct_id IS NULL THEN
        IF v_product_type = 'service' THEN
          v_line_acct_id := COALESCE(v_svc_exp_id, v_cogs_id);
          IF v_line_acct_id IS NULL THEN
            RAISE EXCEPTION 'confirm_debit_note: no expense account found for service line - set a purchase account on the product';
          END IF;
        ELSE
          v_line_acct_id := v_inv_id;
        END IF;
      END IF;
    ELSE
      -- No product and no coa_account_id column on this table: 1300, which is
      -- also where confirm_vendor_bill lands an unclassified line.
      v_line_acct_id := v_inv_id;
    END IF;

    SELECT type, code INTO v_line_class, v_line_code
      FROM public.chart_of_accounts WHERE id = v_line_acct_id;

    IF v_line_acct_id IS NOT DISTINCT FROM v_inv_id THEN
      -- Unchanged path: still one aggregate 1300 credit for goods.
      v_total_inv_credit := v_total_inv_credit + v_item_cost;
    ELSIF v_item_cost <> 0 THEN
      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
         description, contact_id, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_je_id, v_line_acct_id, v_line_code, v_dn.date,
         0, v_item_cost,
         COALESCE(v_item.description, 'Debit Note ' || v_dn.debit_note_number),
         v_dn.supplier_id, 'debit_note', p_debit_note_id);
    END IF;

    -- Stock ledger if product present (B9 return)
    IF v_item.product_id IS NOT NULL AND v_item.unit_cost > 0 AND v_item_cost > 0
       AND v_product_type IS DISTINCT FROM 'service'   -- phase81: services never stock
       AND v_line_class = 'asset' THEN                 -- phase81: nor does an expense line
      -- phase83: honour a line-level warehouse, falling back to the document.
      v_line_wh_id := COALESCE(v_item.restock_warehouse_id, v_wh_id);

      -- Per-warehouse running qty
      SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_wh_qty
      FROM public.stock_ledger
      WHERE company_id = v_company_id AND product_id = v_item.product_id AND warehouse_id = v_line_wh_id
      ORDER BY seq DESC LIMIT 1;
      v_prev_wh_qty := COALESCE(v_prev_wh_qty, 0);

      -- Company-wide MAC recalc after removing qty
      SELECT COALESCE(SUM(latest_qty), 0), COALESCE(SUM(latest_value), 0)
      INTO v_old_qty, v_old_value
      FROM (
        SELECT DISTINCT ON (warehouse_id)
          running_qty AS latest_qty,
          running_qty * running_avg_cost AS latest_value
        FROM public.stock_ledger
        WHERE company_id = v_company_id AND product_id = v_item.product_id
        ORDER BY warehouse_id, seq DESC
      ) sub;

      v_old_qty   := COALESCE(v_old_qty, 0);
      v_old_value := COALESCE(v_old_value, 0);

      IF (v_old_qty - v_item.quantity) <= 0 THEN
        v_new_mac := 0;
      ELSE
        v_new_mac := (v_old_value - v_item_cost) / (v_old_qty - v_item.quantity);
      END IF;

      -- phase80: the per-unit figure that matches v_item_cost, derived the
      -- same way confirm_vendor_bill derives v_eff_unit on the way in.
      v_eff_unit := ROUND(v_item_cost / v_item.quantity, 4);

      INSERT INTO public.stock_ledger
        (company_id, product_id, warehouse_id, date,
         type, direction, quantity, unit_cost, total_cost,
         running_qty, running_avg_cost,
         related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_item.product_id, v_line_wh_id, v_dn.date,
         'purchase_return', -1, v_item.quantity, v_eff_unit,
         v_item_cost,
         v_prev_wh_qty - v_item.quantity, GREATEST(v_new_mac, 0),
         'debit_note', p_debit_note_id);
    END IF;
  END LOOP;

  -- 10. Cr 1300 Inventory Asset (total net return value)
  IF v_total_inv_credit > 0 AND v_inv_id IS NOT NULL THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
       description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_inv_id, '1300', v_dn.date,
       0, v_total_inv_credit,
       'Inventory return ' || v_dn.debit_note_number,
       v_dn.supplier_id, 'debit_note', p_debit_note_id);
  END IF;

  -- 11. Confirm
  UPDATE public.debit_notes
  SET status = 'confirmed', updated_at = NOW()
  WHERE id = p_debit_note_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'debit_note', p_debit_note_id,
      jsonb_build_object('debit_note_number', v_dn.debit_note_number, 'je', v_je_entry));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'debit_note_id',     p_debit_note_id,
    'debit_note_number', v_dn.debit_note_number,
    'journal_entry_id',  v_je_id,
    'entry_number',      v_je_entry
  );
END;
$function$;


NOTIFY pgrst, 'reload schema';
