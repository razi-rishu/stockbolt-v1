-- ═══════════════════════════════════════════════════════════════════════════
-- phase87 — let thirteen shipped posting engines actually post
--
-- Refunds failed at the database with:
--
--     new row for relation "journal_entries" violates check constraint
--     "journal_entries_source_type_check"
--
-- Checking every posting function against the constraint rather than only the
-- refunds turned up THIRTEEN that name a source_type the table rejects. Each
-- was shipped by a migration that added the function and left the constraint
-- behind:
--
--   confirm_customer_refund         customer_refund          phase70  (S4)
--   confirm_vendor_refund           vendor_refund            phase70
--   confirm_customer_credit_refund  customer_credit_refund   phase78  (R5a)
--   confirm_vendor_credit_refund    vendor_credit_refund     phase84  (P4)
--   run_depreciation                depreciation             phase60  (AC-5)
--   reverse_last_depreciation       depreciation_reversal    phase60
--   dispose_fixed_asset             asset_disposal           phase60
--   run_amortization                amortization             phase61  (AC-6)
--   reverse_last_amortization       amortization_reversal    phase61
--   record_tds_deduction            tds_deduction            AC-7
--   reverse_tds_deduction           tds_reversal             AC-7
--   post_sales_return_writeoff      sales_return_writeoff    phase76  (R4a)
--   post_sales_return_fee           sales_return_fee         phase77  (R4b)
--
-- So depreciation, asset disposal, amortization, TDS deduction, the damaged
-- sales-return write-off and the restocking fee were all as unpostable as the
-- refunds. None of them has a single row in journal_entries, which is the
-- proof: the constraint has refused every one since the day it was written.
--
-- These failures were invisible because each engine is reached from a screen
-- or a trigger that had not been exercised — and in the refunds' case, by a
-- client bug (fixed in 0d1923f) that threw before the request was ever sent.
--
-- WHY THE ENGINES' NAMES WIN
-- The constraint already allows 'advance_refund', the name in the locked
-- SourceType list, which nothing has ever posted. Collapsing names onto it
-- would leave the GL unable to say whether an advance or a credit balance was
-- returned, or in which direction — four distinct lines in the Daily Cash
-- report. The same argument holds for depreciation vs its reversal, and for
-- a write-off vs a restocking fee. Thirteen names; the locked list in
-- AGENTS.md is updated in the same commit, per §11.4.
--
-- 'advance_refund' is LEFT IN PLACE. No rows carry it, so dropping it would
-- change nothing except the odds of breaking something unseen.
--
-- SAFE TO APPLY: no existing row uses any of the thirteen, so widening the
-- constraint cannot fail validation. No function is reopened, no data written.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_source_type_check;

ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_source_type_check CHECK (
    source_type = ANY (ARRAY[
      'sales_invoice'::text,
      'pos_cash_sale'::text,
      'pos_card_sale'::text,
      'inventory_cogs'::text,
      'customer_receipt'::text,
      'customer_advance'::text,
      'advance_application'::text,
      'advance_refund'::text,
      'sales_credit_note'::text,
      'sales_return'::text,
      'vendor_bill'::text,
      'goods_receipt'::text,
      'vendor_payment'::text,
      'vendor_advance'::text,
      'vendor_debit_note'::text,
      'stock_transfer'::text,
      'inventory_adjustment'::text,
      'opening_balance'::text,
      'opening_gl'::text,
      'opening_bank'::text,
      'bank_transfer'::text,
      'direct_receipt'::text,
      'expense'::text,
      'pdc_creation'::text,
      'pdc_bank_post'::text,
      'pdc_clear'::text,
      'pdc_bounce'::text,
      'manual'::text,
      'year_end_close'::text,

      -- ── phase87: shipped engines the constraint never learned ──────────
      -- Refunds
      'customer_refund'::text,          -- Dr 2400 / Cr bank
      'vendor_refund'::text,            -- Dr bank / Cr 1400
      'customer_credit_refund'::text,   -- Dr 1200 / Cr bank
      'vendor_credit_refund'::text,     -- Dr bank / Cr 2100
      -- Fixed assets (AC-5)
      'depreciation'::text,             -- Dr 6750 / Cr accumulated depreciation
      'depreciation_reversal'::text,
      'asset_disposal'::text,           -- 4250 gain / 6910 loss on disposal
      -- Amortization (AC-6)
      'amortization'::text,
      'amortization_reversal'::text,
      -- India TDS (AC-7)
      'tds_deduction'::text,
      'tds_reversal'::text,
      -- Sales returns (R4a / R4b)
      'sales_return_writeoff'::text,    -- Dr 6700 / Cr 5100, damaged lines
      'sales_return_fee'::text          -- Dr 1200 / Cr 2200 + Cr 4200
    ])
  );

COMMIT;

-- ── ROLLBACK ───────────────────────────────────────────────────────────────
-- Refuses to run while any journal entry carries one of the thirteen, rather
-- than leaving a constraint the table's own rows violate.
--
-- BEGIN;
--
-- DO $$
-- BEGIN
--   IF EXISTS (SELECT 1 FROM public.journal_entries WHERE source_type IN (
--        'customer_refund','vendor_refund','customer_credit_refund',
--        'vendor_credit_refund','depreciation','depreciation_reversal',
--        'asset_disposal','amortization','amortization_reversal',
--        'tds_deduction','tds_reversal','sales_return_writeoff',
--        'sales_return_fee'))
--   THEN
--     RAISE EXCEPTION 'Journal entries use phase87 source types; reverse them before rolling back.';
--   END IF;
-- END $$;
--
-- ALTER TABLE public.journal_entries
--   DROP CONSTRAINT IF EXISTS journal_entries_source_type_check;
--
-- ALTER TABLE public.journal_entries
--   ADD CONSTRAINT journal_entries_source_type_check CHECK (
--     source_type = ANY (ARRAY['sales_invoice'::text, 'pos_cash_sale'::text,
--       'pos_card_sale'::text, 'inventory_cogs'::text, 'customer_receipt'::text,
--       'customer_advance'::text, 'advance_application'::text, 'advance_refund'::text,
--       'sales_credit_note'::text, 'sales_return'::text, 'vendor_bill'::text,
--       'goods_receipt'::text, 'vendor_payment'::text, 'vendor_advance'::text,
--       'vendor_debit_note'::text, 'stock_transfer'::text, 'inventory_adjustment'::text,
--       'opening_balance'::text, 'opening_gl'::text, 'opening_bank'::text,
--       'bank_transfer'::text, 'direct_receipt'::text, 'expense'::text,
--       'pdc_creation'::text, 'pdc_bank_post'::text, 'pdc_clear'::text,
--       'pdc_bounce'::text, 'manual'::text, 'year_end_close'::text])
--   );
--
-- COMMIT;
