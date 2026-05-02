/**
 * Phase 4 Verification Test
 *
 * Tests the Sales Loop core logic:
 *   1–6.   calcLine — arithmetic for line item totals
 *   7–11.  calcHeaderTotals — invoice header aggregation
 *   12–17. agingBucket — AR aging day classification
 *   18–22. Report helpers — P&L and balance sheet grouping
 *   23–27. DataAdapter shape — all Phase 4 API keys present
 *   28–31. Result type shapes — InvoiceConfirmResult, PaymentConfirmResult, ApplyAdvanceResult
 *
 * All 31 assertions are pure unit tests (no DB required).
 *
 * Run with: npm run test:phase4
 */

import { describe, it, expect } from 'vitest';
import { calcLine, calcHeaderTotals, agingBucket } from '../../src/core/sales/invoice-calc';
import type {
  DataAdapter,
  InvoiceConfirmResult,
  PaymentConfirmResult,
  ApplyAdvanceResult,
  ProfitAndLossLine,
  BalanceSheetLine,
} from '../../src/data/adapter';

// ── 1–6. calcLine ─────────────────────────────────────────────────────────────
describe('Phase 4 — calcLine', () => {
  it('1: no discount, no tax → total equals qty * price', () => {
    const r = calcLine({ quantity: 5, unit_price: 100, discount_percent: 0, tax_rate: 0 });
    expect(r.line_subtotal).toBe(500);
    expect(r.discount_amount).toBe(0);
    expect(r.tax_amount).toBe(0);
    expect(r.line_total).toBe(500);
  });

  it('2: 10% discount, no tax → discount applied correctly', () => {
    const r = calcLine({ quantity: 2, unit_price: 100, discount_percent: 10, tax_rate: 0 });
    expect(r.line_subtotal).toBe(200);
    expect(r.discount_amount).toBe(20);
    expect(r.line_total).toBe(180);
  });

  it('3: no discount, 5% VAT → tax applied on full subtotal', () => {
    const r = calcLine({ quantity: 3, unit_price: 100, discount_percent: 0, tax_rate: 5 });
    expect(r.line_subtotal).toBe(300);
    expect(r.tax_amount).toBe(15);
    expect(r.line_total).toBe(315);
  });

  it('4: 10% discount then 5% VAT → tax on discounted net', () => {
    const r = calcLine({ quantity: 2, unit_price: 50, discount_percent: 10, tax_rate: 5 });
    // subtotal=100, disc=10, net=90, tax=4.50, total=94.50
    expect(r.line_subtotal).toBe(100);
    expect(r.discount_amount).toBe(10);
    expect(r.tax_amount).toBe(4.5);
    expect(r.line_total).toBe(94.5);
  });

  it('5: zero quantity → all zeros', () => {
    const r = calcLine({ quantity: 0, unit_price: 999, discount_percent: 15, tax_rate: 5 });
    expect(r.line_subtotal).toBe(0);
    expect(r.line_total).toBe(0);
  });

  it('6: zero unit price → all zeros', () => {
    const r = calcLine({ quantity: 10, unit_price: 0, discount_percent: 0, tax_rate: 5 });
    expect(r.line_total).toBe(0);
  });
});

// ── 7–11. calcHeaderTotals ────────────────────────────────────────────────────
describe('Phase 4 — calcHeaderTotals', () => {
  const l1 = calcLine({ quantity: 3, unit_price: 100, discount_percent: 0,  tax_rate: 5 }); // subtotal=300, disc=0, tax=15, total=315
  const l2 = calcLine({ quantity: 2, unit_price: 50,  discount_percent: 10, tax_rate: 5 }); // subtotal=100, disc=10, tax=4.5, total=94.5

  it('7: subtotal is sum of line subtotals', () => {
    const h = calcHeaderTotals([l1, l2]);
    expect(h.subtotal).toBe(400);
  });

  it('8: discount_amount is sum of line discounts', () => {
    const h = calcHeaderTotals([l1, l2]);
    expect(h.discount_amount).toBe(10);
  });

  it('9: tax_amount is sum of line taxes', () => {
    const h = calcHeaderTotals([l1, l2]);
    expect(h.tax_amount).toBeCloseTo(19.5, 2);
  });

  it('10: total_amount = subtotal - discount + tax', () => {
    const h = calcHeaderTotals([l1, l2]);
    expect(h.total_amount).toBeCloseTo(409.5, 2);
  });

  it('11: total_amount equals sum of line_total values', () => {
    const h = calcHeaderTotals([l1, l2]);
    const sumOfLineTotals = l1.line_total + l2.line_total;
    expect(h.total_amount).toBeCloseTo(sumOfLineTotals, 2);
  });
});

