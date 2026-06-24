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
 * Format a date for DISPLAY as DD/MM/YYYY (the app-wide display format).
 *
 * Accepts an ISO date ('YYYY-MM-DD'), an ISO timestamp, a Date, or null.
 * Returns '' for empty input and the original string if it can't be parsed.
 * NOTE: only for display — keep storing / querying / <input type="date"> in
 * ISO (YYYY-MM-DD).
 */
export function formatDate(d: string | Date | null | undefined): string {
  if (d == null || d === '') return '';
  const s = typeof d === 'string' ? d : (d instanceof Date && !isNaN(d.getTime()) ? d.toISOString() : '');
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const dt = new Date(typeof d === 'string' ? d : (d as Date));
  if (isNaN(dt.getTime())) return typeof d === 'string' ? d : '';
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${dt.getFullYear()}`;
}

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

/**
 * Short fiscal-year label from the company's fiscal_year_start date, e.g.
 * 2026-01-01 → "Jan–Dec", 2026-04-01 → "Apr–Mar". Derived from the start
 * month so it follows the tenant's setting (Jan–Dec GCC, Apr–Mar India).
 */
export function fiscalYearLabel(fiscalYearStart?: string | null): string {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = /^\d{4}-(\d{2})/.exec(fiscalYearStart ?? '');
  const startIdx = m ? (parseInt(m[1], 10) - 1) : 0;
  const safeStart = startIdx >= 0 && startIdx < 12 ? startIdx : 0;
  return `${MONTHS[safeStart]}–${MONTHS[(safeStart + 11) % 12]}`;
}
