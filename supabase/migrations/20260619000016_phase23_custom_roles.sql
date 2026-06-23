-- ════════════════════════════════════════════════════════════════════════════
-- Phase 23 — Custom roles (admin-defined roles on top of the 5 system roles)
-- ════════════════════════════════════════════════════════════════════════════
-- Extends Phase 22 so an admin can create their own roles (e.g. "Warehouse
-- Manager") and tick exactly which module permissions each gets — instead of
-- only the 5 fixed roles. Run AFTER phase22 / 22b / 22c.
--
-- Model:
--   • roles            — both the 5 system roles (company_id NULL, is_system) and
--                        per-company custom roles. profiles.role stores the role
--                        KEY (system key like 'admin', or the custom role's uuid).
--   • role_permissions — gains company_id (NULL = system row). has_perm() now
--                        matches role + (company_id IS NULL OR = your company),
--                        so a custom role's perms are scoped to its company.
--
-- Safety: admin still short-circuits has_perm() → existing users unaffected.
-- Custom roles CANNOT be granted 'users.manage' (prevents privilege escalation;
-- only the Admin system role manages users). A custom role can't be deleted
-- while a user still has it.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. roles table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.roles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,   -- NULL = system/global
  key        TEXT NOT NULL,                                            -- profiles.role stores this
  name       TEXT NOT NULL,
  is_system  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- key unique within a company (and within the system/global set)
CREATE UNIQUE INDEX IF NOT EXISTS roles_company_key_uq
  ON public.roles (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), key);
CREATE INDEX IF NOT EXISTS roles_company_idx ON public.roles (company_id);

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
-- Everyone authenticated can read system roles + their own company's roles
-- (needed to resolve role names and populate dropdowns). Writes go through the
-- SECURITY DEFINER RPCs below (which bypass RLS), so no client-write policy.
DROP POLICY IF EXISTS roles_read ON public.roles;
CREATE POLICY roles_read ON public.roles
  FOR SELECT TO authenticated
  USING (company_id IS NULL OR company_id = public.current_user_company_id());

-- Seed the 5 system roles (idempotent).
INSERT INTO public.roles (company_id, key, name, is_system) VALUES
  (NULL, 'admin',      'Admin',             TRUE),
  (NULL, 'accountant', 'Accountant',        TRUE),
  (NULL, 'sales',      'Salesperson',       TRUE),
  (NULL, 'counter',    'Counter / Cashier', TRUE),
  (NULL, 'viewer',     'Viewer',            TRUE)
ON CONFLICT (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), key) DO NOTHING;

-- ── 2. role_permissions gains company scope ────────────────────────────────
ALTER TABLE public.role_permissions ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;
-- Existing rows are the system matrix (company_id stays NULL). Replace the old
-- PK (role, permission) with a company-aware unique index.
ALTER TABLE public.role_permissions DROP CONSTRAINT IF EXISTS role_permissions_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS role_permissions_uq
  ON public.role_permissions (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), role, permission);

-- ── 3. Relax fixed-role CHECK constraints (custom keys are uuids) ──────────
ALTER TABLE public.profiles        DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.company_invites DROP CONSTRAINT IF EXISTS company_invites_role_check;

-- ── 4. has_perm() — company-aware ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_perm(p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_role TEXT; v_active BOOLEAN; v_company UUID;
BEGIN
  SELECT role, is_active, company_id INTO v_role, v_active, v_company
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active IS NOT TRUE THEN RETURN FALSE; END IF;
  IF v_role = 'admin' THEN RETURN TRUE; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.role_permissions
     WHERE role = v_role
       AND permission = p_permission
       AND (company_id IS NULL OR company_id = v_company)
  );
END;
$$;

