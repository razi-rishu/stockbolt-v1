-- ════════════════════════════════════════════════════════════════════════════
-- Phase 26 — Per-user permission overrides
-- ════════════════════════════════════════════════════════════════════════════
-- On top of a user's role, an admin can grant ("allow") or revoke ("deny")
-- individual module permissions for ONE specific person. Precedence:
--   admin role      → everything (unchanged short-circuit)
--   deny override   → blocked (wins over everything below)
--   allow override  → granted
--   else            → the role's default
-- users.manage is never overridable (stays Admin-only; anti-escalation).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.user_permission_overrides (
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  mode       TEXT NOT NULL CHECK (mode IN ('allow','deny')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, permission)
);
ALTER TABLE public.user_permission_overrides ENABLE ROW LEVEL SECURITY;
-- Admins (users.manage) see/manage overrides for users in their own company.
DROP POLICY IF EXISTS upo_admin ON public.user_permission_overrides;
CREATE POLICY upo_admin ON public.user_permission_overrides
  FOR ALL
  USING (public.has_perm('users.manage') AND EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = user_permission_overrides.user_id
      AND p.company_id = public.current_user_company_id()))
  WITH CHECK (public.has_perm('users.manage') AND EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = user_permission_overrides.user_id
      AND p.company_id = public.current_user_company_id()));

-- ── has_perm() — honor per-user overrides (deny > allow > role default) ─────
CREATE OR REPLACE FUNCTION public.has_perm(p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_role TEXT; v_active BOOLEAN; v_company UUID; v_ovr TEXT;
BEGIN
  SELECT role, is_active, company_id INTO v_role, v_active, v_company
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active IS NOT TRUE THEN RETURN FALSE; END IF;
  IF v_role = 'admin' THEN RETURN TRUE; END IF;

  SELECT mode INTO v_ovr FROM public.user_permission_overrides
   WHERE user_id = auth.uid() AND permission = p_permission;
  IF v_ovr = 'deny'  THEN RETURN FALSE; END IF;
  IF v_ovr = 'allow' THEN RETURN TRUE;  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.role_permissions
     WHERE role = v_role AND permission = p_permission
       AND (company_id IS NULL OR company_id = v_company)
  );
END;
$$;

-- ── my_permissions() — effective = (role ∪ allow) − deny ───────────────────
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
  SELECT ARRAY(
    SELECT p FROM (
      SELECT permission AS p FROM public.role_permissions
        WHERE role = v_role AND (company_id IS NULL OR company_id = v_company)
      UNION
      SELECT permission FROM public.user_permission_overrides
        WHERE user_id = auth.uid() AND mode = 'allow'
    ) u
    WHERE p NOT IN (
      SELECT permission FROM public.user_permission_overrides
       WHERE user_id = auth.uid() AND mode = 'deny'
    )
  ) INTO v_perms;
  RETURN v_perms;
END;
$$;

-- ── set_user_overrides(): replace a user's overrides (admin only) ──────────
CREATE OR REPLACE FUNCTION public.set_user_overrides(p_user_id UUID, p_allow TEXT[], p_deny TEXT[])
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_company UUID;
BEGIN
  PERFORM public.auth_require('users.manage');
  v_company := public.current_user_company_id();
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND company_id = v_company) THEN
    RAISE EXCEPTION 'set_user_overrides: user not in your company';
  END IF;
  DELETE FROM public.user_permission_overrides WHERE user_id = p_user_id;
  -- allow first, then deny (deny wins on any accidental overlap).
  INSERT INTO public.user_permission_overrides (user_id, permission, mode)
    SELECT p_user_id, x, 'allow' FROM unnest(COALESCE(p_allow, ARRAY[]::TEXT[])) x
     WHERE x <> 'users.manage'
  ON CONFLICT (user_id, permission) DO NOTHING;
  INSERT INTO public.user_permission_overrides (user_id, permission, mode)
    SELECT p_user_id, x, 'deny' FROM unnest(COALESCE(p_deny, ARRAY[]::TEXT[])) x
     WHERE x <> 'users.manage'
  ON CONFLICT (user_id, permission) DO UPDATE SET mode = 'deny';
  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (v_company, auth.uid(), 'update', 'profile', p_user_id,
          jsonb_build_object('overrides_allow', p_allow, 'overrides_deny', p_deny));
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_overrides(UUID, TEXT[], TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_user_overrides(UUID, TEXT[], TEXT[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
