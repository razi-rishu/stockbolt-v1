-- ═══════════════════════════════════════════════════════════════════════════
-- phase165 — Leave engine (HRMS phase H2, part 1: database).
-- ═══════════════════════════════════════════════════════════════════════════
-- Configuration (HR, payroll.write): hr_settings (weekend days, leave year,
-- approval chain), holidays, leave_types, leave_policies (scoped by country,
-- branch, employment type, department; most specific active policy wins),
-- branches.manager_employee_id (the branch approver).
--
-- Balances are NEVER stored (AGENTS Rule 1). leave_ledger is append-only:
-- opening, accrual, adjustment, taken, reversal, expiry, encashment.
-- Balance = sum of ledger rows up to a date. Accruals and carry-forward
-- expiries are posted by _leave_accrue, idempotent per period (unique key).
--
-- Requests: submit → approve / reject / return / delegate per step of the
-- chain (manager → branch manager → HR, configurable) → final approval posts
-- one "taken" row; cancelling approved leave posts one "reversal" row. Every
-- action is a leave_request_steps row. All writes go through the functions
-- below; the tables are read-only for the app (payroll.read).
--
-- Country rules are policy rows, not code. install_leave_template('ae_mainland')
-- inserts UAE values INACTIVE and marked needs_verification (decision D1).
--
-- No posting to the books: payroll use of leave is H3 (decision D2).
-- Additive only. SAFE TO RE-RUN.
-- UNDO: drop the functions, then leave_ledger, leave_request_steps,
--       leave_requests, leave_policies, leave_types, holidays, hr_settings;
--       ALTER TABLE branches DROP COLUMN manager_employee_id;
--       employee_documents: drop column leave_request_id (doc types widened only).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── 1. Settings, holidays, branch approver ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hr_settings (
  company_id             uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  weekend_days           smallint[] NOT NULL DEFAULT '{0,6}',   -- 0 Sunday … 6 Saturday
  leave_year_start_month smallint NOT NULL DEFAULT 1 CHECK (leave_year_start_month BETWEEN 1 AND 12),
  approval_chain         text[] NOT NULL DEFAULT '{manager,hr}'
                         CHECK (approval_chain <@ ARRAY['manager', 'branch_manager', 'hr']::text[]
                                AND cardinality(approval_chain) BETWEEN 1 AND 3),
  escalate_after_days    int NOT NULL DEFAULT 3 CHECK (escalate_after_days BETWEEN 0 AND 60),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_settings_weekend_check CHECK (weekend_days <@ ARRAY[0,1,2,3,4,5,6]::smallint[] AND cardinality(weekend_days) <= 3)
);

CREATE TABLE IF NOT EXISTS public.holidays (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id  uuid REFERENCES public.branches(id) ON DELETE CASCADE,   -- NULL = whole company
  date       date NOT NULL,
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  name_ar    text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS holidays_unique ON public.holidays (company_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), date);

ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS manager_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS branches_manager_employee_idx ON public.branches (manager_employee_id);

-- ── 2. Leave types and policies ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leave_types (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code                 text NOT NULL CHECK (code ~ '^[a-z0-9_]{2,30}$'),
  name                 text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  name_ar              text,
  pay_kind             text NOT NULL DEFAULT 'paid' CHECK (pay_kind IN ('paid', 'unpaid', 'partly_paid')),
  needs_balance        boolean NOT NULL DEFAULT true,    -- false: not limited by a balance (unpaid, compassionate…)
  requires_document    boolean NOT NULL DEFAULT false,
  allow_half_day       boolean NOT NULL DEFAULT true,
  max_days_per_request numeric(6,2) CHECK (max_days_per_request IS NULL OR max_days_per_request > 0),
  gender_only          text CHECK (gender_only IS NULL OR gender_only IN ('male', 'female')),
  color                text,
  is_active            boolean NOT NULL DEFAULT true,
  sort_order           int NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS public.leave_policies (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                 uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  leave_type_id              uuid NOT NULL REFERENCES public.leave_types(id) ON DELETE CASCADE,
  name                       text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  -- Scope: NULL = any. The most specific active match wins.
  country_code               text,
  branch_id                  uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  employment_type            text,
  department                 text,
  -- Entitlement
  accrual                    text NOT NULL DEFAULT 'annual' CHECK (accrual IN ('annual', 'monthly', 'none')),
  entitlement_days           numeric(6,2) NOT NULL DEFAULT 0 CHECK (entitlement_days >= 0),
  service_bands              jsonb,      -- monthly: [{"from_month":0,"days":2},{"from_month":12,"days":2.5}]
  min_service_months         int NOT NULL DEFAULT 0 CHECK (min_service_months BETWEEN 0 AND 600),
  probation_allowed          boolean NOT NULL DEFAULT true,
  carry_forward_max          numeric(6,2) CHECK (carry_forward_max IS NULL OR carry_forward_max >= 0), -- NULL = no limit
  carry_forward_expiry_months int CHECK (carry_forward_expiry_months IS NULL OR carry_forward_expiry_months BETWEEN 1 AND 36),
  max_balance                numeric(6,2) CHECK (max_balance IS NULL OR max_balance >= 0),
  allow_negative             boolean NOT NULL DEFAULT false,
  negative_limit             numeric(6,2) NOT NULL DEFAULT 0 CHECK (negative_limit >= 0),
  count_weekends             boolean NOT NULL DEFAULT false,
  count_holidays             boolean NOT NULL DEFAULT false,
  pay_bands                  jsonb,      -- [{"days":15,"pay_pct":100},…] read by payroll (H3)
  document_after_days        numeric(6,2), -- a document is needed above this many days
  needs_verification         boolean NOT NULL DEFAULT false,
  source_note                text,
  is_active                  boolean NOT NULL DEFAULT true,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_policies_bands_check CHECK (service_bands IS NULL OR jsonb_typeof(service_bands) = 'array'),
  CONSTRAINT leave_policies_pay_check CHECK (pay_bands IS NULL OR jsonb_typeof(pay_bands) = 'array')
);
CREATE INDEX IF NOT EXISTS leave_policies_type_idx ON public.leave_policies (leave_type_id);
CREATE INDEX IF NOT EXISTS leave_policies_company_idx ON public.leave_policies (company_id);

-- ── 3. Requests, steps, ledger ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leave_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  leave_type_id uuid NOT NULL REFERENCES public.leave_types(id) ON DELETE RESTRICT,
  policy_id     uuid REFERENCES public.leave_policies(id) ON DELETE SET NULL,
  date_from     date NOT NULL,
  date_to       date NOT NULL,
  half_day      text NOT NULL DEFAULT 'none' CHECK (half_day IN ('none', 'first', 'second')),
  days          numeric(6,2) NOT NULL CHECK (days > 0),
  reason        text CHECK (reason IS NULL OR length(reason) <= 1000),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'returned', 'cancelled')),
  current_step  int NOT NULL DEFAULT 1,
  chain         jsonb NOT NULL,
  submitted_by  uuid DEFAULT auth.uid(),
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_requests_dates_check CHECK (date_to >= date_from),
  CONSTRAINT leave_requests_half_check CHECK (half_day = 'none' OR date_from = date_to)
);
CREATE INDEX IF NOT EXISTS leave_requests_employee_idx ON public.leave_requests (employee_id, date_from);
CREATE INDEX IF NOT EXISTS leave_requests_company_idx ON public.leave_requests (company_id, status, date_from);
CREATE INDEX IF NOT EXISTS leave_requests_type_idx ON public.leave_requests (leave_type_id);

