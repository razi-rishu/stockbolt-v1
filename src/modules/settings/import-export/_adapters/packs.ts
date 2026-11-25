/**
 * Selling units (phase155) for the import/export wizard: BOX = 12 of a SKU.
 * Offered only while the company has packs on. The value of a unit that
 * documents already use cannot change; the database says so per row.
 */
import type { ModuleAdapter, ApplyResult, ValidationResult } from './types';
import type { ProductRow, ProductUnitInput } from '@/data/adapter';
import type { ProductUnitRow } from '@/lib/packs';
import { getAdapter } from '@/data/index';

interface PackLookups { productsBySku: Map<string, ProductRow> }
type PackImport = ProductUnitInput & { product_id: string; __sku: string; __existingId?: string };

const HEADERS = ['sku', 'unit_name', 'unit_name_ar', 'value', 'selling_price', 'purchase_price', 'barcode', 'for_sales', 'for_purchases', 'is_active'];

const bool = (v: string | undefined, fallback: boolean) => {
  const s = (v ?? '').toLowerCase().trim();
  if (['yes', 'y', 'true', '1', 'active'].includes(s)) return true;
  if (['no', 'n', 'false', '0', 'inactive'].includes(s)) return false;
  return fallback;
};
/** Empty = not given; a wrong number is an error, never 0. */
const num = (v: string | undefined): number | null | undefined => {
  const s = (v ?? '').replace(/,/g, '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

export const packKey = (product_id: string, name: string) => `${product_id}|${name.trim().toLowerCase()}`;

export const packsAdapter: ModuleAdapter<ProductUnitRow, PackImport> = {
  key: 'packs', label: 'Selling units', icon: '📦',
  description: 'BOX = 12 of a product, 200 g = 0.2 KG. Required: SKU, unit name and value.',
  headers: HEADERS,
  template: () => [
    { sku: 'FLT-AIR-001', unit_name: 'BOX', unit_name_ar: 'صندوق', value: '12', selling_price: '400.00', purchase_price: '250.00', barcode: '', for_sales: 'yes', for_purchases: 'yes', is_active: 'yes' },
    { sku: 'SUGAR-KG', unit_name: '200 g', unit_name_ar: '', value: '0.2', selling_price: '5.50', purchase_price: '', barcode: '', for_sales: 'yes', for_purchases: 'no', is_active: 'yes' },
  ],
  fetchAll: (cid) => getAdapter().productUnits.list(cid),
  // The SKU is resolved by serializePacksForExport.
  serialize: (u) => ({
    sku: u.product_id, unit_name: u.name, unit_name_ar: u.name_ar ?? '', value: String(u.factor),
    selling_price: u.selling_price == null ? '' : String(u.selling_price),
    purchase_price: u.purchase_price == null ? '' : String(u.purchase_price),
    barcode: u.barcode ?? '', for_sales: u.for_sales ? 'yes' : 'no', for_purchases: u.for_purchases ? 'yes' : 'no', is_active: u.is_active ? 'yes' : 'no',
  }),
  validate: (raw, ctx): ValidationResult<PackImport> => {
    const errors: string[] = [];
    const sku = (raw.sku ?? '').trim();
    const name = (raw.unit_name ?? '').trim();
    const product = (ctx.lookups as unknown as PackLookups).productsBySku.get(sku.toUpperCase());
    if (!sku) errors.push('sku is required');
    else if (!product) errors.push(`sku "${sku}" not found`);
    else if ((product as { type?: string }).type === 'service') errors.push(`sku "${sku}" is a service`);
    if (!name) errors.push('unit_name is required');
    else if (name.length > 40) errors.push('unit_name is longer than 40 characters');
    const factor = num(raw.value);
    if (factor == null || factor <= 0) errors.push(`value "${raw.value ?? ''}" must be a number above 0`);
    const sell = num(raw.selling_price);
    const buy = num(raw.purchase_price);
    if (sell === undefined || (sell ?? 0) < 0) errors.push(`selling_price "${raw.selling_price}" is not a valid price`);
    if (buy === undefined || (buy ?? 0) < 0) errors.push(`purchase_price "${raw.purchase_price}" is not a valid price`);
    if (errors.length) return { ok: false, errors };
    const row: PackImport = {
      product_id: product!.id, __sku: sku, name, name_ar: raw.unit_name_ar?.trim() || null, factor: factor!,
      selling_price: sell ?? null, purchase_price: buy ?? null, barcode: raw.barcode?.trim() || null,
      for_sales: bool(raw.for_sales, true), for_purchases: bool(raw.for_purchases, true), is_active: bool(raw.is_active, true), sort_order: 0,
    };
    const ex = ctx.existing.get(packKey(row.product_id, name));
    if (ex) row.__existingId = ex.id;
    return { ok: true, row };
  },
  apply: async (rows, ctx, policy) => {
    const out: ApplyResult = { inserted: 0, updated: 0, skipped: 0, errors: [] };
    for (let i = 0; i < rows.length; i++) {
      const { __existingId, __sku, product_id, ...input } = rows[i];
      try {
        if (!__existingId) {
          await getAdapter().productUnits.create({ ...input, company_id: ctx.company_id, product_id });
          out.inserted++;
        } else if (policy === 'skip') out.skipped++;
        else if (policy === 'error') out.errors.push({ rowIndex: i, message: `${__sku}: unit "${input.name}" already exists` });
        else {
          const { sort_order: _s, ...update } = input;
          void _s;
          await getAdapter().productUnits.update(__existingId, update);
          out.updated++;
        }
      } catch (e) {
        out.errors.push({ rowIndex: i, message: e instanceof Error ? e.message : 'Unknown error' });
      }
    }
    return out;
  },
};

export async function buildPackLookups(company_id: string): Promise<PackLookups> {
  const products = await getAdapter().products.list(company_id);
  return { productsBySku: new Map(products.map((p) => [p.sku.toUpperCase(), p])) };
}

export async function serializePacksForExport(rows: ProductUnitRow[], company_id: string): Promise<Record<string, string>[]> {
  const products = await getAdapter().products.list(company_id);
  const sku = new Map(products.map((p) => [p.id, p.sku]));
  return rows.map((u) => ({ ...packsAdapter.serialize(u), sku: sku.get(u.product_id) ?? '' }));
}
