/**
 * Simple master-data adapters — Phase 14.11b.
 *
 * Tax rates, units of measure, brands, salespeople, warehouses, price
 * levels. Each table is small + flat enough that they share patterns
 * and live in one file for terseness. The Categories adapter is a bit
 * special (self-referencing parent by name) so it stays separate.
 *
 * The pattern across all of them:
 *   - Natural key = name (or code where the schema has one)
 *   - parseBool tolerant of yes/no/true/false/1/0
 *   - Defaults applied for optional fields so an empty cell doesn't
 *     produce a validation error
 */
import type { ModuleAdapter, ApplyResult, ValidationResult } from './types';
import type {
  TaxRateRow, TaxRateInsert,
  UnitRow, UnitInsert,
  BrandRow, BrandInsert,
  SalespersonRow, SalespersonInsert,
  WarehouseRow, WarehouseInsert,
  PriceLevelRow, PriceLevelInsert,
} from '@/data/adapter';
import { getAdapter } from '@/data/index';

// ── Shared helpers ─────────────────────────────────────────────────────────
function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v == null || v === '') return fallback;
  const s = v.toLowerCase().trim();
  if (['yes','y','true','1','active'].includes(s))  return true;
  if (['no','n','false','0','inactive'].includes(s)) return false;
  return fallback;
}
function parseNumber(v: string | undefined): { ok: true; value: number } | { ok: false } {
  if (v == null || v.trim() === '') return { ok: true, value: 0 };
  const n = parseFloat(v.replace(/[, %]/g, ''));
  return isFinite(n) ? { ok: true, value: n } : { ok: false };
}

// ── Tax rates ──────────────────────────────────────────────────────────────
const TAX_HEADERS = ['name', 'rate', 'tax_type', 'is_active'] as const;
export const taxRatesAdapter: ModuleAdapter<TaxRateRow, TaxRateInsert & { __existingId?: string }> = {
  key: 'taxRates', label: 'Tax rates', icon: '🧾',
  description: 'UAE 5% VAT, zero-rated, exempt, or any locale-specific rates.',
  headers: [...TAX_HEADERS],
  template: () => [
    { name: 'UAE VAT 5%', rate: '5', tax_type: 'standard', is_active: 'yes' },
    { name: 'Zero-rated', rate: '0', tax_type: 'zero_rated', is_active: 'yes' },
    { name: 'Exempt',     rate: '0', tax_type: 'exempt',     is_active: 'yes' },
  ],
  fetchAll: (cid) => getAdapter().taxRates.list(cid),
  serialize: (t) => ({
    name: t.name, rate: String(t.rate), tax_type: t.tax_type,
    is_active: t.is_active ? 'yes' : 'no',
  }),
  validate: (raw, ctx): ValidationResult<TaxRateInsert & { __existingId?: string }> => {
    const errors: string[] = [];
    const name = (raw.name ?? '').trim();
    if (!name) errors.push('name is required');
    const rateR = parseNumber(raw.rate);
    if (!rateR.ok) errors.push(`rate "${raw.rate}" is not a number`);
    const taxType = (raw.tax_type ?? 'standard').toLowerCase().trim();
    if (!['standard','zero_rated','exempt','reverse_charge'].includes(taxType)) {
      errors.push(`tax_type "${raw.tax_type}" must be one of standard / zero_rated / exempt / reverse_charge`);
    }
    if (errors.length) return { ok: false, errors };
    const row: TaxRateInsert & { __existingId?: string } = {
      company_id: ctx.company_id, name,
      rate:      rateR.ok ? rateR.value : 0,
      tax_type:  taxType,
      is_active: parseBool(raw.is_active, true),
    };
    const ex = ctx.existing.get(`name:${name.toLowerCase()}`);
    if (ex) row.__existingId = ex.id;
    return { ok: true, row };
  },
  apply: async (rows, _ctx, policy) => {
    const out: ApplyResult = { inserted: 0, updated: 0, skipped: 0, errors: [] };
    // TaxRatesAPI is read-only (Phase 12.45); we INSERT via the onboarding
    // API which is the same path used during company setup. Updates aren't
    // wired yet — surfacing a clear message keeps the import predictable.
    const onb = getAdapter().onboarding;
    for (let i = 0; i < rows.length; i++) {
      const { __existingId, ...insert } = rows[i];
      try {
        if (__existingId) {
          if (policy === 'skip')  { out.skipped++; continue; }
          if (policy === 'error') { out.errors.push({ rowIndex: i, message: `Tax rate "${insert.name}" already exists` }); continue; }
          out.skipped++;
          out.errors.push({ rowIndex: i, message: 'Updating tax_rates via import is not yet wired — rename in /settings/tax-rates instead.' });
        } else {
          await onb.insertTaxRate(insert);
          out.inserted++;
        }
      } catch (e) {
        out.errors.push({ rowIndex: i, message: e instanceof Error ? e.message : 'Unknown error' });
      }
    }
    return out;
  },
};

