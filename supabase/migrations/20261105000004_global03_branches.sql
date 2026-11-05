-- global03: branches, branch-linked warehouses, user branch assignments
--
-- Global v1, Phase 6 (approved 2026-11-05):
--  * one default Head Office per company;
--  * every warehouse belongs to a branch;
--  * a user may be assigned to several branches.
--
-- WHAT THIS IS NOT (yet): ACCESS RESTRICTION. Assignments are recorded and
-- shown, and the wizard uses them, but nothing here limits what a user can
-- read or post: every user keeps exactly today's company-wide access. Branch-
-- scoped restriction needs server-side enforcement on every warehouse-bound
-- document and its own cross-branch isolation tests; until that ships the
-- feature stays disabled and the UI must not present assignments as security.
--
-- EXISTING COMPANIES
-- Each gets one Head Office (code HQ) and all its warehouses are linked to it.
-- Nothing else changes: no document, ledger or permission is touched.
--
-- DESIGN
--  * Company isolation is by RLS (tenant_isolation) plus restrictive has_perm
--    write policies, the same shape as warehouses: settings.write for branches,
--    users.manage for assignments.
--  * Cross-company links are impossible by construction: warehouses and
--    profile_branches reference branches through (company_id, id).
--  * The default branch cannot be deleted or deactivated, and exactly one
--    default exists per company (partial unique index).
--  * New companies get their Head Office from a trigger; a warehouse inserted
--    without a branch is placed in the default branch (so onboarding and the
--    existing Warehouses page keep working unchanged).
--
-- Rollback: supabase/manual-apply/global03_rollback.sql (guarded).

BEGIN;

-- ── branches ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.branches (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code        text        NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  name        text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  name_ar     text,
  address     text,
  is_default  boolean     NOT NULL DEFAULT false,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branches_company_code_key UNIQUE (company_id, code),
  CONSTRAINT branches_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT branches_default_is_active_ck CHECK (NOT is_default OR is_active)
);
CREATE UNIQUE INDEX IF NOT EXISTS branches_one_default_per_company
  ON public.branches (company_id) WHERE is_default;

DROP TRIGGER IF EXISTS branches_set_updated_at ON public.branches;
CREATE TRIGGER branches_set_updated_at
  BEFORE UPDATE ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.branches;
CREATE POLICY tenant_isolation ON public.branches
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());
DROP POLICY IF EXISTS rbac_w_ins_branches ON public.branches;
CREATE POLICY rbac_w_ins_branches ON public.branches AS RESTRICTIVE
  FOR INSERT WITH CHECK (public.has_perm('settings.write'));
DROP POLICY IF EXISTS rbac_w_upd_branches ON public.branches;
CREATE POLICY rbac_w_upd_branches ON public.branches AS RESTRICTIVE
  FOR UPDATE USING (public.has_perm('settings.write')) WITH CHECK (public.has_perm('settings.write'));
DROP POLICY IF EXISTS rbac_w_del_branches ON public.branches;
CREATE POLICY rbac_w_del_branches ON public.branches AS RESTRICTIVE
  FOR DELETE USING (public.has_perm('settings.write'));

REVOKE ALL ON public.branches FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.branches TO authenticated;
GRANT ALL ON public.branches TO service_role;

-- The default branch stays: it can't be deleted, deactivated or un-defaulted.
CREATE OR REPLACE FUNCTION public.tg_protect_default_branch()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_default AND EXISTS (SELECT 1 FROM public.companies WHERE id = OLD.company_id) THEN
      RAISE EXCEPTION 'default_branch_required: the default branch cannot be deleted' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.is_default AND (NOT NEW.is_default OR NOT NEW.is_active) THEN
    RAISE EXCEPTION 'default_branch_required: the default branch cannot be deactivated or un-defaulted' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.tg_protect_default_branch() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS branches_protect_default ON public.branches;
CREATE TRIGGER branches_protect_default
  BEFORE UPDATE OR DELETE ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.tg_protect_default_branch();

