/**
 * useCompanyCurrency — Phase 14.14m.
 *
 * Returns the current company's currency (AED / SAR / KWD / INR / etc.)
 * for use as a default on new documents.
 *
 * Why this exists:
 *   The senior-dev audit (Phase 14.14j) found 24 files hard-coding 'AED'
 *   as the currency on new invoices, payments, bills, POs, PDC cheques,
 *   etc. India / Saudi / Kuwait tenants would silently get their
 *   documents tagged AED — breaking multi-currency reporting and any
 *   currency-aware printing. The landing page advertises GCC + India
 *   support; this hook backs the claim.
 *
 * Resolution order:
 *   1. companies.currency for the active tenant (queried via React Query).
 *   2. 'AED' as the ultimate fallback (only hit when the company query
 *      hasn't loaded yet — rare, transient).
 *
 * Cost: the query is cached under ['company', company_id] and shared
 * with every other consumer (most settings pages query this anyway),
 * so this is a free read once the tree has loaded.
 */
import { useQuery } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import type { Company } from '@/data/adapter';

const FALLBACK_CURRENCY = 'AED';

export function useCompanyCurrency(): string {
  const company_id = useAuthStore((s) => s.company_id);

  const { data: company } = useQuery<Company | null>({
    queryKey: ['company', company_id],
    queryFn:  () => getAdapter().companies.getById(company_id!),
    enabled:  !!company_id,
    staleTime: 5 * 60 * 1000,   // 5 min — currency rarely changes
  });

  return company?.currency || FALLBACK_CURRENCY;
}
