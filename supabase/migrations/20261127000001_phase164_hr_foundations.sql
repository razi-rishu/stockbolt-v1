-- ═══════════════════════════════════════════════════════════════════════════
-- phase164 — HR foundations (HRMS phase H1).
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. More employee fields: gender, marital status, address, probation end,
--    confirmation date, contract start and end. Employment types widened
--    (permanent, probation, temporary added; existing values kept).
-- 2. Employment history: employee_events, append-only, written ONLY by a
--    trigger on employees, so every path (screen, import, Team, quick-create)
--    is recorded: joined, branch / department / warehouse transfer,
--    designation, manager, employment type, status, salary, probation,
--    contract. One "baseline" row per existing employee starts the history.
-- 3. Audit trail: bank details, salary and active/inactive changes write
--    audit_logs (who, when, old, new). Manager changes are already audited
--    by the Team functions (phase144), so they are not written twice.
-- 4. import_employees(rows): checks every row first; if any row is wrong,
--    nothing is saved and the problems are returned. Runs as the caller, so
--    the employee rights (payroll.write) and all triggers apply.
--
-- Additive: new nullable columns, a wider CHECK, a new table, new triggers
-- and one function. No existing value, posting or payroll rule changes.
-- SAFE TO RE-RUN.
-- UNDO: DROP FUNCTION public.import_employees(jsonb);
--       DROP TRIGGER employees_z_history ON public.employees;
--       DROP FUNCTION public.tg_employees_history();
--       DROP TABLE public.employee_events;
--       (new columns may stay; they are unused without the app)
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── 1. Fields ──────────────────────────────────────────────────────────────
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS gender            text,
  ADD COLUMN IF NOT EXISTS marital_status    text,
  ADD COLUMN IF NOT EXISTS address           text,
  ADD COLUMN IF NOT EXISTS probation_end     date,
  ADD COLUMN IF NOT EXISTS confirmation_date date,
  ADD COLUMN IF NOT EXISTS contract_start    date,
  ADD COLUMN IF NOT EXISTS contract_end      date;

DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_gender_check') THEN
    ALTER TABLE public.employees ADD CONSTRAINT employees_gender_check
      CHECK (gender IS NULL OR gender IN ('male', 'female'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_marital_status_check') THEN
    ALTER TABLE public.employees ADD CONSTRAINT employees_marital_status_check
      CHECK (marital_status IS NULL OR marital_status IN ('single', 'married', 'divorced', 'widowed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_contract_dates_check') THEN
    ALTER TABLE public.employees ADD CONSTRAINT employees_contract_dates_check
      CHECK (contract_end IS NULL OR contract_start IS NULL OR contract_end >= contract_start);
  END IF;
  -- Widen (never narrow) the phase163 list.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_employment_type_check'
                   AND pg_get_constraintdef(oid) LIKE '%temporary%') THEN
    ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_employment_type_check;
    ALTER TABLE public.employees ADD CONSTRAINT employees_employment_type_check
      CHECK (employment_type IS NULL OR employment_type IN
             ('permanent', 'probation', 'full_time', 'part_time', 'contract', 'temporary', 'intern'));
  END IF;
END
$c$;

-- ── 2. Employment history ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employee_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id    uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  event_type     text NOT NULL CHECK (event_type IN
                   ('baseline', 'joined', 'branch', 'department', 'warehouse', 'designation', 'manager',
                    'employment_type', 'status', 'salary', 'probation', 'contract')),
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  old_value      jsonb,
  new_value      jsonb,
  by_user        uuid DEFAULT auth.uid(),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employee_events_employee_idx ON public.employee_events (employee_id, created_at);
CREATE INDEX IF NOT EXISTS employee_events_company_idx  ON public.employee_events (company_id, event_type, effective_date);

ALTER TABLE public.employee_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation      ON public.employee_events;
DROP POLICY IF EXISTS employee_events_read  ON public.employee_events;
CREATE POLICY tenant_isolation ON public.employee_events FOR ALL
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());
CREATE POLICY employee_events_read ON public.employee_events AS RESTRICTIVE FOR SELECT
  USING (public.has_perm('payroll.read'));
-- Read-only for the app: rows come only from the trigger below.
REVOKE ALL ON public.employee_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.employee_events TO authenticated;
GRANT ALL ON public.employee_events TO service_role;

CREATE OR REPLACE FUNCTION public.tg_employees_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_old_pay jsonb; v_new_pay jsonb; v_old_bank jsonb; v_new_bank jsonb;
  ev text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.employee_events (company_id, employee_id, event_type, effective_date, new_value)
    VALUES (NEW.company_id, NEW.id, 'joined', COALESCE(NEW.joining_date, CURRENT_DATE),
            jsonb_build_object('branch_id', NEW.branch_id, 'department', NEW.department, 'designation', NEW.designation,
                               'employment_type', NEW.employment_type, 'basic_salary', NEW.basic_salary));
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (NEW.company_id, auth.uid(), 'create', 'employee', NEW.id,
            jsonb_build_object('code', NEW.code, 'name', NEW.name, 'phase', 'phase164'));
    RETURN NEW;
  END IF;

  -- One event per kind of change; old and new values kept as JSON.
  FOR ev IN SELECT unnest(ARRAY['branch', 'department', 'warehouse', 'designation', 'manager',
                                'employment_type', 'status', 'probation', 'contract']) LOOP
    IF (ev = 'branch'          AND NEW.branch_id       IS DISTINCT FROM OLD.branch_id)
    OR (ev = 'department'      AND NEW.department      IS DISTINCT FROM OLD.department)
    OR (ev = 'warehouse'       AND NEW.warehouse_id    IS DISTINCT FROM OLD.warehouse_id)
    OR (ev = 'designation'     AND NEW.designation     IS DISTINCT FROM OLD.designation)
    OR (ev = 'manager'         AND NEW.reports_to_id   IS DISTINCT FROM OLD.reports_to_id)
    OR (ev = 'employment_type' AND NEW.employment_type IS DISTINCT FROM OLD.employment_type)
    OR (ev = 'status'          AND NEW.is_active       IS DISTINCT FROM OLD.is_active)
    OR (ev = 'probation'       AND (NEW.probation_end, NEW.confirmation_date) IS DISTINCT FROM (OLD.probation_end, OLD.confirmation_date))
    OR (ev = 'contract'        AND (NEW.contract_start, NEW.contract_end) IS DISTINCT FROM (OLD.contract_start, OLD.contract_end)) THEN
      INSERT INTO public.employee_events (company_id, employee_id, event_type, old_value, new_value)
      VALUES (NEW.company_id, NEW.id, ev,
        CASE ev WHEN 'branch' THEN to_jsonb(OLD.branch_id) WHEN 'department' THEN to_jsonb(OLD.department)
                WHEN 'warehouse' THEN to_jsonb(OLD.warehouse_id) WHEN 'designation' THEN to_jsonb(OLD.designation)
                WHEN 'manager' THEN to_jsonb(OLD.reports_to_id) WHEN 'employment_type' THEN to_jsonb(OLD.employment_type)
                WHEN 'status' THEN to_jsonb(OLD.is_active)
                WHEN 'probation' THEN jsonb_build_object('probation_end', OLD.probation_end, 'confirmation_date', OLD.confirmation_date)
                ELSE jsonb_build_object('contract_start', OLD.contract_start, 'contract_end', OLD.contract_end) END,
        CASE ev WHEN 'branch' THEN to_jsonb(NEW.branch_id) WHEN 'department' THEN to_jsonb(NEW.department)
                WHEN 'warehouse' THEN to_jsonb(NEW.warehouse_id) WHEN 'designation' THEN to_jsonb(NEW.designation)
                WHEN 'manager' THEN to_jsonb(NEW.reports_to_id) WHEN 'employment_type' THEN to_jsonb(NEW.employment_type)
                WHEN 'status' THEN to_jsonb(NEW.is_active)
                WHEN 'probation' THEN jsonb_build_object('probation_end', NEW.probation_end, 'confirmation_date', NEW.confirmation_date)
                ELSE jsonb_build_object('contract_start', NEW.contract_start, 'contract_end', NEW.contract_end) END);
    END IF;
  END LOOP;

  v_old_pay := jsonb_build_object('basic_salary', OLD.basic_salary, 'housing_allowance', OLD.housing_allowance,
                                  'transport_allowance', OLD.transport_allowance, 'other_allowance', OLD.other_allowance);
  v_new_pay := jsonb_build_object('basic_salary', NEW.basic_salary, 'housing_allowance', NEW.housing_allowance,
                                  'transport_allowance', NEW.transport_allowance, 'other_allowance', NEW.other_allowance);
  IF v_old_pay IS DISTINCT FROM v_new_pay THEN
    INSERT INTO public.employee_events (company_id, employee_id, event_type, old_value, new_value)
    VALUES (NEW.company_id, NEW.id, 'salary', v_old_pay, v_new_pay);
  END IF;

  -- Audit: salary, bank details and active/inactive (fraud-sensitive).
  v_old_bank := jsonb_build_object('bank_name', OLD.bank_name, 'iban', OLD.iban, 'bank_routing_code', OLD.bank_routing_code,
                                   'mol_id', OLD.mol_id, 'pay_method', OLD.pay_method);
  v_new_bank := jsonb_build_object('bank_name', NEW.bank_name, 'iban', NEW.iban, 'bank_routing_code', NEW.bank_routing_code,
                                   'mol_id', NEW.mol_id, 'pay_method', NEW.pay_method);
  IF v_old_pay IS DISTINCT FROM v_new_pay OR v_old_bank IS DISTINCT FROM v_new_bank OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, old_data, new_data)
    VALUES (NEW.company_id, auth.uid(), 'update', 'employee', NEW.id,
            v_old_pay || v_old_bank || jsonb_build_object('is_active', OLD.is_active),
            v_new_pay || v_new_bank || jsonb_build_object('is_active', NEW.is_active, 'phase', 'phase164'));
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.tg_employees_history() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS employees_z_history ON public.employees;
CREATE TRIGGER employees_z_history
  AFTER INSERT OR UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.tg_employees_history();

