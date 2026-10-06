-- ===========================================================================
-- phase93 - goods that came back are in stock, even when their cost is unknown
--
-- THE BUG
-- "I make 2 pcs invoice, 1 pcs sales return, 1 pcs purchase. What is the final
--  stock count?" The answer is 0. StockBolt said -1.
--
-- confirm_credit_note decided what to restock with:
--
--     CONTINUE WHEN COALESCE(v_item.cost_at_sale, 0) = 0;
--
-- CONTINUE skips the WHOLE line - the stock_ledger insert along with the COGS
-- reversal. So a return whose cost is unknown put nothing back into stock. The
-- customer handed the goods over, the credit note said "restock", the document
-- confirmed without error, and inventory never heard about it.
--
-- Quantity and value are two different facts. We did not know what the item
-- cost; we knew perfectly well that one of them came back.
--
-- WHEN cost_at_sale IS ZERO
-- When the item was sold before it was ever bought. There was no cost to
-- assign at sale time, so the invoice line carries 0, the credit note copies
-- that 0, and the restock was skipped. Pro_Parts' PAD KIT 0301FDR is exactly
-- this: sold twice with nothing purchased, returned once, and stuck at -1.
--
-- confirm_debit_note had the same shape on the purchase side
-- (unit_cost > 0 AND v_item_cost > 0 gating the movement). It had not fired
-- yet. It is fixed here too rather than left to.
--
-- WHAT IS NOT CHANGED
--   * The COGS reversal still only posts when there IS a cost - a zero-value
--     line contributes 0 to v_total_restock, so no journal entry is raised for
--     it. Nothing changes in the ledger; this is purely the stock side.
--   * Service lines are still excluded. On the debit note explicitly, on the
--     credit note by the stock_ledger_a_skip_service trigger, which runs
--     BEFORE INSERT and is named to sort first.
--   * The negative-stock guard is untouched: it exempts inbound rows, so a
--     restock can never be blocked by it.
--
-- A SECOND FIX, in the same loop
-- The moving-average recalculation divided by (old_qty + returned_qty). Stock
-- can be NEGATIVE here - that is the whole situation this arises in - and a
-- negative denominator does not fail, it FLIPS THE SIGN of the average cost.
-- It now divides only when the result is a real holding, and otherwise keeps
-- the cost already on file rather than inventing one or zeroing it.
--
-- SAFE TO APPLY: two CREATE OR REPLACE statements and one backfilled stock
-- movement. Both bodies were read from the LIVE database with
-- pg_get_functiondef and changed only in the places described above; each
-- change was applied by a generator that refused to proceed unless its anchor
-- matched exactly once.
-- ===========================================================================

BEGIN;

