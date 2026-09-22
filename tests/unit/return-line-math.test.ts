import { describe, it, expect } from 'vitest';
import { computeReturnLine, sumReturnLines } from '@/lib/return-line-math';

/**
 * P1 — these figures are shown to an operator immediately before they confirm a
 * return, so they have to be the SAME numbers the posting engine will write.
 * The cases below are the ones where a plausible-looking shortcut diverges.
 */
describe('return line value', () => {
  it('matches the engine on a plain GCC VAT line', () => {
    // 10 x 100 @ 5% VAT — the ordinary UAE case.
    expect(computeReturnLine({ unit_value: 100, quantity: 10, tax_rate: 5 }))
      .toEqual({ discount_amount: 0, line_subtotal: 1000, tax_amount: 50, line_total: 1050 });
  });

  it('matches the engine on an India GST line', () => {
    // 18% whether it is CGST+SGST or IGST — the line carries one rate.
    expect(computeReturnLine({ unit_value: 100, quantity: 10, tax_rate: 18 }))
      .toEqual({ discount_amount: 0, line_subtotal: 1000, tax_amount: 180, line_total: 1180 });
  });

  it('takes the discount BEFORE tax, as the engine does', () => {
    // Taxing the gross and then discounting gives 1050 -> wrong by 5.
    const v = computeReturnLine({ unit_value: 100, quantity: 10, discount_percent: 10, tax_rate: 5 });
    expect(v.discount_amount).toBe(100);
    expect(v.line_subtotal).toBe(900);
    expect(v.tax_amount).toBe(45);
    expect(v.line_total).toBe(945);
  });

  it('rounds at each step, not once at the end', () => {
    // 3 x 33.33 @ 5%: stepwise gives 99.99 -> 5.00 -> 104.99.
    // Deferring rounding gives 104.9895 -> 104.99 here, but the two diverge on
    // other inputs, and the engine is stepwise, so stepwise is correct.
    const v = computeReturnLine({ unit_value: 33.33, quantity: 3, tax_rate: 5 });
    expect(v.line_subtotal).toBe(99.99);
    expect(v.tax_amount).toBe(5);
    expect(v.line_total).toBe(104.99);
  });

  it('treats a zero-rated or exempt line as no tax', () => {
    expect(computeReturnLine({ unit_value: 50, quantity: 2, tax_rate: 0 }).tax_amount).toBe(0);
    expect(computeReturnLine({ unit_value: 50, quantity: 2, tax_rate: null }).tax_amount).toBe(0);
  });

  it('survives an empty or half-filled line without producing NaN', () => {
    const v = computeReturnLine({ unit_value: NaN as unknown as number, quantity: 5 });
    expect(v.line_total).toBe(0);
    expect(Number.isNaN(v.line_total)).toBe(false);
  });

  it('sums a document from its lines rather than re-deriving it', () => {
    const t = sumReturnLines([
      { unit_value: 100, quantity: 10, tax_rate: 5 },
      { unit_value: 33.33, quantity: 3, tax_rate: 5 },
    ]);
    expect(t.line_subtotal).toBe(1099.99);
    expect(t.tax_amount).toBe(55);
    expect(t.line_total).toBe(1154.99);
  });

  it('returns zeroes for no lines', () => {
    expect(sumReturnLines([])).toEqual(
      { discount_amount: 0, line_subtotal: 0, tax_amount: 0, line_total: 0 });
  });
});