-- Start every existing employee's history with today's picture (once).
INSERT INTO public.employee_events (company_id, employee_id, event_type, effective_date, new_value, by_user)
SELECT e.company_id, e.id, 'baseline', COALESCE(e.joining_date, e.created_at::date),
       jsonb_build_object('branch_id', e.branch_id, 'department', e.department, 'designation', e.designation,
                          'employment_type', e.employment_type, 'is_active', e.is_active, 'basic_salary', e.basic_salary,
                          'recorded', 'phase164 — history starts here'),
       NULL
  FROM public.employees e
 WHERE NOT EXISTS (SELECT 1 FROM public.employee_events x WHERE x.employee_id = e.id);

-- ── 4. Validated import ───────────────────────────────────────────────────
-- p_rows: [{code?, name, name_ar?, phone?, email?, designation?, department?,
--   branch? (name or code), warehouse? (name or code), employment_type?,
--   joining_date?, gender?, nationality?, basic_salary?, housing_allowance?,
--   transport_allowance?, other_allowance?, manager_code?}]
-- Returns {ok, imported, errors: [{row, field, message}]}. All or nothing.
CREATE OR REPLACE FUNCTION public.import_employees(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_company uuid := public.current_user_company_id();
  v_errors  jsonb := '[]'::jsonb;
  r jsonb; i int := 0;
  v_branch uuid; v_wh uuid; v_mgr uuid; v_id uuid;
  v_codes text[] := ARRAY[]::text[];
  v_new   jsonb := '[]'::jsonb;
  v_num   text;
  err     text;
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_perm('payroll.write') THEN
    RAISE EXCEPTION 'You do not have permission to do this (needs payroll.write).' USING ERRCODE = '42501';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'The file has no rows.';
  END IF;
  IF jsonb_array_length(p_rows) > 2000 THEN
    RAISE EXCEPTION 'At most 2000 employees per import.';
  END IF;

  -- Pass 1: check everything.
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    i := i + 1;
    IF NULLIF(btrim(r->>'name'), '') IS NULL THEN
      v_errors := v_errors || jsonb_build_object('row', i, 'field', 'name', 'message', 'required');
    END IF;
    IF NULLIF(btrim(r->>'code'), '') IS NOT NULL THEN
      IF btrim(r->>'code') = ANY (v_codes) THEN
        v_errors := v_errors || jsonb_build_object('row', i, 'field', 'code', 'message', 'duplicate in file');
      ELSIF EXISTS (SELECT 1 FROM public.employees WHERE company_id = v_company AND code = btrim(r->>'code')) THEN
        v_errors := v_errors || jsonb_build_object('row', i, 'field', 'code', 'message', 'already used');
      END IF;
      v_codes := v_codes || btrim(r->>'code');
    END IF;
    IF NULLIF(btrim(r->>'branch'), '') IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.branches b WHERE b.company_id = v_company
            AND (lower(b.name) = lower(btrim(r->>'branch')) OR lower(b.code) = lower(btrim(r->>'branch')))) THEN
      v_errors := v_errors || jsonb_build_object('row', i, 'field', 'branch', 'message', 'not found');
    END IF;
    IF NULLIF(btrim(r->>'warehouse'), '') IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.warehouses w WHERE w.company_id = v_company
            AND (lower(w.name) = lower(btrim(r->>'warehouse')) OR lower(COALESCE(w.code, '')) = lower(btrim(r->>'warehouse')))) THEN
      v_errors := v_errors || jsonb_build_object('row', i, 'field', 'warehouse', 'message', 'not found');
    END IF;
    IF NULLIF(r->>'employment_type', '') IS NOT NULL AND r->>'employment_type' NOT IN
         ('permanent', 'probation', 'full_time', 'part_time', 'contract', 'temporary', 'intern') THEN
      v_errors := v_errors || jsonb_build_object('row', i, 'field', 'employment_type', 'message', 'unknown');
    END IF;
    IF NULLIF(r->>'gender', '') IS NOT NULL AND r->>'gender' NOT IN ('male', 'female') THEN
      v_errors := v_errors || jsonb_build_object('row', i, 'field', 'gender', 'message', 'unknown');
    END IF;
    IF NULLIF(r->>'joining_date', '') IS NOT NULL AND (r->>'joining_date') !~ '^\d{4}-\d{2}-\d{2}$' THEN
      v_errors := v_errors || jsonb_build_object('row', i, 'field', 'joining_date', 'message', 'use YYYY-MM-DD');
    END IF;
    FOREACH v_num IN ARRAY ARRAY['basic_salary', 'housing_allowance', 'transport_allowance', 'other_allowance'] LOOP
      IF NULLIF(r->>v_num, '') IS NOT NULL AND ((r->>v_num) !~ '^\d+(\.\d{1,2})?$') THEN
        v_errors := v_errors || jsonb_build_object('row', i, 'field', v_num, 'message', 'not a positive amount');
      END IF;
    END LOOP;
    IF NULLIF(btrim(r->>'manager_code'), '') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.employees WHERE company_id = v_company AND code = btrim(r->>'manager_code'))
       AND NOT (btrim(r->>'manager_code') = ANY (v_codes[1:cardinality(v_codes) - CASE WHEN NULLIF(btrim(r->>'code'), '') IS NULL THEN 0 ELSE 1 END])) THEN
      v_errors := v_errors || jsonb_build_object('row', i, 'field', 'manager_code', 'message', 'manager not found');
    END IF;
  END LOOP;

  IF jsonb_array_length(v_errors) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'imported', 0, 'errors', v_errors);
  END IF;

  -- Pass 2: insert (any failure here rolls back the whole import).
  i := 0;
  BEGIN
    FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
      i := i + 1;
      SELECT b.id INTO v_branch FROM public.branches b WHERE b.company_id = v_company
        AND (lower(b.name) = lower(btrim(r->>'branch')) OR lower(b.code) = lower(btrim(r->>'branch'))) LIMIT 1;
      SELECT w.id INTO v_wh FROM public.warehouses w WHERE w.company_id = v_company
        AND (lower(w.name) = lower(btrim(r->>'warehouse')) OR lower(COALESCE(w.code, '')) = lower(btrim(r->>'warehouse'))) LIMIT 1;
      INSERT INTO public.employees (company_id, code, name, name_ar, phone, email, designation, department,
          branch_id, warehouse_id, employment_type, joining_date, gender, nationality,
          basic_salary, housing_allowance, transport_allowance, other_allowance)
      VALUES (v_company, NULLIF(btrim(r->>'code'), ''), btrim(r->>'name'), NULLIF(btrim(r->>'name_ar'), ''),
          NULLIF(btrim(r->>'phone'), ''), NULLIF(btrim(r->>'email'), ''), NULLIF(btrim(r->>'designation'), ''),
          NULLIF(btrim(r->>'department'), ''), v_branch, v_wh, NULLIF(r->>'employment_type', ''),
          NULLIF(r->>'joining_date', '')::date, NULLIF(r->>'gender', ''), NULLIF(btrim(r->>'nationality'), ''),
          COALESCE(NULLIF(r->>'basic_salary', '')::numeric, 0), COALESCE(NULLIF(r->>'housing_allowance', '')::numeric, 0),
          COALESCE(NULLIF(r->>'transport_allowance', '')::numeric, 0), COALESCE(NULLIF(r->>'other_allowance', '')::numeric, 0))
      RETURNING id INTO v_id;
      v_branch := NULL; v_wh := NULL;
      v_new := v_new || jsonb_build_object('id', v_id, 'manager_code', NULLIF(btrim(r->>'manager_code'), ''));
    END LOOP;
    -- Managers last, so a row may name an earlier row's code.
    FOR r IN SELECT value FROM jsonb_array_elements(v_new) LOOP
      IF r->>'manager_code' IS NOT NULL THEN
        SELECT id INTO v_mgr FROM public.employees WHERE company_id = v_company AND code = r->>'manager_code';
        UPDATE public.employees SET reports_to_id = v_mgr WHERE id = (r->>'id')::uuid;
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
    RAISE EXCEPTION 'Import stopped at row %: %. Nothing was saved.', i, err;
  END;
  RETURN jsonb_build_object('ok', true, 'imported', jsonb_array_length(v_new), 'errors', '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.import_employees(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_employees(jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Check: new_columns = 7, events_table = 1, history_trigger = 1, import_fn = 1, anon_import = false.
SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'employees'
          AND column_name IN ('gender','marital_status','address','probation_end','confirmation_date','contract_start','contract_end')) AS new_columns,
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = 'employee_events') AS events_table,
       (SELECT count(*) FROM pg_trigger WHERE tgname = 'employees_z_history') AS history_trigger,
       (SELECT count(*) FROM pg_proc WHERE proname = 'import_employees') AS import_fn,
       has_function_privilege('anon', 'public.import_employees(jsonb)', 'execute') AS anon_import;
