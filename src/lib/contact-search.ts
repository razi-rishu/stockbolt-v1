/**
 * Whether a contact matches what someone typed into the list search.
 *
 * Extracted from the list so it can be tested without a database, because the
 * bug it fixes was invisible: the Phone column renders `phone ?? mobile`, but
 * the filter only looked at `phone`. A contact whose number lived in `mobile`
 * displayed a number on screen that no search would ever find.
 *
 * The second half is formatting. Numbers are stored however they were typed —
 * '+971 56 408 8966', '0566683289', '+97477822626' — so a literal substring
 * match requires the spacing you use to match the spacing someone else
 * happened to save. Numeric queries compare digits only.
 */

export interface SearchableContact {
  name: string;
  name_ar?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  contact_person_phone?: string | null;
}

export const digitsOf = (v: string) => v.replace(/\D/g, '');

/** Below this, a digit comparison is more noise than signal — and an empty
 *  digit string would match every contact, since ''.includes('') is true. */
const MIN_DIGITS = 3;

export function contactMatches(c: SearchableContact, raw: string): boolean {
  const q = raw.trim();
  if (!q) return true;

  const qLower  = q.toLowerCase();
  const qDigits = digitsOf(q);

  if (c.name.toLowerCase().includes(qLower)) return true;
  // Arabic is not case-folded: toLowerCase() is a no-op on it and the extra
  // call would only risk surprises with mixed scripts.
  if ((c.name_ar ?? '').includes(q)) return true;
  if ((c.email ?? '').toLowerCase().includes(qLower)) return true;

  // Every number the record holds, including the one the column falls back to.
  const numbers = [c.phone, c.mobile, c.contact_person_phone];
  if (qDigits.length >= MIN_DIGITS) {
    return numbers.some(n => !!n && digitsOf(n).includes(qDigits));
  }
  return numbers.some(n => (n ?? '').includes(q));
}
