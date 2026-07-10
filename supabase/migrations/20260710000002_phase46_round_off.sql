-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 46: Round Off
-- ─────────────────────────────────────────────────────────────────────────
-- Rounds document grand totals to the company's cash unit (0.25 / 0.50 /
-- 1.00; default OFF) and posts the difference to account 5900 Round Off.
--   • New identity: subtotal − discount + tax + round_off = total.
--     round_off_amount defaults to 0 → every existing document unchanged.
--   • Sales side (invoice / POS / credit note): revenue derives from
--     total − tax − round_off; 5900 takes the difference.
--   • Purchase side (vendor bill / debit note): manual round-off entered to
--     match the supplier's paper total; goods basis excludes it.
--   • JE header totals gain GREATEST(−round_off, 0) so both sides state the
--     true footing when rounding down.
-- All six functions reproduced from LIVE definitions (pg_get_functiondef)
-- with occurrence-verified replacements.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. Columns ─────────────────────────────────────────────────────────────
ALTER TABLE public.invoices     ADD COLUMN IF NOT EXISTS round_off_amount NUMERIC(15,2) NOT NULL DEFAULT 0;
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS round_off_amount NUMERIC(15,2) NOT NULL DEFAULT 0;
ALTER TABLE public.credit_notes ADD COLUMN IF NOT EXISTS round_off_amount NUMERIC(15,2) NOT NULL DEFAULT 0;
ALTER TABLE public.debit_notes  ADD COLUMN IF NOT EXISTS round_off_amount NUMERIC(15,2) NOT NULL DEFAULT 0;
ALTER TABLE public.sales_quotes ADD COLUMN IF NOT EXISTS round_off_amount NUMERIC(15,2) NOT NULL DEFAULT 0;

-- Company setting: 0 = off; 0.25 / 0.50 / 1.00 = round grand totals to step.
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS rounding_step NUMERIC(6,2) NOT NULL DEFAULT 0
  CHECK (rounding_step IN (0, 0.25, 0.50, 1.00));

-- ── 2. On-demand Round Off account (mirrors existing system-account style) ──
CREATE OR REPLACE FUNCTION public.ensure_round_off_account(p_company_id uuid)
RETURNS uuid
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_id   uuid;
  v_type text;
BEGIN
  SELECT id INTO v_id FROM public.chart_of_accounts
  WHERE company_id = p_company_id AND code = '5900' AND is_active
  LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  -- Mirror the COGS account's type so P&L grouping stays consistent.
  SELECT type INTO v_type FROM public.chart_of_accounts
  WHERE company_id = p_company_id AND code = '5100' LIMIT 1;

  INSERT INTO public.chart_of_accounts
    (company_id, code, name, name_ar, type, is_system, is_active)
  VALUES
    (p_company_id, '5900', 'Round Off', 'فروقات التقريب', COALESCE(v_type, 'expense'), TRUE, TRUE)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

