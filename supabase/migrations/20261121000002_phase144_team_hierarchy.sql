-- ═══════════════════════════════════════════════════════════════════════════
-- phase144 — Team: employee codes, who-reports-to-whom, logins ↔ employees
--
-- Part 1 of Approvals (plan approved 2026-11-21). Approvals itself is phase145;
-- this migration only builds the people structure it routes along.
--
--   employees.reports_to_id   the manager. One person per company has none:
--                             the top (owner / CEO). No self, no loops, same
--                             company. A new employee reports to the top until
--                             an admin moves them.
--   employees.user_id         the login (profiles) this employee signs in with.
--                             One login ↔ one employee, same company. Many
--                             employees never log in.
--   employees.include_in_payroll
--                             false for the owner record created below, so a
--                             payroll run doesn't gain a zero-salary line.
--   companies.employee_code_prefix / _digits / _start
--                             code format for NEW employees. Default EMP- / 4 /
--                             1 gives EMP-0001, exactly as before. Existing
--                             codes never change.
--
-- Existing companies: the earliest admin becomes the top employee (linked to
-- their existing employee by email, otherwise a new record "Owner / CEO",
-- outside payroll); every other employee reports to them; logins whose email
-- matches exactly one employee are linked. New companies: the first admin to
-- join becomes the top employee automatically.
--
-- Server functions (SECURITY DEFINER, company-scoped, never post to the GL):
--   list_team(include_inactive)            org chart: code / name / title /
--                                          department / manager only — never
--                                          salary, IBAN or ID numbers. Any
--                                          member may read it; login details
--                                          only for users.manage.
--   next_employee_code()                   preview of the next code
--   set_employee_manager(employee, manager)   users.manage
--   set_team_top(employee)                 users.manage
--   update_employee_position(employee, title, department)   users.manage
--   link_employee_user(employee, user|null)   users.manage
--
-- Nothing here touches documents, postings, stock or payroll amounts.
-- SAFE TO APPLY: additive columns, functions and triggers; one transaction;
-- re-running is safe. ROLLBACK: end of file.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Columns ─────────────────────────────────────────────────────────────
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS reports_to_id      uuid REFERENCES public.employees(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS user_id            uuid REFERENCES public.profiles(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS include_in_payroll boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS employees_reports_to_id_idx ON public.employees (reports_to_id);
CREATE INDEX IF NOT EXISTS employees_company_top_idx   ON public.employees (company_id) WHERE reports_to_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS employees_user_id_key ON public.employees (user_id) WHERE user_id IS NOT NULL;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS employee_code_prefix text   NOT NULL DEFAULT 'EMP-',
  ADD COLUMN IF NOT EXISTS employee_code_digits integer NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS employee_code_start  bigint  NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_employee_code_format_check') THEN
    ALTER TABLE public.companies ADD CONSTRAINT companies_employee_code_format_check CHECK (
      employee_code_prefix ~ '^[A-Za-z0-9/_.-]{0,10}$'
      AND employee_code_digits BETWEEN 1 AND 8
      AND employee_code_start BETWEEN 1 AND 99999999);
  END IF;
END $$;

COMMENT ON COLUMN public.employees.reports_to_id IS 'phase144 — manager; NULL only for the company''s top person (one per company).';
COMMENT ON COLUMN public.employees.user_id IS 'phase144 — the login (profiles.id) this employee uses; one login per employee.';
COMMENT ON COLUMN public.employees.include_in_payroll IS 'phase144 — false keeps the employee out of new payroll runs (e.g. the auto-created owner).';

-- ── 2. Code generator — now follows the company's code format ─────────────
-- Same result as before for the default format (EMP- / 4 digits).
CREATE OR REPLACE FUNCTION public._next_employee_code(p_company_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_prefix text := 'EMP-';
  v_digits integer := 4;
  v_start  bigint := 1;
  v_max    bigint;
  v_n      bigint;
BEGIN
  SELECT c.employee_code_prefix, c.employee_code_digits, c.employee_code_start
    INTO v_prefix, v_digits, v_start
    FROM public.companies c WHERE c.id = p_company_id;
  v_prefix := COALESCE(v_prefix, 'EMP-');
  v_digits := COALESCE(v_digits, 4);
  v_start  := COALESCE(v_start, 1);

  SELECT MAX(substr(e.code, length(v_prefix) + 1)::bigint) INTO v_max
    FROM public.employees e
   WHERE e.company_id = p_company_id
     AND upper(left(e.code, length(v_prefix))) = upper(v_prefix)
     AND substr(e.code, length(v_prefix) + 1) ~ '^[0-9]{1,15}$';

  v_n := GREATEST(v_start, COALESCE(v_max, 0) + 1);
  RETURN v_prefix || CASE WHEN length(v_n::text) >= v_digits THEN v_n::text
                          ELSE lpad(v_n::text, v_digits, '0') END;
END;
$function$;

-- ── 3. The top person of a company (creates the owner record if needed) ───
CREATE OR REPLACE FUNCTION public._ensure_company_top(p_company_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_top   uuid;
  v_owner public.profiles%ROWTYPE;
BEGIN
  SELECT id INTO v_top FROM public.employees
   WHERE company_id = p_company_id AND reports_to_id IS NULL
   ORDER BY (user_id IS NOT NULL) DESC, created_at LIMIT 1;

  -- The owner = the earliest admin login of the company.
  SELECT * INTO v_owner FROM public.profiles
   WHERE company_id = p_company_id AND role = 'admin'
   ORDER BY created_at, id LIMIT 1;

  IF v_owner.id IS NULL THEN
    RETURN v_top;                         -- no admin: keep whatever top exists
  END IF;

  -- The owner's own employee record: already linked, or the one with their email.
  SELECT id INTO v_top FROM public.employees
   WHERE company_id = p_company_id AND user_id = v_owner.id;
  IF v_top IS NULL AND COALESCE(v_owner.email, '') <> '' THEN
    SELECT id INTO v_top FROM public.employees
     WHERE company_id = p_company_id AND user_id IS NULL
       AND lower(btrim(email)) = lower(btrim(v_owner.email))
       AND (SELECT count(*) FROM public.employees x
             WHERE x.company_id = p_company_id AND lower(btrim(x.email)) = lower(btrim(v_owner.email))) = 1;
    IF v_top IS NOT NULL THEN
      UPDATE public.employees SET user_id = v_owner.id WHERE id = v_top;
    END IF;
  END IF;

  IF v_top IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('employee_code:' || p_company_id::text));
    INSERT INTO public.employees (company_id, code, name, email, designation, department,
                                  user_id, include_in_payroll)
    VALUES (p_company_id, public._next_employee_code(p_company_id),
            COALESCE(NULLIF(btrim(v_owner.full_name), ''), NULLIF(split_part(v_owner.email, '@', 1), ''), 'Owner'),
            NULLIF(btrim(v_owner.email), ''), 'Owner / CEO', 'Management', v_owner.id, false)
    RETURNING id INTO v_top;
  END IF;
  RETURN v_top;
END;
$function$;

-- ── 4. Existing companies: link logins, set the top, everyone reports to it ──
-- Runs before the hierarchy triggers exist, so nothing is re-routed mid-way.
WITH emp AS (
  SELECT e.id, e.company_id, lower(btrim(e.email)) AS em,
         count(*) OVER (PARTITION BY e.company_id, lower(btrim(e.email))) AS n
    FROM public.employees e
   WHERE e.user_id IS NULL AND COALESCE(btrim(e.email), '') <> ''
), pro AS (
  SELECT p.id, p.company_id, lower(btrim(p.email)) AS em,
         count(*) OVER (PARTITION BY p.company_id, lower(btrim(p.email))) AS n
    FROM public.profiles p
   WHERE p.company_id IS NOT NULL AND COALESCE(btrim(p.email), '') <> ''
     AND NOT EXISTS (SELECT 1 FROM public.employees x WHERE x.user_id = p.id)
)
UPDATE public.employees e SET user_id = pro.id
  FROM emp JOIN pro ON pro.company_id = emp.company_id AND pro.em = emp.em
 WHERE e.id = emp.id AND emp.n = 1 AND pro.n = 1;

DO $$
DECLARE
  c   record;
  top uuid;
BEGIN
  FOR c IN
    SELECT co.id FROM public.companies co
     WHERE EXISTS (SELECT 1 FROM public.employees e WHERE e.company_id = co.id)
        OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.company_id = co.id AND p.role = 'admin')
  LOOP
    top := public._ensure_company_top(c.id);
    IF top IS NULL THEN
      SELECT id INTO top FROM public.employees WHERE company_id = c.id ORDER BY created_at, code LIMIT 1;
    END IF;
    IF top IS NOT NULL THEN
      UPDATE public.employees SET reports_to_id = NULL WHERE id = top AND reports_to_id IS NOT NULL;
      UPDATE public.employees SET reports_to_id = top
       WHERE company_id = c.id AND id <> top AND reports_to_id IS NULL;
    END IF;
  END LOOP;
END $$;

-- ── 5. Rules, from here on ─────────────────────────────────────────────────
-- 5a. A code is always assigned (callers may still pass their own).
CREATE OR REPLACE FUNCTION public.tg_employees_code_default()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(btrim(NEW.code), '') = '' THEN
    PERFORM pg_advisory_xact_lock(hashtext('employee_code:' || NEW.company_id::text));
    NEW.code := public._next_employee_code(NEW.company_id);
  ELSE
    NEW.code := btrim(NEW.code);
  END IF;
  RETURN NEW;
END;
$function$;

-- 5b. Manager and login must make sense.
CREATE OR REPLACE FUNCTION public.tg_employees_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cursor uuid;
  v_steps  integer := 0;
BEGIN
  -- A new employee with no manager reports to the top person (if one exists).
  IF TG_OP = 'INSERT' AND NEW.reports_to_id IS NULL THEN
    SELECT id INTO NEW.reports_to_id FROM public.employees
     WHERE company_id = NEW.company_id AND reports_to_id IS NULL AND id <> NEW.id
     ORDER BY created_at LIMIT 1;
  END IF;

  IF NEW.reports_to_id IS NOT NULL THEN
    IF NEW.reports_to_id = NEW.id THEN
      RAISE EXCEPTION 'An employee cannot report to themselves.' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.employees m
                    WHERE m.id = NEW.reports_to_id AND m.company_id = NEW.company_id) THEN
      RAISE EXCEPTION 'The manager must be an employee of the same company.' USING ERRCODE = 'P0001';
    END IF;
    -- Walk up from the new manager; reaching this employee means a loop.
    v_cursor := NEW.reports_to_id;
    WHILE v_cursor IS NOT NULL LOOP
      IF v_cursor = NEW.id THEN
        RAISE EXCEPTION 'That would make a loop: % already reports (directly or not) to this employee.',
          (SELECT code || ' ' || name FROM public.employees WHERE id = NEW.reports_to_id) USING ERRCODE = 'P0001';
      END IF;
      v_steps := v_steps + 1;
      IF v_steps > 1000 THEN
        RAISE EXCEPTION 'The reporting line is too deep.' USING ERRCODE = 'P0001';
      END IF;
      SELECT reports_to_id INTO v_cursor FROM public.employees WHERE id = v_cursor;
    END LOOP;
  END IF;

  IF NEW.user_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.profiles p WHERE p.id = NEW.user_id AND p.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'That login does not belong to this company.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

-- 5c. One top person per company — checked at commit, so set_team_top can swap.
CREATE OR REPLACE FUNCTION public.tg_employees_single_top()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF (SELECT count(*) FROM public.employees
       WHERE company_id = NEW.company_id AND reports_to_id IS NULL) > 1 THEN
    RAISE EXCEPTION 'A company has one top person; everyone else needs a manager.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END;
$function$;

-- 5d. Deleting a manager moves their team up one level; the top can't go
--     while anyone reports to them.
CREATE OR REPLACE FUNCTION public.tg_employees_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.reports_to_id IS NULL AND EXISTS (SELECT 1 FROM public.employees WHERE reports_to_id = OLD.id) THEN
    RAISE EXCEPTION 'This is the top person of the company. Make someone else the top first.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.employees SET reports_to_id = OLD.reports_to_id WHERE reports_to_id = OLD.id;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS employees_a_code_default ON public.employees;
CREATE TRIGGER employees_a_code_default
  BEFORE INSERT ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.tg_employees_code_default();

DROP TRIGGER IF EXISTS employees_b_hierarchy ON public.employees;
CREATE TRIGGER employees_b_hierarchy
  BEFORE INSERT OR UPDATE OF reports_to_id, user_id, company_id ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.tg_employees_hierarchy();

DROP TRIGGER IF EXISTS employees_single_top ON public.employees;
CREATE CONSTRAINT TRIGGER employees_single_top
  AFTER INSERT OR UPDATE OF reports_to_id ON public.employees
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.tg_employees_single_top();

DROP TRIGGER IF EXISTS employees_before_delete_team ON public.employees;
CREATE TRIGGER employees_before_delete_team
  BEFORE DELETE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.tg_employees_before_delete();

-- 5e. New companies: the first admin to join becomes the top employee.
--     Never blocks sign-up: a failure here is logged and onboarding carries on.
CREATE OR REPLACE FUNCTION public.tg_profiles_team_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.company_id IS NOT NULL AND NEW.role = 'admin'
     AND NOT EXISTS (SELECT 1 FROM public.employees WHERE company_id = NEW.company_id) THEN
    BEGIN
      PERFORM public._ensure_company_top(NEW.company_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'phase144: could not create the owner employee for company %: %', NEW.company_id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS profiles_team_owner ON public.profiles;
CREATE TRIGGER profiles_team_owner
  AFTER INSERT OR UPDATE OF company_id, role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_profiles_team_owner();

-- ── 6. Server functions ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._team_guard(p_manage boolean)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid := public.current_user_company_id();
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  IF p_manage AND NOT public.has_perm('users.manage') THEN
    RAISE EXCEPTION 'forbidden: only an admin can change the team' USING ERRCODE = '42501';
  END IF;
  RETURN v_company;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_team(p_include_inactive boolean DEFAULT false)
RETURNS TABLE(employee_id uuid, code text, name text, name_ar text, designation text, department text,
              reports_to_id uuid, is_active boolean, has_sales boolean, is_purchaser boolean,
              user_id uuid, user_name text, user_email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid := public._team_guard(false);
  v_admin   boolean := public.has_perm('users.manage');
BEGIN
  RETURN QUERY
    SELECT e.id, e.code, e.name, e.name_ar, e.designation, e.department, e.reports_to_id, e.is_active,
           EXISTS (SELECT 1 FROM public.salespeople s WHERE s.employee_id = e.id AND s.is_active),
           e.is_purchaser,
           CASE WHEN v_admin THEN e.user_id END,
           CASE WHEN v_admin THEN p.full_name END,
           CASE WHEN v_admin THEN p.email END
      FROM public.employees e
      LEFT JOIN public.profiles p ON p.id = e.user_id
     WHERE e.company_id = v_company
       AND (p_include_inactive OR e.is_active OR e.reports_to_id IS NULL)
     ORDER BY e.code;
END;
$function$;

CREATE OR REPLACE FUNCTION public.next_employee_code()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public._next_employee_code(public._team_guard(false));
END;
$function$;

CREATE OR REPLACE FUNCTION public._team_audit(p_company uuid, p_employee uuid, p_old jsonb, p_new jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, old_data, new_data)
  VALUES (p_company, auth.uid(), 'update', 'employee', p_employee, p_old, p_new || jsonb_build_object('phase', 'phase144'));
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_employee_manager(p_employee_id uuid, p_manager_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid := public._team_guard(true);
  v_old     uuid;
BEGIN
  IF p_manager_id IS NULL THEN
    RAISE EXCEPTION 'Choose a manager. To make someone the top person, use "Make top".' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('team:' || v_company::text));
  SELECT reports_to_id INTO v_old FROM public.employees WHERE id = p_employee_id AND company_id = v_company;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'This is the top person of the company. Make someone else the top first.' USING ERRCODE = 'P0001';
  END IF;
  IF v_old = p_manager_id THEN RETURN; END IF;
  UPDATE public.employees SET reports_to_id = p_manager_id, updated_at = now()
   WHERE id = p_employee_id AND company_id = v_company;
  PERFORM public._team_audit(v_company, p_employee_id,
    jsonb_build_object('reports_to_id', v_old), jsonb_build_object('reports_to_id', p_manager_id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_team_top(p_employee_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid := public._team_guard(true);
  v_old_top uuid;
  v_active  boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('team:' || v_company::text));
  SELECT is_active INTO v_active FROM public.employees WHERE id = p_employee_id AND company_id = v_company;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_active THEN
    RAISE EXCEPTION 'An inactive employee cannot be the top person.' USING ERRCODE = 'P0001';
  END IF;
  SELECT id INTO v_old_top FROM public.employees WHERE company_id = v_company AND reports_to_id IS NULL;
  IF v_old_top = p_employee_id THEN RETURN; END IF;
  -- The new top leaves its manager; the old top then reports to the new one.
  -- The one-top rule is checked at commit, after both steps.
  UPDATE public.employees SET reports_to_id = NULL, updated_at = now() WHERE id = p_employee_id;
  IF v_old_top IS NOT NULL THEN
    UPDATE public.employees SET reports_to_id = p_employee_id, updated_at = now() WHERE id = v_old_top;
  END IF;
  PERFORM public._team_audit(v_company, p_employee_id,
    jsonb_build_object('top', v_old_top), jsonb_build_object('top', p_employee_id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_employee_position(p_employee_id uuid, p_designation text, p_department text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid := public._team_guard(true);
  v_old     public.employees%ROWTYPE;
  v_title   text := NULLIF(btrim(p_designation), '');
  v_dept    text := NULLIF(btrim(p_department), '');
BEGIN
  IF length(COALESCE(v_title, '')) > 80 OR length(COALESCE(v_dept, '')) > 80 THEN
    RAISE EXCEPTION 'Job title and department are limited to 80 characters.' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_old FROM public.employees WHERE id = p_employee_id AND company_id = v_company;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found.' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.employees SET designation = v_title, department = v_dept, updated_at = now()
   WHERE id = p_employee_id;
  PERFORM public._team_audit(v_company, p_employee_id,
    jsonb_build_object('designation', v_old.designation, 'department', v_old.department),
    jsonb_build_object('designation', v_title, 'department', v_dept));
END;
$function$;

CREATE OR REPLACE FUNCTION public.link_employee_user(p_employee_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid := public._team_guard(true);
  v_old     uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('team:' || v_company::text));
  SELECT user_id INTO v_old FROM public.employees WHERE id = p_employee_id AND company_id = v_company;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found.' USING ERRCODE = 'P0002';
  END IF;
  IF p_user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND company_id = v_company) THEN
      RAISE EXCEPTION 'That login does not belong to this company.' USING ERRCODE = 'P0001';
    END IF;
    -- One login ↔ one employee: release it from whoever had it.
    UPDATE public.employees SET user_id = NULL, updated_at = now()
     WHERE company_id = v_company AND user_id = p_user_id AND id <> p_employee_id;
  END IF;
  UPDATE public.employees SET user_id = p_user_id, updated_at = now() WHERE id = p_employee_id;
  PERFORM public._team_audit(v_company, p_employee_id,
    jsonb_build_object('user_id', v_old), jsonb_build_object('user_id', p_user_id));
END;
$function$;

-- ── 7. Grants ──────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._next_employee_code(uuid)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ensure_company_top(uuid)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_employees_code_default()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_employees_hierarchy()           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_employees_single_top()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_employees_before_delete()       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_profiles_team_owner()           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._team_guard(boolean)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._team_audit(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_team(boolean)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.next_employee_code()                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_employee_manager(uuid, uuid)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_team_top(uuid)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_employee_position(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.link_employee_user(uuid, uuid)        FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_team(boolean)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_employee_code()                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_employee_manager(uuid, uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_team_top(uuid)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_employee_position(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_employee_user(uuid, uuid)        TO authenticated;

COMMIT;

-- ── Verify after applying (read-only) — expect: no_top_missing = companies_with_people,
--    extra_tops = 0, loops = 0 ────────────────────────────────────────────────
-- SELECT
--   (SELECT count(DISTINCT company_id) FROM public.employees)                                   AS companies_with_people,
--   (SELECT count(DISTINCT company_id) FROM public.employees WHERE reports_to_id IS NULL)       AS no_top_missing,
--   (SELECT count(*) FROM (SELECT company_id FROM public.employees WHERE reports_to_id IS NULL
--                           GROUP BY company_id HAVING count(*) > 1) x)                         AS extra_tops,
--   (SELECT count(*) FROM public.employees WHERE reports_to_id = id)                            AS loops,
--   (SELECT count(*) FROM public.employees WHERE user_id IS NOT NULL)                           AS linked_logins;

-- ── ROLLBACK (removes the team structure; employee rows created for owners stay) ──
-- BEGIN;
-- DROP TRIGGER IF EXISTS profiles_team_owner ON public.profiles;
-- DROP TRIGGER IF EXISTS employees_a_code_default ON public.employees;
-- DROP TRIGGER IF EXISTS employees_b_hierarchy ON public.employees;
-- DROP TRIGGER IF EXISTS employees_single_top ON public.employees;
-- DROP TRIGGER IF EXISTS employees_before_delete_team ON public.employees;
-- DROP FUNCTION IF EXISTS public.list_team(boolean), public.next_employee_code(), public.set_employee_manager(uuid, uuid),
--   public.set_team_top(uuid), public.update_employee_position(uuid, text, text), public.link_employee_user(uuid, uuid),
--   public._team_guard(boolean), public._team_audit(uuid, uuid, jsonb, jsonb), public.tg_profiles_team_owner(),
--   public.tg_employees_code_default(), public.tg_employees_hierarchy(), public.tg_employees_single_top(),
--   public.tg_employees_before_delete(), public._ensure_company_top(uuid);
-- ALTER TABLE public.employees DROP COLUMN IF EXISTS reports_to_id, DROP COLUMN IF EXISTS user_id,
--   DROP COLUMN IF EXISTS include_in_payroll;
-- ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_employee_code_format_check,
--   DROP COLUMN IF EXISTS employee_code_prefix, DROP COLUMN IF EXISTS employee_code_digits,
--   DROP COLUMN IF EXISTS employee_code_start;
-- -- then re-create _next_employee_code from phase129 (EMP- + 4 digits).
-- COMMIT;
