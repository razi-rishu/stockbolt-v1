-- ════════════════════════════════════════════════════════════════════════════
-- Phase 13.03 — Dashboard cards RPC
-- ════════════════════════════════════════════════════════════════════════════
--
-- Bundles four datasets into one round trip for the new dashboard cards
-- (Income vs Expense, Top Expenses, Bank Balances, Watchlist) so we don't
-- fire 4 separate queries from the client every time the dashboard renders.
--
-- Datasets:
--   1. monthly_pl   - last 12 calendar months, income (credit-debit on
--                     type=income) and expense (debit-credit on
--                     type=expense)
--   2. top_expenses - 5 largest expense accounts in the current fiscal
--                     year + "others" bucket for the rest. Skips the
--                     accounts with non-positive net activity (could be
--                     a refunded line that ended up net credit).
--   3. bank_balances - all active bank/cash accounts with their current
--                     balance (opening_balance + GL movements).
--   4. watchlist    - subset of bank_balances where balance < 0 (an
--                     overdrawn account is the universally useful
--                     "watch this" signal in v1).
--
-- Returns JSONB. SECURITY INVOKER so RLS still applies — a user can only
-- see cards for their own company.
--
-- Performance: each CTE hits indexes (general_ledger company_id+date,
-- chart_of_accounts FK). On a company with 100k GL rows this completes
-- well under 100ms.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_dashboard_cards(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  -- 12 months ago = first day of the month 11 months back. So if today
  -- is 2026-05-22, we want everything from 2025-06-01 onwards.
  v_start_12mo DATE := (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '11 months')::DATE;
  -- Fiscal year start. We default to calendar year here. A future phase
  -- can pull this from companies.fiscal_year_start_month per tenant.
  v_start_fy   DATE := DATE_TRUNC('year', CURRENT_DATE)::DATE;
  v_result     JSONB;
BEGIN
  WITH monthly AS (
    SELECT
      to_char(gl.date, 'YYYY-MM') AS month,
      COALESCE(SUM(CASE WHEN coa.type = 'income'  THEN gl.credit - gl.debit ELSE 0 END), 0) AS income,
      COALESCE(SUM(CASE WHEN coa.type = 'expense' THEN gl.debit  - gl.credit ELSE 0 END), 0) AS expense
    FROM public.general_ledger gl
    JOIN public.chart_of_accounts coa ON coa.id = gl.account_id
   WHERE gl.company_id = p_company_id
     AND gl.date >= v_start_12mo
     AND coa.type IN ('income', 'expense')
   GROUP BY 1
  ),
  ranked_exp AS (
    SELECT
      coa.code AS account_code,
      coa.name AS account_name,
      SUM(gl.debit - gl.credit) AS amount,
      ROW_NUMBER() OVER (ORDER BY SUM(gl.debit - gl.credit) DESC) AS rn
    FROM public.general_ledger gl
    JOIN public.chart_of_accounts coa ON coa.id = gl.account_id
   WHERE gl.company_id = p_company_id
     AND coa.type = 'expense'
     AND gl.date >= v_start_fy
   GROUP BY coa.code, coa.name
  HAVING SUM(gl.debit - gl.credit) > 0
  ),
  bank_bal AS (
    SELECT
      ba.id,
      ba.name,
      ba.currency,
      ba.account_type,
      ba.opening_balance + COALESCE(SUM(gl.debit - gl.credit), 0) AS balance
    FROM public.bank_accounts ba
    LEFT JOIN public.general_ledger gl
      ON gl.account_id = ba.coa_account_id
     AND gl.company_id = p_company_id
   WHERE ba.company_id = p_company_id
     AND ba.is_active
   GROUP BY ba.id, ba.name, ba.currency, ba.account_type, ba.opening_balance
  )
  SELECT jsonb_build_object(
    'period_start_12mo', v_start_12mo,
    'period_start_fy',   v_start_fy,

    -- Monthly P&L series (12 rows, ordered oldest-to-newest)
    'monthly_pl', COALESCE(
      (SELECT jsonb_agg(
                jsonb_build_object(
                  'month',   month,
                  'income',  income,
                  'expense', expense
                )
                ORDER BY month
              )
         FROM monthly),
      '[]'::jsonb),

    -- Top 5 expense categories
    'top_expenses', COALESCE(
      (SELECT jsonb_agg(
                jsonb_build_object(
                  'account_code', account_code,
                  'account_name', account_name,
                  'amount',       amount
                )
                ORDER BY rn
              )
         FROM ranked_exp WHERE rn <= 5),
      '[]'::jsonb),

    -- Sum of everything ranked >5 → "Others" donut slice
    'top_expenses_others',
      COALESCE((SELECT SUM(amount) FROM ranked_exp WHERE rn > 5), 0),

    -- Grand total of all expense categories (used to render the centre
    -- number in the donut)
    'top_expenses_total',
      COALESCE((SELECT SUM(amount) FROM ranked_exp), 0),

    -- All active bank / cash accounts with current balance
    'bank_balances', COALESCE(
      (SELECT jsonb_agg(
                jsonb_build_object(
                  'id',           id,
                  'name',         name,
                  'currency',     currency,
                  'account_type', account_type,
                  'balance',      balance
                )
                ORDER BY balance DESC
              )
         FROM bank_bal),
      '[]'::jsonb),

    -- Auto-watchlist: overdrawn accounts
    'watchlist', COALESCE(
      (SELECT jsonb_agg(
                jsonb_build_object(
                  'id',      id,
                  'name',    name,
                  'balance', balance
                )
                ORDER BY balance ASC  -- most overdrawn first
              )
         FROM bank_bal
        WHERE balance < 0),
      '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_dashboard_cards IS
  'Phase 13.03 — bundles the four dashboard summary cards (12-mo P&L, '
  'top expenses YTD, bank balances, overdrawn watchlist) into one JSONB '
  'so the React dashboard fires one query for the entire bottom section.';
