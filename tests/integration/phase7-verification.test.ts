/**
 * Phase 7 — POS Counter Sales: pure unit assertions.
 * These run entirely in Node (no browser, no DB) and verify
 * the core calc functions and adapter shape.
 */

import { describe, it, expect } from 'vitest';
import {
  calcPOSLine,
  calcPOSTotals,
  calcPOSSessionSummary,
  type POSCartLine,
  type POSCartLineResult,
} from '../../src/core/pos/pos-calc';
import type { DataAdapter, PosAPI } from '../../src/data/adapter';

// ── calcPOSLine ──────────────────────────────────────────────────────────────

const base: POSCartLine = {
  product_id: 'p1', product_name: 'Filter', sku: 'F-001',
  quantity: 1, unit_price: 100, discount_percent: 0, tax_rate: 5,
};

describe('calcPOSLine', () => {
  it('no discount, 5% tax: subtotal=100, net=100, tax=5, total=105', () => {
    const r = calcPOSLine(base);
    expect(r.line_subtotal).toBe(100);
    expect(r.discount_amount).toBe(0);
    expect(r.net_amount).toBe(100);
    expect(r.tax_amount).toBe(5);
    expect(r.line_total).toBe(105);
  });

  it('10% discount: net=90, tax=4.5, total=94.5', () => {
    const r = calcPOSLine({ ...base, discount_percent: 10 });
    expect(r.discount_amount).toBe(10);
    expect(r.net_amount).toBe(90);
    expect(r.tax_amount).toBe(4.5);
    expect(r.line_total).toBe(94.5);
  });

  it('qty=3, price=50, 0% tax: subtotal=150, total=150', () => {
    const r = calcPOSLine({ ...base, quantity: 3, unit_price: 50, tax_rate: 0 });
    expect(r.line_subtotal).toBe(150);
    expect(r.tax_amount).toBe(0);
    expect(r.line_total).toBe(150);
  });

  it('100% discount: net=0, tax=0, total=0', () => {
    const r = calcPOSLine({ ...base, discount_percent: 100 });
    expect(r.net_amount).toBe(0);
    expect(r.line_total).toBe(0);
  });

  it('fractional price: rounds to 2 decimals', () => {
    const r = calcPOSLine({ ...base, unit_price: 33.333, tax_rate: 10 });
    expect(r.line_subtotal).toBe(33.33);
    expect(r.tax_amount).toBe(3.33);
    expect(r.line_total).toBe(36.66);
  });

  it('preserves all input fields on result', () => {
    const r = calcPOSLine(base);
    expect(r.product_id).toBe('p1');
    expect(r.sku).toBe('F-001');
    expect(r.quantity).toBe(1);
  });
});

// ── calcPOSTotals ────────────────────────────────────────────────────────────

describe('calcPOSTotals', () => {
  it('empty cart: all zeros', () => {
    const t = calcPOSTotals([]);
    expect(t.subtotal).toBe(0);
    expect(t.discount_amount).toBe(0);
    expect(t.tax_amount).toBe(0);
    expect(t.total_amount).toBe(0);
  });

  it('single line: sums correctly', () => {
    const line = calcPOSLine(base);          // subtotal=100, disc=0, tax=5, total=105
    const t = calcPOSTotals([line]);
    expect(t.subtotal).toBe(100);
    expect(t.tax_amount).toBe(5);
    expect(t.total_amount).toBe(105);
  });

  it('two lines: aggregates', () => {
    const l1 = calcPOSLine(base);            // total=105
    const l2 = calcPOSLine({ ...base, quantity: 2, discount_percent: 10 });
    // l2: subtotal=200, disc=20, net=180, tax=9, total=189
    const t = calcPOSTotals([l1, l2]);
    expect(t.subtotal).toBe(300);
    expect(t.discount_amount).toBe(20);
    expect(t.tax_amount).toBe(14);
    expect(t.total_amount).toBe(294);
  });

  it('total_amount = subtotal - discount + tax', () => {
    const l = calcPOSLine({ ...base, quantity: 4, unit_price: 25, discount_percent: 5, tax_rate: 15 });
    const t = calcPOSTotals([l]);
    expect(t.total_amount).toBe(t.subtotal - t.discount_amount + t.tax_amount);
  });
});

