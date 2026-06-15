-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt — edit_vendor_bill (2026-06-13)
-- ─────────────────────────────────────────────────────────────────────────
-- Confirmed vendor bills had no edit path (invoices got edit_invoice in
-- Phase 12.21/12.27; bills were never given the equivalent).
--
-- Mechanics (back-to-draft pattern):
--   1. Guards: must be confirmed · period lock · NO payments applied ·
--      NO deferred-COGS flush triggered by this bill (reversing that
--      would corrupt COGS on already-sold items — void & recreate instead).
--   2. Reverse the bill JE  (Dr/Cr flipped, linked via reversal_of_id).
--   3. Reverse the bill's stock_ledger rows (un-receives the goods,
--      restores running qty; MAC recomputes naturally on re-confirm).
--   4. Status → draft. The user edits and re-confirms; confirm_vendor_bill
--      reposts GL + stock + landed cost + VAT + deferred-COGS flush with
--      the corrected values.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.edit_vendor_bill(p_bill_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id      UUID := auth.uid();
  v_company_id   UUID;
  v_bill         public.vendor_bills%ROWTYPE;
  v_lock_date    DATE;
  v_je           public.journal_entries%ROWTYPE;
  v_gl           public.general_ledger%ROWTYPE;
  v_sl           public.stock_ledger%ROWTYPE;
  v_rev_id       UUID;
  v_rev_entry    TEXT;
  v_seq          BIGINT;
  v_prev_running NUMERIC(15,3);
  v_reversed     INT := 0;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'edit_vendor_bill: no company for user';
  END IF;

  SELECT * INTO v_bill FROM public.vendor_bills WHERE id = p_bill_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'edit_vendor_bill: bill % not found', p_bill_id;
  END IF;
  IF v_bill.status <> 'confirmed' THEN
    RAISE EXCEPTION 'edit_vendor_bill: bill must be confirmed (status=%)', v_bill.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND CURRENT_DATE <= v_lock_date THEN
    RAISE EXCEPTION 'edit_vendor_bill: today % on or before period lock %', CURRENT_DATE, v_lock_date;
  END IF;

  -- Guard: payments already applied → unapply/void those first.
  IF EXISTS (
    SELECT 1 FROM public.payment_allocations
    WHERE company_id = v_company_id AND doc_type = 'vendor_bill' AND doc_id = p_bill_id
  ) THEN
    RAISE EXCEPTION 'This bill has payments applied. Void or unapply the payment(s) before editing.';
  END IF;

  -- Guard: this bill''s arrival flushed deferred COGS for earlier sales.
  -- Reversing that would silently erase COGS on sold items.
  IF EXISTS (
    SELECT 1 FROM public.journal_entries
    WHERE company_id = v_company_id AND source_id = p_bill_id
      AND source_type = 'inventory_cogs' AND reversed_by_id IS NULL
  ) THEN
    RAISE EXCEPTION 'This bill triggered a deferred COGS posting for earlier sales. Editing it would corrupt COGS — void the bill and create a corrected one instead.';
  END IF;

  -- Step 1: reverse the bill JE(s).
  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id
      AND source_id = p_bill_id
      AND source_type = 'vendor_bill'
      AND reversed_by_id IS NULL
      AND reversal_of_id IS NULL
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
      'Edit Reversal – ' || v_bill.bill_number,
      v_je.source_type, p_bill_id,
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
        'Edit Reversal – ' || v_bill.bill_number,
        v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
      );
    END LOOP;

    UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
    v_reversed := v_reversed + 1;
  END LOOP;

  -- Step 2: reverse the bill's stock rows (un-receive the goods).
  FOR v_sl IN
    SELECT sl.* FROM public.stock_ledger sl
    WHERE sl.company_id = v_company_id
      AND sl.related_doc_id = p_bill_id
      AND sl.related_doc_type = 'vendor_bill'
      AND sl.reversal_of_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id
      )
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
      'edit_reversal', -v_sl.direction, v_sl.quantity, v_sl.unit_cost, v_sl.total_cost,
      v_prev_running + v_sl.quantity * (-v_sl.direction),
      v_sl.running_avg_cost,
      'vendor_bill', p_bill_id, v_sl.id
    );
  END LOOP;

  -- Step 3: back to draft for editing + re-confirm.
  UPDATE public.vendor_bills SET status = 'draft', updated_at = NOW() WHERE id = p_bill_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'edit_reopen', 'vendor_bill', p_bill_id,
      jsonb_build_object('bill_number', v_bill.bill_number, 'jes_reversed', v_reversed));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('bill_id', p_bill_id, 'bill_number', v_bill.bill_number, 'status', 'draft');
END;
$$;
