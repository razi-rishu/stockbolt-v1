-- ============================================================================
-- Phase 64 — Deferred-COGS subledger write-back
--
-- PROBLEM (found while diagnosing the last two inventory variances)
-- When a deferred-COGS row flushes, phase 63 posts the correct journal entry
-- (Dr 5100 / Cr 1300) but nothing ever goes back to the stock_ledger row that
-- recorded the sale. That row was written at MAC 0 — there was no cost yet —
-- and it stays at 0 forever. Two consequences, both permanent:
--
--   1. The subledger never relieves the sale, so it reports MORE inventory
--      value than the GL. IMBD123: subledger 6500.00 vs GL 6289.47.
--
--   2. Worse, the moving average is then computed off an inflated cumulative
--      cost. IMBD123's BATTERY sits at 224.14 (6500/29) when the true average
--      is 216.88 (6289.47/29) — so every future sale of that part costs 7.26
--      per unit too much, and the error propagates into every later average.
--
-- Phase 63 made the flush actually fire in cases where it previously did
-- nothing, so it makes this MORE visible, not less. Pro_Parts escaped it only
-- because all three products net to zero on hand, where qty x MAC is 0 either
-- way and E1 lands clean regardless.
--
-- FIX
-- On flush, write the recognised cost back onto the originating sale row, then
-- refresh the valuation. stock_ledger_recompute_valuation fires AFTER INSERT
-- only, so an UPDATE does not re-derive running_avg_cost — phase 64 calls
-- recompute_stock_valuation explicitly, and only when a flush happened.
--
-- Also adds repair_flushed_cogs_subledger() for rows already flushed under the
-- old behaviour. It reuses the flush_unit_cost ALREADY POSTED rather than
-- re-pricing, so it is strictly GL-neutral: it touches no journal entry and no
-- general_ledger row, only the subledger and the averages derived from it.
--
-- Additive and idempotent. Safe to re-run.
-- ============================================================================


