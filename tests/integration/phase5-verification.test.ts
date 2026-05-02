/**
 * Phase 5 Verification Test
 *
 * Tests the Purchase Loop core logic:
 *   1–6.   calcPurchaseLine — arithmetic for purchase line item totals
 *   7–11.  calcMAC — weighted-average cost calculation
 *   12-13. calcMACAfterVariance — cost adjustment after bill variance
 *   14-17. apAgingBucket — AP aging day classification
 *   18-20. DataAdapter shape — Phase 5 API keys present
 *   21-23. Result type shapes — GRNConfirmResult, BillConfirmResult, ApplyVendorAdvanceResult
 *
 * All 23 assertions are pure unit tests (no DB required).
 *
 * Run with: npm run test:phase5
 */

import { describe, it, expect } from 'vitest';
import {
  calcPurchaseLine,
  calcPurchaseHeaderTotals,
  calcMAC,
  calcMACAfterVariance,
  apAgingBucket,
} from '../../src/core/purchasing/purchase-calc';
import type {
  DataAdapter,
  GRNConfirmResult,
  BillConfirmResult,
  ApplyVendorAdvanceResult,
} from '../../src/data/adapter';

// ── 1–6. calcPurchaseLine ─────────────────────────────────────────────────────
describe('Phase 5 — calcPurchaseLine', () => {
  it('1: no discount, no tax → total equals qty * cost', () => {
    const r = calcPurchaseLine({ quantity: 10, unit_cost: 50, discount_percent: 0, tax_rate: 0 });
    expect(r.line_subtotal).toBe(500);
    expect(r.discount_amount).toBe(0);
    expect(r.tax_amount).toBe(0);
    expect(r.line_total).toBe(500);
  });

  it('2: 10% discount, no tax → discount applied correctly', () => {
    const r = calcPurchaseLine({ quantity: 4, unit_cost: 100, discount_percent: 10, tax_rate: 0 });
    expect(r.line_subtotal).toBe(400);
    expect(r.discount_amount).toBe(40);
    expect(r.line_total).toBe(360);
  });

  it('3: no discount, 5% VAT → tax on full subtotal', () => {
    const r = calcPurchaseLine({ quantity: 2, unit_cost: 200, discount_percent: 0, tax_rate: 5 });
    expect(r.line_subtotal).toBe(400);
    expect(r.tax_amount).toBe(20);
    expect(r.line_total).toBe(420);
  });

  it('4: 10% discount then 5% VAT → tax on discounted net', () => {
    const r = calcPurchaseLine({ quantity: 5, unit_cost: 100, discount_percent: 10, tax_rate: 5 });
    // subtotal=500, disc=50, net=450, tax=22.5, total=472.5
    expect(r.discount_amount).toBe(50);
    expect(r.tax_amount).toBe(22.5);
    expect(r.line_total).toBe(472.5);
  });

  it('5: zero quantity → all zeros', () => {
    const r = calcPurchaseLine({ quantity: 0, unit_cost: 999, discount_percent: 15, tax_rate: 5 });
    expect(r.line_subtotal).toBe(0);
    expect(r.line_total).toBe(0);
  });

  it('6: calcPurchaseHeaderTotals sums multiple lines', () => {
    const l1 = calcPurchaseLine({ quantity: 3, unit_cost: 100, discount_percent: 0,  tax_rate: 5 }); // total=315
    const l2 = calcPurchaseLine({ quantity: 2, unit_cost: 50,  discount_percent: 10, tax_rate: 5 }); // total=94.5
    const h = calcPurchaseHeaderTotals([l1, l2]);
    expect(h.subtotal).toBe(400);
    expect(h.discount_amount).toBe(10);
    expect(h.tax_amount).toBeCloseTo(19.5, 2);
    expect(h.total_amount).toBeCloseTo(409.5, 2);
  });
});

