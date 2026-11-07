-- global06: branch-level access enforcement (Global v1, Phase 6)
--
-- Decisions (Rashid, 2026-11-07):
--   B1 a branch-scoped document with no warehouse belongs to Head Office;
--      company-wide records (contacts, products, payments, expenses, bank,
--      vendor bills - B3) stay company-wide.
--   B2 a branch-restricted user cannot read the company-wide GL / journal
--      entries or the company-wide report functions.
--   B3 vendor bills are company-wide in v1 (explicitly: no branch policy on
--      vendor_bills / vendor_bill_items / landed costs), subject to the existing
--      purchasing/accounting permissions. Their STOCK still lands per warehouse
--      and stock_ledger is branch-checked.
--   B4 a company admin is never restricted; tenant isolation is untouched.
--
-- Explicit states: profiles.branch_access 'unrestricted' (default - every
-- existing and new user) or 'restricted'. A restricted user sees only the
-- warehouses of the branches in profile_branches (several allowed); zero
-- assignments = zero branch-scoped access. Enforcement is OFF per company
-- (companies.branch_restriction_enabled, default false) until production
-- activation is separately approved; while it is off every policy below is a
-- no-op, so this migration changes nothing anybody can see.
--
-- Enforced in PostgreSQL: RESTRICTIVE RLS on reads and writes, the posting
-- functions (ledger_writer, no RLS bypass) inherit it, and the postgres-owned
-- report functions refuse restricted callers. Only admins may change access
-- states, enforcement, or their own assignments.
--
-- Re-runnable. Rollback: supabase/manual-apply/global06_rollback.sql.

BEGIN;

ALTER TABLE public.profiles  ADD COLUMN IF NOT EXISTS branch_access text NOT NULL DEFAULT 'unrestricted';
ALTER TABLE public.profiles  DROP CONSTRAINT IF EXISTS profiles_branch_access_check;
ALTER TABLE public.profiles  ADD CONSTRAINT profiles_branch_access_check CHECK (branch_access IN ('unrestricted', 'restricted'));
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS branch_restriction_enabled boolean NOT NULL DEFAULT false;

-- Is the caller branch-restricted right now? (no session / service role: no)
CREATE OR REPLACE FUNCTION public._branch_restricted()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE((
    SELECT p.role IS DISTINCT FROM 'admin' AND p.branch_access = 'restricted' AND c.branch_restriction_enabled
      FROM public.profiles p JOIN public.companies c ON c.id = p.company_id
     WHERE p.id = auth.uid()), false);
$function$;