CREATE TABLE IF NOT EXISTS public.leave_request_steps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  request_id  uuid NOT NULL REFERENCES public.leave_requests(id) ON DELETE CASCADE,
  step_no     int NOT NULL,
  kind        text,
  action      text NOT NULL CHECK (action IN ('submitted', 'approved', 'rejected', 'returned', 'delegated',
                                              'cancelled', 'resubmitted', 'recorded')),
  by_user     uuid DEFAULT auth.uid(),
  by_employee uuid,
  to_employee uuid,
  note        text CHECK (note IS NULL OR length(note) <= 1000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leave_request_steps_request_idx ON public.leave_request_steps (request_id, created_at);

CREATE TABLE IF NOT EXISTS public.leave_ledger (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  leave_type_id uuid NOT NULL REFERENCES public.leave_types(id) ON DELETE RESTRICT,
  entry_date    date NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('opening', 'accrual', 'adjustment', 'taken', 'reversal', 'expiry', 'encashment')),
  days          numeric(8,3) NOT NULL,
  period        text,          -- accrual / expiry idempotency key (Y2026, M7, C2027, X2027)
  request_id    uuid REFERENCES public.leave_requests(id) ON DELETE RESTRICT,
  note          text CHECK (note IS NULL OR length(note) <= 500),
  by_user       uuid DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_ledger_sign_check CHECK (
    (kind IN ('accrual', 'reversal') AND days >= 0) OR
    (kind IN ('taken', 'expiry', 'encashment') AND days <= 0) OR
    (kind IN ('opening', 'adjustment') AND days <> 0))
);
CREATE INDEX IF NOT EXISTS leave_ledger_balance_idx ON public.leave_ledger (employee_id, leave_type_id, entry_date);
CREATE INDEX IF NOT EXISTS leave_ledger_company_idx ON public.leave_ledger (company_id);
CREATE UNIQUE INDEX IF NOT EXISTS leave_ledger_period_unique ON public.leave_ledger (employee_id, leave_type_id, kind, period) WHERE period IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS leave_ledger_request_unique ON public.leave_ledger (request_id, kind) WHERE request_id IS NOT NULL;

-- Supporting documents for a request (same private bucket and rights as phase163).
ALTER TABLE public.employee_documents ADD COLUMN IF NOT EXISTS leave_request_id uuid REFERENCES public.leave_requests(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS employee_documents_leave_idx ON public.employee_documents (leave_request_id);
DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_documents_doc_type_check'
                   AND pg_get_constraintdef(oid) LIKE '%medical%') THEN
    ALTER TABLE public.employee_documents DROP CONSTRAINT IF EXISTS employee_documents_doc_type_check;
    ALTER TABLE public.employee_documents ADD CONSTRAINT employee_documents_doc_type_check
      CHECK (doc_type IN ('emirates_id', 'passport', 'visa', 'labour_card', 'contract', 'other', 'medical', 'leave'));
  END IF;
END
$c$;

