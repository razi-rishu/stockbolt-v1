-- =============================================================================
-- Phase 41 — Deterministic stock_ledger ordering (seq) fixes E1 ghost drift
-- =============================================================================
-- Every "current MAC / running qty" read picks the LATEST stock_ledger row
-- ordered by created_at with the row's random UUID as tiebreaker. Rows
-- written in the same transaction share an identical created_at (e.g. an
-- edit's reversal + its replacement sale), so the "latest" row was a coin
-- flip. Live consequence at Pro_Parts: COVERING TARP's reversal row won the
-- flip, System Health E1 showed a 1,310.00 phantom drift (GL was correct),
-- and the next sale of such a product could read a nondeterministic MAC.
--
-- Fix: a monotonic seq column on stock_ledger (backfilled in created_at
-- order; within the same timestamp, reversal rows sort BEFORE replacement
-- rows — matching the order posting functions write them). All 20 functions
-- that read "the latest row" or replay the ledger now order by seq. Finally
-- recompute_stock_valuation(NULL) rebuilds every running chain with the
-- deterministic order. Functions reproduced from live pg_get_functiondef.
-- =============================================================================

-- 1. seq column, deterministic backfill, then auto-increment for new rows.
ALTER TABLE public.stock_ledger ADD COLUMN IF NOT EXISTS seq BIGINT;

WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (
    ORDER BY created_at,
             (reversal_of_id IS NOT NULL) DESC,  -- reversals precede replacements in a tie
             id
  ) AS rn
  FROM public.stock_ledger
)
UPDATE public.stock_ledger sl SET seq = o.rn
FROM ordered o WHERE o.id = sl.id AND sl.seq IS NULL;

CREATE SEQUENCE IF NOT EXISTS public.stock_ledger_seq_seq OWNED BY public.stock_ledger.seq;
SELECT setval('public.stock_ledger_seq_seq', COALESCE((SELECT MAX(seq) FROM public.stock_ledger), 0) + 1, false);
ALTER TABLE public.stock_ledger ALTER COLUMN seq SET DEFAULT nextval('public.stock_ledger_seq_seq');
ALTER TABLE public.stock_ledger ALTER COLUMN seq SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_ledger_product_seq
  ON public.stock_ledger (company_id, product_id, seq DESC);

-- 2. Re-point every stock_ledger ordering onto seq.

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
    v_je_total := v_inv.total_amount + v_inv.discount_amount;
  ELSE
    v_je_total := v_inv.total_amount;
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
       THEN v_inv.total_amount - v_inv.tax_amount + v_inv.discount_amount
       ELSE v_inv.total_amount - v_inv.tax_amount
     END,
     'Sales Invoice ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);

  IF v_inv.tax_amount > 0 AND v_vat_id IS NOT NULL THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_inv_je_id, v_vat_id, '2200', v_inv.date, 0, v_inv.tax_amount,
       'Output VAT ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);
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
$function$;


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
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'edit_invoice: no company for user'; END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'edit_invoice: invoice % not found', p_invoice_id; END IF;
  IF v_inv.status <> 'confirmed' THEN
    RAISE EXCEPTION 'edit_invoice: invoice % must be confirmed (status=%)', p_invoice_id, v_inv.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND CURRENT_DATE <= v_lock_date THEN
    RAISE EXCEPTION 'edit_invoice: today % on or before period lock %', CURRENT_DATE, v_lock_date;
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
      v_company_id, v_sl.product_id, v_sl.warehouse_id, CURRENT_DATE,
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
    v_je_total := v_inv.total_amount + v_inv.discount_amount;
  ELSE
    v_je_total := v_inv.total_amount;
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
       THEN v_inv.total_amount - v_inv.tax_amount + v_inv.discount_amount
       ELSE v_inv.total_amount - v_inv.tax_amount
     END,
     'Invoice (Edited) ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);

  IF v_inv.tax_amount > 0 AND v_vat_id IS NOT NULL THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_inv_je_id, v_vat_id, '2200', v_inv.date, 0, v_inv.tax_amount,
       'Output VAT (Edited) ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);
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
      (v_company_id, v_item.product_id, v_wh_id, CURRENT_DATE,
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
      jsonb_build_object('invoice_number', v_inv.invoice_number, 'je', v_inv_entry, 'phase', '12.28'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id, 'invoice_number', v_inv.invoice_number,
    'je_id', v_inv_je_id, 'entry_number', v_inv_entry
  );
END;
$function$;


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
    v_grand_total, v_grand_total, v_user_id
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
$function$;


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
    v_bill.total_amount, v_bill.total_amount,
    v_user_id
  ) RETURNING id INTO v_je_id;

  IF v_bill.linked_grn_id IS NOT NULL THEN
    SELECT COALESCE(SUM(total_cost), 0) INTO v_grn_total
    FROM public.goods_receipt_items WHERE grn_id = v_bill.linked_grn_id;

    v_bill_goods := v_bill.total_amount - v_bill.tax_amount;
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
$function$;


CREATE OR REPLACE FUNCTION public.edit_vendor_bill(p_bill_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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
  v_requeued     INT := 0;
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

  -- Only hard block: payments already applied to this bill.
  IF EXISTS (
    SELECT 1 FROM public.payment_allocations
    WHERE company_id = v_company_id AND doc_type = 'vendor_bill' AND doc_id = p_bill_id
  ) THEN
    RAISE EXCEPTION 'This bill has payments applied. Void or unapply the payment(s) before editing.';
  END IF;

  -- ── Step 1+2: reverse the bill JE AND any deferred-COGS flush JE ───────
  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id
      AND source_id = p_bill_id
      AND source_type IN ('vendor_bill', 'inventory_cogs')
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

  -- ── Step 3: re-queue deferred-COGS rows this bill flushed ─────────────
  -- They go back to 'pending' so re-confirm re-flushes them at the new MAC.
  UPDATE public.deferred_cogs_queue
  SET status = 'pending', flushed_at = NULL,
      flushed_journal_entry_id = NULL, flush_unit_cost = NULL, updated_at = NOW()
  WHERE company_id = v_company_id
    AND flushed_journal_entry_id IN (
      SELECT id FROM public.journal_entries
      WHERE company_id = v_company_id AND source_id = p_bill_id AND source_type = 'inventory_cogs'
    );
  GET DIAGNOSTICS v_requeued = ROW_COUNT;

  -- ── Step 4: reverse the bill's stock rows (un-receive the goods) ──────
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
    ORDER BY seq DESC LIMIT 1;

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

  -- ── Step 5: back to draft for editing + re-confirm ───────────────────
  UPDATE public.vendor_bills SET status = 'draft', updated_at = NOW() WHERE id = p_bill_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'edit_reopen', 'vendor_bill', p_bill_id,
      jsonb_build_object('bill_number', v_bill.bill_number,
                         'jes_reversed', v_reversed, 'cogs_requeued', v_requeued));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('bill_id', p_bill_id, 'bill_number', v_bill.bill_number,
                            'status', 'draft', 'cogs_requeued', v_requeued);
END;
$function$;


