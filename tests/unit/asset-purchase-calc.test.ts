import { describe, it, expect } from 'vitest';
import {
  newAssetLine, lineAssetCost, purchaseTotals, billItemsFromLines, expenseItemsFromLines,
  specsFromLines, validateLines, docTypeFor,
} from '@/modules/accounting/asset-purchase/asset-purchase-calc';

// phase126 — the register cost must equal what the posting engine debits to
// the asset account: bills debit line_total − tax_amount, expenses debit
// line_subtotal. These lock that identity.
describe('asset purchase calc (phase126)', () => {
  const line = newAssetLine({
    name: 'Office laptops', asset_account_id: 'acc-1720',
    quantity: '2', unit_cost: '1000', discount_percent: '10', tax_rate: '5',
  });

  it('exclusive tax: cost is net of discount, tax kept apart', () => {
    expect(lineAssetCost(line, false)).toBe(1800);
    expect(purchaseTotals([line], false, 0)).toEqual({ subtotal: 2000, discount: 200, tax: 90, roundOff: 0, total: 1890 });
  });

  it('inclusive tax: the tax is extracted from the price', () => {
    const l = newAssetLine({ name: 'x', asset_account_id: 'a', quantity: '1', unit_cost: '1050', tax_rate: '5' });
    expect(lineAssetCost(l, true)).toBe(1000);
    expect(purchaseTotals([l], true, 0).total).toBe(1050);
  });

  it('bill item debits exactly the register cost', () => {
    const [b] = billItemsFromLines([line], false) as unknown as Array<{ line_total: number; tax_amount: number; coa_account_id: string; product_id: null }>;
    expect(b.line_total - b.tax_amount).toBe(lineAssetCost(line, false));
    expect(b.coa_account_id).toBe('acc-1720');
    expect(b.product_id).toBeNull();
  });

  it('expense item debits exactly the register cost (discount folded in)', () => {
    const [e] = expenseItemsFromLines([line], false) as unknown as Array<{ line_subtotal: number; line_total: number; tax_amount: number }>;
    expect(e.line_subtotal).toBe(lineAssetCost(line, false));
    expect(e.line_total).toBe(1890);
    expect(e.tax_amount).toBe(90);
  });

  it('round-off only moves the document total', () => {
    expect(purchaseTotals([line], false, 0.5).total).toBe(1890.5);
  });

  it('specs carry sort_order matching the item order', () => {
    const specs = specsFromLines([line, newAssetLine({ name: 'Printer' })]);
    expect(specs.map((s) => s.sort_order)).toEqual([0, 1]);
    expect(specs[1].name).toBe('Printer');
  });

  it('validation and document routing', () => {
    expect(validateLines([])).toContain('apOcean.err_no_lines');
    expect(validateLines([newAssetLine()])).toEqual(expect.arrayContaining(['apOcean.err_name', 'apOcean.err_account', 'apOcean.err_cost']));
    expect(validateLines([line])).toEqual([]);
    expect(docTypeFor('credit')).toBe('vendor_bill');
    expect(docTypeFor('cash')).toBe('expense');
    expect(docTypeFor('bank')).toBe('expense');
  });
});
