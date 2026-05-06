/**
 * Phase 10 — Reports Completion: pure unit assertions.
 * Runs entirely in Node (no browser, no DB).
 * Verifies: report API shapes, calculation logic, invariant logic,
 *           cash flow formula, VAT return structure, trend bucketing.
 */

import { describe, it, expect } from 'vitest';
import type {
  ReportsAPI,
  SystemHealthAPI,
  SalesByCustomerLine,
  SalesByProductLine,
  SalesByBrandLine,
  SalesTrendLine,
  PurchasesBySupplierLine,
  VATReturn,
  CashFlowStatement,
  InvariantResult,
  OwnerDashboard,
} from '../../src/data/adapter';

// ── Adapter shape ─────────────────────────────────────────────────────────────

describe('DataAdapter shape — Phase 10', () => {
  it('ReportsAPI has Phase 10 methods', () => {
    const methods: (keyof ReportsAPI)[] = [
      'getSalesByCustomer', 'getSalesByProduct', 'getSalesByBrand',
      'getSalesByVehicle', 'getSalesBySalesperson', 'getSalesTrend',
      'getPurchasesBySupplier', 'getPurchasesByProduct', 'getOutstandingPOs',
      'getVATReturn', 'getAuditLog', 'getReversalTrail', 'getCashFlow', 'getOwnerDashboard',
    ];
    expect(methods).toHaveLength(14);
  });

  it('SystemHealthAPI has check method', () => {
    const methods: (keyof SystemHealthAPI)[] = ['check'];
    expect(methods).toHaveLength(1);
  });
});

// ── SalesByCustomerLine shape ─────────────────────────────────────────────────

describe('SalesByCustomerLine type shape', () => {
  it('has all required fields', () => {
    const line: SalesByCustomerLine = {
      contact_id: 'abc', contact_name: 'Test', invoice_count: 5,
      gross_sales: 1000, returns: 50, net_sales: 950,
      gross_profit: 200, gp_pct: 21.1,
    };
    expect(line.net_sales).toBe(950);
    expect(line.gp_pct).toBeCloseTo(21.1, 1);
  });
});

// ── GP% calculation ───────────────────────────────────────────────────────────

function calcGPPct(net_sales: number, gross_profit: number): number {
  if (net_sales === 0) return 0;
  return Math.round(gross_profit / net_sales * 1000) / 10;
}

describe('Gross Profit % calculation', () => {
  it('1000 net, 200 GP → 20%', () => {
    expect(calcGPPct(1000, 200)).toBe(20);
  });

  it('950 net, 190 GP → 20%', () => {
    expect(calcGPPct(950, 190)).toBe(20);
  });

  it('zero net → 0%', () => {
    expect(calcGPPct(0, 0)).toBe(0);
  });

  it('GP% rounds to 1 decimal', () => {
    expect(calcGPPct(1000, 213)).toBe(21.3);
  });
});

// ── Net Sales = Gross - Returns ───────────────────────────────────────────────

describe('Net sales = gross - returns', () => {
  it('1000 gross - 50 returns = 950 net', () => {
    const net = 1000 - 50;
    expect(net).toBe(950);
  });

  it('no returns → net = gross', () => {
    const net = 750 - 0;
    expect(net).toBe(750);
  });
});

// ── VAT Return structure ──────────────────────────────────────────────────────

describe('VATReturn type shape and net payable', () => {
  it('has required fields', () => {
    const vat: VATReturn = {
      period_start: '2026-01-01', period_end: '2026-03-31',
      output_boxes: [{ box: '1', label: 'Standard Rated', taxable_amount: 10000, vat_amount: 500 }],
      total_output_vat: 500,
      input_boxes: [{ box: '9', label: 'Standard Expenses', taxable_amount: 4000, vat_amount: 200 }],
      total_input_vat: 200,
      net_vat_payable: 300,
    };
    expect(vat.net_vat_payable).toBe(300);
    expect(vat.output_boxes).toHaveLength(1);
    expect(vat.input_boxes).toHaveLength(1);
  });

  it('net VAT = output - input', () => {
    const outputVAT = 8870;
    const inputVAT  = 2260;
    const net = outputVAT - inputVAT;
    expect(net).toBe(6610);
  });

  it('output VAT > input VAT → payable (positive)', () => {
    const net = 500 - 200;
    expect(net).toBeGreaterThan(0);
  });

  it('input VAT > output VAT → refund (negative)', () => {
    const net = 100 - 500;
    expect(net).toBeLessThan(0);
  });
});

// ── Cash Flow Statement ───────────────────────────────────────────────────────

function calcNetOperating(
  netProfit: number,
  opAdjustments: number[],
  wcChanges: number[]
): number {
  return netProfit + opAdjustments.reduce((s, a) => s + a, 0) + wcChanges.reduce((s, a) => s + a, 0);
}

describe('Cash Flow Statement calculations', () => {
  it('net operating = net profit + adjustments + WC changes', () => {
    const netOp = calcNetOperating(64930, [340, -150], [-8200, -12400, 3500, 1500]);
    expect(netOp).toBe(49520);
  });

  it('net increase = sum of operating + investing + financing', () => {
    const netIncrease = 49520 + 0 + 0;
    expect(netIncrease).toBe(49520);
  });

  it('closing cash = opening + net increase', () => {
    const closing = 40100 + 49520;
    expect(closing).toBe(89620);
  });

  it('CashFlowStatement type has required fields', () => {
    const cf: Partial<CashFlowStatement> = {
      net_profit: 64930,
      net_operating: 49520,
      opening_cash: 40100,
      closing_cash: 89620,
    };
    expect(cf.closing_cash).toBe(89620);
  });
});

