import type { SalesReturnReasonLine, PurchaseReturnReasonLine } from '@/data/adapter';

/**
 * R6a — the arithmetic behind the Returns Analysis report.
 *
 * Kept out of the adapter so it can be tested without a database. The whole
 * risk in a report is the fold: header figures (the credit note total, the
 * restocking fee) must be counted ONCE PER RETURN, while line figures
 * (quantity, cost) accumulate per item. Adding a header value inside the item
 * loop multiplies it by the line count, which looks plausible and is wrong.
 */

export interface SalesReturnRaw {
  reason:          string | null;
  restocking_fee:  number | null;
  credit_notes:    { total_amount: number | null } | null;
  sales_return_items: { qty_returned: number; condition: string | null; unit_cost: number | null }[] | null;
}

export interface PurchaseReturnRaw {
  reason:      string | null;
  debit_notes: { total_amount: number | null } | null;
  purchase_return_items: { qty_returned: number; unit_cost: number | null }[] | null;
}

export function foldSalesReturnsByReason(rows: SalesReturnRaw[]): SalesReturnReasonLine[] {
  const acc: Record<string, SalesReturnReasonLine> = {};
  for (const r of rows) {
    const key = r.reason ?? '';
    acc[key] ??= { reason: key, returns: 0, qty: 0, credit_value: 0,
                   restocked_value: 0, written_off: 0, fees: 0 };
    const a = acc[key]!;

    // Per DOCUMENT — outside the item loop.
    a.returns      += 1;
    a.credit_value += Number(r.credit_notes?.total_amount ?? 0);
    a.fees         += Number(r.restocking_fee ?? 0);

    // Per LINE.
    for (const it of r.sales_return_items ?? []) {
      const qty  = Number(it.qty_returned ?? 0);
      const cost = qty * Number(it.unit_cost ?? 0);
      a.qty += qty;
      // The same split phase 76 posts on: damaged cost is debited to 6700
      // Inventory Loss, everything else went back on the shelf.
      if (it.condition === 'damaged') a.written_off     += cost;
      else                            a.restocked_value += cost;
    }
  }
  return Object.values(acc).sort((x, y) => y.credit_value - x.credit_value);
}

export function foldPurchaseReturnsByReason(rows: PurchaseReturnRaw[]): PurchaseReturnReasonLine[] {
  const acc: Record<string, PurchaseReturnReasonLine> = {};
  for (const r of rows) {
    const key = r.reason ?? '';
    acc[key] ??= { reason: key, returns: 0, qty: 0, debit_value: 0, cost: 0 };
    const a = acc[key]!;

    a.returns     += 1;
    a.debit_value += Number(r.debit_notes?.total_amount ?? 0);

    for (const it of r.purchase_return_items ?? []) {
      const qty = Number(it.qty_returned ?? 0);
      a.qty  += qty;
      a.cost += qty * Number(it.unit_cost ?? 0);
    }
  }
  return Object.values(acc).sort((x, y) => y.debit_value - x.debit_value);
}
