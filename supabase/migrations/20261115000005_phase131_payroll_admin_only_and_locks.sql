-- ═══════════════════════════════════════════════════════════════════════════
-- phase131 — payroll: admin-only, period lock, posted runs locked, Void
--
-- 1. ADMIN ONLY. Payroll holds salaries and bank details. has_perm() and
--    my_permissions() now refuse every payroll.* permission to anyone but an
--    admin — a role grant or a per-user override can no longer open it. Every
--    payroll table's RLS and every payroll function already goes through
--    has_perm('payroll.*'), so this one rule closes all of them.
--
-- 2. employee_loans gets the same payroll.read / payroll.write policies as the
--    other payroll tables (it only had the company filter).
--
-- 3. PERIOD LOCK. confirm_payroll_run, pay_payroll_run, settle_gratuity and
--    pay_leave_salary write their journal entries directly, so none checked
--    the period lock. A trigger now refuses any payroll-sourced journal entry
--    (payroll_run, gratuity_settlement, leave_salary) dated on or before the
--    company's lock date — including reversals, which post at voucher date.
--
-- 4. POSTED RUNS ARE LOCKED. Only the screen stopped a confirmed or paid run
--    from being edited, deleted or set back to draft; a direct API call could
--    reset a run and confirm it again (salaries posted twice). Now only the
--    payroll posting functions (running as ledger_writer) may change a run
--    once it leaves draft; its lines are frozen with it. Paid leave-salary
--    rows likewise.
--
-- 5. void_payroll_run(run, reason). Reverses the payment entry (if paid) and
--    the accrual entry through reverse_journal_entry() — at their own voucher
--    dates — and marks the run 'void'. Lines and history stay.
--
-- PRE-CHECK on prod (CR-stripped md5), expected:
--   has_perm        4e2840cdf79d8eb2fb2dab3fd835b4f7
--   my_permissions  80ca21a16bef94a058fbdce673533020
--   confirm_payroll_run owner = ledger_writer
--   SELECT md5(replace(pg_get_functiondef('public.has_perm(text)'::regprocedure), chr(13), '')),
--          md5(replace(pg_get_functiondef('public.my_permissions()'::regprocedure), chr(13), '')),
--          (SELECT proowner::regrole::text FROM pg_proc WHERE proname = 'confirm_payroll_run');
-- If any differs, STOP and send the result.
--
-- SAFE TO APPLY: two functions patched (one added line each), new triggers,
-- new policies, one new function. One transaction; re-running is safe.
-- ROLLBACK: see the end of this file.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Payroll is admin-only ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_perm(p_permission text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_role TEXT; v_active BOOLEAN; v_company UUID; v_ovr TEXT;
BEGIN
  SELECT role, is_active, company_id INTO v_role, v_active, v_company
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active IS NOT TRUE THEN RETURN FALSE; END IF;
  IF v_role = 'admin' THEN RETURN TRUE; END IF;
  -- phase131: payroll is confidential (salaries, bank details) — admin only.
  -- Neither a role grant nor a per-user override can open it.
  IF p_permission LIKE 'payroll.%' THEN RETURN FALSE; END IF;

  SELECT mode INTO v_ovr FROM public.user_permission_overrides
   WHERE user_id = auth.uid() AND permission = p_permission;
  IF v_ovr = 'deny'  THEN RETURN FALSE; END IF;
  IF v_ovr = 'allow' THEN RETURN TRUE;  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.role_permissions
     WHERE role = v_role AND permission = p_permission
       AND (company_id IS NULL OR company_id = v_company)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.my_permissions()
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_role TEXT; v_active BOOLEAN; v_company UUID; v_perms TEXT[];
BEGIN
  SELECT role, is_active, company_id INTO v_role, v_active, v_company
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active IS NOT TRUE THEN RETURN ARRAY[]::TEXT[]; END IF;
  IF v_role = 'admin' THEN
    RETURN ARRAY['sales.read','sales.write','purchasing.read','purchasing.write',
                 'inventory.read','inventory.write','accounting.read','accounting.write',
                 'payroll.read','payroll.write','reports.read','settings.read',
                 'settings.write','users.manage'];
  END IF;
  SELECT ARRAY(
    SELECT p FROM (
      SELECT permission AS p FROM public.role_permissions
        WHERE role = v_role AND (company_id IS NULL OR company_id = v_company)
      UNION
      SELECT permission FROM public.user_permission_overrides
        WHERE user_id = auth.uid() AND mode = 'allow'
    ) u
    WHERE p NOT IN (
      SELECT permission FROM public.user_permission_overrides
       WHERE user_id = auth.uid() AND mode = 'deny'
    )
  ) INTO v_perms;
  -- phase131: payroll is admin-only (matches has_perm).
  v_perms := ARRAY(SELECT x FROM unnest(v_perms) x WHERE x NOT LIKE 'payroll.%');
  RETURN v_perms;
END;
$function$;

-- ── 2. employee_loans behind payroll permission ───────────────────────────
DROP POLICY IF EXISTS rbac_r_sel_employee_loans ON public.employee_loans;
DROP POLICY IF EXISTS rbac_w_ins_employee_loans ON public.employee_loans;
DROP POLICY IF EXISTS rbac_w_upd_employee_loans ON public.employee_loans;
DROP POLICY IF EXISTS rbac_w_del_employee_loans ON public.employee_loans;
CREATE POLICY rbac_r_sel_employee_loans ON public.employee_loans AS RESTRICTIVE FOR SELECT
  USING (public.has_perm('payroll.read'));
CREATE POLICY rbac_w_ins_employee_loans ON public.employee_loans AS RESTRICTIVE FOR INSERT
  WITH CHECK (public.has_perm('payroll.write'));
CREATE POLICY rbac_w_upd_employee_loans ON public.employee_loans AS RESTRICTIVE FOR UPDATE
  USING (public.has_perm('payroll.write')) WITH CHECK (public.has_perm('payroll.write'));
CREATE POLICY rbac_w_del_employee_loans ON public.employee_loans AS RESTRICTIVE FOR DELETE
  USING (public.has_perm('payroll.write'));

-- ── 3. Period lock on payroll journal entries ─────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_payroll_period_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_lock date;
BEGIN
  IF NEW.source_type IN ('payroll_run', 'gratuity_settlement', 'leave_salary') THEN
    SELECT period_lock_date INTO v_lock FROM public.companies WHERE id = NEW.company_id;
    IF v_lock IS NOT NULL AND NEW.date <= v_lock THEN
      RAISE EXCEPTION 'Period is locked up to %. Payroll cannot post on %. Unlock the period (Accounting → Period Lock) first.',
        v_lock, NEW.date USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS journal_entries_payroll_period_lock ON public.journal_entries;
CREATE TRIGGER journal_entries_payroll_period_lock
  BEFORE INSERT ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_payroll_period_lock();

-- ── 4. Posted runs are locked against direct edits ────────────────────────
-- The payroll functions run as ledger_writer (phase119); a client runs as
-- authenticated. postgres stays allowed for maintenance.
CREATE OR REPLACE FUNCTION public.tg_payroll_run_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('ledger_writer', 'postgres', 'supabase_admin') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'A % payroll run cannot be deleted. Void it instead.', OLD.status USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'A % payroll run cannot be changed. Void it instead.', OLD.status USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id
     OR NEW.payment_journal_entry_id IS DISTINCT FROM OLD.payment_journal_entry_id THEN
    RAISE EXCEPTION 'Use Confirm, Pay or Void to change a payroll run''s status.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS payroll_runs_lock ON public.payroll_runs;
CREATE TRIGGER payroll_runs_lock
  BEFORE UPDATE OR DELETE ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.tg_payroll_run_lock();

CREATE OR REPLACE FUNCTION public.tg_payroll_item_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM public.payroll_runs WHERE id = COALESCE(NEW.run_id, OLD.run_id);
  -- Deleting a draft run cascades to its lines: the run row may already be gone.
  IF v_status IS NOT NULL AND v_status <> 'draft' THEN
    RAISE EXCEPTION 'The lines of a % payroll run cannot be changed.', v_status USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS payroll_run_items_lock ON public.payroll_run_items;
CREATE TRIGGER payroll_run_items_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_run_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_payroll_item_lock();

CREATE OR REPLACE FUNCTION public.tg_leave_salary_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('ledger_writer', 'postgres', 'supabase_admin') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'A % leave salary payment cannot be changed or deleted.', OLD.status USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.status IS DISTINCT FROM OLD.status
                           OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id) THEN
    RAISE EXCEPTION 'Use Pay to post a leave salary payment.' USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS leave_salary_payments_lock ON public.leave_salary_payments;