-- ============================================================================
-- PART 1 — confirm_vendor_bill (phase 63 body + write-back + recompute)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.confirm_vendor_bill(p_bill_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id      UUID := auth.uid();
  v_company_id   UUID;
  v_bill         public.vendor_bills%ROWTYPE;
  v_item         public.vendor_bill_items%ROWTYPE;
  v_lock_date    DATE;
  v_je_id        UUID;
  v_entry        TEXT;
  v_seq          BIGINT;
  v_ap_id        UUID;
  v_accrual_id   UUID;
  v_inv_id       UUID;
  v_vat_id       UUID;
  v_cogs_id      UUID;
  v_grn_total    NUMERIC(15,2) := 0;
  v_debit_2150   NUMERIC(15,2) := 0;
  v_variance     NUMERIC(15,2) := 0;
  v_bill_goods   NUMERIC(15,2);
  v_line_acct_id UUID;
  v_line_code    TEXT;
  v_line_class   TEXT;
  v_line_value   NUMERIC(15,2);
  v_eff_unit     NUMERIC(15,4);
  v_old_mac        NUMERIC(15,2);
  v_old_total_qty  NUMERIC(15,3);
  v_qty_for_mac    NUMERIC(15,3);
  v_new_mac        NUMERIC(15,2);
  v_prev_wh_qty    NUMERIC(15,3);
  v_default_wh_id  UUID;
  v_line_wh_id     UUID;
  v_product_total  NUMERIC(15,2) := 0;
  v_product_count  INTEGER := 0;
  v_landed_alloc   NUMERIC(15,2);
  v_landed_used    NUMERIC(15,2) := 0;
  v_is_last_prod   BOOLEAN;
  v_product_type   TEXT;    -- Phase 36
  v_svc_exp_id     UUID;    -- Phase 36 — fallback expense account for services
  v_def            public.deferred_cogs_queue%ROWTYPE;
  v_flush_mac      NUMERIC(15,2);
  v_flush_total    NUMERIC(15,2) := 0;
  v_flush_je_id    UUID;
  v_flush_entry    TEXT;
  v_round_off_acc UUID;
  v_lc      RECORD;   -- Phase 47 landed-cost line
  v_lc_code TEXT;
  v_arrived_qty  NUMERIC(15,3);           -- Phase 63
  v_arrived_cost NUMERIC(15,2);           -- Phase 63
  v_consumed     JSONB := '{}'::JSONB;    -- Phase 63 — receipt used per product
  v_used         NUMERIC(15,3);           -- Phase 63
  v_sale_row_id  UUID;                     -- Phase 64
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_vendor_bill: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_bill FROM public.vendor_bills WHERE id = p_bill_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_vendor_bill: bill % not found', p_bill_id;
  END IF;
  IF v_bill.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_vendor_bill: bill % not in draft (status=%)', p_bill_id, v_bill.status;
  END IF;

  -- Phase 47 — landed cost is the SUM of the itemized landed-cost lines; the
  -- child table is authoritative and the column just mirrors it (no cached
  -- aggregate trusted at post time).
  SELECT COALESCE(SUM(amount), 0) INTO v_bill.landed_cost_total
  FROM public.vendor_bill_landed_costs WHERE bill_id = p_bill_id;

  IF v_bill.landed_cost_total > 0 AND v_bill.linked_grn_id IS NOT NULL THEN
    RAISE EXCEPTION
      'confirm_vendor_bill: landed_cost_total is not allowed on GRN-linked bills'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_bill.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_vendor_bill: date % on or before period lock %', v_bill.date, v_lock_date;
  END IF;

  SELECT id INTO v_ap_id      FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2100' AND is_active;
  SELECT id INTO v_accrual_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2150' AND is_active;
  SELECT id INTO v_inv_id     FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1300' AND is_active;
  SELECT id INTO v_cogs_id    FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '5100' AND is_active;
  IF v_ap_id IS NULL THEN
    RAISE EXCEPTION 'confirm_vendor_bill: account 2100 AP not found';
  END IF;
  IF v_bill.tax_amount > 0 THEN
    SELECT id INTO v_vat_id FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND code LIKE '15%' AND is_active
    ORDER BY code LIMIT 1;
  END IF;

  -- Phase 36 — fallback expense account for purchased services with no
  -- purchase account set on the product: first active direct-expense (5xxx).
  SELECT id INTO v_svc_exp_id FROM public.chart_of_accounts
  WHERE company_id = v_company_id AND type = 'expense' AND code LIKE '5%' AND is_active
  ORDER BY code LIMIT 1;

  SELECT id INTO v_default_wh_id FROM public.warehouses
  WHERE company_id = v_company_id AND is_default = TRUE AND is_active = TRUE LIMIT 1;
  IF v_default_wh_id IS NULL THEN
    SELECT id INTO v_default_wh_id FROM public.warehouses
    WHERE company_id = v_company_id AND is_active = TRUE
    ORDER BY created_at LIMIT 1;
  END IF;

  IF v_bill.landed_cost_total > 0 THEN
    -- Phase 36 — landed cost spreads over GOODS lines only (never services).
    SELECT COALESCE(SUM(vbi.line_total - vbi.tax_amount), 0), COUNT(*)
      INTO v_product_total, v_product_count
    FROM public.vendor_bill_items vbi
    JOIN public.products p ON p.id = vbi.product_id
    WHERE vbi.bill_id = p_bill_id
      AND vbi.product_id IS NOT NULL
      AND vbi.line_subtotal > 0
      AND p.type IS DISTINCT FROM 'service';
    IF v_product_count = 0 THEN
      RAISE EXCEPTION
        'confirm_vendor_bill: landed_cost_total > 0 requires at least one goods line'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_seq;
  v_entry := 'JE-' || v_seq::TEXT;

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, currency, exchange_rate,
    total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_entry, v_bill.date,
    'Vendor Bill ' || v_bill.bill_number,
    'vendor_bill', p_bill_id,
    v_bill.currency, v_bill.exchange_rate,
    v_bill.total_amount + COALESCE(v_bill.landed_cost_total, 0) + GREATEST(-COALESCE(v_bill.round_off_amount, 0), 0),
    v_bill.total_amount + COALESCE(v_bill.landed_cost_total, 0) + GREATEST(-COALESCE(v_bill.round_off_amount, 0), 0),
    v_user_id
  ) RETURNING id INTO v_je_id;

  IF v_bill.linked_grn_id IS NOT NULL THEN
    SELECT COALESCE(SUM(total_cost), 0) INTO v_grn_total
    FROM public.goods_receipt_items WHERE grn_id = v_bill.linked_grn_id;

    v_bill_goods := v_bill.total_amount - v_bill.tax_amount - COALESCE(v_bill.round_off_amount, 0);
    v_debit_2150 := LEAST(v_grn_total, v_bill_goods);
    v_variance   := v_bill_goods - v_debit_2150;

    IF v_debit_2150 > 0 THEN
      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date,
         debit, credit, description, contact_id, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_je_id, v_accrual_id, '2150', v_bill.date,
         v_debit_2150, 0, 'Vendor Bill ' || v_bill.bill_number,
         v_bill.supplier_id, 'vendor_bill', p_bill_id);
    END IF;
    IF v_variance > 0 THEN
      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date,
         debit, credit, description, contact_id, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_je_id, v_inv_id, '1300', v_bill.date,
         v_variance, 0, 'Bill variance ' || v_bill.bill_number,
         v_bill.supplier_id, 'vendor_bill', p_bill_id);
    END IF;
    UPDATE public.goods_receipts SET status = 'billed', updated_at = NOW()
    WHERE id = v_bill.linked_grn_id AND company_id = v_company_id;

  ELSE
    FOR v_item IN
      SELECT * FROM public.vendor_bill_items
      WHERE bill_id = p_bill_id
      ORDER BY id
    LOOP
      v_line_value := v_item.line_total - v_item.tax_amount;
      IF v_line_value <= 0 THEN CONTINUE; END IF;

      -- Phase 36 — resolve the product's type once per line.
      v_product_type := NULL;
      IF v_item.product_id IS NOT NULL THEN
        SELECT type INTO v_product_type FROM public.products WHERE id = v_item.product_id;
      END IF;

      v_landed_alloc := 0;
      IF v_bill.landed_cost_total > 0
         AND v_item.product_id IS NOT NULL
         AND v_product_type IS DISTINCT FROM 'service'   -- Phase 36
         AND v_product_total > 0
      THEN
        SELECT (NOT EXISTS (
          SELECT 1 FROM public.vendor_bill_items vbi2
          JOIN public.products p2 ON p2.id = vbi2.product_id
          WHERE vbi2.bill_id = p_bill_id
            AND vbi2.product_id IS NOT NULL
            AND vbi2.line_subtotal > 0
            AND p2.type IS DISTINCT FROM 'service'       -- Phase 36
            AND vbi2.id > v_item.id
        )) INTO v_is_last_prod;
        IF v_is_last_prod THEN
          v_landed_alloc := v_bill.landed_cost_total - v_landed_used;
        ELSE
          v_landed_alloc := ROUND(
            (v_line_value / v_product_total) * v_bill.landed_cost_total, 2
          );
          v_landed_used := v_landed_used + v_landed_alloc;
        END IF;
      END IF;

      v_line_acct_id := NULL;
      IF v_item.product_id IS NOT NULL THEN
        SELECT purchase_account_id INTO v_line_acct_id FROM public.products WHERE id = v_item.product_id;
        IF v_line_acct_id IS NULL THEN
          -- Phase 36 — a purchased SERVICE is an expense, never inventory.
          IF v_product_type = 'service' THEN
            v_line_acct_id := COALESCE(v_svc_exp_id, v_cogs_id);
            IF v_line_acct_id IS NULL THEN
              RAISE EXCEPTION 'confirm_vendor_bill: no expense account found for service line — set a purchase account on the product';
            END IF;
          ELSE
            v_line_acct_id := v_inv_id;
          END IF;
        END IF;
      ELSIF v_item.coa_account_id IS NOT NULL THEN
        v_line_acct_id := v_item.coa_account_id;
      ELSE
        v_line_acct_id := v_inv_id;
      END IF;

      SELECT type, code INTO v_line_class, v_line_code
      FROM public.chart_of_accounts WHERE id = v_line_acct_id;

      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date,
         debit, credit, description, contact_id, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_je_id, v_line_acct_id, v_line_code, v_bill.date,
         v_line_value + v_landed_alloc, 0,
         COALESCE(v_item.description, 'Vendor Bill ' || v_bill.bill_number),
         v_bill.supplier_id, 'vendor_bill', p_bill_id);

      IF v_item.product_id IS NOT NULL
         AND v_product_type IS DISTINCT FROM 'service'   -- Phase 36: services never stock
         AND v_line_class = 'asset'
         AND v_item.quantity > 0
         AND v_line_value > 0
      THEN
        v_eff_unit := ROUND((v_line_value + v_landed_alloc) / v_item.quantity, 4);
        v_line_wh_id := COALESCE(v_item.warehouse_id, v_default_wh_id);
        IF v_line_wh_id IS NULL THEN
          RAISE EXCEPTION 'confirm_vendor_bill: no warehouse and no default';
        END IF;

        SELECT COALESCE(running_avg_cost, 0)::NUMERIC(15,2) INTO v_old_mac
        FROM public.stock_ledger sl
        WHERE sl.company_id = v_company_id
          AND sl.product_id = v_item.product_id
          AND sl.reversal_of_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id
          )
        ORDER BY sl.seq DESC
        LIMIT 1;
        v_old_mac := COALESCE(v_old_mac, 0);

        SELECT COALESCE(SUM(latest_qty), 0) INTO v_old_total_qty
        FROM (
          SELECT DISTINCT ON (sl.warehouse_id) sl.running_qty AS latest_qty
          FROM public.stock_ledger sl
          WHERE sl.company_id = v_company_id
            AND sl.product_id = v_item.product_id
            AND sl.reversal_of_id IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id
            )
          ORDER BY sl.warehouse_id, sl.seq DESC
        ) sub;
        v_old_total_qty := COALESCE(v_old_total_qty, 0);

        v_qty_for_mac := GREATEST(v_old_total_qty, 0);

        IF v_qty_for_mac + v_item.quantity > 0 THEN
          v_new_mac := ROUND(
            (v_old_mac * v_qty_for_mac + v_eff_unit * v_item.quantity)
            / (v_qty_for_mac + v_item.quantity), 2
          );
        ELSE
          v_new_mac := ROUND(v_eff_unit, 2);
        END IF;

        SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_wh_qty
        FROM public.stock_ledger sl
        WHERE sl.company_id = v_company_id
          AND sl.product_id = v_item.product_id
          AND sl.warehouse_id = v_line_wh_id
          AND sl.reversal_of_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id
          )
        ORDER BY sl.seq DESC
        LIMIT 1;
        v_prev_wh_qty := COALESCE(v_prev_wh_qty, 0);

        INSERT INTO public.stock_ledger
          (company_id, product_id, warehouse_id, date,
           type, direction, quantity, unit_cost, total_cost,
           running_qty, running_avg_cost,
           related_doc_type, related_doc_id)
        VALUES
          (v_company_id, v_item.product_id, v_line_wh_id, v_bill.date,
           'purchase', 1, v_item.quantity, v_eff_unit, v_line_value + v_landed_alloc,
           v_prev_wh_qty + v_item.quantity, v_new_mac,
           'vendor_bill', p_bill_id);
      END IF;
    END LOOP;
  END IF;

  IF v_bill.tax_amount > 0 AND v_vat_id IS NOT NULL THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_vat_id, '1500', v_bill.date,
       v_bill.tax_amount, 0,
       'Input VAT ' || v_bill.bill_number,
       v_bill.supplier_id, 'vendor_bill', p_bill_id);
  END IF;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date,
     debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_ap_id, '2100', v_bill.date,
     0, v_bill.total_amount,
     'Vendor Bill ' || v_bill.bill_number,
     v_bill.supplier_id, 'vendor_bill', p_bill_id);

  -- Phase 46 — supplier's rounding on the paper bill (Dr 5900 when we pay
  -- more than the computed lines, Cr when less).
  IF COALESCE(v_bill.round_off_amount, 0) <> 0 THEN
    v_round_off_acc := public.ensure_round_off_account(v_company_id);
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_round_off_acc, '5900', v_bill.date,
       GREATEST(v_bill.round_off_amount, 0), GREATEST(-v_bill.round_off_amount, 0),
       'Round Off ' || v_bill.bill_number,
       v_bill.supplier_id, 'vendor_bill', p_bill_id);
  END IF;

  -- Phase 47 (Option B) — itemized landed costs (freight, customs, insurance…).
  -- The VALUE is already added to inventory by the per-line allocation above;
  -- this routes each line's CREDIT to its own account (bank / cash / a
  -- liability / another party's AP) instead of baking it into the supplier's
  -- payable. contact_id defaults to the supplier when the line has no party.
  FOR v_lc IN
    SELECT * FROM public.vendor_bill_landed_costs
    WHERE bill_id = p_bill_id AND amount <> 0
    ORDER BY sort_order, created_at
  LOOP
    SELECT code INTO v_lc_code FROM public.chart_of_accounts WHERE id = v_lc.credit_account_id;
    IF v_lc_code IS NULL THEN
      RAISE EXCEPTION 'confirm_vendor_bill: landed-cost line "%" has no valid credit account', v_lc.label;
    END IF;
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_lc.credit_account_id, v_lc_code, v_bill.date,
       0, v_lc.amount,
       COALESCE(NULLIF(v_lc.label, ''), 'Landed cost') || ' — ' || v_bill.bill_number,
       COALESCE(v_lc.contact_id, v_bill.supplier_id), 'vendor_bill', p_bill_id);
  END LOOP;

  IF v_cogs_id IS NOT NULL AND v_inv_id IS NOT NULL THEN
    FOR v_def IN
      SELECT dcq.*
      FROM public.deferred_cogs_queue dcq
      WHERE dcq.company_id = v_company_id
        AND dcq.status = 'pending'
        AND dcq.product_id IN (
          SELECT DISTINCT vbi.product_id
          FROM public.vendor_bill_items vbi
          WHERE vbi.bill_id = p_bill_id AND vbi.product_id IS NOT NULL
        )
      ORDER BY dcq.sale_date, dcq.created_at
    LOOP
      -- ── Phase 63 ──────────────────────────────────────────────────────────
      -- Cost basis for the flush: the units received on THIS bill are the ones
      -- covering the backorder, so their effective unit cost (landed cost
      -- included, straight off the stock_ledger row this bill just wrote) is
      -- the correct COGS.
      --
      -- This replaces a read of running_avg_cost, which is 0 exactly when a
      -- receipt lands cumulative stock back on zero — the phase 29 valuation
      -- trigger overwrites the correct MAC in the same transaction. That made
      -- the guard below skip the row permanently and strand the purchase value
      -- in 1300 with no stock behind it.
      SELECT COALESCE(SUM(sl.quantity), 0),
             CASE WHEN COALESCE(SUM(sl.quantity), 0) > 0
                  THEN ROUND(SUM(sl.quantity * sl.unit_cost) / SUM(sl.quantity), 2)
                  ELSE 0 END
        INTO v_arrived_qty, v_arrived_cost
      FROM public.stock_ledger sl
      WHERE sl.company_id       = v_company_id
        AND sl.product_id       = v_def.product_id
        AND sl.related_doc_type = 'vendor_bill'
        AND sl.related_doc_id   = p_bill_id
        AND sl.direction        = 1
        AND sl.reversal_of_id IS NULL;

      v_flush_mac := COALESCE(v_arrived_cost, 0);

      -- Fallback: this bill brought no stock for the product (GRN-linked bill,
      -- service line, zero-value receipt) but stock may have arrived by another
      -- route and carry a real average.
      IF v_flush_mac <= 0 THEN
        SELECT COALESCE(running_avg_cost, 0)::NUMERIC(15,2) INTO v_flush_mac
        FROM public.stock_ledger sl
        WHERE sl.company_id = v_company_id
          AND sl.product_id = v_def.product_id
          AND sl.reversal_of_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id
          )
        ORDER BY sl.seq DESC
        LIMIT 1;
        v_flush_mac := COALESCE(v_flush_mac, 0);
      END IF;

      IF v_flush_mac <= 0 THEN CONTINUE; END IF;

      -- Partial coverage: never credit 1300 for units that have not arrived.
      -- Rows run oldest-sale-first, so an early row consumes the receipt and
      -- any uncovered remainder correctly stays 'pending' for a later one.
      v_used := COALESCE((v_consumed ->> v_def.product_id::TEXT)::NUMERIC, 0);
      IF v_arrived_qty > 0 AND (v_arrived_qty - v_used) < v_def.quantity THEN
        CONTINUE;
      END IF;
      v_consumed := jsonb_set(
        v_consumed, ARRAY[v_def.product_id::TEXT], to_jsonb(v_used + v_def.quantity)
      );
      -- ── end Phase 63 ──────────────────────────────────────────────────────

      IF v_flush_je_id IS NULL THEN
        INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
        VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
        ON CONFLICT (company_id, prefix) DO UPDATE
          SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
        RETURNING current_value INTO v_seq;
        v_flush_entry := 'JE-' || v_seq::TEXT;

        INSERT INTO public.journal_entries (
          company_id, entry_number, date, description,
          source_type, source_id, currency, exchange_rate,
          total_debit, total_credit, created_by
        ) VALUES (
          v_company_id, v_flush_entry, v_bill.date,
          'Deferred COGS flush — bill ' || v_bill.bill_number,
          'inventory_cogs', p_bill_id,
          v_bill.currency, v_bill.exchange_rate,
          0, 0,
          v_user_id
        ) RETURNING id INTO v_flush_je_id;
      END IF;

      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date,
         debit, credit, description, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_flush_je_id, v_cogs_id, '5100', v_bill.date,
         v_def.quantity * v_flush_mac, 0,
         'Deferred COGS — sale ' || v_def.sale_invoice_id::TEXT,
         'invoice', v_def.sale_invoice_id);

      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date,
         debit, credit, description, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_flush_je_id, v_inv_id, '1300', v_bill.date,
         0, v_def.quantity * v_flush_mac,
         'Deferred COGS — sale ' || v_def.sale_invoice_id::TEXT,
         'invoice', v_def.sale_invoice_id);

      v_flush_total := v_flush_total + v_def.quantity * v_flush_mac;

      UPDATE public.deferred_cogs_queue
      SET status                   = 'flushed',
          flushed_at               = NOW(),
          flushed_journal_entry_id = v_flush_je_id,
          flush_unit_cost          = v_flush_mac
      WHERE id = v_def.id;

      -- ---- Phase 64 ----------------------------------------------------
      -- Write the recognised cost back onto the originating sale row.
      -- Without this the subledger keeps relieving the sale at zero:
      -- inventory stays overstated by the flushed amount and every later
      -- moving average is computed off an inflated cumulative cost, so the
      -- error compounds into future sales.
      --
      -- The unit_cost = 0 predicate self-sequences. One invoice can carry
      -- several rows for the same product+warehouse (observed up to 6), and
      -- once a row is written back it stops matching, so consecutive
      -- deferred rows each claim a distinct sale row.
      SELECT sl.id INTO v_sale_row_id
      FROM public.stock_ledger sl
      WHERE sl.company_id       = v_company_id
        AND sl.product_id       = v_def.product_id
        AND sl.related_doc_type = 'invoice'
        AND sl.related_doc_id   = v_def.sale_invoice_id
        AND sl.direction        = -1
        AND sl.unit_cost        = 0
        AND sl.warehouse_id IS NOT DISTINCT FROM v_def.warehouse_id
        AND sl.reversal_of_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id)
      ORDER BY sl.seq
      LIMIT 1;

      IF v_sale_row_id IS NOT NULL THEN
        UPDATE public.stock_ledger
        SET unit_cost  = v_flush_mac,
            total_cost = ROUND(quantity * v_flush_mac, 2)
        WHERE id = v_sale_row_id;
      END IF;
      -- ---- end Phase 64 ------------------------------------------------

    END LOOP;

    IF v_flush_je_id IS NOT NULL THEN
      UPDATE public.journal_entries
      SET total_debit  = v_flush_total,
          total_credit = v_flush_total
      WHERE id = v_flush_je_id;

      -- Phase 64 -- stock_ledger_recompute_valuation fires AFTER INSERT
      -- only, so the write-back UPDATEs above do not refresh
      -- running_avg_cost. Do it explicitly, once, and only when a flush
      -- actually happened.
      PERFORM public.recompute_stock_valuation(v_company_id);
    END IF;
  END IF;

  UPDATE public.vendor_bills SET status = 'confirmed', updated_at = NOW() WHERE id = p_bill_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'vendor_bill', p_bill_id,
      jsonb_build_object(
        'bill_number',       v_bill.bill_number,
        'je',                v_entry,
        'landed_cost_total', v_bill.landed_cost_total,
        'cogs_flush_je',     v_flush_entry,
        'cogs_flush_total',  v_flush_total,
        'phase',             '64'
      ));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'bill_id',          p_bill_id,
    'bill_number',      v_bill.bill_number,
    'je_id',            v_je_id,
    'entry_number',     v_entry,
    'cogs_flush_je',    v_flush_je_id,
    'cogs_flush_total', v_flush_total
  );
