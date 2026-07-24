/**
 * AC-2A — unit tests for the comparative pure logic (no DB, no React).
 * Run: npx vitest run tests/unit/comparative.test.ts
 */
import { describe, it, expect } from 'vitest';
import type { ProfitAndLoss, BalanceSheet, TrialBalance } from '../../src/data/adapter';
import {
  shiftMonthsISO, shiftYearsISO, fiscalYearStartOnOrBefore, fiscalYearWindow,
  resolveComparativeRange, resolveComparativeAsOf,
  computeVariance, variancePct, formatVariancePct, makeValue,
  mergeComparativeProfitAndLoss, mergeComparativeBalanceSheet, mergeComparativeTrialBalance,
} from '../../src/lib/comparative';

// ── Variance % rule (the AC-2A requirement) ─────────────────────────────────
describe('formatVariancePct — the three-state rule', () => {
  it('previous 0 & current 0 → "—"', () => {
    expect(formatVariancePct(0, 0)).toBe('—');
  });
  it('previous 0 & current ≠ 0 → "New"', () => {
    expect(formatVariancePct(500, 0)).toBe('New');
    expect(formatVariancePct(-500, 0)).toBe('New');
  });
  it('otherwise → signed percentage', () => {
    expect(formatVariancePct(120, 100)).toBe('+20.0%');
    expect(formatVariancePct(80, 100)).toBe('−20.0%');
    expect(formatVariancePct(100, 100)).toBe('0.0%');
  });
  it('uses |previous| so a negative base reads intuitively', () => {
    // (−50 − (−100)) / |−100| = +50%
    expect(formatVariancePct(-50, -100)).toBe('+50.0%');
  });
});

describe('variance numerics', () => {
  it('computeVariance = current − previous (rounded to cents)', () => {
    expect(computeVariance(120, 100)).toBe(20);
    expect(computeVariance(3.03, 3)).toBe(0.03);
  });
  it('variancePct is null when previous is 0, else rounded %', () => {
    expect(variancePct(500, 0)).toBeNull();
    expect(variancePct(0, 0)).toBeNull();
    expect(variancePct(120, 100)).toBe(20);
  });
  it('makeValue packs current/previous/variance/variance_pct', () => {
    expect(makeValue(120, 100)).toEqual({ current: 120, previous: 100, variance: 20, variance_pct: 20 });
    expect(makeValue(500, 0)).toEqual({ current: 500, previous: 0, variance: 500, variance_pct: null });
    expect(makeValue(100, 100)).toEqual({ current: 100, previous: 100, variance: 0, variance_pct: 0 });
  });
});

// ── Date math ────────────────────────────────────────────────────────────────
describe('month/year shift with day clamping', () => {
  it('clamps day-of-month on shorter target months', () => {
    expect(shiftMonthsISO('2026-03-31', -1)).toBe('2026-02-28');
    expect(shiftMonthsISO('2024-03-31', -1)).toBe('2024-02-29'); // leap year
    expect(shiftMonthsISO('2026-01-15', -1)).toBe('2025-12-15'); // crosses year
  });
  it('year shift clamps Feb 29 to Feb 28 in a non-leap year', () => {
    expect(shiftYearsISO('2024-02-29', -1)).toBe('2023-02-28');
    expect(shiftYearsISO('2026-07-24', -1)).toBe('2025-07-24');
  });
});

