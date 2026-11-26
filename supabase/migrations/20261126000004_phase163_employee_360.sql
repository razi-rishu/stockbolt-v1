-- ═══════════════════════════════════════════════════════════════════════════
-- phase163 — Employee 360: more about each person, and where they work.
-- ═══════════════════════════════════════════════════════════════════════════
-- The employee record gains: photo, branch and home warehouse, employment
-- type, nationality, date of birth, emergency contact, document numbers and
-- expiry dates (ID, passport, visa, labour card) and how salary is paid.
-- Scanned documents go in a PRIVATE bucket ('employee-files', signed links
-- only), listed in employee_documents. Passport and ID scans are personal
-- data, so they never use the public logos / products buckets.
--
-- Who can see it: exactly who can see employees today — payroll.read to
-- read, payroll.write to add or remove (same rights as the employee record).
-- The generic `attachments` table is NOT reused: any company user can read
-- it, which is too wide for ID scans.
--
-- Additive: new nullable columns, one new table, one new bucket. No existing
-- row, column, policy, posting or payroll rule changes. Existing employees
-- keep every value; the new fields start empty.
-- SAFE TO RE-RUN.
-- UNDO:
--   DROP TABLE public.employee_documents;
--   DROP TRIGGER employees_c_place_same_company ON public.employees;
--   DROP FUNCTION public.tg_employee_place_same_company(), public.employee_file_ok(text, boolean);
--   ALTER TABLE public.employees DROP COLUMN photo_path, ... (the columns below);
--   DROP POLICY employee_files_select / _insert / _delete ON storage.objects;
--   (empty and delete the 'employee-files' bucket from the Storage UI)
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── 1. New employee fields ────────────────────────────────────────────────
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS photo_path              text,
  ADD COLUMN IF NOT EXISTS branch_id               uuid REFERENCES public.branches(id)   ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS warehouse_id            uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS employment_type         text,
  ADD COLUMN IF NOT EXISTS nationality             text,
  ADD COLUMN IF NOT EXISTS date_of_birth           date,
  ADD COLUMN IF NOT EXISTS emergency_contact_name  text,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone text,
  ADD COLUMN IF NOT EXISTS emirates_id_expiry      date,
  ADD COLUMN IF NOT EXISTS passport_expiry         date,
  ADD COLUMN IF NOT EXISTS visa_no                 text,
  ADD COLUMN IF NOT EXISTS visa_expiry             date,
  ADD COLUMN IF NOT EXISTS labour_card_no          text,
  ADD COLUMN IF NOT EXISTS labour_card_expiry      date,
  ADD COLUMN IF NOT EXISTS pay_method              text;

DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_employment_type_check') THEN
    ALTER TABLE public.employees ADD CONSTRAINT employees_employment_type_check
      CHECK (employment_type IS NULL OR employment_type IN ('full_time', 'part_time', 'contract', 'intern'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_pay_method_check') THEN
    ALTER TABLE public.employees ADD CONSTRAINT employees_pay_method_check
      CHECK (pay_method IS NULL OR pay_method IN ('wps', 'bank', 'cash', 'cheque'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_dob_check') THEN
    ALTER TABLE public.employees ADD CONSTRAINT employees_dob_check
      CHECK (date_of_birth IS NULL OR date_of_birth BETWEEN DATE '1900-01-01' AND DATE '2100-01-01');
  END IF;
END
$c$;

CREATE INDEX IF NOT EXISTS employees_branch_id_idx    ON public.employees (branch_id);
CREATE INDEX IF NOT EXISTS employees_warehouse_id_idx ON public.employees (warehouse_id);

-- Branch and warehouse must belong to the employee's own company (a foreign
-- key alone would accept another company's id — audit finding SEC-05).
CREATE OR REPLACE FUNCTION public.tg_employee_place_same_company()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.branch_id IS NOT NULL AND NOT EXISTS
     (SELECT 1 FROM public.branches b WHERE b.id = NEW.branch_id AND b.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'That branch was not found in this company.' USING ERRCODE = '23503';
  END IF;
  IF NEW.warehouse_id IS NOT NULL AND NOT EXISTS
     (SELECT 1 FROM public.warehouses w WHERE w.id = NEW.warehouse_id AND w.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'That warehouse was not found in this company.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS employees_c_place_same_company ON public.employees;
CREATE TRIGGER employees_c_place_same_company
  BEFORE INSERT OR UPDATE OF branch_id, warehouse_id, company_id ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.tg_employee_place_same_company();

-- ── 2. Scanned documents ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employee_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  doc_type     text NOT NULL CHECK (doc_type IN ('emirates_id', 'passport', 'visa', 'labour_card', 'contract', 'other')),
  file_name    text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 200),
  storage_path text NOT NULL UNIQUE,
  mime_type    text NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')),
  file_size    bigint NOT NULL CHECK (file_size > 0 AND file_size <= 5242880),
  uploaded_by  uuid DEFAULT auth.uid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- The file must sit under this company and this employee.
  CONSTRAINT employee_documents_path_check
    CHECK (storage_path LIKE company_id::text || '/' || employee_id::text || '/%')
);
CREATE INDEX IF NOT EXISTS employee_documents_employee_idx ON public.employee_documents (employee_id);
CREATE INDEX IF NOT EXISTS employee_documents_company_idx  ON public.employee_documents (company_id);

ALTER TABLE public.employee_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation          ON public.employee_documents;
DROP POLICY IF EXISTS employee_documents_read   ON public.employee_documents;
DROP POLICY IF EXISTS employee_documents_add    ON public.employee_documents;
DROP POLICY IF EXISTS employee_documents_remove ON public.employee_documents;
-- Same shape as employees: company filter (permissive) AND the right (restrictive).
CREATE POLICY tenant_isolation ON public.employee_documents FOR ALL
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());
CREATE POLICY employee_documents_read ON public.employee_documents AS RESTRICTIVE FOR SELECT
  USING (public.has_perm('payroll.read'));
-- The employee must be one of this company's.
CREATE POLICY employee_documents_add ON public.employee_documents AS RESTRICTIVE FOR INSERT
  WITH CHECK (public.has_perm('payroll.write')
              AND EXISTS (SELECT 1 FROM public.employees e
                           WHERE e.id = employee_documents.employee_id
                             AND e.company_id = employee_documents.company_id));
CREATE POLICY employee_documents_remove ON public.employee_documents AS RESTRICTIVE FOR DELETE
  USING (public.has_perm('payroll.write'));
-- No UPDATE: a wrong file is removed and added again.
REVOKE ALL ON public.employee_documents FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.employee_documents TO authenticated;
GRANT ALL ON public.employee_documents TO service_role;

-- ── 3. Private storage ────────────────────────────────────────────────────
-- Path: <company_id>/<employee_id>/<file>. Reading needs payroll.read,
-- adding or removing needs payroll.write, both only inside the caller's
-- company and only for one of its employees.
CREATE OR REPLACE FUNCTION public.employee_file_ok(p_name text, p_write boolean)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_company text := split_part(p_name, '/', 1);
  v_emp     text := split_part(p_name, '/', 2);
  v_uuid    text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF auth.uid() IS NULL OR public.current_user_company_id() IS NULL THEN RETURN false; END IF;
  IF v_company !~ v_uuid OR v_emp !~ v_uuid OR split_part(p_name, '/', 3) = '' THEN RETURN false; END IF;
  IF v_company::uuid <> public.current_user_company_id() THEN RETURN false; END IF;
  IF NOT public.has_perm(CASE WHEN p_write THEN 'payroll.write' ELSE 'payroll.read' END) THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM public.employees e WHERE e.id = v_emp::uuid AND e.company_id = v_company::uuid);
END;
$fn$;
REVOKE ALL ON FUNCTION public.employee_file_ok(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_file_ok(text, boolean) TO authenticated, service_role;

DO $storage$
BEGIN
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'phase163: Storage not installed here — bucket and storage policies skipped';
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('employee-files', 'employee-files', false, 5242880,
          ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
  ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 5242880,
          allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

  EXECUTE 'DROP POLICY IF EXISTS employee_files_select ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS employee_files_insert ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS employee_files_delete ON storage.objects';
  EXECUTE $p$CREATE POLICY employee_files_select ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'employee-files' AND public.employee_file_ok(name, false))$p$;
  EXECUTE $p$CREATE POLICY employee_files_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'employee-files' AND public.employee_file_ok(name, true))$p$;
  EXECUTE $p$CREATE POLICY employee_files_delete ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'employee-files' AND public.employee_file_ok(name, true))$p$;
  -- No UPDATE policy: a file is never replaced in place.
END
$storage$;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Check: new_columns = 15, docs_table = 1, docs_rls = true, anon_docs = false.
SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'employees'
          AND column_name IN ('photo_path','branch_id','warehouse_id','employment_type','nationality','date_of_birth',
                              'emergency_contact_name','emergency_contact_phone','emirates_id_expiry','passport_expiry',
                              'visa_no','visa_expiry','labour_card_no','labour_card_expiry','pay_method')) AS new_columns,
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = 'employee_documents') AS docs_table,
       (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.employee_documents'::regclass) AS docs_rls,
       has_table_privilege('anon', 'public.employee_documents', 'select') AS anon_docs;