END;
$function$;


-- ============================================================================
-- PART 2 — flush_stranded_deferred_cogs (phase 63 body + write-back)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.flush_stranded_deferred_cogs(
  p_dry_run   BOOLEAN DEFAULT TRUE,
  p_post_date DATE    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID;
  v_user_id    UUID := auth.uid();
  v_row        RECORD;
  v_arr        RECORD;
  v_grp        RECORD;
  v_pick_bill  UUID;
  v_pick_cost  NUMERIC(15,2);
  v_pick_date  DATE;
  v_key        TEXT;
  v_used       NUMERIC(15,3);
  v_grand      NUMERIC(15,2) := 0;
  v_res        JSONB;
  v_je_id      UUID;
  v_plan       JSONB := '[]'::JSONB;   -- allocation: one element per queue row
  v_out        JSONB := '[]'::JSONB;   -- reported: one element per journal entry
  v_consumed   JSONB := '{}'::JSONB;   -- receipt capacity used, per product+bill
  v_posted     INTEGER := 0;
  v_wb          RECORD;   -- Phase 64
  v_sale_row_id UUID;     -- Phase 64
BEGIN
  PERFORM public.auth_require('accounting.write');

  v_company_id := public.current_user_company_id();
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'flush_stranded_deferred_cogs: no company for user %', v_user_id;
  END IF;

  -- ── Pass 1: allocate each pending row to a covering receipt ───────────────
  -- Oldest sale first; within a product, the earliest bill that still has
  -- uncommitted quantity. A row with no covering receipt stays pending.
  FOR v_row IN
    SELECT d.* FROM public.deferred_cogs_queue d
    WHERE d.company_id = v_company_id AND d.status = 'pending'
    ORDER BY d.sale_date, d.created_at
  LOOP
    v_pick_bill := NULL;

    FOR v_arr IN
      SELECT sl.related_doc_id                                        AS bill_id,
             SUM(sl.quantity)                                         AS qty,
             ROUND(SUM(sl.quantity * sl.unit_cost)
                   / NULLIF(SUM(sl.quantity), 0), 2)                  AS unit_cost,
             MIN(sl.date)                                             AS arrival_date
      FROM public.stock_ledger sl
      WHERE sl.company_id       = v_company_id
        AND sl.product_id       = v_row.product_id
        AND sl.direction        = 1
        AND sl.related_doc_type = 'vendor_bill'
        AND sl.reversal_of_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id)
      GROUP BY sl.related_doc_id
      HAVING ROUND(SUM(sl.quantity * sl.unit_cost)
                   / NULLIF(SUM(sl.quantity), 0), 2) > 0
      ORDER BY MIN(sl.seq)
    LOOP
      v_key  := v_row.product_id::TEXT || ':' || v_arr.bill_id::TEXT;
      v_used := COALESCE((v_consumed ->> v_key)::NUMERIC, 0);
      IF (v_arr.qty - v_used) >= v_row.quantity THEN
        v_pick_bill := v_arr.bill_id;
        v_pick_cost := v_arr.unit_cost;
        v_pick_date := v_arr.arrival_date;
        v_consumed  := jsonb_set(v_consumed, ARRAY[v_key],
                                 to_jsonb(v_used + v_row.quantity));
        EXIT;
      END IF;
    END LOOP;

    CONTINUE WHEN v_pick_bill IS NULL;

    v_plan := v_plan || jsonb_build_object(
      'queue_id',        v_row.id,
      'sale_invoice_id', v_row.sale_invoice_id,
      'product_id',      v_row.product_id,
      'warehouse_id',    v_row.warehouse_id,
      'bill_id',         v_pick_bill,
      'post_date',       COALESCE(p_post_date, v_pick_date),
      'quantity',        v_row.quantity,
      'unit_cost',       v_pick_cost,
      'amount',          ROUND(v_row.quantity * v_pick_cost, 2)
    );
  END LOOP;

  -- ── Pass 2: one journal entry per covering bill + date ────────────────────
  -- post_journal_entry dates the whole entry, so the grouping key carries the
  -- date. source_type/source_id mirror the engine's own flush JE, which is what
  -- edit_vendor_bill matches on when it re-queues a bill's flushed rows.
  FOR v_grp IN
    SELECT (e ->> 'bill_id')::UUID          AS bill_id,
           (e ->> 'post_date')::DATE        AS post_date,
           SUM((e ->> 'amount')::NUMERIC)   AS total,
           COUNT(*)                         AS rows_n,
           jsonb_agg(jsonb_build_object(
             'account_code', '5100',
             'debit',        (e ->> 'amount')::NUMERIC,
             'credit',       0,
             'description',  'Deferred COGS — sale ' || (e ->> 'sale_invoice_id')
           ) ORDER BY e ->> 'sale_invoice_id')
           ||
           jsonb_agg(jsonb_build_object(
             'account_code', '1300',
             'debit',        0,
             'credit',       (e ->> 'amount')::NUMERIC,
             'description',  'Deferred COGS — sale ' || (e ->> 'sale_invoice_id')
           ) ORDER BY e ->> 'sale_invoice_id')       AS lines
    FROM jsonb_array_elements(v_plan) e
    GROUP BY 1, 2
    ORDER BY 2, 1
  LOOP
    v_grand := v_grand + v_grp.total;

    v_out := v_out || jsonb_build_object(
      'bill_id', v_grp.bill_id,
      'date',    v_grp.post_date,
      'amount',  v_grp.total,
      'rows',    v_grp.rows_n,
      'lines',   v_grp.lines
    );

    CONTINUE WHEN p_dry_run;

    v_res := public.post_journal_entry(jsonb_build_object(
      'date',        v_grp.post_date,
      'description', 'Deferred COGS repair (phase 63)',
      'source_type', 'inventory_cogs',
      'source_id',   v_grp.bill_id,
      'lines',       v_grp.lines
    ));
    v_je_id  := (v_res ->> 'journal_entry_id')::UUID;
    v_posted := v_posted + 1;

    UPDATE public.deferred_cogs_queue d
    SET status                   = 'flushed',
        flushed_at               = NOW(),
        flushed_journal_entry_id = v_je_id,
        flush_unit_cost          = (e ->> 'unit_cost')::NUMERIC,
        updated_at               = NOW()
    FROM jsonb_array_elements(v_plan) e
    WHERE d.id                      = (e ->> 'queue_id')::UUID
      AND d.company_id              = v_company_id
      AND (e ->> 'bill_id')::UUID   = v_grp.bill_id
      AND (e ->> 'post_date')::DATE = v_grp.post_date;

    -- Phase 64 -- mirror the recognised cost onto each originating sale row
    -- so the subledger stops relieving those sales at zero.
    FOR v_wb IN
      SELECT (e ->> 'sale_invoice_id')::UUID AS sale_invoice_id,
             (e ->> 'product_id')::UUID      AS product_id,
             (e ->> 'warehouse_id')::UUID    AS warehouse_id,
             (e ->> 'unit_cost')::NUMERIC    AS unit_cost
      FROM jsonb_array_elements(v_plan) e
      WHERE (e ->> 'bill_id')::UUID   = v_grp.bill_id
        AND (e ->> 'post_date')::DATE = v_grp.post_date
    LOOP
      SELECT sl.id INTO v_sale_row_id
      FROM public.stock_ledger sl
      WHERE sl.company_id       = v_company_id
        AND sl.product_id       = v_wb.product_id
        AND sl.related_doc_type = 'invoice'
        AND sl.related_doc_id   = v_wb.sale_invoice_id
        AND sl.direction        = -1
        AND sl.unit_cost        = 0
        AND sl.warehouse_id IS NOT DISTINCT FROM v_wb.warehouse_id
        AND sl.reversal_of_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id)
      ORDER BY sl.seq
      LIMIT 1;

      IF v_sale_row_id IS NOT NULL THEN
        UPDATE public.stock_ledger
        SET unit_cost  = v_wb.unit_cost,
            total_cost = ROUND(quantity * v_wb.unit_cost, 2)
        WHERE id = v_sale_row_id;
      END IF;
    END LOOP;
  END LOOP;

  -- Phase 64 -- the valuation trigger is INSERT-only; refresh explicitly.
  IF NOT p_dry_run AND v_posted > 0 THEN
    PERFORM public.recompute_stock_valuation(v_company_id);
  END IF;

  IF NOT p_dry_run AND v_posted > 0 THEN
    BEGIN
      INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
      VALUES (v_company_id, v_user_id, 'repair', 'deferred_cogs_queue', NULL,
        jsonb_build_object('total', v_grand, 'entries', v_posted, 'phase', '63'));
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'dry_run',        p_dry_run,
    'total',          v_grand,
    'entries',        jsonb_array_length(v_out),
    'entries_posted', v_posted,
    'plan',           v_out
  );
