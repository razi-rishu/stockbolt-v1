import { describe, it, expect } from 'vitest';
import { legalFormsFor, registrationKind, validateLegal, normaliseLegal, LEGAL_FORMS, type LegalStructure } from './legal-structure';

const blank: LegalStructure = { legal_form: null, legal_name: null, registration_number: null, registration_authority: null, incorporation_date: null };

describe('legal structure (global05)', () => {
  it('offers country-specific forms, all within the database list', () => {
    expect(legalFormsFor('IN')).toContain('llp');
    expect(legalFormsFor('IN')).not.toContain('free_zone_entity');
    expect(legalFormsFor('AE')).toContain('free_zone_entity');
    expect(legalFormsFor('AE')).not.toContain('one_person_company');
    expect(legalFormsFor('XX')).toEqual([...LEGAL_FORMS]);
    for (const c of ['IN', 'AE', 'SA', 'XX']) for (const f of legalFormsFor(c)) expect(LEGAL_FORMS).toContain(f);
  });

  it('an empty structure is valid everywhere (existing companies keep NULLs)', () => {
    expect(validateLegal('IN', blank)).toEqual({});
    expect(validateLegal('AE', blank)).toEqual({});
  });

  it('India: a company needs a CIN in the MCA format, an LLP an LLPIN', () => {
    expect(registrationKind('IN', 'private_limited')).toBe('cin');
    expect(validateLegal('IN', { ...blank, legal_form: 'private_limited', registration_number: 'U72900KL2019PTC012345' })).toEqual({});
    expect(validateLegal('IN', { ...blank, legal_form: 'private_limited', registration_number: 'u72900kl2019ptc012345 ' })).toEqual({});
    expect(validateLegal('IN', { ...blank, legal_form: 'private_limited', registration_number: '12345' }))
      .toEqual({ registration_number: 'cin_format' });
    expect(validateLegal('IN', { ...blank, legal_form: 'llp', registration_number: 'AAB-1234' })).toEqual({});
    expect(validateLegal('IN', { ...blank, legal_form: 'llp', registration_number: 'AAB1234' }))
      .toEqual({ registration_number: 'llpin_format' });
    expect(validateLegal('IN', { ...blank, legal_form: 'sole_proprietorship', registration_number: 'Udyam-KL-01-0000001' })).toEqual({});
  });

  it('GCC registration numbers are free text (no statutory format claimed)', () => {
    expect(registrationKind('AE', 'llc')).toBe('trade_licence');
    expect(validateLegal('AE', { ...blank, legal_form: 'llc', registration_number: 'CN-1234567' })).toEqual({});
  });

  it('lengths and dates mirror the database checks', () => {
    expect(validateLegal('AE', { ...blank, legal_name: 'x'.repeat(201) })).toEqual({ legal_name: 'too_long' });
    expect(validateLegal('AE', { ...blank, incorporation_date: '1700-01-01' })).toEqual({ incorporation_date: 'bad_date' });
    expect(normaliseLegal({ ...blank, legal_name: '  ', registration_number: ' cn-1 ' }))
      .toEqual({ ...blank, registration_number: 'CN-1' });
  });
});
