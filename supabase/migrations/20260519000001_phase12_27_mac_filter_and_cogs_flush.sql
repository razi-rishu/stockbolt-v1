-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 12 — Migration 27:
-- MAC filter + deferred-COGS flush + edit_invoice re-queue
-- ─────────────────────────────────────────────────────────────────────────
-- Three compounding inventory-valuation bugs caught in production:
--
-- A) confirm_vendor_bill computes MAC using the latest running_qty per
--    warehouse from stock_ledger. When the table contains stale rows
--    from the old double-reversal bug (Phase 12.21 era), two rows can
--    share the same `created_at` second — and Postgres's tiebreaker is
--    non-deterministic. In one observed case it picked an edit_reversal
--    row (running_qty=33) instead of the real subsequent sale row
--    (running_qty=-17). The MAC formula then divided by the wrong base:
--      bad:  (0 × 33 + 3.00 × 100) / (33 + 100) = 2.26
--      good: (0 × 0  + 3.00 × 100) / (0  + 100) = 3.00
--    Result: a 100-unit purchase at 3.00/unit silently produced a MAC
--    of 2.26, leaving inventory undervalued from that purchase forward.
--
-- B) confirm_invoice queues a row in deferred_cogs_queue when a sale
--    happens before any purchase (MAC=0 path). The intent: post the
--    missing COGS once a future purchase establishes a cost. But no
--    function ever reads the queue back. Pending rows accumulate
--    forever; the COGS for those sales never lands in 5100.
--    Result: every sale-before-buy permanently understates COGS and
--    overstates inventory, until you reset.
--
-- C) edit_invoice's repost step never queues deferred COGS — only
--    confirm_invoice did. If a user edits an invoice while MAC is
--    still 0, the previous queue entries (deleted by invoices.update
--    before the edit RPC runs) are not re-created. Net: edits silently
--    lose pending COGS even when the system would have caught it on a
--    fresh confirm.
--
-- This migration fixes all three.
--
-- ── Fix A: filter stale rows when computing MAC ───────────────────────────
-- Apply the same "active rows only" filter used in Phase 12.21 for
-- journal_entries — a row contributes to "current state" only if:
--   reversal_of_id IS NULL                                (not a reversal entry itself)
--   AND NOT EXISTS (a row pointing back via reversal_of_id) (not yet reversed)
-- Within that filter, an extra tiebreaker (id DESC) makes the lookup
-- deterministic even when multiple rows share a timestamp.
--
-- ── Fix B: flush deferred_cogs_queue at the end of confirm_vendor_bill ───
-- After all stock_ledger inserts and the AP credit, iterate every
-- queue row for products whose MAC is now > 0 and post the deferred
-- COGS: Dr 5100 = qty × MAC, Cr 1300 = same. Mark each row
-- status='flushed', flushed_at, flushed_journal_entry_id, flush_unit_cost.
-- Single COGS JE per bill for all flushed items, source_type='inventory_cogs',
-- source_id=p_bill_id, description ties it back to the bill that triggered
-- the flush.
--
-- ── Fix C: re-queue deferred COGS in edit_invoice ────────────────────────
-- In edit_invoice's per-item loop, when MAC=0, write a row to
-- deferred_cogs_queue with sale_invoice_id=this invoice. Mirrors the
-- confirm_invoice behaviour exactly. The adapter's invoices.update
-- already deletes existing queue rows for this invoice before edit_invoice
-- runs, so this re-queue closes the loop.
--
-- This is a CREATE OR REPLACE FUNCTION on TWO functions: confirm_vendor_bill
-- and edit_invoice. Both are idempotent — no schema changes.
--
-- Note on legacy data: this migration does NOT retroactively fix
-- products whose MAC was already computed wrongly (the bad MAC is
-- stored in stock_ledger.running_avg_cost on rows that already exist).
-- The clean way to recover is to reset the company data and re-enter.
-- Going forward, both bugs are closed.
-- ─────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════
-- confirm_vendor_bill — Phase 12.27 (extends Phase 12.17)
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.confirm_vendor_bill(p_bill_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
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
  -- Phase 12.27 — deferred COGS flush state
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

  SELECT id INTO v_default_wh_id FROM public.warehouses
  WHERE company_id = v_company_id AND is_default = TRUE AND is_active = TRUE LIMIT 1;
  IF v_default_wh_id IS NULL THEN
    SELECT id INTO v_default_wh_id FROM public.warehouses
    WHERE company_id = v_company_id AND is_active = TRUE
    ORDER BY created_at LIMIT 1;
  END IF;

  IF v_bill.landed_cost_total > 0 THEN
    SELECT COALESCE(SUM(line_subtotal), 0), COUNT(*)
      INTO v_product_total, v_product_count
    FROM public.vendor_bill_items
    WHERE bill_id = p_bill_id
      AND product_id IS NOT NULL
      AND line_subtotal > 0;
    IF v_product_count = 0 THEN
      RAISE EXCEPTION
        'confirm_vendor_bill: landed_cost_total > 0 requires at least one product line'
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
    -- B3: GRN-linked bill — unchanged from Phase 12.17
    SELECT COALESCE(SUM(total_cost), 0) INTO v_grn_total
    FROM public.goods_receipt_items WHERE grn_id = v_bill.linked_grn_id;

    v_bill_goods := v_bill.subtotal - v_bill.discount_amount;
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
    -- B4: Standalone bill — Phase 12.27 fixes the MAC filter
    FOR v_item IN
      SELECT * FROM public.vendor_bill_items
      WHERE bill_id = p_bill_id
      ORDER BY id
    LOOP
      v_line_value := v_item.line_subtotal;
      IF v_line_value <= 0 THEN CONTINUE; END IF;

      v_landed_alloc := 0;
      IF v_bill.landed_cost_total > 0
         AND v_item.product_id IS NOT NULL
         AND v_product_total > 0
      THEN
        SELECT (NOT EXISTS (
          SELECT 1 FROM public.vendor_bill_items
          WHERE bill_id = p_bill_id
            AND product_id IS NOT NULL
            AND line_subtotal > 0
            AND id > v_item.id
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
        IF v_line_acct_id IS NULL THEN v_line_acct_id := v_inv_id; END IF;
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
         AND v_line_class = 'asset'
         AND v_item.quantity > 0
         AND v_line_value > 0
      THEN
        v_eff_unit := ROUND((v_line_value + v_landed_alloc) / v_item.quantity, 4);
        v_line_wh_id := COALESCE(v_item.warehouse_id, v_default_wh_id);
        IF v_line_wh_id IS NULL THEN
          RAISE EXCEPTION 'confirm_vendor_bill: no warehouse and no default';
        END IF;

        -- ── Phase 12.27 — MAC computation reads ACTIVE rows only ──────
        -- Old version of this block (Phase 12.17) was:
        --   SELECT COALESCE(running_avg_cost, 0) INTO v_old_mac
        --   FROM stock_ledger
        --   WHERE company_id = ... AND product_id = ...
        --   ORDER BY created_at DESC LIMIT 1;
        -- Issue: if a reversal entry shared the same created_at as the
        -- subsequent real entry, the ORDER BY tiebreaker was random.
        -- Adding the "active rows" filter eliminates reversal entries
        -- and reversed originals from the lookup so only the rows that
        -- actually contribute to current stock are considered.
        SELECT COALESCE(running_avg_cost, 0)::NUMERIC(15,2) INTO v_old_mac
        FROM public.stock_ledger sl
        WHERE sl.company_id = v_company_id
          AND sl.product_id = v_item.product_id
          AND sl.reversal_of_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id
          )
        ORDER BY sl.created_at DESC, sl.id DESC
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
          ORDER BY sl.warehouse_id, sl.created_at DESC, sl.id DESC
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
        ORDER BY sl.created_at DESC, sl.id DESC
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

  -- ── Phase 12.27 — Deferred COGS flush ─────────────────────────────────
  -- After all stock_ledger inserts (so MAC is up to date), iterate every
  -- pending deferred_cogs_queue row for products on THIS bill. For each,
  -- post Dr 5100 / Cr 1300 at the product's current MAC, then mark
  -- the queue row flushed. One JE per bill collects all flushed rows.
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
      -- Re-read MAC after the purchase landed. Active-row filter applies.
      SELECT COALESCE(running_avg_cost, 0)::NUMERIC(15,2) INTO v_flush_mac
      FROM public.stock_ledger sl
      WHERE sl.company_id = v_company_id
        AND sl.product_id = v_def.product_id
        AND sl.reversal_of_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id
        )
      ORDER BY sl.created_at DESC, sl.id DESC
      LIMIT 1;
      v_flush_mac := COALESCE(v_flush_mac, 0);

      -- Still no MAC? leave the row pending — next purchase will retry.
      IF v_flush_mac <= 0 THEN CONTINUE; END IF;

      -- Lazy-init the flush JE on the first row that needs it.
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
          0, 0,    -- patched up at the end of the loop
          v_user_id
        ) RETURNING id INTO v_flush_je_id;
      END IF;

      -- Dr 5100 COGS, Cr 1300 Inventory at qty × current MAC.
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

    -- Patch the JE header with the actual debit/credit totals.
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
        'phase',             '12.27'
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
$$;