// ── 7–11. calcMAC ─────────────────────────────────────────────────────────────
describe('Phase 5 — calcMAC (weighted-average cost)', () => {
  it('7: no existing stock → new cost becomes MAC', () => {
    expect(calcMAC(0, 0, 75, 10)).toBe(75);
  });

  it('8: equal quantities, different costs → average of two costs', () => {
    expect(calcMAC(50, 10, 70, 10)).toBe(60);
  });

  it('9: larger existing qty pulls MAC toward old cost', () => {
    // oldMAC=50 × 90 + newCost=80 × 10 / 100 = (4500+800)/100 = 53
    expect(calcMAC(50, 90, 80, 10)).toBe(53);
  });

  it('10: both qtys zero → returns 0', () => {
    expect(calcMAC(100, 0, 100, 0)).toBe(0);
  });

  it('11: single-unit receive onto existing stock', () => {
    // oldMAC=100 × 9 + newCost=190 × 1 / 10 = (900+190)/10 = 109
    expect(calcMAC(100, 9, 190, 1)).toBe(109);
  });
});

// ── 12–13. calcMACAfterVariance ───────────────────────────────────────────────
describe('Phase 5 — calcMACAfterVariance', () => {
  it('12: positive variance (bill > GRN) raises MAC', () => {
    // currentMAC=50 × 100 units + 200 variance = 5200 / 100 = 52
    expect(calcMACAfterVariance(50, 100, 200)).toBe(52);
  });

  it('13: negative variance (credit note) lowers MAC', () => {
    // currentMAC=50 × 100 + (-100 variance) = 4900 / 100 = 49
    expect(calcMACAfterVariance(50, 100, -100)).toBe(49);
  });
});

// ── 14–17. apAgingBucket ─────────────────────────────────────────────────────
describe('Phase 5 — apAgingBucket', () => {
  it('14: not yet due → current bucket', () => {
    expect(apAgingBucket('2026-06-01', '2026-05-15')).toBe('current');
  });

  it('15: 30 days past due → current bucket boundary', () => {
    expect(apAgingBucket('2026-04-15', '2026-05-15')).toBe('current');
  });

  it('16: 45 days past due → 31_60 bucket', () => {
    expect(apAgingBucket('2026-04-01', '2026-05-16')).toBe('31_60');
  });

  it('17: 95 days past due → over_90 bucket', () => {
    expect(apAgingBucket('2026-02-09', '2026-05-15')).toBe('over_90');
  });
});

// ── 18–20. DataAdapter interface completeness ─────────────────────────────────
describe('Phase 5 — DataAdapter interface completeness', () => {
  it('18: adapter has purchaseOrders API', () => {
    const _check: keyof DataAdapter = 'purchaseOrders';
    expect(_check).toBe('purchaseOrders');
  });

  it('19: adapter has goodsReceipts API', () => {
    const _check: keyof DataAdapter = 'goodsReceipts';
    expect(_check).toBe('goodsReceipts');
  });

  it('20: adapter has vendorBills API', () => {
    const _check: keyof DataAdapter = 'vendorBills';
    expect(_check).toBe('vendorBills');
  });
});

// ── 21–23. Result type shapes ─────────────────────────────────────────────────
describe('Phase 5 — Result type shapes', () => {
  it('21: GRNConfirmResult has all 4 required fields', () => {
    const result: GRNConfirmResult = {
      grn_id:       'grn-1',
      grn_number:   'GRN-1001',
      je_id:        'je-1',
      entry_number: 'JE-2001',
    };
    expect(result.grn_id).toBe('grn-1');
    expect(result.grn_number).toBe('GRN-1001');
    expect(result.je_id).toBe('je-1');
    expect(result.entry_number).toBe('JE-2001');
  });

  it('22: BillConfirmResult has all 4 required fields', () => {
    const result: BillConfirmResult = {
      bill_id:      'bill-1',
      bill_number:  'BILL-1001',
      je_id:        'je-2',
      entry_number: 'JE-2002',
    };
    expect(result.bill_id).toBe('bill-1');
    expect(result.bill_number).toBe('BILL-1001');
  });

  it('23: ApplyVendorAdvanceResult has all 5 required fields', () => {
    const result: ApplyVendorAdvanceResult = {
      je_id:        'je-3',
      entry_number: 'JE-2003',
      payment_id:   'pmt-1',
      bill_id:      'bill-1',
      amount:       1500,
    };
    expect(result.amount).toBe(1500);
    expect(result.payment_id).toBe('pmt-1');
    expect(result.bill_id).toBe('bill-1');
  });
});
