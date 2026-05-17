-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 12 — Migration 21: fix edit_invoice double-reversal
-- ─────────────────────────────────────────────────────────────────────────
-- edit_invoice was corrupting GL + stock_ledger on the SECOND (or later)
-- edit of the same confirmed invoice. Symptom on a real session:
--
--   t0  confirm  qty=8  → JE-1001 (16.80)              sale -8
--   t1  edit→25 → JE-1002 reverses JE-1001 (-16.80)    edit_rev +8
--                 JE-1003 posts new 52.50              sale -25
--   t2  edit again (qty=25 + 5% disc → 49.88) →
--                 JE-1004 "reverses" JE-1002 (+16.80) ← BUG: JE-1002 is
--                                                       itself a reversal,
--                                                       this reactivates
--                                                       JE-1001's effect.
--                 JE-1005 reverses JE-1003 (-52.50)
--                 JE-1006 posts new 49.88
--
--   Net GL = 16.80 - 16.80 + 52.50 + 16.80 - 52.50 + 49.88 = 66.68 (AR)
--   Should = 49.88. Over by 16.80, exactly the original confirm value.
--
-- The same shape of bug bit Step 2 (stock_ledger reversal): the original
-- Sale -8 row got a SECOND edit_reversal +8 because the loop's
-- `reversal_of_id IS NULL` filter didn't also exclude originals that had
-- already been reversed in a prior edit.
--
-- Two root-causes, both fixed below:
--
--   1. Step 1's "un-reversed JEs to reverse" filter only checked
--      `reversed_by_id IS NULL`. Reversal entries themselves have
--      reversed_by_id NULL (they haven't been reversed) but they also
--      carry source_id (inherited from the original they reverse), so
--      they matched the loop and got reversed again.
--      Fix: also require `reversal_of_id IS NULL` — only true originals.
--
--   2. Step 2's "originals to reverse" filter only checked
--      `reversal_of_id IS NULL`. That correctly excludes reversal
--      entries themselves, but doesn't notice that an original may
--      already have a reversal pointing back at it from a previous edit.
--      Fix: also require NOT EXISTS (a row whose reversal_of_id = this.id).
--
-- This is a CREATE OR REPLACE FUNCTION; idempotent. Body is identical to
-- the Phase 12.20 version except for those two WHERE-clause tightenings,
-- so it inherits the Phase 12.20 "always insert stock_ledger" fix too.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.edit_invoice(p_invoice_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_company_id  UUID;
  v_inv         public.invoices%ROWTYPE;
  v_item        public.invoice_items%ROWTYPE;
  v_lock_date   DATE;
  v_je          public.journal_entries%ROWTYPE;
  v_gl          public.general_ledger%ROWTYPE;
  v_sl          public.stock_ledger%ROWTYPE;
  v_rev_id      UUID;
  v_rev_entry   TEXT;
  v_inv_je_id   UUID;
  v_cogs_je_id  UUID;
  v_inv_entry   TEXT;
  v_cogs_entry  TEXT;
  v_seq         BIGINT;
  v_ar_id       UUID;
  v_sales_id    UUID;
  v_vat_id      UUID;
  v_cogs_id     UUID;
  v_inv_acc_id  UUID;
  v_current_mac   NUMERIC(15,2);
  v_total_cogs    NUMERIC(15,2) := 0;
  v_wh_id         UUID;
  v_prev_running  NUMERIC(15,3);
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'edit_invoice: no company for user';
  END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'edit_invoice: invoice % not found', p_invoice_id;
  END IF;
  IF v_inv.status <> 'confirmed' THEN
    RAISE EXCEPTION 'edit_invoice: invoice % must be confirmed (status=%)', p_invoice_id, v_inv.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND CURRENT_DATE <= v_lock_date THEN
    RAISE EXCEPTION 'edit_invoice: today % on or before period lock %', CURRENT_DATE, v_lock_date;
  END IF;

  -- ── Step 1: Reverse existing sales + cogs JEs ───────────────────────────
  -- Phase 12.21: also filter `reversal_of_id IS NULL` so we never reverse
  -- a reversal entry (which would resurrect the original posting's
  -- effect). Reversal entries inherit source_id from their original, so
  -- without this filter the loop would pick them up on every subsequent
  -- edit.
  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id
      AND source_id = p_invoice_id
      AND reversed_by_id IS NULL
      AND reversal_of_id IS NULL
      AND source_type IN ('sales_invoice','inventory_cogs')
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
      'Edit Reversal – ' || v_inv.invoice_number,
      v_je.source_type, p_invoice_id,
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
        'Edit Reversal – ' || v_inv.invoice_number,
        v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
      );
    END LOOP;

    UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
  END LOOP;

  -- ── Step 2: Reverse stock_ledger rows ───────────────────────────────────
  -- Phase 12.21: also require NOT EXISTS (a reversal pointing back). The
  -- old `reversal_of_id IS NULL` filter alone excluded reversal entries
  -- themselves, but didn't notice that an original sale row from the
  -- first confirm may already have been reversed in a prior edit. Without
  -- this guard we'd post a second edit_reversal for the same original,
  -- canceling the cancel and re-applying the original sale's stock impact.
  FOR v_sl IN
    SELECT sl.* FROM public.stock_ledger sl
    WHERE sl.company_id = v_company_id
      AND sl.related_doc_id = p_invoice_id
      AND sl.related_doc_type = 'invoice'
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
      'invoice', p_invoice_id, v_sl.id
    );
  END LOOP;

  -- ── Step 3: Repost based on current items (same as confirm_invoice) ──────
  v_wh_id := v_inv.warehouse_id;
  IF v_wh_id IS NULL THEN
    SELECT id INTO v_wh_id FROM public.warehouses WHERE company_id = v_company_id AND is_default LIMIT 1;
  END IF;

  SELECT id INTO v_ar_id      FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1200' AND is_active;
  SELECT id INTO v_sales_id   FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '4100' AND is_active;
  SELECT id INTO v_cogs_id    FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '5100' AND is_active;
  SELECT id INTO v_inv_acc_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1300' AND is_active;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id;

  IF v_inv.tax_amount > 0 THEN
    SELECT id INTO v_vat_id FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND code LIKE '22%' AND is_active ORDER BY code LIMIT 1;
  END IF;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_seq;
  v_inv_entry := 'JE-' || v_seq::TEXT;

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, currency, exchange_rate,
    total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_inv_entry, v_inv.date,
    'Sales Invoice (Edited) ' || v_inv.invoice_number,
    'sales_invoice', p_invoice_id, v_inv.currency, v_inv.exchange_rate,
    v_inv.total_amount, v_inv.total_amount, v_user_id
  ) RETURNING id INTO v_inv_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_inv_je_id, v_ar_id, '1200', v_inv.date, v_inv.total_amount, 0,
     'Invoice (Edited) ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_inv_je_id, v_sales_id, '4100', v_inv.date, 0, v_inv.subtotal - v_inv.discount_amount,
     'Invoice (Edited) ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);

  IF v_inv.tax_amount > 0 AND v_vat_id IS NOT NULL THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_inv_je_id, v_vat_id, '2200', v_inv.date, 0, v_inv.tax_amount,
       'Output VAT (Edited) ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);
  END IF;

  -- Per-item: ALWAYS write stock_ledger (Phase 12.20); defer COGS when MAC=0.
  FOR v_item IN SELECT * FROM public.invoice_items WHERE invoice_id = p_invoice_id LOOP
    CONTINUE WHEN v_item.product_id IS NULL;

    SELECT COALESCE(running_avg_cost, 0)::NUMERIC(15,2) INTO v_current_mac
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_item.product_id
    ORDER BY created_at DESC LIMIT 1;
    v_current_mac := COALESCE(v_current_mac, 0);

    UPDATE public.invoice_items SET cost_at_sale = v_current_mac WHERE id = v_item.id;

    SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_running
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_item.product_id AND warehouse_id = v_wh_id
    ORDER BY created_at DESC LIMIT 1;
    v_prev_running := COALESCE(v_prev_running, 0);

    INSERT INTO public.stock_ledger
      (company_id, product_id, warehouse_id, date, type, direction, quantity, unit_cost, total_cost,
       running_qty, running_avg_cost, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_item.product_id, v_wh_id, CURRENT_DATE,
       'sale', -1, v_item.quantity, v_current_mac, v_item.quantity * v_current_mac,
       v_prev_running - v_item.quantity, v_current_mac, 'invoice', p_invoice_id);

    IF v_current_mac > 0 THEN
      v_total_cogs := v_total_cogs + v_item.quantity * v_current_mac;
    END IF;
  END LOOP;

  IF v_total_cogs > 0 THEN
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE
      SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
    RETURNING current_value INTO v_seq;
    v_cogs_entry := 'JE-' || v_seq::TEXT;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description, source_type, source_id,
      currency, exchange_rate, total_debit, total_credit, created_by
    ) VALUES (
      v_company_id, v_cogs_entry, CURRENT_DATE,
      'COGS (Edited) – ' || v_inv.invoice_number,
      'inventory_cogs', p_invoice_id, v_inv.currency, v_inv.exchange_rate,
      v_total_cogs, v_total_cogs, v_user_id
    ) RETURNING id INTO v_cogs_je_id;

    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_cogs_je_id, v_cogs_id, '5100', CURRENT_DATE, v_total_cogs, 0,
       'COGS (Edited) ' || v_inv.invoice_number, 'invoice', p_invoice_id),
      (v_company_id, v_cogs_je_id, v_inv_acc_id, '1300', CURRENT_DATE, 0, v_total_cogs,
       'COGS (Edited) ' || v_inv.invoice_number, 'invoice', p_invoice_id);
  END IF;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'edit', 'invoice', p_invoice_id,
      jsonb_build_object('invoice_number', v_inv.invoice_number, 'je', v_inv_entry));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id, 'invoice_number', v_inv.invoice_number,
    'je_id', v_inv_je_id, 'entry_number', v_inv_entry
  );
END;
$$;
