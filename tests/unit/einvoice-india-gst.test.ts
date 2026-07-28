/**
 * AC-4B — golden-fixture tests for the India GST e-invoice JSON formatter.
 * Run: npx vitest run tests/unit/einvoice-india-gst.test.ts
 */
import { describe, it, expect } from 'vitest';
import { buildCanonicalInvoice, type CanonicalBuildInput } from '../../src/lib/einvoice/canonical';
import { toIndiaGstJson, type IndiaEInvoiceJson } from '../../src/lib/einvoice/india-gst';

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

describe('toIndiaGstJson — B2B intra-state (CGST + SGST)', () => {
  it('matches the golden payload', () => {
    const json = toIndiaGstJson(buildCanonicalInvoice(inInput()));
    const expected: IndiaEInvoiceJson = {
      Version: '1.1',
      TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
      DocDtls: { Typ: 'INV', No: 'INV-1001', Dt: '01/07/2026' },
      SellerDtls: { Gstin: '27ABCDE1234F1Z5', LglNm: 'StockBolt Auto', Addr1: 'MG Rd', Loc: 'Mumbai', Pin: 400001, Stcd: '27' },
      BuyerDtls: { Gstin: '27PQRS5678G1Z3', LglNm: 'Buyer Co', Pos: '27', Addr1: 'Link Rd', Loc: 'Mumbai', Pin: 400002, Stcd: '27' },
      ItemList: [{
        SlNo: '1', PrdDesc: 'Brake Pad', IsServc: 'N', HsnCd: '8708', Qty: 2, Unit: 'PCS',
        UnitPrice: 100, TotAmt: 200, Discount: 0, AssAmt: 200, GstRt: 18,
        IgstAmt: 0, CgstAmt: 18, SgstAmt: 18, TotItemVal: 236,
      }],
      ValDtls: { AssVal: 200, CgstVal: 18, SgstVal: 18, IgstVal: 0, Discount: 0, RndOffAmt: 0, TotInvVal: 236 },
    };
    expect(json).toEqual(expected);
  });
});

describe('toIndiaGstJson — B2B inter-state (IGST)', () => {
  it('puts the whole tax on IGST and sets IGST totals', () => {
    const json = toIndiaGstJson(buildCanonicalInvoice(inInput({
      buyer: { legal_name: 'KA Buyer', tax_id: '29AAAA1111A1Z1', buyer_type: 'registered', country_code: 'IN', place_of_supply_code: '29', state_code: '29', address_line: 'x', city: 'Bengaluru', pincode: '560001' },
    })));
    expect(json.TranDtls.SupTyp).toBe('B2B');
    expect(json.BuyerDtls.Pos).toBe('29');
    expect(json.ItemList[0]).toMatchObject({ IgstAmt: 36, CgstAmt: 0, SgstAmt: 0 });
    expect(json.ValDtls).toMatchObject({ IgstVal: 36, CgstVal: 0, SgstVal: 0, TotInvVal: 236 });
  });
});

describe('toIndiaGstJson — export (EXPWOP, zero-rated)', () => {
  it('sets SupTyp EXPWOP, Pos 96 and zero tax', () => {
    const json = toIndiaGstJson(buildCanonicalInvoice(inInput({
      buyer: { legal_name: 'Overseas Ltd', tax_id: null, buyer_type: 'export', country_code: 'US', place_of_supply_code: null, state_code: null, address_line: 'x', city: 'NY', pincode: null },
      document: { number: 'INV-1003', date: '2026-07-03', currency: 'USD', is_export: true, reference: null },
      lines: [{ description: 'Brake Pad', hsn_code: '8708', is_service: false, quantity: 2, unit: 'PCS', unit_price: 100, discount_amount: 0, taxable_value: 200, tax_rate: 0, tax_amount: 0, line_total: 200, default_tax_treatment: null }],
      totals: { subtotal: 200, discount: 0, tax_total: 0, round_off: 0, grand_total: 200 },
    })));
    expect(json.TranDtls.SupTyp).toBe('EXPWOP');
    expect(json.BuyerDtls.Pos).toBe('96');
    expect(json.BuyerDtls.Gstin).toBe('');
    expect(json.ItemList[0]).toMatchObject({ IgstAmt: 0, CgstAmt: 0, SgstAmt: 0, GstRt: 0 });
    expect(json.ValDtls.TotInvVal).toBe(200);
  });
});

describe('toIndiaGstJson — date + discount', () => {
  it('formats ISO date to dd/mm/yyyy and carries gross/discount per line', () => {
    const json = toIndiaGstJson(buildCanonicalInvoice(inInput({
      lines: [{ description: 'Clutch Kit', hsn_code: '8708', is_service: false, quantity: 1, unit: 'PCS', unit_price: 300, discount_amount: 50, taxable_value: 250, tax_rate: 18, tax_amount: 45, line_total: 295, default_tax_treatment: null }],
      totals: { subtotal: 250, discount: 50, tax_total: 45, round_off: 0, grand_total: 295 },
    })));
    expect(json.DocDtls.Dt).toBe('01/07/2026');
    expect(json.ItemList[0]).toMatchObject({ TotAmt: 300, Discount: 50, AssAmt: 250 });
    expect(json.ValDtls.Discount).toBe(50);
  });
});
