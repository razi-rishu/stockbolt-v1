-- ═══════════════════════════════════════════════════════════════════════════
-- phase129 — one employee identity for Sales, Purchasing and Payroll
--
-- Before: two unrelated person tables. `employees` (payroll) and `salespeople`
-- (sales) shared nothing, so the same person was keyed twice and edits never
-- crossed over. Purchase orders had no staff link at all (buyer_id points at a
-- LOGIN profile and was never set).
--
-- After:
--   employees               the one person record (unchanged, + department,
--                           + is_purchaser).
--   salespeople             stays as the SALES ROLE of an employee:
--                           employee_id (unique), commission_pct. Every past
--                           invoice / quote / order / credit note keeps its
--                           salesperson_id, so no document is rewritten.
--                           name/name_ar/phone/email are kept in step with the
--                           employee by trigger, in the same transaction. That
--                           copy is deliberate: Sales users read salespeople,
--                           never employees (which carry salary + bank data).
--   purchase_orders         + purchaser_id → employees.
--
-- Server functions (SECURITY DEFINER, company-scoped, permission-checked,
-- never post to the ledger, never create a login):
--   search_staff(q)                           id / code / name / roles only
--   list_staff(role, include_inactive)        selector source for purchasers
--   create_staff(name, …, role, commission)   quick create from Sales / PO
--   assign_staff_role(employee, role, on, commission)
--   update_staff_basic(employee, name, …)     name / contact / commission
--   delete_employee(employee)                 only with no history at all
--
-- Permissions: sales role needs sales.write or settings.write; purchasing role
-- needs purchasing.write; removing a role, editing an employee not on the
-- caller's own role, and delete need payroll.write (admin-only from phase131).
--
-- History safety: the salesperson foreign keys on documents change from
-- ON DELETE SET NULL to RESTRICT. A salesperson who appears on any document
-- can no longer be deleted (which silently blanked the salesperson on every
-- past invoice); it is deactivated instead.
--
-- Linking existing salespeople to employees is a SEPARATE, reviewed step
-- (phase130). This migration links nothing.
--
-- SAFE TO APPLY: additive columns, new functions and triggers, four FK
-- actions tightened. One transaction; re-running is safe.
-- ROLLBACK: see the end of this file.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Columns ─────────────────────────────────────────────────────────────
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS department   text,
  ADD COLUMN IF NOT EXISTS is_purchaser boolean NOT NULL DEFAULT false;

ALTER TABLE public.salespeople
  ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES public.employees(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS salespeople_employee_id_key
  ON public.salespeople (employee_id) WHERE employee_id IS NOT NULL;

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS purchaser_id uuid REFERENCES public.employees(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS purchase_orders_purchaser_idx ON public.purchase_orders (purchaser_id);

-- ── 2. Documents keep their salesperson (SET NULL → RESTRICT) ──────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoices','sales_quotes','sales_orders','credit_notes'] LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_salesperson_id_fkey');
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (salesperson_id) REFERENCES public.salespeople(id) ON DELETE RESTRICT',
                   t, t || '_salesperson_id_fkey');
  END LOOP;
END $$;

-- ── 3. Keep the sales role in step with its employee ───────────────────────
-- Same company, and identity fields only change through the employee.
CREATE OR REPLACE FUNCTION public.tg_salespeople_employee_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE v_e public.employees%ROWTYPE;
BEGIN
  -- A salesperson added without an employee (Settings page, older app
  -- versions, imports) gets one, so every salesperson is an employee.
  IF TG_OP = 'INSERT' AND NEW.employee_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('employee_code:' || NEW.company_id::text));
    INSERT INTO public.employees (company_id, code, name, name_ar, phone, email, designation, is_active)
    VALUES (NEW.company_id, public._next_employee_code(NEW.company_id), btrim(NEW.name), NEW.name_ar,
            NEW.phone, NEW.email, 'Sales', NEW.is_active)
    RETURNING id INTO NEW.employee_id;
  END IF;
  IF NEW.employee_id IS NULL THEN RETURN NEW; END IF;
  -- Read the employee without RLS: a Sales user cannot read employees.
  SELECT * INTO v_e FROM public.employees WHERE id = NEW.employee_id;
  IF NOT FOUND OR v_e.company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'Salesperson and employee must belong to the same company.' USING ERRCODE = '42501';
  END IF;
  -- The employee is the master: copy its identity onto the sales role.
  NEW.name    := v_e.name;
  NEW.name_ar := v_e.name_ar;
  NEW.phone   := v_e.phone;
  NEW.email   := v_e.email;
  IF NOT v_e.is_active THEN NEW.is_active := false; END IF;
  RETURN NEW;
