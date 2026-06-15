import { describe, it, expect } from 'vitest';
import { formatCurrency, getTaxLabels, defaultTaxRate } from '../../src/lib/locale';

// Production-readiness audit — Issue 6 test checklist for the localization layer.
// Pure functions, no DB: verifies UAE vs India currency + tax terminology.

describe('formatCurrency', () => {
  it('formats AED with the code', () => {
    const s = formatCurrency(0, 'AED');
    expect(s).toContain('AED');
    expect(s).toContain('0.00');
  });

  it('formats INR with the rupee symbol, not AED', () => {
    const s = formatCurrency(1234.5, 'INR');
    expect(s).toContain('₹');
    expect(s).toContain('1,234.50');
    expect(s).not.toContain('AED');
  });

  it('handles SAR and other GCC codes', () => {
    expect(formatCurrency(100, 'SAR')).toContain('100');
    expect(formatCurrency(100, 'SAR')).not.toContain('AED');
  });

  it('coerces null/undefined/strings to 0-safe output', () => {
    expect(formatCurrency(null, 'AED')).toContain('0.00');
    expect(formatCurrency(undefined, 'INR')).toContain('0.00');
    expect(formatCurrency('2500', 'AED')).toContain('2,500.00');
  });

  it('falls back gracefully for an unknown currency code', () => {
    const s = formatCurrency(50, 'ZZZ');
    expect(s).toContain('50.00');
  });
});

describe('getTaxLabels', () => {
  it('returns VAT / TRN for UAE', () => {
    expect(getTaxLabels('AE')).toEqual({ taxName: 'VAT', registrationName: 'TRN' });
  });

  it('returns VAT / TRN for every GCC country', () => {
    for (const c of ['SA', 'KW', 'BH', 'OM', 'QA']) {
      expect(getTaxLabels(c)).toEqual({ taxName: 'VAT', registrationName: 'TRN' });
    }
  });

  it('returns GST / GSTIN for India', () => {
    expect(getTaxLabels('IN')).toEqual({ taxName: 'GST', registrationName: 'GSTIN' });
  });

  it('defaults to VAT / TRN when country is missing', () => {
    expect(getTaxLabels(undefined)).toEqual({ taxName: 'VAT', registrationName: 'TRN' });
    expect(getTaxLabels(null)).toEqual({ taxName: 'VAT', registrationName: 'TRN' });
  });
});

describe('defaultTaxRate', () => {
  it('is 5% for UAE/GCC and 18% for India', () => {
    expect(defaultTaxRate('AE')).toBe(5);
    expect(defaultTaxRate('SA')).toBe(5);
    expect(defaultTaxRate('IN')).toBe(18);
  });
});
