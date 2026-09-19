-- ============================================================================
-- Phase 81 — A returned service credited Inventory
--
-- THE DEFECT
-- confirm_debit_note accumulated EVERY line into one aggregate credit to 1300
-- Inventory, while only goods lines wrote a stock_ledger row:
--
--     v_item_cost := line_total - tax_amount;
--     v_total_inv_credit := v_total_inv_credit + v_item_cost;   -- every line
--     IF product_id IS NOT NULL AND unit_cost > 0 ... THEN
--        ... stock_ledger ...                                   -- goods only
--     END IF;
--     -- later: Cr 1300 by v_total_inv_credit
--
-- So returning a purchased SERVICE reduced inventory that never held it. The
-- GL said stock fell; the subledger said nothing moved. That is the same
-- 1300-versus-stock-valuation divergence phase 80 fixed for discounts, and the
-- same class as the E1 drift Pro_Parts and IMBD123 still carry.
--
-- Worse in one respect: a service product with unit_cost > 0 also passed the
-- stock guard, so it wrote a stock_ledger row and moved the moving average of
-- a product that has no stock at all.
--
-- This is phase 36 -- "services never touch inventory" -- never having reached
-- this function. confirm_vendor_bill joins public.products and filters
-- p.type IS DISTINCT FROM 'service'; confirm_debit_note did not mention
-- products or services anywhere.
--
-- WHAT THIS DOES
-- Resolves the account per line by exactly the rule the inbound side uses:
--
--     products.purchase_account_id, if set
--     else service -> first active 5xxx expense, falling back to 5100
--     else                                                      -> 1300
--     no product at all                                         -> 1300
--
-- Lines that resolve to 1300 still accumulate into the single aggregate credit,
-- so a goods-only debit note -- every debit note anyone has ever raised --
-- posts byte-for-byte what it posted before. Any line resolving elsewhere gets
-- its own credit to its own account instead.
--
-- The stock branch additionally requires the product not to be a service and
-- the resolved account to be an asset, mirroring the inbound guard exactly.
--
-- DOUBLE ENTRY
-- Unchanged by construction. The identity is
--
--     Dr 2100 total_amount  =  Cr 1500 tax_amount + SUM(line_total - tax_amount)
--
-- and total_amount is SUM(line_total). Splitting that second term across
-- accounts changes where the credits land, never how much they come to, so the
-- entry balances exactly as before. je_must_balance re-checks it at COMMIT.
--
-- All FOUR general_ledger INSERT blocks from phase 80 are byte-identical here,
-- verified by hashing each block before and after. The fifth block is new and
-- only executes for a line that does NOT resolve to 1300 -- which, before this
-- migration, was a line being silently credited to Inventory.
--
-- NOT A DEFECT, AND LEFT ALONE
-- A line with no product still lands on 1300. debit_note_items has no
-- coa_account_id column to say otherwise, and confirm_vendor_bill also falls
-- back to 1300 for an unclassified line. The two sides agree, so there is
-- nothing to reconcile.
--
-- NOT A LIVE PROBLEM
-- Zero confirmed debit notes and zero debit_note_items exist. Nothing needs
-- repairing and no number changes. Forward-looking, like phase 76 and 80.
--
-- Reconstructed from phase 80, the migration that last defined this function.
-- Apply phase 80 FIRST. Additive and idempotent.
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
