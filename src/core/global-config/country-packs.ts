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
 * Phase 4 (2026-11-07): every rate below was checked against the tax
 * authority's own publication (`rate_source`) and is `verified` as of
 * `rate_verified_on`. It drives both the database seed for NEW companies
 * (seed_default_tax_rates, phase123) and the default rate on new document
 * lines (defaultTaxRate in lib/locale). Existing companies' rates are never
 * rewritten by this. A verified RATE is not a compliance claim: SA / BH / OM
 * stay `tax_configuration` (no ZATCA e-invoicing, no official return format).
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
  rate_status: 'verified' | 'needs_review' | 'user_defined';
  /** Where the rate was checked (official publication). */
  rate_source?: string;
  /** YYYY-MM-DD the rate was last checked. */
  rate_verified_on?: string;
  features: Partial<Record<'tax_returns' | 'e_invoicing' | 'tds' | 'wps_payroll_export', FeatureStatus>>;
  /** Can a company be created for this country without a schema change? */
  activation_supported: boolean;
}

const VERIFIED_ON = '2026-11-07';
const GCC_CONFIG = { compliance: 'tax_configuration', fiscal_year_start_month: 1, activation_supported: true,
  rate_status: 'verified', rate_verified_on: VERIFIED_ON, features: { tax_returns: 'partial' } } as const;

export const COUNTRY_PACKS: readonly CountryPack[] = [
  { code: 'AE', name: 'United Arab Emirates', name_ar: 'الإمارات العربية المتحدة', currency: 'AED', fiscal_year_start_month: 1,
    compliance: 'statutory', tax_system: 'vat', standard_vat_rate: 5, rate_status: 'verified', activation_supported: true,
    rate_source: 'FTA - Federal Decree-Law No. 8 of 2017 (tax.gov.ae)', rate_verified_on: VERIFIED_ON,
    features: { tax_returns: 'supported', e_invoicing: 'partial', wps_payroll_export: 'supported' } },
  { code: 'IN', name: 'India', name_ar: 'الهند', currency: 'INR', fiscal_year_start_month: 4,
    // GST 2.0 (56th GST Council, effective 2025-09-22): slabs 0 / 5 / 18 / 40;
    // 12 % and 28 % abolished. 18 % is the standard rate.
    compliance: 'statutory', tax_system: 'gst', standard_vat_rate: 18, rate_status: 'verified', activation_supported: true,
    rate_source: 'GST Council 56th meeting / PIB (gstcouncil.gov.in, pib.gov.in)', rate_verified_on: VERIFIED_ON,
    features: { tax_returns: 'supported', e_invoicing: 'partial', tds: 'supported' } },
  { ...GCC_CONFIG, code: 'SA', name: 'Saudi Arabia', name_ar: 'المملكة العربية السعودية', currency: 'SAR', tax_system: 'vat', standard_vat_rate: 15,
    rate_source: 'ZATCA VAT guidelines (zatca.gov.sa)' },
  { ...GCC_CONFIG, code: 'BH', name: 'Bahrain', name_ar: 'البحرين', currency: 'BHD', tax_system: 'vat', standard_vat_rate: 10,
    rate_source: 'NBR - 10 % since 2022-01-01 (nbr.gov.bh)' },
  { ...GCC_CONFIG, code: 'OM', name: 'Oman', name_ar: 'عُمان', currency: 'OMR', tax_system: 'vat', standard_vat_rate: 5,
    rate_source: 'Oman Tax Authority - Tax Rate (tms.taxoman.gov.om)' },
  // No VAT law in force (verified 2026-11-07). Re-check when the GTA (Qatar) or
  // the Ministry of Finance (Kuwait) announces a start date.
  { ...GCC_CONFIG, code: 'KW', name: 'Kuwait', name_ar: 'الكويت', currency: 'KWD', tax_system: 'none', standard_vat_rate: 0,
    rate_source: 'No VAT law in force', features: {} },
  { ...GCC_CONFIG, code: 'QA', name: 'Qatar', name_ar: 'قطر', currency: 'QAR', tax_system: 'none', standard_vat_rate: 0,
    rate_source: 'No VAT law in force', features: {} },
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
