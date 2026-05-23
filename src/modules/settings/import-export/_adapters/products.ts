/**
 * Products module adapter for the import/export wizard — Phase 14.11a.
 *
 * The reference implementation of the ModuleAdapter contract. All other
 * masters (contacts, COA, tax rates, units, brands, categories, etc.)
 * follow the same shape, so this file is the template.
 *
 * Column choices:
 *   - sku + name are required; everything else is optional.
 *   - brand / category / unit are entered by NAME / CODE so the CSV is
 *     human-readable. validate() resolves them to IDs against the
 *     pre-loaded lookups in ImportContext.
 *   - is_active accepts "yes"/"no"/"true"/"false"/"1"/"0" — anything
 *     reasonable an accountant might type.
 *   - selling_price is parsed as a positive number (decimals OK);
 *     thousand-separators and currency symbols are stripped.
 *   - tax_category defaults to "standard" if blank.
 *
 * Duplicate policy is keyed on `sku` because that's the natural key
 * accountants use to identify a product. The wizard exposes a global
 * Skip / Update / Error choice.
 */

import type { ModuleAdapter, ApplyResult, ValidationResult } from './types';
import type { ProductRow, ProductInsert, ProductUpdate, BrandRow, CategoryRow, UnitRow } from '@/data/adapter';
import { getAdapter } from '@/data/index';

interface ProductLookups {
  brandsByName:    Map<string, BrandRow>;
  categoriesByName: Map<string, CategoryRow>;
  unitsByCode:     Map<string, UnitRow>;
}

const HEADERS = [
  'sku',
  'name',
  'name_ar',
  'description',
  'barcode',
  'oe_number',
  'brand',
  'category',
  'unit',
  'type',
  'selling_price',
  'tax_category',
  'min_stock_level',
  'is_active',
] as const;

// ── Small parsers ──────────────────────────────────────────────────────────
function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v == null || v === '') return fallback;
  const s = v.toLowerCase().trim();
  if (['yes','y','true','1','active'].includes(s)) return true;
  if (['no','n','false','0','inactive'].includes(s)) return false;
  return fallback;
}

function parseNumber(v: string | undefined): { ok: true; value: number } | { ok: false } {
  if (v == null || v.trim() === '') return { ok: true, value: 0 };
  // Strip thousand separators + currency symbols. Keep decimal point/comma.
  const cleaned = v.replace(/[, A-Za-z]/g, (m) => m === ',' ? '' : (m === ' ' ? '' : ''));
  // After stripping, swap any leftover comma decimal to dot
  const normalised = cleaned.replace(/,/g, '.');
  const n = parseFloat(normalised);
  if (!isFinite(n)) return { ok: false };
  return { ok: true, value: n };
}

function parseType(v: string | undefined): 'goods' | 'service' {
  const s = (v ?? '').toLowerCase().trim();
  return s === 'service' ? 'service' : 'goods';
}

