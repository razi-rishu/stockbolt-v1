/** Packs in reports, counting, e-invoices and import (phase155, Part 6). */
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/data/index', () => ({ getAdapter: () => ({}) }));
import { checkPacks, packBreakdown, type PackLineInput, type ProductUnitRow } from '@/lib/packs';
import { foldCreditNotesByReason, foldDebitNotesByReason } from '@/lib/returns-analysis';
import { packUnitCode } from '@/lib/einvoice/unit-codes';
import { packsAdapter, packKey } from '@/modules/settings/import-export/_adapters/packs';

const unit = (name: string, factor: number): ProductUnitRow => ({ id: name, company_id: 'c', product_id: 'p', name, name_ar: null, unit_id: null, factor,
  selling_price: null, purchase_price: null, barcode: null, for_sales: true, for_purchases: true, is_active: true, sort_order: 0 });

describe('stock shown in packs', () => {
  const packs = [unit('BOX', 12), unit('CARTON', 144), unit('200 g', 0.2)];
  it('uses the biggest pack that fits', () => {
    expect(packBreakdown(91, [unit('BOX', 12)], 'PCS')).toBe('7 BOX + 7 PCS');
    expect(packBreakdown(84, [unit('BOX', 12)], 'PCS')).toBe('7 BOX');
    expect(packBreakdown(150, packs, 'PCS')).toBe('1 CARTON + 6 PCS');
    expect(packBreakdown(5, [unit('BOX', 12)], 'PCS')).toBeNull();
    expect(packBreakdown(-12, [unit('BOX', 12)], 'PCS')).toBeNull();
    expect(packBreakdown(50, [unit('200 g', 0.2)], 'KG')).toBeNull();
    expect(packBreakdown(10.5, [unit('BAG', 5)], 'KG')).toBe('2 BAG + 0.5 KG');
  });
  it('a count of 7 BOX + 7 PCS is accepted as 91', () => {
    const line: PackLineInput = { product_id: 'p', label: 'S', quantity: 7, factor: 12, pack_name: 'BOX', base_unit: 'PCS', allows_decimals: false,
      net_price: null, base_price: 0, base_cost: 0, on_hand: null, loose: 7 };
    expect(checkPacks([line]).lines).toEqual([{ text_qty: '7', pack_name: 'BOX + 7 PCS', text_base: '91', label: 'S', base_unit: 'PCS' }]);
    expect(checkPacks([{ ...line, loose: 0.5 }]).problems[0].kind).toBe('whole_units');
  });
});

describe('returns analysis counts pieces', () => {
  it('1 BOX of 12 at a piece cost of 8 is 12 pieces and 96.00', () => {
    const [r] = foldCreditNotesByReason([{ reason: 'return', restocking_fee: null, total_amount: 100,
      credit_note_items: [{ quantity: 1, base_quantity: 12, condition: null, cost_at_sale: 8 }, { quantity: 2, condition: null, cost_at_sale: 5 }] }]);
    expect(r.qty).toBe(14);
    expect(r.restocked_value).toBe(106);
  });
  it('a debit note keeps its own cost per box', () => {
    const [r] = foldDebitNotesByReason([{ reason: 'return', total_amount: 100, debit_note_items: [{ quantity: 1, base_quantity: 12, unit_cost: 96 }] }]);
    expect([r.qty, r.cost]).toEqual([12, 96]);
  });
});

describe('e-invoice unit codes', () => {
  it.each([['BOX', 'BOX', 'XBX'], ['Carton', 'CTN', 'XCT'], ['Dozen', 'DOZ', 'DZN'], ['200 g', 'OTH', 'XPK'], ['Boxer', 'OTH', 'XPK'], ['PACK of 6', 'PAC', 'XPK']])(
    '%s', (label, india, uae) => { expect(packUnitCode(label, true)).toBe(india); expect(packUnitCode(label, false)).toBe(uae); });
});

describe('importing selling units', () => {
  const ctx = { company_id: 'c', company_currency: 'AED', existing: new Map([[packKey('p1', 'box'), { id: 'u9' }]]),
    lookups: { productsBySku: new Map([['A-1', { id: 'p1', sku: 'A-1' }], ['SRV', { id: 'p2', sku: 'SRV', type: 'service' }]]) } };
  const v = (raw: Record<string, string>) => packsAdapter.validate(raw as never, ctx as never);
  it('finds the product and an existing unit', () => {
    const r = v({ sku: 'a-1', unit_name: 'BOX', value: '12', selling_price: '1,200.50' });
    expect(r.ok && r.row).toMatchObject({ product_id: 'p1', factor: 12, selling_price: 1200.5, purchase_price: null, __existingId: 'u9', is_active: true });
  });
  it('a unit without a value, an unknown product or a service is refused', () => {
    for (const raw of [{ sku: 'A-1', unit_name: 'BOX' }, { sku: 'A-1', unit_name: 'BOX', value: '0' }, { sku: 'A-1', unit_name: 'BOX', value: 'twelve' },
      { sku: 'ZZ', unit_name: 'BOX', value: '12' }, { sku: 'SRV', unit_name: 'BOX', value: '12' }, { sku: 'A-1', unit_name: '', value: '12' }, { sku: 'A-1', unit_name: 'BOX', value: '12', selling_price: 'abc' }]) {
      expect(v(raw as never).ok, JSON.stringify(raw)).toBe(false);
    }
  });
});