-- May the caller use this warehouse? NULL warehouse = the company's Head Office (B1).
CREATE OR REPLACE FUNCTION public._branch_allows_warehouse(p_warehouse_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
  SELECT NOT public._branch_restricted() OR EXISTS (
    SELECT 1 FROM public.profile_branches pb
     WHERE pb.profile_id = auth.uid()
       AND pb.branch_id = CASE
             WHEN p_warehouse_id IS NULL THEN
               (SELECT b.id FROM public.branches b JOIN public.profiles p ON p.company_id = b.company_id
                 WHERE p.id = auth.uid() AND b.is_default)
             ELSE (SELECT w.branch_id FROM public.warehouses w WHERE w.id = p_warehouse_id)
           END);
$function$;

CREATE OR REPLACE FUNCTION public._branch_require_unrestricted()
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
BEGIN
  IF public._branch_restricted() THEN
    RAISE EXCEPTION 'forbidden: company-wide financial data is not available to branch-restricted users'
      USING ERRCODE = '42501';
  END IF;
END;
$function$;

-- Read-only answers about the caller; policies evaluate them for every role
-- that can reach these tables, so they stay executable by authenticated.
REVOKE EXECUTE ON FUNCTION public._branch_restricted() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._branch_allows_warehouse(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._branch_require_unrestricted() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._branch_restricted() TO authenticated;
GRANT EXECUTE ON FUNCTION public._branch_allows_warehouse(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public._branch_require_unrestricted() TO authenticated;

-- Only an admin may change who is restricted, switch enforcement, or change
-- their own branch assignments (so a restricted user with users.manage cannot
-- widen their own access). No session (service role / SQL editor) is allowed.
CREATE OR REPLACE FUNCTION public.tg_guard_branch_access()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT role = 'admin' INTO v_admin FROM public.profiles WHERE id = auth.uid();
  IF COALESCE(v_admin, false) THEN RETURN COALESCE(NEW, OLD); END IF;

  -- One branch per table: PL/pgSQL resolves NEW.<field> even inside an AND,
  -- so a field may only be named where that table has it.
  IF TG_TABLE_NAME = 'profiles' THEN
    IF NEW.branch_access IS DISTINCT FROM OLD.branch_access THEN
      RAISE EXCEPTION 'forbidden: only an admin can change branch access' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'companies' THEN
    IF NEW.branch_restriction_enabled IS DISTINCT FROM OLD.branch_restriction_enabled THEN
      RAISE EXCEPTION 'forbidden: only an admin can switch branch restriction' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'profile_branches' THEN
    IF (TG_OP <> 'INSERT' AND OLD.profile_id = auth.uid()) OR (TG_OP <> 'DELETE' AND NEW.profile_id = auth.uid()) THEN
      RAISE EXCEPTION 'forbidden: only an admin can change their own branch assignments' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;
REVOKE ALL ON FUNCTION public.tg_guard_branch_access() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_guard_branch_access ON public.profiles;
CREATE TRIGGER profiles_guard_branch_access BEFORE UPDATE OF branch_access ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_branch_access();
DROP TRIGGER IF EXISTS companies_guard_branch_restriction ON public.companies;
CREATE TRIGGER companies_guard_branch_restriction BEFORE UPDATE OF branch_restriction_enabled ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_branch_access();
DROP TRIGGER IF EXISTS profile_branches_guard_self ON public.profile_branches;
CREATE TRIGGER profile_branches_guard_self BEFORE INSERT OR UPDATE OR DELETE ON public.profile_branches
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_branch_access();

-- B3: explicit - vendor bills are company-wide in v1 (no branch_scope policy).
COMMENT ON TABLE public.vendor_bills IS 'Company-wide in v1 (global06 B3): no branch scope; stock still checked per warehouse on stock_ledger.';

DROP POLICY IF EXISTS branch_scope ON public.invoices;
CREATE POLICY branch_scope ON public.invoices AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(warehouse_id))
  WITH CHECK ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(warehouse_id));

DROP POLICY IF EXISTS branch_scope ON public.credit_notes;
CREATE POLICY branch_scope ON public.credit_notes AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(warehouse_id))
  WITH CHECK ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(warehouse_id));

DROP POLICY IF EXISTS branch_scope ON public.debit_notes;
CREATE POLICY branch_scope ON public.debit_notes AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(warehouse_id))
  WITH CHECK ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(warehouse_id));

DROP POLICY IF EXISTS branch_scope ON public.goods_receipts;
CREATE POLICY branch_scope ON public.goods_receipts AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(warehouse_id))
  WITH CHECK ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(warehouse_id));

DROP POLICY IF EXISTS branch_scope ON public.inventory_adjustments;
CREATE POLICY branch_scope ON public.inventory_adjustments AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(warehouse_id))
  WITH CHECK ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(warehouse_id));

DROP POLICY IF EXISTS branch_scope ON public.pos_sessions;
CREATE POLICY branch_scope ON public.pos_sessions AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(warehouse_id))
  WITH CHECK ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(warehouse_id));

DROP POLICY IF EXISTS branch_scope ON public.purchase_orders;
CREATE POLICY branch_scope ON public.purchase_orders AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(warehouse_id))
  WITH CHECK ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(warehouse_id));

DROP POLICY IF EXISTS branch_scope ON public.purchase_returns;
CREATE POLICY branch_scope ON public.purchase_returns AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(warehouse_id))
  WITH CHECK ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(warehouse_id));

DROP POLICY IF EXISTS branch_scope ON public.sales_orders;
CREATE POLICY branch_scope ON public.sales_orders AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(warehouse_id))
  WITH CHECK ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(warehouse_id));

DROP POLICY IF EXISTS branch_scope ON public.sales_returns;
CREATE POLICY branch_scope ON public.sales_returns AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(warehouse_id))
  WITH CHECK ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(warehouse_id));

