-- global06 ROLLBACK - removes branch enforcement and restores the six report
-- functions exactly as before. GUARDED: refuses while any company has
-- enforcement switched on or any user is marked restricted.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE branch_restriction_enabled)
     OR EXISTS (SELECT 1 FROM public.profiles WHERE branch_access = 'restricted') THEN
    RAISE EXCEPTION 'global06 rollback refused: branch restriction is in use; switch it off and unrestrict users first';
  END IF;
END $$;

DROP POLICY IF EXISTS branch_scope ON public.invoices;
DROP POLICY IF EXISTS branch_scope ON public.credit_notes;
DROP POLICY IF EXISTS branch_scope ON public.debit_notes;
DROP POLICY IF EXISTS branch_scope ON public.goods_receipts;
DROP POLICY IF EXISTS branch_scope ON public.inventory_adjustments;
DROP POLICY IF EXISTS branch_scope ON public.pos_sessions;
DROP POLICY IF EXISTS branch_scope ON public.purchase_orders;
DROP POLICY IF EXISTS branch_scope ON public.purchase_returns;
DROP POLICY IF EXISTS branch_scope ON public.sales_orders;
DROP POLICY IF EXISTS branch_scope ON public.sales_returns;
DROP POLICY IF EXISTS branch_scope ON public.stock_ledger;
DROP POLICY IF EXISTS branch_scope ON public.product_serials;
DROP POLICY IF EXISTS branch_scope ON public.deferred_cogs_queue;
DROP POLICY IF EXISTS branch_scope ON public.warehouses;
DROP POLICY IF EXISTS branch_scope ON public.stock_transfers;
DROP POLICY IF EXISTS branch_scope ON public.invoice_items;
DROP POLICY IF EXISTS branch_scope ON public.credit_note_items;
DROP POLICY IF EXISTS branch_scope ON public.debit_note_items;
DROP POLICY IF EXISTS branch_scope ON public.goods_receipt_items;
DROP POLICY IF EXISTS branch_scope ON public.inventory_adjustment_items;
DROP POLICY IF EXISTS branch_scope ON public.purchase_order_items;
DROP POLICY IF EXISTS branch_scope ON public.purchase_return_items;
DROP POLICY IF EXISTS branch_scope ON public.sales_order_items;
DROP POLICY IF EXISTS branch_scope ON public.sales_return_items;
DROP POLICY IF EXISTS branch_scope ON public.stock_transfer_items;
DROP POLICY IF EXISTS branch_scope ON public.e_invoice_documents;
DROP POLICY IF EXISTS branch_scope_read ON public.general_ledger;
DROP POLICY IF EXISTS branch_scope_read ON public.journal_entries;
DROP TRIGGER IF EXISTS profiles_guard_branch_access ON public.profiles;
DROP TRIGGER IF EXISTS companies_guard_branch_restriction ON public.companies;
DROP TRIGGER IF EXISTS profile_branches_guard_self ON public.profile_branches;
DROP FUNCTION IF EXISTS public.tg_guard_branch_access();

