-- Phase 7 — confirm_pos_sale RPC
-- Creates an invoice atomically from POS cart data.
-- Handles A2 (cash), A3 (card), A4 (credit) GL postings + A1.b COGS.
-- Updates pos_session totals on each sale.
-- Returns: { invoice_id, invoice_number, total_amount }

CREATE OR REPLACE FUNCTION public.confirm_pos_sale(
  p_session_id      UUID,
  p_items           JSONB,    -- [{product_id, description, quantity, unit_price, discount_percent, tax_rate}]
  p_payment_method  TEXT,     -- 'cash' | 'card' | 'credit'
  p_customer_id     UUID    DEFAULT NULL,
  p_notes           TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_company_id    UUID;
  v_currency      TEXT;
  v_session       public.pos_sessions%ROWTYPE;
  v_lock_date     DATE;
  v_today         DATE := CURRENT_DATE;

  -- Invoice totals (accumulated over items)
  v_subtotal      NUMERIC(15,2) := 0;
  v_discount      NUMERIC(15,2) := 0;
  v_tax_total     NUMERIC(15,2) := 0;
  v_grand_total   NUMERIC(15,2) := 0;

  -- Per-item working vars
  v_elem          JSONB;
  v_product_id    UUID;
  v_item_qty      NUMERIC(15,3);
  v_item_price    NUMERIC(15,2);
  v_item_disc_pct NUMERIC(7,2);
  v_item_disc_amt NUMERIC(15,2);
  v_item_tax_rate NUMERIC(7,2);
  v_item_sub      NUMERIC(15,2);
  v_item_tax      NUMERIC(15,2);
  v_item_total    NUMERIC(15,2);
  v_item_id       UUID;
  v_sort          INT := 0;

  -- Document numbers / IDs
  v_seq           BIGINT;
  v_inv_number    TEXT;
  v_inv_id        UUID;
  v_je_id         UUID;
  v_cogs_je_id    UUID;
  v_entry         TEXT;
  v_cogs_entry    TEXT;

  -- GL account IDs
  v_debit_id      UUID;
  v_debit_code    TEXT;
  v_sales_id      UUID;
  v_vat_id        UUID;
  v_cogs_id       UUID;
  v_inv_acc_id    UUID;

  -- COGS accumulation
  v_current_mac   NUMERIC(15,2);
  v_prev_running  NUMERIC(15,3);
  v_total_cogs    NUMERIC(15,2) := 0;
BEGIN
  -- ── Resolve company ──────────────────────────────────────────────────────
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_pos_sale: no company for user %', v_user_id;
  END IF;

  SELECT base_currency INTO v_currency FROM public.companies WHERE id = v_company_id;

  -- ── Load + validate session ───────────────────────────────────────────────
  SELECT * INTO v_session
  FROM public.pos_sessions
  WHERE id = p_session_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_pos_sale: session % not found', p_session_id;
  END IF;
  IF v_session.status <> 'open' THEN
    RAISE EXCEPTION 'confirm_pos_sale: session % is not open', p_session_id;
  END IF;

  -- ── Period lock ───────────────────────────────────────────────────────────
  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_today <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_pos_sale: today is in locked period (lock=%)', v_lock_date;
  END IF;

  -- ── Validate payment method + customer ────────────────────────────────────
  CASE p_payment_method
    WHEN 'cash'   THEN v_debit_code := '1100';
    WHEN 'card'   THEN v_debit_code := '1110';
    WHEN 'credit' THEN
      v_debit_code := '1200';
      IF p_customer_id IS NULL THEN
        RAISE EXCEPTION 'confirm_pos_sale: customer_id required for credit sale';
      END IF;
    ELSE
      RAISE EXCEPTION 'confirm_pos_sale: unknown payment method %', p_payment_method;
  END CASE;

  -- ── Resolve GL accounts ───────────────────────────────────────────────────
  SELECT id INTO v_debit_id    FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = v_debit_code AND is_active LIMIT 1;
  SELECT id INTO v_sales_id    FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '4100'       AND is_active LIMIT 1;
  SELECT id INTO v_cogs_id     FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '5100'       AND is_active LIMIT 1;
  SELECT id INTO v_inv_acc_id  FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1300'       AND is_active LIMIT 1;
  SELECT id INTO v_vat_id      FROM public.chart_of_accounts WHERE company_id = v_company_id AND code LIKE '22%'     AND is_active ORDER BY code LIMIT 1;

  -- ── Pass 1: compute totals ────────────────────────────────────────────────
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_qty      := (v_elem->>'quantity')::NUMERIC;
    v_item_price    := (v_elem->>'unit_price')::NUMERIC;
    v_item_disc_pct := COALESCE((v_elem->>'discount_percent')::NUMERIC, 0);
    v_item_tax_rate := COALESCE((v_elem->>'tax_rate')::NUMERIC, 0);
    v_item_sub      := ROUND(v_item_qty * v_item_price, 2);
    v_item_disc_amt := ROUND(v_item_sub * v_item_disc_pct / 100, 2);
    v_item_tax      := ROUND((v_item_sub - v_item_disc_amt) * v_item_tax_rate / 100, 2);
    v_item_total    := (v_item_sub - v_item_disc_amt) + v_item_tax;
    v_subtotal      := v_subtotal + v_item_sub;
    v_discount      := v_discount + v_item_disc_amt;
    v_tax_total     := v_tax_total + v_item_tax;
    v_grand_total   := v_grand_total + v_item_total;
  END LOOP;

  -- ── Invoice number ────────────────────────────────────────────────────────
  INSERT INTO public.document_sequences
    (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES
    (v_company_id, 'INV', 1000, 'INV-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1,
        updated_at    = NOW()
  RETURNING current_value INTO v_seq;
  v_inv_number := 'INV-' || v_seq::TEXT;

  -- ── Create invoice ────────────────────────────────────────────────────────
  INSERT INTO public.invoices (
    company_id, invoice_number, contact_id, warehouse_id,
    date, due_date, currency, exchange_rate,
    subtotal, discount_amount, tax_amount, total_amount,
    status, sale_channel, pos_session_id, notes
  ) VALUES (
    v_company_id, v_inv_number, p_customer_id, v_session.warehouse_id,
    v_today, v_today, v_currency, 1.0,
    v_subtotal, v_discount, v_tax_total, v_grand_total,
    'confirmed',
    CASE p_payment_method
      WHEN 'cash'  THEN 'pos_cash'
      WHEN 'card'  THEN 'pos_card'
      ELSE              'pos_credit'
    END,
    p_session_id, p_notes
  ) RETURNING id INTO v_inv_id;

  -- ── Pass 2: items + stock_ledger ──────────────────────────────────────────
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id    := (v_elem->>'product_id')::UUID;
    v_item_qty      := (v_elem->>'quantity')::NUMERIC;
    v_item_price    := (v_elem->>'unit_price')::NUMERIC;
    v_item_disc_pct := COALESCE((v_elem->>'discount_percent')::NUMERIC, 0);
    v_item_tax_rate := COALESCE((v_elem->>'tax_rate')::NUMERIC, 0);
    v_item_sub      := ROUND(v_item_qty * v_item_price, 2);
    v_item_disc_amt := ROUND(v_item_sub * v_item_disc_pct / 100, 2);
    v_item_tax      := ROUND((v_item_sub - v_item_disc_amt) * v_item_tax_rate / 100, 2);
    v_item_total    := (v_item_sub - v_item_disc_amt) + v_item_tax;
    v_sort          := v_sort + 1;

    -- Get MAC (company-wide, latest)
    SELECT COALESCE(running_avg_cost, 0)::NUMERIC(15,2)
    INTO v_current_mac
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_product_id
    ORDER BY created_at DESC LIMIT 1;
    v_current_mac := COALESCE(v_current_mac, 0);

    INSERT INTO public.invoice_items (
      invoice_id, product_id, description,
      quantity, unit_price,
      discount_percent, discount_amount,
      tax_rate, tax_amount,
      line_subtotal, line_total,
      cost_at_sale, sort_order
    ) VALUES (
      v_inv_id, v_product_id,
      COALESCE(v_elem->>'description', ''),
      v_item_qty, v_item_price,
      v_item_disc_pct, v_item_disc_amt,
      v_item_tax_rate, v_item_tax,
      v_item_sub - v_item_disc_amt, v_item_total,
      v_current_mac, v_sort
    ) RETURNING id INTO v_item_id;

    -- Stock outbound + COGS accumulation
    IF v_current_mac > 0 THEN
      v_total_cogs := v_total_cogs + ROUND(v_item_qty * v_current_mac, 2);

      SELECT COALESCE(running_qty, 0)::NUMERIC(15,3)
      INTO v_prev_running
      FROM public.stock_ledger
      WHERE company_id = v_company_id
        AND product_id = v_product_id
        AND warehouse_id = v_session.warehouse_id
      ORDER BY created_at DESC LIMIT 1;
      v_prev_running := COALESCE(v_prev_running, 0);

      INSERT INTO public.stock_ledger (
        company_id, product_id, warehouse_id, date,
        type, direction, quantity, unit_cost, total_cost,
        running_qty, running_avg_cost,
        related_doc_type, related_doc_id
      ) VALUES (
        v_company_id, v_product_id, v_session.warehouse_id, v_today,
        'sale', -1, v_item_qty, v_current_mac, ROUND(v_item_qty * v_current_mac, 2),
        v_prev_running - v_item_qty, v_current_mac,
        'invoice', v_inv_id
      );
    ELSE
      -- Deferred COGS when MAC not yet established
      INSERT INTO public.deferred_cogs_queue
        (company_id, product_id, invoice_item_id, sale_invoice_id,
         sale_date, warehouse_id, quantity, status)
      VALUES
        (v_company_id, v_product_id, v_item_id, v_inv_id,
         v_today, v_session.warehouse_id, v_item_qty, 'pending');
    END IF;
  END LOOP;

  -- ── Sales GL entry (A2 / A3 / A4) ────────────────────────────────────────
  INSERT INTO public.document_sequences
    (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES
    (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1,
        updated_at    = NOW()
  RETURNING current_value INTO v_seq;
  v_entry := 'JE-' || v_seq::TEXT;

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, currency, exchange_rate,
    total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_entry, v_today,
    CASE p_payment_method
      WHEN 'cash'  THEN 'POS Cash '
      WHEN 'card'  THEN 'POS Card '
      ELSE              'POS Credit '
    END || v_inv_number,
    CASE p_payment_method
      WHEN 'cash'  THEN 'pos_cash_sale'
      WHEN 'card'  THEN 'pos_card_sale'
      ELSE              'sales_invoice'
    END,
    v_inv_id, v_currency, 1.0,
    v_grand_total, v_grand_total, v_user_id
  ) RETURNING id INTO v_je_id;

  -- DR cash / bank / AR
  INSERT INTO public.general_ledger (
    company_id, journal_entry_id, account_id, account_code, date,
    debit, credit, description, contact_id, related_doc_type, related_doc_id
  ) VALUES (
    v_company_id, v_je_id, v_debit_id, v_debit_code, v_today,
    v_grand_total, 0,
    v_inv_number, p_customer_id, 'invoice', v_inv_id
  );

  -- CR 4100 Sales Revenue
  INSERT INTO public.general_ledger (
    company_id, journal_entry_id, account_id, account_code, date,
    debit, credit, description, contact_id, related_doc_type, related_doc_id
  ) VALUES (
    v_company_id, v_je_id, v_sales_id, '4100', v_today,
    0, v_subtotal - v_discount,
    v_inv_number, p_customer_id, 'invoice', v_inv_id
  );

  -- CR 2200 Output VAT (if any)
  IF v_tax_total > 0 AND v_vat_id IS NOT NULL THEN
    INSERT INTO public.general_ledger (
      company_id, journal_entry_id, account_id, account_code, date,
      debit, credit, description, contact_id, related_doc_type, related_doc_id
    ) VALUES (
      v_company_id, v_je_id, v_vat_id, '2200', v_today,
      0, v_tax_total,
      'VAT ' || v_inv_number, p_customer_id, 'invoice', v_inv_id
    );
  END IF;

  -- ── COGS GL entry (A1.b) ──────────────────────────────────────────────────
  IF v_total_cogs > 0 THEN
    INSERT INTO public.document_sequences
      (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES
      (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE
      SET current_value = public.document_sequences.current_value + 1,
          updated_at    = NOW()
    RETURNING current_value INTO v_seq;
    v_cogs_entry := 'JE-' || v_seq::TEXT;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description,
      source_type, source_id, currency, exchange_rate,
      total_debit, total_credit, created_by
    ) VALUES (
      v_company_id, v_cogs_entry, v_today,
      'COGS – ' || v_inv_number,
      'inventory_cogs', v_inv_id, v_currency, 1.0,
      v_total_cogs, v_total_cogs, v_user_id
    ) RETURNING id INTO v_cogs_je_id;

    -- DR 5100 COGS
    INSERT INTO public.general_ledger (
      company_id, journal_entry_id, account_id, account_code, date,
      debit, credit, description, related_doc_type, related_doc_id
    ) VALUES (
      v_company_id, v_cogs_je_id, v_cogs_id, '5100', v_today,
      v_total_cogs, 0, 'COGS ' || v_inv_number, 'invoice', v_inv_id
    );

    -- CR 1300 Inventory
    INSERT INTO public.general_ledger (
      company_id, journal_entry_id, account_id, account_code, date,
      debit, credit, description, related_doc_type, related_doc_id
    ) VALUES (
      v_company_id, v_cogs_je_id, v_inv_acc_id, '1300', v_today,
      0, v_total_cogs, 'COGS ' || v_inv_number, 'invoice', v_inv_id
    );
  END IF;

  -- ── Update session totals ──────────────────────────────────────────────────
  UPDATE public.pos_sessions SET
    total_sales_amount = COALESCE(total_sales_amount, 0) + v_grand_total,
    total_sales_count  = COALESCE(total_sales_count, 0) + 1,
    updated_at         = NOW()
  WHERE id = p_session_id;

  -- ── Audit log ──────────────────────────────────────────────────────────────
  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'pos_sale', v_inv_id,
      jsonb_build_object('invoice_number', v_inv_number, 'payment_method', p_payment_method,
                         'total', v_grand_total, 'session', p_session_id));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'invoice_id',     v_inv_id,
    'invoice_number', v_inv_number,
    'total_amount',   v_grand_total
  );
END;
$$;