DROP POLICY IF EXISTS branch_scope ON public.stock_ledger;
CREATE POLICY branch_scope ON public.stock_ledger AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(warehouse_id))
  WITH CHECK ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(warehouse_id));

DROP POLICY IF EXISTS branch_scope ON public.product_serials;
CREATE POLICY branch_scope ON public.product_serials AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(warehouse_id))
  WITH CHECK ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(warehouse_id));

DROP POLICY IF EXISTS branch_scope ON public.deferred_cogs_queue;
CREATE POLICY branch_scope ON public.deferred_cogs_queue AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(warehouse_id))
  WITH CHECK ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(warehouse_id));

DROP POLICY IF EXISTS branch_scope ON public.warehouses;
CREATE POLICY branch_scope ON public.warehouses AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(id))
  WITH CHECK ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(id));
-- A transfer is visible to either side; either side may record it. The stock
-- movements themselves are checked per warehouse on stock_ledger.
DROP POLICY IF EXISTS branch_scope ON public.stock_transfers;
CREATE POLICY branch_scope ON public.stock_transfers AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(from_warehouse_id) OR public._branch_allows_warehouse(to_warehouse_id))
  WITH CHECK ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(from_warehouse_id) OR public._branch_allows_warehouse(to_warehouse_id));

DROP POLICY IF EXISTS branch_scope ON public.invoice_items;
CREATE POLICY branch_scope ON public.invoice_items AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public._branch_restricted()) = false OR EXISTS (SELECT 1 FROM public.invoices d WHERE d.id = invoice_items.invoice_id))
  WITH CHECK ((SELECT public._branch_restricted()) = false OR EXISTS (SELECT 1 FROM public.invoices d WHERE d.id = invoice_items.invoice_id));

DROP POLICY IF EXISTS branch_scope ON public.credit_note_items;
CREATE POLICY branch_scope ON public.credit_note_items AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public._branch_restricted()) = false OR EXISTS (SELECT 1 FROM public.credit_notes d WHERE d.id = credit_note_items.credit_note_id))
  WITH CHECK ((SELECT public._branch_restricted()) = false OR EXISTS (SELECT 1 FROM public.credit_notes d WHERE d.id = credit_note_items.credit_note_id));

DROP POLICY IF EXISTS branch_scope ON public.debit_note_items;
CREATE POLICY branch_scope ON public.debit_note_items AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public._branch_restricted()) = false OR EXISTS (SELECT 1 FROM public.debit_notes d WHERE d.id = debit_note_items.debit_note_id))
  WITH CHECK ((SELECT public._branch_restricted()) = false OR EXISTS (SELECT 1 FROM public.debit_notes d WHERE d.id = debit_note_items.debit_note_id));

DROP POLICY IF EXISTS branch_scope ON public.goods_receipt_items;
CREATE POLICY branch_scope ON public.goods_receipt_items AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public._branch_restricted()) = false OR EXISTS (SELECT 1 FROM public.goods_receipts d WHERE d.id = goods_receipt_items.grn_id))
  WITH CHECK ((SELECT public._branch_restricted()) = false OR EXISTS (SELECT 1 FROM public.goods_receipts d WHERE d.id = goods_receipt_items.grn_id));

DROP POLICY IF EXISTS branch_scope ON public.inventory_adjustment_items;
CREATE POLICY branch_scope ON public.inventory_adjustment_items AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public._branch_restricted()) = false OR EXISTS (SELECT 1 FROM public.inventory_adjustments d WHERE d.id = inventory_adjustment_items.adjustment_id))
  WITH CHECK ((SELECT public._branch_restricted()) = false OR EXISTS (SELECT 1 FROM public.inventory_adjustments d WHERE d.id = inventory_adjustment_items.adjustment_id));

DROP POLICY IF EXISTS branch_scope ON public.purchase_order_items;
CREATE POLICY branch_scope ON public.purchase_order_items AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public._branch_restricted()) = false OR EXISTS (SELECT 1 FROM public.purchase_orders d WHERE d.id = purchase_order_items.po_id))
  WITH CHECK ((SELECT public._branch_restricted()) = false OR EXISTS (SELECT 1 FROM public.purchase_orders d WHERE d.id = purchase_order_items.po_id));

