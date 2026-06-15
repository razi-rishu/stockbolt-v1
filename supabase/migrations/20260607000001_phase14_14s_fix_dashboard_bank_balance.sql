-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 14.14s — fix dashboard bank balance double-count
-- ─────────────────────────────────────────────────────────────────────────
--
-- Root cause:
--   Phase 13.03 wrote the bank_bal CTE as:
--     ba.opening_balance + COALESCE(SUM(gl.debit - gl.credit), 0)
--
--   At that time bank_accounts.opening_balance was a raw column set in
--   the account-creation form and NO GL journal entry existed for it.
--   The formula was correct: opening-column + subsequent-GL-movements.
--
--   Phase 14.09c introduced post_bank_opening_balance which:
--     1. Inserts a GL journal entry (DR bank-COA / CR 3010) for the amount, AND
--     2. Sets bank_accounts.opening_balance to the same amount as a mirror.
--
--   Now the formula reads the same amount twice:
--     ba.opening_balance (mirror = 250 000)
--   + SUM(GL)           (opening JE DR = 250 000)
--   = 500 000            ← reports DOUBLE the real balance
--
--   Phase 14.14r further cemented bank_accounts.opening_balance as a
--   "legacy mirror" of the posted JE, maintained by void_opening_balance
--   and post_bank_opening_balance. It is NOT an independent number.
--
-- Fix:
--   Use the GL as the single source of truth.  The opening JE is already
--   in general_ledger — there is no need to add the mirror column.
--   The new formula is:
--     COALESCE(SUM(gl.debit - gl.credit), 0)
--
--   For banks with no GL entries (opening JE not yet posted), the balance
--   will correctly show 0, consistent with what Trial Balance / Balance
--   Sheet also show.  The operator should post the opening balance via
--   Settings → Opening Balances to record it properly.
--
--   For banks that went through void+repost cycles the GL net is already
--   correct: DR original + CR reversal + DR new = net new amount.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_dashboard_cards(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  v_start_12mo DATE := (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '11 months')::DATE;
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
  -- Phase 14.14s — use GL-only for bank balance (removes double-count).
  -- bank_accounts.opening_balance is a mirror of the posted opening JE;
  -- that JE is already in general_ledger, so adding the mirror column
  -- produced twice the real balance.  The GL is the single source of truth.
  bank_bal AS (
    SELECT
      ba.id,
      ba.name,
      ba.currency,
      ba.account_type,
      COALESCE(SUM(gl.debit - gl.credit), 0) AS balance
    FROM public.bank_accounts ba
    LEFT JOIN public.general_ledger gl
      ON gl.account_id = ba.coa_account_id
     AND gl.company_id = p_company_id
   WHERE ba.company_id = p_company_id
     AND ba.is_active
   GROUP BY ba.id, ba.name, ba.currency, ba.account_type
  )
  SELECT jsonb_build_object(
    'period_start_12mo', v_start_12mo,
    'period_start_fy',   v_start_fy,

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

    'top_expenses_others',
      COALESCE((SELECT SUM(amount) FROM ranked_exp WHERE rn > 5), 0),

    'top_expenses_total',
      COALESCE((SELECT SUM(amount) FROM ranked_exp), 0),

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

    'watchlist', COALESCE(
      (SELECT jsonb_agg(
                jsonb_build_object(
                  'id',      id,
                  'name',    name,
                  'balance', balance
                )
                ORDER BY balance ASC
              )
         FROM bank_bal WHERE balance < 0),
      '[]'::jsonb)

  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_dashboard_cards IS
  'Phase 14.14s — bank balance now uses GL-only (no longer adds '
  'bank_accounts.opening_balance which double-counted the opening JE).';