describe('fiscal-year helpers', () => {
  it('fiscalYearStartOnOrBefore finds the current fiscal-year start', () => {
    expect(fiscalYearStartOnOrBefore('2026-07-24', '2021-04-01')).toBe('2026-04-01');
    expect(fiscalYearStartOnOrBefore('2026-02-10', '2021-04-01')).toBe('2025-04-01'); // before Apr → prior FY
    expect(fiscalYearStartOnOrBefore('2026-07-24', '2021-01-01')).toBe('2026-01-01'); // Jan-1 == calendar
  });
  it('fiscalYearWindow spans start..start+1yr−1day', () => {
    expect(fiscalYearWindow('2025-12-31', '2021-04-01')).toEqual({ from: '2025-04-01', to: '2026-03-31' });
    expect(fiscalYearWindow('2026-05-01', '2021-01-01')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });
});

// ── resolveComparativeRange (P&L) ────────────────────────────────────────────
describe('resolveComparativeRange', () => {
  const cur = { from: '2026-03-01', to: '2026-03-15' };

  it('this_month · previous_period → preceding month, same span', () => {
    expect(resolveComparativeRange(cur, 'this_month', 'previous_period')).toEqual({
      current: cur, previous: { from: '2026-02-01', to: '2026-02-15' },
    });
  });
  it('this_month · previous_year → same month last year', () => {
    expect(resolveComparativeRange(cur, 'this_month', 'previous_year')).toEqual({
      current: cur, previous: { from: '2025-03-01', to: '2025-03-15' },
    });
  });
  it('this_quarter · previous_period → −3 months', () => {
    const q = { from: '2026-07-01', to: '2026-07-24' };
    expect(resolveComparativeRange(q, 'this_quarter', 'previous_period').previous).toEqual({ from: '2026-04-01', to: '2026-04-24' });
  });
  it('custom · previous_period → equal-length window ending the day before', () => {
    const c = { from: '2026-01-10', to: '2026-01-20' }; // 11 inclusive days
    expect(resolveComparativeRange(c, 'custom', 'previous_period').previous).toEqual({ from: '2025-12-30', to: '2026-01-09' });
  });
  it('custom · previous_year → shifted back one year', () => {
    const c = { from: '2026-01-10', to: '2026-01-20' };
    expect(resolveComparativeRange(c, 'custom', 'previous_year').previous).toEqual({ from: '2025-01-10', to: '2025-01-20' });
  });

  it('this_year is fiscal-aware: re-anchors current to the fiscal year (Apr-1 start)', () => {
    const calYtd = { from: '2026-01-01', to: '2026-07-24' }; // what the calendar picker gives
    const r = resolveComparativeRange(calYtd, 'this_year', 'previous_period', '2021-04-01');
    expect(r.current).toEqual({ from: '2026-04-01', to: '2026-07-24' });   // fiscal YTD
    expect(r.previous).toEqual({ from: '2025-04-01', to: '2025-07-24' });
  });
  it('this_year with a Jan-1 fiscal start equals the calendar year', () => {
    const calYtd = { from: '2026-01-01', to: '2026-07-24' };
    const r = resolveComparativeRange(calYtd, 'this_year', 'previous_period', '2021-01-01');
    expect(r.current).toEqual(calYtd);
    expect(r.previous).toEqual({ from: '2025-01-01', to: '2025-07-24' });
  });
  it('this_year without a fiscal start does not re-anchor', () => {
    const calYtd = { from: '2026-01-01', to: '2026-07-24' };
    const r = resolveComparativeRange(calYtd, 'this_year', 'previous_period');
    expect(r.current).toEqual(calYtd);
    expect(r.previous).toEqual({ from: '2025-01-01', to: '2025-07-24' });
  });
  it('last_year is the full prior fiscal year (Apr-1 start)', () => {
    const calLast = { from: '2025-01-01', to: '2025-12-31' };
    const r = resolveComparativeRange(calLast, 'last_year', 'previous_period', '2021-04-01');
    expect(r.current).toEqual({ from: '2025-04-01', to: '2026-03-31' });
    expect(r.previous).toEqual({ from: '2024-04-01', to: '2025-03-31' });
  });
});

// ── resolveComparativeAsOf (BS / TB) ─────────────────────────────────────────
describe('resolveComparativeAsOf', () => {
  it('previous_period shifts by the preset period length', () => {
    expect(resolveComparativeAsOf('2026-03-15', 'this_month', 'previous_period')).toEqual({ current: '2026-03-15', previous: '2026-02-15' });
    expect(resolveComparativeAsOf('2026-07-24', 'this_quarter', 'previous_period').previous).toBe('2026-04-24');
    expect(resolveComparativeAsOf('2026-07-24', 'this_year', 'previous_period').previous).toBe('2025-07-24');
  });
  it('custom as-of defaults to prior-year comparison', () => {
    expect(resolveComparativeAsOf('2026-07-24', 'custom', 'previous_period').previous).toBe('2025-07-24');
  });
  it('previous_year always shifts back one year', () => {
    expect(resolveComparativeAsOf('2026-03-15', 'this_month', 'previous_year').previous).toBe('2025-03-15');
  });
});

// ── Merge factories ──────────────────────────────────────────────────────────
function pl(over: Partial<ProfitAndLoss>): ProfitAndLoss {
  return {
    period_start: '2026-01-01', period_end: '2026-12-31',
    revenue: 0, cogs: 0, gross_profit: 0, other_income: 0, operating_expenses: 0, net_profit: 0,
    lines: [], ...over,
  };
}
function bs(over: Partial<BalanceSheet>): BalanceSheet {
  return {
    as_of_date: '2026-12-31',
    total_assets: 0, total_liabilities: 0, total_equity: 0,
    current_assets: 0, fixed_assets: 0, current_liabilities: 0, long_term_liabilities: 0,
    working_capital: 0, lines: [], ...over,
  } as BalanceSheet;
}
function tb(over: Partial<TrialBalance>): TrialBalance {
  return { as_of_date: '2026-12-31', total_debit: 0, total_credit: 0, lines: [], ...over };
}

describe('mergeComparativeProfitAndLoss', () => {
  const cur = pl({
    revenue: 120000, net_profit: 60000,
    lines: [
      { account_code: '4100', account_name: 'Sales', account_type: 'income', sub_type: 'direct', amount: 120000 },
      { account_code: '6500', account_name: 'G&A', account_type: 'expense', sub_type: 'indirect', amount: 40000 },
    ],
  });
  const prev = pl({
    revenue: 100000, net_profit: 50000,
    lines: [
      { account_code: '4100', account_name: 'Sales', account_type: 'income', sub_type: 'direct', amount: 100000 },
      { account_code: '6600', account_name: 'Bank Charges', account_type: 'expense', sub_type: 'indirect', amount: 5000 },
    ],
  });

  it('joins by account_code and computes variance per line + totals', () => {
    const m = mergeComparativeProfitAndLoss(cur, prev);
    const sales = m.lines.find((l) => l.account_code === '4100')!;
    expect(sales).toMatchObject({ current: 120000, previous: 100000, variance: 20000, variance_pct: 20 });

    // account only in current → previous 0, variance% null (renders "New")
    const ga = m.lines.find((l) => l.account_code === '6500')!;
    expect(ga).toMatchObject({ current: 40000, previous: 0, variance: 40000, variance_pct: null });
    expect(formatVariancePct(ga.current, ga.previous)).toBe('New');

    // account only in previous → appears with current 0, appended after current lines
    const bank = m.lines.find((l) => l.account_code === '6600')!;
    expect(bank).toMatchObject({ current: 0, previous: 5000 });
    expect(m.lines[m.lines.length - 1].account_code).toBe('6600');

    expect(m.revenue).toMatchObject({ current: 120000, previous: 100000, variance: 20000 });
    expect(m.net_profit.variance).toBe(10000);
    expect(m.current_period).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('identical periods → zero variance everywhere', () => {
    const m = mergeComparativeProfitAndLoss(cur, cur);
    for (const l of m.lines) { expect(l.variance).toBe(0); expect(l.variance_pct).toBe(0); }
    expect(m.net_profit.variance).toBe(0);
  });
});

describe('mergeComparativeBalanceSheet', () => {
  it('merges balances and totals with variance', () => {
    const cur = bs({
      total_assets: 200000, total_equity: 150000,
      lines: [{ account_code: '1100', account_name: 'Cash', account_type: 'asset', sub_type: 'current', balance: 200000 }],
    });
    const prev = bs({
      as_of_date: '2025-12-31', total_assets: 160000, total_equity: 120000,
      lines: [{ account_code: '1100', account_name: 'Cash', account_type: 'asset', sub_type: 'current', balance: 160000 }],
    });
    const m = mergeComparativeBalanceSheet(cur, prev);
    expect(m.current_as_of).toBe('2026-12-31');
    expect(m.previous_as_of).toBe('2025-12-31');
    expect(m.total_assets).toMatchObject({ current: 200000, previous: 160000, variance: 40000, variance_pct: 25 });
    expect(m.lines[0]).toMatchObject({ account_code: '1100', current: 200000, previous: 160000, variance: 40000 });
  });
});

describe('mergeComparativeTrialBalance', () => {
  it('produces Dr/Cr per period + signed difference', () => {
    const cur = tb({
      total_debit: 500, total_credit: 500,
      lines: [
        { account_code: '1100', account_name: 'Cash', account_type: 'asset', debit: 500, credit: 0 },
        { account_code: '4100', account_name: 'Sales', account_type: 'income', debit: 0, credit: 500 },
      ],
    });
    const prev = tb({
      as_of_date: '2025-12-31', total_debit: 300, total_credit: 300,
      lines: [
        { account_code: '1100', account_name: 'Cash', account_type: 'asset', debit: 300, credit: 0 },
        { account_code: '2100', account_name: 'AP', account_type: 'liability', debit: 0, credit: 300 },
      ],
    });
    const m = mergeComparativeTrialBalance(cur, prev);
    const cash = m.lines.find((l) => l.account_code === '1100')!;
    expect(cash).toMatchObject({ current_debit: 500, previous_debit: 300, difference: 200 }); // (500) − (300)

    // account only in current
    const sales = m.lines.find((l) => l.account_code === '4100')!;
    expect(sales).toMatchObject({ current_credit: 500, previous_debit: 0, previous_credit: 0, difference: -500 });

    // account only in previous → appended, current side 0
    const ap = m.lines.find((l) => l.account_code === '2100')!;
    expect(ap).toMatchObject({ current_debit: 0, current_credit: 0, previous_credit: 300, difference: 300 });
    expect(m.lines[m.lines.length - 1].account_code).toBe('2100');

    expect(m.total_debit).toMatchObject({ current: 500, previous: 300, variance: 200 });
  });
});
