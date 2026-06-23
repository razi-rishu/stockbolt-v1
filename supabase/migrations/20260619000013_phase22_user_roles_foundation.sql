-- ════════════════════════════════════════════════════════════════════════════
-- Phase 22 — Users & Roles foundation (RBAC + multi-user invites)
-- ════════════════════════════════════════════════════════════════════════════
-- StockBolt already had profiles.role (admin/accountant/sales/counter/viewer,
-- default admin) but it was unused, and there was no way to add a 2nd user
-- (every signup created its own company). This migration lays the foundation:
--
--   1. role_permissions  — the permission matrix (single source of truth, read
--      by both RLS via has_perm() and the UI to render/gate).
--   2. helpers           — current_user_role(), has_perm(), auth_require().
--   3. company_invites    — pending email invites to join an existing company.
--   4. RPCs              — invite_user / revoke_invite / set_user_role /
--      set_user_active (admin-gated, last-admin guard) + accept_invite() and
--      my_pending_invite() for the self-signup join flow.
--
-- BACKWARD COMPATIBILITY: every existing user is role='admin'. has_perm() short-
-- circuits admin → TRUE, so existing companies are completely unaffected. The
-- RLS *enforcement* lands in phase22b (writes) and phase22c (reads).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Permission matrix ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.role_permissions (
  role       TEXT NOT NULL CHECK (role IN ('admin','accountant','sales','counter','viewer')),
  permission TEXT NOT NULL,
  PRIMARY KEY (role, permission)
);
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

-- Global config (same for every tenant): any authenticated user may read it so
-- the UI can render the matrix and gate nav. No client writes (seeded here).
DROP POLICY IF EXISTS role_permissions_read ON public.role_permissions;
CREATE POLICY role_permissions_read ON public.role_permissions
  FOR SELECT TO authenticated USING (TRUE);

-- Re-seed from scratch each run so the matrix always matches this file.
DELETE FROM public.role_permissions;
INSERT INTO public.role_permissions (role, permission) VALUES
  -- admin: everything (also short-circuited in has_perm, seeded for the UI)
  ('admin','sales.read'),('admin','sales.write'),
  ('admin','purchasing.read'),('admin','purchasing.write'),
  ('admin','inventory.read'),('admin','inventory.write'),
  ('admin','accounting.read'),('admin','accounting.write'),
  ('admin','payroll.read'),('admin','payroll.write'),
  ('admin','reports.read'),
  ('admin','settings.read'),('admin','settings.write'),
  ('admin','users.manage'),
  -- accountant: books + purchasing, read sales/inventory/payroll, read settings
  ('accountant','sales.read'),
  ('accountant','purchasing.read'),('accountant','purchasing.write'),
  ('accountant','inventory.read'),
  ('accountant','accounting.read'),('accountant','accounting.write'),
  ('accountant','payroll.read'),
  ('accountant','reports.read'),
  ('accountant','settings.read'),
  -- sales: full sales + POS, read inventory + reports
  ('sales','sales.read'),('sales','sales.write'),
  ('sales','inventory.read'),
  ('sales','reports.read'),
  -- counter (cashier): POS / counter sales + read products
  ('counter','sales.read'),('counter','sales.write'),
  ('counter','inventory.read'),
  -- viewer: read-only everywhere, no writes / no user management
  ('viewer','sales.read'),
  ('viewer','purchasing.read'),
  ('viewer','inventory.read'),
  ('viewer','accounting.read'),
  ('viewer','payroll.read'),
  ('viewer','reports.read'),
  ('viewer','settings.read');

-- ── 2. Helper functions ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

-- has_perm: admin short-circuits to TRUE; inactive users get NOTHING; everyone
-- else is checked against role_permissions. Used by every RLS role gate.
CREATE OR REPLACE FUNCTION public.has_perm(p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_role TEXT; v_active BOOLEAN;
BEGIN
  SELECT role, is_active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active IS NOT TRUE THEN RETURN FALSE; END IF;
  IF v_role = 'admin' THEN RETURN TRUE; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.role_permissions WHERE role = v_role AND permission = p_permission
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.auth_require(p_permission TEXT)
RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_perm(p_permission) THEN
    RAISE EXCEPTION 'forbidden: requires % permission', p_permission USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ── 3. company_invites ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin','accountant','sales','counter','viewer')),
  token       UUID NOT NULL DEFAULT gen_random_uuid(),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
  invited_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS company_invites_company_idx ON public.company_invites (company_id);
CREATE INDEX IF NOT EXISTS company_invites_email_idx   ON public.company_invites (lower(email));
-- at most one pending invite per (company, email)
CREATE UNIQUE INDEX IF NOT EXISTS company_invites_pending_uq
  ON public.company_invites (company_id, lower(email)) WHERE status = 'pending';

ALTER TABLE public.company_invites ENABLE ROW LEVEL SECURITY;
-- Only company admins (users.manage) see / manage their company's invites.
-- Invitees never read this directly — accept_invite() runs SECURITY DEFINER.
DROP POLICY IF EXISTS company_invites_admin ON public.company_invites;
CREATE POLICY company_invites_admin ON public.company_invites
  FOR ALL
  USING (company_id = public.current_user_company_id() AND public.has_perm('users.manage'))
  WITH CHECK (company_id = public.current_user_company_id() AND public.has_perm('users.manage'));

-- ── 4. Admin-gated management RPCs ──────────────────────────────────────────
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
  IF p_role NOT IN ('admin','accountant','sales','counter','viewer') THEN
    RAISE EXCEPTION 'invite_user: invalid role %', p_role;
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE company_id = v_company AND lower(email) = v_email) THEN
    RAISE EXCEPTION 'invite_user: % is already a member of this company', v_email;
  END IF;
  -- supersede any existing pending invite, then create a fresh one
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

