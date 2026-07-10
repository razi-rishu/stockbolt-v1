-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 45: salesperson ↔ commission attribution on returns
-- ─────────────────────────────────────────────────────────────────────────
-- The Sales by Salesperson report now deducts confirmed credit notes from
-- each salesperson's net sales (the commission base). For that to work the
-- credit note must carry the salesperson:
--   1. confirm_sales_return: copy v_inv.salesperson_id onto the CN header
--      (the function already loads the original invoice; it just dropped
--      the salesperson).
--   2. Backfill: existing credit notes linked to an invoice inherit the
--      invoice's salesperson. Additive — only fills NULLs.
-- The credit-note editor (frontend) inherits the salesperson from the
-- linked invoice at save time from this phase onward.
-- Function reproduced from the LIVE definition (pg_get_functiondef).
-- ─────────────────────────────────────────────────────────────────────────

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
  FOR v_item IN
    SELECT sri.product_id, sri.qty_returned, sri.condition, sri.unit_cost,
           ii.unit_price       AS inv_unit_price,
           ii.discount_percent AS inv_disc_pct,
           ii.tax_rate         AS inv_tax_rate,
           ii.tax_category     AS inv_tax_cat,
           ii.unit_id          AS inv_unit_id,
           ii.description      AS inv_desc,
           ii.description_ar   AS inv_desc_ar
    FROM public.sales_return_items sri
    LEFT JOIN LATERAL (
      SELECT * FROM public.invoice_items
      WHERE invoice_id = v_sr.invoice_id AND product_id = sri.product_id
      ORDER BY sort_order LIMIT 1
    ) ii ON TRUE
    WHERE sri.sales_return_id = p_sales_return_id
  LOOP
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
      line_subtotal, line_total, sort_order, cost_at_sale
    ) VALUES (
      v_cn_id, v_item.product_id, v_item.inv_desc, v_item.inv_desc_ar, v_item.qty_returned, v_item.inv_unit_id,
      v_unit_price, v_disc_pct, v_disc_amt, v_tax_cat, v_tax_rate, v_line_tax,
      v_line_sub, v_line_sub + v_line_tax, v_sort, v_cost
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
$function$
;

-- ── Backfill: CN inherits salesperson from its linked invoice ─────────────
UPDATE public.credit_notes cn
SET salesperson_id = inv.salesperson_id
FROM public.invoices inv
WHERE cn.linked_invoice_id = inv.id
  AND cn.salesperson_id IS NULL
  AND inv.salesperson_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
