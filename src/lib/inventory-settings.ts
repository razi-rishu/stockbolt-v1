/**
 * phase153 — optional inventory features, per company.
 *
 * Presentation only: a switch decides what users SEE (menu links, fields on
 * the product form). Nothing is posted, blocked or deleted because of it, and
 * a page that is hidden from the menus still opens by its address, so old
 * links and bookmarks keep working.
 *
 * A company without a saved row — every company that existed before phase153,
 * and any company on a database without it — has every feature on.
 *
 * packs_enabled (phase155) is the exception: it changes how documents are
 * written, so it is OFF until a company turns it on.
 */
export interface InventorySettings {
  transfers_enabled: boolean;
  reorder_enabled: boolean;
  barcodes_enabled: boolean;
  /** Brands and categories. */
  brands_enabled: boolean;
  /** Aisle / bin. */
  shelf_enabled: boolean;
  /** phase155 — buy and sell in packs (BOX = 12 PCS). Off unless turned on. */
  packs_enabled: boolean;
}

export type InventorySwitch = keyof InventorySettings;

export const INVENTORY_SWITCHES: readonly InventorySwitch[] = [
  'transfers_enabled', 'reorder_enabled', 'barcodes_enabled', 'brands_enabled', 'shelf_enabled', 'packs_enabled',
];

export const ALL_ON: InventorySettings = {
  transfers_enabled: true, reorder_enabled: true, barcodes_enabled: true, brands_enabled: true, shelf_enabled: true,
  packs_enabled: false,
};

/** A stored row (or none) as settings: anything missing counts as on (packs: off). */
export function inventorySettingsFrom(row: Partial<InventorySettings> | null | undefined): InventorySettings {
  const out = { ...ALL_ON };
  if (row) for (const k of INVENTORY_SWITCHES) {
    if (k === 'packs_enabled') out[k] = row[k] === true;
    else if (row[k] === false) out[k] = false;
  }
  return out;
}

/** Menu links that belong to a switch. */
const LINK_SWITCH: Record<string, InventorySwitch> = {
  '/inventory/transfers': 'transfers_enabled',
  '/reports/reorder': 'reorder_enabled',
  '/products/categories': 'brands_enabled',
  '/products/brands': 'brands_enabled',
  '/settings/categories': 'brands_enabled',
  '/settings/brands': 'brands_enabled',
};

export function inventoryLinkVisible(to: string, s: InventorySettings): boolean {
  const key = LINK_SWITCH[to];
  return !key || s[key];
}
