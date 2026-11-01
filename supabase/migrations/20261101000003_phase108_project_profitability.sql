-- phase108: project profitability — one row per job, derived from the ledger
--
-- Stage 4 of 4, and the point of the whole feature: phase105 tags ledger rows
-- with a project, and this reads them back as revenue, cost and margin.
--
-- NOTHING IS STORED. Every figure here is computed at read time from
-- gl_active. projects.estimated_revenue / estimated_cost are returned
-- alongside, but those are the operator's BUDGET, not a computed balance — the
-- comparison is the point. There is deliberately no realised_revenue column to
-- drift out of step with the GL (AGENTS.md Rule 1), which is the failure this
-- whole codebase was rebuilt to avoid.
--
-- CLASSIFICATION MATCHES THE P&L, DELIBERATELY. A project report that disagreed
-- with the Profit & Loss would be worse than none, so the rules are lifted from
-- reports.getProfitAndLoss rather than invented:
--
--   * chart_of_accounts.type IN ('income','expense') only. Not account-code
--     ranges — the CoA has 90 income and 215 expense accounts across 4xxx-6xxx
--     and tenants add their own, so the type column is the only safe source.
--   * income  -> credit minus debit is positive revenue
--   * expense -> debit minus credit is positive cost
--   * year_end_close legs are EXCLUDED. The close entry zeroes income and
--     expense into Retained Earnings at the fiscal year-end; counting it would
--     make any job spanning a year-end report ~zero profit. The P&L excludes it
--     for exactly this reason and the Balance Sheet deliberately does not.
--
-- WHAT IS AND IS NOT COUNTED, and why it needs no special handling:
--   tax          VAT/GST posts to 2200, a liability -> not income, excluded.
--   payments     cash Dr / AR Cr -> neither leg is income or expense, excluded.
--                So a job's revenue does not move as the customer pays.
--   advances     2400, a liability, until applied -> excluded until invoiced.
--   voids        gl_active drops both the reversed entry and the reversal.
--   currency     the GL is always in base currency, so no conversion here.
--
-- TRADING vs SERVICES NEEDS NO BRANCH, which is why project_id lives on the
-- ledger and not on the document:
--   services tenant  bill -> 6xxx expense              -> job cost at once
--   trading tenant   bill -> 1300 Inventory (an asset)  -> NOT cost yet; it
--                    becomes cost later as 5100 COGS at moving-average cost
--                    when the goods sell against the job's invoice.
-- Tagging the document instead would have counted a trading tenant's stock
-- purchase as job cost on purchase AND again as COGS on sale.
--
-- REVENUE HERE IS INVOICED, NOT COLLECTED. Income accounts are credited when
-- the invoice is confirmed, so a job can show healthy revenue with nothing yet
-- received. That is the correct accrual answer and matches the P&L; AR aging is
-- where collection is answered.
--
-- NULL from/to means unbounded, so the UI can ask for a job's whole life — the
-- usual question for job costing — without inventing sentinel dates.
--
-- PROJECTS WITH NO ACTIVITY STILL APPEAR, as zeros. A planned job with a budget
-- and no postings yet is a thing an operator wants to see. Hence LEFT JOIN and
-- every GL predicate in the ON clause: moving any of them to WHERE would drop
-- those rows silently.
--
-- SECURITY DEFINER with the Phase 65 cross-tenant guard. Note that gl_active
-- now carries security_invoker = true (phase107), which means inside a DEFINER
-- function the view runs as the DEFINER and RLS is bypassed — so the explicit
-- company_id predicates and the guard below are what enforce isolation, not
-- RLS. That is also why the join to gl_active carries company_id as well as
-- project_id.
--
-- Additive and idempotent: CREATE OR REPLACE plus explicit grants. Creates no
-- table, alters no column, writes nothing.
--
-- UNDO PATH: DROP FUNCTION public.get_project_profitability(uuid, date, date);
-- Nothing else depends on it.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_project_profitability(
  p_company_id uuid,
  p_from       date DEFAULT NULL,
  p_to         date DEFAULT NULL
)
RETURNS TABLE (
  project_id        uuid,
  name              text,
  name_ar           text,
  status            text,
  contact_id        uuid,
  contact_name      text,
  start_date        date,
  end_date          date,
  estimated_revenue numeric,
  estimated_cost    numeric,
  revenue           numeric,
  cost              numeric,
  margin            numeric,
  gl_rows           integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  -- ---- Phase 65 cross-tenant guard ----------------------------------------
  -- SECURITY DEFINER bypasses RLS, so without this any authenticated user
  -- could pass another company's UUID and read that tenant's job figures.
  -- Carve-outs match every other report RPC: a NULL auth.uid() is
  -- service_role / maintenance / the test harness, and a caller with no
  -- company yet is mid-onboarding.
  IF auth.uid() IS NOT NULL
     AND public.current_user_company_id() IS NOT NULL
     AND p_company_id IS DISTINCT FROM public.current_user_company_id() THEN
    RAISE EXCEPTION 'get_project_profitability: cross-tenant access denied'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.name_ar,
    p.status,
    p.contact_id,
    c.name                                        AS contact_name,
    p.start_date,
    p.end_date,
    p.estimated_revenue,
    p.estimated_cost,
    -- Income: a credit balance is positive revenue.
    COALESCE(SUM(
      CASE WHEN coa.type = 'income'
            AND je.source_type IS DISTINCT FROM 'year_end_close'
           THEN g.credit - g.debit ELSE 0 END), 0)::numeric(15,2) AS revenue,
    -- Expense: a debit balance is positive cost.
    COALESCE(SUM(
      CASE WHEN coa.type = 'expense'
            AND je.source_type IS DISTINCT FROM 'year_end_close'
           THEN g.debit - g.credit ELSE 0 END), 0)::numeric(15,2) AS cost,
    -- Margin, computed from the same two sums rather than re-aggregated, so it
    -- cannot disagree with the columns beside it.
    (COALESCE(SUM(
       CASE WHEN coa.type = 'income'
             AND je.source_type IS DISTINCT FROM 'year_end_close'
            THEN g.credit - g.debit ELSE 0 END), 0)
     - COALESCE(SUM(
       CASE WHEN coa.type = 'expense'
             AND je.source_type IS DISTINCT FROM 'year_end_close'
            THEN g.debit - g.credit ELSE 0 END), 0))::numeric(15,2) AS margin,
    -- How many ledger rows backed these figures. Lets the UI distinguish
    -- "nothing posted yet" from "posted and nets to zero", which look
    -- identical in the numbers and mean very different things.
    COUNT(g.id)::integer AS gl_rows
  FROM public.projects p
  LEFT JOIN public.contacts c
         ON c.id = p.contact_id
  -- Every GL predicate belongs in the ON clause: in WHERE they would turn this
  -- into an inner join and silently drop projects with no postings in range.
  LEFT JOIN public.gl_active g
         ON g.project_id = p.id
        AND g.company_id = p.company_id
        AND (p_from IS NULL OR g.date >= p_from)
        AND (p_to   IS NULL OR g.date <= p_to)
  LEFT JOIN public.journal_entries je
         ON je.id = g.journal_entry_id
  LEFT JOIN public.chart_of_accounts coa
         ON coa.id = g.account_id
  WHERE p.company_id = p_company_id
  GROUP BY p.id, p.name, p.name_ar, p.status, p.contact_id, c.name,
           p.start_date, p.end_date, p.estimated_revenue, p.estimated_cost
  ORDER BY p.name;
END;
$fn$;

-- Lock the surface down: the anon key ships in the browser bundle, and a job's
-- revenue is exactly the sort of thing that must not be readable without a
-- session. CREATE OR REPLACE does not alter existing grants, so these are
-- stated explicitly rather than assumed.
REVOKE ALL ON FUNCTION public.get_project_profitability(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_project_profitability(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_project_profitability(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_project_profitability(uuid, date, date) TO service_role;

COMMENT ON FUNCTION public.get_project_profitability(uuid, date, date) IS
  'phase108: revenue, cost and margin per project, derived from gl_active at '
  'read time — nothing is cached (Rule 1). Classification matches '
  'reports.getProfitAndLoss exactly: chart_of_accounts.type in income/expense, '
  'year_end_close legs excluded. NULL from/to means unbounded. Projects with no '
  'postings are returned as zeros with gl_rows = 0.';

COMMIT;
