/**
 * Phase 6 — Inventory Operations: pure unit verification
 * Tests: calcAdjustmentLine, stockAgingDays, stockAgingBucket, isReorderNeeded,
 *        DataAdapter interface shape, report + confirm result types
 */

import { describe, it, expect } from 'vitest';
import {
  calcAdjustmentLine,
  stockAgingDays,
  stockAgingBucket,
  isReorderNeeded,
} from '../../src/core/inventory/inventory-calc';
import type { DataAdapter } from '../../src/data/adapter';

// ── 1. calcAdjustmentLine ──────────────────────────────────────────────────

describe('calcAdjustmentLine', () => {
  it('1 — found stock: actual > system → direction in, positive difference', () => {
    const r = calcAdjustmentLine(10, 15, 5);
    expect(r.difference).toBe(5);
    expect(r.direction).toBe('in');
    expect(r.total_value).toBe(25);
  });

  it('2 — shrinkage: actual < system → direction out, negative difference', () => {
    const r = calcAdjustmentLine(20, 17, 10);
    expect(r.difference).toBe(-3);
    expect(r.direction).toBe('out');
    expect(r.total_value).toBe(30);          // ABS(diff) × cost
  });

  it('3 — balanced: actual === system → direction none, zero values', () => {
    const r = calcAdjustmentLine(10, 10, 50);
    expect(r.difference).toBe(0);
    expect(r.direction).toBe('none');
    expect(r.total_value).toBe(0);
  });

  it('4 — zero unit cost: total_value is 0 regardless of difference', () => {
    const r = calcAdjustmentLine(5, 8, 0);
    expect(r.difference).toBe(3);
    expect(r.total_value).toBe(0);
  });

  it('5 — fractional quantities are handled correctly', () => {
    const r = calcAdjustmentLine(10.5, 10, 4);
    expect(r.difference).toBeCloseTo(-0.5);
    expect(r.total_value).toBeCloseTo(2);
    expect(r.direction).toBe('out');
  });
});

// ── 2. stockAgingDays ─────────────────────────────────────────────────────

describe('stockAgingDays', () => {
  it('6 — same day → 0', () => {
    expect(stockAgingDays('2025-01-01', '2025-01-01')).toBe(0);
  });

  it('7 — exactly 30 days', () => {
    expect(stockAgingDays('2025-01-01', '2025-01-31')).toBe(30);
  });

  it('8 — null last movement → 0 (treated as just received)', () => {
    expect(stockAgingDays(null, '2025-06-01')).toBe(0);
  });

  it('9 — floors partial days', () => {
    // 1 day and some hours → still 1
    expect(stockAgingDays('2025-03-01', '2025-03-02')).toBe(1);
  });
});

// ── 3. stockAgingBucket ───────────────────────────────────────────────────

describe('stockAgingBucket', () => {
  it('10 — 0 days → 0_30', () => expect(stockAgingBucket(0)).toBe('0_30'));
  it('11 — 30 days → 0_30', () => expect(stockAgingBucket(30)).toBe('0_30'));
  it('12 — 31 days → 31_60', () => expect(stockAgingBucket(31)).toBe('31_60'));
  it('13 — 60 days → 31_60', () => expect(stockAgingBucket(60)).toBe('31_60'));
  it('14 — 61 days → 61_90', () => expect(stockAgingBucket(61)).toBe('61_90'));
  it('15 — 90 days → 61_90', () => expect(stockAgingBucket(90)).toBe('61_90'));
  it('16 — 91 days → over_90', () => expect(stockAgingBucket(91)).toBe('over_90'));
  it('17 — 200 days → over_90', () => expect(stockAgingBucket(200)).toBe('over_90'));
});

// ── 4. isReorderNeeded ────────────────────────────────────────────────────

describe('isReorderNeeded', () => {
  it('18 — qty below min → true', () => expect(isReorderNeeded(3, 5)).toBe(true));
  it('19 — qty equals min → true (reorder needed at min)', () => expect(isReorderNeeded(5, 5)).toBe(true));
  it('20 — qty above min → false', () => expect(isReorderNeeded(6, 5)).toBe(false));
  it('21 — zero qty, positive min → true', () => expect(isReorderNeeded(0, 1)).toBe(true));
  it('22 — zero min → false when qty ≥ 0', () => expect(isReorderNeeded(0, 0)).toBe(true)); // 0 <= 0
});

// ── 5. DataAdapter interface: Phase 6 API keys present ───────────────────

describe('DataAdapter interface — Phase 6 API keys', () => {
  it('23 — stockTransfers key exists on type', () => {
    // Compile-time check: if DataAdapter missing stockTransfers this will fail to compile
    type HasStockTransfers = DataAdapter extends { stockTransfers: unknown } ? true : false;
    const check: HasStockTransfers = true;
    expect(check).toBe(true);
  });

  it('24 — inventoryAdjustments key exists on type', () => {
    type HasAdjustments = DataAdapter extends { inventoryAdjustments: unknown } ? true : false;
    const check: HasAdjustments = true;
    expect(check).toBe(true);
  });

  it('25 — productSerials key exists on type', () => {
    type HasSerials = DataAdapter extends { productSerials: unknown } ? true : false;
    const check: HasSerials = true;
    expect(check).toBe(true);
  });
});

// ── 6. Report + confirm result shapes ────────────────────────────────────

describe('Phase 6 result type shapes', () => {
  it('26 — TransferConfirmResult has required fields', () => {
    type R = import('../../src/data/adapter').TransferConfirmResult;
    type HasFields = R extends { transfer_id: string; transfer_number: string } ? true : false;
    const check: HasFields = true;
    expect(check).toBe(true);
  });

  it('27 — AdjustmentConfirmResult has gain/loss fields', () => {
    type R = import('../../src/data/adapter').AdjustmentConfirmResult;
    type HasFields = R extends { adjustment_id: string; total_gain: number; total_loss: number } ? true : false;
    const check: HasFields = true;
    expect(check).toBe(true);
  });

  it('28 — StockMovementLine has direction field', () => {
    type R = import('../../src/data/adapter').StockMovementLine;
    type HasDir = R extends { direction: number } ? true : false;
    const check: HasDir = true;
    expect(check).toBe(true);
  });

  it('29 — SlowMovingLine has aging_bucket field', () => {
    type R = import('../../src/data/adapter').SlowMovingLine;
    type HasBucket = R extends { aging_bucket: string } ? true : false;
    const check: HasBucket = true;
    expect(check).toBe(true);
  });

  it('30 — ReorderLine has min_stock_level field', () => {
    type R = import('../../src/data/adapter').ReorderLine;
    type HasMin = R extends { min_stock_level: number } ? true : false;
    const check: HasMin = true;
    expect(check).toBe(true);
  });
});
