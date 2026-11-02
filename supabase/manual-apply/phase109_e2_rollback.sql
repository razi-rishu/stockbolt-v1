-- phase109 ROLLBACK - restores the live definitions exported 2026-11-02, before
-- 20261102000001_phase109_e2_cross_tenant_guard.sql.
--
-- WARNING: this RE-OPENS Finding E for signed-up users without a company.
-- Use only if a legitimate flow breaks after phase109, and fix forward fast.
-- E1 (anon revoke) is not undone here.

BEGIN;

-- ROLLBACK GUARD - this file was run by mistake once (2026-11-02) and silently
-- re-opened a cross-tenant hole. It now refuses to run. To roll back on purpose,
-- delete this DO block, run the file, and record why in the security report.
DO $$ BEGIN
  RAISE EXCEPTION 'ROLLBACK GUARD: this rollback re-opens phase109 (Finding E) for signed-up users without a company, on eight SECURITY DEFINER functions. Delete this block to run it deliberately.';
END $$;


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
  IF auth.uid() IS NOT NULL
     AND public.current_user_company_id() IS NOT NULL
     AND p_company_id IS DISTINCT FROM public.current_user_company_id() THEN
    RAISE EXCEPTION 'get_bank_recon: cross-tenant access denied'
      USING ERRCODE = '42501';
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
  IF auth.uid() IS NOT NULL
     AND public.current_user_company_id() IS NOT NULL
     AND p_company_id IS DISTINCT FROM public.current_user_company_id() THEN
    RAISE EXCEPTION 'get_daily_cash_report: cross-tenant access denied'
      USING ERRCODE = '42501';
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
$function$;

