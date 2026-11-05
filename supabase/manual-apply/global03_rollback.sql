-- global03 ROLLBACK - removes branches, warehouse branch links and user branch
-- assignments.
--
-- WARNING: every branch, every warehouse's branch link and every user branch
-- assignment is deleted. Warehouses, documents and permissions themselves are
-- untouched. Turn VITE_GLOBAL_ONBOARDING off and redeploy BEFORE running this.

BEGIN;

-- ROLLBACK GUARD - rollbacks are refused unless this block is deliberately removed.
DO $$ BEGIN
  RAISE EXCEPTION 'ROLLBACK GUARD: this rollback deletes all branches and branch assignments. Delete this block to run it deliberately.';
END $$;

DROP TRIGGER IF EXISTS warehouses_default_branch ON public.warehouses;
DROP TRIGGER IF EXISTS companies_default_branch ON public.companies;
ALTER TABLE public.warehouses DROP CONSTRAINT IF EXISTS warehouses_branch_same_company_fk;
ALTER TABLE public.warehouses DROP COLUMN IF EXISTS branch_id;
DROP TABLE IF EXISTS public.profile_branches;
DROP TABLE IF EXISTS public.branches;
DROP FUNCTION IF EXISTS public.tg_warehouse_default_branch();
DROP FUNCTION IF EXISTS public.tg_company_default_branch();
DROP FUNCTION IF EXISTS public.ensure_default_branch(uuid);
DROP FUNCTION IF EXISTS public.tg_protect_default_branch();

COMMIT;