CREATE OR REPLACE FUNCTION public.confirm_grn(p_grn_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id        UUID := auth.uid();
  v_company_id     UUID;
  v_grn            public.goods_receipts%ROWTYPE;
  v_item           public.goods_receipt_items%ROWTYPE;
  v_lock_date      DATE;
  v_currency       TEXT;
  v_je_id          UUID;
  v_entry          TEXT;
  v_seq            BIGINT;
  v_inv_id         UUID;
  v_accrual_id     UUID;
  v_old_mac        NUMERIC(15,2);
  v_old_total_qty  NUMERIC(15,3);
  v_qty_for_mac    NUMERIC(15,3);
  v_new_mac        NUMERIC(15,2);
  v_prev_wh_qty    NUMERIC(15,3);
  v_total_cost     NUMERIC(15,2) := 0;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_grn: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_grn FROM public.goods_receipts WHERE id = p_grn_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_grn: GRN % not found', p_grn_id;
  END IF;
  IF v_grn.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_grn: GRN % not in draft (status=%)', p_grn_id, v_grn.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_grn.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_grn: date % on or before period lock %', v_grn.date, v_lock_date;
  END IF;

  SELECT COALESCE(currency, 'AED') INTO v_currency FROM public.companies WHERE id = v_company_id;

  SELECT id INTO v_inv_id     FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1300' AND is_active;
  SELECT id INTO v_accrual_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2150' AND is_active;

  IF v_inv_id IS NULL THEN
    RAISE EXCEPTION 'confirm_grn: account 1300 not found';
  END IF;
  IF v_accrual_id IS NULL THEN
    RAISE EXCEPTION 'confirm_grn: account 2150 not found';
  END IF;

  FOR v_item IN SELECT * FROM public.goods_receipt_items WHERE grn_id = p_grn_id LOOP
    v_total_cost := v_total_cost + v_item.total_cost;

    SELECT COALESCE(running_avg_cost, 0) INTO v_old_mac
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_item.product_id
    ORDER BY seq DESC LIMIT 1;
    v_old_mac := COALESCE(v_old_mac, 0);

    SELECT COALESCE(SUM(latest_qty), 0) INTO v_old_total_qty
    FROM (
      SELECT DISTINCT ON (warehouse_id) running_qty AS latest_qty
      FROM public.stock_ledger
      WHERE company_id = v_company_id AND product_id = v_item.product_id
      ORDER BY warehouse_id, seq DESC
    ) sub;
    v_old_total_qty := COALESCE(v_old_total_qty, 0);

    -- Clamp to zero for MAC weighting — negative stock from a back-ordered
    -- sale shouldn't pollute the average cost we're about to record.
    v_qty_for_mac := GREATEST(v_old_total_qty, 0);

    IF v_qty_for_mac + v_item.qty_received > 0 THEN
      v_new_mac := ROUND(
        (v_old_mac * v_qty_for_mac + v_item.unit_cost * v_item.qty_received) /
        (v_qty_for_mac + v_item.qty_received),
        2
      );
    ELSE
      v_new_mac := v_item.unit_cost;
    END IF;

    SELECT COALESCE(running_qty, 0) INTO v_prev_wh_qty
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_item.product_id
      AND warehouse_id = v_grn.warehouse_id
    ORDER BY seq DESC LIMIT 1;
    v_prev_wh_qty := COALESCE(v_prev_wh_qty, 0);

    INSERT INTO public.stock_ledger
      (company_id, product_id, warehouse_id, date,
       type, direction, quantity, unit_cost, total_cost,
       running_qty, running_avg_cost,
       related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_item.product_id, v_grn.warehouse_id, v_grn.date,
       'purchase', 1, v_item.qty_received, v_item.unit_cost, v_item.total_cost,
       v_prev_wh_qty + v_item.qty_received, v_new_mac,
       'goods_receipt', p_grn_id);
  END LOOP;

  IF v_total_cost = 0 THEN
    RAISE EXCEPTION 'confirm_grn: GRN % has no items or zero total cost', p_grn_id;
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
    v_company_id, v_entry, v_grn.date,
    'Goods Receipt ' || v_grn.grn_number,
    'goods_receipt', p_grn_id,
    v_currency, 1.0,
    v_total_cost, v_total_cost,
    v_user_id
  ) RETURNING id INTO v_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date,
     debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_inv_id, '1300', v_grn.date,
     v_total_cost, 0,
     'Goods Receipt ' || v_grn.grn_number,
     v_grn.supplier_id, 'goods_receipt', p_grn_id);

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date,
     debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_accrual_id, '2150', v_grn.date,
     0, v_total_cost,
     'Goods Receipt ' || v_grn.grn_number,
     v_grn.supplier_id, 'goods_receipt', p_grn_id);

  UPDATE public.goods_receipts SET status = 'received', updated_at = NOW() WHERE id = p_grn_id;

  IF v_grn.purchase_order_id IS NOT NULL THEN
    UPDATE public.purchase_orders
    SET status = 'received', updated_at = NOW()
    WHERE id = v_grn.purchase_order_id AND company_id = v_company_id
      AND status IN ('draft','sent','partially_received');
  END IF;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'goods_receipt', p_grn_id,
      jsonb_build_object('grn_number', v_grn.grn_number, 'je', v_entry, 'total_cost', v_total_cost));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'grn_id',       p_grn_id,
    'grn_number',   v_grn.grn_number,
    'je_id',        v_je_id,
    'entry_number', v_entry
  );
END;
$function$;


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
  IF (v_cn.total_amount - v_cn.tax_amount) > 0 THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
       description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_revenue_id, '4100', v_cn.date,
       v_cn.total_amount - v_cn.tax_amount, 0,
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
$function$;


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
    v_dn.total_amount, v_dn.total_amount,
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
$function$;