-- ═════════════════════════════════════════════════════════════════════════
-- edit_invoice — Phase 12.27 adds the missing deferred-COGS queueing
-- (extends Phase 12.21 / 12.22)
-- ═════════════════════════════════════════════════════════════════════════
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

  -- Step 1: Reverse existing sales + cogs JEs (Phase 12.21).
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

  -- Step 2: Reverse stock_ledger rows (Phase 12.21).
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

  -- Step 3: Repost (Phase 12.22 gross method) + Phase 12.27 deferred-COGS re-queue.
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
       THEN v_inv.subtotal
       ELSE v_inv.subtotal - v_inv.discount_amount
     END,
     'Invoice (Edited) ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);

  IF v_inv.tax_amount > 0 AND v_vat_id IS NOT NULL THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_inv_je_id, v_vat_id, '2200', v_inv.date, 0, v_inv.tax_amount,
       'Output VAT (Edited) ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);
  END IF;

  -- Per-item: ALWAYS write stock_ledger (Phase 12.20); compute COGS or defer
  -- (Phase 12.27 — mirrors confirm_invoice's MAC=0 behaviour).
  FOR v_item IN SELECT * FROM public.invoice_items WHERE invoice_id = p_invoice_id LOOP
    CONTINUE WHEN v_item.product_id IS NULL;

    SELECT COALESCE(running_avg_cost, 0)::NUMERIC(15,2) INTO v_current_mac
    FROM public.stock_ledger sl
    WHERE sl.company_id = v_company_id
      AND sl.product_id = v_item.product_id
      AND sl.reversal_of_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id
      )
    ORDER BY sl.created_at DESC, sl.id DESC
    LIMIT 1;
    v_current_mac := COALESCE(v_current_mac, 0);

    UPDATE public.invoice_items SET cost_at_sale = v_current_mac WHERE id = v_item.id;

    SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_running
    FROM public.stock_ledger sl
    WHERE sl.company_id = v_company_id
      AND sl.product_id = v_item.product_id
      AND sl.warehouse_id = v_wh_id
      AND sl.reversal_of_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id
      )
    ORDER BY sl.created_at DESC, sl.id DESC
    LIMIT 1;
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
      -- Phase 12.27 — queue the deferred COGS just like confirm_invoice
      -- does. invoices.update has already cleared old queue rows for this
      -- invoice, so this re-creates them at the post-edit qty.
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
      jsonb_build_object('invoice_number', v_inv.invoice_number, 'je', v_inv_entry, 'phase', '12.27'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id, 'invoice_number', v_inv.invoice_number,
    'je_id', v_inv_je_id, 'entry_number', v_inv_entry
  );
END;
$$;
