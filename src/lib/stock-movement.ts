/**
 * What a stock movement IS, named once.
 *
 * The label map lived verbatim in two files — the Stock Ledger page and the
 * product's Stock Movement tab — so the two could drift, and both hardcoded
 * English while every other string on those pages went through i18n. In
 * Arabic the movement type stayed in English.
 *
 * The vocabulary is the stock_ledger.type CHECK constraint, and nothing else
 * is valid. If a new type is ever added to that constraint it must be added
 * here too, or the ledger will print a raw database value at someone.
 */

/** Exactly the values stock_ledger.type permits. */
export const STOCK_MOVEMENT_TYPES = [
  'purchase',
  'sale',
  'sales_return',
  'purchase_return',
  'transfer_in',
  'transfer_out',
  'adjustment_in',
  'adjustment_out',
  'opening_balance',
  'void',
  'edit_reversal',
] as const;

export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

/** The i18n key for a type. Unknown values fall back to the raw value so a
 *  new constraint entry is visible rather than blank. */
export function stockMovementKey(type: string): string {
  return `inventory.movement.${type}`;
}

/**
 * Colour by WHAT HAPPENED, not by direction, because direction is already a
 * column: purchases and purchase returns are supplier-side, sales and sales
 * returns customer-side, transfers internal, adjustments a correction, and
 * the reversal pair deliberately grey so an edit never looks like trade.
 */
const TONE: Record<string, string> = {
  purchase:        'bg-green-50 text-green-700',
  purchase_return: 'bg-green-50 text-green-700',
  sale:            'bg-blue-50 text-blue-700',
  sales_return:    'bg-blue-50 text-blue-700',
  transfer_in:     'bg-purple-50 text-purple-700',
  transfer_out:    'bg-purple-50 text-purple-700',
  adjustment_in:   'bg-amber-50 text-amber-700',
  adjustment_out:  'bg-amber-50 text-amber-700',
  opening_balance: 'bg-gray-100 text-gray-700',
  void:            'bg-gray-100 text-gray-500',
  edit_reversal:   'bg-gray-100 text-gray-500',
};

export function stockMovementTone(type: string): string {
  return TONE[type] ?? 'bg-gray-100 text-gray-700';
}

/** True when the movement is an audit artefact rather than real trade. A
 *  reader scanning the ledger should be able to tell those apart at a glance. */
export function isReversalMovement(type: string): boolean {
  return type === 'void' || type === 'edit_reversal';
}
