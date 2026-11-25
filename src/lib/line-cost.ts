/**
 * phase154 — what an invoice line cost. `cost_total` is the exact amount the
 * sale took out of stock, so reports agree with the ledger to the cent. Lines
 * sold before phase154 have none and keep the old calculation.
 */
export interface LineCost {
  quantity: number | string | null;
  cost_at_sale: number | string | null;
  cost_total?: number | string | null;
  /** phase155 — pieces in the line (2 BOX = 24); null = the line quantity. */
  base_quantity?: number | string | null;
}

/** Base units in a line: what left stock, whatever unit it was sold in. */
export function lineBaseQty(l: { quantity: number | string | null; base_quantity?: number | string | null }): number {
  return Number(l.base_quantity ?? l.quantity ?? 0);
}

export function lineCogs(l: LineCost): number {
  return l.cost_total != null ? Number(l.cost_total) : Number(l.cost_at_sale ?? 0) * lineBaseQty(l);
}
