/**
 * Contacts adapter (customers + suppliers) — Phase 14.11b.
 *
 * One adapter handles both directions; the `type` column on each row
 * distinguishes ('customer' | 'supplier' | 'both'). Operator pastes a
 * file in any mix.
 *
 * Natural key for dedup is `code` (when set) or `name` (fallback).
 * If neither is set the row is treated as new every time.
 */
import type { ModuleAdapter, ApplyResult, ValidationResult } from './types';
import type { ContactRow, ContactInsert } from '@/data/adapter';
import { getAdapter } from '@/data/index';

const HEADERS = [
  'type',           // customer | supplier | both
  'code',
  'name',
  'name_ar',
  'tax_id',         // UAE TRN / India GSTIN
  'email',
  'phone',
  'mobile',
  'currency',
  'payment_terms_days',
  'credit_limit',
  'address_street',
  'address_city',
  'address_country',
  'is_active',
] as const;

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v == null || v === '') return fallback;
  const s = v.toLowerCase().trim();
  if (['yes','y','true','1','active'].includes(s)) return true;
  if (['no','n','false','0','inactive'].includes(s)) return false;
  return fallback;
}
function parseNumber(v: string | undefined): { ok: true; value: number } | { ok: false } {
  if (v == null || v.trim() === '') return { ok: true, value: 0 };
  const n = parseFloat(v.replace(/[, ]/g, ''));
  return isFinite(n) ? { ok: true, value: n } : { ok: false };
}

function naturalKey(r: { code?: string | null; name?: string | null }): string {
  // code first (operator-controlled, stable). Fall back to name lower-cased.
  if (r.code && r.code.trim()) return `code:${r.code.trim().toLowerCase()}`;
  if (r.name) return `name:${r.name.trim().toLowerCase()}`;
  return '';
}

export const contactsAdapter: ModuleAdapter<ContactRow, ContactInsert & { __existingId?: string }> = {
  key:   'contacts',
  label: 'Contacts',
  description: 'Customers + suppliers in one sheet. The "type" column controls which side.',
  icon:  '👥',
  headers: [...HEADERS],

  template: () => [
    {
      type: 'customer',
      code: 'CUST-0001',
      name: 'Khaleej Auto Parts LLC',
      name_ar: 'الخليج لقطع غيار السيارات',
      tax_id: '100123456700003',
      email: 'ahmed@khaleej.ae',
      phone: '+971 6 555 0123',
      mobile: '+971 50 123 4567',
      currency: 'AED',
      payment_terms_days: '30',
      credit_limit: '100000',
      address_street: 'Industrial Area 4',
      address_city: 'Sharjah',
      address_country: 'AE',
      is_active: 'yes',
    },
    {
      type: 'supplier',
      code: 'SUP-0001',
      name: 'Castrol Distributor',
      name_ar: '',
      tax_id: '',
      email: 'sales@castrol-dist.ae',
      phone: '+971 4 111 2222',
      mobile: '',
      currency: 'AED',
      payment_terms_days: '45',
      credit_limit: '0',
      address_street: '',
      address_city: 'Dubai',
      address_country: 'AE',
      is_active: 'yes',
    },
  ],

  fetchAll: (cid) => getAdapter().contacts.list(cid, 'both'),

  serialize: (c) => ({
    type:               c.type,
    code:               c.code ?? '',
    name:               c.name,
    name_ar:            c.name_ar ?? '',
    tax_id:             c.tax_id ?? '',
    email:              c.email ?? '',
    phone:              c.phone ?? '',
    mobile:             c.mobile ?? '',
    currency:           c.currency,
    payment_terms_days: String(c.payment_terms_days ?? 0),
    credit_limit:       String(c.credit_limit ?? 0),
    address_street:     c.address_street ?? '',
    address_city:       c.address_city ?? '',
    address_country:    c.address_country ?? '',
    is_active:          c.is_active ? 'yes' : 'no',
  }),

  validate: (raw, ctx): ValidationResult<ContactInsert & { __existingId?: string }> => {
    const errors: string[] = [];
    const name = (raw.name ?? '').trim();
    const type = (raw.type ?? 'customer').trim().toLowerCase();

    if (!name) errors.push('name is required');
    if (!['customer','supplier','both'].includes(type)) {
      errors.push(`type "${raw.type}" must be customer / supplier / both`);
    }

    const ptR = parseNumber(raw.payment_terms_days);
    if (!ptR.ok) errors.push(`payment_terms_days "${raw.payment_terms_days}" is not a number`);
    const clR = parseNumber(raw.credit_limit);
    if (!clR.ok) errors.push(`credit_limit "${raw.credit_limit}" is not a number`);

    if (errors.length > 0) return { ok: false, errors };

    const row: ContactInsert & { __existingId?: string } = {
      company_id:         ctx.company_id,
      type,
      code:               raw.code?.trim() || null,
      name,
      name_ar:            raw.name_ar?.trim() || null,
      tax_id:             raw.tax_id?.trim() || null,
      email:              raw.email?.trim() || null,
      phone:              raw.phone?.trim() || null,
      mobile:             raw.mobile?.trim() || null,
      currency:           raw.currency?.trim() || 'AED',
      payment_terms_days: ptR.ok ? ptR.value : 0,
      credit_limit:       clR.ok ? clR.value : 0,
      address_street:     raw.address_street?.trim() || null,
      address_city:       raw.address_city?.trim() || null,
      address_country:    raw.address_country?.trim() || null,
      is_active:          parseBool(raw.is_active, true),
    };
    const existing = ctx.existing.get(naturalKey({ code: row.code, name: row.name }));
    if (existing) row.__existingId = existing.id;
    return { ok: true, row };
  },

  apply: async (rows, _ctx, policy): Promise<ApplyResult> => {
    const out: ApplyResult = { inserted: 0, updated: 0, skipped: 0, errors: [] };
    const api = getAdapter().contacts;
    for (let i = 0; i < rows.length; i++) {
      const { __existingId, ...insert } = rows[i];
      try {
        if (__existingId) {
          if (policy === 'skip')  { out.skipped++; continue; }
          if (policy === 'error') { out.errors.push({ rowIndex: i, message: `Contact ${insert.code ?? insert.name} already exists` }); continue; }
          const { company_id: _c, ...update } = insert;
          void _c;
          await api.update(__existingId, update);
          out.updated++;
        } else {
          await api.create(insert);
          out.inserted++;
        }
      } catch (e) {
        out.errors.push({ rowIndex: i, message: e instanceof Error ? e.message : 'Unknown error' });
      }
    }
    return out;
  },
};

// Module-specific natural key used by the wizard. Exported so the
// registry can wire it without duplicating logic here.
export function contactNaturalKey(r: { code?: string | null; name?: string | null }): string {
  return naturalKey(r);
}