CREATE OR REPLACE FUNCTION public.close_fiscal_year(p_fiscal_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id    uuid := auth.uid();
  v_company_id uuid := public.current_user_company_id();
  v_fys        date;
  v_fye        date;
  v_row        public.fiscal_year_closes%ROWTYPE;
  v_prev_closed  boolean;
  v_prev_activity boolean;
  v_re_id      uuid;
  v_lock_date  date;
  v_net_income numeric(15,2);
  v_has_legs   boolean;
  v_row_id     uuid;
  v_je_id      uuid;
  v_seq        bigint;
  v_entry_no   text;
  v_currency   text;
  v_total_dr   numeric(15,2) := 0;
  v_total_cr   numeric(15,2) := 0;
  v_leg        record;
  v_dr         numeric(15,2);
  v_cr         numeric(15,2);
BEGIN
  -- 4.1 Auth + permission (reuse accounting.write)
  IF v_user_id IS NULL OR v_company_id IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.auth_require('accounting.write');

  -- 4.2 Fiscal year window from the company's fiscal_year_start month/day
  SELECT make_date(p_fiscal_year,
                   EXTRACT(MONTH FROM c.fiscal_year_start)::int,
                   EXTRACT(DAY   FROM c.fiscal_year_start)::int),
         c.currency, c.period_lock_date
    INTO v_fys, v_currency, v_lock_date
    FROM public.companies c WHERE c.id = v_company_id;
  IF v_fys IS NULL THEN
    RAISE EXCEPTION 'Company fiscal year start is not set.' USING ERRCODE = 'P0001';
  END IF;
  v_fye := (v_fys + INTERVAL '1 year' - INTERVAL '1 day')::date;

  -- 4.3 The year must have ended
  IF v_fye > CURRENT_DATE THEN
    RAISE EXCEPTION 'Fiscal year % has not ended yet (ends %).', p_fiscal_year, v_fye
      USING ERRCODE = 'P0001';
  END IF;

  -- 4.4 Idempotency: lock the lifecycle row; reject if already closed
  SELECT * INTO v_row FROM public.fiscal_year_closes
    WHERE company_id = v_company_id AND fiscal_year = p_fiscal_year
    FOR UPDATE;
  IF FOUND AND v_row.status = 'closed' THEN
    RAISE EXCEPTION 'Fiscal year % is already closed.', p_fiscal_year USING ERRCODE = 'P0001';
  END IF;

  -- 4.5 Sequential guard: FY N-1 must be closed, OR have no P&L activity
  SELECT EXISTS (SELECT 1 FROM public.fiscal_year_closes
                  WHERE company_id = v_company_id AND fiscal_year = p_fiscal_year - 1
                    AND status = 'closed')
    INTO v_prev_closed;
  IF NOT v_prev_closed THEN
    SELECT EXISTS (
      SELECT 1 FROM public.general_ledger gl
        JOIN public.journal_entries  je  ON je.id  = gl.journal_entry_id
        JOIN public.chart_of_accounts coa ON coa.id = gl.account_id
       WHERE gl.company_id = v_company_id
         AND gl.date BETWEEN (v_fys - INTERVAL '1 year')::date AND (v_fye - INTERVAL '1 year')::date
         AND coa.type IN ('income','expense')
         AND je.source_type <> 'year_end_close'
    ) INTO v_prev_activity;
    IF v_prev_activity THEN
      RAISE EXCEPTION 'Close fiscal year % first — years must be closed in order.',
        p_fiscal_year - 1 USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 4.6 Resolve Retained Earnings (fixed 3100)
  SELECT id INTO v_re_id FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND code = '3100';
  IF v_re_id IS NULL THEN
    RAISE EXCEPTION 'Retained Earnings account 3100 not found for this company.'
      USING ERRCODE = 'P0001';
  END IF;

  -- 4.7 Net income for the year (SUM(credit-debit) over income+expense,
  --     excluding any prior year_end_close legs). = total closing Dr - Cr.
  SELECT COALESCE(SUM(gl.credit - gl.debit), 0)
    INTO v_net_income
    FROM public.general_ledger gl
    JOIN public.journal_entries  je  ON je.id  = gl.journal_entry_id
    JOIN public.chart_of_accounts coa ON coa.id = gl.account_id
   WHERE gl.company_id = v_company_id
     AND gl.date BETWEEN v_fys AND v_fye
     AND coa.type IN ('income','expense')
     AND je.source_type <> 'year_end_close';

  SELECT EXISTS (
    SELECT 1 FROM public.general_ledger gl
      JOIN public.journal_entries  je  ON je.id  = gl.journal_entry_id
      JOIN public.chart_of_accounts coa ON coa.id = gl.account_id
     WHERE gl.company_id = v_company_id
       AND gl.date BETWEEN v_fys AND v_fye
       AND coa.type IN ('income','expense')
       AND je.source_type <> 'year_end_close'
     GROUP BY gl.account_id HAVING SUM(gl.debit) <> SUM(gl.credit)
  ) INTO v_has_legs;

  -- 4.8 Upsert the lifecycle row → status closed (handles reopened → closed)
  INSERT INTO public.fiscal_year_closes AS f (
    company_id, fiscal_year, fiscal_year_start, fiscal_year_end,
    status, net_income, retained_earnings_code, prior_lock_date,
    created_by, closed_at, closed_by, updated_at
  ) VALUES (
    v_company_id, p_fiscal_year, v_fys, v_fye,
    'closed', v_net_income, '3100', v_lock_date,
    v_user_id, now(), v_user_id, now()
  )
  ON CONFLICT (company_id, fiscal_year) DO UPDATE SET
    status = 'closed', net_income = EXCLUDED.net_income,
    fiscal_year_start = EXCLUDED.fiscal_year_start,
    fiscal_year_end   = EXCLUDED.fiscal_year_end,
    prior_lock_date   = EXCLUDED.prior_lock_date,
    je_id = NULL, closed_at = now(), closed_by = v_user_id,
    reopened_at = NULL, reopened_by = NULL, updated_at = now()
  RETURNING f.id INTO v_row_id;

  -- 4.9 Build the close JE directly (by account_id → zeroes archived accounts too)
  IF v_has_legs THEN
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE
      SET current_value = public.document_sequences.current_value + 1, updated_at = now()
    RETURNING current_value INTO v_seq;
    v_entry_no := 'JE-' || v_seq::text;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description, source_type, source_id,
      currency, exchange_rate, total_debit, total_credit, created_by
    ) VALUES (
      v_company_id, v_entry_no, v_fye,
      'Year-end close FY ' || p_fiscal_year, 'year_end_close', v_row_id,
      v_currency, 1, 0, 0, v_user_id
    ) RETURNING id INTO v_je_id;

    -- income/expense legs — one row per posting account with non-zero net.
    -- Uniform rule zeroes each account regardless of type or contra sign.
    FOR v_leg IN
      SELECT gl.account_id, gl.account_code,
             SUM(gl.debit) AS sdr, SUM(gl.credit) AS scr
        FROM public.general_ledger gl
        JOIN public.journal_entries  je  ON je.id  = gl.journal_entry_id
        JOIN public.chart_of_accounts coa ON coa.id = gl.account_id
       WHERE gl.company_id = v_company_id
         AND gl.date BETWEEN v_fys AND v_fye
         AND coa.type IN ('income','expense')
         AND je.source_type <> 'year_end_close'
       GROUP BY gl.account_id, gl.account_code
      HAVING SUM(gl.debit) <> SUM(gl.credit)
    LOOP
      v_dr := GREATEST(v_leg.scr - v_leg.sdr, 0);
      v_cr := GREATEST(v_leg.sdr - v_leg.scr, 0);
      INSERT INTO public.general_ledger (
        company_id, journal_entry_id, account_id, account_code, date,
        debit, credit, description, related_doc_type, related_doc_id
      ) VALUES (
        v_company_id, v_je_id, v_leg.account_id, v_leg.account_code, v_fye,
        v_dr, v_cr, 'Year-end close FY ' || p_fiscal_year, 'year_end_close', v_row_id
      );
      v_total_dr := v_total_dr + v_dr;
      v_total_cr := v_total_cr + v_cr;
    END LOOP;

    -- Retained Earnings balancing leg (exact residual → balances to the cent)
    IF v_net_income > 0 THEN
      INSERT INTO public.general_ledger (company_id, journal_entry_id, account_id, account_code, date,
        debit, credit, description, related_doc_type, related_doc_id)
      VALUES (v_company_id, v_je_id, v_re_id, '3100', v_fye,
        0, v_net_income, 'Year-end close FY ' || p_fiscal_year || ' — net profit to retained earnings', 'year_end_close', v_row_id);
      v_total_cr := v_total_cr + v_net_income;
    ELSIF v_net_income < 0 THEN
      INSERT INTO public.general_ledger (company_id, journal_entry_id, account_id, account_code, date,
        debit, credit, description, related_doc_type, related_doc_id)
      VALUES (v_company_id, v_je_id, v_re_id, '3100', v_fye,
        -v_net_income, 0, 'Year-end close FY ' || p_fiscal_year || ' — net loss from retained earnings', 'year_end_close', v_row_id);
      v_total_dr := v_total_dr + (-v_net_income);
    END IF;

    UPDATE public.journal_entries
      SET total_debit = v_total_dr, total_credit = v_total_cr
      WHERE id = v_je_id;
    UPDATE public.fiscal_year_closes SET je_id = v_je_id, updated_at = now()
      WHERE id = v_row_id;
  END IF;

  -- 4.10 Advance the period lock to the year-end (never backward)
  UPDATE public.companies
    SET period_lock_date = GREATEST(COALESCE(period_lock_date, v_fye), v_fye)
    WHERE id = v_company_id;

  -- 4.11 Audit (best-effort — must not fail the close)
  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'close_fiscal_year', 'fiscal_year_close', v_row_id,
      jsonb_build_object('fiscal_year', p_fiscal_year, 'net_income', v_net_income,
                         'je_id', v_je_id, 'fiscal_year_end', v_fye));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'fiscal_year', p_fiscal_year, 'status', 'closed',
    'net_income', v_net_income, 'journal_entry_id', v_je_id,
    'entry_number', v_entry_no, 'fiscal_year_end', v_fye);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_fiscal_year(p_fiscal_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id    uuid := auth.uid();
  v_company_id uuid := public.current_user_company_id();
  v_row        public.fiscal_year_closes%ROWTYPE;
  v_later      boolean;
  v_rev        jsonb := NULL;
BEGIN
  IF v_user_id IS NULL OR v_company_id IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.auth_require('accounting.write');

  SELECT * INTO v_row FROM public.fiscal_year_closes
    WHERE company_id = v_company_id AND fiscal_year = p_fiscal_year
    FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'closed' THEN
    RAISE EXCEPTION 'Fiscal year % is not closed.', p_fiscal_year USING ERRCODE = 'P0001';
  END IF;

  -- LIFO: cannot reopen a year that sits inside a still-closed later year
  SELECT EXISTS (SELECT 1 FROM public.fiscal_year_closes
                  WHERE company_id = v_company_id AND fiscal_year > p_fiscal_year
                    AND status = 'closed')
    INTO v_later;
  IF v_later THEN
    RAISE EXCEPTION 'Reopen later fiscal years first (reverse order).' USING ERRCODE = 'P0001';
  END IF;

  -- Roll the lock back FIRST (so the year-end-dated reversal is allowed)
  UPDATE public.companies SET period_lock_date = v_row.prior_lock_date
    WHERE id = v_company_id;

  -- Reverse the close JE (if any), unless already reversed
  IF v_row.je_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.journal_entries
                      WHERE id = v_row.je_id AND reversed_by_id IS NOT NULL) THEN
    v_rev := public.reverse_journal_entry(v_row.je_id, 'Reopen FY ' || p_fiscal_year);
  END IF;

  UPDATE public.fiscal_year_closes
    SET status = 'reopened', reopened_at = now(), reopened_by = v_user_id, updated_at = now()
    WHERE id = v_row.id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'reopen_fiscal_year', 'fiscal_year_close', v_row.id,
      jsonb_build_object('fiscal_year', p_fiscal_year, 'reversed_close_je', v_row.je_id));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('fiscal_year', p_fiscal_year, 'status', 'reopened', 'reversal', v_rev);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_bank_recon(p_company_id uuid, p_account_id uuid, p_date_from date, p_date_to date)
 RETURNS TABLE(date date, je_number text, source_type text, description text, debit numeric, credit numeric, running_balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_coa_id UUID;
  v_opening NUMERIC;
BEGIN

  -- ---- Phase 65 (AC-V2) cross-tenant guard --------------------------------
  -- This function is SECURITY DEFINER, so it bypasses RLS. Without this check
  -- any authenticated user could pass another company's UUID and read or
  -- write that tenant's data.
  --
  -- Two deliberate carve-outs keep existing behaviour intact:
  --   * auth.uid() IS NULL  -> service_role / maintenance / the test harness
  --   * caller has no company yet -> onboarding, where seed_default_tax_rates
  --     runs from a trigger on companies INSERT before the profile is linked
  -- phase109 (E2): no caller without a company passes. A missing user is
  -- allowed only for trusted server-side callers: the service_role key, or a
  -- direct database session (SQL editor, migrations), whose session_user is
  -- not PostgREST's 'authenticator'.
  IF auth.uid() IS NULL THEN
    IF session_user = 'authenticator' AND coalesce(auth.role(), '') <> 'service_role' THEN
      RAISE EXCEPTION 'get_bank_recon: not signed in' USING ERRCODE = '42501';
    END IF;
  ELSIF p_company_id IS DISTINCT FROM public.current_user_company_id() THEN
    RAISE EXCEPTION 'get_bank_recon: cross-tenant access denied' USING ERRCODE = '42501';
  END IF;
  -- ---- end Phase 65 -------------------------------------------------------
  -- Resolve bank account → COA account
  SELECT coa_account_id INTO v_coa_id
  FROM   bank_accounts
  WHERE  id = p_account_id AND company_id = p_company_id;

  IF v_coa_id IS NULL THEN
    RETURN;
  END IF;

  -- Opening balance = net of all (non-reversed) GL lines before p_date_from
  SELECT COALESCE(SUM(gl.debit - gl.credit), 0) INTO v_opening
  FROM   general_ledger gl
  WHERE  gl.company_id  = p_company_id
    AND  gl.account_id  = v_coa_id
    AND  gl.date        < p_date_from
    AND  gl.reversal_of_id IS NULL
    AND  gl.id NOT IN (
           SELECT r.reversal_of_id FROM general_ledger r
           WHERE  r.company_id = p_company_id AND r.reversal_of_id IS NOT NULL
         );

  RETURN QUERY
  SELECT
    gl.date                                                          AS date,
    je.entry_number                                                  AS je_number,
    je.source_type                                                   AS source_type,
    gl.description                                                   AS description,
    gl.debit                                                         AS debit,
    gl.credit                                                        AS credit,
    v_opening + SUM(gl.debit - gl.credit)
      OVER (ORDER BY gl.date, je.entry_number ROWS UNBOUNDED PRECEDING) AS running_balance
  FROM   general_ledger gl
  JOIN   journal_entries je ON je.id = gl.journal_entry_id
  WHERE  gl.company_id  = p_company_id
    AND  gl.account_id  = v_coa_id
    AND  gl.date        BETWEEN p_date_from AND p_date_to
    AND  gl.reversal_of_id IS NULL
    AND  gl.id NOT IN (
           SELECT r.reversal_of_id FROM general_ledger r
           WHERE  r.company_id = p_company_id AND r.reversal_of_id IS NOT NULL
         )
  ORDER  BY gl.date, je.entry_number;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_daily_cash_report(p_company_id uuid, p_date date)
 RETURNS TABLE(account_id uuid, account_code text, account_name text, opening_balance numeric, total_in numeric, total_out numeric, closing_balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN

  -- ---- Phase 65 (AC-V2) cross-tenant guard --------------------------------
  -- This function is SECURITY DEFINER, so it bypasses RLS. Without this check
  -- any authenticated user could pass another company's UUID and read or
  -- write that tenant's data.
  --
  -- Two deliberate carve-outs keep existing behaviour intact:
  --   * auth.uid() IS NULL  -> service_role / maintenance / the test harness
  --   * caller has no company yet -> onboarding, where seed_default_tax_rates
  --     runs from a trigger on companies INSERT before the profile is linked
  -- phase109 (E2): no caller without a company passes. A missing user is
  -- allowed only for trusted server-side callers: the service_role key, or a
  -- direct database session (SQL editor, migrations), whose session_user is
  -- not PostgREST's 'authenticator'.
  IF auth.uid() IS NULL THEN
    IF session_user = 'authenticator' AND coalesce(auth.role(), '') <> 'service_role' THEN
      RAISE EXCEPTION 'get_daily_cash_report: not signed in' USING ERRCODE = '42501';
    END IF;
  ELSIF p_company_id IS DISTINCT FROM public.current_user_company_id() THEN
    RAISE EXCEPTION 'get_daily_cash_report: cross-tenant access denied' USING ERRCODE = '42501';
  END IF;
  -- ---- end Phase 65 -------------------------------------------------------
  RETURN QUERY
  WITH bank_coa AS (
    SELECT DISTINCT ba.coa_account_id
    FROM   bank_accounts ba
    WHERE  ba.company_id = p_company_id
      AND  ba.coa_account_id IS NOT NULL
  ),
  opening AS (
    SELECT gl.account_id,
           SUM(gl.debit - gl.credit) AS opening_balance
    FROM   general_ledger gl
    JOIN   bank_coa bc ON bc.coa_account_id = gl.account_id
    WHERE  gl.company_id = p_company_id
      AND  gl.date < p_date
      AND  gl.reversal_of_id IS NULL
      AND  gl.id NOT IN (SELECT r.reversal_of_id FROM general_ledger r
                          WHERE r.company_id = p_company_id AND r.reversal_of_id IS NOT NULL)
    GROUP  BY gl.account_id
  ),
  day_flows AS (
    SELECT gl.account_id,
           SUM(CASE WHEN gl.debit  > 0 THEN gl.debit  ELSE 0 END) AS total_in,
           SUM(CASE WHEN gl.credit > 0 THEN gl.credit ELSE 0 END) AS total_out
    FROM   general_ledger gl
    JOIN   bank_coa bc ON bc.coa_account_id = gl.account_id
    WHERE  gl.company_id = p_company_id
      AND  gl.date = p_date
      AND  gl.reversal_of_id IS NULL
      AND  gl.id NOT IN (SELECT r.reversal_of_id FROM general_ledger r
                          WHERE r.company_id = p_company_id AND r.reversal_of_id IS NOT NULL)
    GROUP  BY gl.account_id
  )
  SELECT
    ca.id, ca.code, ca.name,
    COALESCE(o.opening_balance, 0),
    COALESCE(d.total_in,  0),
    COALESCE(d.total_out, 0),
    COALESCE(o.opening_balance, 0) + COALESCE(d.total_in, 0) - COALESCE(d.total_out, 0)
  FROM   bank_coa bc
  JOIN   chart_of_accounts ca ON ca.id = bc.coa_account_id
  LEFT   JOIN opening   o ON o.account_id = bc.coa_account_id
  LEFT   JOIN day_flows d ON d.account_id = bc.coa_account_id
  WHERE  ca.company_id = p_company_id
  ORDER  BY ca.code;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_project_profitability(p_company_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(project_id uuid, name text, name_ar text, status text, contact_id uuid, contact_name text, start_date date, end_date date, estimated_revenue numeric, estimated_cost numeric, revenue numeric, cost numeric, margin numeric, gl_rows integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- ---- Phase 65 cross-tenant guard ----------------------------------------
  -- SECURITY DEFINER bypasses RLS, so without this any authenticated user
  -- could pass another company's UUID and read that tenant's job figures.
  -- Carve-outs match every other report RPC: a NULL auth.uid() is
  -- service_role / maintenance / the test harness, and a caller with no
  -- company yet is mid-onboarding.
  -- phase109 (E2): no caller without a company passes. A missing user is
  -- allowed only for trusted server-side callers: the service_role key, or a
  -- direct database session (SQL editor, migrations), whose session_user is
  -- not PostgREST's 'authenticator'.
  IF auth.uid() IS NULL THEN
    IF session_user = 'authenticator' AND coalesce(auth.role(), '') <> 'service_role' THEN
      RAISE EXCEPTION 'get_project_profitability: not signed in' USING ERRCODE = '42501';
    END IF;
  ELSIF p_company_id IS DISTINCT FROM public.current_user_company_id() THEN
    RAISE EXCEPTION 'get_project_profitability: cross-tenant access denied' USING ERRCODE = '42501';
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
$function$;

CREATE OR REPLACE FUNCTION public.save_bank_reconciliation(p_company_id uuid, p_bank_account_id uuid, p_statement_end_date date, p_statement_closing_balance numeric, p_gl_line_ids uuid[], p_notes text DEFAULT NULL::text, p_lock boolean DEFAULT false)
 RETURNS bank_reconciliations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bank_coa_id UUID;
  v_recon       public.bank_reconciliations;
  v_existing_id UUID;
  v_book_bal    NUMERIC(15,2) := 0;
  v_line_count  INTEGER       := 0;
  v_user_id     UUID;
BEGIN

  -- ---- Phase 65 (AC-V2) cross-tenant guard --------------------------------
  -- This function is SECURITY DEFINER, so it bypasses RLS. Without this check
  -- any authenticated user could pass another company's UUID and read or
  -- write that tenant's data.
  --
  -- Two deliberate carve-outs keep existing behaviour intact:
  --   * auth.uid() IS NULL  -> service_role / maintenance / the test harness
  --   * caller has no company yet -> onboarding, where seed_default_tax_rates
  --     runs from a trigger on companies INSERT before the profile is linked
  -- phase109 (E2): no caller without a company passes. A missing user is
  -- allowed only for trusted server-side callers: the service_role key, or a
  -- direct database session (SQL editor, migrations), whose session_user is
  -- not PostgREST's 'authenticator'.
  IF auth.uid() IS NULL THEN
    IF session_user = 'authenticator' AND coalesce(auth.role(), '') <> 'service_role' THEN
      RAISE EXCEPTION 'save_bank_reconciliation: not signed in' USING ERRCODE = '42501';
    END IF;
  ELSIF p_company_id IS DISTINCT FROM public.current_user_company_id() THEN
    RAISE EXCEPTION 'save_bank_reconciliation: cross-tenant access denied' USING ERRCODE = '42501';
  END IF;
  -- ---- end Phase 65 -------------------------------------------------------
  v_user_id := auth.uid();
  SELECT coa_account_id INTO v_bank_coa_id
  FROM public.bank_accounts
  WHERE id = p_bank_account_id AND company_id = p_company_id;
  IF v_bank_coa_id IS NULL THEN
    RAISE EXCEPTION 'save_bank_reconciliation: bank account % not found in company %',
      p_bank_account_id, p_company_id USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_existing_id FROM public.bank_reconciliations
  WHERE company_id = p_company_id AND bank_account_id = p_bank_account_id
    AND statement_end_date = p_statement_end_date;

  IF v_existing_id IS NOT NULL THEN
    SELECT * INTO v_recon FROM public.bank_reconciliations WHERE id = v_existing_id;
    IF v_recon.status = 'locked' THEN
      RAISE EXCEPTION 'save_bank_reconciliation: reconciliation % is locked, cannot edit',
        v_existing_id USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.general_ledger SET reconciliation_id = NULL
     WHERE reconciliation_id = v_existing_id;
  ELSE
    INSERT INTO public.bank_reconciliations
      (company_id, bank_account_id, statement_end_date, statement_closing_balance,
       reconciled_book_balance, outstanding_amount, line_count, notes, created_by)
    VALUES
      (p_company_id, p_bank_account_id, p_statement_end_date,
       p_statement_closing_balance, 0, 0, 0, p_notes, v_user_id)
    RETURNING * INTO v_recon;
    v_existing_id := v_recon.id;
  END IF;

  IF array_length(p_gl_line_ids, 1) IS NOT NULL THEN
    WITH validated AS (
      SELECT gl.id, gl.debit, gl.credit FROM public.general_ledger gl
      WHERE gl.id = ANY(p_gl_line_ids) AND gl.company_id = p_company_id
        AND gl.account_id = v_bank_coa_id
        AND (gl.reconciliation_id IS NULL OR gl.reconciliation_id = v_existing_id)
        AND gl.date <= p_statement_end_date
    )
    SELECT COALESCE(SUM(debit) - SUM(credit), 0), COUNT(*)
      INTO v_book_bal, v_line_count FROM validated;

    IF v_line_count <> array_length(p_gl_line_ids, 1) THEN
      RAISE EXCEPTION
        'save_bank_reconciliation: % of % GL lines rejected (wrong bank, already reconciled elsewhere, or after statement date)',
        array_length(p_gl_line_ids, 1) - v_line_count, array_length(p_gl_line_ids, 1)
        USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.general_ledger SET reconciliation_id = v_existing_id
     WHERE id = ANY(p_gl_line_ids);
  END IF;

  UPDATE public.bank_reconciliations
     SET statement_closing_balance = p_statement_closing_balance,
         reconciled_book_balance   = v_book_bal,
         outstanding_amount        = p_statement_closing_balance - v_book_bal,
         line_count                = v_line_count, notes = p_notes,
         status = CASE WHEN p_lock THEN 'locked' ELSE 'open' END,
         locked_at = CASE WHEN p_lock THEN NOW() ELSE NULL END,
         locked_by = CASE WHEN p_lock THEN v_user_id ELSE NULL END
   WHERE id = v_existing_id RETURNING * INTO v_recon;
  RETURN v_recon;
END;
$function$;

DROP FUNCTION IF EXISTS public._branch_require_unrestricted();
DROP FUNCTION IF EXISTS public._branch_allows_warehouse(uuid);
DROP FUNCTION IF EXISTS public._branch_restricted();
COMMENT ON TABLE public.vendor_bills IS NULL;
ALTER TABLE public.companies DROP COLUMN IF EXISTS branch_restriction_enabled;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_branch_access_check;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS branch_access;

COMMIT;
