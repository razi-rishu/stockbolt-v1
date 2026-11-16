import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { LegalGate } from '@/modules/legal/legal-gate';

/** Wraps routes that require authentication. Redirects to /login if no session. */
export function RequireAuth() {
  const user_id = useAuthStore((s) => s.user_id);
  const location = useLocation();

  if (!user_id) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // phase135 — every signed-in screen (setup wizard included) passes the
  // Terms gate; it is inert until documents are published.
  return <LegalGate><Outlet /></LegalGate>;
}
