-- ═══════════════════════════════════════════════════════════════════════════
-- StockBolt — Phase 14.14g hotfix
-- Fix: journal_entries.source_type CHECK constraint rejected 'opening_gl'
--      and 'opening_bank', the tags used by the GL-opening and per-bank-
--      opening RPCs. Constraint extended to include both.
--
-- Error this fixes (seen on /settings/opening-balances):
--   openingBalances.postBank: new row for relation "journal_entries"
--   violates check constraint "journal_entries_source_type_check"
--
-- HOW TO RUN
-- ──────────
-- 1. Supabase Dashboard → SQL Editor → New query
-- 2. Paste this entire file → click Run
-- 3. You should see "Success. No rows returned."
-- 4. Refresh /settings/opening-balances → click Post → it works now.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS makes re-running safe.
-- ═══════════════════════════════════════════════════════════════════════════

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
  '''opening_gl'' and ''opening_bank''.';

-- Refresh PostgREST cache so the new constraint is reflected immediately.
NOTIFY pgrst, 'reload schema';