CREATE OR REPLACE FUNCTION public.revoke_invite(p_invite_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_company UUID;
BEGIN
  PERFORM public.auth_require('users.manage');
  v_company := public.current_user_company_id();
  UPDATE public.company_invites SET status = 'revoked'
    WHERE id = p_invite_id AND company_id = v_company AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'revoke_invite: no pending invite found'; END IF;
  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id)
  VALUES (v_company, auth.uid(), 'delete', 'company_invite', p_invite_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_user_role(p_user_id UUID, p_role TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_company UUID; v_old_role TEXT;
BEGIN
  PERFORM public.auth_require('users.manage');
  v_company := public.current_user_company_id();
  IF p_role NOT IN ('admin','accountant','sales','counter','viewer') THEN
    RAISE EXCEPTION 'set_user_role: invalid role %', p_role;
  END IF;
  SELECT role INTO v_old_role FROM public.profiles WHERE id = p_user_id AND company_id = v_company;
  IF v_old_role IS NULL THEN RAISE EXCEPTION 'set_user_role: user not in your company'; END IF;
  -- last-admin guard: never strip the final active admin
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

CREATE OR REPLACE FUNCTION public.set_user_active(p_user_id UUID, p_active BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_company UUID; v_role TEXT;
BEGIN
  PERFORM public.auth_require('users.manage');
  v_company := public.current_user_company_id();
  SELECT role INTO v_role FROM public.profiles WHERE id = p_user_id AND company_id = v_company;
  IF v_role IS NULL THEN RAISE EXCEPTION 'set_user_active: user not in your company'; END IF;
  -- last-admin guard: never deactivate the final active admin
  IF p_active IS NOT TRUE AND v_role = 'admin'
     AND (SELECT count(*) FROM public.profiles
            WHERE company_id = v_company AND role = 'admin' AND is_active) <= 1 THEN
    RAISE EXCEPTION 'set_user_active: cannot deactivate the last admin';
  END IF;
  UPDATE public.profiles SET is_active = p_active WHERE id = p_user_id AND company_id = v_company;
  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (v_company, auth.uid(), 'update', 'profile', p_user_id,
          jsonb_build_object('is_active', p_active));
END;
$$;

-- ── 5. Self-signup join flow ────────────────────────────────────────────────
-- Returns the pending invite (if any) for the signed-in user's email so the app
-- can route them to an "accept invite" step instead of the create-company wizard.
CREATE OR REPLACE FUNCTION public.my_pending_invite()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_email TEXT; v_row RECORD;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email IS NULL THEN RETURN NULL; END IF;
  SELECT ci.id, ci.role, c.name AS company_name
    INTO v_row
    FROM public.company_invites ci
    JOIN public.companies c ON c.id = ci.company_id
   WHERE lower(ci.email) = lower(v_email) AND ci.status = 'pending'
   ORDER BY ci.created_at DESC LIMIT 1;
  IF v_row.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('invite_id', v_row.id, 'role', v_row.role, 'company_name', v_row.company_name);
END;
$$;

-- Attaches the signed-in user to the inviting company (mirrors complete_onboarding
-- but JOINS instead of creating a company).
CREATE OR REPLACE FUNCTION public.accept_invite()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_user UUID; v_email TEXT; v_inv RECORD;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN RAISE EXCEPTION 'accept_invite: not authenticated'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user) THEN
    RAISE EXCEPTION 'accept_invite: already a member';
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_user;
  SELECT * INTO v_inv FROM public.company_invites
   WHERE lower(email) = lower(v_email) AND status = 'pending'
   ORDER BY created_at DESC LIMIT 1;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'accept_invite: no pending invite for %', v_email; END IF;
  INSERT INTO public.profiles (id, company_id, full_name, email, role)
  VALUES (v_user, v_inv.company_id, split_part(v_email, '@', 1), v_email, v_inv.role);
  UPDATE public.company_invites SET status = 'accepted', accepted_at = now() WHERE id = v_inv.id;
  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (v_inv.company_id, v_user, 'create', 'profile', v_user,
          jsonb_build_object('via', 'invite', 'role', v_inv.role));
  RETURN jsonb_build_object('company_id', v_inv.company_id, 'role', v_inv.role);
END;
$$;

-- ── Grants: authenticated only ──────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.invite_user(TEXT, TEXT)        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_invite(UUID)            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_user_role(UUID, TEXT)      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_user_active(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_pending_invite()            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_invite()                FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invite_user(TEXT, TEXT)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_invite(UUID)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_role(UUID, TEXT)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_active(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_pending_invite()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_invite()               TO authenticated;

NOTIFY pgrst, 'reload schema';
