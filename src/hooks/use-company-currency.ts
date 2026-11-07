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
import { useTranslation } from 'react-i18next';
import { getTaxLabels } from '@/lib/locale';
import { vatApplies } from '@/core/global-config/country-packs';
import { useAuthStore } from '@/store/auth';
import type { Company } from '@/data/adapter';
import { useEnabledModules } from '@/hooks/use-enabled-modules';

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
 * useProjectsEnabled — phase104. Whether this tenant has the projects / jobs
 * module switched on (companies.projects_enabled).
 *
 * Defaults to FALSE, and deliberately reads through a cast: the column is not
 * in the generated database types yet, and a tenant whose database predates the
 * migration must simply see no Projects module rather than a crash. Same
 * treatment as useCompanyRoundingStep above.
 */
export function useProjectsEnabled(): boolean {
  const company = useCompany();
  // Global v1 — a saved configuration can switch Projects off too. With no
  // saved configuration the module list follows this same flag, so legacy
  // companies see no change.
  const { isEnabled } = useEnabledModules();
  return Boolean((company as { projects_enabled?: boolean } | null)?.projects_enabled) && isEnabled('projects');
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

/**
 * useTaxName — the company's tax called by its own name, translated: "GST"
 * for India, "VAT" for the GCC (getTaxLabels decides). Screens used to print
 * a fixed "VAT", which is wrong for every Indian company (Global pilot finding).
 */
export function useTaxName(): string {
  const { t } = useTranslation();
  const country = useCompanyCountry();
  return getTaxLabels(country).taxName === 'GST' ? t('common.tax_name_gst') : t('common.tax_name_vat');
}

/**
 * useVatApplies — phase123 (Global decision 1). False for a company in a
 * country with no VAT in force (Kuwait, Qatar) that has no non-zero tax rate:
 * its documents then show no tax column and no tax total, and calculate none.
 *
 * An existing company that already holds a non-zero rate keeps seeing tax —
 * its records and historical documents are preserved, never hidden. Screens
 * also keep tax visible on any document that already carries tax.
 * True while the company is loading, so nothing flickers away on VAT tenants.
 */
export function useVatApplies(): boolean {
  const company_id = useAuthStore((s) => s.company_id);
  const country = useCompanyCountry();
  const { data: rates = [] } = useQuery({
    queryKey: ['taxRates', company_id],
    queryFn:  () => getAdapter().taxRates.list(company_id!),
    enabled:  !!company_id,
  });
  if (!country) return true;
  return vatApplies(country) || rates.some((r) => Number(r.rate) > 0);
}