CREATE OR REPLACE FUNCTION public.confirm_stock_transfer(p_transfer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id        UUID := auth.uid();
  v_company_id     UUID;
  v_transfer       public.stock_transfers%ROWTYPE;
  v_item           RECORD;
  v_lock_date      DATE;
  v_from_qty       NUMERIC(15,3);
  v_to_qty         NUMERIC(15,3);
  v_mac            NUMERIC(15,2);
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_stock_transfer: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_transfer
  FROM public.stock_transfers
  WHERE id = p_transfer_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_stock_transfer: transfer % not found', p_transfer_id;
  END IF;
  IF v_transfer.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_stock_transfer: transfer % not in draft (status=%)', p_transfer_id, v_transfer.status;
  END IF;
  IF v_transfer.from_warehouse_id = v_transfer.to_warehouse_id THEN
    RAISE EXCEPTION 'confirm_stock_transfer: from and to warehouse must differ';
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_transfer.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_stock_transfer: date % on or before period lock %', v_transfer.date, v_lock_date;
  END IF;

  -- Process each line item
  FOR v_item IN
    SELECT * FROM public.stock_transfer_items WHERE transfer_id = p_transfer_id
  LOOP
    -- Current company-wide MAC for this product
    SELECT COALESCE(running_avg_cost, 0) INTO v_mac
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_item.product_id
    ORDER BY seq DESC LIMIT 1;
    v_mac := COALESCE(v_mac, COALESCE(v_item.unit_cost, 0));

    -- Running qty at from_warehouse
    SELECT COALESCE(running_qty, 0) INTO v_from_qty
    FROM public.stock_ledger
    WHERE company_id = v_company_id
      AND product_id = v_item.product_id
      AND warehouse_id = v_transfer.from_warehouse_id
    ORDER BY seq DESC LIMIT 1;
    v_from_qty := COALESCE(v_from_qty, 0);

    -- Running qty at to_warehouse
    SELECT COALESCE(running_qty, 0) INTO v_to_qty
    FROM public.stock_ledger
    WHERE company_id = v_company_id
      AND product_id = v_item.product_id
      AND warehouse_id = v_transfer.to_warehouse_id
    ORDER BY seq DESC LIMIT 1;
    v_to_qty := COALESCE(v_to_qty, 0);

    -- Row 1: transfer_out (from warehouse loses stock)
    INSERT INTO public.stock_ledger
      (company_id, product_id, warehouse_id, date,
       type, direction, quantity, unit_cost, total_cost,
       running_qty, running_avg_cost,
       related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_item.product_id, v_transfer.from_warehouse_id, v_transfer.date,
       'transfer_out', -1, v_item.quantity, v_mac, v_mac * v_item.quantity,
       v_from_qty - v_item.quantity, v_mac,
       'stock_transfer', p_transfer_id);

    -- Row 2: transfer_in (to warehouse gains stock)
    INSERT INTO public.stock_ledger
      (company_id, product_id, warehouse_id, date,
       type, direction, quantity, unit_cost, total_cost,
       running_qty, running_avg_cost,
       related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_item.product_id, v_transfer.to_warehouse_id, v_transfer.date,
       'transfer_in', 1, v_item.quantity, v_mac, v_mac * v_item.quantity,
       v_to_qty + v_item.quantity, v_mac,
       'stock_transfer', p_transfer_id);
  END LOOP;

  UPDATE public.stock_transfers
  SET status = 'confirmed', updated_at = NOW()
  WHERE id = p_transfer_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'stock_transfer', p_transfer_id,
      jsonb_build_object('transfer_number', v_transfer.transfer_number));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'transfer_id',     p_transfer_id,
    'transfer_number', v_transfer.transfer_number
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.confirm_inventory_adjustment(p_adjustment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id        UUID := auth.uid();
  v_company_id     UUID;
  v_adj            public.inventory_adjustments%ROWTYPE;
  v_item           RECORD;
  v_lock_date      DATE;
  v_currency       TEXT;
  -- GL account IDs
  v_acct_1300      UUID;
  v_acct_4300      UUID;
  v_acct_6700      UUID;
  -- Totals
  v_total_gain     NUMERIC(15,2) := 0;
  v_total_loss     NUMERIC(15,2) := 0;
  -- JEs
  v_gain_je_id     UUID;
  v_loss_je_id     UUID;
  v_gain_entry     TEXT;
  v_loss_entry     TEXT;
  v_seq            BIGINT;
  -- Per-item
  v_running_qty    NUMERIC(15,3);
  v_mac            NUMERIC(15,2);
  v_item_cost      NUMERIC(15,2);
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_inventory_adjustment: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_adj
  FROM public.inventory_adjustments
  WHERE id = p_adjustment_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_inventory_adjustment: adjustment % not found', p_adjustment_id;
  END IF;
  IF v_adj.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_inventory_adjustment: already confirmed (status=%)', v_adj.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_adj.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_inventory_adjustment: date % on or before period lock %', v_adj.date, v_lock_date;
  END IF;

  SELECT COALESCE(currency, 'AED') INTO v_currency FROM public.companies WHERE id = v_company_id;

  SELECT id INTO v_acct_1300 FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND code = '1300' AND is_active LIMIT 1;
  SELECT id INTO v_acct_4300 FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND code = '4300' AND is_active LIMIT 1;
  SELECT id INTO v_acct_6700 FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND code = '6700' AND is_active LIMIT 1;

  IF v_acct_1300 IS NULL THEN RAISE EXCEPTION 'Account 1300 not found'; END IF;
  IF v_acct_4300 IS NULL THEN RAISE EXCEPTION 'Account 4300 not found'; END IF;
  IF v_acct_6700 IS NULL THEN RAISE EXCEPTION 'Account 6700 not found'; END IF;

  -- Process each line item
  FOR v_item IN
    SELECT * FROM public.inventory_adjustment_items
    WHERE adjustment_id = p_adjustment_id AND difference <> 0
  LOOP
    -- Current MAC for this product
    SELECT COALESCE(running_avg_cost, 0) INTO v_mac
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_item.product_id
    ORDER BY seq DESC LIMIT 1;
    v_mac := COALESCE(v_mac, 0);

    -- Use provided unit_cost if available (user override), else MAC
    v_item_cost := COALESCE(NULLIF(v_item.unit_cost, 0), v_mac);

    -- Running qty at this warehouse
    SELECT COALESCE(running_qty, 0) INTO v_running_qty
    FROM public.stock_ledger
    WHERE company_id = v_company_id
      AND product_id = v_item.product_id
      AND warehouse_id = v_adj.warehouse_id
    ORDER BY seq DESC LIMIT 1;
    v_running_qty := COALESCE(v_running_qty, 0);

    IF v_item.difference > 0 THEN
      -- C2: Found stock
      INSERT INTO public.stock_ledger
        (company_id, product_id, warehouse_id, date,
         type, direction, quantity, unit_cost, total_cost,
         running_qty, running_avg_cost,
         related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_item.product_id, v_adj.warehouse_id, v_adj.date,
         'adjustment_in', 1, v_item.difference, v_item_cost, v_item_cost * v_item.difference,
         v_running_qty + v_item.difference, v_mac,
         'inventory_adjustment', p_adjustment_id);
      v_total_gain := v_total_gain + ROUND(v_item_cost * v_item.difference, 2);

    ELSE
      -- C3: Shrinkage / damage
      INSERT INTO public.stock_ledger
        (company_id, product_id, warehouse_id, date,
         type, direction, quantity, unit_cost, total_cost,
         running_qty, running_avg_cost,
         related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_item.product_id, v_adj.warehouse_id, v_adj.date,
         'adjustment_out', -1, ABS(v_item.difference), v_item_cost, v_item_cost * ABS(v_item.difference),
         v_running_qty + v_item.difference, v_mac,
         'inventory_adjustment', p_adjustment_id);
      v_total_loss := v_total_loss + ROUND(v_item_cost * ABS(v_item.difference), 2);
    END IF;
  END LOOP;

  -- Post GL for gains (C2): DR 1300, CR 4300
  IF v_total_gain > 0 THEN
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE
      SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
    RETURNING current_value INTO v_seq;
    v_gain_entry := 'JE-' || v_seq::TEXT;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description,
      source_type, source_id, currency, exchange_rate,
      total_debit, total_credit, created_by
    ) VALUES (
      v_company_id, v_gain_entry, v_adj.date,
      'Inventory Gain — ' || v_adj.adjustment_number,
      'inventory_adjustment', p_adjustment_id,
      v_currency, 1.0, v_total_gain, v_total_gain, v_user_id
    ) RETURNING id INTO v_gain_je_id;

    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_gain_je_id, v_acct_1300, '1300', v_adj.date, v_total_gain, 0,
       'Inventory Gain — ' || v_adj.adjustment_number, 'inventory_adjustment', p_adjustment_id),
      (v_company_id, v_gain_je_id, v_acct_4300, '4300', v_adj.date, 0, v_total_gain,
       'Inventory Gain — ' || v_adj.adjustment_number, 'inventory_adjustment', p_adjustment_id);
  END IF;

  -- Post GL for losses (C3): DR 6700, CR 1300
  IF v_total_loss > 0 THEN
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE
      SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
    RETURNING current_value INTO v_seq;
    v_loss_entry := 'JE-' || v_seq::TEXT;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description,
      source_type, source_id, currency, exchange_rate,
      total_debit, total_credit, created_by
    ) VALUES (
      v_company_id, v_loss_entry, v_adj.date,
      'Inventory Loss — ' || v_adj.adjustment_number,
      'inventory_adjustment', p_adjustment_id,
      v_currency, 1.0, v_total_loss, v_total_loss, v_user_id
    ) RETURNING id INTO v_loss_je_id;

    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_loss_je_id, v_acct_6700, '6700', v_adj.date, v_total_loss, 0,
       'Inventory Loss — ' || v_adj.adjustment_number, 'inventory_adjustment', p_adjustment_id),
      (v_company_id, v_loss_je_id, v_acct_1300, '1300', v_adj.date, 0, v_total_loss,
       'Inventory Loss — ' || v_adj.adjustment_number, 'inventory_adjustment', p_adjustment_id);
  END IF;

  UPDATE public.inventory_adjustments
  SET status = 'confirmed', updated_at = NOW()
  WHERE id = p_adjustment_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'inventory_adjustment', p_adjustment_id,
      jsonb_build_object(
        'adjustment_number', v_adj.adjustment_number,
        'total_gain', v_total_gain,
        'total_loss', v_total_loss
      ));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'adjustment_id',     p_adjustment_id,
    'adjustment_number', v_adj.adjustment_number,
    'gain_je_id',        v_gain_je_id,
    'loss_je_id',        v_loss_je_id,
    'total_gain',        v_total_gain,
    'total_loss',        v_total_loss
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.void_invoice(p_invoice_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_inv        public.invoices%ROWTYPE;
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
    RAISE EXCEPTION 'void_invoice: no company for user';
  END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'void_invoice: invoice % not found', p_invoice_id;
  END IF;
  IF v_inv.status <> 'confirmed' THEN
    RAISE EXCEPTION 'void_invoice: invoice % not confirmed (status=%)', p_invoice_id, v_inv.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND CURRENT_DATE <= v_lock_date THEN
    RAISE EXCEPTION 'void_invoice: today % on or before period lock %', CURRENT_DATE, v_lock_date;
  END IF;

  -- Reverse all unreversed JEs linked to this invoice
  -- Covers: sales_invoice, inventory_cogs, advance_application
  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id
      AND source_id = p_invoice_id
      AND reversed_by_id IS NULL
      AND source_type IN ('sales_invoice','inventory_cogs','advance_application')
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
      COALESCE(p_reason, 'Void – ' || v_inv.invoice_number),
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
        COALESCE(p_reason, 'Void – ' || v_inv.invoice_number),
        v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
      );
    END LOOP;

    UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
  END LOOP;

  -- Reverse stock_ledger rows
  FOR v_sl IN
    SELECT * FROM public.stock_ledger
    WHERE company_id = v_company_id
      AND related_doc_id = p_invoice_id
      AND related_doc_type = 'invoice'
      AND reversal_of_id IS NULL
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
      v_company_id, v_sl.product_id, v_sl.warehouse_id, CURRENT_DATE,
      'void', -v_sl.direction, v_sl.quantity, v_sl.unit_cost, v_sl.total_cost,
      v_prev_running + v_sl.quantity * (-v_sl.direction),
      v_sl.running_avg_cost,
      'invoice', p_invoice_id, v_sl.id
    );
  END LOOP;

  -- Cancel pending deferred COGS
  UPDATE public.deferred_cogs_queue
  SET status = 'cancelled', updated_at = NOW()
  WHERE sale_invoice_id = p_invoice_id AND status = 'pending';

  -- Void invoice
  UPDATE public.invoices
  SET status = 'void', void_reason = p_reason,
      voided_at = NOW(), voided_by = v_user_id, updated_at = NOW()
  WHERE id = p_invoice_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'void', 'invoice', p_invoice_id,
      jsonb_build_object('invoice_number', v_inv.invoice_number, 'reason', p_reason));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'invoice_number', v_inv.invoice_number);