END;
$function$;


-- ============================================================================
-- PART 3 — repair_flushed_cogs_subledger
--
-- Backfill for rows flushed BEFORE phase 64: their GL is already correct, only
-- the subledger sale row was never costed. Uses the recorded flush_unit_cost,
-- so no journal entry and no general_ledger row is touched — this cannot move
-- the trial balance. Gated on inventory.write rather than accounting.write
-- precisely because it posts nothing. Defaults to DRY RUN.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.repair_flushed_cogs_subledger(
  p_dry_run BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id  UUID;
  v_user_id     UUID := auth.uid();
  v_row         RECORD;
  v_sale_row_id UUID;
  v_claimed     UUID[] := '{}';
  v_plan        JSONB  := '[]'::JSONB;
  v_fixed       INTEGER := 0;
  v_value       NUMERIC(15,2) := 0;
BEGIN
  PERFORM public.auth_require('inventory.write');

  v_company_id := public.current_user_company_id();
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'repair_flushed_cogs_subledger: no company for user %', v_user_id;
  END IF;

  FOR v_row IN
    SELECT d.id, d.product_id, d.sale_invoice_id, d.warehouse_id,
           d.quantity, d.flush_unit_cost
    FROM public.deferred_cogs_queue d
    WHERE d.company_id = v_company_id
      AND d.status     = 'flushed'
      AND COALESCE(d.flush_unit_cost, 0) > 0
    ORDER BY d.sale_date, d.created_at
  LOOP
    -- v_claimed keeps a dry run honest: without it, two deferred rows on the
    -- same invoice + product would both report the SAME sale row, and the
    -- plan would overstate what the real run actually changes.
    SELECT sl.id INTO v_sale_row_id
    FROM public.stock_ledger sl
    WHERE sl.company_id       = v_company_id
      AND sl.product_id       = v_row.product_id
      AND sl.related_doc_type = 'invoice'
      AND sl.related_doc_id   = v_row.sale_invoice_id
      AND sl.direction        = -1
      AND sl.unit_cost        = 0
      AND sl.warehouse_id IS NOT DISTINCT FROM v_row.warehouse_id
      AND sl.reversal_of_id IS NULL
      AND NOT (sl.id = ANY(v_claimed))
      AND NOT EXISTS (SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id)
    ORDER BY sl.seq
    LIMIT 1;

    CONTINUE WHEN v_sale_row_id IS NULL;

    v_claimed := v_claimed || v_sale_row_id;
    v_fixed   := v_fixed + 1;
    v_value   := v_value + ROUND(v_row.quantity * v_row.flush_unit_cost, 2);
    v_plan    := v_plan || jsonb_build_object(
      'queue_id',     v_row.id,
      'stock_row_id', v_sale_row_id,
      'product_id',   v_row.product_id,
      'quantity',     v_row.quantity,
      'unit_cost',    v_row.flush_unit_cost,
      'total_cost',   ROUND(v_row.quantity * v_row.flush_unit_cost, 2)
    );

    CONTINUE WHEN p_dry_run;

    UPDATE public.stock_ledger
    SET unit_cost  = v_row.flush_unit_cost,
        total_cost = ROUND(quantity * v_row.flush_unit_cost, 2)
    WHERE id = v_sale_row_id;
  END LOOP;

  IF NOT p_dry_run AND v_fixed > 0 THEN
    -- INSERT-only trigger: the UPDATEs above need an explicit re-derive.
    PERFORM public.recompute_stock_valuation(v_company_id);

    BEGIN
      INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
      VALUES (v_company_id, v_user_id, 'repair', 'stock_ledger', NULL,
        jsonb_build_object('rows', v_fixed, 'value', v_value, 'phase', '64'));
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'rows',    v_fixed,
    'value',   v_value,
    'plan',    v_plan
  );
END;
$function$;

REVOKE ALL    ON FUNCTION public.repair_flushed_cogs_subledger(BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.repair_flushed_cogs_subledger(BOOLEAN) TO authenticated;