DROP POLICY IF EXISTS branch_scope ON public.purchase_return_items;
CREATE POLICY branch_scope ON public.purchase_return_items AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public._branch_restricted()) = false OR EXISTS (SELECT 1 FROM public.purchase_returns d WHERE d.id = purchase_return_items.purchase_return_id))
  WITH CHECK ((SELECT public._branch_restricted()) = false OR EXISTS (SELECT 1 FROM public.purchase_returns d WHERE d.id = purchase_return_items.purchase_return_id));

DROP POLICY IF EXISTS branch_scope ON public.sales_order_items;
CREATE POLICY branch_scope ON public.sales_order_items AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public._branch_restricted()) = false OR EXISTS (SELECT 1 FROM public.sales_orders d WHERE d.id = sales_order_items.order_id))
  WITH CHECK ((SELECT public._branch_restricted()) = false OR EXISTS (SELECT 1 FROM public.sales_orders d WHERE d.id = sales_order_items.order_id));

DROP POLICY IF EXISTS branch_scope ON public.sales_return_items;
CREATE POLICY branch_scope ON public.sales_return_items AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public._branch_restricted()) = false OR EXISTS (SELECT 1 FROM public.sales_returns d WHERE d.id = sales_return_items.sales_return_id))
  WITH CHECK ((SELECT public._branch_restricted()) = false OR EXISTS (SELECT 1 FROM public.sales_returns d WHERE d.id = sales_return_items.sales_return_id));

DROP POLICY IF EXISTS branch_scope ON public.stock_transfer_items;
CREATE POLICY branch_scope ON public.stock_transfer_items AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public._branch_restricted()) = false OR EXISTS (SELECT 1 FROM public.stock_transfers d WHERE d.id = stock_transfer_items.transfer_id))
  WITH CHECK ((SELECT public._branch_restricted()) = false OR EXISTS (SELECT 1 FROM public.stock_transfers d WHERE d.id = stock_transfer_items.transfer_id));

DROP POLICY IF EXISTS branch_scope ON public.e_invoice_documents;
CREATE POLICY branch_scope ON public.e_invoice_documents AS RESTRICTIVE FOR ALL TO authenticated
  USING      ((SELECT public._branch_restricted()) = false OR EXISTS (SELECT 1 FROM public.invoices d WHERE d.id = e_invoice_documents.invoice_id))
  WITH CHECK ((SELECT public._branch_restricted()) = false OR EXISTS (SELECT 1 FROM public.invoices d WHERE d.id = e_invoice_documents.invoice_id));

DROP POLICY IF EXISTS branch_scope_read ON public.general_ledger;
CREATE POLICY branch_scope_read ON public.general_ledger AS RESTRICTIVE FOR SELECT TO authenticated
  USING (current_user = 'ledger_writer' OR (SELECT public._branch_restricted()) = false);

DROP POLICY IF EXISTS branch_scope_read ON public.journal_entries;
CREATE POLICY branch_scope_read ON public.journal_entries AS RESTRICTIVE FOR SELECT TO authenticated
  USING (current_user = 'ledger_writer' OR (SELECT public._branch_restricted()) = false);

-- B2: the postgres-owned functions that read company-wide ledger data.

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
  -- global06 (B2): company-wide ledger/report data is not for branch-restricted users.
  PERFORM public._branch_require_unrestricted();
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
  -- global06 (B2): company-wide ledger/report data is not for branch-restricted users.
  PERFORM public._branch_require_unrestricted();
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
  -- global06 (B2): company-wide ledger/report data is not for branch-restricted users.
  PERFORM public._branch_require_unrestricted();

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
  -- global06 (B2): company-wide ledger/report data is not for branch-restricted users.
  PERFORM public._branch_require_unrestricted();

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
  -- global06 (B2): company-wide ledger/report data is not for branch-restricted users.
  PERFORM public._branch_require_unrestricted();
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
  -- global06 (B2): company-wide ledger/report data is not for branch-restricted users.
  PERFORM public._branch_require_unrestricted();

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

COMMIT;