-- ── warehouses.branch_id ────────────────────────────────────────────────────
ALTER TABLE public.warehouses ADD COLUMN IF NOT EXISTS branch_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouses_branch_same_company_fk') THEN
    ALTER TABLE public.warehouses
      ADD CONSTRAINT warehouses_branch_same_company_fk
      FOREIGN KEY (company_id, branch_id) REFERENCES public.branches (company_id, id) ON DELETE RESTRICT;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS warehouses_branch_id_idx ON public.warehouses (branch_id);

-- ── profile_branches: which branches a user is assigned to ──────────────────
CREATE TABLE IF NOT EXISTS public.profile_branches (
  company_id  uuid        NOT NULL,
  profile_id  uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  branch_id   uuid        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, branch_id),
  CONSTRAINT profile_branches_branch_same_company_fk
    FOREIGN KEY (company_id, branch_id) REFERENCES public.branches (company_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS profile_branches_company_idx ON public.profile_branches (company_id);
CREATE INDEX IF NOT EXISTS profile_branches_branch_idx  ON public.profile_branches (branch_id);

ALTER TABLE public.profile_branches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.profile_branches;
CREATE POLICY tenant_isolation ON public.profile_branches
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id()
              AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = profile_id AND p.company_id = public.current_user_company_id()));
DROP POLICY IF EXISTS rbac_w_ins_profile_branches ON public.profile_branches;
CREATE POLICY rbac_w_ins_profile_branches ON public.profile_branches AS RESTRICTIVE
  FOR INSERT WITH CHECK (public.has_perm('users.manage'));
DROP POLICY IF EXISTS rbac_w_upd_profile_branches ON public.profile_branches;
CREATE POLICY rbac_w_upd_profile_branches ON public.profile_branches AS RESTRICTIVE
  FOR UPDATE USING (public.has_perm('users.manage')) WITH CHECK (public.has_perm('users.manage'));
DROP POLICY IF EXISTS rbac_w_del_profile_branches ON public.profile_branches;
CREATE POLICY rbac_w_del_profile_branches ON public.profile_branches AS RESTRICTIVE
  FOR DELETE USING (public.has_perm('users.manage'));

REVOKE ALL ON public.profile_branches FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.profile_branches TO authenticated;
GRANT ALL ON public.profile_branches TO service_role;

-- ── Head Office for every company, new and existing ─────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_default_branch(p_company_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.branches WHERE company_id = p_company_id AND is_default;
  IF v_id IS NULL THEN
    INSERT INTO public.branches (company_id, code, name, name_ar, is_default)
    VALUES (p_company_id, 'HQ', 'Head Office', 'المكتب الرئيسي', true)
    ON CONFLICT (company_id, code) DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN  -- an 'HQ' already existed but wasn't the default: promote it
      UPDATE public.branches SET is_default = true, is_active = true
       WHERE company_id = p_company_id AND code = 'HQ' RETURNING id INTO v_id;
    END IF;
  END IF;
  RETURN v_id;
END;
$function$;
-- Trigger/migration only: a client must never create a branch in another company.
REVOKE ALL ON FUNCTION public.ensure_default_branch(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_company_default_branch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.ensure_default_branch(NEW.id);
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.tg_company_default_branch() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS companies_default_branch ON public.companies;
CREATE TRIGGER companies_default_branch
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.tg_company_default_branch();

-- A warehouse created without a branch goes to the company's default branch.
CREATE OR REPLACE FUNCTION public.tg_warehouse_default_branch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.branch_id IS NULL THEN
    NEW.branch_id := public.ensure_default_branch(NEW.company_id);
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.tg_warehouse_default_branch() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS warehouses_default_branch ON public.warehouses;
CREATE TRIGGER warehouses_default_branch
  BEFORE INSERT OR UPDATE OF branch_id ON public.warehouses
  FOR EACH ROW EXECUTE FUNCTION public.tg_warehouse_default_branch();

-- Backfill: every existing company gets its Head Office; every existing
-- warehouse is linked to it. Adds rows and fills a new column only.
SELECT public.ensure_default_branch(c.id) FROM public.companies c;
UPDATE public.warehouses w
   SET branch_id = b.id
  FROM public.branches b
 WHERE w.branch_id IS NULL AND b.company_id = w.company_id AND b.is_default;

ALTER TABLE public.warehouses ALTER COLUMN branch_id SET NOT NULL;

COMMIT;
