-- phase100: the dashboard summary cards follow the period filter
--
-- Income vs Expense was pinned to the last 12 months and Top Expenses to
-- year-to-date, whatever the dashboard's period dropdown said. The function
-- took only a company id, so the cards COULD not follow it.
--
-- Both flow cards now honour an optional window. NULL keeps the old default,
-- so any caller that passes one argument behaves exactly as before.
--
-- Bank & Cash balances are deliberately NOT windowed. A balance is a
-- position, not a flow: 'what is in the account' is a question about now,
-- and the Watchlist built on it is an alert about now. Windowing those would
-- turn a live alert into a historical note.
--
-- DROP + CREATE rather than CREATE OR REPLACE: adding defaulted parameters
-- to an existing function creates an overload, and a one-argument call then
-- matches both and fails as 'function is not unique'. The grants are
-- re-applied below because a drop takes them with it.
--
-- Body read from the live database with pg_get_functiondef and patched by
-- anchor, each anchor required to match exactly once.
--
-- Rollback: re-apply the previous definition from migration history and
-- re-grant; the function is pure derivation and holds no state.

BEGIN;

DROP FUNCTION IF EXISTS public.get_dashboard_cards(uuid);

CREATE OR REPLACE FUNCTION public.get_dashboard_cards(
  p_company_id uuid,
  p_from       date DEFAULT NULL,
  p_to         date DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  -- NULL means "no window was asked for", and the card keeps the default it
  -- has always had. The dashboard passes explicit dates, including a 1900 /
  -- 9999 pair for All time, so there is no ambiguity between "unbounded" and
  -- "unspecified".
  v_to         DATE := COALESCE(p_to, CURRENT_DATE);
  v_start_12mo DATE := COALESCE(p_from, (DATE_TRUNC('month', v_to) - INTERVAL '11 months')::DATE);
  v_start_fy   DATE := COALESCE(p_from, DATE_TRUNC('year', v_to)::DATE);
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
     AND gl.date <= v_to
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
     AND gl.date <= v_to
   GROUP BY coa.code, coa.name
  HAVING SUM(gl.debit - gl.credit) > 0
  ),
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
    -- So the cards can label themselves honestly instead of claiming
    -- "Last 12 months" whatever the filter says.
    'period_from',       v_start_12mo,
    'period_to',         v_to,
    'period_explicit',   (p_from IS NOT NULL OR p_to IS NOT NULL),
    'monthly_pl', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('month',month,'income',income,'expense',expense) ORDER BY month) FROM monthly),
      '[]'::jsonb),
    'top_expenses', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('account_code',account_code,'account_name',account_name,'amount',amount) ORDER BY rn) FROM ranked_exp WHERE rn <= 5),
      '[]'::jsonb),
    'top_expenses_others', COALESCE((SELECT SUM(amount) FROM ranked_exp WHERE rn > 5), 0),
    'top_expenses_total',  COALESCE((SELECT SUM(amount) FROM ranked_exp), 0),
    'bank_balances', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'currency',currency,'account_type',account_type,'balance',balance) ORDER BY balance DESC) FROM bank_bal),
      '[]'::jsonb),
    'watchlist', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'balance',balance) ORDER BY balance ASC) FROM bank_bal WHERE balance < 0),
      '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

-- Restored exactly as captured from pg_proc.proacl before the drop.
GRANT EXECUTE ON FUNCTION public.get_dashboard_cards(uuid, date, date) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dashboard_cards(uuid, date, date) TO anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_cards(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_cards(uuid, date, date) TO service_role;

COMMIT;
