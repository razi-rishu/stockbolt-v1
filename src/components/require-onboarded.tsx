import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';

/**
 * Wraps routes that require a completed onboarding wizard. Redirects a
 * not-onboarded user to /accept-invite when they have a pending company invite
 * (Phase 22), otherwise to the create-company wizard at /setup.
 */
export function RequireOnboarded() {
  const is_onboarded = useAuthStore((s) => s.is_onboarded);
  const pending_invite = useAuthStore((s) => s.pending_invite);

  if (!is_onboarded) {
    return <Navigate to={pending_invite ? '/accept-invite' : '/setup'} replace />;
  }

  return <Outlet />;
}
