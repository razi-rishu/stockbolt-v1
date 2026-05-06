// Pure arithmetic for POS cart lines and session summaries.
// Re-uses the same exclusive-tax formula as invoice-calc.ts.

export interface POSCartLine {
  product_id:       string;
  product_name:     string;
  sku:              string;
  quantity:         number;
  unit_price:       number;
  discount_percent: number;  // 0–100
  tax_rate:         number;  // e.g. 5 for 5%
}

export interface POSCartLineResult extends POSCartLine {
  line_subtotal:  number;   // qty × price (before disc)
  discount_amount: number;  // line_subtotal × disc% / 100
  net_amount:     number;   // line_subtotal − discount_amount
  tax_amount:     number;   // net_amount × tax% / 100
  line_total:     number;   // net_amount + tax_amount
}

export interface POSCartTotals {
  subtotal:        number;  // sum of line_subtotal
  discount_amount: number;  // sum of discount_amount
  tax_amount:      number;  // sum of tax_amount
  total_amount:    number;  // subtotal − discount + tax
}

export function calcPOSLine(line: POSCartLine): POSCartLineResult {
  const line_subtotal   = round2(line.quantity * line.unit_price);
  const discount_amount = round2(line_subtotal * line.discount_percent / 100);
  const net_amount      = round2(line_subtotal - discount_amount);
  const tax_amount      = round2(net_amount * line.tax_rate / 100);
  const line_total      = round2(net_amount + tax_amount);
  return { ...line, line_subtotal, discount_amount, net_amount, tax_amount, line_total };
}

export function calcPOSTotals(lines: POSCartLineResult[]): POSCartTotals {
  const subtotal        = round2(lines.reduce((s, l) => s + l.line_subtotal,   0));
  const discount_amount = round2(lines.reduce((s, l) => s + l.discount_amount, 0));
  const tax_amount      = round2(lines.reduce((s, l) => s + l.tax_amount,      0));
  const total_amount    = round2(subtotal - discount_amount + tax_amount);
  return { subtotal, discount_amount, tax_amount, total_amount };
}

export interface POSSessionSummary {
  cash_total:   number;
  card_total:   number;
  credit_total: number;
  grand_total:  number;
  sale_count:   number;
}

export function calcPOSSessionSummary(
  sales: Array<{ sale_channel: string; total_amount: number }>
): POSSessionSummary {
  let cash_total   = 0;
  let card_total   = 0;
  let credit_total = 0;
  for (const s of sales) {
    if (s.sale_channel === 'pos_cash')   cash_total   += s.total_amount;
    if (s.sale_channel === 'pos_card')   card_total   += s.total_amount;
    if (s.sale_channel === 'pos_credit') credit_total += s.total_amount;
  }
  return {
    cash_total:   round2(cash_total),
    card_total:   round2(card_total),
    credit_total: round2(credit_total),
    grand_total:  round2(cash_total + card_total + credit_total),
    sale_count:   sales.length,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
