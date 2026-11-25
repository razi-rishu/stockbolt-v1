/**
 * Shared Settings navigation spec — Phase 32.x (two-pane Settings).
 *
 * Single source of truth for both the Settings hub cards (modules/settings/index.tsx)
 * and the pinned left rail in the SettingsLayout (modules/settings/_layout.tsx).
 * Every item routes under /settings/* so it opens inside the two-pane layout; the
 * original routes (e.g. /products/categories, /accounting/chart-of-accounts) still
 * exist for the Inventory / Accounting menus.
 */
import { isAppShell } from '@/lib/platform';
import { navLinkEnabled, type ModuleKey } from '@/core/global-config';
import { GLOBAL_ONBOARDING } from '@/core/global-config/flag';
import type { Permission } from '@/lib/permissions';
import { ALL_ON, inventoryLinkVisible, type InventorySettings } from '@/lib/inventory-settings';

export interface SettingsNavItem {
  to: string;
  icon: string;
  title: string;
  desc: string;
  /** Not-yet-built — shown muted, not navigable. */
  comingSoon?: boolean;
  /** Website only — hidden in the Android app (see visibleSettingsSections). */
  webOnly?: boolean;
  /** Global v1 — shown only while VITE_GLOBAL_ONBOARDING is on. */
  globalOnly?: boolean;
  /** The right its page asks for (App.tsx); without it the entry is not shown. */
  perm?: Permission;
  /** Shown to admins only. */
  adminOnly?: boolean;
}
/** The user looking. Left out, every entry of the company is listed. */
export interface SettingsAccess {
  can: (perm: Permission) => boolean;
  isAdmin: boolean;
  /** Price levels are offered only while the company has some: no document reads them yet. */
  hasPriceLevels: boolean;
}
export interface SettingsNavSection {
  title: string;
  items: SettingsNavItem[];
}

