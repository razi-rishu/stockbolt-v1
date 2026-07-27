/**
 * AC-4A — unit tests for the e-invoice metadata pure logic (no DB, no React).
 * Run: npx vitest run tests/unit/einvoice-metadata.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  TAX_TREATMENTS, isTaxTreatment, BUYER_TYPES, isBuyerType,
  GST_STATE_CODES, isValidStateCode, stateNameForCode,
  suggestBuyerType, resolveLineTreatment, eInvoiceReadiness,
} from '../../src/lib/einvoice-metadata';

describe('enums', () => {
  it('tax-treatment guard', () => {
    expect(TAX_TREATMENTS).toContain('reverse_charge');
    expect(isTaxTreatment('export')).toBe(true);
    expect(isTaxTreatment('nonsense')).toBe(false);
    expect(isTaxTreatment(null)).toBe(false);
  });
  it('buyer-type guard', () => {
    expect(BUYER_TYPES).toContain('sez');
    expect(isBuyerType('unregistered')).toBe(true);
    expect(isBuyerType('vip')).toBe(false);
  });
});

describe('GST state codes', () => {
  it('covers the standard set incl. 07 Delhi, 27 Maharashtra, 99 Centre', () => {
    expect(GST_STATE_CODES.length).toBeGreaterThanOrEqual(38);
    expect(isValidStateCode('07')).toBe(true);
    expect(isValidStateCode('27')).toBe(true);
    expect(isValidStateCode('99')).toBe(true);
    expect(isValidStateCode('00')).toBe(false);
    expect(isValidStateCode(null)).toBe(false);
    expect(stateNameForCode('27')).toBe('Maharashtra');
    expect(stateNameForCode('zz')).toBeNull();
  });
});

describe('suggestBuyerType', () => {
  it('honours an explicit value', () => {
    expect(suggestBuyerType({ buyer_type: 'export' })).toBe('export');
    expect(suggestBuyerType({ buyer_type: 'sez', tax_id: null })).toBe('sez');
  });
  it('infers registered/unregistered from tax_id when unset', () => {
    expect(suggestBuyerType({ tax_id: '27ABCDE1234F1Z5' })).toBe('registered');
    expect(suggestBuyerType({ tax_id: '' })).toBe('unregistered');
    expect(suggestBuyerType({})).toBe('unregistered');
  });
});

describe('resolveLineTreatment', () => {
  it('export invoice forces export', () => {
    expect(resolveLineTreatment({ default_tax_treatment: 'standard' }, { is_export: true })).toBe('export');
  });
  it('falls back to product default, then standard', () => {
    expect(resolveLineTreatment({ default_tax_treatment: 'zero_rated' }, { is_export: false })).toBe('zero_rated');
    expect(resolveLineTreatment({ default_tax_treatment: null }, {})).toBe('standard');
    expect(resolveLineTreatment({ default_tax_treatment: 'bogus' }, {})).toBe('standard'); // invalid → standard
  });
});

describe('eInvoiceReadiness', () => {
  it('India: flags missing HSN, GSTIN, and place of supply', () => {
    const r = eInvoiceReadiness({
      jurisdiction: 'IN_GST',
      contact: { tax_id: null, place_of_supply_code: null, buyer_type: 'registered' },
      lines: [{ hsn_code: null, description: 'Brake Pad' }, { hsn_code: '8708' }],
    });
    expect(r.ready).toBe(false);
    expect(r.missing.some((m) => /GSTIN/.test(m))).toBe(true);
    expect(r.missing.some((m) => /Place of supply/.test(m))).toBe(true);
    expect(r.missing.some((m) => /HSN.*line 1/.test(m))).toBe(true);
    expect(r.missing.some((m) => /line 2/.test(m))).toBe(false); // line 2 has HSN
  });
  it('India: a complete registered B2B invoice is ready', () => {
    const r = eInvoiceReadiness({
      jurisdiction: 'IN_GST',
      contact: { tax_id: '27ABCDE1234F1Z5', place_of_supply_code: '27', buyer_type: 'registered' },
      lines: [{ hsn_code: '8708' }],
    });
    expect(r).toEqual({ ready: true, missing: [] });
  });
  it('India export: HSN still required but place-of-supply not', () => {
    const r = eInvoiceReadiness({
      jurisdiction: 'IN_GST', is_export: true,
      contact: { tax_id: null, place_of_supply_code: null, buyer_type: 'export' },
      lines: [{ hsn_code: '8708' }],
    });
    expect(r.missing.some((m) => /Place of supply/.test(m))).toBe(false);
    expect(r.ready).toBe(true);
  });
  it('UAE: registered buyer needs a TRN; HSN not required', () => {
    expect(eInvoiceReadiness({
      jurisdiction: 'AE_VAT',
      contact: { tax_id: null, buyer_type: 'registered' },
      lines: [{ hsn_code: null }],
    }).missing).toEqual(['Buyer Tax Registration Number (TRN)']);

    expect(eInvoiceReadiness({
      jurisdiction: 'AE_VAT',
      contact: { tax_id: 'TRN100000000003', buyer_type: 'registered' },
      lines: [{ hsn_code: null }],
    }).ready).toBe(true);
  });
});
