-- ═══════════════════════════════════════════════════════════════════════════
-- phase130 — link every existing salesperson to an employee (needs phase129)
--
-- Reviewed by Rashid on 2026-11-15 from a read-only production listing.
--
-- 1. LINK: a salesperson whose name matches exactly ONE employee of the same
--    company (case and outer spaces ignored). Production had exactly three,
--    each confirmed by Rashid:
--      Al Noor                     HUSSAIN  → EMP-0003 HUSSAIN
--      AL RUFOUF AUTO SPARE PARTS  Babu     → EMP-0001 Babu
--      Pro_Parts                   HUSSAIN  → EMP-0002 Hussain
--    A name that matches two or more employees is NOT linked by name; it is
--    treated like step 2 and listed by the verify query for a manual check.
--
-- 2. CREATE: every other salesperson gets a new employee (next EMP- code,
--    designation 'Sales', same name/contact, same active flag). Production
--    had four: RASID (ABIDB TRADING LLC), HAMEED (IMBD123), Fadil and
--    Sidheeque (ORVELLA EVENTS).
--
-- 3. salespeople.employee_id becomes NOT NULL: from now on no salesperson
--    can exist without an employee (phase129 creates one on insert).
--
-- No document, payroll row or ledger row is touched. salesperson_id on every
-- invoice / quote / order / credit note is unchanged.
--
-- SAFE TO APPLY: only rows with employee_id IS NULL are touched, so re-running
-- is a no-op. One transaction.
-- ROLLBACK: ALTER TABLE public.salespeople ALTER COLUMN employee_id DROP NOT NULL;
--   then, if wanted: UPDATE salespeople SET employee_id = NULL and delete the
--   employees created here (audit_logs rows with new_data->>'phase' = 'phase130'
--   and action 'create' list them).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Link the unambiguous name matches.
WITH m AS (
  SELECT s.id AS sp_id, MIN(e.id::text)::uuid AS emp_id, COUNT(*) AS n
    FROM public.salespeople s
    JOIN public.employees e
      ON e.company_id = s.company_id AND lower(btrim(e.name)) = lower(btrim(s.name))
   WHERE s.employee_id IS NULL
   GROUP BY s.id
)
UPDATE public.salespeople s
   SET employee_id = m.emp_id, updated_at = now()
  FROM m
 WHERE s.id = m.sp_id AND m.n = 1
   AND NOT EXISTS (SELECT 1 FROM public.salespeople x WHERE x.employee_id = m.emp_id);

-- 2. Create an employee for every salesperson still unlinked.
DO $$
DECLARE r record; v_emp uuid;
BEGIN
  FOR r IN SELECT * FROM public.salespeople WHERE employee_id IS NULL ORDER BY company_id, created_at LOOP
    INSERT INTO public.employees (company_id, code, name, name_ar, phone, email, designation, is_active)
    VALUES (r.company_id, public._next_employee_code(r.company_id), btrim(r.name), r.name_ar,
            r.phone, r.email, 'Sales', r.is_active)
    RETURNING id INTO v_emp;
    UPDATE public.salespeople SET employee_id = v_emp, updated_at = now() WHERE id = r.id;
    BEGIN
      INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
      VALUES (r.company_id, NULL, 'create', 'employee', v_emp,
              jsonb_build_object('from_salesperson', r.id, 'name', r.name, 'phase', 'phase130'));
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
END $$;

-- 3. Every salesperson is an employee from now on.
ALTER TABLE public.salespeople ALTER COLUMN employee_id SET NOT NULL;

COMMIT;

-- ── Verify after applying (read-only) ─────────────────────────────────────
-- Expect unlinked = 0, name_differs = 0 (the sync copied the employee name;
-- Pro_Parts' 'HUSSAIN' now shows as the employee's 'Hussain').
-- SELECT (SELECT count(*) FROM public.salespeople WHERE employee_id IS NULL) AS unlinked,
--        (SELECT count(*) FROM public.salespeople s JOIN public.employees e ON e.id = s.employee_id
--          WHERE s.name IS DISTINCT FROM e.name) AS name_differs,
--        (SELECT count(*) FROM public.salespeople) AS salespeople,
--        (SELECT count(*) FROM public.employees) AS employees;
