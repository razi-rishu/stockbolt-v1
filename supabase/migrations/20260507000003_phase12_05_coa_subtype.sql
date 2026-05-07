-- Phase 12 — Direct vs Indirect grouping for Revenue & Expense accounts
--
-- Purpose: enable proper Gross Profit reporting on the P&L. The 5 main
-- account types (asset/liability/equity/revenue/expense) stay the same;
-- we use the existing sub_type text column to mark each revenue/expense
-- account as either:
--   'direct'   — appears ABOVE Gross Profit
--                (Sales 4100; COGS 5100; future: direct labour, freight-in)
--   'indirect' — appears BELOW Gross Profit
--                (Other Income 4300, FX Gain 4400; rent, utilities,
--                 inventory loss 6700, FX loss 6900, etc.)
--
-- This migration backfills sub_type on the system seed accounts for
-- every existing company. New companies pick this up via seedCOA.ts.

-- The DB CHECK constraint uses ('asset','liability','equity','income','expense').
-- Income accounts that map to "Sales" sit ABOVE Gross Profit; the rest are "Other Income".
-- Expense accounts in the 5xxx range are direct (COGS); 6xxx are operating expenses.

-- ── Direct income (Sales — sits above Gross Profit) ─────────────────────────
UPDATE public.chart_of_accounts
SET sub_type = 'direct'
WHERE type = 'income'
  AND code = '4100'
  AND (sub_type IS NULL OR sub_type = '' OR sub_type = 'cogs');

-- 4150 Sales Discounts: contra-revenue, sits with sales
UPDATE public.chart_of_accounts
SET sub_type = 'direct'
WHERE type = 'income'
  AND code = '4150'
  AND (sub_type IS NULL OR sub_type = '');

-- ── Indirect income (Other Income — sits below Gross Profit) ────────────────
UPDATE public.chart_of_accounts
SET sub_type = 'indirect'
WHERE type = 'income'
  AND code IN ('4200', '4300', '4400', '4500', '4600', '4700', '4800', '4900')
  AND (sub_type IS NULL OR sub_type = '');

-- ── Direct expense (COGS — sits above Gross Profit) ─────────────────────────
-- 5100 Cost of Goods Sold previously had sub_type='cogs' (legacy); coerce to 'direct'.
UPDATE public.chart_of_accounts
SET sub_type = 'direct'
WHERE type = 'expense'
  AND code IN ('5100', '5200', '5300', '5400', '5500', '5600', '5700', '5800', '5900')
  AND (sub_type IS NULL OR sub_type = '' OR sub_type = 'cogs');

-- ── Indirect expense (Operating expenses — sits below Gross Profit) ─────────
UPDATE public.chart_of_accounts
SET sub_type = 'indirect'
WHERE type = 'expense'
  AND code IN ('6100', '6200', '6300', '6400', '6500', '6600', '6700', '6800', '6900')
  AND (sub_type IS NULL OR sub_type = '');