-- ── 5. my_permissions() — effective permission list for the app to load ─────
CREATE OR REPLACE FUNCTION public.my_permissions()
RETURNS TEXT[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
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
  SELECT COALESCE(array_agg(permission), ARRAY[]::TEXT[]) INTO v_perms
    FROM public.role_permissions
   WHERE role = v_role AND (company_id IS NULL OR company_id = v_company);
  RETURN v_perms;
END;
$$;

-- ── 6. is_valid_role helper (system OR this company's custom) ──────────────
CREATE OR REPLACE FUNCTION public.is_valid_role(p_company UUID, p_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.roles
     WHERE key = p_role AND (company_id IS NULL OR company_id = p_company)
  )
$$;

-- ── 7. Role-management RPCs (admin / users.manage only) ────────────────────
-- Custom roles may NOT include users.manage (anti-escalation): it's stripped.
CREATE OR REPLACE FUNCTION public.create_role(p_name TEXT, p_permissions TEXT[])
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_company UUID; v_id UUID; v_key TEXT; v_perm TEXT;
BEGIN
  PERFORM public.auth_require('users.manage');
  v_company := public.current_user_company_id();
  IF COALESCE(TRIM(p_name), '') = '' THEN RAISE EXCEPTION 'create_role: name required'; END IF;
  v_id := gen_random_uuid();
  v_key := v_id::text;
  INSERT INTO public.roles (id, company_id, key, name, is_system)
  VALUES (v_id, v_company, v_key, TRIM(p_name), FALSE);
  FOREACH v_perm IN ARRAY COALESCE(p_permissions, ARRAY[]::TEXT[]) LOOP
    IF v_perm <> 'users.manage' THEN   -- never grantable to a custom role
      INSERT INTO public.role_permissions (company_id, role, permission)
      VALUES (v_company, v_key, v_perm) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (v_company, auth.uid(), 'create', 'role', v_id, jsonb_build_object('name', TRIM(p_name)));
  RETURN v_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_role(p_role_key TEXT, p_name TEXT, p_permissions TEXT[])
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_company UUID; v_perm TEXT;
BEGIN
  PERFORM public.auth_require('users.manage');
  v_company := public.current_user_company_id();
  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE key = p_role_key AND company_id = v_company AND NOT is_system) THEN
    RAISE EXCEPTION 'update_role: not a custom role of your company';
  END IF;
  IF COALESCE(TRIM(p_name), '') <> '' THEN
    UPDATE public.roles SET name = TRIM(p_name) WHERE key = p_role_key AND company_id = v_company;
  END IF;
  DELETE FROM public.role_permissions WHERE role = p_role_key AND company_id = v_company;
  FOREACH v_perm IN ARRAY COALESCE(p_permissions, ARRAY[]::TEXT[]) LOOP
    IF v_perm <> 'users.manage' THEN
      INSERT INTO public.role_permissions (company_id, role, permission)
      VALUES (v_company, p_role_key, v_perm) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id)
  VALUES (v_company, auth.uid(), 'update', 'role', NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_role(p_role_key TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_company UUID;
BEGIN
  PERFORM public.auth_require('users.manage');
  v_company := public.current_user_company_id();
  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE key = p_role_key AND company_id = v_company AND NOT is_system) THEN
    RAISE EXCEPTION 'delete_role: not a custom role of your company';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE company_id = v_company AND role = p_role_key) THEN
    RAISE EXCEPTION 'delete_role: role is still assigned to a user — reassign them first';
  END IF;
  DELETE FROM public.role_permissions WHERE role = p_role_key AND company_id = v_company;
  DELETE FROM public.roles WHERE key = p_role_key AND company_id = v_company;
  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id)
  VALUES (v_company, auth.uid(), 'delete', 'role', NULL);
END;
$$;

-- ── 8. Re-point set_user_role / invite_user at the roles table ─────────────
CREATE OR REPLACE FUNCTION public.set_user_role(p_user_id UUID, p_role TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_company UUID; v_old_role TEXT;
BEGIN
  PERFORM public.auth_require('users.manage');
  v_company := public.current_user_company_id();
  IF NOT public.is_valid_role(v_company, p_role) THEN
    RAISE EXCEPTION 'set_user_role: invalid role %', p_role;
  END IF;
  SELECT role INTO v_old_role FROM public.profiles WHERE id = p_user_id AND company_id = v_company;
  IF v_old_role IS NULL THEN RAISE EXCEPTION 'set_user_role: user not in your company'; END IF;
  IF v_old_role = 'admin' AND p_role <> 'admin'
     AND (SELECT count(*) FROM public.profiles
            WHERE company_id = v_company AND role = 'admin' AND is_active) <= 1 THEN
    RAISE EXCEPTION 'set_user_role: cannot remove the last admin';
  END IF;
  UPDATE public.profiles SET role = p_role WHERE id = p_user_id AND company_id = v_company;
  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (v_company, auth.uid(), 'update', 'profile', p_user_id,
          jsonb_build_object('old_role', v_old_role, 'new_role', p_role));
END;
$$;

CREATE OR REPLACE FUNCTION public.invite_user(p_email TEXT, p_role TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_company UUID; v_email TEXT; v_id UUID;
BEGIN
  PERFORM public.auth_require('users.manage');
  v_company := public.current_user_company_id();
  v_email := lower(trim(p_email));
  IF v_email = '' OR v_email IS NULL THEN RAISE EXCEPTION 'invite_user: email required'; END IF;
  IF NOT public.is_valid_role(v_company, p_role) THEN
    RAISE EXCEPTION 'invite_user: invalid role %', p_role;
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE company_id = v_company AND lower(email) = v_email) THEN
    RAISE EXCEPTION 'invite_user: % is already a member of this company', v_email;
  END IF;
  UPDATE public.company_invites SET status = 'revoked'
    WHERE company_id = v_company AND lower(email) = v_email AND status = 'pending';
  INSERT INTO public.company_invites (company_id, email, role, invited_by)
  VALUES (v_company, v_email, p_role, auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (v_company, auth.uid(), 'create', 'company_invite', v_id,
          jsonb_build_object('email', v_email, 'role', p_role));
  RETURN v_id;
END;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.create_role(TEXT, TEXT[])           FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_role(TEXT, TEXT, TEXT[])     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_role(TEXT)                   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_permissions()                   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_valid_role(UUID, TEXT)          FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_role(TEXT, TEXT[])           TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_role(TEXT, TEXT, TEXT[])     TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_role(TEXT)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_permissions()                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_valid_role(UUID, TEXT)          TO authenticated;

NOTIFY pgrst, 'reload schema';
