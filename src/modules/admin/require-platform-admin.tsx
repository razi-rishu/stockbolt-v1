/**
 * Route guard for the platform-owner admin panel. Renders the child route only
 * if the logged-in user is a platform admin; otherwise bounces to /dashboard.
 *
 * This is the UI half of the protection — the real enforcement is server-side:
 * get_admin_dashboard refuses any non-platform-admin caller. This guard just
 * keeps the page out of normal users' way and avoids a flash of the shell.
 */
import { useQuery } from '@tanstack/react-query';
import { Navigate, Outlet } from 'react-router-dom';
import { getAdapter } from '@/data/index';

export default function RequirePlatformAdmin() {
  const { data: isAdmin, isLoading } = useQuery({
    queryKey: ['is_platform_admin'],
    queryFn: () => getAdapter().admin.isPlatformAdmin(),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-page">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    );
  }
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}