// Bank Accounts lives under Banking, not here: listing it would send you back
// into the Settings shell (phase 95).
export const SETTINGS_SECTIONS: SettingsNavSection[] = [
  {
    title: 'Company',
    items: [
      { to: '/settings/company',    icon: '🏢', title: 'Company Profile',       desc: 'Name, logo, tax number, currency, fiscal year start.', perm: 'settings.read' },
      { to: '/settings/business-configuration', icon: '🧭', title: 'Business Configuration', desc: 'Your business activities and the modules your company uses.', globalOnly: true, perm: 'settings.read' },
      { to: '/settings/billing',    icon: '💳', title: 'Billing & Subscription', desc: 'Your plan, trial, payment history and billing address.', webOnly: true, perm: 'settings.read' },
      { to: '/settings/numbering',      icon: '🔢', title: 'Document Numbering', desc: 'Format, padding and next-number for every document type.', perm: 'settings.read' },
    ],
  },
  {
    title: 'Users & Approvals',
    items: [
      { to: '/settings/users', icon: '👥', title: 'Users & Roles', desc: 'Invite teammates, assign Admin / Accountant / Sales / Counter / Viewer roles.', perm: 'users.manage' },
      { to: '/settings/team',  icon: '🧭', title: 'Team',          desc: 'Employee codes, who reports to whom, and which login each person uses.' },
      { to: '/settings/approvals', icon: '✅', title: 'Approvals',  desc: 'Which documents need approval, from what amount, and who may approve them.', perm: 'users.manage' },
    ],
  },
  {
    title: 'Sales & Printing',
    items: [
      { to: '/settings/salespeople',    icon: '👤', title: 'Salespeople',        desc: 'Master list tagged on invoices/quotes for commission reports.' },
      { to: '/settings/price-levels', icon: '💰', title: 'Price Levels',     desc: 'Retail / Wholesale / Trade / Counter pricing tiers.', perm: 'settings.read' },
      { to: '/settings/print',    icon: '🖨️', title: 'Print Templates',        desc: 'Choose invoice/receipt template (Classic, Thermal POS, Trade).' },
      { to: '/settings/hardware', icon: '📷', title: 'Barcode & Printer Setup', desc: 'Barcode scanner mapping and receipt printer for this device.' },
    ],
  },
  {
    title: 'Inventory',
    items: [
      { to: '/settings/inventory',    icon: '📦', title: 'Inventory Settings', desc: 'Choose the inventory features your company uses.', perm: 'settings.read' },
      { to: '/settings/units',        icon: '📏', title: 'Units of Measure', desc: 'pcs, kg, m, box — used on product cards and invoices.', perm: 'settings.read' },
      { to: '/settings/categories',   icon: '🗂️', title: 'Categories',       desc: 'Hierarchical product categories (Engine, Brakes…).' },
      { to: '/settings/brands',       icon: '🏷️', title: 'Brands',           desc: 'Manufacturer brands (Bosch, Denso, Genuine…).' },
      { to: '/settings/vehicles',     icon: '🚗', title: 'Vehicle Makes',    desc: 'Vehicle compatibility list for parts catalog.' },
      { to: '/settings/warehouses', icon: '🏬', title: 'Warehouses & Branches',  desc: 'Storage locations and default branch for new documents.', perm: 'settings.read' },
    ],
  },
  {
    title: 'Accounting & Tax',
    items: [
      { to: '/settings/chart-of-accounts', icon: '📒', title: 'Chart of Accounts', desc: 'GL accounts grouped by Asset / Liability / Equity / Income / Expense.', perm: 'accounting.read' },
      { to: '/settings/tax-rates',      icon: '📊', title: 'Tax Rates',          desc: 'VAT % rates (UAE 5%, zero-rated, exempt) used on lines.', perm: 'settings.read' },
      { to: '/settings/exchange-rates', icon: '💱', title: 'Exchange Rates',     desc: 'Manual currency rates used to convert foreign documents to your base currency.', perm: 'settings.read' },
      { to: '/settings/period-lock',       icon: '🔒', title: 'Period Lock',       desc: 'Close accounting periods so no one back-dates entries.', perm: 'accounting.read' },
      { to: '/settings/opening-balances',  icon: '⤵️', title: 'Opening Balances',  desc: 'Migrate unpaid invoices / bills / credits from a prior system. Posts to 3010 Opening Balance Equity.', perm: 'settings.read' },
    ],
  },
  {
    title: 'Data & System',
    items: [
      { to: '/settings/import-export',     icon: '📤', title: 'Import / Export',   desc: 'Bulk-load master data from CSV / Excel, or export your current data for backup / reporting.', perm: 'settings.read' },
      { to: '/settings/audit-log',     icon: '📋', title: 'Audit Log',          desc: 'Read-only trail of who-did-what across the ERP.' },
      { to: '/settings/system-health', icon: '✅', title: 'System Health',      desc: 'Runs invariant checks (TB balance, AR matches, stock matches GL).' },
      { to: '/settings/maintenance',   icon: '🛠️', title: 'Accounting Maintenance', desc: 'Preview and apply the sell-before-buy COGS repairs when System Health flags E1.' },
      { to: '/settings/developer', icon: '🔌', title: 'Developer & API', desc: 'API keys to connect your store or other software to StockBolt.', perm: 'settings.write' },
      { to: '/settings/reset-data',    icon: '🧹', title: 'Reset Company Data', desc: 'Destructive admin operation — wipes transactions for QA cycles.', adminOnly: true },
    ],
  },
];

/**
 * The sections to show. In the Android app, web-only items are dropped:
 * subscriptions are bought on the website (PayPal), and Google Play does not
 * allow an app to sell them through another payment system. Global v1: items
 * that belong to a module the company switched off are dropped (the route is
 * refused by ModuleGate anyway), and the Business Configuration entry only
 * appears while the Global flag is on. phase153: entries of an inventory
 * feature the company switched off are dropped (their pages still open).
 * With `access`, so are entries the user may not open.
 */
export function visibleSettingsSections(enabled?: readonly ModuleKey[], inventory: InventorySettings = ALL_ON, access?: SettingsAccess): SettingsNavSection[] {
  const app = isAppShell();
  return SETTINGS_SECTIONS
    .map((s) => ({ ...s, items: s.items.filter((it) =>
      !(app && it.webOnly) && !(it.globalOnly && !GLOBAL_ONBOARDING) && (!enabled || navLinkEnabled(it.to, enabled))
      && inventoryLinkVisible(it.to, inventory)
      && (!access || ((!it.perm || access.can(it.perm)) && (!it.adminOnly || access.isAdmin)
        && (it.to !== '/settings/price-levels' || access.hasPriceLevels)))) }))
    .filter((s) => s.items.length > 0);
}
