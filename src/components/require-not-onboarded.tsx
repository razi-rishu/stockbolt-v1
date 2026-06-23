import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';

/**
 * Mirror of RequireOnboarded. Wraps the /setup route so that an
 * already-onboarded user cannot land there. Without this, refreshing
 * /setup (bookmark, manual URL, browser back) would briefly render the
 * wizard and only redirect via useEffect AFTER paint — visible flash.
 *
 * Why this lives at the routing layer (not inside the wizard component):
 * the wizard uses useForm and other hooks; an early return in the
 * component body would skip those hooks on the redirect render,
 * violating Rules of Hooks ("Rendered fewer hooks than expected").
 * Guarding at the route mounts/unmounts the entire subtree atomically.
 */
export function RequireNotOnboarded() {
  const is_onboarded = useAuthStore((s) => s.is_onboarded);
  const pending_invite = useAuthStore((s) => s.pending_invite);

  if (is_onboarded) {
    return <Navigate to="/dashboard" replace />;
  }
  // Phase 22 — an invited user landing on /setup should join their company,
  // not create a new one.
  if (pending_invite) {
    return <Navigate to="/accept-invite" replace />;
  }

  return <Outlet />;
}