CREATE TRIGGER leave_salary_payments_lock
  BEFORE UPDATE OR DELETE ON public.leave_salary_payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_leave_salary_lock();

-- ── 5. Void a confirmed or paid run ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.void_payroll_run(p_run_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid := public.current_user_company_id();
  v_run     public.payroll_runs%ROWTYPE;
  v_pay_rev jsonb;
  v_acc_rev jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.auth_require('payroll.write');
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'A reason is required to void a payroll run.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_run FROM public.payroll_runs
   WHERE id = p_run_id AND company_id = v_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run not found.' USING ERRCODE = 'P0001'; END IF;
  IF v_run.status NOT IN ('confirmed', 'paid') THEN
    RAISE EXCEPTION 'Only a confirmed or paid run can be voided (status: %).', v_run.status USING ERRCODE = 'P0001';
  END IF;

  -- Payment first, then the accrual: each at its own voucher date.
  IF v_run.payment_journal_entry_id IS NOT NULL THEN
    v_pay_rev := public.reverse_journal_entry(v_run.payment_journal_entry_id,
                   'Void ' || v_run.run_number || ' — salary payment: ' || btrim(p_reason));
  END IF;
  IF v_run.journal_entry_id IS NOT NULL THEN
    v_acc_rev := public.reverse_journal_entry(v_run.journal_entry_id,
                   'Void ' || v_run.run_number || ': ' || btrim(p_reason));
  END IF;

  UPDATE public.payroll_runs
     SET status = 'void',
         notes = concat_ws(E'\n', NULLIF(notes, ''), 'Voided: ' || btrim(p_reason)),
         updated_at = now()
   WHERE id = v_run.id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, old_data, new_data)
    VALUES (v_company, auth.uid(), 'void', 'payroll_run', v_run.id,
            jsonb_build_object('status', v_run.status, 'net', v_run.total_net),
            jsonb_build_object('reason', btrim(p_reason), 'phase', 'phase131'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('run_id', v_run.id, 'status', 'void',
                            'payment_reversal', v_pay_rev->>'journal_entry_id',
                            'accrual_reversal', v_acc_rev->>'journal_entry_id');
END;
$function$;

-- ledger_writer may own functions only while it briefly holds CREATE (phase119).
GRANT CREATE ON SCHEMA public TO ledger_writer;
ALTER FUNCTION public.void_payroll_run(uuid, text) OWNER TO ledger_writer;
REVOKE CREATE ON SCHEMA public FROM ledger_writer;
REVOKE ALL ON FUNCTION public.void_payroll_run(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_payroll_run(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.tg_payroll_period_lock() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_payroll_run_lock()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_payroll_item_lock()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_leave_salary_lock()   FROM PUBLIC, anon, authenticated;

COMMIT;

-- ── Verify after applying (read-only) — expect all true ───────────────────
-- SELECT
--   pg_get_functiondef('public.has_perm(text)'::regprocedure) LIKE '%payroll.%%RETURN FALSE%' AS admin_only,
--   (SELECT count(*) FROM pg_policies WHERE tablename = 'employee_loans' AND policyname LIKE 'rbac_%') = 4 AS loan_policies,
--   (SELECT count(*) FROM pg_trigger WHERE tgname IN ('journal_entries_payroll_period_lock','payroll_runs_lock',
--          'payroll_run_items_lock','leave_salary_payments_lock')) = 4 AS triggers,
--   (SELECT proowner::regrole::text FROM pg_proc WHERE proname = 'void_payroll_run') = 'ledger_writer' AS void_owner;
--
-- ROLLBACK:
--   re-create has_perm / my_permissions without the phase131 lines;
--   DROP FUNCTION public.void_payroll_run(uuid, text);
--   DROP TRIGGER leave_salary_payments_lock ON public.leave_salary_payments;
--   DROP TRIGGER payroll_run_items_lock ON public.payroll_run_items;
--   DROP TRIGGER payroll_runs_lock ON public.payroll_runs;
--   DROP TRIGGER journal_entries_payroll_period_lock ON public.journal_entries;
--   DROP FUNCTION public.tg_leave_salary_lock(), public.tg_payroll_item_lock(),
--                 public.tg_payroll_run_lock(), public.tg_payroll_period_lock();
--   DROP POLICY rbac_r_sel_employee_loans, rbac_w_ins_employee_loans,
--               rbac_w_upd_employee_loans, rbac_w_del_employee_loans ON public.employee_loans;
