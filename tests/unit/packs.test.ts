/** Packs: the screen's rules must be the database's (phase155). */
import { describe, expect, it } from 'vitest';
import {
  baseQuantity, checkPacks, linePackFrom, linePackOf, NO_PACK, packColumn, packInput, packPrice, packProblem, unitAllowsDecimals,
  type PackLineInput, type ProductUnitRow,
} from '@/lib/packs';
import { ALL_ON, inventorySettingsFrom } from '@/lib/inventory-settings';

const box: ProductUnitRow = { id: 'u1', company_id: 'c', product_id: 'p', name: 'BOX', name_ar: null, unit_id: null, factor: 12,
  selling_price: 100, purchase_price: null, barcode: null, for_sales: true, for_purchases: true, is_active: true, sort_order: 0 };
const line = (x: Partial<PackLineInput> = {}): PackLineInput => ({ product_id: 'p', label: 'SKU', quantity: 2, factor: 12, pack_name: 'BOX',
  base_unit: 'PCS', allows_decimals: false, net_price: 100, base_price: 9, base_cost: 5, on_hand: 100, ...x });

describe('pack quantities', () => {
  it.each([[2, 12, 24], [3, 0.2, 0.6], [0.1, 3, 0.3], [0.7, 0.1, 0.07], [1.005, 1000, 1005], [1, 0.333333, 0.333333]])('%f × %f = %f exactly', (q, f, b) => {
    expect(baseQuantity(q, f)).toBe(b);
  });
  it('refuses what the database refuses', () => {
    expect(packProblem(1, 0.333333, true)).toBe('too_small');
    expect(packProblem(3, 0.2, true)).toBeNull();
    expect(packProblem(0.3, 12, false)).toBe('whole_units');
    expect(packProblem(0.5, 12, false)).toBeNull();
    expect(packProblem(0.5, 1, false)).toBe('whole_units');
    expect(packProblem(0.5, 1, true)).toBeNull();
  });
  it('PCS is whole, KG is not, no unit is PCS, and the setting wins', () => {
    expect(unitAllowsDecimals({ code: 'pcs' })).toBe(false);
    expect(unitAllowsDecimals({ code: 'KG' })).toBe(true);
    expect(unitAllowsDecimals(null)).toBe(false);
    expect(unitAllowsDecimals({ code: 'PCS', allows_decimals: true })).toBe(true);
    expect(unitAllowsDecimals({ code: 'KG', allows_decimals: false })).toBe(false);
  });
  it('the whole-unit list is the database’s', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync('supabase/migrations/20261124000003_phase155_packs.sql', 'utf8');
    const list = /NOT IN \(([\s\S]*?)\)\)/.exec(sql)![1].match(/'([A-Z]+)'/g)!.map((x) => x.slice(1, -1));
    expect(list.length).toBeGreaterThan(20);
    for (const code of list) expect(unitAllowsDecimals({ code }), code).toBe(false);
  });
});

describe('the warning before saving', () => {
  it('lists every pack line and says nothing about plain lines', () => {
    const c = checkPacks([line(), line({ pack_name: null, factor: 1, quantity: 5 })]);
    expect(c.lines).toEqual([{ text_qty: '2', pack_name: 'BOX', text_base: '24', label: 'SKU', base_unit: 'PCS' }]);
    expect(c.warnings).toEqual([]);
    expect(checkPacks([line({ pack_name: null, factor: 1 })])).toEqual({ lines: [], warnings: [], problems: [] });
  });
  it('a box at the price of one piece, below cost, and not enough stock', () => {
    expect(checkPacks([line({ net_price: 9 })]).warnings.map((w) => w.kind)).toEqual(['price_is_base']);
    expect(checkPacks([line({ net_price: 50 })]).warnings).toEqual([{ kind: 'below_cost', label: 'SKU', pack_name: 'BOX', price: 50, cost: 60 }]);
    expect(checkPacks([line({ on_hand: 30 }), line({ pack_name: null, factor: 1, quantity: 7 })]).warnings)
      .toEqual([{ kind: 'negative', label: 'SKU', have: '30', need: '31', base_unit: 'PCS' }]);
    expect(checkPacks([line({ on_hand: null, quantity: 99 })]).warnings).toEqual([]);
    expect(checkPacks([line({ net_price: null, base_cost: 999 })]).warnings).toEqual([]);
  });
  it('blocks what cannot be saved, plain lines included', () => {
    expect(checkPacks([line({ quantity: 0.3 })]).problems).toEqual([{ kind: 'whole_units', label: 'SKU', text: '0.3 × BOX', base_unit: 'PCS' }]);
    expect(checkPacks([line({ pack_name: null, factor: 1, quantity: 1.5 })]).problems[0].kind).toBe('whole_units');
  });
});

describe('a line without a pack sends what it always did', () => {
  it('no extra column', () => {
    expect(packColumn(NO_PACK)).toEqual({});
    expect(packColumn(linePackOf({}))).toEqual({});
    expect(packColumn(linePackFrom(box))).toEqual({ product_unit_id: 'u1' });
  });
  it('a saved pack keeps its own value even if it is no longer offered', () => {
    expect(linePackOf({ product_unit_id: 'x', unit_factor: 10, unit_label: 'OLD' })).toEqual({ product_unit_id: 'x', unit_factor: 10, unit_label: 'OLD' });
  });
  it('price of a pack: its own, else pieces × value', () => {
    expect(packPrice(box, 9)).toBe(100);
    expect(packPrice({ ...box, selling_price: null }, 9.99)).toBe(119.88);
  });
  it('services are never checked', () => {
    const facts = { unitCode: () => 'PCS', allowsDecimals: () => false };
    expect(packInput({ ...NO_PACK, quantity: 1.5, net_price: 1 }, { id: 'p', sku: 'S', name: 'n', type: 'service', unit_id: null }, facts, null, 0)).toBeNull();
    expect(packInput({ ...NO_PACK, quantity: 1, net_price: 1 }, undefined, facts, null, 0)).toBeNull();
  });
  it('packs are off unless a company turned them on', () => {
    expect(ALL_ON.packs_enabled).toBe(false);
    for (const row of [null, {}, { packs_enabled: null }, { packs_enabled: 'yes' }]) expect(inventorySettingsFrom(row as never).packs_enabled).toBe(false);
    expect(inventorySettingsFrom({ packs_enabled: true }).packs_enabled).toBe(true);
  });
});
