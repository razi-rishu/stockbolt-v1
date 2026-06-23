/**
 * Permission hooks (Phase 22) — read the signed-in user's role from the auth
 * store and answer "can this user do X?" via the client matrix in
 * src/lib/permissions.ts. The DB still enforces via RLS; this is for UI gating.
 */
import { useAuthStore } from '@/store/auth';
import { hasPerm, type Permission } from '@/lib/permissions';

/** True if the current user has the given permission (admin always true). */
export function useHasPermission(perm: Permission): boolean {
  const role = useAuthStore((s) => s.role);
  const perms = useAuthStore((s) => s.permissions);
  return hasPerm(role, perms, perm);
}

/** True if the current user has ANY of the given permissions. */
export function useHasAnyPermission(perms: Permission[]): boolean {
  const role = useAuthStore((s) => s.role);
  const loaded = useAuthStore((s) => s.permissions);
  return perms.some((p) => hasPerm(role, loaded, p));
}
