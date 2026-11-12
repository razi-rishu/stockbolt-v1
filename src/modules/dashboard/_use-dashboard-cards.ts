import { useQuery } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import type { DashboardCards } from '@/data/adapter';

/**
 * One get_dashboard_cards fetch for every dashboard summary card. The window
 * is part of the key, or switching period would show the previous period's
 * cached cards.
 */
export function useDashboardCards(from?: string, to?: string) {
  const company_id = useAuthStore(s => s.company_id);
  const ranged = from !== undefined && to !== undefined;
  return useQuery<DashboardCards>({
    queryKey: ['dashboard_cards', company_id, from ?? null, to ?? null],
    queryFn:  () => getAdapter().reports.getDashboardCards(
      company_id!, ranged ? { from: from!, to: to! } : undefined),
    enabled:  !!company_id,
  });
}