END;
$function$;


CREATE OR REPLACE FUNCTION public.void_credit_note(p_credit_note_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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
    ORDER BY seq DESC LIMIT 1;

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
$function$;


CREATE OR REPLACE FUNCTION public.void_debit_note(p_debit_note_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_dn         public.debit_notes%ROWTYPE;
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
    RAISE EXCEPTION 'void_debit_note: no company for user';
  END IF;

  SELECT * INTO v_dn FROM public.debit_notes WHERE id = p_debit_note_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'void_debit_note: debit note % not found', p_debit_note_id;
  END IF;
  IF v_dn.status <> 'confirmed' THEN
    RAISE EXCEPTION 'void_debit_note: not confirmed (status=%)', v_dn.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND CURRENT_DATE <= v_lock_date THEN
    RAISE EXCEPTION 'void_debit_note: today % on or before period lock %', CURRENT_DATE, v_lock_date;
  END IF;

  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id
      AND source_id = p_debit_note_id
      AND reversed_by_id IS NULL
      AND source_type = 'vendor_debit_note'
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
      COALESCE(p_reason, 'Void – ' || v_dn.debit_note_number),
      v_je.source_type, p_debit_note_id,
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
        COALESCE(p_reason, 'Void – ' || v_dn.debit_note_number),
        v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
      );
    END LOOP;

    UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
  END LOOP;

  -- Reverse stock_ledger rows
  FOR v_sl IN
    SELECT * FROM public.stock_ledger
    WHERE company_id = v_company_id
      AND related_doc_id = p_debit_note_id
      AND related_doc_type = 'debit_note'
      AND reversal_of_id IS NULL
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
      v_company_id, v_sl.product_id, v_sl.warehouse_id, CURRENT_DATE,
      'void', -v_sl.direction, v_sl.quantity, v_sl.unit_cost, v_sl.total_cost,
      v_prev_running + v_sl.quantity * (-v_sl.direction),
      v_sl.running_avg_cost,
      'debit_note', p_debit_note_id, v_sl.id
    );
  END LOOP;

  UPDATE public.debit_notes
  SET status = 'void', updated_at = NOW()
  WHERE id = p_debit_note_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'void', 'debit_note', p_debit_note_id,
      jsonb_build_object('debit_note_number', v_dn.debit_note_number, 'reason', p_reason));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('debit_note_id', p_debit_note_id, 'debit_note_number', v_dn.debit_note_number);
END;
$function$;


