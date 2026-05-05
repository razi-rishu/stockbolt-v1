export interface AdjustmentLineResult {
  difference: number;        // actual_qty - system_qty (positive = found, negative = loss)
  total_value: number;       // ABS(difference) × unit_cost
  direction: 'in' | 'out' | 'none';
}

/**
 * Compute the difference for one inventory adjustment line.
 * system_qty  = what the system records
 * actual_qty  = what the physical count found
 * unit_cost   = MAC to use for the GL value
 */
export function calcAdjustmentLine(
  systemQty: number,
  actualQty: number,
  unitCost: number,
): AdjustmentLineResult {
  const difference = actualQty - systemQty;
  const total_value = Math.abs(difference) * unitCost;
  const direction: 'in' | 'out' | 'none' =
    difference > 0 ? 'in' : difference < 0 ? 'out' : 'none';
  return { difference, total_value, direction };
}

/**
 * Days since last stock movement (for slow-moving / stock-aging reports).
 * Returns 0 if lastMovementDate is null (never moved = purchased today for new stock,
 * treated as age 0 for safety; caller can handle null specially if needed).
 */
export function stockAgingDays(
  lastMovementDateIso: string | null,
  asOfIso: string,
): number {
  if (!lastMovementDateIso) return 0;
  const last = new Date(lastMovementDateIso);
  const asOf = new Date(asOfIso);
  return Math.max(0, Math.floor((asOf.getTime() - last.getTime()) / 86_400_000));
}

/**
 * Returns true if current stock is at or below the reorder point (min_stock_level).
 */
export function isReorderNeeded(currentQty: number, minStockLevel: number): boolean {
  return currentQty <= minStockLevel;
}

/**
 * Stock aging bucket for reporting.
 */
export type StockAgingBucket = '0_30' | '31_60' | '61_90' | 'over_90';

export function stockAgingBucket(ageDays: number): StockAgingBucket {
  if (ageDays <= 30)  return '0_30';
  if (ageDays <= 60)  return '31_60';
  if (ageDays <= 90)  return '61_90';
  return 'over_90';
}
