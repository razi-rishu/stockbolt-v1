/**
 * AC-5A — unit tests for the depreciation math.
 * Run: npx vitest run tests/unit/depreciation.test.ts
 */
import { describe, it, expect } from 'vitest';
import { monthlyCharge, projectSchedule, type DepreciationAsset } from '../../src/lib/depreciation';

const sl = (over: Partial<DepreciationAsset> = {}): DepreciationAsset => ({
  cost: 12000, salvage_value: 0, useful_life_months: 12,
  method: 'straight_line', wdv_rate: 0, in_service_date: '2026-01-01', ...over,
});

describe('straight-line monthly charge', () => {
  it('full month = (cost − salvage) / life', () => {
    expect(monthlyCharge(sl(), '2026-02-28', 0)).toBe(1000);          // a later full month
    expect(monthlyCharge(sl(), '2026-01-31', 0)).toBe(1000);          // acquisition month, in service on the 1st
  });

  it('pro-rates the acquisition month by days in service', () => {
    // in service Jan 16 → 16 of 31 days → 1000 × 16/31
    expect(monthlyCharge(sl({ in_service_date: '2026-01-16' }), '2026-01-31', 0)).toBe(516.13);
  });

  it('honours salvage — the final charge is capped and then stops', () => {
    const a = sl({ cost: 1000, salvage_value: 100, useful_life_months: 3 }); // base 900, 300/mo
    expect(monthlyCharge(a, '2026-02-28', 800)).toBe(100);   // only 100 of depreciable base left
    expect(monthlyCharge(a, '2026-02-28', 900)).toBe(0);     // fully depreciated to salvage
  });

  it('is zero before the asset is in service', () => {
    expect(monthlyCharge(sl({ in_service_date: '2026-03-01' }), '2026-01-31', 0)).toBe(0);
  });
});

describe('reducing-balance (WDV) monthly charge', () => {
  const wdv = (over: Partial<DepreciationAsset> = {}): DepreciationAsset => ({
    cost: 10000, salvage_value: 0, useful_life_months: 0,
    method: 'reducing_balance', wdv_rate: 12, in_service_date: '2026-01-01', ...over,
  });
  it('charges the annual rate / 12 on the opening book value', () => {
    expect(monthlyCharge(wdv(), '2026-02-28', 0)).toBe(100);       // 10000 × 12%/12
    expect(monthlyCharge(wdv(), '2026-03-31', 100)).toBe(99);      // book value 9900 × 1%
  });
  it('pro-rates the acquisition month', () => {
    // in service Jan 16 → 100 × 16/31
    expect(monthlyCharge(wdv({ in_service_date: '2026-01-16' }), '2026-01-31', 0)).toBe(51.61);
  });
});

describe('projectSchedule', () => {
  it('straight-line fully depreciates over the life', () => {
    const rows = projectSchedule(sl({ cost: 1200, useful_life_months: 12 }));
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.charge === 100)).toBe(true);
    expect(rows[11].accumulated).toBe(1200);
    expect(rows[11].book_value).toBe(0);
  });

  it('never books below salvage', () => {
    const rows = projectSchedule(sl({ cost: 1000, salvage_value: 100, useful_life_months: 3 }));
    expect(rows[rows.length - 1].accumulated).toBe(900);
    expect(rows[rows.length - 1].book_value).toBe(100);
  });
});
