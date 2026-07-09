-- =============================================================================
-- Phase 42 — Flush stranded deferred-COGS (repair for pre-phase41 mis-costing)
-- =============================================================================
-- Before phase41, an edit-repost could read the product's current MAC
-- nondeterministically (same-timestamp rows, random uuid tiebreaker) and get
-- 0 instead of the real cost. The sale was then costed at 0 and parked in
-- deferred_cogs_queue as a "sell before buy" case — waiting for a purchase
-- that will never come, while the purchase cost stays stranded in 1300.
-- Live case: Pro_Parts, CONTROL UNITS LIGHT (110) + LOWER GRILL (40) → E1 150.
--
-- This repair finds every (company, product) where:
--   • deferred_cogs_queue has PENDING rows, AND
--   • live on-hand quantity is exactly 0 (everything already sold), AND
--   • live stock movements still carry a positive stranded value
-- and completes the flush the standard engine would have performed:
--   1. one balanced JE per product: Dr 5100 COGS / Cr 1300 Inventory
--   2. the zero-costed live sale rows get their true unit cost
--   3. invoice_items.cost_at_sale corrected (margin reports)
--   4. queue rows marked flushed (so no future double-flush)
--   5. running chains recomputed
-- Genuine sell-before-buy queues (stranded value = 0) are left pending.
-- Apply AFTER phase41. GL stays balanced; P&L finally shows the true COGS.
-- =============================================================================

DO $repair$
DECLARE
  r RECORD;
  v_onhand  NUMERIC;
  v_value   NUMERIC;
  v_unit    NUMERIC;
  v_cogs_id UUID;
  v_inv_id  UUID;
  v_user_id UUID;
  v_seq     BIGINT;
  v_entry   TEXT;
  v_je_id   UUID;
  v_pname   TEXT;
BEGIN
  FOR r IN
    SELECT dcq.company_id, dcq.product_id, SUM(dcq.quantity) AS pending_qty
    FROM public.deferred_cogs_queue dcq
    WHERE dcq.status = 'pending'
    GROUP BY dcq.company_id, dcq.product_id
  LOOP
    -- Live position of this product: on-hand qty and net moved value.
    SELECT COALESCE(SUM(sl.direction * sl.quantity), 0),
           COALESCE(SUM(sl.direction * sl.total_cost), 0)
      INTO v_onhand, v_value
    FROM public.stock_ledger sl
    WHERE sl.company_id = r.company_id
      AND sl.product_id = r.product_id
      AND sl.reversal_of_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.stock_ledger x WHERE x.reversal_of_id = sl.id);

    -- Only the stranded pattern: nothing on hand, but value never expensed.
    CONTINUE WHEN v_onhand <> 0 OR v_value <= 0 OR r.pending_qty <= 0;

    SELECT id INTO v_cogs_id FROM public.chart_of_accounts
     WHERE company_id = r.company_id AND code = '5100' AND is_active LIMIT 1;
    SELECT id INTO v_inv_id FROM public.chart_of_accounts
     WHERE company_id = r.company_id AND code = '1300' AND is_active LIMIT 1;
    CONTINUE WHEN v_cogs_id IS NULL OR v_inv_id IS NULL;

    SELECT id INTO v_user_id FROM public.profiles WHERE company_id = r.company_id LIMIT 1;
    SELECT name INTO v_pname FROM public.products WHERE id = r.product_id;

    v_unit := ROUND(v_value / r.pending_qty, 2);

    -- 1. Balanced flush JE (same shape as the engine's deferred-COGS flush).
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (r.company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE
      SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
    RETURNING current_value INTO v_seq;
    v_entry := 'JE-' || v_seq::TEXT;

    INSERT INTO public.journal_entries
      (company_id, entry_number, date, description, source_type, source_id,
       total_debit, total_credit, created_by)
    VALUES
      (r.company_id, v_entry, CURRENT_DATE,
       'Deferred COGS flush — ' || COALESCE(v_pname, 'product') || ' (phase42 repair)',
       'inventory_cogs', r.product_id, v_value, v_value, v_user_id)
    RETURNING id INTO v_je_id;

    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, related_doc_type, related_doc_id)
    VALUES
      (r.company_id, v_je_id, v_cogs_id, '5100', CURRENT_DATE,
       v_value, 0, 'Deferred COGS — ' || COALESCE(v_pname, 'product'),
       'product', r.product_id),
      (r.company_id, v_je_id, v_inv_id, '1300', CURRENT_DATE,
       0, v_value, 'Deferred COGS — ' || COALESCE(v_pname, 'product'),
       'product', r.product_id);

    -- 2. Put the true cost on the zero-costed live sale rows of the queued
    --    invoices, so the subledger movement history ties to the GL.
    UPDATE public.stock_ledger sl
       SET unit_cost = v_unit, total_cost = ROUND(sl.quantity * v_unit, 2)
     WHERE sl.company_id = r.company_id
       AND sl.product_id = r.product_id
       AND sl.type = 'sale'
       AND sl.total_cost = 0
       AND sl.reversal_of_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.stock_ledger x WHERE x.reversal_of_id = sl.id)
       AND sl.related_doc_id IN (
         SELECT sale_invoice_id FROM public.deferred_cogs_queue
         WHERE company_id = r.company_id AND product_id = r.product_id AND status = 'pending'
       );

    -- 3. Margin reports read invoice_items.cost_at_sale.
    UPDATE public.invoice_items ii
       SET cost_at_sale = v_unit
     WHERE ii.id IN (
       SELECT invoice_item_id FROM public.deferred_cogs_queue
       WHERE company_id = r.company_id AND product_id = r.product_id
         AND status = 'pending' AND invoice_item_id IS NOT NULL
     );

    -- 4. Close the queue rows exactly like the engine's flush does.
    UPDATE public.deferred_cogs_queue
       SET status = 'flushed', flushed_at = NOW(),
           flushed_journal_entry_id = v_je_id, flush_unit_cost = v_unit
     WHERE company_id = r.company_id AND product_id = r.product_id AND status = 'pending';

    RAISE NOTICE 'phase42: flushed % (%) — COGS % booked in JE %',
      v_pname, r.product_id, v_value, v_entry;
  END LOOP;
END $repair$;

-- 5. Rebuild running chains with the corrected sale costs.
SELECT public.recompute_stock_valuation(NULL);

NOTIFY pgrst, 'reload schema';