-- ── 4. RLS: config readable and writable by payroll users; requests, steps
--       and ledger readable only (writes through the functions) ────────────
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hr_settings', 'holidays', 'leave_types', 'leave_policies', 'leave_requests', 'leave_request_steps', 'leave_ledger'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS hr_read ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS hr_insert ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS hr_update ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS hr_delete ON public.%I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON public.%I FOR ALL USING (company_id = public.current_user_company_id()) WITH CHECK (company_id = public.current_user_company_id())', t);
    EXECUTE format('CREATE POLICY hr_read ON public.%I AS RESTRICTIVE FOR SELECT USING (public.has_perm(''payroll.read''))', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    IF t IN ('hr_settings', 'holidays', 'leave_types', 'leave_policies') THEN
      EXECUTE format('CREATE POLICY hr_insert ON public.%I AS RESTRICTIVE FOR INSERT WITH CHECK (public.has_perm(''payroll.write''))', t);
      EXECUTE format('CREATE POLICY hr_update ON public.%I AS RESTRICTIVE FOR UPDATE USING (public.has_perm(''payroll.write'')) WITH CHECK (public.has_perm(''payroll.write''))', t);
      EXECUTE format('CREATE POLICY hr_delete ON public.%I AS RESTRICTIVE FOR DELETE USING (public.has_perm(''payroll.write''))', t);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    ELSE
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM authenticated', t);
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    END IF;
  END LOOP;
END
$rls$;

-- ── 5. Helpers ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._leave_guard()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE v uuid := public.current_user_company_id();
BEGIN
  IF auth.uid() IS NULL OR v IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  RETURN v;
END; $fn$;

CREATE OR REPLACE FUNCTION public._leave_weekend(p_company uuid)
RETURNS smallint[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
  SELECT COALESCE(
    (SELECT weekend_days FROM public.hr_settings WHERE company_id = p_company),
    CASE (SELECT country_code FROM public.companies WHERE id = p_company)
      WHEN 'IN' THEN '{0}'::smallint[]
      WHEN 'SA' THEN '{5,6}'::smallint[] WHEN 'KW' THEN '{5,6}'::smallint[] WHEN 'BH' THEN '{5,6}'::smallint[]
      WHEN 'OM' THEN '{5,6}'::smallint[] WHEN 'QA' THEN '{5,6}'::smallint[]
      ELSE '{0,6}'::smallint[] END);
$fn$;

CREATE OR REPLACE FUNCTION public._leave_year_start(p_company uuid, p_date date)
RETURNS date LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE m int := COALESCE((SELECT leave_year_start_month FROM public.hr_settings WHERE company_id = p_company), 1);
BEGIN
  IF extract(month FROM p_date)::int >= m THEN RETURN make_date(extract(year FROM p_date)::int, m, 1); END IF;
  RETURN make_date(extract(year FROM p_date)::int - 1, m, 1);
END; $fn$;

CREATE OR REPLACE FUNCTION public._leave_policy(p_employee uuid, p_type uuid)
RETURNS public.leave_policies LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
  SELECT p.* FROM public.leave_policies p
    JOIN public.employees e ON e.id = p_employee AND e.company_id = p.company_id
    JOIN public.companies c ON c.id = e.company_id
   WHERE p.leave_type_id = p_type AND p.is_active
     AND (p.country_code IS NULL OR p.country_code = c.country_code)
     AND (p.branch_id IS NULL OR p.branch_id = e.branch_id)
     AND (p.employment_type IS NULL OR p.employment_type = e.employment_type)
     AND (p.department IS NULL OR lower(p.department) = lower(COALESCE(e.department, '')))
   ORDER BY (p.branch_id IS NOT NULL)::int * 8 + (p.employment_type IS NOT NULL)::int * 4
          + (p.department IS NOT NULL)::int * 2 + (p.country_code IS NOT NULL)::int DESC, p.created_at
   LIMIT 1;
$fn$;

CREATE OR REPLACE FUNCTION public._leave_sum(p_employee uuid, p_type uuid, p_upto date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
  SELECT COALESCE(sum(days), 0) FROM public.leave_ledger
   WHERE employee_id = p_employee AND leave_type_id = p_type AND entry_date <= p_upto;
$fn$;

-- What can still be booked: entitlement earned up to the date, minus every
-- approved leave whatever its date (future leave is already promised).
CREATE OR REPLACE FUNCTION public._leave_available(p_employee uuid, p_type uuid, p_upto date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
  SELECT COALESCE(sum(days), 0) FROM public.leave_ledger
   WHERE employee_id = p_employee AND leave_type_id = p_type
     AND (entry_date <= p_upto OR kind IN ('taken', 'reversal', 'encashment'));
$fn$;

-- Working days a request uses (0.5 for a half day on a working day).
CREATE OR REPLACE FUNCTION public.leave_count_days(p_employee uuid, p_type uuid, p_from date, p_to date, p_half text DEFAULT 'none')
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE
  v_company uuid := public._leave_guard();
  e public.employees%ROWTYPE;
  p public.leave_policies%ROWTYPE;
  v_week smallint[];
  d date; n numeric := 0;
BEGIN
  SELECT * INTO e FROM public.employees WHERE id = p_employee AND company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found.' USING ERRCODE = 'P0002'; END IF;
  IF p_to < p_from OR p_to - p_from > 366 THEN RAISE EXCEPTION 'Check the dates (at most one year per request).'; END IF;
  p := public._leave_policy(p_employee, p_type);
  v_week := public._leave_weekend(v_company);
  FOR d IN SELECT generate_series(p_from, p_to, interval '1 day')::date LOOP
    IF NOT COALESCE(p.count_weekends, false) AND extract(dow FROM d)::smallint = ANY (v_week) THEN CONTINUE; END IF;
    IF NOT COALESCE(p.count_holidays, false) AND EXISTS (
         SELECT 1 FROM public.holidays h WHERE h.company_id = v_company AND h.date = d
            AND (h.branch_id IS NULL OR h.branch_id = e.branch_id)) THEN CONTINUE; END IF;
    n := n + 1;
  END LOOP;
  IF p_half IS NOT NULL AND p_half <> 'none' THEN n := n * 0.5; END IF;
  RETURN n;
END; $fn$;

-- Post accruals and carry-forward expiries up to a date. Idempotent (period key).
CREATE OR REPLACE FUNCTION public._leave_accrue(p_employee uuid, p_type uuid, p_upto date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE
  e public.employees%ROWTYPE;
  p public.leave_policies%ROWTYPE;
  v_end date; v_start date; ly date; ys date; ye date; xd date;
  k int; cd date; amt numeric; band numeric; carried numeric; used numeric;
BEGIN
  SELECT * INTO e FROM public.employees WHERE id = p_employee;
  IF NOT FOUND OR e.joining_date IS NULL THEN RETURN; END IF;
  p := public._leave_policy(p_employee, p_type);
  IF p.id IS NULL OR p.accrual = 'none' THEN RETURN; END IF;
  v_start := e.joining_date;
  v_end := p_upto;
  -- A deactivated employee stops accruing on the day they were deactivated.
  IF NOT e.is_active THEN
    v_end := LEAST(v_end, COALESCE((SELECT max(created_at)::date FROM public.employee_events
                                     WHERE employee_id = e.id AND event_type = 'status' AND new_value = 'false'::jsonb), v_end));
  END IF;
  IF v_end < v_start THEN RETURN; END IF;

  ly := public._leave_year_start(e.company_id, v_start);
  WHILE ly <= v_end LOOP
    ys := ly; ye := (ly + interval '1 year')::date - 1;

    -- Year boundary: unused days above the carry-forward cap expire on the last day of the old year.
    IF ys > v_start AND p.carry_forward_max IS NOT NULL THEN
      amt := public._leave_sum(e.id, p_type, ys - 1) - p.carry_forward_max;
      INSERT INTO public.leave_ledger (company_id, employee_id, leave_type_id, entry_date, kind, days, period, note, by_user)
      VALUES (e.company_id, e.id, p_type, ys - 1, 'expiry', -GREATEST(amt, 0), 'C' || to_char(ys, 'YYYY-MM'),
              'carry-forward limit', NULL)
      ON CONFLICT (employee_id, leave_type_id, kind, period) WHERE period IS NOT NULL DO NOTHING;
    END IF;

    -- Accruals of this leave year.
    IF p.accrual = 'annual' THEN
      cd := GREATEST(ys, v_start);
      IF cd <= v_end THEN
        amt := round(p.entitlement_days * (ye - cd + 1)::numeric / (ye - ys + 1), 2);
        IF p.max_balance IS NOT NULL THEN amt := LEAST(amt, GREATEST(p.max_balance - public._leave_sum(e.id, p_type, cd), 0)); END IF;
        INSERT INTO public.leave_ledger (company_id, employee_id, leave_type_id, entry_date, kind, days, period, by_user)
        VALUES (e.company_id, e.id, p_type, cd, 'accrual', GREATEST(amt, 0), 'Y' || to_char(ys, 'YYYY-MM'), NULL)
        ON CONFLICT (employee_id, leave_type_id, kind, period) WHERE period IS NOT NULL DO NOTHING;
      END IF;
    ELSE  -- monthly: one credit per completed month of service
      k := GREATEST(1, (extract(year FROM age(ys, v_start)) * 12 + extract(month FROM age(ys, v_start)))::int);
      LOOP
        cd := (v_start + make_interval(months => k))::date;
        EXIT WHEN cd > LEAST(ye, v_end);
        IF cd >= ys THEN
          band := NULL;
          IF p.service_bands IS NOT NULL THEN
            SELECT (b->>'days')::numeric INTO band FROM jsonb_array_elements(p.service_bands) b
             WHERE (b->>'from_month')::int <= k - 1 ORDER BY (b->>'from_month')::int DESC LIMIT 1;
          END IF;
          amt := COALESCE(band, round(p.entitlement_days / 12, 3));
          IF p.max_balance IS NOT NULL THEN amt := LEAST(amt, GREATEST(p.max_balance - public._leave_sum(e.id, p_type, cd), 0)); END IF;
          INSERT INTO public.leave_ledger (company_id, employee_id, leave_type_id, entry_date, kind, days, period, by_user)
          VALUES (e.company_id, e.id, p_type, cd, 'accrual', GREATEST(amt, 0), 'M' || k, NULL)
          ON CONFLICT (employee_id, leave_type_id, kind, period) WHERE period IS NOT NULL DO NOTHING;
        END IF;
        k := k + 1;
      END LOOP;
    END IF;

    -- Carried days not used within N months of the new year expire.
    IF ys > v_start AND p.carry_forward_expiry_months IS NOT NULL THEN
      xd := (ys + make_interval(months => p.carry_forward_expiry_months))::date;
      IF xd <= v_end THEN
        carried := GREATEST(public._leave_sum(e.id, p_type, ys - 1), 0);
        SELECT -COALESCE(sum(days), 0) INTO used FROM public.leave_ledger
         WHERE employee_id = e.id AND leave_type_id = p_type AND kind IN ('taken', 'reversal', 'encashment')
           AND entry_date >= ys AND entry_date < xd;
        INSERT INTO public.leave_ledger (company_id, employee_id, leave_type_id, entry_date, kind, days, period, note, by_user)
        VALUES (e.company_id, e.id, p_type, xd, 'expiry', -GREATEST(carried - GREATEST(used, 0), 0), 'X' || to_char(ys, 'YYYY-MM'),
                'carried days not used in time', NULL)
        ON CONFLICT (employee_id, leave_type_id, kind, period) WHERE period IS NOT NULL DO NOTHING;
      END IF;
    END IF;

    ly := (ly + interval '1 year')::date;
  END LOOP;
END; $fn$;

-- Who may see an employee's leave: payroll users, the person, their manager, their branch manager.
CREATE OR REPLACE FUNCTION public._leave_can_view(p_employee uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
  SELECT public.has_perm('payroll.read') OR EXISTS (
    SELECT 1 FROM public.employees e
     WHERE e.id = p_employee AND e.company_id = public.current_user_company_id()
       AND public._my_employee() IS NOT NULL
       AND (e.id = public._my_employee() OR e.reports_to_id = public._my_employee()
            OR EXISTS (SELECT 1 FROM public.branches b WHERE b.id = e.branch_id AND b.manager_employee_id = public._my_employee())));
$fn$;

-- ── 6. Balance ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.leave_balance(p_employee uuid, p_type uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE
  v_company uuid := public._leave_guard();
  p public.leave_policies%ROWTYPE;
  r record; v_pending numeric;
BEGIN
  IF NOT public._leave_can_view(p_employee) THEN
    RAISE EXCEPTION 'You cannot see this employee''s leave.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leave_types WHERE id = p_type AND company_id = v_company) THEN
    RAISE EXCEPTION 'Leave type not found.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public._leave_accrue(p_employee, p_type, LEAST(p_as_of, CURRENT_DATE));
  p := public._leave_policy(p_employee, p_type);
  SELECT COALESCE(sum(days) FILTER (WHERE kind = 'opening'), 0)                    AS opening,
         COALESCE(sum(days) FILTER (WHERE kind = 'accrual'), 0)                    AS accrued,
         COALESCE(sum(days) FILTER (WHERE kind = 'adjustment'), 0)                 AS adjusted,
         COALESCE(-sum(days) FILTER (WHERE kind = 'expiry'), 0)                    AS expired,
         COALESCE(-sum(days) FILTER (WHERE kind IN ('taken', 'reversal')), 0)      AS taken,
         COALESCE(-sum(days) FILTER (WHERE kind = 'encashment'), 0)                AS encashed,
         COALESCE(sum(days), 0)                                                    AS balance
    INTO r FROM public.leave_ledger
   WHERE employee_id = p_employee AND leave_type_id = p_type
     AND (entry_date <= p_as_of OR kind IN ('taken', 'reversal', 'encashment'));   -- booked leave counts at once
  SELECT COALESCE(sum(days), 0) INTO v_pending FROM public.leave_requests
   WHERE employee_id = p_employee AND leave_type_id = p_type AND status IN ('pending', 'returned');
  RETURN jsonb_build_object('as_of', p_as_of, 'policy_id', p.id, 'policy_name', p.name, 'accrual', p.accrual,
    'needs_verification', p.needs_verification,
    'opening', r.opening, 'accrued', r.accrued, 'adjusted', r.adjusted, 'expired', r.expired,
    'taken', r.taken, 'encashed', r.encashed, 'balance', r.balance, 'pending', v_pending,
    'available', r.balance - v_pending);
END; $fn$;

-- ── 7. Request lifecycle ───────────────────────────────────────────────────
-- Checks shared by submit, resubmit and record. Returns days.
CREATE OR REPLACE FUNCTION public._leave_check(p_employee uuid, p_type uuid, p_from date, p_to date, p_half text, p_exclude uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE
  e public.employees%ROWTYPE; lt public.leave_types%ROWTYPE; p public.leave_policies%ROWTYPE;
  v_days numeric; v_avail numeric; v_months int;
BEGIN
  SELECT * INTO e FROM public.employees WHERE id = p_employee;
  SELECT * INTO lt FROM public.leave_types WHERE id = p_type AND company_id = e.company_id;
  IF lt.id IS NULL OR NOT lt.is_active THEN RAISE EXCEPTION 'This leave type is not available.'; END IF;
  IF NOT e.is_active THEN RAISE EXCEPTION 'This employee is inactive.'; END IF;
  IF lt.gender_only IS NOT NULL AND COALESCE(e.gender, '') <> lt.gender_only THEN
    RAISE EXCEPTION 'This leave type does not apply to this employee.';
  END IF;
  IF p_half IS NULL OR p_half NOT IN ('none', 'first', 'second') THEN RAISE EXCEPTION 'Unknown half-day value.'; END IF;
  IF p_half <> 'none' AND (NOT lt.allow_half_day OR p_from <> p_to) THEN
    RAISE EXCEPTION 'A half day must be a single date, on a leave type that allows half days.';
  END IF;
  p := public._leave_policy(p_employee, p_type);
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'No active leave policy covers this employee for this leave type. HR must set one up.';
  END IF;
  IF p.min_service_months > 0 THEN
    v_months := CASE WHEN e.joining_date IS NULL THEN 0
                     ELSE (extract(year FROM age(p_from, e.joining_date)) * 12 + extract(month FROM age(p_from, e.joining_date)))::int END;
    IF v_months < p.min_service_months THEN
      RAISE EXCEPTION 'This leave needs % months of service (the employee will have %).', p.min_service_months, v_months;
    END IF;
  END IF;
  IF NOT p.probation_allowed AND (e.employment_type = 'probation' OR (e.probation_end IS NOT NULL AND p_from <= e.probation_end)) THEN
    RAISE EXCEPTION 'This leave is not allowed during probation.';
  END IF;
  v_days := public.leave_count_days(p_employee, p_type, p_from, p_to, p_half);
  IF v_days <= 0 THEN RAISE EXCEPTION 'These dates have no working days.'; END IF;
  IF lt.max_days_per_request IS NOT NULL AND v_days > lt.max_days_per_request THEN
    RAISE EXCEPTION 'At most % days per request for this leave type.', lt.max_days_per_request;
  END IF;
  -- No overlap with live requests (two different halves of one day are fine).
  IF EXISTS (SELECT 1 FROM public.leave_requests r
              WHERE r.employee_id = p_employee AND r.status IN ('pending', 'approved', 'returned')
                AND (p_exclude IS NULL OR r.id <> p_exclude)
                AND daterange(r.date_from, r.date_to, '[]') && daterange(p_from, p_to, '[]')
                AND NOT (r.half_day <> 'none' AND p_half <> 'none' AND r.half_day <> p_half)) THEN
    RAISE EXCEPTION 'These dates overlap another leave request.';
  END IF;
  IF lt.needs_balance THEN
    -- Only days already earned can be booked (no borrowing from future months).
    PERFORM public._leave_accrue(p_employee, p_type, CURRENT_DATE);
    v_avail := public._leave_available(p_employee, p_type, CURRENT_DATE)
             - COALESCE((SELECT sum(days) FROM public.leave_requests r
                          WHERE r.employee_id = p_employee AND r.leave_type_id = p_type AND r.status IN ('pending', 'returned')
                            AND (p_exclude IS NULL OR r.id <> p_exclude)), 0);
    IF v_days > v_avail + (CASE WHEN p.allow_negative THEN p.negative_limit ELSE 0 END) THEN
      RAISE EXCEPTION 'Not enough balance: % days available, % requested.', round(v_avail, 2), v_days;
    END IF;
  END IF;
  RETURN v_days;
END; $fn$;

-- The approval chain for an employee, from hr_settings: manager, branch manager, HR.
CREATE OR REPLACE FUNCTION public._leave_chain(p_employee uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE
  e public.employees%ROWTYPE;
  v_kinds text[]; k text; v_emp uuid; v_seen uuid[] := ARRAY[]::uuid[];
  v_chain jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO e FROM public.employees WHERE id = p_employee;
  v_kinds := COALESCE((SELECT approval_chain FROM public.hr_settings WHERE company_id = e.company_id), ARRAY['manager', 'hr']);
  FOREACH k IN ARRAY v_kinds LOOP
    v_emp := NULL;
    IF k = 'manager' THEN v_emp := e.reports_to_id;
    ELSIF k = 'branch_manager' THEN SELECT manager_employee_id INTO v_emp FROM public.branches WHERE id = e.branch_id;
    END IF;
    IF k = 'hr' THEN
      v_chain := v_chain || jsonb_build_object('kind', 'hr', 'employee_id', NULL);
    ELSIF v_emp IS NOT NULL AND v_emp <> e.id AND NOT (v_emp = ANY (v_seen))
          AND EXISTS (SELECT 1 FROM public.employees m WHERE m.id = v_emp AND m.is_active AND m.user_id IS NOT NULL) THEN
      v_chain := v_chain || jsonb_build_object('kind', k, 'employee_id', v_emp);
      v_seen := v_seen || v_emp;
    END IF;
  END LOOP;
  -- Nobody in the chain (no manager with a login, HR not configured): HR decides.
  IF jsonb_array_length(v_chain) = 0 THEN
    v_chain := '[{"kind":"hr","employee_id":null}]'::jsonb;
  END IF;
  RETURN v_chain;
END; $fn$;

CREATE OR REPLACE FUNCTION public.submit_leave(p_employee uuid, p_type uuid, p_from date, p_to date,
  p_half text DEFAULT 'none', p_reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE
  v_company uuid := public._leave_guard();
  v_days numeric; v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_employee AND company_id = v_company) THEN
    RAISE EXCEPTION 'Employee not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (public.has_perm('payroll.write') OR p_employee = public._my_employee()) THEN
    RAISE EXCEPTION 'You can only request leave for yourself.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.employees WHERE id = p_employee FOR UPDATE;   -- one request at a time per person
  v_days := public._leave_check(p_employee, p_type, p_from, p_to, COALESCE(p_half, 'none'), NULL);
  INSERT INTO public.leave_requests (company_id, employee_id, leave_type_id, policy_id, date_from, date_to, half_day, days, reason, chain)
  VALUES (v_company, p_employee, p_type, (public._leave_policy(p_employee, p_type)).id, p_from, p_to, COALESCE(p_half, 'none'),
          v_days, NULLIF(btrim(p_reason), ''), public._leave_chain(p_employee))
  RETURNING id INTO v_id;
  INSERT INTO public.leave_request_steps (company_id, request_id, step_no, action, by_employee)
  VALUES (v_company, v_id, 0, 'submitted', public._my_employee());
  RETURN v_id;
END; $fn$;

-- approve | reject | return | delegate (delegate needs p_to_employee).
CREATE OR REPLACE FUNCTION public.act_on_leave(p_request uuid, p_action text, p_note text DEFAULT NULL, p_to_employee uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE
  v_company uuid := public._leave_guard();
  r public.leave_requests%ROWTYPE;
  v_me uuid := public._my_employee();
  v_hr boolean := public.has_perm('payroll.write');
  cur jsonb; v_kind text; v_last boolean; lt public.leave_types%ROWTYPE; p public.leave_policies%ROWTYPE;
BEGIN
  IF p_action NOT IN ('approve', 'reject', 'return', 'delegate') THEN RAISE EXCEPTION 'Unknown action.'; END IF;
  SELECT * INTO r FROM public.leave_requests WHERE id = p_request AND company_id = v_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Leave request not found.' USING ERRCODE = 'P0002'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'This request is % and cannot be acted on.', r.status; END IF;
  cur := r.chain -> (r.current_step - 1);
  v_kind := cur->>'kind';
  -- The current approver (or their delegate) acts; HR may act at any step.
  -- COALESCE: a missing delegate must count as "no", never as unknown
  -- (NOT NULL is NULL, and IF NULL would let anyone through).
  IF NOT COALESCE(v_hr OR (v_kind <> 'hr' AND v_me IS NOT NULL
                   AND (v_me::text IS NOT DISTINCT FROM cur->>'employee_id'
                        OR (cur->>'delegate_id' IS NOT NULL AND v_me::text = cur->>'delegate_id'))), false) THEN
    RAISE EXCEPTION 'You are not the approver for this step.' USING ERRCODE = '42501';
  END IF;
  IF v_me = r.employee_id AND NOT v_hr THEN
    RAISE EXCEPTION 'You cannot approve your own leave.' USING ERRCODE = '42501';
  END IF;
  IF p_action IN ('reject', 'return') AND NULLIF(btrim(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'Please give a reason.';
  END IF;

  IF p_action = 'delegate' THEN
    IF p_to_employee IS NULL OR NOT EXISTS (SELECT 1 FROM public.employees m WHERE m.id = p_to_employee AND m.company_id = v_company
                                              AND m.is_active AND m.user_id IS NOT NULL AND m.id <> r.employee_id) THEN
      RAISE EXCEPTION 'Delegate to an active colleague who has a login.';
    END IF;
    IF v_kind = 'hr' THEN RAISE EXCEPTION 'The HR step cannot be delegated.'; END IF;
    UPDATE public.leave_requests
       SET chain = jsonb_set(chain, ARRAY[(current_step - 1)::text, 'delegate_id'], to_jsonb(p_to_employee::text)), updated_at = now()
     WHERE id = r.id;
    INSERT INTO public.leave_request_steps (company_id, request_id, step_no, kind, action, by_employee, to_employee, note)
    VALUES (v_company, r.id, r.current_step, v_kind, 'delegated', v_me, p_to_employee, NULLIF(btrim(p_note), ''));
    RETURN jsonb_build_object('status', 'pending', 'step', r.current_step);
  END IF;

  IF p_action IN ('reject', 'return') THEN
    UPDATE public.leave_requests SET status = CASE p_action WHEN 'reject' THEN 'rejected' ELSE 'returned' END,
           decided_at = CASE p_action WHEN 'reject' THEN now() END, updated_at = now() WHERE id = r.id;
    INSERT INTO public.leave_request_steps (company_id, request_id, step_no, kind, action, by_employee, note)
    VALUES (v_company, r.id, r.current_step, v_kind, CASE p_action WHEN 'reject' THEN 'rejected' ELSE 'returned' END, v_me, btrim(p_note));
    RETURN jsonb_build_object('status', CASE p_action WHEN 'reject' THEN 'rejected' ELSE 'returned' END);
  END IF;

  -- approve
  v_last := r.current_step >= jsonb_array_length(r.chain);
  INSERT INTO public.leave_request_steps (company_id, request_id, step_no, kind, action, by_employee, note)
  VALUES (v_company, r.id, r.current_step, v_kind, 'approved', v_me, NULLIF(btrim(p_note), ''));
  IF NOT v_last THEN
    UPDATE public.leave_requests SET current_step = current_step + 1, updated_at = now() WHERE id = r.id;
    RETURN jsonb_build_object('status', 'pending', 'step', r.current_step + 1);
  END IF;
  SELECT * INTO lt FROM public.leave_types WHERE id = r.leave_type_id;
  p := public._leave_policy(r.employee_id, r.leave_type_id);
  IF (lt.requires_document OR (p.document_after_days IS NOT NULL AND r.days > p.document_after_days))
     AND NOT EXISTS (SELECT 1 FROM public.employee_documents d WHERE d.leave_request_id = r.id) THEN
    RAISE EXCEPTION 'A supporting document is needed before final approval. Return the request or attach it first.';
  END IF;
  UPDATE public.leave_requests SET status = 'approved', decided_at = now(), updated_at = now() WHERE id = r.id;
  INSERT INTO public.leave_ledger (company_id, employee_id, leave_type_id, entry_date, kind, days, request_id, note)
  VALUES (v_company, r.employee_id, r.leave_type_id, r.date_from, 'taken', -r.days, r.id, 'approved leave');
  RETURN jsonb_build_object('status', 'approved');
END; $fn$;

-- A returned request: the employee (or HR) changes it and sends it again from step 1.
CREATE OR REPLACE FUNCTION public.resubmit_leave(p_request uuid, p_from date, p_to date, p_half text DEFAULT 'none', p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE
  v_company uuid := public._leave_guard();
  r public.leave_requests%ROWTYPE; v_days numeric;
BEGIN
  SELECT * INTO r FROM public.leave_requests WHERE id = p_request AND company_id = v_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Leave request not found.' USING ERRCODE = 'P0002'; END IF;
  IF r.status <> 'returned' THEN RAISE EXCEPTION 'Only a returned request can be sent again.'; END IF;
  IF NOT (public.has_perm('payroll.write') OR r.employee_id = public._my_employee()) THEN
    RAISE EXCEPTION 'Only the employee or HR can change this request.' USING ERRCODE = '42501';
  END IF;
  v_days := public._leave_check(r.employee_id, r.leave_type_id, p_from, p_to, COALESCE(p_half, 'none'), r.id);
  UPDATE public.leave_requests SET date_from = p_from, date_to = p_to, half_day = COALESCE(p_half, 'none'), days = v_days,
         reason = COALESCE(NULLIF(btrim(p_reason), ''), reason), status = 'pending', current_step = 1,
         chain = public._leave_chain(r.employee_id), updated_at = now()
   WHERE id = r.id;
  INSERT INTO public.leave_request_steps (company_id, request_id, step_no, action, by_employee)
  VALUES (v_company, r.id, 0, 'resubmitted', public._my_employee());
END; $fn$;

-- Pending / returned: the employee or HR. Approved: HR only; the days come back.
CREATE OR REPLACE FUNCTION public.cancel_leave(p_request uuid, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE
  v_company uuid := public._leave_guard();
  r public.leave_requests%ROWTYPE; v_hr boolean := public.has_perm('payroll.write');
BEGIN
  SELECT * INTO r FROM public.leave_requests WHERE id = p_request AND company_id = v_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Leave request not found.' USING ERRCODE = 'P0002'; END IF;
  IF r.status IN ('pending', 'returned') THEN
    IF NOT (v_hr OR r.employee_id = public._my_employee()) THEN
      RAISE EXCEPTION 'Only the employee or HR can withdraw this request.' USING ERRCODE = '42501';
    END IF;
  ELSIF r.status = 'approved' THEN
    IF NOT v_hr THEN RAISE EXCEPTION 'Approved leave can only be cancelled by HR.' USING ERRCODE = '42501'; END IF;
    IF NULLIF(btrim(p_note), '') IS NULL THEN RAISE EXCEPTION 'Please give a reason.'; END IF;
    INSERT INTO public.leave_ledger (company_id, employee_id, leave_type_id, entry_date, kind, days, request_id, note)
    VALUES (v_company, r.employee_id, r.leave_type_id, r.date_from, 'reversal', r.days, r.id, 'cancelled after approval');
  ELSE
    RAISE EXCEPTION 'This request is already %.', r.status;
  END IF;
  UPDATE public.leave_requests SET status = 'cancelled', decided_at = now(), updated_at = now() WHERE id = r.id;
  INSERT INTO public.leave_request_steps (company_id, request_id, step_no, action, by_employee, note)
  VALUES (v_company, r.id, r.current_step, 'cancelled', public._my_employee(), NULLIF(btrim(p_note), ''));
END; $fn$;

-- HR records leave that was already agreed (paper forms, history): approved at once.
CREATE OR REPLACE FUNCTION public.record_leave(p_employee uuid, p_type uuid, p_from date, p_to date,
  p_half text DEFAULT 'none', p_reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE
  v_company uuid := public._leave_guard();
  v_days numeric; v_id uuid;
BEGIN
  IF NOT public.has_perm('payroll.write') THEN RAISE EXCEPTION 'Only HR can record leave directly.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_employee AND company_id = v_company) THEN
    RAISE EXCEPTION 'Employee not found.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM public.employees WHERE id = p_employee FOR UPDATE;
  v_days := public._leave_check(p_employee, p_type, p_from, p_to, COALESCE(p_half, 'none'), NULL);
  INSERT INTO public.leave_requests (company_id, employee_id, leave_type_id, policy_id, date_from, date_to, half_day, days,
                                     reason, status, current_step, chain, decided_at)
  VALUES (v_company, p_employee, p_type, (public._leave_policy(p_employee, p_type)).id, p_from, p_to, COALESCE(p_half, 'none'),
          v_days, NULLIF(btrim(p_reason), ''), 'approved', 1, '[{"kind":"hr","employee_id":null}]'::jsonb, now())
  RETURNING id INTO v_id;
  INSERT INTO public.leave_request_steps (company_id, request_id, step_no, kind, action, by_employee, note)
  VALUES (v_company, v_id, 1, 'hr', 'recorded', public._my_employee(), 'recorded by HR');
  INSERT INTO public.leave_ledger (company_id, employee_id, leave_type_id, entry_date, kind, days, request_id, note)
  VALUES (v_company, p_employee, p_type, p_from, 'taken', -v_days, v_id, 'recorded by HR');
  RETURN v_id;
END; $fn$;

-- HR: opening balance, adjustment (+/-), encashment (days paid out).
CREATE OR REPLACE FUNCTION public.adjust_leave_balance(p_employee uuid, p_type uuid, p_kind text, p_days numeric,
  p_date date DEFAULT CURRENT_DATE, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE
  v_company uuid := public._leave_guard(); v_id uuid; v_days numeric := p_days;
BEGIN
  IF NOT public.has_perm('payroll.write') THEN RAISE EXCEPTION 'Only HR can change leave balances.' USING ERRCODE = '42501'; END IF;
  IF p_kind NOT IN ('opening', 'adjustment', 'encashment') THEN RAISE EXCEPTION 'Unknown kind.'; END IF;
  IF p_days IS NULL OR p_days = 0 OR abs(p_days) > 1000 THEN RAISE EXCEPTION 'Enter the number of days.'; END IF;
  IF p_kind = 'encashment' THEN v_days := -abs(p_days); END IF;
  IF NULLIF(btrim(p_note), '') IS NULL THEN RAISE EXCEPTION 'Please give a reason.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_employee AND company_id = v_company)
     OR NOT EXISTS (SELECT 1 FROM public.leave_types WHERE id = p_type AND company_id = v_company) THEN
    RAISE EXCEPTION 'Employee or leave type not found.' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.leave_ledger (company_id, employee_id, leave_type_id, entry_date, kind, days, note)
  VALUES (v_company, p_employee, p_type, COALESCE(p_date, CURRENT_DATE), p_kind, v_days, btrim(p_note))
  RETURNING id INTO v_id;
  RETURN v_id;
END; $fn$;

-- ── 8. Lists for approvers, the employee and the calendar ──────────────────
CREATE OR REPLACE FUNCTION public.leave_inbox()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE
  v_company uuid := public._leave_guard();
  v_me uuid := public._my_employee(); v_hr boolean := public.has_perm('payroll.write');
  v_esc int := COALESCE((SELECT escalate_after_days FROM public.hr_settings WHERE company_id = v_company), 3);
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY x->>'waiting_since') FROM (
      SELECT jsonb_build_object(
        'id', r.id, 'employee_id', r.employee_id, 'employee', e.name, 'code', e.code, 'branch', b.name, 'department', e.department,
        'leave_type', lt.name, 'leave_type_id', lt.id, 'date_from', r.date_from, 'date_to', r.date_to, 'half_day', r.half_day,
        'days', r.days, 'reason', r.reason, 'step', r.current_step, 'steps', jsonb_array_length(r.chain),
        'step_kind', r.chain -> (r.current_step - 1) ->> 'kind',
        'waiting_since', COALESCE((SELECT max(s.created_at) FROM public.leave_request_steps s WHERE s.request_id = r.id), r.created_at),
        'escalated', COALESCE((SELECT max(s.created_at) FROM public.leave_request_steps s WHERE s.request_id = r.id), r.created_at)
                       < now() - make_interval(days => v_esc),
        'has_document', EXISTS (SELECT 1 FROM public.employee_documents d WHERE d.leave_request_id = r.id)) AS x
        FROM public.leave_requests r
        JOIN public.employees e ON e.id = r.employee_id
        JOIN public.leave_types lt ON lt.id = r.leave_type_id
        LEFT JOIN public.branches b ON b.id = e.branch_id
       WHERE r.company_id = v_company AND r.status = 'pending' AND r.employee_id IS DISTINCT FROM CASE WHEN v_hr THEN NULL ELSE v_me END
         AND COALESCE(v_hr OR (v_me IS NOT NULL AND (r.chain -> (r.current_step - 1) ->> 'kind') <> 'hr'
                       AND (v_me::text IS NOT DISTINCT FROM r.chain -> (r.current_step - 1) ->> 'employee_id'
                            OR v_me::text IS NOT DISTINCT FROM r.chain -> (r.current_step - 1) ->> 'delegate_id')), false)
    ) q), '[]'::jsonb);
END; $fn$;

-- My leave: requests and balances of the caller's own employee record.
CREATE OR REPLACE FUNCTION public.my_leave()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE
  v_company uuid := public._leave_guard(); v_me uuid := public._my_employee(); v_bal jsonb := '[]'::jsonb; t record;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('employee_id', NULL, 'requests', '[]'::jsonb, 'balances', '[]'::jsonb); END IF;
  FOR t IN SELECT lt.id, lt.name, lt.needs_balance FROM public.leave_types lt
            WHERE lt.company_id = v_company AND lt.is_active ORDER BY lt.sort_order, lt.name LOOP
    IF (public._leave_policy(v_me, t.id)).id IS NOT NULL THEN
      v_bal := v_bal || (jsonb_build_object('leave_type_id', t.id, 'leave_type', t.name, 'needs_balance', t.needs_balance)
                         || public.leave_balance(v_me, t.id, CURRENT_DATE));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('employee_id', v_me, 'balances', v_bal, 'requests', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', r.id, 'leave_type', lt.name, 'date_from', r.date_from, 'date_to', r.date_to,
             'half_day', r.half_day, 'days', r.days, 'status', r.status, 'reason', r.reason,
             'last_note', (SELECT s.note FROM public.leave_request_steps s WHERE s.request_id = r.id ORDER BY s.created_at DESC LIMIT 1))
           ORDER BY r.date_from DESC)
      FROM public.leave_requests r JOIN public.leave_types lt ON lt.id = r.leave_type_id
     WHERE r.employee_id = v_me), '[]'::jsonb));
END; $fn$;

-- Calendar: approved and pending leave between two dates. HR sees everyone;
-- a manager sees their direct reports and, if a branch manager, that branch.
CREATE OR REPLACE FUNCTION public.leave_calendar(p_from date, p_to date, p_branch uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE
  v_company uuid := public._leave_guard(); v_me uuid := public._my_employee(); v_hr boolean := public.has_perm('payroll.read');
BEGIN
  IF p_to < p_from OR p_to - p_from > 400 THEN RAISE EXCEPTION 'Choose at most about a year.'; END IF;
  IF NOT v_hr AND v_me IS NULL THEN RAISE EXCEPTION 'No employee record is linked to your login.' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', r.id, 'employee_id', e.id, 'employee', e.name, 'code', e.code,
             'branch_id', e.branch_id, 'branch', b.name, 'department', e.department, 'leave_type', lt.name, 'color', lt.color,
             'date_from', r.date_from, 'date_to', r.date_to, 'half_day', r.half_day, 'days', r.days, 'status', r.status)
           ORDER BY r.date_from, e.name)
      FROM public.leave_requests r
      JOIN public.employees e ON e.id = r.employee_id
      JOIN public.leave_types lt ON lt.id = r.leave_type_id
      LEFT JOIN public.branches b ON b.id = e.branch_id
     WHERE r.company_id = v_company AND r.status IN ('approved', 'pending')
       AND r.date_from <= p_to AND r.date_to >= p_from
       AND (p_branch IS NULL OR e.branch_id = p_branch)
       AND (v_hr OR e.id = v_me OR e.reports_to_id = v_me
            OR EXISTS (SELECT 1 FROM public.branches bb WHERE bb.id = e.branch_id AND bb.manager_employee_id = v_me))), '[]'::jsonb);
END; $fn$;

-- ── 9. Templates (inserted INACTIVE, marked for verification) ──────────────
CREATE OR REPLACE FUNCTION public.install_leave_template(p_pack text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE
  v_company uuid := public._leave_guard();
  v_types int := 0; v_pols int := 0; t record; v_type uuid;
  v_src text := 'UAE Federal Decree-Law No. 33 of 2021 and its Executive Regulations. Template only: verify with your adviser before activating; free zones (DIFC, ADGM) differ.';
BEGIN
  IF NOT public.has_perm('payroll.write') THEN RAISE EXCEPTION 'Only HR can install templates.' USING ERRCODE = '42501'; END IF;
  IF p_pack NOT IN ('basic', 'ae_mainland') THEN RAISE EXCEPTION 'Unknown template.'; END IF;
  -- Leave types (both packs). Existing codes are left as they are.
  FOR t IN SELECT * FROM (VALUES
      ('annual', 'Annual leave', 'إجازة سنوية', 'paid', true, false, true, NULL::numeric, NULL::text, 10),
      ('sick', 'Sick leave', 'إجازة مرضية', 'partly_paid', true, true, true, NULL, NULL, 20),
      ('emergency', 'Emergency leave', 'إجازة طارئة', 'paid', true, false, true, NULL, NULL, 30),
      ('unpaid', 'Unpaid leave', 'إجازة بدون راتب', 'unpaid', false, false, true, NULL, NULL, 40),
      ('maternity', 'Maternity leave', 'إجازة أمومة', 'partly_paid', false, true, false, NULL, 'female', 50),
      ('parental', 'Parental leave', 'إجازة والدية', 'paid', false, false, false, NULL, NULL, 60),
      ('bereavement', 'Bereavement leave', 'إجازة حداد', 'paid', false, false, false, NULL, NULL, 70),
      ('marriage', 'Marriage leave', 'إجازة زواج', 'paid', false, false, false, NULL, NULL, 80),
      ('study', 'Study leave', 'إجازة دراسية', 'paid', true, true, false, NULL, NULL, 90),
      ('hajj', 'Hajj leave', 'إجازة حج', 'unpaid', false, false, false, NULL, NULL, 100),
      ('comp_off', 'Compensatory off', 'راحة تعويضية', 'paid', true, false, true, NULL, NULL, 110),
      ('special', 'Special leave', 'إجازة خاصة', 'paid', false, false, true, NULL, NULL, 120)
    ) AS v(code, name, name_ar, pay_kind, needs_balance, requires_document, allow_half_day, max_days, gender_only, sort_order) LOOP
    INSERT INTO public.leave_types (company_id, code, name, name_ar, pay_kind, needs_balance, requires_document, allow_half_day,
                                    max_days_per_request, gender_only, sort_order)
    VALUES (v_company, t.code, t.name, t.name_ar, t.pay_kind, t.needs_balance, t.requires_document, t.allow_half_day,
            t.max_days, t.gender_only, t.sort_order)
    ON CONFLICT (company_id, code) DO NOTHING;
    IF FOUND THEN v_types := v_types + 1; END IF;
  END LOOP;

  IF p_pack = 'ae_mainland' THEN
    FOR t IN SELECT * FROM (VALUES
        ('annual', 'UAE mainland — annual leave', 'monthly', 30::numeric, '[{"from_month":0,"days":2},{"from_month":12,"days":2.5}]'::jsonb, 6, true, NULL::jsonb, NULL::numeric),
        ('sick', 'UAE mainland — sick leave', 'annual', 90, NULL, 0, false, '[{"days":15,"pay_pct":100},{"days":30,"pay_pct":50},{"days":45,"pay_pct":0}]'::jsonb, NULL),
        ('maternity', 'UAE mainland — maternity leave', 'none', 60, NULL, 0, true, '[{"days":45,"pay_pct":100},{"days":15,"pay_pct":50}]'::jsonb, NULL),
        ('parental', 'UAE mainland — parental leave', 'none', 5, NULL, 0, true, NULL, NULL),
        ('bereavement', 'UAE mainland — bereavement leave', 'none', 5, NULL, 0, true, NULL, NULL),
        ('study', 'UAE mainland — study leave', 'annual', 10, NULL, 24, true, NULL, NULL),
        ('unpaid', 'Unpaid leave (company rule)', 'none', 0, NULL, 0, true, '[{"days":9999,"pay_pct":0}]'::jsonb, NULL)
      ) AS v(code, name, accrual, ent, bands, min_months, probation_ok, pay, doc_after) LOOP
      SELECT id INTO v_type FROM public.leave_types WHERE company_id = v_company AND code = t.code;
      IF v_type IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.leave_policies WHERE company_id = v_company AND name = t.name) THEN
        INSERT INTO public.leave_policies (company_id, leave_type_id, name, country_code, accrual, entitlement_days, service_bands,
               min_service_months, probation_allowed, pay_bands, document_after_days, needs_verification, source_note, is_active)
        VALUES (v_company, v_type, t.name, 'AE', t.accrual, t.ent, t.bands, t.min_months, t.probation_ok, t.pay, t.doc_after,
                true, v_src, false);
        v_pols := v_pols + 1;
      END IF;
    END LOOP;
    -- Per-event caps for the leave types limited by days per request.
    UPDATE public.leave_types SET max_days_per_request = CASE code WHEN 'maternity' THEN 60 WHEN 'parental' THEN 5 WHEN 'bereavement' THEN 5 END
     WHERE company_id = v_company AND code IN ('maternity', 'parental', 'bereavement') AND max_days_per_request IS NULL;
  END IF;
  RETURN jsonb_build_object('types_added', v_types, 'policies_added', v_pols);
END; $fn$;

-- ── 10. Grants: helpers private, actions for signed-in users only ──────────
DO $g$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    '_leave_guard()', '_leave_weekend(uuid)', '_leave_year_start(uuid, date)', '_leave_policy(uuid, uuid)',
    '_leave_sum(uuid, uuid, date)', '_leave_available(uuid, uuid, date)', '_leave_accrue(uuid, uuid, date)', '_leave_can_view(uuid)',
    '_leave_check(uuid, uuid, date, date, text, uuid)', '_leave_chain(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'leave_count_days(uuid, uuid, date, date, text)', 'leave_balance(uuid, uuid, date)',
    'submit_leave(uuid, uuid, date, date, text, text)', 'act_on_leave(uuid, text, text, uuid)',
    'resubmit_leave(uuid, date, date, text, text)', 'cancel_leave(uuid, text)',
    'record_leave(uuid, uuid, date, date, text, text)', 'adjust_leave_balance(uuid, uuid, text, numeric, date, text)',
    'leave_inbox()', 'my_leave()', 'leave_calendar(date, date, uuid)', 'install_leave_template(text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END
$g$;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Check: tables = 7, functions = 22, anon_submit = false.
SELECT (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN
          ('hr_settings','holidays','leave_types','leave_policies','leave_requests','leave_request_steps','leave_ledger')) AS tables,
       (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN
          ('_leave_guard','_leave_weekend','_leave_year_start','_leave_policy','_leave_sum','_leave_available','_leave_accrue','_leave_can_view',
           '_leave_check','_leave_chain','leave_count_days','leave_balance','submit_leave','act_on_leave','resubmit_leave',
           'cancel_leave','record_leave','adjust_leave_balance','leave_inbox','my_leave','leave_calendar','install_leave_template')) AS functions,
       has_function_privilege('anon', 'public.submit_leave(uuid, uuid, date, date, text, text)', 'execute') AS anon_submit;
