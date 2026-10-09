import { describe, it, expect } from 'vitest';
import { contactMatches, type SearchableContact } from '@/lib/contact-search';

/**
 * The reported bug, exactly: ASHRAF's number showed as 0503626654 in the list
 * and searching that string returned "No contacts yet."
 *
 * Two causes. The Phone COLUMN renders `phone ?? mobile`, but the filter only
 * looked at `phone` — so a number visible on screen was unfindable. And
 * numbers are stored however they were typed, so a literal substring match
 * required your spacing to match whoever saved the record.
 */

const c = (over: Partial<SearchableContact> = {}): SearchableContact => ({
  name: 'ASHRAF', ...over,
});

describe('contact search', () => {
  it('finds the number the list is SHOWING, not just the phone column', () => {
    // ASHRAF: phone is null, mobile holds the number, the column shows it.
    const ashraf = c({ phone: null, mobile: '0503626654' });
    expect(contactMatches(ashraf, '0503626654')).toBe(true);
  });

  it('is not defeated by how the number was typed', () => {
    const spaced = c({ phone: '+971 56 408 8966' });
    expect(contactMatches(spaced, '564088966'), 'digits only').toBe(true);
    expect(contactMatches(spaced, '+971564088966'), 'no spaces').toBe(true);
    expect(contactMatches(spaced, '971 56 408'), 'partial, spaced').toBe(true);
  });

  it('still matches name, Arabic name and email', () => {
    expect(contactMatches(c(), 'ash'), 'case-insensitive name').toBe(true);
    expect(contactMatches(c({ name_ar: 'أشرف' }), 'أشرف'), 'arabic').toBe(true);
    expect(contactMatches(c({ email: 'A@B.com' }), 'a@b'), 'email').toBe(true);
  });

  it('a non-numeric query never matches every contact', () => {
    // The trap in digit-normalising: digitsOf('ashraf') is '', and
    // ''.includes('') is true, which would match everything that has a phone.
    const other = c({ name: 'JUMA ARIF', phone: '+971563566633' });
    expect(contactMatches(other, 'ashraf')).toBe(false);
  });

  it('a very short query falls back to literal matching', () => {
    // Below the digit threshold the match is literal, which is what you
    // want while someone is still typing: '9' narrowing to nothing would
    // be worse than narrowing to a lot. The threshold exists only to stop
    // digitsOf('') matching everything, not to suppress short searches.
    const juma = c({ name: 'JUMA', phone: '+971563566633' });
    expect(contactMatches(juma, '9'), 'a literal digit still matches').toBe(true);
    expect(contactMatches(juma, '+9'), 'and so does a literal prefix').toBe(true);
    // But a short string that is genuinely absent must not match.
    expect(contactMatches(juma, 'zz')).toBe(false);
  });

  it('an empty query shows everyone', () => {
    expect(contactMatches(c(), '')).toBe(true);
    expect(contactMatches(c(), '   '), 'whitespace is empty too').toBe(true);
  });

  it('searches the contact person number as well', () => {
    const withPerson = c({ phone: null, mobile: null, contact_person_phone: '0509999999' });
    expect(contactMatches(withPerson, '0509999999')).toBe(true);
  });

  it('does not match a contact with no numbers at all', () => {
    // CASH CLIENT has neither, and must not be swept up by a numeric query.
    const cash = c({ name: 'CASH CLIENT', phone: null, mobile: null });
    expect(contactMatches(cash, '0503626654')).toBe(false);
  });
});
