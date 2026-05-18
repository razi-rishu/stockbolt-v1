import type { DataAdapter, CoaMap, CoaInsert } from '@/data/adapter';

type AccountDef = Omit<CoaInsert, 'company_id'>;

// All 39 Doc 3 accounts. Country-specific accounts are tagged.
// UAE/GCC: exclude India GST (1510, 1520, 1530, 2210, 2220, 2230), include VAT (1500, 2200)
// India: exclude UAE VAT (1500, 2200), include GST (1510–2230)
// 6100 Salaries excluded from v1 (payroll deferred per Doc 5)
const ALL_ACCOUNTS: (AccountDef & { gcc_only?: true; india_only?: true })[] = [
  // ── Assets — sub_type drives Balance Sheet placement ─────────────────────
  // 'current' = within 12 months / liquid; 'fixed' = long-lived (equipment, vehicles)
  { code: '1100', name: 'Cash in Hand',              name_ar: 'نقدية في الصندوق',        type: 'asset', sub_type: 'current' },
  { code: '1110', name: 'Bank Account (Main)',        name_ar: 'الحساب البنكي (رئيسي)',    type: 'asset', sub_type: 'current' },
  { code: '1200', name: 'Accounts Receivable',        name_ar: 'حسابات القبض',            type: 'asset', sub_type: 'current' },
  { code: '1250', name: 'PDC Receivable (Customer)',  name_ar: 'شيكات آجلة مستلمة',       type: 'asset', sub_type: 'current' },
  { code: '1260', name: 'Bounced Cheques',            name_ar: 'شيكات مرتجعة',            type: 'asset', sub_type: 'current' },
  { code: '1300', name: 'Inventory Asset',            name_ar: 'أصول المخزون',            type: 'asset', sub_type: 'current' },
  { code: '1400', name: 'Vendor Advances / Prepaid',  name_ar: 'سلف الموردين',            type: 'asset', sub_type: 'current' },
  { code: '1500', name: 'Input VAT (Claimable)',       name_ar: 'ضريبة القيمة المضافة المدخلات', type: 'asset', sub_type: 'current', gcc_only: true },
  { code: '1510', name: 'Input CGST',                 name_ar: 'ضريبة CGST المدخلات',     type: 'asset', sub_type: 'current', india_only: true },
  { code: '1520', name: 'Input SGST',                 name_ar: 'ضريبة SGST المدخلات',     type: 'asset', sub_type: 'current', india_only: true },
  { code: '1530', name: 'Input IGST',                 name_ar: 'ضريبة IGST المدخلات',     type: 'asset', sub_type: 'current', india_only: true },
  // ── Liabilities — 'current' = due within 12 months; 'long_term' = beyond ─
  { code: '2100', name: 'Accounts Payable',            name_ar: 'حسابات الدفع',            type: 'liability', sub_type: 'current' },
  { code: '2150', name: 'GRN Accrual',                 name_ar: 'استحقاق إيصالات البضاعة', type: 'liability', sub_type: 'current' },
  { code: '2200', name: 'Output VAT Payable',          name_ar: 'ضريبة القيمة المضافة المخرجات', type: 'liability', sub_type: 'current', gcc_only: true },
  { code: '2210', name: 'Output CGST',                 name_ar: 'ضريبة CGST المخرجات',    type: 'liability', sub_type: 'current', india_only: true },
  { code: '2220', name: 'Output SGST',                 name_ar: 'ضريبة SGST المخرجات',    type: 'liability', sub_type: 'current', india_only: true },
  { code: '2230', name: 'Output IGST',                 name_ar: 'ضريبة IGST المخرجات',    type: 'liability', sub_type: 'current', india_only: true },
  { code: '2300', name: 'Accrued Expenses',            name_ar: 'مصروفات مستحقة',         type: 'liability', sub_type: 'current' },
  { code: '2400', name: 'Customer Advances',           name_ar: 'سلف العملاء',             type: 'liability', sub_type: 'current' },
  { code: '2450', name: 'PDC Payable (Vendor)',         name_ar: 'شيكات آجلة صادرة',       type: 'liability', sub_type: 'current' },
  // ── Equity ────────────────────────────────────────────────────────────────
  { code: '3100', name: "Retained Earnings",            name_ar: 'الأرباح المحتجزة',        type: 'equity' },
  { code: '3200', name: "Owner's Equity",               name_ar: 'حقوق المالك',             type: 'equity' },
  { code: '3300', name: "Owner's Drawings",             name_ar: 'مسحوبات المالك',          type: 'equity' },
  // ── Income ────────────────────────────────────────────────────────────────
  // sub_type='direct'   → sits ABOVE Gross Profit (i.e. Sales)
  // sub_type='indirect' → sits BELOW Gross Profit (Other Income)
  { code: '4100', name: 'Sales Revenue',               name_ar: 'إيرادات المبيعات',        type: 'income', sub_type: 'direct' },
  { code: '4150', name: 'Sales Discounts',             name_ar: 'خصومات المبيعات',         type: 'income', sub_type: 'direct' },
  { code: '4200', name: 'Other Income',                name_ar: 'إيرادات أخرى',            type: 'income', sub_type: 'indirect' },
  { code: '4300', name: 'Inventory Gain',              name_ar: 'أرباح المخزون',           type: 'income', sub_type: 'indirect' },
  { code: '4400', name: 'Foreign Exchange Gain',       name_ar: 'أرباح فروق العملة',       type: 'income', sub_type: 'indirect' },
  // ── Direct expense / COGS (sits above Gross Profit) ───────────────────────
  { code: '5100', name: 'Cost of Goods Sold',          name_ar: 'تكلفة البضاعة المباعة',   type: 'expense', sub_type: 'direct' },
  { code: '5200', name: 'Purchase Discounts Received', name_ar: 'خصومات المشتريات المكتسبة', type: 'expense', sub_type: 'direct' },
  // ── Indirect expense / Operating expenses (sits below Gross Profit) ───────
  // 6100 Salaries intentionally excluded — payroll deferred to v2 (Doc 5)
  { code: '6200', name: 'Rent & Utilities',            name_ar: 'إيجار ومرافق',            type: 'expense', sub_type: 'indirect' },
  { code: '6300', name: 'Marketing & Advertising',     name_ar: 'تسويق وإعلان',            type: 'expense', sub_type: 'indirect' },
  { code: '6400', name: 'Logistics & Shipping',        name_ar: 'لوجستيات وشحن',           type: 'expense', sub_type: 'indirect' },
  { code: '6500', name: 'General & Administrative',    name_ar: 'مصروفات عمومية وإدارية', type: 'expense', sub_type: 'indirect' },
  { code: '6600', name: 'Bank Charges',                name_ar: 'رسوم بنكية',              type: 'expense', sub_type: 'indirect' },
  { code: '6700', name: 'Inventory Loss',              name_ar: 'خسائر المخزون',           type: 'expense', sub_type: 'indirect' },
  { code: '6800', name: 'Bad Debts Expense',           name_ar: 'مصروف الديون المعدومة',   type: 'expense', sub_type: 'indirect' },
  // Phase 12.23 — post-sale cash discount given on customer receipt.
  // Hit by confirm_payment when the sum of allocations' discount_amount > 0.
  { code: '6850', name: 'Discount Allowed',            name_ar: 'الخصومات المسموح بها',    type: 'expense', sub_type: 'indirect' },
  { code: '6900', name: 'Foreign Exchange Loss',       name_ar: 'خسائر فروق العملة',       type: 'expense', sub_type: 'indirect' },
];

function getAccountsForCountry(country_code: string): AccountDef[] {
  const is_india = country_code === 'IN';
  return ALL_ACCOUNTS
    .filter((a) => {
      if (a.gcc_only && is_india) return false;
      if (a.india_only && !is_india) return false;
      return true;
    })
    .map(({ gcc_only: _g, india_only: _i, ...rest }) => rest);
}

/**
 * Seeds the standard chart of accounts for a newly onboarded company.
 * Per Doc 3 Part A. Returns a code→id map for use by subsequent seed functions.
 */
export async function seedCOA(
  company_id: string,
  country_code: string,
  adapter: DataAdapter,
): Promise<CoaMap> {
  const defs = getAccountsForCountry(country_code);
  const rows: CoaInsert[] = defs.map((d) => ({
    ...d,
    company_id,
    is_system: true,
    is_active: true,
  }));

  const inserted = await adapter.onboarding.insertCoaBatch(rows);
  return Object.fromEntries(inserted.map((r) => [r.code, r.id]));
}
