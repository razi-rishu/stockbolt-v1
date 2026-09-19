-- ============================================================================
-- Phase 80 (R7-alt) — A purchase return removed more from stock than it
--                     credited to the ledger
--
-- WHAT I GOT WRONG FIRST
-- This increment was approved as "the purchase-side write-off mirror": damaged
-- goods on a purchase return posting to 6700 the way phase 76 does on the sales
-- side. That was my error, stated in the R6a hand-off and contradicting what I
-- had written in the phase 76 header itself. The phase 76 header was right.
--
-- There is nothing to write off when goods go back to a supplier. The goods
-- physically leave and the supplier credits us:
--
--     Dr 2100 Accounts Payable        (what the supplier now owes back)
--     Cr 1500 Input VAT               (tax reversed)
--     Cr 1300 Inventory               (goods gone)
--
-- No value is destroyed, so no loss exists, whatever condition the goods were
-- in. Damaged goods that we KEEP and scrap are an inventory adjustment, which
-- is already a separate document with its own reason vocabulary. Mirroring
-- phase 76 here would have invented an expense that never happened.
--
-- THE ACTUAL DEFECT
-- Looking at the function to build that mirror turned up a real one, in the
-- same three lines.
--
-- On the way IN, confirm_vendor_bill capitalises stock NET of discount:
--
--     v_line_value := line_total - tax_amount;          -- discount already off
--     v_eff_unit   := ROUND((v_line_value + landed) / quantity, 4);
--     stock_ledger: unit_cost = v_eff_unit, total_cost = v_line_value + landed
--
-- On the way OUT, confirm_debit_note credited the ledger NET but removed stock
-- GROSS:
--
--     v_item_cost := line_total - tax_amount;           -- net  -> Cr 1300
--     stock_ledger: quantity * v_item.unit_cost         -- GROSS -> stock
--
-- debit_note_items has no unit_price column -- only unit_cost and a
-- discount_amount -- so line_subtotal is unit_cost x qty MINUS the discount,
-- while the ledger row multiplied the undiscounted unit_cost back out. Every
-- discounted purchase-return line therefore took MORE value out of the stock
-- subledger than it credited to GL 1300, by exactly the discount. That is the
-- E1 drift class: the same divergence between 1300 and stock valuation that
-- Pro_Parts and IMBD123 are still carrying from other causes.
--
-- The moving average was wrong too, and for the same reason:
-- (v_old_value - quantity * unit_cost) removed the gross figure from a
-- valuation that only ever held the net one.
--
-- REACHABLE ON BOTH PATHS
-- debit-note-editor.tsx offers discount_percent directly, and
-- confirm_purchase_return carries the originating bill line's discount_percent
-- through onto the debit note. So a purchase return of any discounted bill line
-- would have drifted.
--
-- NOT A LIVE PROBLEM
-- Checked before writing this: zero confirmed debit notes exist and zero
-- debit_note_items carry a discount. Nothing needs repairing and no number
-- changes. This is forward-looking, like phase 76 was.
--
-- WHAT CHANGED
-- Four lines, all inside the stock-ledger branch:
--   * the branch now also requires v_item_cost > 0, mirroring the
--     "IF v_line_value <= 0 THEN CONTINUE" guard on the inbound side, so a
--     fully-discounted line cannot write a zero-value ledger row;
--   * the MAC recomputation subtracts v_item_cost, not quantity x unit_cost;
--   * the ledger row's total_cost IS v_item_cost;
--   * its unit_cost is v_eff_unit, derived from v_item_cost exactly the way
--     confirm_vendor_bill derives it on the way in.
--
-- All FOUR general_ledger INSERT blocks are byte-identical to phase 74.
-- Verified by hashing each block before and after: the entry still posts
-- Dr 2100 / Cr 1500 / Cr 1300 with the same amounts. Only what leaves the
-- subledger changed, and it changed to match what the ledger always said.
--
-- STILL OPEN, DELIBERATELY NOT FIXED HERE
-- v_total_inv_credit accumulates over EVERY line, including service lines and
-- lines with no product, while only goods lines write a stock row. So a service
-- line on a debit note still credits 1300 Inventory with nothing leaving stock.
-- That is the phase 36 rule ("services never touch inventory") never having
-- reached this function. Fixing it means choosing which account a returned
-- service should credit instead, which changes where money lands and deserves
-- its own increment rather than being smuggled into this one.
--
-- Reconstructed from phase 74, the migration that last defined this function
-- and which is applied on production. Additive and idempotent.
-- ============================================================================


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
  -- Per-item stock
  v_prev_wh_qty   NUMERIC(15,3);
  v_old_qty       NUMERIC(15,3);
  v_old_value     NUMERIC(15,2);
  v_new_mac       NUMERIC(15,2);
  v_item_cost     NUMERIC(15,2);
  v_total_inv_credit NUMERIC(15,2) := 0;
  v_eff_unit      NUMERIC(15,4);   -- phase80
  v_wh_id         UUID;
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
    v_total_inv_credit := v_total_inv_credit + v_item_cost;

    -- Stock ledger if product present (B9 return)
    IF v_item.product_id IS NOT NULL AND v_item.unit_cost > 0 AND v_item_cost > 0 THEN
      -- Per-warehouse running qty
      SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_wh_qty
      FROM public.stock_ledger
      WHERE company_id = v_company_id AND product_id = v_item.product_id AND warehouse_id = v_wh_id
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
        (v_company_id, v_item.product_id, v_wh_id, v_dn.date,
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
