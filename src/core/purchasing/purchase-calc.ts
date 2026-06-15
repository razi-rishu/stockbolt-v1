export interface PurchaseLineInput {
  quantity: number;
  unit_cost: number;
  discount_percent: number;
  tax_rate: number;
  inclusive?: boolean; // true = unit_cost already includes tax
}

export interface PurchaseLineResult {
  line_subtotal: number;
  discount_amount: number;
  tax_amount: number;
  line_total: number;
}

export interface PurchaseHeaderTotals {
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
}

export type APAgingBucket = 'current' | '31_60' | '61_90' | 'over_90';

function round2(n: number) { return Math.round(n * 100) / 100; }

export function calcPurchaseLine(input: PurchaseLineInput): PurchaseLineResult {
  const line_subtotal   = round2(input.quantity * input.unit_cost);
  const discount_amount = round2(line_subtotal * (input.discount_percent / 100));
  const net             = round2(line_subtotal - discount_amount);

  if (input.inclusive) {
    const tax_amount = input.tax_rate > 0
      ? round2(net * input.tax_rate / (100 + input.tax_rate))
      : 0;
    return { line_subtotal, discount_amount, tax_amount, line_total: net };
  }

  const tax_amount = round2(net * (input.tax_rate / 100));
  return {
    line_subtotal,
    discount_amount,
    tax_amount,
    line_total: round2(net + tax_amount),
  };
}

export function calcPurchaseHeaderTotals(lines: PurchaseLineResult[]): PurchaseHeaderTotals {
  return {
    subtotal:        lines.reduce((s, l) => s + l.line_subtotal, 0),
    discount_amount: lines.reduce((s, l) => s + l.discount_amount, 0),
    tax_amount:      lines.reduce((s, l) => s + l.tax_amount, 0),
    total_amount:    lines.reduce((s, l) => s + l.line_total, 0),
  };
}

// Weighted-average cost (MAC) when receiving new stock.
export function calcMAC(
  oldMAC: number,
  oldQty: number,
  newCost: number,
  newQty: number,
): number {
  if (oldQty + newQty === 0) return 0;
  if (oldQty === 0) return newCost;
  return (oldMAC * oldQty + newCost * newQty) / (oldQty + newQty);
}

// MAC adjustment when a vendor bill arrives with a price variance (no qty change).
export function calcMACAfterVariance(
  currentMAC: number,
  currentQty: number,
  variance: number,   // positive = cost went up, negative = cost went down
): number {
  if (currentQty === 0) return currentMAC;
  const newTotalValue = currentMAC * currentQty + variance;
  return newTotalValue / currentQty;
}

// AP aging bucket — same bucket logic as AR aging.
export function apAgingBucket(dueDateIso: string | null, asOfIso: string): APAgingBucket {
  if (!dueDateIso) return 'current';
  const due = new Date(dueDateIso);
  const asOf = new Date(asOfIso);
  const diffDays = Math.floor((asOf.getTime() - due.getTime()) / 86_400_000);
  if (diffDays <= 30) return 'current';
  if (diffDays <= 60) return '31_60';
  if (diffDays <= 90) return '61_90';
  return 'over_90';
}
