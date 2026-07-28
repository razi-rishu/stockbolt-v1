/**
 * AC-4B — unit tests for the canonical e-invoice model (no DB, no React).
 * Run: npx vitest run tests/unit/einvoice-canonical.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  buildCanonicalInvoice, uaeTaxCategoryCode, indiaSupplyType,
  type CanonicalBuildInput,
} from '../../src/lib/einvoice/canonical';

// A standard-rate India line worth 200 net + 36 tax, with knobs for the tests.
function inInput(over: Partial<CanonicalBuildInput> = {}): CanonicalBuildInput {
  return {
    supplier: { legal_name: 'StockBolt Auto', tax_id: '27ABCDE1234F1Z5', country_code: 'IN', state_code: '27', address_line: 'MG Rd', city: 'Mumbai', pincode: '400001' },
    buyer: { legal_name: 'Buyer Co', tax_id: '27PQRS5678G1Z3', buyer_type: 'registered', country_code: 'IN', place_of_supply_code: '27', state_code: '27', address_line: 'Link Rd', city: 'Mumbai', pincode: '400002' },
    document: { number: 'INV-1001', date: '2026-07-01', currency: 'INR', is_export: false, reference: null },
    lines: [{ description: 'Brake Pad', hsn_code: '8708', is_service: false, quantity: 2, unit: 'PCS', unit_price: 100, discount_amount: 0, taxable_value: 200, tax_rate: 18, tax_amount: 36, line_total: 236, default_tax_treatment: null }],
    totals: { subtotal: 200, discount: 0, tax_total: 36, round_off: 0, grand_total: 236 },
    ...over,
  };
}

describe('India CGST/SGST vs IGST allocation', () => {
  it('intra-state (supplier state == place of supply) → CGST + SGST, no IGST', () => {
    const c = buildCanonicalInvoice(inInput());
    expect(c.is_intra_state).toBe(true);
    expect(c.lines[0].cgst_amount).toBe(18);
    expect(c.lines[0].sgst_amount).toBe(18);
    expect(c.lines[0].igst_amount).toBe(0);
    expect(c.totals.cgst).toBe(18);
    expect(c.totals.sgst).toBe(18);
    expect(c.totals.igst).toBe(0);
  });

  it('inter-state (different place of supply) → IGST only', () => {
    const c = buildCanonicalInvoice(inInput({
      buyer: { legal_name: 'Buyer Co', tax_id: '29AAAA1111A1Z1', buyer_type: 'registered', country_code: 'IN', place_of_supply_code: '29', state_code: '29', address_line: 'x', city: 'Bengaluru', pincode: '560001' },
    }));
    expect(c.is_intra_state).toBe(false);
    expect(c.lines[0].igst_amount).toBe(36);
    expect(c.lines[0].cgst_amount).toBe(0);
    expect(c.lines[0].sgst_amount).toBe(0);
    expect(c.totals.igst).toBe(36);
  });

  it('splits an odd tax so CGST + SGST always sum to the line tax', () => {
    const c = buildCanonicalInvoice(inInput({
      lines: [{ description: 'X', hsn_code: '8708', is_service: false, quantity: 1, unit: 'PCS', unit_price: 100, discount_amount: 0, taxable_value: 100, tax_rate: 15.01, tax_amount: 15.01, line_total: 115.01, default_tax_treatment: null }],
      totals: { subtotal: 100, discount: 0, tax_total: 15.01, round_off: 0, grand_total: 115.01 },
    }));
    expect(c.lines[0].cgst_amount + c.lines[0].sgst_amount).toBe(15.01);
  });
});

describe('export handling', () => {
  it('export forces treatment=export, place of supply 96, and EXPWOP when zero-tax', () => {
    const c = buildCanonicalInvoice(inInput({
      buyer: { legal_name: 'Overseas Ltd', tax_id: null, buyer_type: 'export', country_code: 'US', place_of_supply_code: null, state_code: null, address_line: 'x', city: 'NY', pincode: null },
      document: { number: 'INV-1003', date: '2026-07-03', currency: 'USD', is_export: true, reference: null },
      lines: [{ description: 'Brake Pad', hsn_code: '8708', is_service: false, quantity: 2, unit: 'PCS', unit_price: 100, discount_amount: 0, taxable_value: 200, tax_rate: 0, tax_amount: 0, line_total: 200, default_tax_treatment: null }],
      totals: { subtotal: 200, discount: 0, tax_total: 0, round_off: 0, grand_total: 200 },
    }));
    expect(c.lines[0].treatment).toBe('export');
    expect(c.place_of_supply_code).toBe('96');
    expect(c.supply_type).toBe('EXPWOP');
    expect(c.is_intra_state).toBe(false);
  });
});

describe('supply type + UAE tax category mapping', () => {
  it('indiaSupplyType covers B2B / B2C / SEZ / EXP', () => {
    expect(indiaSupplyType('registered', false, 36)).toBe('B2B');
    expect(indiaSupplyType('unregistered', false, 0)).toBe('B2C');
    expect(indiaSupplyType('sez', false, 36)).toBe('SEZWP');
    expect(indiaSupplyType('sez', false, 0)).toBe('SEZWOP');
    expect(indiaSupplyType('registered', true, 36)).toBe('EXPWP');
    expect(indiaSupplyType('registered', true, 0)).toBe('EXPWOP');
  });
  it('uaeTaxCategoryCode maps every treatment to a UBL code', () => {
    expect(uaeTaxCategoryCode('standard')).toBe('S');
    expect(uaeTaxCategoryCode('zero_rated')).toBe('Z');
    expect(uaeTaxCategoryCode('export')).toBe('Z');
    expect(uaeTaxCategoryCode('exempt')).toBe('E');
    expect(uaeTaxCategoryCode('out_of_scope')).toBe('O');
    expect(uaeTaxCategoryCode('reverse_charge')).toBe('AE');
  });
});

describe('UAE jurisdiction', () => {
  it('an AE supplier never gets CGST/SGST/IGST and keeps a category code', () => {
    const c = buildCanonicalInvoice({
      supplier: { legal_name: 'StockBolt FZE', tax_id: '100000000000003', country_code: 'AE', state_code: null, address_line: 'SZR', city: 'Dubai', pincode: null },
      buyer: { legal_name: 'Gulf Motors', tax_id: '100000000000012', buyer_type: 'registered', country_code: 'AE', place_of_supply_code: null, state_code: null, address_line: 'Al Quoz', city: 'Dubai', pincode: null },
      document: { number: 'INV-2001', date: '2026-07-05', currency: 'AED', is_export: false, reference: null },
      lines: [{ description: 'Oil Filter', hsn_code: null, is_service: false, quantity: 3, unit: 'PCS', unit_price: 50, discount_amount: 0, taxable_value: 150, tax_rate: 5, tax_amount: 7.5, line_total: 157.5, default_tax_treatment: null }],
      totals: { subtotal: 150, discount: 0, tax_total: 7.5, round_off: 0, grand_total: 157.5 },
    });
    expect(c.jurisdiction).toBe('AE_VAT');
    expect(c.lines[0].cgst_amount).toBe(0);
    expect(c.lines[0].igst_amount).toBe(0);
    expect(c.lines[0].tax_category_code).toBe('S');
  });
});
