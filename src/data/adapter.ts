import type { Database } from '@/types/database';

type Tables = Database['public']['Tables'];

// ── Re-exported table row types ───────────────────────────────────────────────
export type Company = Tables['companies']['Row'];
export type Profile = Tables['profiles']['Row'];
export type CoaRow = Tables['chart_of_accounts']['Row'];
export type TaxRateRow = Tables['tax_rates']['Row'];
export type PaymentMethodRow = Tables['payment_methods']['Row'];
export type UnitRow = Tables['units_of_measure']['Row'];
export type WarehouseRow = Tables['warehouses']['Row'];
export type BankAccountRow = Tables['bank_accounts']['Row'];

// Phase 2 row types
export type CategoryRow = Tables['categories']['Row'];
export type BrandRow = Tables['brands']['Row'];
export type VehicleMakeRow = Tables['vehicle_makes']['Row'];
export type VehicleModelRow = Tables['vehicle_models']['Row'];
export type ProductRow = Tables['products']['Row'];
export type ProductCompatibilityRow = Tables['product_compatibility']['Row'];
export type ProductSupplierCodeRow = Tables['product_supplier_codes']['Row'];
export type ContactRow = Tables['contacts']['Row'];
export type PriceLevelRow = Tables['price_levels']['Row'];
export type ProductPriceLevelRow = Tables['product_price_levels']['Row'];

// ── Insert helpers (used by seed services) ───────────────────────────────────
export type CoaInsert = Omit<Tables['chart_of_accounts']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type TaxRateInsert = Omit<Tables['tax_rates']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type PaymentMethodInsert = Omit<Tables['payment_methods']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type UnitInsert = Omit<Tables['units_of_measure']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type WarehouseInsert = Omit<Tables['warehouses']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type BankAccountInsert = Omit<Tables['bank_accounts']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type CompanyUpdate = Tables['companies']['Update'];

// Phase 2 insert/update types
export type CategoryInsert = Omit<Tables['categories']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type CategoryUpdate = Tables['categories']['Update'];
export type BrandInsert = Omit<Tables['brands']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type BrandUpdate = Tables['brands']['Update'];
export type VehicleMakeInsert = Omit<Tables['vehicle_makes']['Insert'], 'id' | 'created_at'>;
export type VehicleModelInsert = Omit<Tables['vehicle_models']['Insert'], 'id' | 'created_at'>;
export type ProductInsert = Omit<Tables['products']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type ProductUpdate = Tables['products']['Update'];
export type ProductCompatibilityInsert = Omit<Tables['product_compatibility']['Insert'], 'id' | 'created_at'>;
export type ProductSupplierCodeInsert = Omit<Tables['product_supplier_codes']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type ContactInsert = Omit<Tables['contacts']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type ContactUpdate = Tables['contacts']['Update'];
export type PriceLevelInsert = Omit<Tables['price_levels']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type PriceLevelUpdate = Tables['price_levels']['Update'];
export type ProductPriceLevelInsert = Omit<Tables['product_price_levels']['Insert'], 'id' | 'created_at'>;

// code → id mapping returned after COA seeding
export type CoaMap = Record<string, string>;

// ── Phase 11 — Print config ───────────────────────────────────────────────────
export interface PrintConfig {
  invoice_template:     'classic' | 'bilingual' | 'thermal';
  quote_template:       'classic' | 'bilingual';
  statement_template:   'classic';
  credit_note_template: 'classic' | 'bilingual';
  debit_note_template:  'classic' | 'bilingual';
  po_template:          'classic' | 'bilingual';
  bill_template:        'classic' | 'bilingual';
  footer_en:            string;
  footer_ar:            string;
  show_salesperson:     boolean;
  show_due_date:        boolean;
  show_bank_details:    boolean;
  accent_color:         string;
}