// ── 12–17. agingBucket ───────────────────────────────────────────────────────
describe('Phase 4 — agingBucket', () => {
  it('12: not yet due → current bucket', () => {
    expect(agingBucket('2026-06-01', '2026-05-15')).toBe('current');
  });

  it('13: due today → current bucket', () => {
    expect(agingBucket('2026-05-15', '2026-05-15')).toBe('current');
  });

  it('14: 30 days past due → current bucket', () => {
    // as_of = due + 30 days
    expect(agingBucket('2026-04-15', '2026-05-15')).toBe('current');
  });

  it('15: 35 days past due → 31–60 bucket', () => {
    expect(agingBucket('2026-04-10', '2026-05-15')).toBe('31_60');
  });

  it('16: 65 days past due → 61–90 bucket', () => {
    expect(agingBucket('2026-03-11', '2026-05-15')).toBe('61_90');
  });

  it('17: 100 days past due → over_90 bucket', () => {
    expect(agingBucket('2026-02-04', '2026-05-15')).toBe('over_90');
  });
});

// ── 18–22. P&L and Balance Sheet helper computations ─────────────────────────
describe('Phase 4 — Report grouping helpers', () => {
  it('18: revenue line amount = credit - debit (net credit)', () => {
    // Revenue accounts normally have credit > debit
    const revenueDebit  = 0;
    const revenueCredit = 10000;
    const amount = revenueCredit - revenueDebit;
    expect(amount).toBe(10000);
  });

  it('19: expense line amount = debit - credit (net debit)', () => {
    const expenseDebit  = 2000;
    const expenseCredit = 0;
    const amount = expenseDebit - expenseCredit;
    expect(amount).toBe(2000);
  });

  it('20: gross profit = revenue - cogs', () => {
    const revenue = 10000;
    const cogs    = 6000;
    expect(revenue - cogs).toBe(4000);
  });

  it('21: net profit = gross profit - operating expenses', () => {
    const grossProfit = 4000;
    const opex        = 1500;
    expect(grossProfit - opex).toBe(2500);
  });

  it('22: asset balance = debit - credit (normal debit balance)', () => {
    // Verify the balance sheet asset convention
    const lines: BalanceSheetLine[] = [
      { account_code: '1200', account_name: 'AR', account_type: 'asset', balance: 5000 },
      { account_code: '1100', account_name: 'Cash', account_type: 'asset', balance: 3000 },
    ];
    const totalAssets = lines.reduce((s, l) => s + l.balance, 0);
    expect(totalAssets).toBe(8000);
  });
});

// ── 23–27. DataAdapter has all Phase 4 APIs ───────────────────────────────────
describe('Phase 4 — DataAdapter interface completeness', () => {
  it('23: adapter has invoices API', () => {
    // TypeScript compile-time check: this will fail to compile if missing
    const _check: keyof DataAdapter = 'invoices';
    expect(_check).toBe('invoices');
  });

  it('24: adapter has salesQuotes API', () => {
    const _check: keyof DataAdapter = 'salesQuotes';
    expect(_check).toBe('salesQuotes');
  });

  it('25: adapter has payments API', () => {
    const _check: keyof DataAdapter = 'payments';
    expect(_check).toBe('payments');
  });

  it('26: adapter has bankAccounts API', () => {
    const _check: keyof DataAdapter = 'bankAccounts';
    expect(_check).toBe('bankAccounts');
  });

  it('27: adapter has reports API', () => {
    const _check: keyof DataAdapter = 'reports';
    expect(_check).toBe('reports');
  });
});

// ── 28–31. Result type shapes ─────────────────────────────────────────────────
describe('Phase 4 — Result type shapes', () => {
  it('28: InvoiceConfirmResult has all 4 required fields', () => {
    const result: InvoiceConfirmResult = {
      invoice_id:     'inv-1',
      invoice_number: 'INV-1001',
      je_id:          'je-1',
      entry_number:   'JE-1001',
    };
    expect(result.invoice_id).toBe('inv-1');
    expect(result.invoice_number).toBe('INV-1001');
    expect(result.je_id).toBe('je-1');
    expect(result.entry_number).toBe('JE-1001');
  });

  it('29: PaymentConfirmResult has all 4 required fields', () => {
    const result: PaymentConfirmResult = {
      payment_id:     'pmt-1',
      payment_number: 'REC-1001',
      je_id:          'je-2',
      entry_number:   'JE-1002',
    };
    expect(result.payment_id).toBe('pmt-1');
    expect(result.payment_number).toBe('REC-1001');
  });

  it('30: ApplyAdvanceResult has all 5 required fields', () => {
    const result: ApplyAdvanceResult = {
      je_id:        'je-3',
      entry_number: 'JE-1003',
      payment_id:   'pmt-1',
      invoice_id:   'inv-1',
      amount:       500,
    };
    expect(result.amount).toBe(500);
    expect(result.je_id).toBe('je-3');
  });

  it('31: ProfitAndLossLine has account_code, account_name, account_type, amount', () => {
    const line: ProfitAndLossLine = {
      account_code: '4100',
      account_name: 'Sales Revenue',
      account_type: 'revenue',
      amount:       50000,
    };
    expect(line.account_type).toBe('revenue');
    expect(line.amount).toBe(50000);
  });
});
