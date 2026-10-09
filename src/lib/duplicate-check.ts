import { digitsOf } from '@/lib/contact-search';

/**
 * Duplicate detection for master data.
 *
 * The rule, and the reason it is a WARNING and not a block:
 *
 *   A NAME IS NOT AN IDENTIFIER. Two customers really can both be called
 *   "Mohammed Ali", and two products really can both be called "Brake Pad
 *   Front". Warning on names would fire constantly, and a warning that
 *   fires constantly is one people learn to click past - which is how the
 *   warning that mattered gets missed too.
 *
 *   An IDENTIFIER is different. A phone number, an email, a TRN, a SKU, an
 *   OE number, a barcode - these are meant to point at one thing. When one
 *   points at two, either you are about to create a duplicate record, or
 *   two genuinely different things share an identifier and you should know
 *   that before you save.
 *
 * Still a warning rather than a block, because every one of these has a
 * legitimate repeat: a husband and wife on one mobile, a branch sharing head
 * office's TRN, two brands manufacturing the same OE part. The operator
 * decides; the system only makes sure they decided knowingly.
 *
 * The one exception is SKU, which the database already enforces as unique
 * per company. There the warning is not advisory - it tells you the save is
 * going to be refused, before it is.
 */

export type DuplicateField =
  | 'phone' | 'email' | 'tax_id'
  | 'sku' | 'oe_number' | 'barcode';

export interface DuplicateHit {
  /** The EXISTING record that already carries this identifier. */
  id: string;
  label: string;
  field: DuplicateField;
  /** The value as the operator typed it, for echoing back in the message. */
  value: string;
  /** True when the database will refuse the save outright (SKU today). */
  blocking: boolean;
}

/**
 * A phone has to be this many digits before two of them matching means
 * anything. Without a floor, an operator who has typed "05" would be told
 * they are duplicating every mobile in the company.
 */
const MIN_PHONE_DIGITS = 6;

/**
 * Country codes we serve. Order matters only in that longer codes are tried
 * first, so '971' is never mistaken for '97' + rest.
 */
const COUNTRY_CODES = ['971', '966', '965', '973', '968', '974', '91'];

/**
 * The national significant number - what is left after the dialling wrapper.
 *
 * This is the part that decides whether the whole feature works. The same
 * phone reaches the same person written every one of these ways:
 *
 *     +971 56 408 8966     971564088966     0564088966      564088966
 *     00971 4 224 2636     97142242636      042242636       42242636
 *
 * A literal digit comparison treats those as different numbers, so an
 * operator typing the local form would never be warned about a contact saved
 * in the international form - which is the normal way this data arrives.
 *
 * Rules, applied in order:
 *   1. '00' is the international access prefix - drop it.
 *   2. A LEADING ZERO means this is already the national form (trunk
 *      prefix), so drop the zero and stop. Checked BEFORE the country code
 *      so a national number starting '091...' is never mistaken for India.
 *   3. Otherwise strip a leading country code we recognise.
 *
 * Anything we do not recognise is returned as-is, so an unfamiliar country
 * still matches itself.
 */
export function nationalNumber(raw: string | null | undefined): string {
  let d = digitsOf(raw ?? '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) return d.replace(/^0+/, '');
  for (const cc of COUNTRY_CODES) {
    // Only strip when something plausible is left; '971' alone is not a
    // country code followed by an empty number.
    if (d.startsWith(cc) && d.length - cc.length >= MIN_PHONE_DIGITS) {
      return d.slice(cc.length);
    }
  }
  return d;
}

/** Case- and punctuation-insensitive. '48520-60172' and '4852060172' are the
 *  same OE part; '48520 60172' is too. Auto-parts catalogues are written
 *  every one of those ways, often in the same afternoon. */
const loose = (v: string | null | undefined) =>
  (v ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();

/** Trimmed and lower-cased, but punctuation KEPT - an email's dots and plus
 *  signs are part of it. */
const email = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();

export interface ContactIdentity {
  id: string;
  name: string;
  phone?: string | null;
  mobile?: string | null;
  email?: string | null;
  tax_id?: string | null;
}

export interface ContactCandidate {
  phone?: string;
  mobile?: string;
  email?: string;
  tax_id?: string;
}

/**
 * Existing contacts that already carry one of the identifiers being typed.
 *
 * `phone` and `mobile` are checked against BOTH stored columns, because a
 * number filed under "mobile" on one record and "phone" on another is still
 * the same number reaching the same person.
 */
export function findContactDuplicates(
  rows: ContactIdentity[],
  candidate: ContactCandidate,
  excludeId?: string,
): DuplicateHit[] {
  const hits: DuplicateHit[] = [];
  const seen = new Set<string>();

  const push = (id: string, label: string, field: DuplicateField, value: string) => {
    const key = `${id}:${field}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ id, label, field, value, blocking: false });
  };

  const typedNumbers = [candidate.phone, candidate.mobile]
    .map(v => nationalNumber(v))
    .filter(d => d.length >= MIN_PHONE_DIGITS);
  const typedEmail = email(candidate.email);
  const typedTax   = loose(candidate.tax_id);

  for (const r of rows) {
    if (excludeId && r.id === excludeId) continue;

    if (typedNumbers.length) {
      const stored = [r.phone, r.mobile]
        .map(v => nationalNumber(v))
        .filter(d => d.length >= MIN_PHONE_DIGITS);
      const match = typedNumbers.find(t => stored.includes(t));
      if (match) push(r.id, r.name, 'phone', match);
    }
    if (typedEmail && email(r.email) === typedEmail) {
      push(r.id, r.name, 'email', typedEmail);
    }
    if (typedTax && loose(r.tax_id) === typedTax) {
      push(r.id, r.name, 'tax_id', candidate.tax_id ?? '');
    }
  }
  return hits;
}

export interface ProductIdentity {
  id: string;
  name: string;
  sku?: string | null;
  oe_number?: string | null;
  barcode?: string | null;
}

export interface ProductCandidate {
  sku?: string;
  oe_number?: string;
  barcode?: string;
}

/**
 * Existing products that already carry one of the identifiers being typed.
 *
 * SKU is flagged `blocking` because `products_company_id_sku_key` will refuse
 * the insert. The other two are advisory: two brands making the same part
 * share an OE number by definition, and that is a normal catalogue, not a
 * mistake.
 */
export function findProductDuplicates(
  rows: ProductIdentity[],
  candidate: ProductCandidate,
  excludeId?: string,
): DuplicateHit[] {
  const hits: DuplicateHit[] = [];
  const seen = new Set<string>();

  const check = (
    field: DuplicateField,
    typedRaw: string | undefined,
    of: (r: ProductIdentity) => string | null | undefined,
    blocking: boolean,
  ) => {
    const typed = loose(typedRaw);
    if (!typed) return;
    for (const r of rows) {
      if (excludeId && r.id === excludeId) continue;
      if (loose(of(r)) !== typed) continue;
      const key = `${r.id}:${field}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ id: r.id, label: r.name, field, value: typedRaw ?? '', blocking });
    }
  };

  check('sku',       candidate.sku,       r => r.sku,       true);
  check('oe_number', candidate.oe_number, r => r.oe_number, false);
  check('barcode',   candidate.barcode,   r => r.barcode,   false);
  return hits;
}
