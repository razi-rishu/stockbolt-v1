// Pure arithmetic for invoice/quote line items and header totals.
// Uses exclusive tax (tax applied on net-after-discount).

export interface LineInput {
  quantity:         number;
  unit_price:       number;
  discount_percent: number; // 0–100
  tax_rate:         number; // percentage, e.g. 5 for 5%
}

export interface LineResult {
  line_subtotal:    number; // qty * unit_price
  discount_amount:  number; // subtotal * disc% / 100
  tax_amount:       number; // (subtotal - discount) * tax% / 100
  line_total:       number; // subtotal - discount + tax
}

export function calcLine(input: LineInput): LineResult {
  const subtotal   = round2(input.quantity * input.unit_price);
  const discAmt    = round2(subtotal * input.discount_percent / 100);
  const net        = subtotal - discAmt;
  const taxAmt     = round2(net * input.tax_rate / 100);
  const lineTotal  = round2(net + taxAmt);
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