-- ──────────────────────────────────────────────────────────── confirm_credit_note
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
  v_prev_wh_mac   NUMERIC(15,4);  -- phase93: last known cost, to hold rather than zero
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
      -- phase93: a line with NO KNOWN COST used to be skipped entirely,
      -- which skipped the QUANTITY as well. The goods physically came
      -- back whether or not we know what they cost, so the movement is
      -- always written; only the VALUE is zero. Service lines are still
      -- excluded, by the stock_ledger_a_skip_service trigger.

      v_restock_cost := v_item.quantity * COALESCE(v_item.cost_at_sale, 0);
      v_total_restock := v_total_restock + v_restock_cost;

      -- phase83: the line may nominate its own warehouse (quarantine for
      -- damaged goods, a different branch); fall back to the document.
      v_line_wh_id := COALESCE(v_item.restock_warehouse_id, v_wh_id);

      -- Stock ledger: restock at original cost_at_sale
      SELECT COALESCE(running_qty, 0)::NUMERIC(15,3), running_avg_cost
        INTO v_prev_wh_qty, v_prev_wh_mac
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

      -- phase93: only divide when the result is a real holding. Stock can
      -- be negative here (sold before bought), and a negative denominator
      -- FLIPS THE SIGN of the average cost rather than failing. When the
      -- quantity nets to zero or stays negative there is no average to
      -- compute, so keep the cost already on file instead of inventing one.
      IF (v_old_qty + v_item.quantity) > 0 THEN
        v_new_mac := (v_old_value + v_restock_cost) / (v_old_qty + v_item.quantity);
      ELSE
        v_new_mac := COALESCE(NULLIF(v_item.cost_at_sale, 0), v_prev_wh_mac, 0);
      END IF;

      INSERT INTO public.stock_ledger
        (company_id, product_id, warehouse_id, date,
         type, direction, quantity, unit_cost, total_cost,
         running_qty, running_avg_cost,
         related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_item.product_id, v_line_wh_id, v_cn.date,
         'sales_return', 1, v_item.quantity, COALESCE(v_item.cost_at_sale, 0), v_restock_cost,
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
$function$
;

-- ──────────────────────────────────────────────────────────── confirm_debit_note
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
    -- phase93: the cost conditions were removed. Goods leaving for a
    -- supplier leave whether or not we know their cost, exactly as on the
    -- sales side. The service and expense-line exclusions STAY: those
    -- never represented stock in the first place.
    IF v_item.product_id IS NOT NULL
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
$function$
;


-- ===========================================================================
-- THE DATA: write the movements the skip swallowed
--
-- Any CONFIRMED credit note that asked to restock, has a product line, and
-- produced no stock row at all. Today that is exactly one (Pro_Parts CN-1004,
-- the PAD KIT), which takes 0301FDR from -1 to 0.
--
-- Dated at the credit note's own date, so the movement sits where the return
-- happened rather than today. Idempotent: a note that already has stock rows
-- is skipped, so applying this twice changes nothing.
-- ===========================================================================

DO $fix$
DECLARE
  v_cn        RECORD;
  v_item      RECORD;
  v_wh        UUID;
  v_prev_qty  NUMERIC(15,3);
  v_prev_mac  NUMERIC(15,4);
  v_old_qty   NUMERIC(15,3);
  v_old_value NUMERIC(15,2);
  v_cost      NUMERIC(15,2);
  v_new_mac   NUMERIC(15,4);
  v_count     INT := 0;
BEGIN
  FOR v_cn IN
    SELECT cn.* FROM public.credit_notes cn
    WHERE cn.status = 'confirmed'
      AND cn.restock
      AND EXISTS (SELECT 1 FROM public.credit_note_items i
                   WHERE i.credit_note_id = cn.id AND i.product_id IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM public.stock_ledger s
                       WHERE s.related_doc_id = cn.id)
  LOOP
    FOR v_item IN
      SELECT * FROM public.credit_note_items
      WHERE credit_note_id = v_cn.id AND product_id IS NOT NULL
    LOOP
      v_wh   := COALESCE(v_item.restock_warehouse_id, v_cn.warehouse_id);
      v_cost := COALESCE(v_item.cost_at_sale, 0);

      IF v_wh IS NULL THEN
        RAISE NOTICE 'phase93: % has no warehouse; skipping.', v_cn.credit_note_number;
        CONTINUE;
      END IF;

      SELECT COALESCE(running_qty, 0)::NUMERIC(15,3), running_avg_cost
        INTO v_prev_qty, v_prev_mac
      FROM public.stock_ledger
      WHERE company_id = v_cn.company_id AND product_id = v_item.product_id
        AND warehouse_id = v_wh
      ORDER BY seq DESC LIMIT 1;
      v_prev_qty := COALESCE(v_prev_qty, 0);

      SELECT COALESCE(SUM(latest_qty), 0), COALESCE(SUM(latest_value), 0)
        INTO v_old_qty, v_old_value
      FROM (
        SELECT DISTINCT ON (warehouse_id)
          running_qty AS latest_qty,
          running_qty * running_avg_cost AS latest_value
        FROM public.stock_ledger
        WHERE company_id = v_cn.company_id AND product_id = v_item.product_id
        ORDER BY warehouse_id, seq DESC
      ) sub;

      -- The same rule the patched function now uses.
      IF (COALESCE(v_old_qty,0) + v_item.quantity) > 0 THEN
        v_new_mac := (COALESCE(v_old_value,0) + v_item.quantity * v_cost)
                     / (COALESCE(v_old_qty,0) + v_item.quantity);
      ELSE
        v_new_mac := COALESCE(NULLIF(v_cost, 0), v_prev_mac, 0);
      END IF;

      INSERT INTO public.stock_ledger
        (company_id, product_id, warehouse_id, date,
         type, direction, quantity, unit_cost, total_cost,
         running_qty, running_avg_cost,
         related_doc_type, related_doc_id)
      VALUES
        (v_cn.company_id, v_item.product_id, v_wh, v_cn.date,
         'sales_return', 1, v_item.quantity, v_cost, v_item.quantity * v_cost,
         v_prev_qty + v_item.quantity, v_new_mac,
         'credit_note', v_cn.id);

      v_count := v_count + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'phase93: backfilled % restock movement(s).', v_count;
END
$fix$;

COMMIT;

-- -- VERIFY: 0301FDR should now be 0
-- SELECT ROUND(SUM(sl.quantity * sl.direction), 2) AS on_hand
--   FROM public.stock_ledger sl
--   JOIN public.products p ON p.id = sl.product_id
--  WHERE p.sku = '0301FDR';
--
-- -- VERIFY: no confirmed restocking credit note is missing its movement
-- SELECT cn.credit_note_number FROM public.credit_notes cn
--  WHERE cn.status='confirmed' AND cn.restock
--    AND EXISTS (SELECT 1 FROM public.credit_note_items i
--                 WHERE i.credit_note_id=cn.id AND i.product_id IS NOT NULL)
--    AND NOT EXISTS (SELECT 1 FROM public.stock_ledger s WHERE s.related_doc_id=cn.id);

-- == ROLLBACK ===============================================================
-- Restore the two bodies from the migration that defined them previously. The
-- backfilled movements are stock_ledger rows and are removed by deleting the
-- rows this inserted:
--
--   DELETE FROM public.stock_ledger
--    WHERE type = 'sales_return' AND related_doc_type = 'credit_note'
--      AND related_doc_id IN ( /* the note ids this backfilled */ );
--
-- Note that doing so puts 0301FDR back to -1, which is wrong, so prefer
-- correcting forward with an inventory adjustment.