// ── Units of measure ───────────────────────────────────────────────────────
const UNIT_HEADERS = ['code', 'name', 'name_ar'] as const;
export const unitsAdapter: ModuleAdapter<UnitRow, UnitInsert & { __existingId?: string }> = {
  key: 'units', label: 'Units of measure', icon: '📏',
  description: 'PCS, KG, L, M, BOX — whatever you stock and sell by.',
  headers: [...UNIT_HEADERS],
  template: () => [
    { code: 'PCS', name: 'Pieces', name_ar: 'قطعة' },
    { code: 'L',   name: 'Litre',  name_ar: 'لتر' },
    { code: 'KG',  name: 'Kilogram', name_ar: 'كجم' },
  ],
  fetchAll: (cid) => getAdapter().units.list(cid),
  serialize: (u) => ({ code: u.code, name: u.name, name_ar: u.name_ar ?? '' }),
  validate: (raw, ctx): ValidationResult<UnitInsert & { __existingId?: string }> => {
    const errors: string[] = [];
    const code = (raw.code ?? '').trim().toUpperCase();
    const name = (raw.name ?? '').trim();
    if (!code) errors.push('code is required');
    if (!name) errors.push('name is required');
    if (errors.length) return { ok: false, errors };
    const row: UnitInsert & { __existingId?: string } = {
      company_id: ctx.company_id, code, name,
      name_ar:    raw.name_ar?.trim() || null,
    };
    const ex = ctx.existing.get(`code:${code}`);
    if (ex) row.__existingId = ex.id;
    return { ok: true, row };
  },
  apply: async (rows, _ctx, policy) => {
    const out: ApplyResult = { inserted: 0, updated: 0, skipped: 0, errors: [] };
    const api = getAdapter().units;
    for (let i = 0; i < rows.length; i++) {
      const { __existingId, ...insert } = rows[i];
      try {
        if (__existingId) {
          if (policy === 'skip')  { out.skipped++; continue; }
          if (policy === 'error') { out.errors.push({ rowIndex: i, message: `Unit ${insert.code} already exists` }); continue; }
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

// ── Brands ─────────────────────────────────────────────────────────────────
const BRAND_HEADERS = ['name', 'name_ar', 'is_active'] as const;
export const brandsAdapter: ModuleAdapter<BrandRow, BrandInsert & { __existingId?: string }> = {
  key: 'brands', label: 'Brands', icon: '🏷️',
  description: 'Castrol, Bosch, NGK, etc. Used to tag products.',
  headers: [...BRAND_HEADERS],
  template: () => [
    { name: 'Castrol', name_ar: 'كاسترول', is_active: 'yes' },
    { name: 'Bosch',   name_ar: 'بوش',     is_active: 'yes' },
  ],
  fetchAll: (cid) => getAdapter().brands.list(cid),
  serialize: (b) => ({ name: b.name, name_ar: b.name_ar ?? '', is_active: b.is_active ? 'yes' : 'no' }),
  validate: (raw, ctx): ValidationResult<BrandInsert & { __existingId?: string }> => {
    const name = (raw.name ?? '').trim();
    if (!name) return { ok: false, errors: ['name is required'] };
    const row: BrandInsert & { __existingId?: string } = {
      company_id: ctx.company_id, name,
      name_ar:    raw.name_ar?.trim() || null,
      is_active:  parseBool(raw.is_active, true),
    };
    const ex = ctx.existing.get(`name:${name.toLowerCase()}`);
    if (ex) row.__existingId = ex.id;
    return { ok: true, row };
  },
  apply: async (rows, _ctx, policy) => {
    const out: ApplyResult = { inserted: 0, updated: 0, skipped: 0, errors: [] };
    const api = getAdapter().brands;
    for (let i = 0; i < rows.length; i++) {
      const { __existingId, ...insert } = rows[i];
      try {
        if (__existingId) {
          if (policy === 'skip')  { out.skipped++; continue; }
          if (policy === 'error') { out.errors.push({ rowIndex: i, message: `Brand "${insert.name}" already exists` }); continue; }
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

// ── Salespeople ────────────────────────────────────────────────────────────
const SALES_HEADERS = ['name', 'name_ar', 'email', 'phone', 'commission_pct', 'is_active', 'notes'] as const;
export const salespeopleAdapter: ModuleAdapter<SalespersonRow, SalespersonInsert & { __existingId?: string }> = {
  key: 'salespeople', label: 'Salespeople', icon: '👤',
  description: 'Sales staff for commission tracking. Tagged on invoices + quotes.',
  headers: [...SALES_HEADERS],
  template: () => [
    { name: 'Ahmed K.', name_ar: 'أحمد', email: 'ahmed@example.ae',
      phone: '+971 50 111 2222', commission_pct: '2.5', is_active: 'yes', notes: '' },
  ],
  fetchAll: (cid) => getAdapter().salespeople.list(cid, { include_inactive: true }),
  serialize: (s) => ({
    name: s.name, name_ar: s.name_ar ?? '',
    email: s.email ?? '', phone: s.phone ?? '',
    commission_pct: String(s.commission_pct ?? 0),
    is_active: s.is_active ? 'yes' : 'no',
    notes: s.notes ?? '',
  }),
  validate: (raw, ctx): ValidationResult<SalespersonInsert & { __existingId?: string }> => {
    const name = (raw.name ?? '').trim();
    if (!name) return { ok: false, errors: ['name is required'] };
    const commR = parseNumber(raw.commission_pct);
    if (!commR.ok) return { ok: false, errors: [`commission_pct "${raw.commission_pct}" is not a number`] };
    const row: SalespersonInsert & { __existingId?: string } = {
      company_id: ctx.company_id, name,
      name_ar:        raw.name_ar?.trim() || null,
      email:          raw.email?.trim() || null,
      phone:          raw.phone?.trim() || null,
      commission_pct: commR.value,
      is_active:      parseBool(raw.is_active, true),
      notes:          raw.notes?.trim() || null,
    };
    const ex = ctx.existing.get(`name:${name.toLowerCase()}`);
    if (ex) row.__existingId = ex.id;
    return { ok: true, row };
  },
  apply: async (rows, _ctx, policy) => {
    const out: ApplyResult = { inserted: 0, updated: 0, skipped: 0, errors: [] };
    const api = getAdapter().salespeople;
    for (let i = 0; i < rows.length; i++) {
      const { __existingId, ...insert } = rows[i];
      try {
        if (__existingId) {
          if (policy === 'skip')  { out.skipped++; continue; }
          if (policy === 'error') { out.errors.push({ rowIndex: i, message: `Salesperson "${insert.name}" already exists` }); continue; }
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

// ── Warehouses ─────────────────────────────────────────────────────────────
const WAREHOUSE_HEADERS = [
  'code', 'name', 'name_ar', 'city', 'address', 'phone', 'is_default', 'is_active',
] as const;
export const warehousesAdapter: ModuleAdapter<WarehouseRow, WarehouseInsert & { __existingId?: string }> = {
  key: 'warehouses', label: 'Warehouses', icon: '🏭',
  description: 'Physical locations stock is held at. Each invoice / GRN picks one.',
  headers: [...WAREHOUSE_HEADERS],
  template: () => [
    { code: 'WH-MAIN', name: 'Main Warehouse', name_ar: 'المخزن الرئيسي',
      city: 'Sharjah', address: 'Industrial Area 4', phone: '+971 6 555 1111',
      is_default: 'yes', is_active: 'yes' },
  ],
  fetchAll: (cid) => getAdapter().warehouses.list(cid),
  serialize: (w) => ({
    code: w.code, name: w.name, name_ar: w.name_ar ?? '',
    city: w.city ?? '', address: w.address ?? '', phone: w.phone ?? '',
    is_default: w.is_default ? 'yes' : 'no',
    is_active:  w.is_active  ? 'yes' : 'no',
  }),
  validate: (raw, ctx): ValidationResult<WarehouseInsert & { __existingId?: string }> => {
    const errors: string[] = [];
    const code = (raw.code ?? '').trim();
    const name = (raw.name ?? '').trim();
    if (!code) errors.push('code is required');
    if (!name) errors.push('name is required');
    if (errors.length) return { ok: false, errors };
    const row: WarehouseInsert & { __existingId?: string } = {
      company_id: ctx.company_id, code, name,
      name_ar:    raw.name_ar?.trim() || null,
      city:       raw.city?.trim() || null,
      address:    raw.address?.trim() || null,
      phone:      raw.phone?.trim() || null,
      is_default: parseBool(raw.is_default, false),
      is_active:  parseBool(raw.is_active, true),
    };
    const ex = ctx.existing.get(`code:${code.toLowerCase()}`);
    if (ex) row.__existingId = ex.id;
    return { ok: true, row };
  },
  apply: async (rows, _ctx, policy) => {
    const out: ApplyResult = { inserted: 0, updated: 0, skipped: 0, errors: [] };
    const api = getAdapter().warehouses;
    for (let i = 0; i < rows.length; i++) {
      const { __existingId, ...insert } = rows[i];
      try {
        if (__existingId) {
          if (policy === 'skip')  { out.skipped++; continue; }
          if (policy === 'error') { out.errors.push({ rowIndex: i, message: `Warehouse ${insert.code} already exists` }); continue; }
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

// ── Price levels ───────────────────────────────────────────────────────────
const PRICE_HEADERS = ['name', 'name_ar', 'markup_percent', 'sort_order', 'is_default', 'is_active'] as const;
export const priceLevelsAdapter: ModuleAdapter<PriceLevelRow, PriceLevelInsert & { __existingId?: string }> = {
  key: 'priceLevels', label: 'Price levels', icon: '🪜',
  description: 'Tier pricing — Retail, Wholesale, Fleet, Member, etc.',
  headers: [...PRICE_HEADERS],
  template: () => [
    { name: 'Retail',    name_ar: 'تجزئة',  markup_percent: '0',  sort_order: '1', is_default: 'yes', is_active: 'yes' },
    { name: 'Wholesale', name_ar: 'جملة',   markup_percent: '-10', sort_order: '2', is_default: 'no',  is_active: 'yes' },
  ],
  fetchAll: (cid) => getAdapter().priceLevels.list(cid),
  serialize: (p) => ({
    name: p.name, name_ar: p.name_ar ?? '',
    markup_percent: p.markup_percent == null ? '' : String(p.markup_percent),
    sort_order: String(p.sort_order ?? 0),
    is_default: p.is_default ? 'yes' : 'no',
    is_active:  p.is_active  ? 'yes' : 'no',
  }),
  validate: (raw, ctx): ValidationResult<PriceLevelInsert & { __existingId?: string }> => {
    const errors: string[] = [];
    const name = (raw.name ?? '').trim();
    if (!name) errors.push('name is required');
    const mkR = parseNumber(raw.markup_percent);
    if (!mkR.ok) errors.push(`markup_percent "${raw.markup_percent}" is not a number`);
    const soR = parseNumber(raw.sort_order);
    if (!soR.ok) errors.push(`sort_order "${raw.sort_order}" is not a number`);
    if (errors.length) return { ok: false, errors };
    const row: PriceLevelInsert & { __existingId?: string } = {
      company_id: ctx.company_id, name,
      name_ar:        raw.name_ar?.trim() || null,
      markup_percent: raw.markup_percent?.trim() ? (mkR.ok ? mkR.value : 0) : null,
      sort_order:     soR.ok ? soR.value : 0,
      is_default:     parseBool(raw.is_default, false),
      is_active:      parseBool(raw.is_active, true),
    };
    const ex = ctx.existing.get(`name:${name.toLowerCase()}`);
    if (ex) row.__existingId = ex.id;
    return { ok: true, row };
  },
  apply: async (rows, _ctx, policy) => {
    const out: ApplyResult = { inserted: 0, updated: 0, skipped: 0, errors: [] };
    const api = getAdapter().priceLevels;
    for (let i = 0; i < rows.length; i++) {
      const { __existingId, ...insert } = rows[i];
      try {
        if (__existingId) {
          if (policy === 'skip')  { out.skipped++; continue; }
          if (policy === 'error') { out.errors.push({ rowIndex: i, message: `Price level "${insert.name}" already exists` }); continue; }
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
