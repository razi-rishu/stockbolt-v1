/**
 * Global v1 — country packs. Architecture decision: tax compliance is
 * country-aware, and only explicitly supported packs may claim statutory
 * compliance.
 *
 * - `statutory`: StockBolt ships country-specific tax logic (AE VAT + PINT-AE
 *   e-invoice documents + WPS; IN GST + TDS + GST e-invoice documents).
 *   E-invoicing is `partial`: documents are built, but no live portal (ASP/GSP)
 *   is connected yet.
 * - `tax_configuration`: StockBolt can record VAT at a configured rate and
 *   report it, but ships no country-specific compliance (no e-invoicing
 *   integration, no official return format). The UI must not claim compliance.
 * - `generic`: any other country. Taxes are user-defined, nothing is claimed,
 *   and the company can't be activated yet: companies.country_code only
 *   accepts the 7 codes above (database CHECK), which needs a migration.
 *
 * `standard_vat_rate` with rate_status 'needs_review' is reference
 * information for review, NOT what onboarding seeds today: seedTaxRates.ts
 * still seeds 5% for every GCC country. The Global audit flagged that, and
 * correcting it changes production data, so it waits for separate approval.
 */
import type { ModuleKey } from './module-registry';

export type ComplianceLevel = 'statutory' | 'tax_configuration' | 'generic';
export type FeatureStatus = 'supported' | 'partial' | 'not_available';

export interface CountryPack {
  code: string;
  name: string;
  name_ar: string;
  currency: string;
  /** 1 = January. India's financial year starts in April. */
  fiscal_year_start_month: number;
  compliance: ComplianceLevel;
  tax_system: 'vat' | 'gst' | 'none' | 'user_defined';
  standard_vat_rate: number | null;
  rate_status: 'seeded_today' | 'needs_review' | 'user_defined';
  features: Partial<Record<'tax_returns' | 'e_invoicing' | 'tds' | 'wps_payroll_export', FeatureStatus>>;
  /** Can a company be created for this country without a schema change? */
  activation_supported: boolean;
}

const GCC_REVIEW = { compliance: 'tax_configuration', fiscal_year_start_month: 1, activation_supported: true,
  rate_status: 'needs_review', features: { tax_returns: 'partial' } } as const;

export const COUNTRY_PACKS: readonly CountryPack[] = [
  { code: 'AE', name: 'United Arab Emirates', name_ar: 'الإمارات العربية المتحدة', currency: 'AED', fiscal_year_start_month: 1,
    compliance: 'statutory', tax_system: 'vat', standard_vat_rate: 5, rate_status: 'seeded_today', activation_supported: true,
    features: { tax_returns: 'supported', e_invoicing: 'partial', wps_payroll_export: 'supported' } },
  { code: 'IN', name: 'India', name_ar: 'الهند', currency: 'INR', fiscal_year_start_month: 4,
    compliance: 'statutory', tax_system: 'gst', standard_vat_rate: null, rate_status: 'seeded_today', activation_supported: true,
    features: { tax_returns: 'supported', e_invoicing: 'partial', tds: 'supported' } },
  { ...GCC_REVIEW, code: 'SA', name: 'Saudi Arabia', name_ar: 'المملكة العربية السعودية', currency: 'SAR', tax_system: 'vat', standard_vat_rate: 15 },
  { ...GCC_REVIEW, code: 'BH', name: 'Bahrain', name_ar: 'البحرين', currency: 'BHD', tax_system: 'vat', standard_vat_rate: 10 },
  { ...GCC_REVIEW, code: 'OM', name: 'Oman', name_ar: 'عُمان', currency: 'OMR', tax_system: 'vat', standard_vat_rate: 5 },
  { ...GCC_REVIEW, code: 'KW', name: 'Kuwait', name_ar: 'الكويت', currency: 'KWD', tax_system: 'none', standard_vat_rate: null, features: {} },
  { ...GCC_REVIEW, code: 'QA', name: 'Qatar', name_ar: 'قطر', currency: 'QAR', tax_system: 'none', standard_vat_rate: null, features: {} },
];

const BY_CODE = new Map(COUNTRY_PACKS.map((p) => [p.code, p]));

/** The pack for an ISO 3166-1 alpha-2 code; any unknown country gets the generic pack. */
export function getCountryPack(code: string): CountryPack {
  const c = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) throw new Error(`Not an ISO 3166-1 alpha-2 country code: ${code}`);
  return BY_CODE.get(c) ?? {
    code: c, name: c, name_ar: c, currency: '', fiscal_year_start_month: 1,
    compliance: 'generic', tax_system: 'user_defined', standard_vat_rate: null, rate_status: 'user_defined',
    features: {}, activation_supported: false,
  };
}

/** Modules that only make sense, or only exist, in some countries. */
export function countryAllowsModule(pack: CountryPack, module: ModuleKey, countries?: string[]): boolean {
  if (countries && !countries.includes(pack.code)) return false;
  if (module === 'tax_returns') return pack.tax_system !== 'none';
  return true;
}
