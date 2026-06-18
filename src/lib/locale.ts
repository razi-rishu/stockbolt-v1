/**
 * Localization helpers — currency + tax terminology.
 *
 * Production-readiness audit (Issue 1 / 5): monetary values and tax labels
 * must follow the company's country, not hard-coded UAE/AED/VAT/TRN.
 *
 * - formatCurrency() wraps Intl.NumberFormat so every screen renders amounts
 *   in the tenant's own currency (AED, SAR, KWD, INR, …).
 * - getTaxLabels() returns the right tax + registration wording per country
 *   (GCC → VAT / TRN, India → GST / GSTIN).
 *
 * Pure functions, no React — safe to import anywhere (UI, print, exports).
 */

/**
 * Format a money amount in the given ISO-4217 currency.
 * Falls back to a "<CODE> 1,234.00" string if the runtime rejects the code.
 */
export function formatCurrency(
  amount: number | string | null | undefined,
  currency: string = 'AED',
  locale: string = 'en',
): string {
  const n = Number(amount) || 0;
  const code = (currency || 'AED').toUpperCase();
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${code} ${n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

/** Tax + registration terminology for a company's country. */
export function getTaxLabels(country?: string | null): { taxName: string; registrationName: string } {
  switch ((country ?? '').toUpperCase()) {
    case 'IN':
      return { taxName: 'GST', registrationName: 'GSTIN' };
    // GCC (AE/SA/KW/BH/OM/QA) and default
    default:
      return { taxName: 'VAT', registrationName: 'TRN' };
  }
}

/**
 * Convert a transaction-currency amount to the company base currency
 * (Phase 17). base = amount × rate, rounded to 2 dp. The canonical rule the
 * posting engine will use so the GL is always stated in base currency.
 */
export function convertToBase(amount: number | string | null | undefined, rate: number | string | null | undefined): number {
  const a = Number(amount) || 0;
  const r = Number(rate) || 1;
  return Math.round(a * r * 100) / 100;
}

/**
 * Dynamic label for the geographic-region field per country (Phase 16):
 * UAE → "Emirate", India → "State", everything else → "Region".
 */
export function getRegionLabel(country?: string | null): string {
  switch ((country ?? '').toUpperCase()) {
    case 'AE': return 'Emirate';
    case 'IN': return 'State';
    default:   return 'Region';
  }
}

/** Default tax rate (%) for a country — used only to pre-fill new setups. */
export function defaultTaxRate(country?: string | null): number {
  return (country ?? '').toUpperCase() === 'IN' ? 18 : 5;
}
