/**
 * Keeps the app-wide currency display mode (src/lib/currency-display.ts) in
 * step with the signed-in company's saved preference (companies.currency_display).
 * Renders nothing. Mounted once at the app root, so print pages get it too.
 */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import type { Company } from '@/data/adapter';
import { displayOf, useCurrencyDisplayStore } from '@/lib/currency-display';

export function CurrencyDisplaySync() {
  const company_id = useAuthStore((s) => s.company_id);
  const setMode = useCurrencyDisplayStore((s) => s.setMode);
  // Same cached query as useCompany().
  const { data: company } = useQuery<Company | null>({
    queryKey: ['company', company_id],
    queryFn: () => getAdapter().companies.getById(company_id!),
    enabled: !!company_id,
    staleTime: 5 * 60 * 1000,
  });
  useEffect(() => {
    if (company) setMode(displayOf(company));
  }, [company, setMode]);
  return null;
}