// ── Adapter ────────────────────────────────────────────────────────────────
export const productsAdapter: ModuleAdapter<ProductRow, ProductInsert & { __existingId?: string }> = {
  key:   'products',
  label: 'Products',
  description: 'SKU catalog. Required: SKU + name. Brand / category / unit resolved by name.',
  icon:  '📦',
  headers: [...HEADERS],

  template: () => [
    {
      sku: 'OIL-5W30-1L',
      name: 'Engine Oil 5W-30 1L',
      name_ar: 'زيت محرك 5W-30 1L',
      description: 'Synthetic engine oil, API SN',
      barcode: '8901234567890',
      oe_number: '',
      brand: 'Castrol',
      category: 'Lubricants',
      unit: 'L',
      type: 'goods',
      selling_price: '45.00',
      tax_category: 'standard',
      min_stock_level: '10',
      is_active: 'yes',
    },
    {
      sku: 'FLT-AIR-001',
      name: 'Air Filter — Generic',
      name_ar: 'فلتر هواء',
      description: 'Universal air filter',
      barcode: '',
      oe_number: 'OE-12345',
      brand: 'Bosch',
      category: 'Filters',
      unit: 'PCS',
      type: 'goods',
      selling_price: '35.00',
      tax_category: 'standard',
      min_stock_level: '5',
      is_active: 'yes',
    },
  ],

  fetchAll: (company_id) => getAdapter().products.list(company_id),

  serialize: (p: ProductRow) => {
    // Brand/category/unit serialize as their IDs in the export — the
    // wizard pre-populates HUMAN-READABLE names from the lookups when
    // building the export rows. We do that here in the adapter rather
    // than rebuilding the lookup in the wizard.
    return {
      sku:             p.sku,
      name:            p.name,
      name_ar:         p.name_ar ?? '',
      description:     p.description ?? '',
      barcode:         p.barcode ?? '',
      oe_number:       p.oe_number ?? '',
      brand:           p.brand_id ?? '',           // resolved by export caller
      category:        p.category_id ?? '',
      unit:            p.unit_id ?? '',
      type:            p.type,
      selling_price:   String(p.selling_price ?? 0),
      tax_category:    p.tax_category ?? 'standard',
      min_stock_level: String(p.min_stock_level ?? 0),
      is_active:       p.is_active ? 'yes' : 'no',
    };
  },

  validate: (raw, ctx): ValidationResult<ProductInsert & { __existingId?: string }> => {
    const errors: string[] = [];
    const lk = ctx.lookups as unknown as ProductLookups;

    const sku  = (raw.sku ?? '').trim();
    const name = (raw.name ?? '').trim();
    if (!sku) errors.push('sku is required');
    if (!name) errors.push('name is required');

    // Optional lookups — if the value is provided but doesn't match a
    // known row, that's an error (we don't auto-create here).
    let brand_id: string | null = null;
    if (raw.brand?.trim()) {
      const b = lk.brandsByName.get(raw.brand.trim().toLowerCase());
      if (!b) errors.push(`brand "${raw.brand}" not found — add it under Catalog → Brands first`);
      else brand_id = b.id;
    }
    let category_id: string | null = null;
    if (raw.category?.trim()) {
      const c = lk.categoriesByName.get(raw.category.trim().toLowerCase());
      if (!c) errors.push(`category "${raw.category}" not found — add it under Catalog → Categories first`);
      else category_id = c.id;
    }
    let unit_id: string | null = null;
    if (raw.unit?.trim()) {
      const u = lk.unitsByCode.get(raw.unit.trim().toUpperCase());
      if (!u) errors.push(`unit "${raw.unit}" not found — add it under Settings → Units of Measure first`);
      else unit_id = u.id;
    }

    const priceR = parseNumber(raw.selling_price);
    if (!priceR.ok) errors.push(`selling_price "${raw.selling_price}" is not a number`);
    else if (priceR.value < 0) errors.push('selling_price cannot be negative');

    const minR = parseNumber(raw.min_stock_level);
    if (!minR.ok) errors.push(`min_stock_level "${raw.min_stock_level}" is not a number`);

    if (errors.length > 0) return { ok: false, errors };

    const row: ProductInsert & { __existingId?: string } = {
      company_id:      ctx.company_id,
      sku,
      name,
      name_ar:         raw.name_ar?.trim() || null,
      description:     raw.description?.trim() || null,
      barcode:         raw.barcode?.trim() || null,
      oe_number:       raw.oe_number?.trim() || null,
      brand_id,
      category_id,
      unit_id,
      type:            parseType(raw.type),
      selling_price:   priceR.ok ? priceR.value : 0,
      tax_category:    raw.tax_category?.trim() || 'standard',
      min_stock_level: minR.ok ? minR.value : 0,
      is_active:       parseBool(raw.is_active, true),
    };

    // If the SKU already exists, stash the existing id for the apply
    // step to consider (skip / update branch).
    const existing = ctx.existing.get(sku.toUpperCase());
    if (existing) row.__existingId = existing.id;

    return { ok: true, row };
  },

  apply: async (rows, _ctx, policy): Promise<ApplyResult> => {
    const out: ApplyResult = { inserted: 0, updated: 0, skipped: 0, errors: [] };
    const adapter = getAdapter().products;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const { __existingId, ...insert } = r;
      try {
        if (__existingId) {
          if (policy === 'skip') { out.skipped++; continue; }
          if (policy === 'error') {
            out.errors.push({ rowIndex: i, message: `SKU ${insert.sku} already exists (duplicate policy = "error")` });
            continue;
          }
          // update path — pass the same shape minus the things you
          // shouldn't change on a re-import (company_id stays implicit).
          const { company_id: _c, ...update } = insert;
          void _c;
          await adapter.update(__existingId, update as ProductUpdate);
          out.updated++;
        } else {
          await adapter.create(insert);
          out.inserted++;
        }
      } catch (e) {
        out.errors.push({
          rowIndex: i,
          message: e instanceof Error ? e.message : 'Unknown error',
        });
      }
    }
    return out;
  },
};

// Loader used by the wizard before validate() runs — pre-builds the
// lookup maps so each row's validate() is O(1) instead of scanning.
export async function buildProductLookups(company_id: string): Promise<ProductLookups> {
  const adapter = getAdapter();
  const [brands, categories, units] = await Promise.all([
    adapter.brands.list(company_id),
    adapter.categories.list(company_id),
    adapter.units.list(company_id),
  ]);
  const brandsByName = new Map<string, BrandRow>();
  for (const b of brands) brandsByName.set(b.name.toLowerCase(), b);
  const categoriesByName = new Map<string, CategoryRow>();
  for (const c of categories) categoriesByName.set(c.name.toLowerCase(), c);
  const unitsByCode = new Map<string, UnitRow>();
  for (const u of units) unitsByCode.set(u.code.toUpperCase(), u);
  return { brandsByName, categoriesByName, unitsByCode };
}

/** Export rows pre-resolved with brand/category/unit NAMES (not IDs).
 *  Called by the export path because the wizard doesn't know the
 *  module-specific lookup keys. */
export async function serializeProductsForExport(
  rows: ProductRow[],
  company_id: string,
): Promise<Record<string, string>[]> {
  const adapter = getAdapter();
  const [brands, categories, units] = await Promise.all([
    adapter.brands.list(company_id),
    adapter.categories.list(company_id),
    adapter.units.list(company_id),
  ]);
  const brandsById     = new Map(brands.map(b => [b.id, b.name]));
  const categoriesById = new Map(categories.map(c => [c.id, c.name]));
  const unitsById      = new Map(units.map(u => [u.id, u.code]));
  return rows.map(p => ({
    ...productsAdapter.serialize(p),
    brand:    p.brand_id    ? brandsById.get(p.brand_id)    ?? '' : '',
    category: p.category_id ? categoriesById.get(p.category_id) ?? '' : '',
    unit:     p.unit_id     ? unitsById.get(p.unit_id)     ?? '' : '',
  }));
}