-- ── 3. Posting functions (live defs + round-off legs) ──────────────────────
CREATE OR REPLACE FUNCTION public.confirm_invoice(p_invoice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
-- Cumulative phase tags (preserved so the regression suite's per-phase
-- markers still resolve): Phase 12.20, Phase 12.22, Phase 12.27, Phase 12.28
DECLARE
  v_user_id     UUID := auth.uid();
  v_company_id  UUID;
  v_inv         public.invoices%ROWTYPE;
  v_item        public.invoice_items%ROWTYPE;
  v_product_type TEXT;
  v_lock_date   DATE;
  v_inv_je_id   UUID;
  v_cogs_je_id  UUID;
  v_inv_entry   TEXT;
  v_cogs_entry  TEXT;
  v_seq         BIGINT;
  v_ar_id       UUID;
  v_sales_id    UUID;
  v_sales_disc_id UUID;
  v_vat_id      UUID;
  v_cogs_id     UUID;
  v_inv_acc_id  UUID;
  v_current_mac   NUMERIC(15,2);
  v_total_cogs    NUMERIC(15,2) := 0;
  v_wh_id         UUID;
  v_prev_running  NUMERIC(15,3);
  v_je_total      NUMERIC(15,2);
  v_round_off_acc UUID;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_invoice: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'confirm_invoice: invoice % not found', p_invoice_id; END IF;
  IF v_inv.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_invoice: invoice % not in draft (status=%)', p_invoice_id, v_inv.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_inv.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_invoice: date % on or before period lock %', v_inv.date, v_lock_date;
  END IF;

  v_wh_id := v_inv.warehouse_id;
  IF v_wh_id IS NULL THEN
    SELECT id INTO v_wh_id FROM public.warehouses WHERE company_id = v_company_id AND is_default = TRUE LIMIT 1;
  END IF;

  SELECT id INTO v_ar_id          FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1200' AND is_active;
  SELECT id INTO v_sales_id       FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '4100' AND is_active;
  SELECT id INTO v_sales_disc_id  FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '4150' AND is_active;
  SELECT id INTO v_cogs_id        FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '5100' AND is_active;
  SELECT id INTO v_inv_acc_id     FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1300' AND is_active;

  IF v_inv.tax_amount > 0 THEN
    SELECT id INTO v_vat_id FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND code LIKE '22%' AND is_active ORDER BY code LIMIT 1;
  END IF;

  IF v_sales_disc_id IS NOT NULL AND v_inv.discount_amount > 0 THEN
    v_je_total := v_inv.total_amount + v_inv.discount_amount + GREATEST(-COALESCE(v_inv.round_off_amount, 0), 0);
  ELSE
    v_je_total := v_inv.total_amount + GREATEST(-COALESCE(v_inv.round_off_amount, 0), 0);
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
    'Sales Invoice ' || v_inv.invoice_number,
    'sales_invoice', p_invoice_id, v_inv.currency, v_inv.exchange_rate,
    v_je_total, v_je_total, v_user_id
  ) RETURNING id INTO v_inv_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_inv_je_id, v_ar_id, '1200', v_inv.date, v_inv.total_amount, 0,
     'Sales Invoice ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);

  IF v_sales_disc_id IS NOT NULL AND v_inv.discount_amount > 0 THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_inv_je_id, v_sales_disc_id, '4150', v_inv.date, v_inv.discount_amount, 0,
       'Sales Discount ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);
  END IF;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_inv_je_id, v_sales_id, '4100', v_inv.date, 0,
     CASE
       WHEN v_sales_disc_id IS NOT NULL AND v_inv.discount_amount > 0
       THEN v_inv.total_amount - v_inv.tax_amount - COALESCE(v_inv.round_off_amount, 0) + v_inv.discount_amount
       ELSE v_inv.total_amount - v_inv.tax_amount - COALESCE(v_inv.round_off_amount, 0)
     END,
     'Sales Invoice ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);

  IF v_inv.tax_amount > 0 AND v_vat_id IS NOT NULL THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_inv_je_id, v_vat_id, '2200', v_inv.date, 0, v_inv.tax_amount,
       'Output VAT ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);
  END IF;

  -- Phase 46 — round-off difference (Cr 5900 when rounded up, Dr when down).
  IF COALESCE(v_inv.round_off_amount, 0) <> 0 THEN
    v_round_off_acc := public.ensure_round_off_account(v_company_id);
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_inv_je_id, v_round_off_acc, '5900', v_inv.date,
       GREATEST(-v_inv.round_off_amount, 0), GREATEST(v_inv.round_off_amount, 0),
       'Round Off ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);
  END IF;

  -- Per-item: stock_ledger + COGS (or defer). Phase 12.28 — skip for services.
  FOR v_item IN SELECT * FROM public.invoice_items WHERE invoice_id = p_invoice_id LOOP
    CONTINUE WHEN v_item.product_id IS NULL;

    -- Phase 12.28 — service items have no stock impact and no COGS.
    SELECT type INTO v_product_type FROM public.products WHERE id = v_item.product_id;
    CONTINUE WHEN v_product_type = 'service';

    SELECT COALESCE(running_avg_cost, 0)::NUMERIC(15,2) INTO v_current_mac
    FROM public.stock_ledger sl
    WHERE sl.company_id = v_company_id
      AND sl.product_id = v_item.product_id
      AND sl.reversal_of_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id)
    ORDER BY sl.seq DESC LIMIT 1;
    v_current_mac := COALESCE(v_current_mac, 0);

    UPDATE public.invoice_items SET cost_at_sale = v_current_mac WHERE id = v_item.id;

    SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_running
    FROM public.stock_ledger sl
    WHERE sl.company_id = v_company_id
      AND sl.product_id = v_item.product_id
      AND sl.warehouse_id = v_wh_id
      AND sl.reversal_of_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id)
    ORDER BY sl.seq DESC LIMIT 1;
    v_prev_running := COALESCE(v_prev_running, 0);

    INSERT INTO public.stock_ledger
      (company_id, product_id, warehouse_id, date, type, direction, quantity, unit_cost, total_cost,
       running_qty, running_avg_cost, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_item.product_id, v_wh_id, v_inv.date,
       'sale', -1, v_item.quantity, v_current_mac, v_item.quantity * v_current_mac,
       v_prev_running - v_item.quantity, v_current_mac, 'invoice', p_invoice_id);

    IF v_current_mac > 0 THEN
      v_total_cogs := v_total_cogs + v_item.quantity * v_current_mac;
    ELSE
      INSERT INTO public.deferred_cogs_queue
        (company_id, product_id, invoice_item_id, sale_invoice_id,
         sale_date, warehouse_id, quantity, status)
      VALUES
        (v_company_id, v_item.product_id, v_item.id, p_invoice_id,
         v_inv.date, v_wh_id, v_item.quantity, 'pending');
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
      company_id, entry_number, date, description,
      source_type, source_id, currency, exchange_rate,
      total_debit, total_credit, created_by
    ) VALUES (
      v_company_id, v_cogs_entry, v_inv.date,
      'COGS – Invoice ' || v_inv.invoice_number,
      'inventory_cogs', p_invoice_id, v_inv.currency, v_inv.exchange_rate,
      v_total_cogs, v_total_cogs, v_user_id
    ) RETURNING id INTO v_cogs_je_id;

    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_cogs_je_id, v_cogs_id, '5100', v_inv.date, v_total_cogs, 0,
       'COGS ' || v_inv.invoice_number, 'invoice', p_invoice_id),
      (v_company_id, v_cogs_je_id, v_inv_acc_id, '1300', v_inv.date, 0, v_total_cogs,
       'COGS ' || v_inv.invoice_number, 'invoice', p_invoice_id);
  END IF;

  UPDATE public.invoices SET status = 'confirmed', updated_at = NOW() WHERE id = p_invoice_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'invoice', p_invoice_id,
      jsonb_build_object('invoice_number', v_inv.invoice_number, 'je', v_inv_entry, 'phase', '12.28'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id, 'invoice_number', v_inv.invoice_number,
    'je_id', v_inv_je_id, 'entry_number', v_inv_entry
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.edit_invoice(p_invoice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
-- Cumulative phase tags (preserved so the regression suite's per-phase
-- markers still resolve): Phase 12.20, Phase 12.21, Phase 12.22, Phase 12.27, Phase 12.28
DECLARE
  v_user_id     UUID := auth.uid();
  v_company_id  UUID;
  v_inv         public.invoices%ROWTYPE;
  v_item        public.invoice_items%ROWTYPE;
  v_product_type TEXT;
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
  v_sales_disc_id UUID;
  v_vat_id      UUID;
  v_cogs_id     UUID;
  v_inv_acc_id  UUID;
  v_current_mac   NUMERIC(15,2);
  v_total_cogs    NUMERIC(15,2) := 0;
  v_wh_id         UUID;
  v_prev_running  NUMERIC(15,3);
  v_je_total      NUMERIC(15,2);
  v_round_off_acc UUID;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'edit_invoice: no company for user'; END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'edit_invoice: invoice % not found', p_invoice_id; END IF;
  IF v_inv.status <> 'confirmed' THEN
    RAISE EXCEPTION 'edit_invoice: invoice % must be confirmed (status=%)', p_invoice_id, v_inv.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_inv.date <= v_lock_date THEN
    RAISE EXCEPTION 'edit_invoice: voucher date % on or before period lock %', v_inv.date, v_lock_date;
  END IF;

  -- Step 1 — Reverse existing sales + cogs JEs (Phase 12.21).
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
    IF v_lock_date IS NOT NULL AND v_je.date <= v_lock_date THEN
      RAISE EXCEPTION 'Cannot reverse: the original posting dated % is in a locked period (lock %).', v_je.date, v_lock_date;
    END IF;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description,
      source_type, source_id, currency, exchange_rate,
      total_debit, total_credit, reversal_of_id, created_by
    ) VALUES (
      v_company_id, v_rev_entry, v_je.date,
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
        v_company_id, v_rev_id, v_gl.account_id, v_gl.account_code, v_gl.date,
        v_gl.credit, v_gl.debit,
        'Edit Reversal – ' || v_inv.invoice_number,
        v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
      );
    END LOOP;

    UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
  END LOOP;

  -- Step 2 — Reverse stock_ledger rows (Phase 12.21).
  FOR v_sl IN
    SELECT sl.* FROM public.stock_ledger sl
    WHERE sl.company_id = v_company_id
      AND sl.related_doc_id = p_invoice_id
      AND sl.related_doc_type = 'invoice'
      AND sl.reversal_of_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id)
  LOOP
    SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_running
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_sl.product_id AND warehouse_id = v_sl.warehouse_id
    ORDER BY seq DESC LIMIT 1;

    INSERT INTO public.stock_ledger (
      company_id, product_id, warehouse_id, date,
      type, direction, quantity, unit_cost, total_cost,
      running_qty, running_avg_cost,
      related_doc_type, related_doc_id, reversal_of_id
    ) VALUES (
      v_company_id, v_sl.product_id, v_sl.warehouse_id, v_sl.date,
      'edit_reversal', -v_sl.direction, v_sl.quantity, v_sl.unit_cost, v_sl.total_cost,
      v_prev_running + v_sl.quantity * (-v_sl.direction),
      v_sl.running_avg_cost,
      'invoice', p_invoice_id, v_sl.id
    );
  END LOOP;

  -- Step 3 — Repost (Phase 12.22 gross method + Phase 12.27 defer + Phase 12.28 service).
  v_wh_id := v_inv.warehouse_id;
  IF v_wh_id IS NULL THEN
    SELECT id INTO v_wh_id FROM public.warehouses WHERE company_id = v_company_id AND is_default LIMIT 1;
  END IF;

  SELECT id INTO v_ar_id          FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1200' AND is_active;
  SELECT id INTO v_sales_id       FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '4100' AND is_active;
  SELECT id INTO v_sales_disc_id  FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '4150' AND is_active;
  SELECT id INTO v_cogs_id        FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '5100' AND is_active;
  SELECT id INTO v_inv_acc_id     FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1300' AND is_active;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id;

  IF v_inv.tax_amount > 0 THEN
    SELECT id INTO v_vat_id FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND code LIKE '22%' AND is_active ORDER BY code LIMIT 1;
  END IF;

  IF v_sales_disc_id IS NOT NULL AND v_inv.discount_amount > 0 THEN
    v_je_total := v_inv.total_amount + v_inv.discount_amount + GREATEST(-COALESCE(v_inv.round_off_amount, 0), 0);
  ELSE
    v_je_total := v_inv.total_amount + GREATEST(-COALESCE(v_inv.round_off_amount, 0), 0);
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
    v_je_total, v_je_total, v_user_id
  ) RETURNING id INTO v_inv_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_inv_je_id, v_ar_id, '1200', v_inv.date, v_inv.total_amount, 0,
     'Invoice (Edited) ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);

  IF v_sales_disc_id IS NOT NULL AND v_inv.discount_amount > 0 THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_inv_je_id, v_sales_disc_id, '4150', v_inv.date, v_inv.discount_amount, 0,
       'Sales Discount (Edited) ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);
  END IF;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_inv_je_id, v_sales_id, '4100', v_inv.date, 0,
     CASE
       WHEN v_sales_disc_id IS NOT NULL AND v_inv.discount_amount > 0
       THEN v_inv.total_amount - v_inv.tax_amount - COALESCE(v_inv.round_off_amount, 0) + v_inv.discount_amount
       ELSE v_inv.total_amount - v_inv.tax_amount - COALESCE(v_inv.round_off_amount, 0)
     END,
     'Invoice (Edited) ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);

  IF v_inv.tax_amount > 0 AND v_vat_id IS NOT NULL THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_inv_je_id, v_vat_id, '2200', v_inv.date, 0, v_inv.tax_amount,
       'Output VAT (Edited) ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);
  END IF;

  -- Phase 46 — round-off difference (Cr 5900 when rounded up, Dr when down).
  IF COALESCE(v_inv.round_off_amount, 0) <> 0 THEN
    v_round_off_acc := public.ensure_round_off_account(v_company_id);
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_inv_je_id, v_round_off_acc, '5900', v_inv.date,
       GREATEST(-v_inv.round_off_amount, 0), GREATEST(v_inv.round_off_amount, 0),
       'Round Off ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);
  END IF;

  -- Per-item: stock + COGS, with Phase 12.28 service bypass.
  FOR v_item IN SELECT * FROM public.invoice_items WHERE invoice_id = p_invoice_id LOOP
    CONTINUE WHEN v_item.product_id IS NULL;
    SELECT type INTO v_product_type FROM public.products WHERE id = v_item.product_id;
    CONTINUE WHEN v_product_type = 'service';

    SELECT COALESCE(running_avg_cost, 0)::NUMERIC(15,2) INTO v_current_mac
    FROM public.stock_ledger sl
    WHERE sl.company_id = v_company_id AND sl.product_id = v_item.product_id
      AND sl.reversal_of_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id)
    ORDER BY sl.seq DESC LIMIT 1;
    v_current_mac := COALESCE(v_current_mac, 0);

    UPDATE public.invoice_items SET cost_at_sale = v_current_mac WHERE id = v_item.id;

    SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_running
    FROM public.stock_ledger sl
    WHERE sl.company_id = v_company_id AND sl.product_id = v_item.product_id
      AND sl.warehouse_id = v_wh_id
      AND sl.reversal_of_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id)
    ORDER BY sl.seq DESC LIMIT 1;
    v_prev_running := COALESCE(v_prev_running, 0);

    INSERT INTO public.stock_ledger
      (company_id, product_id, warehouse_id, date, type, direction, quantity, unit_cost, total_cost,
       running_qty, running_avg_cost, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_item.product_id, v_wh_id, v_inv.date,
       'sale', -1, v_item.quantity, v_current_mac, v_item.quantity * v_current_mac,
       v_prev_running - v_item.quantity, v_current_mac, 'invoice', p_invoice_id);

    IF v_current_mac > 0 THEN
      v_total_cogs := v_total_cogs + v_item.quantity * v_current_mac;
    ELSE
      INSERT INTO public.deferred_cogs_queue
        (company_id, product_id, invoice_item_id, sale_invoice_id,
         sale_date, warehouse_id, quantity, status)
      VALUES
        (v_company_id, v_item.product_id, v_item.id, p_invoice_id,
         v_inv.date, v_wh_id, v_item.quantity, 'pending');
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
      v_company_id, v_cogs_entry, v_inv.date,
      'COGS (Edited) – ' || v_inv.invoice_number,
      'inventory_cogs', p_invoice_id, v_inv.currency, v_inv.exchange_rate,
      v_total_cogs, v_total_cogs, v_user_id
    ) RETURNING id INTO v_cogs_je_id;

    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_cogs_je_id, v_cogs_id, '5100', v_inv.date, v_total_cogs, 0,
       'COGS (Edited) ' || v_inv.invoice_number, 'invoice', p_invoice_id),
      (v_company_id, v_cogs_je_id, v_inv_acc_id, '1300', v_inv.date, 0, v_total_cogs,
       'COGS (Edited) ' || v_inv.invoice_number, 'invoice', p_invoice_id);
  END IF;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'edit', 'invoice', p_invoice_id,
      jsonb_build_object('invoice_number', v_inv.invoice_number, 'je', v_inv_entry, 'phase', '12.28'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id, 'invoice_number', v_inv.invoice_number,
    'je_id', v_inv_je_id, 'entry_number', v_inv_entry
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.confirm_pos_sale(p_session_id uuid, p_items jsonb, p_payment_method text, p_customer_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id       UUID := auth.uid();
  v_company_id    UUID;
  v_currency      TEXT;
  v_session       public.pos_sessions%ROWTYPE;
  v_lock_date     DATE;
  v_today         DATE := CURRENT_DATE;

  v_subtotal      NUMERIC(15,2) := 0;
  v_discount      NUMERIC(15,2) := 0;
  v_tax_total     NUMERIC(15,2) := 0;
  v_grand_total   NUMERIC(15,2) := 0;

  v_elem          JSONB;
  v_product_id    UUID;
  v_product_type  TEXT;          -- Phase 36
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

  v_seq           BIGINT;
  v_inv_number    TEXT;
  v_inv_id        UUID;
  v_je_id         UUID;
  v_cogs_je_id    UUID;
  v_entry         TEXT;
  v_cogs_entry    TEXT;

  v_debit_id      UUID;
  v_debit_code    TEXT;
  v_sales_id      UUID;
  v_vat_id        UUID;
  v_cogs_id       UUID;
  v_inv_acc_id    UUID;

  v_current_mac   NUMERIC(15,2);
  v_prev_running  NUMERIC(15,3);
  v_total_cogs    NUMERIC(15,2) := 0;
  v_round_off_acc UUID;
  v_round_step NUMERIC(6,2) := 0;
  v_round_off NUMERIC(15,2) := 0;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_pos_sale: no company for user %', v_user_id;
  END IF;

  SELECT base_currency INTO v_currency FROM public.companies WHERE id = v_company_id;

  SELECT * INTO v_session
  FROM public.pos_sessions
  WHERE id = p_session_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_pos_sale: session % not found', p_session_id;
  END IF;
  IF v_session.status <> 'open' THEN
    RAISE EXCEPTION 'confirm_pos_sale: session % is not open', p_session_id;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_today <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_pos_sale: today is in locked period (lock=%)', v_lock_date;
  END IF;

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

  SELECT id INTO v_debit_id    FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = v_debit_code AND is_active LIMIT 1;
  SELECT id INTO v_sales_id    FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '4100'       AND is_active LIMIT 1;
  SELECT id INTO v_cogs_id     FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '5100'       AND is_active LIMIT 1;
  SELECT id INTO v_inv_acc_id  FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1300'       AND is_active LIMIT 1;
  SELECT id INTO v_vat_id      FROM public.chart_of_accounts WHERE company_id = v_company_id AND code LIKE '22%'     AND is_active ORDER BY code LIMIT 1;

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

  INSERT INTO public.document_sequences
    (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES
    (v_company_id, 'INV', 1000, 'INV-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1,
        updated_at    = NOW()
  RETURNING current_value INTO v_seq;
  v_inv_number := 'INV-' || v_seq::TEXT;

  -- Phase 46 — round the grand total per company setting.
  SELECT COALESCE(rounding_step, 0) INTO v_round_step FROM public.companies WHERE id = v_company_id;
  IF v_round_step > 0 THEN
    v_round_off   := ROUND(ROUND(v_grand_total / v_round_step) * v_round_step - v_grand_total, 2);
    v_grand_total := ROUND(v_grand_total + v_round_off, 2);
  END IF;

  INSERT INTO public.invoices (
    company_id, invoice_number, contact_id, warehouse_id,
    date, due_date, currency, exchange_rate,
    subtotal, discount_amount, tax_amount, total_amount, round_off_amount,
    status, sale_channel, pos_session_id, notes
  ) VALUES (
    v_company_id, v_inv_number, p_customer_id, v_session.warehouse_id,
    v_today, v_today, v_currency, 1.0,
    v_subtotal, v_discount, v_tax_total, v_grand_total, v_round_off,
    'confirmed',
    CASE p_payment_method
      WHEN 'cash'  THEN 'pos_cash'
      WHEN 'card'  THEN 'pos_card'
      ELSE              'pos_credit'
    END,
    p_session_id, p_notes
  ) RETURNING id INTO v_inv_id;

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

    -- Phase 36 — services carry no cost, no stock, no COGS.
    v_product_type := NULL;
    IF v_product_id IS NOT NULL THEN
      SELECT type INTO v_product_type FROM public.products WHERE id = v_product_id;
    END IF;

    SELECT COALESCE(running_avg_cost, 0)::NUMERIC(15,2)
    INTO v_current_mac
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_product_id
    ORDER BY seq DESC LIMIT 1;
    v_current_mac := COALESCE(v_current_mac, 0);
    IF v_product_type = 'service' THEN v_current_mac := 0; END IF;   -- Phase 36

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

    -- Phase 36 — services: revenue only. No stock row, no COGS, no deferred queue.
    IF v_product_type IS DISTINCT FROM 'service' THEN
      IF v_current_mac > 0 THEN
        v_total_cogs := v_total_cogs + ROUND(v_item_qty * v_current_mac, 2);

        SELECT COALESCE(running_qty, 0)::NUMERIC(15,3)
        INTO v_prev_running
        FROM public.stock_ledger
        WHERE company_id = v_company_id
          AND product_id = v_product_id
          AND warehouse_id = v_session.warehouse_id
        ORDER BY seq DESC LIMIT 1;
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
        INSERT INTO public.deferred_cogs_queue
          (company_id, product_id, invoice_item_id, sale_invoice_id,
           sale_date, warehouse_id, quantity, status)
        VALUES
          (v_company_id, v_product_id, v_item_id, v_inv_id,
           v_today, v_session.warehouse_id, v_item_qty, 'pending');
      END IF;
    END IF;
  END LOOP;

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
    v_grand_total + GREATEST(-v_round_off, 0), v_grand_total + GREATEST(-v_round_off, 0), v_user_id
  ) RETURNING id INTO v_je_id;

  INSERT INTO public.general_ledger (
    company_id, journal_entry_id, account_id, account_code, date,
    debit, credit, description, contact_id, related_doc_type, related_doc_id
  ) VALUES (
    v_company_id, v_je_id, v_debit_id, v_debit_code, v_today,
    v_grand_total, 0,
    v_inv_number, p_customer_id, 'invoice', v_inv_id
  );

  INSERT INTO public.general_ledger (
    company_id, journal_entry_id, account_id, account_code, date,
    debit, credit, description, contact_id, related_doc_type, related_doc_id
  ) VALUES (
    v_company_id, v_je_id, v_sales_id, '4100', v_today,
    0, v_subtotal - v_discount,
    v_inv_number, p_customer_id, 'invoice', v_inv_id
  );

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

  -- Phase 46 — round-off difference (Cr 5900 when rounded up, Dr when down).
  IF v_round_off <> 0 THEN
    v_round_off_acc := public.ensure_round_off_account(v_company_id);
    INSERT INTO public.general_ledger (
      company_id, journal_entry_id, account_id, account_code, date,
      debit, credit, description, contact_id, related_doc_type, related_doc_id
    ) VALUES (
      v_company_id, v_je_id, v_round_off_acc, '5900', v_today,
      GREATEST(-v_round_off, 0), GREATEST(v_round_off, 0),
      'Round Off ' || v_inv_number, p_customer_id, 'invoice', v_inv_id
    );
  END IF;

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

    INSERT INTO public.general_ledger (
      company_id, journal_entry_id, account_id, account_code, date,
      debit, credit, description, related_doc_type, related_doc_id
    ) VALUES (
      v_company_id, v_cogs_je_id, v_cogs_id, '5100', v_today,
      v_total_cogs, 0, 'COGS ' || v_inv_number, 'invoice', v_inv_id
    );

    INSERT INTO public.general_ledger (
      company_id, journal_entry_id, account_id, account_code, date,
      debit, credit, description, related_doc_type, related_doc_id
    ) VALUES (
      v_company_id, v_cogs_je_id, v_inv_acc_id, '1300', v_today,
      0, v_total_cogs, 'COGS ' || v_inv_number, 'invoice', v_inv_id
    );
  END IF;

  UPDATE public.pos_sessions SET
    total_sales_amount = COALESCE(total_sales_amount, 0) + v_grand_total,
    total_sales_count  = COALESCE(total_sales_count, 0) + 1,
    updated_at         = NOW()
  WHERE id = p_session_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'pos_sale', v_inv_id,
      jsonb_build_object('invoice_number', v_inv_number, 'payment_method', p_payment_method,
                         'total', v_grand_total, 'session', p_session_id, 'phase', '36'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'invoice_id',     v_inv_id,
    'invoice_number', v_inv_number,
    'total_amount',   v_grand_total
  );
END;
$function$
;

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
    v_bill.total_amount + GREATEST(-COALESCE(v_bill.round_off_amount, 0), 0),
    v_bill.total_amount + GREATEST(-COALESCE(v_bill.round_off_amount, 0), 0),
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

      IF v_flush_mac <= 0 THEN CONTINUE; END IF;

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
    END LOOP;

    IF v_flush_je_id IS NOT NULL THEN
      UPDATE public.journal_entries
      SET total_debit  = v_flush_total,
          total_credit = v_flush_total
      WHERE id = v_flush_je_id;
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
        'phase',             '36'
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
$function$
;

CREATE OR REPLACE FUNCTION public.confirm_credit_note(p_credit_note_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.confirm_debit_note(p_debit_note_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id       UUID := auth.uid();
  v_company_id    UUID;
  v_dn            public.debit_notes%ROWTYPE;
  v_item          public.debit_note_items%ROWTYPE;
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
    IF v_item.product_id IS NOT NULL AND v_item.unit_cost > 0 THEN
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
        v_new_mac := (v_old_value - v_item.quantity * v_item.unit_cost) / (v_old_qty - v_item.quantity);
      END IF;

      INSERT INTO public.stock_ledger
        (company_id, product_id, warehouse_id, date,
         type, direction, quantity, unit_cost, total_cost,
         running_qty, running_avg_cost,
         related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_item.product_id, v_wh_id, v_dn.date,
         'purchase_return', -1, v_item.quantity, v_item.unit_cost,
         v_item.quantity * v_item.unit_cost,
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

NOTIFY pgrst, 'reload schema';