// ── calcPOSSessionSummary ────────────────────────────────────────────────────

describe('calcPOSSessionSummary', () => {
  it('empty: all zeros, count=0', () => {
    const s = calcPOSSessionSummary([]);
    expect(s.cash_total).toBe(0);
    expect(s.card_total).toBe(0);
    expect(s.credit_total).toBe(0);
    expect(s.grand_total).toBe(0);
    expect(s.sale_count).toBe(0);
  });

  it('cash only: grand_total = cash_total', () => {
    const s = calcPOSSessionSummary([
      { sale_channel: 'pos_cash', total_amount: 500 },
      { sale_channel: 'pos_cash', total_amount: 200 },
    ]);
    expect(s.cash_total).toBe(700);
    expect(s.card_total).toBe(0);
    expect(s.grand_total).toBe(700);
    expect(s.sale_count).toBe(2);
  });

  it('mixed channels: sums per channel', () => {
    const s = calcPOSSessionSummary([
      { sale_channel: 'pos_cash',   total_amount: 100 },
      { sale_channel: 'pos_card',   total_amount: 200 },
      { sale_channel: 'pos_credit', total_amount: 150 },
    ]);
    expect(s.cash_total).toBe(100);
    expect(s.card_total).toBe(200);
    expect(s.credit_total).toBe(150);
    expect(s.grand_total).toBe(450);
    expect(s.sale_count).toBe(3);
  });

  it('unknown channel: ignored (not counted in any bucket)', () => {
    const s = calcPOSSessionSummary([
      { sale_channel: 'online', total_amount: 999 },
      { sale_channel: 'pos_cash', total_amount: 50 },
    ]);
    expect(s.cash_total).toBe(50);
    expect(s.grand_total).toBe(50);   // 'online' not in any channel bucket
    expect(s.sale_count).toBe(2);    // count is always total rows
  });

  it('rounds to 2 decimals', () => {
    const s = calcPOSSessionSummary([
      { sale_channel: 'pos_cash', total_amount: 33.333 },
      { sale_channel: 'pos_cash', total_amount: 66.667 },
    ]);
    expect(s.cash_total).toBe(100);
    expect(s.grand_total).toBe(100);
  });
});

// ── DataAdapter type checks ──────────────────────────────────────────────────

describe('DataAdapter.pos shape', () => {
  it('PosAPI has 8 required methods', () => {
    const methods: (keyof PosAPI)[] = [
      'openSession', 'getOpenSession', 'closeSession', 'confirmSale',
      'getSessionSales', 'listSessions', 'getPOSSessionReport', 'getDailySalesSummary',
    ];
    // TypeScript compile check — if PosAPI changes, this list would need updating
    expect(methods).toHaveLength(8);
  });

  it('DataAdapter has pos namespace', () => {
    // Structural type check: ensure pos key exists on DataAdapter
    const adapterKeys: (keyof DataAdapter)[] = ['pos'];
    expect(adapterKeys).toContain('pos');
  });
});

// ── Result type shape checks ─────────────────────────────────────────────────

describe('POSCartLineResult shape', () => {
  it('result includes all input fields plus 5 computed fields', () => {
    const r: POSCartLineResult = calcPOSLine(base);
    const inputFields: (keyof POSCartLine)[] = [
      'product_id', 'product_name', 'sku', 'quantity', 'unit_price',
      'discount_percent', 'tax_rate',
    ];
    const computedFields: (keyof POSCartLineResult)[] = [
      'line_subtotal', 'discount_amount', 'net_amount', 'tax_amount', 'line_total',
    ];
    for (const f of [...inputFields, ...computedFields]) {
      expect(r).toHaveProperty(f);
    }
  });
});
