-- phase101: "Fiscal year to date" means the COMPANY's fiscal year
--
-- Top Expenses is labelled "Fiscal year to date" and used
-- DATE_TRUNC('year', ...) - the CALENDAR year. Identical for a Jan-Dec
-- tenant, wrong for every other one.
--
-- It is not theoretical: ABCD LTD, Libra and Toke take all have
-- fiscal_year_start = 2026-04-01, so today their card reports from
-- 1 January and silently includes January to March, which belongs to the
-- fiscal year that ended.
--
-- Verified against live data before writing this, at two reporting dates:
--   as at 2026-10-10  Jan-Dec tenants 2026-01-01 (unchanged)
--                     Apr tenants     2026-04-01 (was 2026-01-01)
--   as at 2026-02-15  Apr tenants     2025-04-01 - the start has not
--                     arrived yet, so the fiscal year is still last
--                     April's. That is the case a naive fix gets wrong.
--
-- WHY THIS IS A SEPARATE MIGRATION: phase100 was written, applied, and only
-- then did this bug come up. Editing an applied migration would have left
-- the repo claiming something the database had never run - Supabase skips a
-- filename it has already recorded, so the change would never have landed.
-- phase100 is restored to exactly what ran; this is appended instead.
--
-- CREATE OR REPLACE is safe here: phase100 already established the
-- (uuid, date, date) signature, so there is no overload to resolve and no
-- grant to re-apply.
--
-- Body read from the LIVE database with pg_get_functiondef - that is, from
-- phase100 as actually applied - and patched by anchor, each anchor
-- required to match exactly once.
--
-- Rollback: re-apply phase100's definition.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_dashboard_cards(p_company_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
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
  -- The card is labelled "Fiscal year to date" but used DATE_TRUNC('year'),
  -- i.e. the CALENDAR year. Identical for a Jan-Dec tenant and wrong for
  -- everyone else: three companies on this instance start in April, so their
  -- card silently included the previous fiscal year's January to March.
  --
  -- fiscal_year_start is a full DATE; only its month and day carry meaning,
  -- the year being whenever it happened to be set. So rebuild it on the year
  -- being reported, and step back one year when that start has not arrived
  -- yet (in February, an April-start company is still in the fiscal year that
  -- began last April).
  --
  -- The day is added to the 1st rather than passed to make_date, so a Feb 29
  -- anchor rolls to Mar 1 in a common year instead of raising.
  v_fy_anchor  DATE := (SELECT c.fiscal_year_start FROM public.companies c
                         WHERE c.id = p_company_id);
  v_fy_cand    DATE := CASE WHEN v_fy_anchor IS NULL THEN NULL
                            ELSE make_date(EXTRACT(YEAR FROM v_to)::INT,
                                           EXTRACT(MONTH FROM v_fy_anchor)::INT, 1)
                                 + (EXTRACT(DAY FROM v_fy_anchor)::INT - 1)
                       END;
  v_fy_start   DATE := CASE WHEN v_fy_cand IS NULL THEN DATE_TRUNC('year', v_to)::DATE
                            WHEN v_fy_cand > v_to  THEN (v_fy_cand - INTERVAL '1 year')::DATE
                            ELSE v_fy_cand
                       END;
  v_start_fy   DATE := COALESCE(p_from, v_fy_start);
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
    'fiscal_year_start', v_fy_start,
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

COMMIT;
