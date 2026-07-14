/**
 * Shared Settings navigation spec — Phase 32.x (two-pane Settings).
 *
 * Single source of truth for both the Settings hub cards (modules/settings/index.tsx)
 * and the pinned left rail in the SettingsLayout (modules/settings/_layout.tsx).
 * Every item routes under /settings/* so it opens inside the two-pane layout; the
 * original routes (e.g. /products/categories, /accounting/chart-of-accounts) still
 * exist for the Inventory / Accounting menus.
 */
export interface SettingsNavItem {
  to: string;
  icon: string;
  title: string;
  desc: string;
  /** Not-yet-built — shown muted, not navigable. */
  comingSoon?: boolean;
}
export interface SettingsNavSection {
  title: string;
  items: SettingsNavItem[];
}

export const SETTINGS_SECTIONS: SettingsNavSection[] = [
  {
    title: 'Company & Location',
    items: [
      { to: '/settings/company',    icon: '🏢', title: 'Company Profile',       desc: 'Name, logo, tax number, currency, fiscal year start.' },
      { to: '/settings/billing',    icon: '💳', title: 'Billing & Subscription', desc: 'Your plan, trial, payment history and billing address.' },
      { to: '/settings/warehouses', icon: '🏬', title: 'Warehouses & Branches',  desc: 'Storage locations and default branch for new documents.' },
    ],
  },
  {
    title: 'Inventory & Catalog',
    items: [
      { to: '/settings/units',        icon: '📏', title: 'Units of Measure', desc: 'pcs, kg, m, box — used on product cards and invoices.' },
      { to: '/settings/categories',   icon: '🗂️', title: 'Categories',       desc: 'Hierarchical product categories (Engine, Brakes…).' },
      { to: '/settings/brands',       icon: '🏷️', title: 'Brands',           desc: 'Manufacturer brands (Bosch, Denso, Genuine…).' },
      { to: '/settings/vehicles',     icon: '🚗', title: 'Vehicle Makes',    desc: 'Vehicle compatibility list for parts catalog.' },
      { to: '/settings/price-levels', icon: '💰', title: 'Price Levels',     desc: 'Retail / Wholesale / Trade / Counter pricing tiers.' },
    ],
  },
  {
    title: 'Sales, Customers & Tax',
    items: [
      { to: '/settings/salespeople',    icon: '👤', title: 'Salespeople',        desc: 'Master list tagged on invoices/quotes for commission reports.' },
      { to: '/settings/tax-rates',      icon: '📊', title: 'Tax Rates',          desc: 'VAT % rates (UAE 5%, zero-rated, exempt) used on lines.' },
      { to: '/settings/exchange-rates', icon: '💱', title: 'Exchange Rates',     desc: 'Manual currency rates used to convert foreign documents to your base currency.' },
      { to: '/settings/numbering',      icon: '🔢', title: 'Document Numbering', desc: 'Format, padding and next-number for every document type.' },
    ],
  },
  {
    title: 'Accounting & Banking',
    items: [
      { to: '/settings/chart-of-accounts', icon: '📒', title: 'Chart of Accounts', desc: 'GL accounts grouped by Asset / Liability / Equity / Income / Expense.' },
      { to: '/settings/period-lock',       icon: '🔒', title: 'Period Lock',       desc: 'Close accounting periods so no one back-dates entries.' },
      { to: '/settings/bank-accounts',     icon: '🏦', title: 'Bank Accounts',     desc: 'Bank / cash accounts used to receive payments and post expenses.' },
      { to: '/settings/opening-balances',  icon: '⤵️', title: 'Opening Balances',  desc: 'Migrate unpaid invoices / bills / credits from a prior system. Posts to 3010 Opening Balance Equity.' },
      { to: '/settings/import-export',     icon: '📤', title: 'Import / Export',   desc: 'Bulk-load master data from CSV / Excel, or export your current data for backup / reporting.' },
    ],
  },
  {
    title: 'Printing & Hardware',
    items: [
      { to: '/settings/print',    icon: '🖨️', title: 'Print Templates',        desc: 'Choose invoice/receipt template (Classic, Thermal POS, Trade).' },
      { to: '/settings/hardware', icon: '📷', title: 'Barcode & Printer Setup', desc: 'Barcode scanner mapping and receipt printer for this device.' },
    ],
  },
  {
    title: 'Users & Permissions',
    items: [
      { to: '/settings/users', icon: '👥', title: 'Users & Roles', desc: 'Invite teammates, assign Admin / Accountant / Sales / Counter / Viewer roles.' },
    ],
  },
  {
    title: 'Developer',
    items: [
      { to: '/settings/developer', icon: '🔌', title: 'Developer & API', desc: 'API keys to connect your store or other software to StockBolt.' },
    ],
  },
  {
    title: 'System & Admin',
    items: [
      { to: '/settings/system-health', icon: '✅', title: 'System Health',      desc: 'Runs invariant checks (TB balance, AR matches, stock matches GL).' },
      { to: '/settings/audit-log',     icon: '📋', title: 'Audit Log',          desc: 'Read-only trail of who-did-what across the ERP.' },
      { to: '/settings/reset-data',    icon: '🧹', title: 'Reset Company Data', desc: 'Destructive admin operation — wipes transactions for QA cycles.' },
    ],
  },
];
