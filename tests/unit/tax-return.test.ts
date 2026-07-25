/**
 * AC-3A — unit tests for the VAT/GST pure logic (no DB, no React).
 * Run: npx vitest run tests/unit/tax-return.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  jurisdictionForCountry, jurisdictionLabel, taxAccountsFor, taxAccountsForCountry,
  resolveFilingPeriod, netPayable, reconcile, reconciliation,
} from '../../src/lib/tax-return';

describe('jurisdiction selection', () => {
  it('India → IN_GST; UAE + GCC + default → AE_VAT', () => {
    expect(jurisdictionForCountry('IN')).toBe('IN_GST');
    expect(jurisdictionForCountry('in')).toBe('IN_GST');
    expect(jurisdictionForCountry('AE')).toBe('AE_VAT');
    expect(jurisdictionForCountry('SA')).toBe('AE_VAT');
    expect(jurisdictionForCountry('KW')).toBe('AE_VAT');
    expect(jurisdictionForCountry(null)).toBe('AE_VAT');
    expect(jurisdictionForCountry(undefined)).toBe('AE_VAT');
  });
  it('labels', () => {
    expect(jurisdictionLabel('IN_GST')).toBe('India GST');
    expect(jurisdictionLabel('AE_VAT')).toBe('UAE VAT');
  });
});

describe('tax account mapping (reuses seedCOA config)', () => {
  it('UAE VAT → 2200 output / 1500 input', () => {
    expect(taxAccountsFor('AE_VAT')).toEqual({ output: ['2200'], input: ['1500'] });
  });
  it('India GST → CGST/SGST/IGST output + input sets', () => {
    expect(taxAccountsFor('IN_GST')).toEqual({
      output: ['2210', '2220', '2230'], input: ['1510', '1520', '1530'],
    });
  });
  it('country convenience resolver', () => {
    expect(taxAccountsForCountry('IN').output).toEqual(['2210', '2220', '2230']);
    expect(taxAccountsForCountry('AE').output).toEqual(['2200']);
  });
});

describe('resolveFilingPeriod', () => {
  it('monthly → the calendar month containing the anchor', () => {
    expect(resolveFilingPeriod('monthly', '2026-03-14')).toEqual({ period_type: 'monthly', period_start: '2026-03-01', period_end: '2026-03-31' });
    expect(resolveFilingPeriod('monthly', '2026-12-20')).toEqual({ period_type: 'monthly', period_start: '2026-12-01', period_end: '2026-12-31' });
  });
  it('monthly handles February (leap + non-leap)', () => {
    expect(resolveFilingPeriod('monthly', '2024-02-10').period_end).toBe('2024-02-29');
    expect(resolveFilingPeriod('monthly', '2026-02-10').period_end).toBe('2026-02-28');
  });
  it('quarterly → the calendar quarter containing the anchor', () => {
    expect(resolveFilingPeriod('quarterly', '2026-07-24')).toEqual({ period_type: 'quarterly', period_start: '2026-07-01', period_end: '2026-09-30' });
    expect(resolveFilingPeriod('quarterly', '2026-01-05')).toEqual({ period_type: 'quarterly', period_start: '2026-01-01', period_end: '2026-03-31' });
    expect(resolveFilingPeriod('quarterly', '2026-11-15')).toEqual({ period_type: 'quarterly', period_start: '2026-10-01', period_end: '2026-12-31' });
  });
});

describe('netPayable', () => {
  it('output − input; positive = payable, negative = refundable', () => {
    expect(netPayable(5000, 3000)).toBe(2000);
    expect(netPayable(3000, 5000)).toBe(-2000);
    expect(netPayable(3.03, 3)).toBe(0.03);
  });
});

describe('reconcile (GL vs documents)', () => {
  it('matches within tolerance', () => {
    expect(reconcile(1000, 1000)).toEqual({ gl: 1000, documents: 1000, difference: 0, matched: true });
    expect(reconcile(100.004, 100).matched).toBe(true); // rounds to 0 diff
  });
  it('flags a mismatch beyond tolerance', () => {
    const r = reconcile(1000, 950);
    expect(r).toEqual({ gl: 1000, documents: 950, difference: 50, matched: false });
    expect(reconcile(100.02, 100).matched).toBe(false); // 0.02 > 0.01
  });
  it('reconciliation is matched only when BOTH sides match', () => {
    expect(reconciliation(1000, 1000, 500, 500).matched).toBe(true);
    expect(reconciliation(1000, 1000, 500, 480).matched).toBe(false); // input off
    expect(reconciliation(1000, 900, 500, 500).matched).toBe(false); // output off
  });
});
