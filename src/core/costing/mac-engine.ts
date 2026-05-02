import type { StockMovementPayload, StockBalance, DataAdapter } from '@/data/adapter';

export interface CostingStrategy {
  computeNewMAC(oldQty: number, oldMAC: number, inQty: number, inCost: number): number;
}

/**
 * Moving Average Cost per Doc 3 Part O.
 * new_MAC = (old_MAC × old_qty + in_cost × in_qty) / (old_qty + in_qty)
 * Applied only on inbound movements (purchase / opening_balance / adjustment_in).
 */
export class MovingAverageCostingStrategy implements CostingStrategy {
  computeNewMAC(oldQty: number, oldMAC: number, inQty: number, inCost: number): number {
    const totalQty = oldQty + inQty;
    if (totalQty <= 0) return inCost;
    return (oldMAC * oldQty + inCost * inQty) / totalQty;
  }
}

const macStrategy = new MovingAverageCostingStrategy();

/**
 * Post a stock movement to stock_ledger.
 * Handles MAC recalculation for inbound movements.
 * Outbound movements (direction=-1) use the current MAC as unit_cost.
 */
export async function postStockMovement(
  payload: StockMovementPayload,
  adapter: DataAdapter,
): Promise<void> {
  const balance: StockBalance = await adapter.stockLedger.getBalance(
    payload.company_id,
    payload.product_id,
    payload.warehouse_id,
  );

  // For outbound: use current MAC if unit_cost not provided (0 = use MAC)
  let unit_cost = payload.unit_cost;
  if (payload.direction === -1 && unit_cost === 0) {
    unit_cost = await adapter.stockLedger.getMAC(payload.company_id, payload.product_id);
  }

  // For inbound: compute new MAC
  if (payload.direction === 1) {
    const newMAC = macStrategy.computeNewMAC(
      balance.quantity, balance.unit_cost,
      payload.quantity, unit_cost,
    );
    // The adapter's postMovement will use running_avg_cost = newMAC
    unit_cost = newMAC; // passed through for storage consistency
  }

  await adapter.stockLedger.postMovement({ ...payload, unit_cost });
}
