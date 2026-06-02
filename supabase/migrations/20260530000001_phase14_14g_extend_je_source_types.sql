-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt — Phase 14.14g — extend journal_entries.source_type values
-- ─────────────────────────────────────────────────────────────────────────
-- Operator hit this when posting bank opening balances:
--
--   openingBalances.postBank: new row for relation "journal_entries"
--   violates check constraint "journal_entries_source_type_check"
--
-- Root cause: Phase 14.09b/14.09c RPCs tag journal entries with
--   - 'opening_gl'   (post_gl_opening_balance — direct GL postings)
--   - 'opening_bank' (post_bank_opening_balance — per-bank openings)
-- so the void RPC can distinguish them from subsidiary openings
-- (which use 'opening_balance'). But the base CHECK constraint
-- defined back in Phase 0.13 didn't know about these — it only
-- whitelisted 'opening_balance'.
--
-- Fix: drop the old CHECK constraint, add a new one that includes
-- both new values. All existing values stay valid.
--
-- Idempotent: uses DROP CONSTRAINT IF EXISTS so re-running is safe.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_source_type_check;

ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_source_type_check
  CHECK (source_type IN (
    -- Sales side
    'sales_invoice', 'pos_cash_sale', 'pos_card_sale', 'inventory_cogs',
    'customer_receipt', 'customer_advance', 'advance_application', 'advance_refund',
    'sales_credit_note', 'sales_return',
    -- Purchase side
    'vendor_bill', 'goods_receipt', 'vendor_payment', 'vendor_advance', 'vendor_debit_note',
    -- Inventory
    'stock_transfer', 'inventory_adjustment',
    -- Banking / other
    'opening_balance',     -- subsidiary openings (AR / AP / customer-credit / vendor-credit)
    'opening_gl',          -- direct GL postings via post_gl_opening_balance      (NEW)
    'opening_bank',        -- per-bank openings via post_bank_opening_balance     (NEW)
    'bank_transfer', 'direct_receipt', 'expense',
    'pdc_creation', 'pdc_bank_post', 'pdc_clear', 'pdc_bounce',
    -- Catch-alls
    'manual', 'year_end_close'
  ));

COMMENT ON CONSTRAINT journal_entries_source_type_check ON public.journal_entries IS
  'Whitelisted source_type values. Extended in Phase 14.14g to include '
  '''opening_gl'' and ''opening_bank'' so the per-bank-account and direct-GL '
  'opening-balance RPCs can tag their JEs distinctly from subsidiary openings.';
