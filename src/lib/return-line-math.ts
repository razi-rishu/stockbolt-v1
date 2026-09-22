/**
 * P1 — what a return line is actually worth.
 *
 * Both return editors used to show only quantity and COST, so an operator
 * returning 280 units could not see what the customer would be credited, or
 * how much tax came back with it. This computes the same figures the posting
 * engines compute, in the same order, so the screen and the ledger agree.
 *
 * The order matters and is copied from confirm_sales_return /
 * confirm_purchase_return, not invented:
 *
 *     discount = ROUND(unit x qty x pct / 100, 2)
 *     subtotal = ROUND(unit x qty - discount, 2)
 *     tax      = ROUND(subtotal x rate / 100, 2)
 *     total    = subtotal + tax
 *
 * Rounding at each step rather than once at the end is what makes the totals
 * tie to the posted document to the fils. Computing it "more accurately" here
 * would make the screen disagree with the books.
 *
 * REGIONS: identical for GCC and India. Both store one `tax_rate` per line —
 * a UAE line carries 5, an Indian line carries 18 whether that is CGST+SGST or
 * IGST. The CGST/SGST split is a reporting concern (place of supply), never a
 * line-level one, so nothing here branches by country.
 */

export interface ReturnLineInput {
  /** unit_price on a sales return, unit_cost on a purchase return. */
  unit_value:        number;
  quantity:          number;
  discount_percent?: number | null;
  tax_rate?:         number | null;
}

export interface ReturnLineValue {
  discount_amount: number;
  line_subtotal:   number;
  tax_amount:      number;
  line_total:      number;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeReturnLine(l: ReturnLineInput): ReturnLineValue {
  const unit = Number(l.unit_value) || 0;
  const qty  = Number(l.quantity) || 0;
  const pct  = Number(l.discount_percent ?? 0) || 0;
  const rate = Number(l.tax_rate ?? 0) || 0;

  const discount_amount = r2(unit * qty * pct / 100);
  const line_subtotal   = r2(unit * qty - discount_amount);
  const tax_amount      = r2(line_subtotal * rate / 100);
  return { discount_amount, line_subtotal, tax_amount, line_total: r2(line_subtotal + tax_amount) };
}

/** Document totals — the sum of per-line figures, never a re-derivation. */
export function sumReturnLines(lines: ReturnLineInput[]): ReturnLineValue {
  return lines.reduce<ReturnLineValue>((acc, l) => {
    const v = computeReturnLine(l);
    return {
      discount_amount: r2(acc.discount_amount + v.discount_amount),
      line_subtotal:   r2(acc.line_subtotal   + v.line_subtotal),
      tax_amount:      r2(acc.tax_amount      + v.tax_amount),
      line_total:      r2(acc.line_total      + v.line_total),
    };
  }, { discount_amount: 0, line_subtotal: 0, tax_amount: 0, line_total: 0 });
}