CREATE OR REPLACE FUNCTION public.recompute_stock_valuation(p_company_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_rows INTEGER;
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
  IF auth.uid() IS NOT NULL
     AND public.current_user_company_id() IS NOT NULL
     AND p_company_id IS DISTINCT FROM public.current_user_company_id() THEN
    RAISE EXCEPTION 'recompute_stock_valuation: cross-tenant access denied'
      USING ERRCODE = '42501';
  END IF;
  -- ---- end Phase 65 -------------------------------------------------------
  WITH cum AS (
    SELECT id,
      SUM(direction * quantity)   OVER w AS cq,
      SUM(direction * total_cost) OVER w AS cc
    FROM public.stock_ledger
    WHERE p_company_id IS NULL OR company_id = p_company_id
    WINDOW w AS (
      PARTITION BY company_id, product_id, warehouse_id
      ORDER BY seq          -- matches how E1 picks the latest row (created_at DESC)
      ROWS UNBOUNDED PRECEDING
    )
  )
  UPDATE public.stock_ledger sl
     SET running_qty      = cum.cq,
         running_avg_cost = CASE WHEN cum.cq <> 0 THEN ROUND(cum.cc / cum.cq, 2) ELSE 0 END
    FROM cum
   WHERE sl.id = cum.id
     AND ( sl.running_qty IS DISTINCT FROM cum.cq
        OR sl.running_avg_cost IS DISTINCT FROM CASE WHEN cum.cq <> 0 THEN ROUND(cum.cc / cum.cq, 2) ELSE 0 END );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
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
  IF auth.uid() IS NOT NULL
     AND public.current_user_company_id() IS NOT NULL
     AND p_company_id IS DISTINCT FROM public.current_user_company_id() THEN
    RAISE EXCEPTION 'save_bank_reconciliation: cross-tenant access denied'
      USING ERRCODE = '42501';
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

CREATE OR REPLACE FUNCTION public.search_contacts(p_company_id uuid, p_q text DEFAULT NULL::text, p_type text DEFAULT NULL::text, p_limit integer DEFAULT 20)
 RETURNS TABLE(id uuid, type text, name text, name_ar text, phone text, email text, tax_id text, credit_limit numeric, match_rank real)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_q TEXT := NULLIF(TRIM(COALESCE(p_q, '')), '');
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
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
  IF auth.uid() IS NOT NULL
     AND public.current_user_company_id() IS NOT NULL
     AND p_company_id IS DISTINCT FROM public.current_user_company_id() THEN
    RAISE EXCEPTION 'search_contacts: cross-tenant access denied'
      USING ERRCODE = '42501';
  END IF;
  -- ---- end Phase 65 -------------------------------------------------------
  RETURN QUERY
  SELECT
    ct.id::UUID,
    ct.type::TEXT,
    ct.name::TEXT,
    ct.name_ar::TEXT,
    ct.phone::TEXT,
    ct.email::TEXT,
    ct.tax_id::TEXT,
    ct.credit_limit::NUMERIC,
    (CASE
      WHEN v_q IS NULL THEN 0::REAL
      WHEN ct.phone  = v_q                 THEN 2.0::REAL
      WHEN ct.tax_id = v_q                 THEN 1.8::REAL
      WHEN LOWER(ct.email) = LOWER(v_q)    THEN 1.5::REAL
      ELSE (1.0 + similarity(ct.name, v_q))::REAL
    END)::REAL AS match_rank
  FROM public.contacts ct
  WHERE ct.company_id = p_company_id
    AND (p_type IS NULL OR ct.type = p_type)
    AND (
      v_q IS NULL
      OR ct.phone   = v_q
      OR ct.tax_id  = v_q
      OR ct.name    ILIKE '%' || v_q || '%'
      OR ct.email   ILIKE v_q || '%'
    )
  ORDER BY 9 DESC, ct.name ASC
  LIMIT v_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_products(p_company_id uuid, p_q text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_brand_id uuid DEFAULT NULL::uuid, p_category_id uuid DEFAULT NULL::uuid, p_include_inactive boolean DEFAULT false)
 RETURNS TABLE(id uuid, sku text, name text, name_ar text, oe_number text, barcode text, brand_id uuid, brand_name text, category_id uuid, category_name text, unit_id uuid, unit_code text, selling_price numeric, is_active boolean, match_rank real)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_q TEXT := NULLIF(TRIM(COALESCE(p_q, '')), '');
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
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
  IF auth.uid() IS NOT NULL
     AND public.current_user_company_id() IS NOT NULL
     AND p_company_id IS DISTINCT FROM public.current_user_company_id() THEN
    RAISE EXCEPTION 'search_products: cross-tenant access denied'
      USING ERRCODE = '42501';
  END IF;
  -- ---- end Phase 65 -------------------------------------------------------
  RETURN QUERY
  SELECT
    p.id::UUID,
    p.sku::TEXT,
    p.name::TEXT,
    p.name_ar::TEXT,
    p.oe_number::TEXT,
    p.barcode::TEXT,
    p.brand_id::UUID,
    b.name::TEXT,
    p.category_id::UUID,
    c.name::TEXT,
    p.unit_id::UUID,
    u.code::TEXT,
    p.selling_price::NUMERIC,
    p.is_active::BOOLEAN,
    -- Rank:
    --   2.0 = exact barcode hit
    --   1.5 = exact SKU hit
    --   1.0 + similarity = trigram match on SKU/name/oe_number/replacement_numbers
    --   0.0 = no query (just list-all path)
    (CASE
      WHEN v_q IS NULL THEN 0::REAL
      WHEN p.barcode = v_q THEN 2.0::REAL
      WHEN LOWER(p.sku) = LOWER(v_q) THEN 1.5::REAL
      ELSE (1.0 + GREATEST(
        similarity(p.sku,                 v_q),
        similarity(p.name,                v_q),
        similarity(COALESCE(p.oe_number,''), v_q),
        similarity(COALESCE(public.flatten_replacement_numbers(p.replacement_numbers), ''), v_q)
      ))::REAL
    END)::REAL AS match_rank
  FROM public.products p
  LEFT JOIN public.brands               b ON b.id = p.brand_id
  LEFT JOIN public.categories           c ON c.id = p.category_id
  LEFT JOIN public.units_of_measure     u ON u.id = p.unit_id
  WHERE p.company_id = p_company_id
    AND (p_include_inactive OR p.is_active = TRUE)
    AND (p_brand_id    IS NULL OR p.brand_id    = p_brand_id)
    AND (p_category_id IS NULL OR p.category_id = p_category_id)
    AND (
      v_q IS NULL
      OR p.barcode = v_q
      OR p.sku       ILIKE '%' || v_q || '%'
      OR p.name      ILIKE '%' || v_q || '%'
      OR p.oe_number ILIKE '%' || v_q || '%'
      OR public.flatten_replacement_numbers(p.replacement_numbers) ILIKE '%' || v_q || '%'
    )
  ORDER BY 15 DESC, p.name ASC
  LIMIT v_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_bank_reconciliation(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM public.bank_reconciliations WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'delete_bank_reconciliation: % not found', p_id USING ERRCODE = 'P0002';
  END IF;
  IF v_status = 'locked' THEN
    RAISE EXCEPTION 'delete_bank_reconciliation: reconciliation % is locked', p_id
      USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.bank_reconciliations WHERE id = p_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.seed_default_tax_rates(uuid, text) TO authenticated;

COMMIT;