END;
$function$;
ALTER FUNCTION public.tg_salespeople_employee_guard() SECURITY DEFINER;

DROP TRIGGER IF EXISTS salespeople_employee_guard ON public.salespeople;
CREATE TRIGGER salespeople_employee_guard
  BEFORE INSERT OR UPDATE ON public.salespeople
  FOR EACH ROW EXECUTE FUNCTION public.tg_salespeople_employee_guard();

CREATE OR REPLACE FUNCTION public.tg_employees_sync_salespeople()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.name    IS DISTINCT FROM OLD.name
  OR NEW.name_ar IS DISTINCT FROM OLD.name_ar
  OR NEW.phone   IS DISTINCT FROM OLD.phone
  OR NEW.email   IS DISTINCT FROM OLD.email
  OR (OLD.is_active AND NOT NEW.is_active) THEN
    -- The salespeople guard re-copies the identity from the employee.
    UPDATE public.salespeople SET updated_at = now() WHERE employee_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS employees_sync_salespeople ON public.employees;
CREATE TRIGGER employees_sync_salespeople
  AFTER UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.tg_employees_sync_salespeople();

-- A purchaser must be an employee of the PO's company.
CREATE OR REPLACE FUNCTION public.tg_po_purchaser_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.purchaser_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.employees e
                      WHERE e.id = NEW.purchaser_id AND e.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'Purchaser must be an employee of the same company.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS purchase_orders_purchaser_guard ON public.purchase_orders;
CREATE TRIGGER purchase_orders_purchaser_guard
  BEFORE INSERT OR UPDATE OF purchaser_id ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_po_purchaser_guard();

