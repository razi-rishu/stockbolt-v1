-- ============================================================================
-- Phase 73 (R2b) — use the return line linkage: correct price, no over-return
--
-- Phase 72 added the link. This makes the posting path read it.
--
-- WHAT CHANGES
--
-- 1. PRICE COMES FROM THE LINE THE OPERATOR CHOSE.
--    confirm_sales_return used to find the source line by PRODUCT:
--        LEFT JOIN LATERAL (SELECT * FROM invoice_items
--          WHERE invoice_id = ... AND product_id = sri.product_id
--          ORDER BY sort_order LIMIT 1)
--    When one product appears twice on an invoice at two prices it always took
--    the first. Pro_Parts INV-1012 carries the same pad kit at sort 0 @ 83 and
--    sort 1 @ 125 — returning either one credited 83. Now it joins on
--    sri.invoice_item_id, so the customer is credited what they actually paid.
--
-- 2. NO SILENT ZERO CREDIT. A line with no source line used to yield NULL from
--    that join; COALESCE made the price 0, the stock came back, and the
--    customer was credited nothing, with no error. It is now refused.
--
-- 3. NO OVER-RETURN. Nothing totalled prior returns, so 10 units sold could be
--    returned 4 + 4 + 4, each one restocking and crediting. Both
--    confirm_sales_return and confirm_credit_note now refuse to exceed
--    v_invoice_line_returnable.
--
-- The guard lives in BOTH because a credit note can be raised directly without
-- ever passing through a sales return. Only lines carrying invoice_item_id are
-- checked, so a standalone credit note — goodwill, price adjustment, no linked
-- invoice — is deliberately unaffected.
--
-- DOUBLE ENTRY
-- Unchanged. confirm_sales_return posts nothing at all (it builds a draft
-- credit note; the credit note does the accounting), and the guards added to
-- confirm_credit_note only RAISE — its six general_ledger INSERTs are
-- reproduced byte-for-byte and a tripwire pins that count. What does change is
-- the AMOUNT on a mis-priced return, and both legs move together, so the entry
-- balances either way — it is simply now the right number.
--
-- SHIPS WITH THE UI. The editor never set invoice_item_id, so guard 2 would
-- reject every new return on its own. The line-picker import that sets it is
-- part of this same increment, not a follow-up.
--
-- Bodies reproduced verbatim from the live pg_get_functiondef.
-- REQUIRES phase 72. Additive and idempotent. Safe to re-run.
-- ============================================================================


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
      invoice_item_id   -- Phase 73: what makes returned-to-date countable
    ) VALUES (
      v_cn_id, v_item.product_id, v_item.inv_desc, v_item.inv_desc_ar, v_item.qty_returned, v_item.inv_unit_id,
      v_unit_price, v_disc_pct, v_disc_amt, v_tax_cat, v_tax_rate, v_line_tax,
      v_line_sub, v_line_sub + v_line_tax, v_sort, v_cost,
      v_item.invoice_item_id
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

      -- Stock ledger: restock at original cost_at_sale
      SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_wh_qty
      FROM public.stock_ledger
      WHERE company_id = v_company_id AND product_id = v_item.product_id AND warehouse_id = v_wh_id
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
        (v_company_id, v_item.product_id, v_wh_id, v_cn.date,
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