CREATE OR REPLACE FUNCTION public.reopen_credit_note(p_credit_note_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'reopen_credit_note: no company for user'; END IF;

  SELECT * INTO v_cn FROM public.credit_notes WHERE id = p_credit_note_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'reopen_credit_note: credit note % not found', p_credit_note_id; END IF;
  IF v_cn.status <> 'confirmed' THEN RAISE EXCEPTION 'reopen_credit_note: not confirmed (status=%)', v_cn.status; END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND CURRENT_DATE <= v_lock_date THEN
    RAISE EXCEPTION 'reopen_credit_note: today % on or before period lock %', CURRENT_DATE, v_lock_date;
  END IF;

  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id AND source_id = p_credit_note_id AND reversed_by_id IS NULL
      AND source_type IN ('sales_credit_note', 'inventory_cogs')
  LOOP
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
    RETURNING current_value INTO v_seq;
    v_rev_entry := 'JE-' || v_seq::TEXT;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description, source_type, source_id,
      currency, exchange_rate, total_debit, total_credit, reversal_of_id, created_by
    ) VALUES (
      v_company_id, v_rev_entry, CURRENT_DATE, 'Reopen – ' || v_cn.credit_note_number,
      v_je.source_type, p_credit_note_id, v_je.currency, v_je.exchange_rate,
      v_je.total_credit, v_je.total_debit, v_je.id, v_user_id
    ) RETURNING id INTO v_rev_id;

    FOR v_gl IN SELECT * FROM public.general_ledger WHERE journal_entry_id = v_je.id LOOP
      INSERT INTO public.general_ledger (
        company_id, journal_entry_id, account_id, account_code, date, debit, credit,
        description, contact_id, related_doc_type, related_doc_id, reversal_of_id
      ) VALUES (
        v_company_id, v_rev_id, v_gl.account_id, v_gl.account_code, CURRENT_DATE, v_gl.credit, v_gl.debit,
        'Reopen – ' || v_cn.credit_note_number, v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
      );
    END LOOP;

    UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
  END LOOP;

  FOR v_sl IN
    SELECT * FROM public.stock_ledger
    WHERE company_id = v_company_id AND related_doc_id = p_credit_note_id
      AND related_doc_type = 'credit_note' AND reversal_of_id IS NULL
  LOOP
    SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_running
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_sl.product_id AND warehouse_id = v_sl.warehouse_id
    ORDER BY seq DESC LIMIT 1;

    INSERT INTO public.stock_ledger (
      company_id, product_id, warehouse_id, date, type, direction, quantity, unit_cost, total_cost,
      running_qty, running_avg_cost, related_doc_type, related_doc_id, reversal_of_id
    ) VALUES (
      v_company_id, v_sl.product_id, v_sl.warehouse_id, CURRENT_DATE,
      'void', -v_sl.direction, v_sl.quantity, v_sl.unit_cost, v_sl.total_cost,
      v_prev_running + v_sl.quantity * (-v_sl.direction), v_sl.running_avg_cost,
      'credit_note', p_credit_note_id, v_sl.id
    );
  END LOOP;

  UPDATE public.credit_notes SET status = 'draft', updated_at = NOW() WHERE id = p_credit_note_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'reopen', 'credit_note', p_credit_note_id,
      jsonb_build_object('credit_note_number', v_cn.credit_note_number));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('credit_note_id', p_credit_note_id, 'status', 'draft');
END;
$function$;


CREATE OR REPLACE FUNCTION public.reopen_debit_note(p_debit_note_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_dn         public.debit_notes%ROWTYPE;
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
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'reopen_debit_note: no company for user'; END IF;

  SELECT * INTO v_dn FROM public.debit_notes WHERE id = p_debit_note_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'reopen_debit_note: debit note % not found', p_debit_note_id; END IF;
  IF v_dn.status <> 'confirmed' THEN RAISE EXCEPTION 'reopen_debit_note: not confirmed (status=%)', v_dn.status; END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND CURRENT_DATE <= v_lock_date THEN
    RAISE EXCEPTION 'reopen_debit_note: today % on or before period lock %', CURRENT_DATE, v_lock_date;
  END IF;

  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id AND source_id = p_debit_note_id AND reversed_by_id IS NULL
      AND source_type = 'vendor_debit_note'
  LOOP
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
    RETURNING current_value INTO v_seq;
    v_rev_entry := 'JE-' || v_seq::TEXT;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description, source_type, source_id,
      currency, exchange_rate, total_debit, total_credit, reversal_of_id, created_by
    ) VALUES (
      v_company_id, v_rev_entry, CURRENT_DATE, 'Reopen – ' || v_dn.debit_note_number,
      v_je.source_type, p_debit_note_id, v_je.currency, v_je.exchange_rate,
      v_je.total_credit, v_je.total_debit, v_je.id, v_user_id
    ) RETURNING id INTO v_rev_id;

    FOR v_gl IN SELECT * FROM public.general_ledger WHERE journal_entry_id = v_je.id LOOP
      INSERT INTO public.general_ledger (
        company_id, journal_entry_id, account_id, account_code, date, debit, credit,
        description, contact_id, related_doc_type, related_doc_id, reversal_of_id
      ) VALUES (
        v_company_id, v_rev_id, v_gl.account_id, v_gl.account_code, CURRENT_DATE, v_gl.credit, v_gl.debit,
        'Reopen – ' || v_dn.debit_note_number, v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
      );
    END LOOP;

    UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
  END LOOP;

  FOR v_sl IN
    SELECT * FROM public.stock_ledger
    WHERE company_id = v_company_id AND related_doc_id = p_debit_note_id
      AND related_doc_type = 'debit_note' AND reversal_of_id IS NULL
  LOOP
    SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_running
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_sl.product_id AND warehouse_id = v_sl.warehouse_id
    ORDER BY seq DESC LIMIT 1;

    INSERT INTO public.stock_ledger (
      company_id, product_id, warehouse_id, date, type, direction, quantity, unit_cost, total_cost,
      running_qty, running_avg_cost, related_doc_type, related_doc_id, reversal_of_id
    ) VALUES (
      v_company_id, v_sl.product_id, v_sl.warehouse_id, CURRENT_DATE,
      'void', -v_sl.direction, v_sl.quantity, v_sl.unit_cost, v_sl.total_cost,
      v_prev_running + v_sl.quantity * (-v_sl.direction), v_sl.running_avg_cost,
      'debit_note', p_debit_note_id, v_sl.id
    );
  END LOOP;

  UPDATE public.debit_notes SET status = 'draft', updated_at = NOW() WHERE id = p_debit_note_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'reopen', 'debit_note', p_debit_note_id,
      jsonb_build_object('debit_note_number', v_dn.debit_note_number));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('debit_note_id', p_debit_note_id, 'status', 'draft');
END;
$function$;