-- ── 4. Helpers ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._next_employee_code(p_company_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT 'EMP-' || lpad((COALESCE(MAX(NULLIF(regexp_replace(code, '\D', '', 'g'), '')::bigint), 0) + 1)::text, 4, '0')
    FROM public.employees WHERE company_id = p_company_id;
$function$;

-- Caller may manage the given role: sales → sales.write or settings.write;
-- purchasing → purchasing.write. payroll.write (admin) may manage both.
CREATE OR REPLACE FUNCTION public._staff_role_allowed(p_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT public.has_perm('payroll.write')
      OR (p_role = 'sales'      AND (public.has_perm('sales.write') OR public.has_perm('settings.write')))
      OR (p_role = 'purchasing' AND public.has_perm('purchasing.write'));
$function$;

-- ── 5. search_staff — find an existing person before creating one ──────────
CREATE OR REPLACE FUNCTION public.search_staff(p_query text)
RETURNS TABLE (employee_id uuid, code text, name text, is_active boolean,
               has_sales boolean, is_purchaser boolean, salesperson_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_company uuid := public.current_user_company_id();
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public._staff_role_allowed('sales') OR public._staff_role_allowed('purchasing')) THEN
    RAISE EXCEPTION 'forbidden: requires sales.write or purchasing.write permission' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT e.id, e.code, e.name, e.is_active,
           (s.id IS NOT NULL AND s.is_active), e.is_purchaser, s.id
      FROM public.employees e
      LEFT JOIN public.salespeople s ON s.employee_id = e.id
     WHERE e.company_id = v_company
       AND (COALESCE(btrim(p_query), '') = ''
            OR e.name ILIKE '%' || btrim(p_query) || '%'
            OR e.code ILIKE '%' || btrim(p_query) || '%'
            OR e.phone ILIKE '%' || btrim(p_query) || '%')
     ORDER BY e.is_active DESC, e.name
     LIMIT 20;
END;
$function$;

-- ── 6. list_staff — selector source (no salary, no bank data) ──────────────
CREATE OR REPLACE FUNCTION public.list_staff(p_role text, p_include_inactive boolean DEFAULT false)
RETURNS TABLE (employee_id uuid, code text, name text, name_ar text, is_active boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_company uuid := public.current_user_company_id();
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('sales', 'purchasing') THEN
    RAISE EXCEPTION 'Unknown staff role %', p_role USING ERRCODE = 'P0001';
  END IF;
  IF NOT (public.has_perm(p_role || '.read') OR public.has_perm('payroll.read')) THEN
    RAISE EXCEPTION 'forbidden: requires %.read permission', p_role USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT e.id, e.code, e.name, e.name_ar, e.is_active
      FROM public.employees e
     WHERE e.company_id = v_company
       AND (p_include_inactive OR e.is_active)
       AND CASE p_role
             WHEN 'purchasing' THEN e.is_purchaser
             ELSE EXISTS (SELECT 1 FROM public.salespeople s
                           WHERE s.employee_id = e.id AND (p_include_inactive OR s.is_active))
           END
     ORDER BY e.name;
END;
$function$;

-- ── 7. create_staff — quick create from Sales / Purchasing ─────────────────
-- Basic identity only. No salary, no bank data, no login, no ledger posting.
CREATE OR REPLACE FUNCTION public.create_staff(
  p_name text, p_name_ar text, p_phone text, p_email text,
  p_role text, p_commission_pct numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid := public.current_user_company_id();
  v_emp     uuid;
  v_sp      uuid;
  v_code    text;
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('sales', 'purchasing') THEN
    RAISE EXCEPTION 'Unknown staff role %', p_role USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._staff_role_allowed(p_role) THEN
    RAISE EXCEPTION 'forbidden: you cannot add % staff', p_role USING ERRCODE = '42501';
  END IF;
  IF COALESCE(btrim(p_name), '') = '' THEN
    RAISE EXCEPTION 'Name is required.' USING ERRCODE = 'P0001';
  END IF;
  IF p_commission_pct IS NOT NULL AND (p_commission_pct < 0 OR p_commission_pct > 100) THEN
    RAISE EXCEPTION 'Commission must be between 0 and 100.' USING ERRCODE = 'P0001';
  END IF;

  -- Serialise code allocation per company (unique company_id + code).
  PERFORM pg_advisory_xact_lock(hashtext('employee_code:' || v_company::text));
  v_code := public._next_employee_code(v_company);

  INSERT INTO public.employees (company_id, code, name, name_ar, phone, email, designation, is_purchaser)
  VALUES (v_company, v_code, btrim(p_name), NULLIF(btrim(p_name_ar), ''), NULLIF(btrim(p_phone), ''),
          NULLIF(btrim(p_email), ''),
          CASE p_role WHEN 'sales' THEN 'Sales' ELSE 'Purchasing' END,
          p_role = 'purchasing')
  RETURNING id INTO v_emp;

  IF p_role = 'sales' THEN
    INSERT INTO public.salespeople (company_id, employee_id, name, commission_pct, is_active)
    VALUES (v_company, v_emp, btrim(p_name), COALESCE(p_commission_pct, 0), true)
    RETURNING id INTO v_sp;
  END IF;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company, auth.uid(), 'create', 'employee', v_emp,
            jsonb_build_object('code', v_code, 'name', btrim(p_name), 'role', p_role, 'phase', 'phase129'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('employee_id', v_emp, 'salesperson_id', v_sp, 'code', v_code);
END;
$function$;

-- ── 8. assign_staff_role — give or take a role from an existing employee ──
CREATE OR REPLACE FUNCTION public.assign_staff_role(
  p_employee_id uuid, p_role text, p_on boolean, p_commission_pct numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid := public.current_user_company_id();
  v_e       public.employees%ROWTYPE;
  v_sp      uuid;
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('sales', 'purchasing') THEN
    RAISE EXCEPTION 'Unknown staff role %', p_role USING ERRCODE = 'P0001';
  END IF;
  -- Giving a role: the role's own write permission. Taking it away: payroll.
  IF (p_on AND NOT public._staff_role_allowed(p_role))
     OR (NOT p_on AND NOT public.has_perm('payroll.write')) THEN
    RAISE EXCEPTION 'forbidden: you cannot change this staff role' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_e FROM public.employees WHERE id = p_employee_id AND company_id = v_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found.' USING ERRCODE = 'P0001'; END IF;
  IF p_on AND NOT v_e.is_active THEN
    RAISE EXCEPTION 'This employee is inactive. Reactivate them first.' USING ERRCODE = 'P0001';
  END IF;
  IF p_commission_pct IS NOT NULL AND (p_commission_pct < 0 OR p_commission_pct > 100) THEN
    RAISE EXCEPTION 'Commission must be between 0 and 100.' USING ERRCODE = 'P0001';
  END IF;

  IF p_role = 'sales' THEN
    SELECT id INTO v_sp FROM public.salespeople WHERE employee_id = v_e.id;
    IF v_sp IS NULL AND p_on THEN
      INSERT INTO public.salespeople (company_id, employee_id, name, commission_pct, is_active)
      VALUES (v_company, v_e.id, v_e.name, COALESCE(p_commission_pct, 0), true)
      RETURNING id INTO v_sp;
    ELSIF v_sp IS NOT NULL THEN
      UPDATE public.salespeople
         SET is_active = p_on,
             commission_pct = COALESCE(p_commission_pct, commission_pct),
             updated_at = now()
       WHERE id = v_sp;
    END IF;
  ELSE
    UPDATE public.employees SET is_purchaser = p_on, updated_at = now() WHERE id = v_e.id;
  END IF;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company, auth.uid(), 'update', 'employee', v_e.id,
            jsonb_build_object('role', p_role, 'on', p_on, 'phase', 'phase129'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('employee_id', v_e.id, 'salesperson_id', v_sp, 'role', p_role, 'on', p_on);
END;
$function$;

-- ── 9. update_staff_basic — name / contact / commission ───────────────────
-- From Settings → Salespeople (settings.write, salespeople only) or Payroll.
CREATE OR REPLACE FUNCTION public.update_staff_basic(
  p_employee_id uuid, p_name text, p_name_ar text, p_phone text, p_email text,
  p_commission_pct numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid := public.current_user_company_id();
  v_has_sales boolean;
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_employee_id AND company_id = v_company) THEN
    RAISE EXCEPTION 'Employee not found.' USING ERRCODE = 'P0001';
  END IF;
  v_has_sales := EXISTS (SELECT 1 FROM public.salespeople WHERE employee_id = p_employee_id);
  IF NOT (public.has_perm('payroll.write') OR (v_has_sales AND public.has_perm('settings.write'))) THEN
    RAISE EXCEPTION 'forbidden: you cannot edit this employee' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(btrim(p_name), '') = '' THEN
    RAISE EXCEPTION 'Name is required.' USING ERRCODE = 'P0001';
  END IF;
  IF p_commission_pct IS NOT NULL AND (p_commission_pct < 0 OR p_commission_pct > 100) THEN
    RAISE EXCEPTION 'Commission must be between 0 and 100.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.employees
     SET name = btrim(p_name), name_ar = NULLIF(btrim(p_name_ar), ''),
         phone = NULLIF(btrim(p_phone), ''), email = NULLIF(btrim(p_email), ''),
         updated_at = now()
   WHERE id = p_employee_id;

  IF p_commission_pct IS NOT NULL THEN
    UPDATE public.salespeople SET commission_pct = p_commission_pct, updated_at = now()
     WHERE employee_id = p_employee_id;
  END IF;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company, auth.uid(), 'update', 'employee', p_employee_id,
            jsonb_build_object('name', btrim(p_name), 'phase', 'phase129'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END;
$function$;

-- ── 10. delete_employee — only a record made by mistake ───────────────────
CREATE OR REPLACE FUNCTION public.delete_employee(p_employee_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid := public.current_user_company_id();
  v_e  public.employees%ROWTYPE;
  v_sp uuid;
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.auth_require('payroll.write');

  SELECT * INTO v_e FROM public.employees WHERE id = p_employee_id AND company_id = v_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found.' USING ERRCODE = 'P0001'; END IF;
  SELECT id INTO v_sp FROM public.salespeople WHERE employee_id = v_e.id;

  IF EXISTS (SELECT 1 FROM public.payroll_run_items     WHERE employee_id = v_e.id)
  OR EXISTS (SELECT 1 FROM public.employee_loans        WHERE employee_id = v_e.id)
  OR EXISTS (SELECT 1 FROM public.leave_salary_payments WHERE employee_id = v_e.id)
  OR EXISTS (SELECT 1 FROM public.journal_entries       WHERE company_id = v_company AND source_id = v_e.id)
  OR EXISTS (SELECT 1 FROM public.purchase_orders       WHERE purchaser_id = v_e.id)
  OR (v_sp IS NOT NULL AND (
        EXISTS (SELECT 1 FROM public.invoices     WHERE salesperson_id = v_sp)
     OR EXISTS (SELECT 1 FROM public.sales_quotes WHERE salesperson_id = v_sp)
     OR EXISTS (SELECT 1 FROM public.sales_orders WHERE salesperson_id = v_sp)
     OR EXISTS (SELECT 1 FROM public.credit_notes WHERE salesperson_id = v_sp)))
  THEN
    RAISE EXCEPTION 'This employee has payroll or document history and cannot be deleted. Mark them inactive instead.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_sp IS NOT NULL THEN DELETE FROM public.salespeople WHERE id = v_sp; END IF;
  DELETE FROM public.employees WHERE id = v_e.id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, old_data)
    VALUES (v_company, auth.uid(), 'delete', 'employee', v_e.id,
            jsonb_build_object('code', v_e.code, 'name', v_e.name, 'phase', 'phase129'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END;
$function$;

-- ── 11. Grants ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.tg_salespeople_employee_guard()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_employees_sync_salespeople()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_po_purchaser_guard()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._next_employee_code(uuid)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._staff_role_allowed(text)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.search_staff(text)                                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_staff(text, boolean)                             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_staff(text, text, text, text, text, numeric)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_staff_role(uuid, text, boolean, numeric)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_staff_basic(uuid, text, text, text, text, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_employee(uuid)                                 FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._staff_role_allowed(text)                           TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_staff(text)                                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_staff(text, boolean)                           TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_staff(text, text, text, text, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_staff_role(uuid, text, boolean, numeric)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_staff_basic(uuid, text, text, text, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_employee(uuid)                               TO authenticated;

COMMIT;

-- ── Verify after applying (read-only) — expect all true ───────────────────
-- SELECT
--   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='salespeople' AND column_name='employee_id') AS sp_link,
--   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='purchase_orders' AND column_name='purchaser_id') AS po_link,
--   to_regprocedure('public.create_staff(text,text,text,text,text,numeric)') IS NOT NULL AS create_fn,
--   (SELECT bool_and(pg_get_constraintdef(oid) LIKE '%ON DELETE RESTRICT%') FROM pg_constraint
--     WHERE conname IN ('invoices_salesperson_id_fkey','sales_quotes_salesperson_id_fkey',
--                       'sales_orders_salesperson_id_fkey','credit_notes_salesperson_id_fkey')) AS docs_restrict;
--
-- ROLLBACK (only before any employee is linked or any PO has a purchaser):
--   DROP FUNCTION public.delete_employee(uuid), public.update_staff_basic(uuid,text,text,text,text,numeric),
--     public.assign_staff_role(uuid,text,boolean,numeric), public.create_staff(text,text,text,text,text,numeric),
--     public.list_staff(text,boolean), public.search_staff(text), public._staff_role_allowed(text),
--     public._next_employee_code(uuid);
--   DROP TRIGGER purchase_orders_purchaser_guard ON public.purchase_orders;
--   DROP TRIGGER employees_sync_salespeople ON public.employees;
--   DROP TRIGGER salespeople_employee_guard ON public.salespeople;
--   DROP FUNCTION public.tg_po_purchaser_guard(), public.tg_employees_sync_salespeople(), public.tg_salespeople_employee_guard();
--   ALTER TABLE public.purchase_orders DROP COLUMN purchaser_id;
--   ALTER TABLE public.salespeople DROP COLUMN employee_id;
--   ALTER TABLE public.employees DROP COLUMN is_purchaser, DROP COLUMN department;
--   (the four salesperson FKs may be put back to ON DELETE SET NULL)