// ── Auth API ──────────────────────────────────────────────────────────────────
export interface AuthAPI {
  signUp(params: { email: string; password: string }): Promise<{ user_id: string }>;
  signIn(params: { email: string; password: string }): Promise<{ user_id: string }>;
  signOut(): Promise<void>;
  getCurrentUserId(): Promise<string | null>;
  getSession(): Promise<{ user_id: string; email: string } | null>;
  onAuthStateChange(
    callback: (event: 'SIGNED_IN' | 'SIGNED_OUT', user_id: string | null) => void,
  ): () => void;
  sendPasswordResetEmail(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
}

// ── Companies API ─────────────────────────────────────────────────────────────
export interface CompaniesAPI {
  list(): Promise<Company[]>;
  getById(id: string): Promise<Company | null>;
  update(id: string, data: CompanyUpdate): Promise<void>;
  uploadLogo(company_id: string, file: File): Promise<string>;
  getPrintConfig(company_id: string): Promise<PrintConfig>;
  savePrintConfig(company_id: string, config: PrintConfig): Promise<void>;
}

// ── Profiles API ──────────────────────────────────────────────────────────────
export interface ProfilesAPI {
  getCurrent(): Promise<Profile | null>;
}

// ── Onboarding API ────────────────────────────────────────────────────────────
export interface OnboardingRpcInput {
  company_name: string;
  company_name_ar: string;
  address: string;
  country_code: string;
  currency: string;
  fiscal_year_start: string;
  is_tax_registered: boolean;
  tax_id: string;
  full_name: string;
}

export interface OnboardingAPI {
  createCompanyAndProfile(input: OnboardingRpcInput): Promise<{ company_id: string }>;
  insertCoaBatch(rows: CoaInsert[]): Promise<CoaRow[]>;
  insertTaxRate(row: TaxRateInsert): Promise<void>;
  insertPaymentMethod(row: PaymentMethodInsert): Promise<void>;
  insertUnit(row: UnitInsert): Promise<void>;
  insertWarehouse(row: WarehouseInsert): Promise<{ id: string }>;
  insertBankAccount(row: BankAccountInsert): Promise<void>;
  getCoaByCodes(company_id: string, codes: string[]): Promise<CoaRow[]>;
}

// ── Phase 2 APIs ──────────────────────────────────────────────────────────────

export interface CategoriesAPI {
  list(company_id: string): Promise<CategoryRow[]>;
  create(row: CategoryInsert): Promise<CategoryRow>;
  update(id: string, row: CategoryUpdate): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface BrandsAPI {
  list(company_id: string): Promise<BrandRow[]>;
  create(row: BrandInsert): Promise<BrandRow>;
  update(id: string, row: BrandUpdate): Promise<void>;
  remove(id: string): Promise<void>;
  uploadLogo(company_id: string, brand_id: string, file: File): Promise<string>;
}

export interface WarehousesManagementAPI {
  list(company_id: string): Promise<WarehouseRow[]>;
  create(row: WarehouseInsert): Promise<WarehouseRow>;
  update(id: string, row: Partial<WarehouseInsert>): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface UnitsManagementAPI {
  list(company_id: string): Promise<UnitRow[]>;
  create(row: UnitInsert): Promise<UnitRow>;
  update(id: string, row: Partial<UnitInsert>): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface VehicleMakesAPI {
  list(company_id: string): Promise<VehicleMakeRow[]>;
  create(row: VehicleMakeInsert): Promise<VehicleMakeRow>;
  update(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  listModels(make_id: string): Promise<VehicleModelRow[]>;
  createModel(row: VehicleModelInsert): Promise<VehicleModelRow>;
  updateModel(id: string, row: Partial<VehicleModelInsert>): Promise<void>;
  removeModel(id: string): Promise<void>;
}

export interface ProductsAPI {
  list(company_id: string): Promise<ProductRow[]>;
  search(company_id: string, query: string): Promise<ProductRow[]>;
  listByModel(company_id: string, model_id: string, year?: number): Promise<ProductRow[]>;
  getById(id: string): Promise<ProductRow | null>;
  create(row: ProductInsert): Promise<ProductRow>;
  update(id: string, row: ProductUpdate): Promise<void>;
  remove(id: string): Promise<void>;
  uploadImage(company_id: string, product_id: string, file: File): Promise<string>;
  listCompatibility(product_id: string): Promise<ProductCompatibilityRow[]>;
  addCompatibility(row: ProductCompatibilityInsert): Promise<ProductCompatibilityRow>;
  removeCompatibility(id: string): Promise<void>;
  listSupplierCodes(product_id: string): Promise<ProductSupplierCodeRow[]>;
  upsertSupplierCode(row: ProductSupplierCodeInsert): Promise<void>;
  removeSupplierCode(id: string): Promise<void>;
  listPriceOverrides(product_id: string): Promise<ProductPriceLevelRow[]>;
  upsertPriceOverride(row: ProductPriceLevelInsert): Promise<void>;
  removePriceOverride(id: string): Promise<void>;
}

export interface ContactsAPI {
  list(company_id: string, type?: 'customer' | 'supplier' | 'both' | null): Promise<ContactRow[]>;
  getById(id: string): Promise<ContactRow | null>;
  create(row: ContactInsert): Promise<ContactRow>;
  update(id: string, row: ContactUpdate): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface PriceLevelsAPI {
  list(company_id: string): Promise<PriceLevelRow[]>;
  create(row: PriceLevelInsert): Promise<PriceLevelRow>;
  update(id: string, row: PriceLevelUpdate): Promise<void>;
  remove(id: string): Promise<void>;
}

// ── Phase 3 types ─────────────────────────────────────────────────────────────
export type JournalEntryRow = Tables['journal_entries']['Row'];
export type GeneralLedgerRow = Tables['general_ledger']['Row'];
export type StockLedgerRow = Tables['stock_ledger']['Row'];
export type AuditLogRow = Tables['audit_logs']['Row'];
export type StockLedgerInsert = Omit<Tables['stock_ledger']['Insert'], 'id' | 'created_at'>;

export interface JELine {
  account_code: string;
  debit: number;
  credit: number;
  description?: string;
  contact_id?: string;
}

export interface JEPayload {
  source_type: string;
  description?: string;
  date?: string;       // ISO date, defaults to today
  source_id?: string;
  currency?: string;
  exchange_rate?: number;
  lines: JELine[];
}

export interface JEPostResult {
  journal_entry_id: string;
  entry_number: string;
}

export interface TrialBalanceLine {
  account_code: string;
  account_name: string;
  account_type: string;
  debit: number;
  credit: number;
}

export interface TrialBalance {
  lines: TrialBalanceLine[];
  total_debit: number;
  total_credit: number;
  as_of_date: string;
}

export interface LedgerEntry {
  id: string;
  date: string;
  entry_number: string;
  description: string;
  debit: number;
  credit: number;
  running_balance: number;
  source_type: string;
}

export interface StockBalance {
  product_id: string;
  warehouse_id: string;
  quantity: number;
  unit_cost: number;       // current MAC
  total_value: number;
}

export interface StockMovementPayload {
  product_id: string;
  warehouse_id: string;
  company_id: string;
  date: string;
  type: string;
  direction: 1 | -1;
  quantity: number;
  unit_cost: number;
  related_doc_type?: string;
  related_doc_id?: string;
  notes?: string;
}

// ── Phase 3 APIs ──────────────────────────────────────────────────────────────

export interface CoaAPI {
  list(company_id: string): Promise<CoaRow[]>;
  create(row: CoaInsert): Promise<CoaRow>;
}

export interface AccountingAPI {
  postJE(payload: JEPayload): Promise<JEPostResult>;
  reverseJE(je_id: string, description?: string): Promise<JEPostResult>;
  listJEs(company_id: string, limit?: number): Promise<JournalEntryRow[]>;
  getJEById(id: string): Promise<JournalEntryRow | null>;
  getGLLines(je_id: string): Promise<GeneralLedgerRow[]>;
  getTrialBalance(company_id: string, as_of_date: string): Promise<TrialBalance>;
  getLedgerEntries(company_id: string, account_code: string, from: string, to: string): Promise<LedgerEntry[]>;
  setPeriodLock(company_id: string, lock_date: string | null): Promise<void>;
}

export interface StockLedgerAPI {
  postMovement(payload: StockMovementPayload): Promise<StockLedgerRow>;
  getBalance(company_id: string, product_id: string, warehouse_id: string): Promise<StockBalance>;
  getMAC(company_id: string, product_id: string): Promise<number>;
  getLedger(company_id: string, product_id: string, warehouse_id?: string): Promise<StockLedgerRow[]>;
}

// ── Phase 4 row types ─────────────────────────────────────────────────────────
export type InvoiceRow = Tables['invoices']['Row'];
export type InvoiceItemRow = Tables['invoice_items']['Row'];
export type SalesQuoteRow = Tables['sales_quotes']['Row'];
export type SalesQuoteItemRow = Tables['sales_quote_items']['Row'];
export type PaymentRow = Tables['payments']['Row'];
export type PaymentAllocationRow = Tables['payment_allocations']['Row'];

// Phase 4 insert / update types
export type InvoiceInsert = Omit<Tables['invoices']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type InvoiceUpdate = Tables['invoices']['Update'];
export type InvoiceItemInsert = Omit<Tables['invoice_items']['Insert'], 'id' | 'created_at'>;
export type SalesQuoteInsert = Omit<Tables['sales_quotes']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type SalesQuoteUpdate = Tables['sales_quotes']['Update'];
export type SalesQuoteItemInsert = Omit<Tables['sales_quote_items']['Insert'], 'id' | 'created_at'>;
export type PaymentInsert = Omit<Tables['payments']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type PaymentUpdate = Tables['payments']['Update'];
export type PaymentAllocationInsert = Omit<Tables['payment_allocations']['Insert'], 'id' | 'created_at'>;

// Phase 4 RPC result types
export interface InvoiceConfirmResult {
  invoice_id: string;
  invoice_number: string;
  je_id: string;
  entry_number: string;
}

export interface PaymentConfirmResult {
  payment_id: string;
  payment_number: string;
  je_id: string;
  entry_number: string;
}

export interface ApplyAdvanceResult {
  je_id: string;
  entry_number: string;
  payment_id: string;
  invoice_id: string;
  amount: number;
}

// Phase 4 report types
export interface ProfitAndLossLine {
  account_code: string;
  account_name: string;
  /** 'income' | 'expense' (DB type column) */
  account_type: string;
  /** 'direct' | 'indirect' | null — drives Gross Profit grouping */
  sub_type: string | null;
  amount: number;
}

export interface ProfitAndLoss {
  period_start: string;
  period_end: string;
  /** Direct income (Sales), shown above Gross Profit */
  revenue: number;
  /** Direct expense (COGS), shown above Gross Profit */
  cogs: number;
  /** = revenue − cogs */
  gross_profit: number;
  /** Indirect income (Other Income), shown below Gross Profit */
  other_income: number;
  /** Indirect expense (Operating expenses), shown below Gross Profit */
  operating_expenses: number;
  /** = gross_profit + other_income − operating_expenses */
  net_profit: number;
  lines: ProfitAndLossLine[];
}

export interface BalanceSheetLine {
  account_code: string;
  account_name: string;
  /** 'asset' | 'liability' | 'equity' (DB type column) */
  account_type: string;
  /** asset/liability: 'current' | 'fixed' | 'long_term' | null. equity: free-text tag or null. */
  sub_type: string | null;
  balance: number;
}

export interface BalanceSheet {
  as_of_date: string;
  /** Sum of asset rows where sub_type='current' (or null — null defaults to current) */
  current_assets: number;
  /** Sum of asset rows where sub_type='fixed' */
  fixed_assets: number;
  total_assets: number;
  /** Sum of liability rows where sub_type='current' (null defaults to current) */
  current_liabilities: number;
  /** Sum of liability rows where sub_type='long_term' */
  long_term_liabilities: number;
  total_liabilities: number;
  total_equity: number;
  /** = current_assets − current_liabilities */
  working_capital: number;
  lines: BalanceSheetLine[];
}

export interface ARAgingBucket {
  contact_id: string;
  contact_name: string;
  current: number;
  days_31_60: number;
  days_61_90: number;
  over_90: number;
  total: number;
}

export interface ARAgingReport {
  as_of_date: string;
  buckets: ARAgingBucket[];
  total_current: number;
  total_31_60: number;
  total_61_90: number;
  total_over_90: number;
  grand_total: number;
}

export interface CustomerStatementLine {
  date: string;
  doc_type: string;
  doc_number: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface CustomerStatement {
  contact_id: string;
  contact_name: string;
  from_date: string;
  to_date: string;
  opening_balance: number;
  lines: CustomerStatementLine[];
  closing_balance: number;
}

export interface StockValuationLine {
  product_id: string;
  product_code: string;
  product_name: string;
  warehouse_id: string;
  warehouse_name: string;
  quantity: number;
  unit_cost: number;
  total_value: number;
}

export interface StockValuationReport {
  as_of_date: string;
  lines: StockValuationLine[];
  total_value: number;
}

// ── Phase 4 APIs ──────────────────────────────────────────────────────────────

/** Invoice + computed outstanding (total_amount minus sum of payment_allocations) */
export interface OpenInvoice extends InvoiceRow {
  outstanding: number;
}

export interface InvoicesAPI {
  list(company_id: string, status?: string): Promise<InvoiceRow[]>;
  getById(id: string): Promise<InvoiceRow | null>;
  getItems(invoice_id: string): Promise<InvoiceItemRow[]>;
  create(row: InvoiceInsert, items: InvoiceItemInsert[]): Promise<InvoiceRow>;
  update(id: string, row: InvoiceUpdate, items: InvoiceItemInsert[]): Promise<void>;
  confirm(invoice_id: string): Promise<InvoiceConfirmResult>;
  void(invoice_id: string, reason?: string): Promise<void>;
  edit(invoice_id: string): Promise<void>;
  getNextNumber(company_id: string): Promise<string>;
  /**
   * Returns confirmed invoices for a customer that still have a positive
   * outstanding balance (total_amount > sum of payment_allocations applied).
   * Sorted by date ascending (oldest first) so callers can apply FIFO.
   */
  listOpenForContact(company_id: string, contact_id: string): Promise<OpenInvoice[]>;
}

export interface SalesQuotesAPI {
  list(company_id: string): Promise<SalesQuoteRow[]>;
  getById(id: string): Promise<SalesQuoteRow | null>;
  getItems(quote_id: string): Promise<SalesQuoteItemRow[]>;
  create(row: SalesQuoteInsert, items: SalesQuoteItemInsert[]): Promise<SalesQuoteRow>;
  update(id: string, row: SalesQuoteUpdate, items: SalesQuoteItemInsert[]): Promise<void>;
  convertToInvoice(quote_id: string): Promise<InvoiceRow>;
  remove(id: string): Promise<void>;
  getNextNumber(company_id: string): Promise<string>;
}

export interface PaymentsAPI {
  list(company_id: string, type?: 'inbound' | 'outbound'): Promise<PaymentRow[]>;
  getById(id: string): Promise<PaymentRow | null>;
  getAllocations(payment_id: string): Promise<PaymentAllocationRow[]>;
  create(row: PaymentInsert, allocations?: PaymentAllocationInsert[]): Promise<PaymentRow>;
  /**
   * Update a DRAFT payment + replace its allocations atomically.
   * Server-side guards: refuses if status != 'draft', refuses if any
   * allocation doesn't belong to this contact, refuses if total > amount.
   */
  update(id: string, row: Partial<PaymentInsert>, allocations?: PaymentAllocationInsert[]): Promise<PaymentRow>;
  confirm(payment_id: string): Promise<PaymentConfirmResult>;
  applyAdvance(payment_id: string, invoice_id: string, amount: number): Promise<ApplyAdvanceResult>;
  void(payment_id: string, reason?: string): Promise<void>;
  getNextNumber(company_id: string): Promise<string>;
}

export interface BankAccountsAPI {
  list(company_id: string): Promise<BankAccountRow[]>;
  getById(id: string): Promise<BankAccountRow | null>;
  create(row: BankAccountInsert): Promise<BankAccountRow>;
  update(id: string, row: Partial<BankAccountInsert>): Promise<void>;
}

export interface TaxRatesAPI {
  list(company_id: string): Promise<TaxRateRow[]>;
}

export interface ReportsAPI {
  getProfitAndLoss(company_id: string, from: string, to: string): Promise<ProfitAndLoss>;
  getBalanceSheet(company_id: string, as_of_date: string): Promise<BalanceSheet>;
  getARAgingReport(company_id: string, as_of_date: string): Promise<ARAgingReport>;
  getCustomerStatement(company_id: string, contact_id: string, from: string, to: string): Promise<CustomerStatement>;
  getStockValuation(company_id: string, as_of_date: string): Promise<StockValuationReport>;
  getAPAgingReport(company_id: string, as_of_date: string): Promise<APAgingReport>;
  getSupplierStatement(company_id: string, contact_id: string, from: string, to: string): Promise<SupplierStatement>;
  getGRNReconciliation(company_id: string, as_of_date: string): Promise<GRNReconciliationReport>;
  // Phase 6 reports
  getStockMovement(company_id: string, params: { product_id?: string; warehouse_id?: string; date_from: string; date_to: string }): Promise<StockMovementLine[]>;
  getSlowMoving(company_id: string, params: { threshold_days: number }): Promise<SlowMovingLine[]>;
  getReorderReport(company_id: string): Promise<ReorderLine[]>;
  getStockAging(company_id: string): Promise<StockAgingLine[]>;
  getInventoryAdjustmentReport(company_id: string, params: { date_from: string; date_to: string }): Promise<InventoryAdjustmentReportLine[]>;
  // Phase 8 reports
  dailyCash(company_id: string, date: string): Promise<DailyCashLine[]>;
  bankRecon(company_id: string, account_id: string, date_from: string, date_to: string): Promise<BankReconLine[]>;
  // Phase 10 reports
  getSalesByCustomer(company_id: string, from: string, to: string): Promise<SalesByCustomerLine[]>;
  getSalesByProduct(company_id: string, from: string, to: string): Promise<SalesByProductLine[]>;
  getSalesByBrand(company_id: string, from: string, to: string): Promise<SalesByBrandLine[]>;
  getSalesByVehicle(company_id: string, from: string, to: string): Promise<SalesByVehicleLine[]>;
  getSalesBySalesperson(company_id: string, from: string, to: string): Promise<SalesBySalespersonLine[]>;
  getSalesTrend(company_id: string, from: string, to: string, bucket: 'day' | 'week' | 'month'): Promise<SalesTrendLine[]>;
  getPurchasesBySupplier(company_id: string, from: string, to: string): Promise<PurchasesBySupplierLine[]>;
  getPurchasesByProduct(company_id: string, from: string, to: string): Promise<PurchasesByProductLine[]>;
  getOutstandingPOs(company_id: string): Promise<OutstandingPOLine[]>;
  getVATReturn(company_id: string, from: string, to: string): Promise<VATReturn>;
  getAuditLog(company_id: string, params: { from?: string; to?: string; limit?: number }): Promise<AuditLogLine[]>;
  getReversalTrail(company_id: string, from: string, to: string): Promise<ReversalTrailLine[]>;
  getCashFlow(company_id: string, from: string, to: string): Promise<CashFlowStatement>;
  getOwnerDashboard(company_id: string): Promise<OwnerDashboard>;
}

// ── Phase 10 report types ─────────────────────────────────────────────────────

export interface SalesByCustomerLine {
  contact_id: string;
  contact_name: string;
  invoice_count: number;
  gross_sales: number;
  returns: number;
  net_sales: number;
  gross_profit: number;
  gp_pct: number;
}

export interface SalesByProductLine {
  product_id: string;
  sku: string;
  product_name: string;
  brand_name: string;
  qty_sold: number;
  net_sales: number;
  gross_profit: number;
  gp_pct: number;
}

export interface SalesByBrandLine {
  brand_id: string;
  brand_name: string;
  qty_sold: number;
  revenue: number;
  gross_profit: number;
  gp_pct: number;
  stock_value: number;
}

export interface SalesByVehicleLine {
  make_id: string;
  make_name: string;
  model_id: string | null;
  model_name: string | null;
  qty: number;
  revenue: number;
  gross_profit: number;
}

export interface SalesBySalespersonLine {
  salesperson_id: string | null;
  salesperson_name: string;
  invoice_count: number;
  net_sales: number;
  gross_profit: number;
  gp_pct: number;
  avg_invoice_value: number;
}

export interface SalesTrendLine {
  bucket: string;
  invoice_count: number;
  gross_sales: number;
  returns: number;
  net_sales: number;
  gross_profit: number;
}

export interface PurchasesBySupplierLine {
  contact_id: string;
  contact_name: string;
  bill_count: number;
  gross_purchases: number;
  returns: number;
  net_purchases: number;
  pct_of_total: number;
}

export interface PurchasesByProductLine {
  product_id: string;
  sku: string;
  product_name: string;
  qty_purchased: number;
  total_cost: number;
  avg_unit_cost: number;
}

export interface OutstandingPOLine {
  po_id: string;
  po_number: string;
  supplier_name: string;
  date: string;
  expected_delivery: string | null;
  total: number;
  received_value: number;
  pending_value: number;
}

export interface VATReturnBox {
  box: string;
  label: string;
  taxable_amount: number;
  vat_amount: number;
}

export interface VATReturn {
  period_start: string;
  period_end: string;
  output_boxes: VATReturnBox[];
  total_output_vat: number;
  input_boxes: VATReturnBox[];
  total_input_vat: number;
  net_vat_payable: number;
}

export interface AuditLogLine {
  id: string;
  created_at: string;
  user_id: string | null;
  user_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
}

export interface ReversalTrailLine {
  original_entry_number: string;
  original_date: string;
  reversal_entry_number: string;
  reversal_date: string;
  amount: number;
  source_type: string;
  reversed_by: string;
}

export interface CashFlowSection {
  label: string;
  amount: number;
}

export interface CashFlowStatement {
  period_start: string;
  period_end: string;
  net_profit: number;
  operating_adjustments: CashFlowSection[];
  working_capital_changes: CashFlowSection[];
  net_operating: number;
  investing_activities: CashFlowSection[];
  net_investing: number;
  financing_activities: CashFlowSection[];
  net_financing: number;
  net_increase: number;
  opening_cash: number;
  closing_cash: number;
}

export interface OwnerDashboard {
  // ── Today snapshots ────────────────────────────────────────────────────
  today_sales_count: number;
  today_sales_amount: number;
  today_sales_amount_prev: number;     // yesterday's confirmed sales (for delta %)
  today_purchases_amount: number;      // confirmed vendor bills today
  today_purchases_amount_prev: number; // yesterday's confirmed bill total
  // ── Snapshot totals (current value + value 30 days ago for delta) ─────
  inventory_value: number;
  inventory_value_prev: number;
  sku_count: number;
  sku_count_prev: number;
  outstanding_ar: number;
  outstanding_ar_prev: number;
  outstanding_ap: number;
  outstanding_ap_prev: number;
  cash_and_bank: number;
  // ── Lists & trends ────────────────────────────────────────────────────
  top_products: { product_id: string; name: string; qty: number; revenue: number }[];
  top_customers: { contact_id: string; name: string; sales: number }[];
  low_stock_count: number;
  overdue_invoices_count: number;
  /** 7-day trend (sales + purchases per day) */
  trend_7d: { date: string; sales: number; purchases: number }[];
  /** Recent inventory additions — latest products created */
  recent_inventory: { product_id: string; name: string; oe_number: string | null; sku: string; unit_code: string; quantity: number }[];
}

export interface InvariantResult {
  name: string;
  invariant: string;
  pass: boolean;
  difference?: number;
  [key: string]: unknown;
}

/** One malformed journal entry surfaced by find_malformed_jes. */
export interface MalformedJE {
  je_id: string;
  entry_number: string;
  date: string;
  source_type: string | null;
  source_id: string | null;
  header_debit: number;
  header_credit: number;
  body_debit: number;
  body_credit: number;
  delta_vs_header: number;
  delta_internal: number;
  problem: string;
}

/** Result of a one-click repair on a malformed JE. */
export interface RepairResult {
  status: 'repaired' | 'already_balanced' | 'partial';
  rows_added: number;
  new_body_debit: number;
  new_body_credit: number;
}

/** One customer's drift between AR-aging calc and GL 1200 (for B1). */
export interface ArMismatch {
  contact_id: string;
  contact_name: string;
  gl_balance: number;     // net DR on 1200 for this contact
  aging_balance: number;  // sum(invoices) - sum(allocations) - sum(CNs)
  difference: number;
}

/** One product's drift between latest stock-value and its txn-sum (for E1). */
export interface StockMismatch {
  product_id: string;
  product_name: string;
  sku: string;
  stock_value: number;   // sum(running_qty * MAC) latest per warehouse
  stock_txn_sum: number; // sum(qty * direction * unit_cost) all rows
  difference: number;
}

export interface SystemHealthAPI {
  check(company_id: string, as_of_date?: string): Promise<InvariantResult[]>;
  /** Lists the specific JEs that fail the JE_BAL invariant. */
  findMalformedJEs(company_id: string, as_of_date?: string): Promise<MalformedJE[]>;
  /** Surgical repair for a vendor_bill JE whose body is unbalanced. */
  repairVendorBillJE(je_id: string): Promise<RepairResult>;
  /** Per-customer AR drift table (for B1 failures). */
  findArMismatches(company_id: string, as_of_date?: string): Promise<ArMismatch[]>;
  /** Per-product stock value drift table (for E1 failures). */
  findStockMismatches(company_id: string, as_of_date?: string): Promise<StockMismatch[]>;
}

// ── Phase 5 row types ─────────────────────────────────────────────────────────
export type PurchaseOrderRow = Tables['purchase_orders']['Row'];
export type PurchaseOrderItemRow = Tables['purchase_order_items']['Row'];
export type GoodsReceiptRow = Tables['goods_receipts']['Row'];
export type GoodsReceiptItemRow = Tables['goods_receipt_items']['Row'];
export type VendorBillRow = Tables['vendor_bills']['Row'];
export type VendorBillItemRow = Tables['vendor_bill_items']['Row'] & { coa_account_id?: string | null };
export type DebitNoteRow = Tables['debit_notes']['Row'];

// Phase 5 insert / update types
export type PurchaseOrderInsert = Omit<Tables['purchase_orders']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type PurchaseOrderUpdate = Tables['purchase_orders']['Update'];
export type PurchaseOrderItemInsert = Omit<Tables['purchase_order_items']['Insert'], 'id' | 'created_at'>;
export type GoodsReceiptInsert = Omit<Tables['goods_receipts']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type GoodsReceiptUpdate = Tables['goods_receipts']['Update'];
export type GoodsReceiptItemInsert = Omit<Tables['goods_receipt_items']['Insert'], 'id' | 'created_at'>;
export type VendorBillInsert = Omit<Tables['vendor_bills']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type VendorBillUpdate = Tables['vendor_bills']['Update'];
export type VendorBillItemInsert = Omit<Tables['vendor_bill_items']['Insert'], 'id' | 'created_at'> & { coa_account_id?: string | null };

// Phase 5 RPC result types
export interface GRNConfirmResult {
  grn_id: string;
  grn_number: string;
  je_id: string;
  entry_number: string;
}

export interface BillConfirmResult {
  bill_id: string;
  bill_number: string;
  je_id: string;
  entry_number: string;
}

export interface VendorPaymentConfirmResult {
  payment_id: string;
  payment_number: string;
  je_id: string;
  entry_number: string;
}

export interface ApplyVendorAdvanceResult {
  je_id: string;
  entry_number: string;
  payment_id: string;
  bill_id: string;
  amount: number;
}

// Phase 5 report types
export interface APAgingBucket {
  contact_id: string;
  contact_name: string;
  current: number;
  days_31_60: number;
  days_61_90: number;
  over_90: number;
  total: number;
}

export interface APAgingReport {
  as_of_date: string;
  buckets: APAgingBucket[];
  total_current: number;
  total_31_60: number;
  total_61_90: number;
  total_over_90: number;
  grand_total: number;
}

export interface SupplierStatementLine {
  date: string;
  doc_type: string;
  doc_number: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface SupplierStatement {
  contact_id: string;
  contact_name: string;
  from_date: string;
  to_date: string;
  opening_balance: number;
  lines: SupplierStatementLine[];
  closing_balance: number;
}

export interface GRNReconciliationLine {
  grn_id: string;
  grn_number: string;
  supplier_id: string;
  supplier_name: string;
  date: string;
  total_cost: number;
  billed_amount: number;
  unbilled_amount: number;
}

export interface GRNReconciliationReport {
  as_of_date: string;
  lines: GRNReconciliationLine[];
  total_accrual: number;
  total_billed: number;
  total_unbilled: number;
}

// ── Phase 5 APIs ──────────────────────────────────────────────────────────────

export interface PurchaseOrdersAPI {
  list(company_id: string, status?: string): Promise<PurchaseOrderRow[]>;
  getById(id: string): Promise<PurchaseOrderRow | null>;
  getItems(po_id: string): Promise<PurchaseOrderItemRow[]>;
  create(row: PurchaseOrderInsert, items: PurchaseOrderItemInsert[]): Promise<PurchaseOrderRow>;
  update(id: string, row: PurchaseOrderUpdate, items: PurchaseOrderItemInsert[]): Promise<void>;
  send(id: string): Promise<void>;
  close(id: string): Promise<void>;
  getNextNumber(company_id: string): Promise<string>;
}

export interface GoodsReceiptsAPI {
  list(company_id: string, status?: string): Promise<GoodsReceiptRow[]>;
  getById(id: string): Promise<GoodsReceiptRow | null>;
  getItems(grn_id: string): Promise<GoodsReceiptItemRow[]>;
  create(row: GoodsReceiptInsert, items: GoodsReceiptItemInsert[]): Promise<GoodsReceiptRow>;
  update(id: string, row: GoodsReceiptUpdate, items: GoodsReceiptItemInsert[]): Promise<void>;
  confirm(grn_id: string): Promise<GRNConfirmResult>;
  getNextNumber(company_id: string): Promise<string>;
}

/** Vendor bill + computed outstanding (total_amount minus sum of payment_allocations) */
export interface OpenVendorBill extends VendorBillRow {
  outstanding: number;
}

export interface VendorBillsAPI {
  list(company_id: string, status?: string): Promise<VendorBillRow[]>;
  getById(id: string): Promise<VendorBillRow | null>;
  getItems(bill_id: string): Promise<VendorBillItemRow[]>;
  create(row: VendorBillInsert, items: VendorBillItemInsert[]): Promise<VendorBillRow>;
  update(id: string, row: VendorBillUpdate, items: VendorBillItemInsert[]): Promise<void>;
  confirm(bill_id: string): Promise<BillConfirmResult>;
  getNextNumber(company_id: string): Promise<string>;
  /**
   * Confirmed vendor bills for a supplier that still have a positive
   * outstanding balance. Mirror of InvoicesAPI.listOpenForContact.
   */
  listOpenForSupplier(company_id: string, supplier_id: string): Promise<OpenVendorBill[]>;
}

export interface VendorPaymentsAPI {
  list(company_id: string): Promise<PaymentRow[]>;
  getById(id: string): Promise<PaymentRow | null>;
  getAllocations(payment_id: string): Promise<PaymentAllocationRow[]>;
  create(row: PaymentInsert, allocations?: PaymentAllocationInsert[]): Promise<PaymentRow>;
  /**
   * Update a DRAFT vendor payment + replace its allocations atomically.
   * Server-side guards: refuses if status != 'draft', refuses if any
   * allocation doesn't belong to this supplier, refuses if total > amount.
   */
  update(id: string, row: Partial<PaymentInsert>, allocations?: PaymentAllocationInsert[]): Promise<PaymentRow>;
  confirm(payment_id: string): Promise<VendorPaymentConfirmResult>;
  applyAdvance(payment_id: string, bill_id: string, amount: number): Promise<ApplyVendorAdvanceResult>;
  getNextNumber(company_id: string): Promise<string>;
}

// ── Phase 6 row types ─────────────────────────────────────────────────────────

export type StockTransferRow     = Tables['stock_transfers']['Row'];
export type StockTransferInsert  = Tables['stock_transfers']['Insert'];
export type StockTransferUpdate  = Tables['stock_transfers']['Update'];
export type StockTransferItemRow    = Tables['stock_transfer_items']['Row'];
export type StockTransferItemInsert = Tables['stock_transfer_items']['Insert'];

export type InventoryAdjustmentRow    = Tables['inventory_adjustments']['Row'];
export type InventoryAdjustmentInsert = Tables['inventory_adjustments']['Insert'];
export type InventoryAdjustmentUpdate = Tables['inventory_adjustments']['Update'];
export type AdjustmentItemRow    = Tables['inventory_adjustment_items']['Row'];
export type AdjustmentItemInsert = Tables['inventory_adjustment_items']['Insert'];

export type ProductSerialRow    = Tables['product_serials']['Row'];
export type ProductSerialInsert = Tables['product_serials']['Insert'];
export type ProductSerialUpdate = Tables['product_serials']['Update'];

// Phase 6 RPC result types
export interface TransferConfirmResult {
  transfer_id: string;
  transfer_number: string;
}

export interface AdjustmentConfirmResult {
  adjustment_id: string;
  adjustment_number: string;
  gain_je_id: string | null;
  loss_je_id: string | null;
  total_gain: number;
  total_loss: number;
}

// Phase 6 report types
export interface StockMovementLine {
  product_id: string;
  product_name: string;
  sku: string;
  warehouse_id: string;
  warehouse_name: string;
  date: string;
  movement_type: string;
  direction: number;
  quantity: number;
  unit_cost: number;
  running_qty: number;
  running_value: number;
}

export interface SlowMovingLine {
  product_id: string;
  product_name: string;
  sku: string;
  warehouse_id: string;
  warehouse_name: string;
  qty_on_hand: number;
  unit_cost: number;
  stock_value: number;
  last_movement_date: string | null;
  days_idle: number;
  aging_bucket: string;
}

export interface ReorderLine {
  product_id: string;
  product_name: string;
  sku: string;
  warehouse_id: string;
  warehouse_name: string;
  qty_on_hand: number;
  unit_cost: number;
  min_stock_level: number;
  shortage: number;
}

export interface StockAgingLine {
  product_id: string;
  product_name: string;
  sku: string;
  warehouse_id: string;
  warehouse_name: string;
  qty_on_hand: number;
  unit_cost: number;
  stock_value: number;
  last_movement_date: string | null;
  days_idle: number;
  aging_bucket: string;
}

export interface InventoryAdjustmentReportLine {
  adjustment_id: string;
  adjustment_number: string;
  date: string;
  warehouse_id: string;
  reason: string;
  total_gain: number;
  total_loss: number;
  net: number;
}

// ── Phase 6 APIs ──────────────────────────────────────────────────────────────

export interface StockTransfersAPI {
  list(company_id: string, status?: string): Promise<StockTransferRow[]>;
  getById(id: string): Promise<StockTransferRow | null>;
  getItems(transfer_id: string): Promise<StockTransferItemRow[]>;
  create(row: StockTransferInsert, items: StockTransferItemInsert[]): Promise<StockTransferRow>;
  update(id: string, row: StockTransferUpdate, items: StockTransferItemInsert[]): Promise<void>;
  confirm(transfer_id: string): Promise<TransferConfirmResult>;
  getNextNumber(company_id: string): Promise<string>;
}

export interface InventoryAdjustmentsAPI {
  list(company_id: string, status?: string): Promise<InventoryAdjustmentRow[]>;
  getById(id: string): Promise<InventoryAdjustmentRow | null>;
  getItems(adjustment_id: string): Promise<AdjustmentItemRow[]>;
  create(row: InventoryAdjustmentInsert, items: AdjustmentItemInsert[]): Promise<InventoryAdjustmentRow>;
  confirm(adjustment_id: string): Promise<AdjustmentConfirmResult>;
  getNextNumber(company_id: string): Promise<string>;
}

export interface ProductSerialsAPI {
  listByProduct(company_id: string, product_id: string): Promise<ProductSerialRow[]>;
  listByWarehouse(company_id: string, warehouse_id: string, status?: string): Promise<ProductSerialRow[]>;
  create(row: ProductSerialInsert): Promise<ProductSerialRow>;
  updateStatus(id: string, status: string): Promise<void>;
}

// ── Phase 7 row types ─────────────────────────────────────────────────────────

export type PosSessionRow = Tables['pos_sessions']['Row'];

// Phase 7 RPC result types
export interface OpenSessionResult {
  session_id:     string;
  session_number: string;
  warehouse_id:   string;
  opening_cash:   number;
  opened_at:      string;
}

export interface CloseSessionResult {
  session_id:          string;
  session_number:      string;
  opening_cash:        number;
  cash_sales:          number;
  expected_cash:       number;
  counted_cash:        number;
  variance:            number;
  total_sales_amount:  number;
  total_sales_count:   number;
}

export interface PosSaleResult {
  invoice_id:     string;
  invoice_number: string;
  total_amount:   number;
}

// Phase 7 report types
export interface POSSessionReportLine {
  session_id:          string;
  session_number:      string;
  opened_at:           string;
  closed_at:           string | null;
  warehouse_id:        string;
  warehouse_name:      string;
  opening_cash:        number;
  total_sales_amount:  number;
  total_sales_count:   number;
  closing_cash_counted: number | null;
  cash_variance:        number | null;
  status:              string;
}

export interface DailySalesSummaryLine {
  date:         string;
  cash_total:   number;
  card_total:   number;
  credit_total: number;
  grand_total:  number;
  invoice_count: number;
}

// Phase 7 POS cart item (sent to confirm_pos_sale RPC)
export interface POSSaleItem {
  product_id:       string;
  description:      string;
  quantity:         number;
  unit_price:       number;
  discount_percent: number;
  tax_rate:         number;
}

// Phase 7 API
export interface PosAPI {
  openSession(warehouse_id: string, opening_cash: number): Promise<OpenSessionResult>;
  getOpenSession(company_id: string): Promise<PosSessionRow | null>;
  closeSession(session_id: string, counted_cash: number, variance_reason?: string): Promise<CloseSessionResult>;
  confirmSale(
    session_id: string,
    items: POSSaleItem[],
    payment_method: 'cash' | 'card' | 'credit',
    customer_id?: string | null,
    notes?: string
  ): Promise<PosSaleResult>;
  getSessionSales(session_id: string): Promise<InvoiceRow[]>;
  listSessions(company_id: string, params?: { status?: string; date_from?: string; date_to?: string }): Promise<PosSessionRow[]>;
  getPOSSessionReport(company_id: string, params?: { date_from?: string; date_to?: string }): Promise<POSSessionReportLine[]>;
  getDailySalesSummary(company_id: string, params: { date_from: string; date_to: string }): Promise<DailySalesSummaryLine[]>;
}

// ── Phase 9 row types ─────────────────────────────────────────────────────────
export type CreditNoteRow     = Tables['credit_notes']['Row'];
export type CreditNoteItemRow = Tables['credit_note_items']['Row'];
export type CreditNoteInsert  = Omit<Tables['credit_notes']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type CreditNoteUpdate  = Tables['credit_notes']['Update'];
export type CreditNoteItemInsert = Omit<Tables['credit_note_items']['Insert'], 'id' | 'created_at'>;

export type SalesReturnRow     = Tables['sales_returns']['Row'];
export type SalesReturnItemRow = Tables['sales_return_items']['Row'];
export type SalesReturnInsert  = Omit<Tables['sales_returns']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type SalesReturnUpdate  = Tables['sales_returns']['Update'];
export type SalesReturnItemInsert = Omit<Tables['sales_return_items']['Insert'], 'id' | 'created_at'>;

export type DebitNoteItemRow    = Tables['debit_note_items']['Row'];
export type DebitNoteInsert     = Omit<Tables['debit_notes']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type DebitNoteUpdate     = Tables['debit_notes']['Update'];
export type DebitNoteItemInsert = Omit<Tables['debit_note_items']['Insert'], 'id' | 'created_at'>;

// Phase 9 RPC result types
export interface CreditNoteConfirmResult {
  credit_note_id:     string;
  credit_note_number: string;
  journal_entry_id:   string;
  entry_number:       string;
}
export interface DebitNoteConfirmResult {
  debit_note_id:     string;
  debit_note_number: string;
  journal_entry_id:  string;
  entry_number:      string;
}

// Phase 9 API interfaces
export interface CreditNotesAPI {
  list(company_id: string, params?: { status?: string; contact_id?: string; date_from?: string; date_to?: string }): Promise<CreditNoteRow[]>;
  getById(id: string): Promise<CreditNoteRow | null>;
  getItems(credit_note_id: string): Promise<CreditNoteItemRow[]>;
  create(row: CreditNoteInsert, items: CreditNoteItemInsert[]): Promise<CreditNoteRow>;
  update(id: string, row: CreditNoteUpdate, items: CreditNoteItemInsert[]): Promise<void>;
  confirm(id: string): Promise<CreditNoteConfirmResult>;
  void(id: string, reason?: string): Promise<void>;
  getNextNumber(company_id: string): Promise<string>;
}

export interface SalesReturnsAPI {
  list(company_id: string, params?: { status?: string; date_from?: string; date_to?: string }): Promise<SalesReturnRow[]>;
  getById(id: string): Promise<SalesReturnRow | null>;
  getItems(sales_return_id: string): Promise<SalesReturnItemRow[]>;
  create(row: SalesReturnInsert, items: SalesReturnItemInsert[]): Promise<SalesReturnRow>;
  getNextNumber(company_id: string): Promise<string>;
}

export interface DebitNotesAPI {
  list(company_id: string, params?: { status?: string; supplier_id?: string; date_from?: string; date_to?: string }): Promise<DebitNoteRow[]>;
  getById(id: string): Promise<DebitNoteRow | null>;
  getItems(debit_note_id: string): Promise<DebitNoteItemRow[]>;
  create(row: DebitNoteInsert, items: DebitNoteItemInsert[]): Promise<DebitNoteRow>;
  update(id: string, row: DebitNoteUpdate, items: DebitNoteItemInsert[]): Promise<void>;
  confirm(id: string): Promise<DebitNoteConfirmResult>;
  void(id: string, reason?: string): Promise<void>;
  getNextNumber(company_id: string): Promise<string>;
}

// ── Phase 8 row types ─────────────────────────────────────────────────────────
export type BankTransferRow = Tables['bank_transfers']['Row'];
export type BankTransferInsert = Omit<Tables['bank_transfers']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type BankTransferUpdate = Tables['bank_transfers']['Update'];

export type ExpenseRow = Tables['expenses']['Row'];
export type ExpenseInsert = Omit<Tables['expenses']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type ExpenseUpdate = Tables['expenses']['Update'];

export type PDCChequeRow = Tables['pdc_cheques']['Row'];
export type PDCChequeInsert = Omit<Tables['pdc_cheques']['Insert'], 'id' | 'created_at' | 'updated_at'>;

// Phase 8 result types
export interface BankTransferConfirmResult { transfer_id: string; journal_entry_id: string }
export interface ExpenseConfirmResult { expense_id: string; journal_entry_id: string }
export interface CreatePDCResult { pdc_id: string; pdc_number: string; journal_entry_id: string }
export interface PDCActionResult { pdc_id: string; status: string; journal_entry_id?: string }

// Phase 8 report line types
export interface DailyCashLine {
  account_id:       string;
  account_code:     string;
  account_name:     string;
  opening_balance:  number;
  total_in:         number;
  total_out:        number;
  closing_balance:  number;
}
export interface BankReconLine {
  date:             string;
  je_number:        string;
  source_type:      string;
  description:      string;
  debit:            number;
  credit:           number;
  running_balance:  number;
}

// Phase 8 API interfaces
export interface BankTransfersAPI {
  list(company_id: string, params?: { status?: string; date_from?: string; date_to?: string }): Promise<BankTransferRow[]>;
  getById(id: string): Promise<BankTransferRow>;
  create(data: BankTransferInsert): Promise<BankTransferRow>;
  update(id: string, data: BankTransferUpdate): Promise<BankTransferRow>;
  confirm(id: string): Promise<BankTransferConfirmResult>;
  void(id: string, reason?: string): Promise<void>;
  getNextNumber(company_id: string): Promise<string>;
}

export interface ExpensesAPI {
  list(company_id: string, params?: { status?: string; date_from?: string; date_to?: string }): Promise<ExpenseRow[]>;
  getById(id: string): Promise<ExpenseRow>;
  create(data: ExpenseInsert): Promise<ExpenseRow>;
  update(id: string, data: ExpenseUpdate): Promise<ExpenseRow>;
  confirm(id: string): Promise<ExpenseConfirmResult>;
  void(id: string, reason?: string): Promise<void>;
  getNextNumber(company_id: string): Promise<string>;
}

export interface PDCCreateParams {
  type:                'received' | 'issued';
  contact_id:          string;
  cheque_number:       string;
  bank_name?:          string;
  amount:              number;
  currency:            string;
  issue_date:          string;
  due_date:            string;
  deposit_account_id?: string;
  linked_payment_id?:  string;
  is_advance?:         boolean;
  notes?:              string;
}

export interface PDCChequesAPI {
  list(company_id: string, params?: { type?: 'received' | 'issued'; status?: string; date_from?: string; date_to?: string }): Promise<PDCChequeRow[]>;
  getById(id: string): Promise<PDCChequeRow>;
  create(params: PDCCreateParams): Promise<CreatePDCResult>;
  deposit(pdc_id: string): Promise<PDCActionResult>;
  clear(pdc_id: string, deposit_account_id?: string): Promise<PDCActionResult>;
  bounce(pdc_id: string): Promise<PDCActionResult>;
  cancel(pdc_id: string): Promise<PDCActionResult>;
}

// ── Root adapter ──────────────────────────────────────────────────────────────
export interface DataAdapter {
  auth: AuthAPI;
  companies: CompaniesAPI;
  profiles: ProfilesAPI;
  onboarding: OnboardingAPI;
  // Phase 2
  categories: CategoriesAPI;
  brands: BrandsAPI;
  warehouses: WarehousesManagementAPI;
  units: UnitsManagementAPI;
  vehicleMakes: VehicleMakesAPI;
  products: ProductsAPI;
  contacts: ContactsAPI;
  priceLevels: PriceLevelsAPI;
  // Phase 3
  coa: CoaAPI;
  accounting: AccountingAPI;
  stockLedger: StockLedgerAPI;
  // Phase 4
  invoices: InvoicesAPI;
  salesQuotes: SalesQuotesAPI;
  payments: PaymentsAPI;
  bankAccounts: BankAccountsAPI;
  taxRates: TaxRatesAPI;
  reports: ReportsAPI;
  // Phase 5
  purchaseOrders: PurchaseOrdersAPI;
  goodsReceipts: GoodsReceiptsAPI;
  vendorBills: VendorBillsAPI;
  vendorPayments: VendorPaymentsAPI;
  // Phase 6
  stockTransfers: StockTransfersAPI;
  inventoryAdjustments: InventoryAdjustmentsAPI;
  productSerials: ProductSerialsAPI;
  // Phase 7
  pos: PosAPI;
  // Phase 8
  bankTransfers: BankTransfersAPI;
  expenses: ExpensesAPI;
  pdcCheques: PDCChequesAPI;
  // Phase 9
  creditNotes: CreditNotesAPI;
  salesReturns: SalesReturnsAPI;
  debitNotes: DebitNotesAPI;
  // Phase 10
  systemHealth: SystemHealthAPI;
}
