import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';

/** Wraps routes that require authentication. Redirects to /login if no session. */
export function RequireAuth() {
  const user_id = useAuthStore((s) => s.user_id);
  const location = useLocation();

  if (!user_id) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
