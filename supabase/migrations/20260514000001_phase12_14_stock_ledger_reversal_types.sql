-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 12 — Migration 14: stock_ledger reversal types
-- ─────────────────────────────────────────────────────────────────────────
-- The void_invoice (Phase 4.3 line 116) and edit_invoice (Phase 4.3 line
-- 261) RPCs insert stock_ledger rows with type='void' and type='edit_reversal'
-- respectively when reversing the stock impact of a confirmed sale. But
-- the stock_ledger.type CHECK constraint (Phase 0 §H) only allowed the
-- operational types (purchase/sale/transfer/adjustment/opening_balance).
--
-- The constraint mismatch was latent: nobody hit it until QA voided or
-- edited a confirmed invoice. Then every void / edit-repost on a sale
-- with stock impact fails with "stock_ledger_type_check" and rolls back
-- the entire reversal — leaving GL reversed but stock unchanged in some
-- code paths (silent ledger drift).
--
-- Fix: expand the constraint to include the reversal types the RPCs
-- already produce. They're paired with reversal_of_id pointing back to
-- the row being reversed, so they remain auditable as reversals (not
-- mistaken for fresh operations).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.stock_ledger
  DROP CONSTRAINT IF EXISTS stock_ledger_type_check;

ALTER TABLE public.stock_ledger
  ADD CONSTRAINT stock_ledger_type_check
  CHECK (type IN (
    -- Operational types
    'purchase',
    'sale',
    'sales_return',
    'purchase_return',
    'transfer_out',
    'transfer_in',
    'adjustment_in',
    'adjustment_out',
    'opening_balance',
    -- Reversal types (paired with reversal_of_id):
    -- 'void'          — written by void_invoice / void_credit_note / void_*
    -- 'edit_reversal' — written by edit_invoice when reposting
    'void',
    'edit_reversal'
  ));
