// Pure arithmetic for invoice/quote line items and header totals.
// Supports both exclusive (default) and inclusive tax modes.

export interface LineInput {
  quantity:         number;
  unit_price:       number;
  discount_percent: number; // 0–100
  tax_rate:         number; // percentage, e.g. 5 for 5%
  inclusive?:       boolean; // true = unit_price already includes tax
}

export interface LineResult {
  line_subtotal:    number; // qty * unit_price (gross before discount)
  discount_amount:  number; // gross * disc% / 100
  tax_amount:       number; // extracted or added tax
  line_total:       number; // amount customer pays
}

export function calcLine(input: LineInput): LineResult {
  const subtotal = round2(input.quantity * input.unit_price);
  const discAmt  = round2(subtotal * input.discount_percent / 100);
  const net      = round2(subtotal - discAmt);   // after-discount amount

  if (input.inclusive) {
    // Price already includes tax — extract it from the net amount.
    // taxAmt = net * rate / (100 + rate)
    const taxAmt = input.tax_rate > 0
      ? round2(net * input.tax_rate / (100 + input.tax_rate))
      : 0;
    return {
      line_subtotal:   subtotal,
      discount_amount: discAmt,
      tax_amount:      taxAmt,
      line_total:      net,   // customer pays `net`; tax is already inside
    };
  }

  // Exclusive (default): tax added on top of net-after-discount.
  const taxAmt   = round2(net * input.tax_rate / 100);
  const lineTotal = round2(net + taxAmt);
  return {
    line_subtotal:   subtotal,
    discount_amount: discAmt,
    tax_amount:      taxAmt,
    line_total:      lineTotal,
  };
}

export interface HeaderTotals {
  subtotal:        number; // sum of line_subtotal
  discount_amount: number; // sum of discount_amount
  tax_amount:      number; // sum of tax_amount
  total_amount:    number; // subtotal - discount + tax
}

export function calcHeaderTotals(lines: LineResult[]): HeaderTotals {
  const subtotal  = round2(lines.reduce((s, l) => s + l.line_subtotal,   0));
  const discount  = round2(lines.reduce((s, l) => s + l.discount_amount, 0));
  const tax       = round2(lines.reduce((s, l) => s + l.tax_amount,      0));
  const total     = round2(subtotal - discount + tax);
  return { subtotal, discount_amount: discount, tax_amount: tax, total_amount: total };
}

// AR Aging bucketing (days past due_date as of as_of_date)
export type AgingBucket = 'current' | '31_60' | '61_90' | 'over_90';

export function agingBucket(dueDateIso: string | null, asOfIso: string): AgingBucket {
  if (!dueDateIso) return 'current';
  const dueMs  = new Date(dueDateIso).getTime();
  const asOfMs = new Date(asOfIso).getTime();
  const days   = Math.floor((asOfMs - dueMs) / 86_400_000);
  if (days <= 0)  return 'current';
  if (days <= 30) return 'current';
  if (days <= 60) return '31_60';
  if (days <= 90) return '61_90';
  return 'over_90';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
