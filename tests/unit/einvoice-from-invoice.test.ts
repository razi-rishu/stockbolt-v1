/**
 * AC-4D — unit tests for assembleCanonicalFromInvoice (real rows → canonical).
 * Run: npx vitest run tests/unit/einvoice-from-invoice.test.ts
 */
import { describe, it, expect } from 'vitest';
import { assembleCanonicalFromInvoice, jurisdictionAndFormat, type AssembleInput } from '../../src/lib/einvoice/from-invoice';
import { buildCanonicalInvoice } from '../../src/lib/einvoice/canonical';

function inInput(over: Partial<AssembleInput> = {}): AssembleInput {
  return {
    company: { name: 'StockBolt Auto', tax_id: '27ABCDE1234F1Z5', country_code: 'IN', address: 'MG Rd, Mumbai' },
    invoice: {
      invoice_number: 'INV-1001', date: '2026-07-01', currency: 'INR', is_export: false, reference: null,
      subtotal: 200, discount_amount: 0, tax_amount: 36, round_off_amount: 0, total_amount: 236,
    },
    customer: { name: 'Buyer Co', tax_id: '27PQRS5678G1Z3', buyer_type: 'registered', place_of_supply_code: '27', country_code: 'IN', address_street: 'Link Rd', address_city: 'Mumbai', address_postal: '400002' },
    items: [{ description: 'Brake Pad', product_id: 'p1', quantity: 2, unit_id: 'u1', unit_price: 100, discount_amount: 0, line_subtotal: 200, tax_rate: 18, tax_amount: 36, line_total: 236 }],
    products: [{ id: 'p1', name: 'Brake Pad', hsn_code: '8708', default_tax_treatment: null, type: 'goods' }],
    ...over,
  };
}

describe('jurisdictionAndFormat', () => {
  it('maps country to jurisdiction + format + support flag', () => {
    expect(jurisdictionAndFormat('IN')).toEqual({ jurisdiction: 'IN_GST', format: 'india_gst_json', supported: true });
    expect(jurisdictionAndFormat('AE')).toEqual({ jurisdiction: 'AE_VAT', format: 'pint_ae_ubl', supported: true });
    expect(jurisdictionAndFormat('SA').supported).toBe(false);
    expect(jurisdictionAndFormat(null).supported).toBe(false);
  });
});

describe('assembleCanonicalFromInvoice — India', () => {
  it('derives supplier + buyer state from GSTIN/place-of-supply and passes amounts through', () => {
    const c = assembleCanonicalFromInvoice(inInput());
    expect(c.supplier.state_code).toBe('27');        // from company GSTIN prefix
    expect(c.buyer.state_code).toBe('27');           // from place_of_supply
    expect(c.lines[0]).toMatchObject({ hsn_code: '8708', is_service: false, taxable_value: 200, tax_amount: 36, line_total: 236 });
    expect(c.totals).toMatchObject({ subtotal: 200, tax_total: 36, grand_total: 236 });

    // Same-state → the canonical splits into CGST + SGST.
    const canon = buildCanonicalInvoice(c);
    expect(canon.is_intra_state).toBe(true);
    expect(canon.lines[0].cgst_amount).toBe(18);
    expect(canon.lines[0].sgst_amount).toBe(18);
  });

  it('inter-state buyer (different place of supply) → IGST', () => {
    const c = assembleCanonicalFromInvoice(inInput({
      customer: { name: 'KA Buyer', tax_id: '29AAAA1111A1Z1', buyer_type: 'registered', place_of_supply_code: '29', country_code: 'IN' },
    }));
    expect(c.buyer.state_code).toBe('29');
    const canon = buildCanonicalInvoice(c);
    expect(canon.is_intra_state).toBe(false);
    expect(canon.lines[0].igst_amount).toBe(36);
  });

  it('falls back to the buyer GSTIN prefix when place-of-supply is absent', () => {
    const c = assembleCanonicalFromInvoice(inInput({
      customer: { name: 'Buyer', tax_id: '24GUJAT0000A1Z0', buyer_type: 'registered', country_code: 'IN' },
    }));
    expect(c.buyer.state_code).toBe('24');
  });
});

describe('assembleCanonicalFromInvoice — UAE + service', () => {
  it('AE company gets no state code and a service line is flagged', () => {
    const c = assembleCanonicalFromInvoice(inInput({
      company: { name: 'StockBolt FZE', tax_id: '100000000000003', country_code: 'AE', address: 'SZR, Dubai' },
      products: [{ id: 'p1', name: 'Fitting service', hsn_code: null, default_tax_treatment: null, type: 'service' }],
    }));
    expect(c.supplier.state_code).toBeNull();
    expect(c.lines[0].is_service).toBe(true);
  });

  it('carries the export flag and a product default treatment through', () => {
    const c = assembleCanonicalFromInvoice(inInput({
      invoice: { invoice_number: 'INV-9', date: '2026-07-02', currency: 'INR', is_export: true, reference: null, subtotal: 100, discount_amount: 0, tax_amount: 0, round_off_amount: 0, total_amount: 100 },
      products: [{ id: 'p1', name: 'X', hsn_code: '8708', default_tax_treatment: 'zero_rated', type: 'goods' }],
    }));
    expect(c.document.is_export).toBe(true);
    expect(c.lines[0].default_tax_treatment).toBe('zero_rated');
    // export forces the resolved treatment to 'export' in the canonical.
    expect(buildCanonicalInvoice(c).lines[0].treatment).toBe('export');
  });
});
