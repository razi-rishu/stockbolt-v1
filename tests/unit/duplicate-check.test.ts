import { describe, it, expect } from 'vitest';
import {
  findContactDuplicates, findProductDuplicates, nationalNumber,
  type ContactIdentity, type ProductIdentity,
} from '@/lib/duplicate-check';

const contacts: ContactIdentity[] = [
  { id: 'c1', name: 'ASHRAF',          phone: null,            mobile: '+971 56 408 8966', email: 'ashraf@x.com', tax_id: '100123456700003' },
  { id: 'c2', name: 'JUMA ARIF',       phone: '+971563566633', mobile: null,               email: null,           tax_id: null },
  { id: 'c3', name: 'AL NOOR TRADING', phone: '042242636',     mobile: '042242636',        email: null,           tax_id: '100123456700003' },
];

const products: ProductIdentity[] = [
  { id: 'p1', name: 'PAD KIT FRONT', sku: '0301FDR', oe_number: '48520-60172', barcode: null },
  { id: 'p2', name: 'PAD KIT REAR',  sku: '0302RDR', oe_number: '4852060172',  barcode: '6291000000017' },
  { id: 'p3', name: 'OIL FILTER',    sku: null,      oe_number: null,          barcode: null },
];

describe('contact duplicates', () => {
  it('a different name on the SAME number is the whole point', () => {
    // "If the customer comes in a different name but the number same."
    const hits = findContactDuplicates(contacts, { mobile: '0564088966' });
    expect(hits.map(h => h.label)).toEqual(['ASHRAF']);
    expect(hits[0]!.field).toBe('phone');
  });

  it('matches across the phone/mobile divide', () => {
    // Filed under `mobile` on ASHRAF, typed into `phone` here. Same number,
    // same person; which column it landed in is an accident of data entry.
    expect(findContactDuplicates(contacts, { phone: '+971 56 408 8966' })
      .map(h => h.label)).toEqual(['ASHRAF']);
  });

  it('the local form finds a contact saved in the international form', () => {
    // The case that decides whether this feature works at all. ASHRAF is
    // stored as '+971 56 408 8966'; an operator types the local '0564088966'.
    // Same phone, different digits. A literal comparison never fires.
    expect(findContactDuplicates(contacts, { mobile: '0564088966' })
      .map(h => h.label)).toEqual(['ASHRAF']);
    // ...and the reverse, for a contact saved locally.
    const local: ContactIdentity[] = [{ id: 'z', name: 'LOCAL', mobile: '0501234567' }];
    expect(findContactDuplicates(local, { mobile: '+971 50 123 4567' })
      .map(h => h.label)).toEqual(['LOCAL']);
  });

  it('normalises every dialling wrapper we serve', () => {
    // GCC + India: the same national number whichever way it was written.
    expect(nationalNumber('+971 56 408 8966')).toBe('564088966');
    expect(nationalNumber('00971564088966')).toBe('564088966');
    expect(nationalNumber('0564088966')).toBe('564088966');
    expect(nationalNumber('564088966')).toBe('564088966');
    // UAE landline - the trunk zero and the country code wrap the SAME
    // significant number, which a last-N-digits shortcut would get wrong.
    expect(nationalNumber('042242636')).toBe('42242636');
    expect(nationalNumber('+971 4 224 2636')).toBe('42242636');
    // Saudi and India.
    expect(nationalNumber('966561992600')).toBe('561992600');
    expect(nationalNumber('0561992600')).toBe('561992600');
    expect(nationalNumber('+91 98765 43210')).toBe('9876543210');
    expect(nationalNumber('09876543210')).toBe('9876543210');
    // Unrecognised country: returned as-is so it still matches itself.
    expect(nationalNumber('+44 20 7946 0958')).toBe('442079460958');
  });

  it('ignores how the number was punctuated', () => {
    for (const typed of ['+971563566633', '971563566633', '971 56 356 6633', '971-56-356-6633']) {
      expect(findContactDuplicates(contacts, { phone: typed }).map(h => h.label),
        `typed as ${typed}`).toEqual(['JUMA ARIF']);
    }
  });

  it('says nothing about a name, however identical', () => {
    // "Name comes same we can't give warning for names." Two real customers
    // can share a name; warning there would fire so often that the warnings
    // that matter get clicked past.
    const twins: ContactIdentity[] = [{ id: 'x', name: 'MOHAMMED ALI' }];
    expect(findContactDuplicates(twins, {})).toEqual([]);
  });

  it('does not fire on a half-typed number', () => {
    expect(findContactDuplicates(contacts, { mobile: '05' })).toEqual([]);
    expect(findContactDuplicates(contacts, { mobile: '0564' })).toEqual([]);
  });

  it('catches a shared TRN and a shared email', () => {
    expect(findContactDuplicates(contacts, { tax_id: '100 123 456 700003' })
      .map(h => h.label).sort()).toEqual(['AL NOOR TRADING', 'ASHRAF']);
    expect(findContactDuplicates(contacts, { email: '  ASHRAF@X.COM ' })
      .map(h => h.label)).toEqual(['ASHRAF']);
  });

  it('never flags the record being edited against itself', () => {
    expect(findContactDuplicates(contacts, { mobile: '+971 56 408 8966' }, 'c1')).toEqual([]);
  });

  it('reports one hit per record per field, not one per column', () => {
    // AL NOOR has the same number in BOTH phone and mobile. One duplicate.
    const hits = findContactDuplicates(contacts, { phone: '042242636' });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.label).toBe('AL NOOR TRADING');
  });
});

describe('product duplicates', () => {
  it('a duplicate SKU is marked blocking, because the database refuses it', () => {
    const hits = findProductDuplicates(products, { sku: '0301FDR' });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.blocking, 'products_company_id_sku_key rejects the save').toBe(true);
  });

  it('a duplicate OE number is advisory, not blocking', () => {
    // Two brands making the same part share an OE number by definition.
    const hits = findProductDuplicates(products, { oe_number: '48520-60172' });
    expect(hits.map(h => h.label).sort()).toEqual(['PAD KIT FRONT', 'PAD KIT REAR']);
    expect(hits.every(h => h.blocking === false)).toBe(true);
  });

  it('an OE number matches however the catalogue punctuated it', () => {
    // p1 stores '48520-60172', p2 stores '4852060172'. Same part.
    for (const typed of ['48520-60172', '4852060172', '48520 60172', '48520/60172']) {
      expect(findProductDuplicates(products, { oe_number: typed }).length,
        `typed as ${typed}`).toBe(2);
    }
  });

  it('SKU match is case-insensitive', () => {
    expect(findProductDuplicates(products, { sku: '0301fdr' }).map(h => h.label))
      .toEqual(['PAD KIT FRONT']);
  });

  it('a blank identifier matches nothing, including other blanks', () => {
    // p3 has null sku/oe/barcode. An empty field must not "match" it.
    expect(findProductDuplicates(products, { sku: '', oe_number: '', barcode: '' })).toEqual([]);
    expect(findProductDuplicates(products, {})).toEqual([]);
  });

  it('never flags the product being edited against itself', () => {
    expect(findProductDuplicates(products, { sku: '0301FDR' }, 'p1')).toEqual([]);
  });

  it('reports each matching field separately', () => {
    const hits = findProductDuplicates(products, { sku: '0302RDR', barcode: '6291000000017' });
    expect(hits.map(h => h.field).sort()).toEqual(['barcode', 'sku']);
  });
});
