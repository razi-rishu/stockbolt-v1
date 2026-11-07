/**
 * Global v1, Phase 2 — legal structure and registration (global05).
 *
 * One legal entity per workspace. The forms offered depend on the company's
 * country; the database (companies_legal_form_check,
 * companies_india_registration_format) enforces the same rules, so a value the
 * UI accepts is always one the server accepts.
 *
 * Format checks exist only where a fixed public format is defined: India's
 * MCA Corporate Identification Number (CIN) and LLP Identification Number.
 * GCC trade-licence / commercial-registration numbers differ by emirate, free
 * zone and ministry, so they are free text — nothing here claims statutory
 * compliance for them.
 */

export const LEGAL_FORMS = [
  'sole_proprietorship', 'partnership', 'llp', 'private_limited', 'public_limited',
  'one_person_company', 'llc', 'free_zone_entity', 'branch_of_foreign_company',
  'civil_company', 'joint_stock_company', 'nonprofit', 'government', 'other',
] as const;
export type LegalForm = typeof LEGAL_FORMS[number];

const GCC = new Set(['AE', 'SA', 'KW', 'BH', 'OM', 'QA']);

/** The legal forms that exist in a country, in the order the picker shows them. */
export function legalFormsFor(country: string | null | undefined): LegalForm[] {
  const c = (country ?? '').toUpperCase();
  if (c === 'IN') {
    return ['sole_proprietorship', 'partnership', 'llp', 'private_limited', 'public_limited',
      'one_person_company', 'nonprofit', 'government', 'other'];
  }
  if (GCC.has(c)) {
    return ['sole_proprietorship', 'civil_company', 'llc', 'joint_stock_company', 'free_zone_entity',
      'branch_of_foreign_company', 'partnership', 'nonprofit', 'government', 'other'];
  }
  return [...LEGAL_FORMS];
}

export interface LegalStructure {
  legal_form: LegalForm | null;
  legal_name: string | null;
  registration_number: string | null;
  registration_authority: string | null;
  incorporation_date: string | null;   // YYYY-MM-DD
}

const INDIA_COMPANY_FORMS: LegalForm[] = ['private_limited', 'public_limited', 'one_person_company'];
const CIN = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;
const LLPIN = /^[A-Z]{3}-[0-9]{4}$/;

/** What the registration-number field is called in a country. */
export function registrationKind(country: string | null | undefined, form: LegalForm | null):
  'cin' | 'llpin' | 'trade_licence' | 'registration' {
  const c = (country ?? '').toUpperCase();
  if (c === 'IN' && form && INDIA_COMPANY_FORMS.includes(form)) return 'cin';
  if (c === 'IN' && form === 'llp') return 'llpin';
  if (GCC.has(c)) return 'trade_licence';
  return 'registration';
}

/** Trim, upper-case the number, turn blanks into null. */
export function normaliseLegal(v: LegalStructure): LegalStructure {
  const s = (x: string | null) => (x ?? '').trim() || null;
  return {
    legal_form: v.legal_form || null,
    legal_name: s(v.legal_name),
    registration_number: s(v.registration_number)?.toUpperCase() ?? null,
    registration_authority: s(v.registration_authority),
    incorporation_date: s(v.incorporation_date),
  };
}

export type LegalError = 'cin_format' | 'llpin_format' | 'too_long' | 'bad_date' | 'unknown_form';

/** Field → error, mirroring the database checks. Empty object = valid. */
export function validateLegal(country: string | null | undefined, raw: LegalStructure): Partial<Record<keyof LegalStructure, LegalError>> {
  const v = normaliseLegal(raw);
  const errors: Partial<Record<keyof LegalStructure, LegalError>> = {};
  if (v.legal_form && !LEGAL_FORMS.includes(v.legal_form)) errors.legal_form = 'unknown_form';
  if ((v.legal_name?.length ?? 0) > 200) errors.legal_name = 'too_long';
  if ((v.registration_authority?.length ?? 0) > 120) errors.registration_authority = 'too_long';
  if ((v.registration_number?.length ?? 0) > 50) errors.registration_number = 'too_long';
  else if (v.registration_number) {
    const kind = registrationKind(country, v.legal_form);
    if (kind === 'cin' && !CIN.test(v.registration_number)) errors.registration_number = 'cin_format';
    if (kind === 'llpin' && !LLPIN.test(v.registration_number)) errors.registration_number = 'llpin_format';
  }
  if (v.incorporation_date && (!/^\d{4}-\d{2}-\d{2}$/.test(v.incorporation_date)
      || v.incorporation_date < '1800-01-01' || v.incorporation_date > '2100-12-31')) {
    errors.incorporation_date = 'bad_date';
  }
  return errors;
}
