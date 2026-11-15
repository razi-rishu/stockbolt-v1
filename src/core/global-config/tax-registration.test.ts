import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  validateTaxRegistration, normaliseTaxId, gstinCheckChar, taxIdFormatValid,
  taxRegistrationErrorKey, parseTaxRegistrationServerError,
} from './tax-registration';

// The same cases the phase132 SQL function was run against on staging.
// null = accepted.
const CASES: [string, string, ReturnType<typeof validateTaxRegistration>][] = [
  ['AE', '100123456700003', null],
  ['AE', '10012345670000', 'format'],      // 14 digits
  ['AE', '1001 2345 6700 003', null],      // spaces are dropped
  ['AE', '', 'required'],
  ['AE', '   ', 'required'],
  ['SA', '300000000000003', null],
  ['SA', '310123456789013', null],
  ['SA', '100000000000003', 'format'],     // must start with 3 (a CR number often starts with 1)
  ['SA', '300000000000001', 'format'],     // must end with 3
  ['BH', '200000445300002', null],
  ['BH', '20000044530000', 'format'],
  ['OM', 'OM1100012379', null],
  ['OM', 'OM110001237X', null],            // valid VATINs can end in X
  ['OM', 'om 1100012379', null],
  ['OM', '1100012379', 'format'],          // missing OM
  ['OM', 'OM11000123', 'format'],
  ['IN', '27AAPFU0939F1ZV', null],         // python-stdnum reference GSTIN
  ['IN', '27aapfu0939f1zv', null],
  ['IN', '27AAPFU0939F1Z5', 'format'],     // wrong check character
  ['IN', '29AAGCB7383J1Z4', null],
  ['IN', '40AAPFU0939F1ZV', 'format'],     // no state 40
  ['IN', '27AAPFU0939F', 'format'],
  ['IN', 'AAPFU0939F', 'format'],          // a PAN is not a GSTIN
  ['KW', '123', 'not_available'],
  ['QA', '', 'not_available'],
];

describe('tax registration (phase132)', () => {
  it.each(CASES)('%s %j → %s', (country, value, expected) => {
    expect(validateTaxRegistration(country, true, value)).toBe(expected);
  });

  it('not registered never needs a number, in any country', () => {
    for (const c of ['AE', 'SA', 'BH', 'OM', 'IN', 'KW', 'QA']) {
      expect(validateTaxRegistration(c, false, '')).toBeNull();
      expect(validateTaxRegistration(c, false, 'anything')).toBeNull();
    }
  });

  it('a number valid for one country is re-checked for another', () => {
    expect(validateTaxRegistration('AE', true, '100123456700003')).toBeNull();
    expect(validateTaxRegistration('IN', true, '100123456700003')).toBe('format');
    expect(validateTaxRegistration('SA', true, '100123456700003')).toBe('format');
  });

  it('normalises case, spaces, hyphens and dots', () => {
    expect(normaliseTaxId(' 27-aapfu.0939 f1zv ')).toBe('27AAPFU0939F1ZV');
    expect(normaliseTaxId(null)).toBe('');
  });

  it('GSTIN check character', () => {
    expect(gstinCheckChar('27AAPFU0939F1Z')).toBe('V');
    expect(gstinCheckChar('29AAGCB7383J1Z')).toBe('4');
    expect(gstinCheckChar('short')).toBeNull();
    expect(taxIdFormatValid('IN', '27AAPFU0939F1ZV')).toBe(true);
  });

  it('error keys and server messages', () => {
    expect(taxRegistrationErrorKey('AE', 'format')).toBe('taxReg.format_AE');
    expect(taxRegistrationErrorKey('IN', 'format')).toBe('taxReg.format_IN');
    expect(taxRegistrationErrorKey('AE', 'required')).toBe('taxReg.required');
    expect(parseTaxRegistrationServerError('tax_registration_invalid:format (country IN)')).toBe('format');
    expect(parseTaxRegistrationServerError('complete_onboarding: tax_registration_invalid:required (country AE)')).toBe('required');
    expect(parseTaxRegistrationServerError('something else')).toBeNull();
  });

  it('the database migration enforces the same patterns as the app', () => {
    const dir = resolve(__dirname, '../../../supabase/migrations');
    const file = readdirSync(dir).find(f => f.includes('phase132_tax_registration'));
    expect(file, 'phase132 migration present').toBeTruthy();
    const sql = readFileSync(join(dir, file!), 'utf8');
    for (const pattern of [
      "'^[0-9]{15}$'", "'^3[0-9]{13}3$'", "'^OM[0-9]{9}[0-9X]$'",
      "'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][0-9A-Z][0-9A-Z]$'",
      "state BETWEEN 1 AND 38", "state IN (97, 99)", "c IN ('KW', 'QA')",
    ]) expect(sql, pattern).toContain(pattern);
  });

  it('every message key exists in English and Arabic', () => {
    const en = JSON.parse(readFileSync(resolve(__dirname, '../../i18n/en.json'), 'utf8')).taxReg;
    const ar = JSON.parse(readFileSync(resolve(__dirname, '../../i18n/ar.json'), 'utf8')).taxReg;
    for (const k of ['required', 'not_available', 'format_AE', 'format_SA', 'format_BH', 'format_OM', 'format_IN', 'format_other', 'saved_incomplete']) {
      expect(en[k], `en.taxReg.${k}`).toBeTruthy();
      expect(ar[k], `ar.taxReg.${k}`).toBeTruthy();
    }
  });
});
