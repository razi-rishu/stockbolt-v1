/**
 * usePrintConfig — company-scoped print/branding settings (2026-06-13).
 *
 * One shared react-query cache so every editor's view-mode template reads
 * the SAME accent colour / footer / toggles the user set in
 * Settings → Print. Returns undefined while loading; callers pass it
 * straight to the Bolt v4 templates, which fall back to their built-in
 * palette when it's absent.
 */
import { useQuery } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import type { PrintConfig } from '@/data/adapter';

export function usePrintConfig(): PrintConfig | undefined {
  const company_id = useAuthStore((s) => s.company_id);
  const { data } = useQuery({
    queryKey: ['print_config', company_id],
    queryFn: () => getAdapter().companies.getPrintConfig(company_id!),
    enabled: !!company_id,
    staleTime: 5 * 60 * 1000,
  });
  return data;
}
