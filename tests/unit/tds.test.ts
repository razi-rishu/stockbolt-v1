/**
 * AC-7A — unit tests for the India TDS logic.
 * Run: npx vitest run tests/unit/tds.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  resolveTdsRate, tdsAmount, checkThreshold, previewDeduction,
  indianFinancialYear, tdsQuarter, NO_PAN_RATE, type TdsSection,
} from '../../src/lib/tds';

/** 194C contractor: 1% individual / 2% other, 30k single / 100k annual. */
const s194C: TdsSection = {
  code: '194C', rate_individual: 1, rate_other: 2,
  single_threshold: 30000, annual_threshold: 100000,
};
/** 194J professional: 10% flat, 30k annual, no single threshold. */
const s194J: TdsSection = {
  code: '194J', rate_individual: 10, rate_other: 10,
  single_threshold: 0, annual_threshold: 30000,
};
/** 194Q purchase: 0.1%, no thresholds modelled here. */
const s194Q: TdsSection = {
  code: '194Q', rate_individual: 0.1, rate_other: 0.1,
  single_threshold: 0, annual_threshold: 0,
};

describe('resolveTdsRate', () => {
  it('uses the section rate for the deductee class', () => {
    expect(resolveTdsRate({ section: s194C, deductee_type: 'individual_huf', has_pan: true }))
      .toEqual({ rate: 1, reason: 'section' });
    expect(resolveTdsRate({ section: s194C, deductee_type: 'other', has_pan: true }))
      .toEqual({ rate: 2, reason: 'section' });
  });

  it('§206AA: no PAN means the HIGHER of the section rate and 20%', () => {
    expect(resolveTdsRate({ section: s194C, deductee_type: 'other', has_pan: false }))
      .toEqual({ rate: NO_PAN_RATE, reason: 'no_pan_206aa' });
    // a section already above 20% is not reduced to 20
    const s30: TdsSection = { ...s194J, rate_individual: 30, rate_other: 30 };
    expect(resolveTdsRate({ section: s30, deductee_type: 'other', has_pan: false }))
      .toEqual({ rate: 30, reason: 'no_pan_206aa' });
  });

  it('a §197 certificate wins over both the section rate and the no-PAN penalty', () => {
    expect(resolveTdsRate({ section: s194J, deductee_type: 'other', has_pan: true, lower_deduction_rate: 2 }))
      .toEqual({ rate: 2, reason: 'certificate' });
    expect(resolveTdsRate({ section: s194J, deductee_type: 'other', has_pan: false, lower_deduction_rate: 2 }))
      .toEqual({ rate: 2, reason: 'certificate' });
  });

  it('a nil-rate certificate (0%) is honoured, not treated as absent', () => {
    expect(resolveTdsRate({ section: s194J, deductee_type: 'other', has_pan: true, lower_deduction_rate: 0 }))
      .toEqual({ rate: 0, reason: 'certificate' });
  });
});

describe('tdsAmount', () => {
  it('computes to 2dp', () => {
    expect(tdsAmount(100000, 2)).toBe(2000);
    expect(tdsAmount(30000, 1)).toBe(300);
    expect(tdsAmount(12345.67, 10)).toBe(1234.57);   // rounds half up
    expect(tdsAmount(1000000, 0.1)).toBe(1000);
  });
});

describe('checkThreshold', () => {
  it('is exempt below both thresholds', () => {
    const r = checkThreshold({ base: 10000, ytd_base: 0, single_threshold: 30000, annual_threshold: 100000 });
    expect(r.exempt).toBe(true);
    expect(r.reason).toMatch(/threshold/);
  });

  it('crossing the SINGLE threshold creates liability even with no history', () => {
    expect(checkThreshold({ base: 30000, ytd_base: 0, single_threshold: 30000, annual_threshold: 100000 }).exempt).toBe(false);
  });

  it('crossing the ANNUAL aggregate creates liability on a small payment', () => {
    // 95k already paid, this 10k pushes the year over 100k
    expect(checkThreshold({ base: 10000, ytd_base: 95000, single_threshold: 30000, annual_threshold: 100000 }).exempt).toBe(false);
  });

  it('a section with no thresholds always deducts', () => {
    expect(checkThreshold({ base: 1, ytd_base: 0, single_threshold: 0, annual_threshold: 0 }).exempt).toBe(false);
  });
});

describe('previewDeduction', () => {
  it('a below-threshold contractor payment deducts nothing', () => {
    const p = previewDeduction(10000, { section: s194C, deductee_type: 'other', has_pan: true }, { base: 10000, ytd_base: 0 });
    expect(p).toMatchObject({ applicable: false, amount: 0, net_payable: 10000 });
    expect(p.exempt_reason).toMatch(/threshold/);
  });

  it('an above-threshold company contractor payment deducts 2%', () => {
    const p = previewDeduction(100000, { section: s194C, deductee_type: 'other', has_pan: true }, { base: 100000, ytd_base: 0 });
    expect(p).toMatchObject({ applicable: true, rate: 2, reason: 'section', amount: 2000, net_payable: 98000 });
  });

  it('no PAN escalates the same payment to 20%', () => {
    const p = previewDeduction(100000, { section: s194C, deductee_type: 'other', has_pan: false }, { base: 100000, ytd_base: 0 });
    expect(p).toMatchObject({ applicable: true, rate: 20, reason: 'no_pan_206aa', amount: 20000, net_payable: 80000 });
  });

  it('194Q at 0.1% on a large purchase', () => {
    const p = previewDeduction(5000000, { section: s194Q, deductee_type: 'other', has_pan: true }, { base: 5000000, ytd_base: 0 });
    expect(p).toMatchObject({ rate: 0.1, amount: 5000, net_payable: 4995000 });
  });

  it('net payable + TDS always reconstructs the base', () => {
    for (const base of [100000, 33333.33, 1, 999999.99]) {
      const p = previewDeduction(base, { section: s194J, deductee_type: 'other', has_pan: true }, { base, ytd_base: 100000 });
      expect(Math.round((p.amount + p.net_payable) * 100) / 100).toBe(Math.round(base * 100) / 100);
    }
  });
});

describe('Indian financial year + return quarter', () => {
  it('FY runs 1 Apr – 31 Mar', () => {
    expect(indianFinancialYear('2025-04-01')).toBe(2025);
    expect(indianFinancialYear('2025-12-31')).toBe(2025);
    expect(indianFinancialYear('2026-03-31')).toBe(2025);   // still FY2025-26
    expect(indianFinancialYear('2026-04-01')).toBe(2026);
  });

  it('maps months to 26Q quarters', () => {
    expect(tdsQuarter('2025-04-15')).toBe('Q1');
    expect(tdsQuarter('2025-09-30')).toBe('Q2');
    expect(tdsQuarter('2025-10-01')).toBe('Q3');
    expect(tdsQuarter('2026-01-31')).toBe('Q4');
    expect(tdsQuarter('2026-03-31')).toBe('Q4');
  });
});