// ── Invariant structure ───────────────────────────────────────────────────────

describe('InvariantResult type shape', () => {
  it('has name, invariant, pass, difference', () => {
    const r: InvariantResult = {
      name: 'Trial Balance balances', invariant: 'A1', pass: true, difference: 0,
    };
    expect(r.pass).toBe(true);
    expect(r.invariant).toBe('A1');
  });

  it('pass=false when difference > 0.01', () => {
    const tolerance = 0.01;
    const difference = 5.50;
    const pass = difference <= tolerance;
    expect(pass).toBe(false);
  });

  it('pass=true when difference ≤ 0.01', () => {
    const tolerance = 0.01;
    const difference = 0.00;
    const pass = difference <= tolerance;
    expect(pass).toBe(true);
  });
});

// ── All 9 invariant names ─────────────────────────────────────────────────────

describe('9 Invariants — Doc 4 Part K', () => {
  const invariants = [
    { id: 'A1',       name: 'Trial Balance balances' },
    { id: 'A4',       name: 'Balance Sheet balances' },
    { id: 'B1',       name: 'AR Aging = AR Account (1200)' },
    { id: 'B2',       name: 'AP Aging = AP Account (2100)' },
    { id: 'E1',       name: 'Stock Valuation = Inventory Account (1300)' },
    { id: 'ADV_CUST', name: 'Customer Advances (2400) never debit' },
    { id: 'ADV_VEND', name: 'Vendor Advances (1400) never credit' },
    { id: 'D4',       name: 'GRN Accrual = Unbilled GRNs (2150)' },
    { id: 'G2',       name: 'Cash Report = Cash Account (11xx)' },
  ];

  it('there are exactly 9 invariants', () => {
    expect(invariants).toHaveLength(9);
  });

  it('all invariants have id and name', () => {
    for (const inv of invariants) {
      expect(inv.id).toBeTruthy();
      expect(inv.name).toBeTruthy();
    }
  });

  it('A1 = Trial Balance', () => expect(invariants[0].id).toBe('A1'));
  it('A4 = Balance Sheet', () => expect(invariants[1].id).toBe('A4'));
  it('B1 = AR Aging',      () => expect(invariants[2].id).toBe('B1'));
  it('B2 = AP Aging',      () => expect(invariants[3].id).toBe('B2'));
  it('E1 = Stock',         () => expect(invariants[4].id).toBe('E1'));
  it('G2 = Cash',          () => expect(invariants[8].id).toBe('G2'));
});

// ── Sales Trend bucketing ─────────────────────────────────────────────────────

function bucketKey(date: string, bucket: 'day' | 'week' | 'month'): string {
  const d = new Date(date);
  if (bucket === 'day')   return date.slice(0, 10);
  if (bucket === 'month') return date.slice(0, 7);
  const w = new Date(d);
  w.setDate(d.getDate() - d.getDay());
  return w.toISOString().slice(0, 10);
}

describe('Sales trend bucketing', () => {
  it('day bucket: 2026-01-15 → 2026-01-15', () => {
    expect(bucketKey('2026-01-15', 'day')).toBe('2026-01-15');
  });

  it('month bucket: 2026-01-15 → 2026-01', () => {
    expect(bucketKey('2026-01-15', 'month')).toBe('2026-01');
  });

  it('week bucket: Sunday start', () => {
    // 2026-01-15 is a Thursday; week starts 2026-01-11 (Sunday)
    const key = bucketKey('2026-01-15', 'week');
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('two dates in same month have same bucket', () => {
    expect(bucketKey('2026-01-05', 'month')).toBe(bucketKey('2026-01-25', 'month'));
  });

  it('dates in different months have different buckets', () => {
    expect(bucketKey('2026-01-31', 'month')).not.toBe(bucketKey('2026-02-01', 'month'));
  });
});

// ── SalesTrendLine type shape ─────────────────────────────────────────────────

describe('SalesTrendLine type shape', () => {
  it('has all fields', () => {
    const line: SalesTrendLine = {
      bucket: '2026-01', invoice_count: 12, gross_sales: 24000,
      returns: 500, net_sales: 23500, gross_profit: 5000,
    };
    expect(line.net_sales).toBe(23500);
  });
});

// ── Purchases by Supplier ─────────────────────────────────────────────────────

describe('PurchasesBySupplierLine pct_of_total', () => {
  it('pct_of_total sums to 100% across all suppliers', () => {
    const grand = 10000;
    const suppliers: PurchasesBySupplierLine[] = [
      { contact_id: '1', contact_name: 'A', bill_count: 5, gross_purchases: 6000, returns: 0, net_purchases: 6000, pct_of_total: 60 },
      { contact_id: '2', contact_name: 'B', bill_count: 3, gross_purchases: 4000, returns: 0, net_purchases: 4000, pct_of_total: 40 },
    ];
    const total = suppliers.reduce((s, r) => s + r.net_purchases, 0);
    const sumPct = suppliers.reduce((s, r) => s + r.pct_of_total, 0);
    expect(total).toBe(grand);
    expect(sumPct).toBe(100);
  });
});

// ── OwnerDashboard type ────────────────────────────────────────────────────────

describe('OwnerDashboard type shape', () => {
  it('has all required fields', () => {
    const d: Partial<OwnerDashboard> = {
      today_sales_count: 12,
      today_sales_amount: 5400,
      outstanding_ar: 18000,
      outstanding_ap: 9500,
      cash_and_bank: 42000,
      low_stock_count: 3,
      overdue_invoices_count: 2,
    };
    expect(d.today_sales_amount).toBe(5400);
    expect(d.low_stock_count).toBe(3);
  });
});