CREATE OR REPLACE FUNCTION public.repair_vendor_bill_je(p_je_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_je              public.journal_entries%ROWTYPE;
  v_bill            public.vendor_bills%ROWTYPE;
  v_item            public.vendor_bill_items%ROWTYPE;
  v_company_id      UUID;
  v_line_acct_id    UUID;
  v_line_code       TEXT;
  v_line_class      TEXT;
  v_inv_id          UUID;
  v_body_debit      NUMERIC(15,2) := 0;
  v_body_credit     NUMERIC(15,2) := 0;
  v_wh_id           UUID;
  v_old_mac         NUMERIC(15,2);
  v_old_total_qty   NUMERIC(15,3);
  v_qty_for_mac     NUMERIC(15,3);
  v_new_mac         NUMERIC(15,2);
  v_prev_wh_qty     NUMERIC(15,3);
  v_rows_added      INT := 0;
BEGIN
  -- Load the JE
  SELECT * INTO v_je FROM public.journal_entries WHERE id = p_je_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'repair_vendor_bill_je: JE % not found', p_je_id;
  END IF;
  IF v_je.source_type <> 'vendor_bill' THEN
    RAISE EXCEPTION 'repair_vendor_bill_je: JE % is not from a vendor_bill (source_type=%)', p_je_id, v_je.source_type;
  END IF;

  v_company_id := v_je.company_id;

  -- Load the bill
  SELECT * INTO v_bill FROM public.vendor_bills WHERE id = v_je.source_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'repair_vendor_bill_je: source bill % not found', v_je.source_id;
  END IF;

  -- Already balanced?
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO v_body_debit, v_body_credit
  FROM public.general_ledger
  WHERE journal_entry_id = p_je_id;

  IF ABS(v_body_debit - v_body_credit) < 0.01 THEN
    RETURN jsonb_build_object(
      'status',          'already_balanced',
      'rows_added',      0,
      'new_body_debit',  v_body_debit,
      'new_body_credit', v_body_credit
    );
  END IF;

  -- Default warehouse
  SELECT id INTO v_wh_id FROM public.warehouses
  WHERE company_id = v_company_id AND is_default = TRUE AND is_active = TRUE
  LIMIT 1;
  IF v_wh_id IS NULL THEN
    SELECT id INTO v_wh_id FROM public.warehouses
    WHERE company_id = v_company_id AND is_active = TRUE
    ORDER BY created_at LIMIT 1;
  END IF;

  -- Default 1300 Inventory id (fallback)
  SELECT id INTO v_inv_id FROM public.chart_of_accounts
  WHERE company_id = v_company_id AND code = '1300' AND is_active;

  -- Iterate bill items
  FOR v_item IN SELECT * FROM public.vendor_bill_items WHERE bill_id = v_bill.id LOOP
    IF v_item.line_subtotal <= 0 THEN CONTINUE; END IF;
    IF v_item.product_id IS NULL THEN CONTINUE; END IF;

    -- Resolve the account: product's purchase_account_id, falling back to 1300
    SELECT purchase_account_id INTO v_line_acct_id
    FROM public.products WHERE id = v_item.product_id;
    IF v_line_acct_id IS NULL THEN
      v_line_acct_id := v_inv_id;
    END IF;

    SELECT type, code INTO v_line_class, v_line_code
    FROM public.chart_of_accounts WHERE id = v_line_acct_id;

    -- Skip lines that already have a DR row for this account on this JE
    IF EXISTS (
      SELECT 1 FROM public.general_ledger
      WHERE journal_entry_id = p_je_id
        AND account_id = v_line_acct_id
        AND debit > 0
    ) THEN
      CONTINUE;
    END IF;

    -- Insert the missing DR row
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, p_je_id, v_line_acct_id, v_line_code, v_bill.date,
       v_item.line_subtotal, 0,
       COALESCE(v_item.description, 'Vendor Bill ' || v_bill.bill_number) || ' (repair)',
       v_bill.supplier_id, 'vendor_bill', v_bill.id);

    v_rows_added := v_rows_added + 1;

    -- If asset class, also post the missing stock_ledger row + update MAC.
    -- Skips if a stock_ledger row already exists for this bill+product (idempotent).
    IF v_line_class = 'asset' AND v_item.quantity > 0 AND v_item.unit_cost > 0
       AND NOT EXISTS (
         SELECT 1 FROM public.stock_ledger
         WHERE related_doc_type = 'vendor_bill'
           AND related_doc_id = v_bill.id
           AND product_id = v_item.product_id
       )
    THEN
      SELECT COALESCE(running_avg_cost, 0) INTO v_old_mac
      FROM public.stock_ledger
      WHERE company_id = v_company_id AND product_id = v_item.product_id
      ORDER BY seq DESC LIMIT 1;
      v_old_mac := COALESCE(v_old_mac, 0);

      SELECT COALESCE(SUM(latest_qty), 0) INTO v_old_total_qty
      FROM (
        SELECT DISTINCT ON (warehouse_id) running_qty AS latest_qty
        FROM public.stock_ledger
        WHERE company_id = v_company_id AND product_id = v_item.product_id
        ORDER BY warehouse_id, seq DESC
      ) sub;
      v_old_total_qty := COALESCE(v_old_total_qty, 0);

      v_qty_for_mac := GREATEST(v_old_total_qty, 0);

      IF v_qty_for_mac + v_item.quantity > 0 THEN
        v_new_mac := ROUND(
          (v_old_mac * v_qty_for_mac + v_item.unit_cost * v_item.quantity) /
          (v_qty_for_mac + v_item.quantity),
          2
        );
      ELSE
        v_new_mac := v_item.unit_cost;
      END IF;

      SELECT COALESCE(running_qty, 0) INTO v_prev_wh_qty
      FROM public.stock_ledger
      WHERE company_id = v_company_id AND product_id = v_item.product_id
        AND warehouse_id = v_wh_id
      ORDER BY seq DESC LIMIT 1;
      v_prev_wh_qty := COALESCE(v_prev_wh_qty, 0);

      INSERT INTO public.stock_ledger
        (company_id, product_id, warehouse_id, date,
         type, direction, quantity, unit_cost, total_cost,
         running_qty, running_avg_cost,
         related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_item.product_id, v_wh_id, v_bill.date,
         'purchase', 1, v_item.quantity, v_item.unit_cost,
         v_item.quantity * v_item.unit_cost,
         v_prev_wh_qty + v_item.quantity, v_new_mac,
         'vendor_bill', v_bill.id);
    END IF;
  END LOOP;

  -- Re-check
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO v_body_debit, v_body_credit
  FROM public.general_ledger
  WHERE journal_entry_id = p_je_id;

  -- Audit trail
  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, auth.uid(), 'repair', 'journal_entry', p_je_id,
      jsonb_build_object(
        'bill_number',  v_bill.bill_number,
        'rows_added',   v_rows_added,
        'body_debit',   v_body_debit,
        'body_credit',  v_body_credit
      ));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'status',          CASE WHEN ABS(v_body_debit - v_body_credit) < 0.01 THEN 'repaired' ELSE 'partial' END,
    'rows_added',      v_rows_added,
    'new_body_debit',  v_body_debit,
    'new_body_credit', v_body_credit
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.find_stock_mismatches(p_company_id uuid, p_as_of_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(product_id uuid, product_name text, sku text, stock_value numeric, stock_txn_sum numeric, difference numeric)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tol NUMERIC := 0.01;
BEGIN
  RETURN QUERY
  WITH
    latest AS (
      SELECT DISTINCT ON (sl.product_id, sl.warehouse_id)
        sl.product_id, sl.running_qty, sl.running_avg_cost
      FROM stock_ledger sl
      WHERE sl.company_id = p_company_id
        AND sl.date <= p_as_of_date
      ORDER BY sl.product_id, sl.warehouse_id, sl.seq DESC
    ),
    stock_val_per_product AS (
      -- qualify with the CTE alias so it is unambiguous vs the OUT column
      SELECT latest.product_id AS pid, SUM(latest.running_qty * latest.running_avg_cost) AS val
      FROM latest
      GROUP BY latest.product_id
    ),
    txn_sum_per_product AS (
      SELECT sl.product_id AS pid,
             SUM(sl.quantity * sl.direction * sl.unit_cost) AS txn_sum
      FROM stock_ledger sl
      WHERE sl.company_id = p_company_id
        AND sl.date <= p_as_of_date
      GROUP BY sl.product_id
    ),
    combined AS (
      SELECT COALESCE(v.pid, t.pid) AS pid,
             COALESCE(v.val, 0)     AS stock_value,
             COALESCE(t.txn_sum, 0) AS stock_txn_sum
      FROM stock_val_per_product v
      FULL OUTER JOIN txn_sum_per_product t ON t.pid = v.pid
    )
  SELECT
    cb.pid,
    COALESCE(p.name, '—'),
    COALESCE(p.sku, '—'),
    cb.stock_value,
    cb.stock_txn_sum,
    cb.stock_value - cb.stock_txn_sum
  FROM combined cb
  LEFT JOIN products p ON p.id = cb.pid
  WHERE ABS(cb.stock_value - cb.stock_txn_sum) > v_tol
  ORDER BY ABS(cb.stock_value - cb.stock_txn_sum) DESC;
END;
$function$;


CREATE OR REPLACE FUNCTION public.verify_invariants(p_company_id uuid, p_as_of_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tol         NUMERIC := 0.01;
  v_stock_tol   NUMERIC := 0.01;
  v_tb_debit    NUMERIC := 0;
  v_tb_credit   NUMERIC := 0;
  v_assets      NUMERIC := 0;
  v_liab        NUMERIC := 0;
  v_equity      NUMERIC := 0;
  v_income      NUMERIC := 0;
  v_expense     NUMERIC := 0;
  v_bs_rhs      NUMERIC := 0;
  v_ar_aging    NUMERIC := 0;
  v_ar_tb       NUMERIC := 0;
  v_ap_aging    NUMERIC := 0;
  v_ap_tb       NUMERIC := 0;
  v_stock_val   NUMERIC := 0;
  v_inv_tb      NUMERIC := 0;
  v_cust_adv_ok BOOLEAN := TRUE;
  v_vend_adv_ok BOOLEAN := TRUE;
  v_grn_accrual NUMERIC := 0;
  v_grn_tb      NUMERIC := 0;
  v_cash_tb     NUMERIC := 0;
  v_bad_je_cnt  INTEGER := 0;
BEGIN
  -- 1. Trial Balance
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO v_tb_debit, v_tb_credit
  FROM general_ledger
  WHERE company_id = p_company_id AND date <= p_as_of_date;

  -- 2. Balance Sheet
  SELECT
    COALESCE(SUM(CASE WHEN coa.type = 'asset'     THEN gl.debit - gl.credit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN coa.type = 'liability' THEN gl.credit - gl.debit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN coa.type = 'equity'    THEN gl.credit - gl.debit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN coa.type = 'income'    THEN gl.credit - gl.debit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN coa.type = 'expense'   THEN gl.debit - gl.credit ELSE 0 END), 0)
  INTO v_assets, v_liab, v_equity, v_income, v_expense
  FROM general_ledger gl
  JOIN chart_of_accounts coa ON coa.id = gl.account_id
  WHERE gl.company_id = p_company_id AND gl.date <= p_as_of_date;
  v_bs_rhs := v_liab + v_equity + v_income - v_expense;

  -- 3. AR Aging = AR (1200)   — UPDATED: subtract ALL confirmed CNs per customer
  SELECT COALESCE(SUM(
    i.total_amount
    - COALESCE((SELECT SUM(pa.amount_applied) FROM payment_allocations pa
                 WHERE pa.doc_id = i.id AND pa.doc_type = 'invoice'), 0)
  ), 0)
  INTO v_ar_aging
  FROM invoices i
  WHERE i.company_id = p_company_id
    AND i.status = 'confirmed'
    AND i.date <= p_as_of_date;

  v_ar_aging := v_ar_aging - COALESCE((
    SELECT SUM(cn.total_amount)
    FROM credit_notes cn
    WHERE cn.company_id = p_company_id
      AND cn.status = 'confirmed'
      AND cn.date <= p_as_of_date
  ), 0);

  SELECT COALESCE(SUM(debit - credit), 0)
  INTO v_ar_tb
  FROM general_ledger
  WHERE company_id = p_company_id AND account_code = '1200' AND date <= p_as_of_date;

  -- 4. AP Aging
  SELECT COALESCE(SUM(
    b.total_amount
    - COALESCE((SELECT SUM(pa.amount_applied) FROM payment_allocations pa
                 WHERE pa.doc_id = b.id AND pa.doc_type = 'vendor_bill'), 0)
  ), 0)
  INTO v_ap_aging
  FROM vendor_bills b
  WHERE b.company_id = p_company_id AND b.status = 'confirmed' AND b.date <= p_as_of_date;

  v_ap_aging := v_ap_aging - COALESCE((
    SELECT SUM(dn.total_amount)
    FROM debit_notes dn
    WHERE dn.company_id = p_company_id
      AND dn.status = 'confirmed'
      AND dn.date <= p_as_of_date
  ), 0);

  SELECT COALESCE(SUM(credit - debit), 0)
  INTO v_ap_tb
  FROM general_ledger
  WHERE company_id = p_company_id AND account_code = '2100' AND date <= p_as_of_date;

  -- 5. Stock Valuation
  SELECT COALESCE(SUM(running_qty * running_avg_cost), 0)
  INTO v_stock_val
  FROM (
    SELECT DISTINCT ON (product_id, warehouse_id) running_qty, running_avg_cost
    FROM stock_ledger
    WHERE company_id = p_company_id AND date <= p_as_of_date
    ORDER BY product_id, warehouse_id, seq DESC
  ) latest;

  SELECT COALESCE(SUM(debit - credit), 0)
  INTO v_inv_tb
  FROM general_ledger
  WHERE company_id = p_company_id AND account_code = '1300' AND date <= p_as_of_date;

  -- E1 tolerance: 0.01% of inventory value, min 1.00 — absorbs 2-dp running_avg_cost
  -- rounding across large quantities while still catching material drift.
  v_stock_tol := GREATEST(1.00, 0.0001 * ABS(v_inv_tb));

  -- 6. Customer Advances
  SELECT (COALESCE(SUM(credit - debit), 0) >= -v_tol)
  INTO v_cust_adv_ok
  FROM general_ledger
  WHERE company_id = p_company_id AND account_code = '2400' AND date <= p_as_of_date;

  -- 7. Vendor Advances
  SELECT (COALESCE(SUM(debit - credit), 0) >= -v_tol)
  INTO v_vend_adv_ok
  FROM general_ledger
  WHERE company_id = p_company_id AND account_code = '1400' AND date <= p_as_of_date;

  -- 8. GRN Accrual
  SELECT COALESCE(SUM(
    (SELECT COALESCE(SUM(gri.total_cost), 0)
       FROM goods_receipt_items gri
       WHERE gri.grn_id = gr.id)
  ), 0)
  INTO v_grn_accrual
  FROM goods_receipts gr
  WHERE gr.company_id = p_company_id
    AND gr.status IN ('received', 'billed', 'confirmed')
    AND gr.date <= p_as_of_date
    AND NOT EXISTS (
      SELECT 1 FROM vendor_bills vb
      WHERE vb.linked_grn_id = gr.id AND vb.status = 'confirmed'
    );

  SELECT COALESCE(SUM(credit - debit), 0)
  INTO v_grn_tb
  FROM general_ledger
  WHERE company_id = p_company_id AND account_code = '2150' AND date <= p_as_of_date;

  -- 9. Cash
  SELECT COALESCE(SUM(debit - credit), 0)
  INTO v_cash_tb
  FROM general_ledger
  WHERE company_id = p_company_id AND account_code LIKE '11%' AND date <= p_as_of_date;

  -- 10. JE_BAL
  SELECT COUNT(*) INTO v_bad_je_cnt
  FROM journal_entries je
  WHERE je.company_id = p_company_id AND je.date <= p_as_of_date
    AND EXISTS (
      SELECT 1 FROM general_ledger gl
      WHERE gl.journal_entry_id = je.id
      GROUP BY gl.journal_entry_id
      HAVING ABS(COALESCE(SUM(gl.debit),  0) - je.total_debit)  > v_tol
          OR ABS(COALESCE(SUM(gl.credit), 0) - je.total_credit) > v_tol
          OR ABS(COALESCE(SUM(gl.debit),  0) - COALESCE(SUM(gl.credit), 0)) > v_tol
    );

  RETURN jsonb_build_array(
    jsonb_build_object('name','Trial Balance balances','invariant','A1',
      'pass', ABS(v_tb_debit - v_tb_credit) <= v_tol,
      'debit', v_tb_debit, 'credit', v_tb_credit, 'difference', ABS(v_tb_debit - v_tb_credit)),
    jsonb_build_object('name','Balance Sheet balances (Assets = L + E + Income − Expense)','invariant','A4',
      'pass', ABS(v_assets - v_bs_rhs) <= v_tol,
      'assets', v_assets, 'rhs', v_bs_rhs, 'difference', ABS(v_assets - v_bs_rhs)),
    jsonb_build_object('name','AR Aging = AR Account (1200)','invariant','B1',
      'pass', ABS(v_ar_aging - v_ar_tb) <= v_tol,
      'ar_aging', v_ar_aging, 'ar_tb', v_ar_tb, 'difference', ABS(v_ar_aging - v_ar_tb)),
    jsonb_build_object('name','AP Aging = AP Account (2100)','invariant','B2',
      'pass', ABS(v_ap_aging - v_ap_tb) <= v_tol,
      'ap_aging', v_ap_aging, 'ap_tb', v_ap_tb, 'difference', ABS(v_ap_aging - v_ap_tb)),
    jsonb_build_object('name','Stock Valuation = Inventory Account (1300)','invariant','E1',
      'pass', ABS(v_stock_val - v_inv_tb) <= v_stock_tol,
      'stock_val', v_stock_val, 'inv_tb', v_inv_tb, 'difference', ABS(v_stock_val - v_inv_tb),
      'tolerance', v_stock_tol),
    jsonb_build_object('name','Customer Advances (2400) never debit','invariant','ADV_CUST',
      'pass', COALESCE(v_cust_adv_ok, TRUE)),
    jsonb_build_object('name','Vendor Advances (1400) never credit','invariant','ADV_VEND',
      'pass', COALESCE(v_vend_adv_ok, TRUE)),
    jsonb_build_object('name','GRN Accrual = Unbilled GRNs (2150)','invariant','D4',
      'pass', ABS(v_grn_accrual - v_grn_tb) <= v_tol,
      'grn_accrual', v_grn_accrual, 'grn_tb', v_grn_tb, 'difference', ABS(v_grn_accrual - v_grn_tb)),
    jsonb_build_object('name','Cash balance ≥ 0 (informational)','invariant','G2',
      'pass', v_cash_tb >= -v_tol, 'cash_tb', v_cash_tb),
    jsonb_build_object('name','All journal entries internally balanced','invariant','JE_BAL',
      'pass', v_bad_je_cnt = 0, 'bad_je_count', v_bad_je_cnt, 'difference', v_bad_je_cnt)
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.recompute_stock_valuation(p_company_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_rows INTEGER;
BEGIN
  WITH cum AS (
    SELECT id,
      SUM(direction * quantity)   OVER w AS cq,
      SUM(direction * total_cost) OVER w AS cc
    FROM public.stock_ledger
    WHERE p_company_id IS NULL OR company_id = p_company_id
    WINDOW w AS (
      PARTITION BY company_id, product_id, warehouse_id
      ORDER BY seq          -- matches how E1 picks the latest row (created_at DESC)
      ROWS UNBOUNDED PRECEDING
    )
  )
  UPDATE public.stock_ledger sl
     SET running_qty      = cum.cq,
         running_avg_cost = CASE WHEN cum.cq <> 0 THEN ROUND(cum.cc / cum.cq, 2) ELSE 0 END
    FROM cum
   WHERE sl.id = cum.id
     AND ( sl.running_qty IS DISTINCT FROM cum.cq
        OR sl.running_avg_cost IS DISTINCT FROM CASE WHEN cum.cq <> 0 THEN ROUND(cum.cc / cum.cq, 2) ELSE 0 END );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$function$;


CREATE OR REPLACE FUNCTION public.tg_recompute_stock_valuation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  WITH affected AS (
    SELECT DISTINCT company_id, product_id, warehouse_id FROM new_rows
  ),
  cum AS (
    SELECT sl.id,
      SUM(sl.direction * sl.quantity)   OVER w AS cq,
      SUM(sl.direction * sl.total_cost) OVER w AS cc
    FROM public.stock_ledger sl
    JOIN affected a
      ON a.company_id = sl.company_id AND a.product_id = sl.product_id AND a.warehouse_id = sl.warehouse_id
    WINDOW w AS (
      PARTITION BY sl.company_id, sl.product_id, sl.warehouse_id
      ORDER BY sl.seq          -- matches how E1 picks the latest row (created_at DESC)
      ROWS UNBOUNDED PRECEDING
    )
  )
  UPDATE public.stock_ledger sl
     SET running_qty      = cum.cq,
         running_avg_cost = CASE WHEN cum.cq <> 0 THEN ROUND(cum.cc / cum.cq, 2) ELSE 0 END
    FROM cum
   WHERE sl.id = cum.id
     AND ( sl.running_qty IS DISTINCT FROM cum.cq
        OR sl.running_avg_cost IS DISTINCT FROM CASE WHEN cum.cq <> 0 THEN ROUND(cum.cc / cum.cq, 2) ELSE 0 END );
  RETURN NULL;
END;
$function$;

-- 3. Rebuild all running chains with the deterministic order (phase29 tool,
--    now seq-ordered). Reversal pairs cancel, so live sums are unchanged —
--    only stale running_qty / running_avg_cost values get corrected.
SELECT public.recompute_stock_valuation(NULL);

NOTIFY pgrst, 'reload schema';
