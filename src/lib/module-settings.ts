/**
 * The settings behind a module's gear: which Settings pages belong to the
 * module a page is part of. Pure — the entries themselves (title, icon, who
 * may see them) stay in modules/settings/_nav.
 */
export type GearModule = 'sales' | 'pos' | 'purchasing' | 'inventory' | 'accounting' | 'banking' | 'payroll' | 'contacts' | 'reports';

const ITEMS: Record<GearModule, readonly string[]> = {
  sales:      ['/settings/salespeople', '/settings/numbering', '/settings/print', '/settings/tax-rates', '/settings/approvals'],
  pos:        ['/settings/hardware', '/settings/salespeople', '/settings/print', '/settings/numbering', '/settings/tax-rates'],
  purchasing: ['/settings/numbering', '/settings/tax-rates', '/settings/print', '/settings/approvals'],
  inventory:  ['/settings/inventory', '/settings/units', '/settings/categories', '/settings/brands', '/settings/vehicles', '/settings/warehouses', '/settings/approvals'],
  accounting: ['/settings/chart-of-accounts', '/settings/tax-rates', '/settings/period-lock', '/settings/opening-balances'],
  banking:    ['/banking/bank-accounts', '/settings/exchange-rates', '/settings/approvals'],
  payroll:    ['/settings/team', '/settings/approvals'],
  contacts:   ['/settings/import-export', '/settings/opening-balances'],
  reports:    ['/settings/company', '/settings/print'],
};

const ROOT: Record<string, GearModule> = {
  sales: 'sales', pos: 'pos', purchasing: 'purchasing', products: 'inventory', catalog: 'inventory', inventory: 'inventory',
  accounting: 'accounting', banking: 'banking', payroll: 'payroll', contacts: 'contacts', reports: 'reports',
};
/** Second segments that are lists, under a root whose second segment is otherwise a record. */
const PRODUCT_LISTS = new Set(['categories', 'brands', 'vehicles']);

/**
 * The module of a list or report page, or null. Never a record or a form
 * (/sales/invoices/123, /products/new): leaving those could lose unsaved work.
 */
export function gearModule(pathname: string): GearModule | null {
  const parts = pathname.split('/').filter(Boolean);
  const mod = ROOT[parts[0] ?? ''];
  if (!mod || parts.length > 2) return null;
  if (parts[0] === 'products' && parts.length === 2 && !PRODUCT_LISTS.has(parts[1])) return null;
  return mod;
}

/** The module's settings, without the page the user is already on. */
export function gearItems(mod: GearModule, pathname: string): string[] {
  const here = pathname.split('/').filter(Boolean).pop();
  return ITEMS[mod].filter((to) => to.split('/').pop() !== here);
}
