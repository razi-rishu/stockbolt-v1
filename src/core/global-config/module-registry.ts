/**
 * Global v1 — the module registry. Every entry is an EXISTING StockBolt module
 * (Global v1 reuses modules, it doesn't rebuild them); `areas` names the
 * routes it covers today.
 *
 * - `essential` modules are always on: the ledger, contacts and banking are
 *   what every posting engine writes to.
 * - `depends_on`: enabling a module enables these; disabling one of them
 *   while a dependent is on is refused.
 * - `countries`: the module only exists for these country packs.
 * - `legacy_flag`: the existing per-company switch that already controls it
 *   (companies.projects_enabled), so current tenants keep their behaviour.
 */
export type ModuleKey =
  | 'accounting' | 'contacts' | 'banking'
  | 'items' | 'inventory' | 'sales' | 'purchasing' | 'expenses' | 'pos'
  | 'projects' | 'payroll' | 'fixed_assets' | 'amortization'
  | 'tax_returns' | 'e_invoicing' | 'tds'
  | 'multi_currency' | 'automotive_catalog' | 'api_access';

export interface ModuleDefinition {
  key: ModuleKey;
  name: string;
  name_ar: string;
  essential: boolean;
  depends_on: ModuleKey[];
  countries?: string[];
  legacy_flag?: 'projects_enabled';
  areas: string[];
}

export const MODULES: readonly ModuleDefinition[] = [
  { key: 'accounting', name: 'Accounting & General Ledger', name_ar: 'المحاسبة ودفتر الأستاذ العام', essential: true, depends_on: [],
    areas: ['/accounting/chart-of-accounts', '/accounting/journal-entries', '/accounting/general-ledger', '/accounting/period-lock', '/accounting/year-end-close', '/reports/trial-balance', '/reports/profit-loss', '/reports/balance-sheet', '/reports/cash-flow'] },
  { key: 'contacts', name: 'Customers & Suppliers', name_ar: 'العملاء والموردون', essential: true, depends_on: ['accounting'],
    areas: ['/contacts/customers', '/contacts/suppliers'] },
  { key: 'banking', name: 'Cash & Banking', name_ar: 'النقد والبنوك', essential: true, depends_on: ['accounting'],
    areas: ['/banking/bank-accounts', '/banking/transfers', '/banking/pdc-received', '/banking/pdc-issued', '/banking/reconciliation'] },
  { key: 'items', name: 'Products & Services', name_ar: 'المنتجات والخدمات', essential: false, depends_on: ['accounting'],
    areas: ['/products', '/products/categories', '/products/brands'] },
  { key: 'inventory', name: 'Inventory & Warehouses', name_ar: 'المخزون والمستودعات', essential: false, depends_on: ['items'],
    areas: ['/inventory/transfers', '/inventory/adjustments', '/inventory/stock-ledger'] },
  { key: 'sales', name: 'Sales & Invoicing', name_ar: 'المبيعات والفوترة', essential: false, depends_on: ['contacts', 'items', 'banking'],
    areas: ['/sales/invoices', '/sales/quotes', '/sales/payments', '/sales/credit-notes'] },
  { key: 'purchasing', name: 'Purchasing & Payables', name_ar: 'المشتريات والذمم الدائنة', essential: false, depends_on: ['contacts', 'items', 'banking'],
    areas: ['/purchasing/orders', '/purchasing/grns', '/purchasing/bills', '/purchasing/payments', '/purchasing/debit-notes'] },
  { key: 'expenses', name: 'Expenses', name_ar: 'المصروفات', essential: false, depends_on: ['banking'],
    areas: ['/purchasing/expenses'] },
  { key: 'pos', name: 'Point of Sale', name_ar: 'نقاط البيع', essential: false, depends_on: ['sales', 'inventory'],
    areas: ['/pos'] },
  { key: 'projects', name: 'Projects & Job Costing', name_ar: 'المشاريع وتكاليف الأعمال', essential: false, depends_on: ['sales'], legacy_flag: 'projects_enabled',
    areas: ['/projects', '/reports/project-profitability'] },
  { key: 'payroll', name: 'Payroll', name_ar: 'الرواتب', essential: false, depends_on: ['banking'],
    areas: ['/payroll/employees', '/payroll/runs', '/payroll/leave-salary'] },
  { key: 'fixed_assets', name: 'Fixed Assets & Depreciation', name_ar: 'الأصول الثابتة والإهلاك', essential: false, depends_on: ['accounting'],
    areas: ['/accounting/fixed-assets'] },
  { key: 'amortization', name: 'Prepaid & Deferred Amortization', name_ar: 'إطفاء المدفوعات المقدمة والمؤجلة', essential: false, depends_on: ['accounting'],
    areas: ['/accounting/amortization'] },
  { key: 'tax_returns', name: 'Tax Returns', name_ar: 'الإقرارات الضريبية', essential: false, depends_on: ['accounting'],
    areas: ['/accounting/tax-return', '/reports/vat-return'] },
  { key: 'e_invoicing', name: 'E-Invoicing', name_ar: 'الفوترة الإلكترونية', essential: false, depends_on: ['sales'], countries: ['AE', 'IN'],
    areas: ['/sales/invoices (e-invoice panel)'] },
  { key: 'tds', name: 'TDS (India)', name_ar: 'ضريبة الاستقطاع من المصدر (الهند)', essential: false, depends_on: ['purchasing'], countries: ['IN'],
    areas: ['/accounting/tds'] },
  { key: 'multi_currency', name: 'Multi-Currency', name_ar: 'تعدد العملات', essential: false, depends_on: ['accounting'],
    areas: ['/settings/exchange-rates'] },
  { key: 'automotive_catalog', name: 'Automotive Parts Catalog', name_ar: 'كتالوج قطع غيار السيارات', essential: false, depends_on: ['inventory'],
    areas: ['/products/vehicles', '/settings/vehicles', '/catalog', '/reports/sales-by-vehicle'] },
  { key: 'api_access', name: 'Developer API', name_ar: 'واجهة برمجة التطبيقات', essential: false, depends_on: ['sales'],
    areas: ['/settings/developer'] },
];

export const MODULE_KEYS: readonly ModuleKey[] = MODULES.map((m) => m.key);
const BY_KEY = new Map(MODULES.map((m) => [m.key, m]));

/** The definition of `key`; throws on an unknown key so typos fail loudly. */
export function getModule(key: ModuleKey): ModuleDefinition {
  const m = BY_KEY.get(key);
  if (!m) throw new Error(`Unknown module: ${key}`);
  return m;
}

export function isModuleKey(key: string): key is ModuleKey {
  return BY_KEY.has(key as ModuleKey);
}

/** Every module `key` needs, directly or transitively (not including itself). */
export function dependencyClosure(key: ModuleKey): ModuleKey[] {
  const out = new Set<ModuleKey>();
  const walk = (k: ModuleKey) => {
    for (const d of getModule(k).depends_on) if (!out.has(d)) { out.add(d); walk(d); }
  };
  walk(key);
  return [...out];
}
