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

/**
 * useCompanyCountry — the active tenant's ISO country code ('AE', 'SA', 'IN', …).
 *
 * Shares the same cached ['company', company_id] query as useCompanyCurrency,
 * so it's a free read once the tree has loaded. Used to derive the country's
 * default tax rate (5% GCC / 18% India) for pre-filling new document lines.
 * Returns null until the company query resolves.
 */
export function useCompanyCountry(): string | null {
  const company_id = useAuthStore((s) => s.company_id);

  const { data: company } = useQuery<Company | null>({
    queryKey: ['company', company_id],
    queryFn:  () => getAdapter().companies.getById(company_id!),
    enabled:  !!company_id,
    staleTime: 5 * 60 * 1000,
  });

  return company?.country_code ?? null;
}

/**
 * useCompanyRoundingStep — Phase 46. The company's cash-rounding step for
 * document grand totals (0 = off; 0.25 / 0.50 / 1.00). Shares the cached
 * ['company', company_id] query. Returns 0 until the migration is applied
 * or while loading, so rounding is always a safe no-op by default.
 */
export function useCompanyRoundingStep(): number {
  const company = useCompany();
  return Number((company as { rounding_step?: number } | null)?.rounding_step ?? 0);
}

/**
 * useCompany — the full active-tenant company row (name, logo_url, currency,
 * country_code, fiscal_year_start, …). Shares the same cached
 * ['company', company_id] query as the currency/country hooks, so it's a free
 * read once the tree has loaded. The single source for company branding.
 */
export function useCompany(): Company | null {
  const company_id = useAuthStore((s) => s.company_id);

  const { data: company } = useQuery<Company | null>({
    queryKey: ['company', company_id],
    queryFn:  () => getAdapter().companies.getById(company_id!),
    enabled:  !!company_id,
    staleTime: 5 * 60 * 1000,
  });

  return company ?? null;
}
