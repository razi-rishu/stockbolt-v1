/**
 * VAT / GST registration number — format rules per country (phase132).
 *
 * ONE source of truth for the app. The database enforces the same rules in
 * public.tax_registration_error() (supabase/migrations/…phase132…), and
 * tax-registration.test.ts pins both to the same cases. Change them together.
 *
 * A format check proves only that the number is well formed, never that the
 * authority issued it: each authority runs its own lookup for that.
 * These are VAT / GST numbers only — not a trade licence, commercial
 * registration (CR), PAN, CIN or corporate-tax number.
 *
 * Formats (checked 2026-11-15; sources in the phase132 migration header):
 *   AE  TRN       15 digits                                   (FTA)
 *   SA  VAT no.   15 digits, first and last digit 3            (ZATCA, BR-KSA-40)
 *   BH  VAT acct  15 digits                                   (NBR; no published check digit)
 *   OM  VATIN     'OM' + 9 digits + a final digit or 'X'      (Oman Tax Authority format;
 *                 no published check digit — a final X occurs on valid numbers)
 *   IN  GSTIN     2-digit state code (01–38, 97, 99) + PAN (AAAAA9999A)
 *                 + entity character (1–9, A–Z) + 1 character + check character
 *                 (mod-36 check over the first 14 characters)
 *   KW, QA        no VAT in force — registration is not available
 */
import { vatApplies } from './country-packs';

export type TaxRegistrationError = 'required' | 'not_available' | 'format';

/** Upper-case and drop spaces, hyphens and dots people type for readability. */
export function normaliseTaxId(value: string | null | undefined): string {
  return (value ?? '').toUpperCase().replace(/[\s.-]/g, '');
}

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** GSTIN check character for the first 14 characters (GSTN mod-36 scheme). */
export function gstinCheckChar(first14: string): string | null {
  if (!/^[0-9A-Z]{14}$/.test(first14)) return null;
  let total = 0;
  for (let i = 0; i < 14; i++) {
    const product = ALPHABET.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    total += Math.floor(product / 36) + (product % 36);
  }
  return ALPHABET[(36 - (total % 36)) % 36];
}

function gstinValid(n: string): boolean {
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][0-9A-Z][0-9A-Z]$/.test(n)) return false;
  const state = parseInt(n.slice(0, 2), 10);
  if (!((state >= 1 && state <= 38) || state === 97 || state === 99)) return false;
  return gstinCheckChar(n.slice(0, 14)) === n[14];
}

/** Is `value` (already normalised) a well-formed VAT / GST number for `country`? */
export function taxIdFormatValid(country: string, value: string): boolean {
  switch ((country ?? '').toUpperCase()) {
    case 'AE': return /^[0-9]{15}$/.test(value);
    case 'SA': return /^3[0-9]{13}3$/.test(value);
    case 'BH': return /^[0-9]{15}$/.test(value);
    case 'OM': return /^OM[0-9]{9}[0-9X]$/.test(value);
    case 'IN': return gstinValid(value);
    default:   return value.length > 0 && value.length <= 50;   // no rule claimed
  }
}

/**
 * Why a company's tax registration cannot be saved, or null when it can.
 * Not registered → always fine (an existing number is left alone).
 */
export function validateTaxRegistration(
  country: string, isRegistered: boolean, taxId: string | null | undefined,
): TaxRegistrationError | null {
  if (!isRegistered) return null;
  if (!vatApplies(country)) return 'not_available';
  const n = normaliseTaxId(taxId);
  if (!n) return 'required';
  return taxIdFormatValid(country, n) ? null : 'format';
}

/** i18n key for an error (taxReg.*), country-specific for 'format'. */
export function taxRegistrationErrorKey(country: string, err: TaxRegistrationError): string {
  if (err !== 'format') return `taxReg.${err}`;
  const c = (country ?? '').toUpperCase();
  return ['AE', 'SA', 'BH', 'OM', 'IN'].includes(c) ? `taxReg.format_${c}` : 'taxReg.format_other';
}

/** Server message from tg_companies_tax_registration → error code, if it is one. */
export function parseTaxRegistrationServerError(message: string): TaxRegistrationError | null {
  const m = /tax_registration_invalid:(required|not_available|format)/.exec(message ?? '');
  return m ? (m[1] as TaxRegistrationError) : null;
}
