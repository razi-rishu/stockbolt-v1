/**
 * Permission guards (Phase 22).
 *
 * RequirePermission — a route-group Outlet guard. Place it as a parent route's
 * element; child routes render only if the current role has the permission,
 * otherwise a "no access" panel shows (these routes live inside AppLayout).
 *
 * Can — inline wrapper for a single element / button / section.
 *
 * The database (RLS) is the real gate; these only keep the UI honest so people
 * don't land on pages or buttons they can't use.
 */
import type { ReactNode } from 'react';
import { Outlet, Link } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { hasPerm, type Permission } from '@/lib/permissions';
import { theme } from '@/ui/theme';

function check(role: string | null, perms: string[], perm?: Permission, anyOf?: Permission[]): boolean {
  if (anyOf && anyOf.length) return anyOf.some((p) => hasPerm(role, perms, p));
  if (perm) return hasPerm(role, perms, perm);
  return true;
}

export function NoAccess() {
  return (
    <div style={{ maxWidth: '480px', margin: '48px auto', textAlign: 'center', padding: '0 16px' }}>
      <div style={{ fontSize: '34px', marginBottom: '8px' }}>🔒</div>
      <h1 style={{ fontSize: '18px', fontWeight: 800, color: theme.ink, margin: '0 0 6px' }}>You don't have access</h1>
      <p style={{ fontSize: '13.5px', color: theme.inkMuted, lineHeight: 1.6, margin: '0 0 16px' }}>
        Your role doesn't include permission for this page. If you need it, ask an
        administrator to update your role under Settings → Users &amp; Roles.
      </p>
      <Link to="/dashboard" style={{ fontSize: '13px', color: theme.brand, fontWeight: 600, textDecoration: 'none' }}>← Back to dashboard</Link>
    </div>
  );
}

export function RequirePermission({ perm, anyOf }: { perm?: Permission; anyOf?: Permission[] }) {
  const role = useAuthStore((s) => s.role);
  const perms = useAuthStore((s) => s.permissions);
  return check(role, perms, perm, anyOf) ? <Outlet /> : <NoAccess />;
}

/** Inline guard — renders children only if permitted; otherwise `fallback` (default: nothing). */
export function Can({ perm, anyOf, children, fallback = null }: {
  perm?: Permission; anyOf?: Permission[]; children: ReactNode; fallback?: ReactNode;
}) {
  const role = useAuthStore((s) => s.role);
  const perms = useAuthStore((s) => s.permissions);
  return <>{check(role, perms, perm, anyOf) ? children : fallback}</>;
}
