/**
 * phase123 decision 4 — tax-inclusive and tax-exclusive line maths for the
 * verified country rates: Saudi Arabia 15 %, Bahrain 10 %, India 18 % and the
 * India specials 3 / 1.5 / 0.25 %, plus the no-VAT case (Kuwait / Qatar, 0).
 *
 * The identity every document relies on — and the posting RPCs post from
 * (revenue = total − tax, phase38) — is checked in both modes:
 *     subtotal − discount + tax = total
 */
import { describe, it, expect } from 'vitest';
import { calcLine, calcHeaderTotals } from '../../src/core/sales/invoice-calc';

const line = (unit_price: number, tax_rate: number, inclusive: boolean, quantity = 1, discount_percent = 0) =>
  calcLine({ quantity, unit_price, discount_percent, tax_rate, inclusive });

describe('tax-exclusive lines add the tax on top', () => {
  it.each([
    ['SA 15 %',   15,   100, 15,    115],
    ['BH 10 %',   10,   100, 10,    110],
    ['IN 18 %',   18,   100, 18,    118],
    ['IN 3 %',    3,    100, 3,     103],
    ['IN 1.5 %',  1.5,  100, 1.5,   101.5],
    ['IN 0.25 %', 0.25, 100, 0.25,  100.25],
    ['KW/QA 0',   0,    100, 0,     100],
  ])('%s', (_n, rate, price, tax, total) => {
    const r = line(price, rate, false);
    expect(r.tax_amount).toBe(tax);
    expect(r.line_subtotal).toBe(price);
    expect(r.line_total).toBe(total);
  });
});

describe('tax-inclusive lines extract the tax from the price', () => {
  it.each([
    ['SA 15 %',   15,   115,    15,   100],
    ['BH 10 %',   10,   110,    10,   100],
    ['IN 18 %',   18,   118,    18,   100],
    ['IN 3 %',    3,    103,    3,    100],
    ['IN 1.5 %',  1.5,  101.5,  1.5,  100],
    ['IN 0.25 %', 0.25, 100.25, 0.25, 100],
    ['KW/QA 0',   0,    100,    0,    100],
  ])('%s', (_n, rate, price, tax, net_of_tax) => {
    const r = line(price, rate, true);
    expect(r.tax_amount).toBe(tax);
    expect(r.line_subtotal).toBe(net_of_tax);
    expect(r.line_total).toBe(price);   // the customer pays the shelf price
  });
});

describe('rounding', () => {
  it('SA 15 % inclusive, 3 × 9.99: tax rounds to 3.91 and the line still totals 29.97', () => {
    const r = line(9.99, 15, true, 3);
    expect(r.tax_amount).toBe(3.91);
    expect(r.line_subtotal).toBe(26.06);
    expect(r.line_total).toBe(29.97);
  });
  it('IN 0.25 % exclusive on 333.33: tax 0.83, total 334.16', () => {
    const r = line(333.33, 0.25, false);
    expect(r.tax_amount).toBe(0.83);
    expect(r.line_total).toBe(334.16);
  });
  it('IN 1.5 % inclusive with a 10 % discount: tax comes out of the discounted amount', () => {
    const r = line(1000, 1.5, true, 1, 10);
    expect(r.discount_amount).toBe(100);
    expect(r.tax_amount).toBe(13.3);
    expect(r.line_subtotal).toBe(986.7);
    expect(r.line_total).toBe(900);
  });
  it('BH 10 % exclusive with a discount: tax on the net, not the gross', () => {
    const r = line(49.95, 10, false, 2, 5);   // gross 99.90, disc 5.00 (4.995), net 94.90
    expect(r.discount_amount).toBe(5);
    expect(r.tax_amount).toBe(9.49);
    expect(r.line_total).toBe(104.39);
  });
});

describe('invoice header identity: subtotal − discount + tax = total = Σ line totals', () => {
  const cases: [string, boolean, [number, number, number, number][]][] = [
    ['SA 15 % inclusive', true,  [[3, 9.99, 0, 15], [1, 1234.5, 7.5, 15], [7, 0.35, 0, 15]]],
    ['SA 15 % exclusive', false, [[3, 9.99, 0, 15], [1, 1234.5, 7.5, 15], [7, 0.35, 0, 15]]],
    ['BH 10 % inclusive', true,  [[2, 49.95, 5, 10], [11, 3.333, 0, 10]]],
    ['BH 10 % exclusive', false, [[2, 49.95, 5, 10], [11, 3.333, 0, 10]]],
    ['IN mixed inclusive', true,  [[1, 118, 0, 18], [2, 5150.75, 2, 3], [1, 80000, 0, 1.5], [4, 2500.1, 0, 0.25], [1, 99, 0, 5]]],
    ['IN mixed exclusive', false, [[1, 118, 0, 18], [2, 5150.75, 2, 3], [1, 80000, 0, 1.5], [4, 2500.1, 0, 0.25], [1, 99, 0, 5]]],
  ];
  it.each(cases)('%s', (_n, inclusive, rows) => {
    const lines = rows.map(([q, p, d, t]) => calcLine({ quantity: q, unit_price: p, discount_percent: d, tax_rate: t, inclusive }));
    const h = calcHeaderTotals(lines);
    const sumTotals = Math.round(lines.reduce((s, l) => s + l.line_total, 0) * 100) / 100;
    expect(h.total_amount).toBeCloseTo(sumTotals, 2);
    expect(Math.round((h.subtotal - h.discount_amount + h.tax_amount) * 100) / 100).toBeCloseTo(h.total_amount, 2);
    // What the GL posts as revenue (phase38): total − tax, never negative.
    expect(h.total_amount - h.tax_amount).toBeGreaterThan(0);
  });
});
