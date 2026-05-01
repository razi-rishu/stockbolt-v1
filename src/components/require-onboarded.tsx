import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';

/** Wraps routes that require a completed onboarding wizard. Redirects to /setup if not onboarded. */
export function RequireOnboarded() {
  const is_onboarded = useAuthStore((s) => s.is_onboarded);

  if (!is_onboarded) {
    return <Navigate to="/setup" replace />;
  }

  return <Outlet />;
}
