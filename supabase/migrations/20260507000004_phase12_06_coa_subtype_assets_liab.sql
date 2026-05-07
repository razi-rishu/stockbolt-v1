-- Phase 12 — Current vs Fixed/Long-term breakdown for Balance Sheet
--
-- Extends the sub_type concept introduced in 20260507000003 to cover
-- assets and liabilities, so the Balance Sheet can split into:
--   Current Assets / Fixed Assets
--   Current Liabilities / Long-term Liabilities
--
-- Every existing system seed account ships with maturity < 12 months, so
-- they all backfill to sub_type = 'current'. New accounts the user adds
-- (e.g. "1700 Office Equipment" / "2900 Long-term Loan") classify
-- themselves via the form's flat 9-option Type dropdown which maps to
-- (type, sub_type).

-- ── Current Assets (within 12 months / liquid) ──────────────────────────────
UPDATE public.chart_of_accounts
SET sub_type = 'current'
WHERE type = 'asset'
  AND code IN (
    '1100', '1110',  -- Cash in Hand, Bank Account
    '1200', '1250', '1260',  -- AR, PDC Receivable, Bounced Cheques
    '1300',  -- Inventory
    '1400',  -- Vendor Advances / Prepaid
    '1500', '1510', '1520', '1530'  -- VAT/GST Input
  )
  AND (sub_type IS NULL OR sub_type = '');

-- ── Current Liabilities (due within 12 months) ──────────────────────────────
UPDATE public.chart_of_accounts
SET sub_type = 'current'
WHERE type = 'liability'
  AND code IN (
    '2100', '2150',  -- AP, GRN Accrual
    '2200', '2210', '2220', '2230',  -- VAT/GST Output
    '2300',  -- Accrued Expenses
    '2400', '2450'  -- Customer Advances, PDC Payable
  )
  AND (sub_type IS NULL OR sub_type = '');
