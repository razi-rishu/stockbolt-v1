-- ─────────────────────────────────────────────────────────────────────────
-- Phase 9 — confirm_credit_note + void_credit_note
-- Doc 3 A9 (with restock) + A10 (without restock)
--
-- confirm_credit_note:
--   Header JE (sales_credit_note):
--     Dr 4100 Sales Revenue    [subtotal - discount]
--     Dr 2200 Output VAT       [tax_amount]
--     Cr 1200 AR               [total_amount]
--
--   Per-line COGS reversal (inventory_cogs, only if restock=true):
--     Dr 1300 Inventory Asset  [qty × cost_at_sale]
--     Cr 5100 COGS             [qty × cost_at_sale]
--   + stock_ledger: type='sales_return', direction=+1
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.confirm_credit_note(p_credit_note_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_company_id    UUID;
  v_cn            public.credit_notes%ROWTYPE;
  v_item          public.credit_note_items%ROWTYPE;
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
    v_cn.total_amount, v_cn.total_amount,
    v_user_id
  ) RETURNING id INTO v_je_id;

  -- 6a. Dr 4100 Sales Revenue reversal
  IF (v_cn.subtotal - v_cn.discount_amount) > 0 THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
       description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_revenue_id, '4100', v_cn.date,
       v_cn.subtotal - v_cn.discount_amount, 0,
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
      ORDER BY created_at DESC LIMIT 1;
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
        ORDER BY warehouse_id, created_at DESC
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
$$;

-- ── void_credit_note ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.void_credit_note(
  p_credit_note_id UUID,
  p_reason         TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_cn         public.credit_notes%ROWTYPE;
  v_lock_date  DATE;
  v_je         public.journal_entries%ROWTYPE;
  v_gl         public.general_ledger%ROWTYPE;
  v_sl         public.stock_ledger%ROWTYPE;
  v_rev_id     UUID;
  v_rev_entry  TEXT;
  v_seq        BIGINT;
  v_prev_running NUMERIC(15,3);
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'void_credit_note: no company for user';
  END IF;

  SELECT * INTO v_cn FROM public.credit_notes WHERE id = p_credit_note_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'void_credit_note: credit note % not found', p_credit_note_id;
  END IF;
  IF v_cn.status <> 'confirmed' THEN
    RAISE EXCEPTION 'void_credit_note: not confirmed (status=%)', v_cn.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND CURRENT_DATE <= v_lock_date THEN
    RAISE EXCEPTION 'void_credit_note: today % on or before period lock %', CURRENT_DATE, v_lock_date;
  END IF;

  -- Reverse all unreversed JEs linked to this credit note
  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id
      AND source_id = p_credit_note_id
      AND reversed_by_id IS NULL
      AND source_type IN ('sales_credit_note', 'inventory_cogs')
  LOOP
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE
      SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
    RETURNING current_value INTO v_seq;
    v_rev_entry := 'JE-' || v_seq::TEXT;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description,
      source_type, source_id, currency, exchange_rate,
      total_debit, total_credit, reversal_of_id, created_by
    ) VALUES (
      v_company_id, v_rev_entry, CURRENT_DATE,
      COALESCE(p_reason, 'Void – ' || v_cn.credit_note_number),
      v_je.source_type, p_credit_note_id,
      v_je.currency, v_je.exchange_rate,
      v_je.total_credit, v_je.total_debit,
      v_je.id, v_user_id
    ) RETURNING id INTO v_rev_id;

    FOR v_gl IN SELECT * FROM public.general_ledger WHERE journal_entry_id = v_je.id LOOP
      INSERT INTO public.general_ledger (
        company_id, journal_entry_id, account_id, account_code, date,
        debit, credit, description,
        contact_id, related_doc_type, related_doc_id, reversal_of_id
      ) VALUES (
        v_company_id, v_rev_id, v_gl.account_id, v_gl.account_code, CURRENT_DATE,
        v_gl.credit, v_gl.debit,
        COALESCE(p_reason, 'Void – ' || v_cn.credit_note_number),
        v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
      );
    END LOOP;

    UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
  END LOOP;

  -- Reverse stock_ledger rows
  FOR v_sl IN
    SELECT * FROM public.stock_ledger
    WHERE company_id = v_company_id
      AND related_doc_id = p_credit_note_id
      AND related_doc_type = 'credit_note'
      AND reversal_of_id IS NULL
  LOOP
    SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_running
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_sl.product_id AND warehouse_id = v_sl.warehouse_id
    ORDER BY created_at DESC LIMIT 1;

    INSERT INTO public.stock_ledger (
      company_id, product_id, warehouse_id, date,
      type, direction, quantity, unit_cost, total_cost,
      running_qty, running_avg_cost,
      related_doc_type, related_doc_id, reversal_of_id
    ) VALUES (
      v_company_id, v_sl.product_id, v_sl.warehouse_id, CURRENT_DATE,
      'void', -v_sl.direction, v_sl.quantity, v_sl.unit_cost, v_sl.total_cost,
      v_prev_running + v_sl.quantity * (-v_sl.direction),
      v_sl.running_avg_cost,
      'credit_note', p_credit_note_id, v_sl.id
    );
  END LOOP;

  UPDATE public.credit_notes
  SET status = 'void', updated_at = NOW()
  WHERE id = p_credit_note_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'void', 'credit_note', p_credit_note_id,
      jsonb_build_object('credit_note_number', v_cn.credit_note_number, 'reason', p_reason));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('credit_note_id', p_credit_note_id, 'credit_note_number', v_cn.credit_note_number);
END;
$$;
