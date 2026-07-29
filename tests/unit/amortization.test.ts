/**
 * AC-6A — unit tests for the amortization schedule math.
 * Run: npx vitest run tests/unit/amortization.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  installments, projectSchedule, duePeriods, amortizationLegs,
  isAmortizationKind, AMORTIZATION_KINDS,
} from '../../src/lib/amortization';

const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

describe('installments', () => {
  it('splits evenly when it divides cleanly', () => {
    expect(installments(1200, 12)).toEqual(Array(12).fill(100));
  });

  it('puts the rounding remainder in the FINAL period and still sums to the total', () => {
    const r = installments(1000, 3);
    expect(r).toEqual([333.33, 333.33, 333.34]);
    expect(sum(r)).toBe(1000);
  });

  it('never leaves a stray fraction, across many awkward splits', () => {
    for (const [total, periods] of [[100, 3], [0.05, 4], [9999.99, 7], [1, 6], [12345.67, 11]] as const) {
      expect(sum(installments(total, periods)), `${total}/${periods}`).toBe(Math.round(total * 100) / 100);
    }
  });

  it('handles a single period and coerces bad period counts', () => {
    expect(installments(500, 1)).toEqual([500]);
    expect(installments(500, 0)).toEqual([500]);   // clamped to 1
  });
});

describe('projectSchedule', () => {
  const s = { total_amount: 1200, periods: 12, start_date: '2025-01-15' };

  it('ends each period at month-end starting in the start month', () => {
    const rows = projectSchedule(s);
    expect(rows).toHaveLength(12);
    expect(rows[0].period_end).toBe('2025-01-31');
    expect(rows[1].period_end).toBe('2025-02-28');   // short month
    expect(rows[11].period_end).toBe('2025-12-31');
  });

  it('runs cumulative up to the total and remaining down to zero', () => {
    const rows = projectSchedule(s);
    expect(rows[0]).toMatchObject({ index: 1, amount: 100, cumulative: 100, remaining: 1100 });
    expect(rows[11]).toMatchObject({ index: 12, cumulative: 1200, remaining: 0 });
  });

  it('crosses a year boundary correctly', () => {
    const rows = projectSchedule({ total_amount: 300, periods: 3, start_date: '2025-11-10' });
    expect(rows.map((r) => r.period_end)).toEqual(['2025-11-30', '2025-12-31', '2026-01-31']);
  });

  it('closes out exactly even with an uneven split', () => {
    const rows = projectSchedule({ total_amount: 1000, periods: 3, start_date: '2025-01-01' });
    expect(rows.map((r) => r.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(rows[2].remaining).toBe(0);
  });
});

describe('duePeriods', () => {
  const s = { total_amount: 1200, periods: 12, start_date: '2025-01-01' };

  it('returns only unposted periods up to the run date', () => {
    const due = duePeriods(s, 0, '2025-03-31');
    expect(due.map((r) => r.period_end)).toEqual(['2025-01-31', '2025-02-28', '2025-03-31']);
  });

  it('skips already-posted installments (catch-up)', () => {
    const due = duePeriods(s, 2, '2025-05-31');
    expect(due.map((r) => r.index)).toEqual([3, 4, 5]);
  });

  it('is empty once fully posted, or before the first period ends', () => {
    expect(duePeriods(s, 12, '2026-12-31')).toHaveLength(0);
    expect(duePeriods(s, 0, '2024-12-31')).toHaveLength(0);
  });
});

describe('amortizationLegs', () => {
  it('prepaid expense charges the P&L and credits the prepaid asset', () => {
    expect(amortizationLegs('prepaid_expense', '1410', '6200'))
      .toEqual({ debit_account_code: '6200', credit_account_code: '1410' });
  });
  it('deferred revenue draws the liability down into revenue', () => {
    expect(amortizationLegs('deferred_revenue', '2500', '4100'))
      .toEqual({ debit_account_code: '2500', credit_account_code: '4100' });
  });
  it('accrued expense charges the P&L and builds the liability', () => {
    expect(amortizationLegs('accrued_expense', '2300', '6200'))
      .toEqual({ debit_account_code: '6200', credit_account_code: '2300' });
  });
  it('kind guard', () => {
    expect(AMORTIZATION_KINDS).toHaveLength(3);
    expect(isAmortizationKind('prepaid_expense')).toBe(true);
    expect(isAmortizationKind('nonsense')).toBe(false);
  });
});
