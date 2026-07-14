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
export type ProductCompatibilityRow = Tables['product_compatibility']['Row'] & CompatibilityVehicleFields;
export type ProductSupplierCodeRow = Tables['product_supplier_codes']['Row'];
// Phase 16 — structured geography. These columns are added by migration but
// may not be in the generated Database types yet, so we intersect them on.
export interface ContactGeoFields {
  country_code?: string | null;
  region_id?:    string | null;
  area_id?:      string | null;
}
export type ContactRow = Tables['contacts']['Row'] & ContactGeoFields;
export type PriceLevelRow = Tables['price_levels']['Row'];
export type ProductPriceLevelRow = Tables['product_price_levels']['Row'];

// ── Insert helpers (used by seed services) ───────────────────────────────────
export type CoaInsert = Omit<Tables['chart_of_accounts']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type CoaUpdate = Tables['chart_of_accounts']['Update'];
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

// ── Phase 32 — deep vehicle hierarchy (new tables; not in generated DB types yet)
export interface VehicleEngineRow {
  id: string; company_id: string | null; engine_code: string;
  displacement_cc: number | null; fuel_type: string | null; power_hp: number | null;
  description: string | null; is_active: boolean;
  external_source: string | null; external_ref: string | null;
  created_at: string; updated_at: string;
}
export interface VehicleEngineInsert {
  company_id?: string | null; engine_code: string;
  displacement_cc?: number | null; fuel_type?: string | null; power_hp?: number | null;
  description?: string | null; is_active?: boolean;
  external_source?: string | null; external_ref?: string | null;
}
export interface VehicleGenerationRow {
  id: string; model_id: string; name: string; code: string | null;
  year_from: number | null; year_to: number | null; is_active: boolean;
  external_source: string | null; external_ref: string | null;
  created_at: string; updated_at: string;
}
export interface VehicleGenerationInsert {
  model_id: string; name: string; code?: string | null;
  year_from?: number | null; year_to?: number | null; is_active?: boolean;
  external_source?: string | null; external_ref?: string | null;
}
export interface VehicleVariantRow {
  id: string; generation_id: string; engine_id: string | null; label: string | null;
  transmission: string | null; drive_type: string | null; fuel_type: string | null;
  year_from: number | null; year_to: number | null; chassis_code: string | null;
  is_active: boolean; external_source: string | null; external_ref: string | null;
  created_at: string; updated_at: string;
}
export interface VehicleVariantInsert {
  generation_id: string; engine_id?: string | null; label?: string | null;
  transmission?: string | null; drive_type?: string | null; fuel_type?: string | null;
  year_from?: number | null; year_to?: number | null; chassis_code?: string | null;
  is_active?: boolean; external_source?: string | null; external_ref?: string | null;
}
/** Phase 32 — compatibility can now target a generation/variant for precise fitment. */
export interface CompatibilityVehicleFields {
  generation_id?: string | null;
  variant_id?: string | null;
}
/** Phase 32 C8 — one flat CSV row for the bulk vehicle importer. */
export interface VehicleImportRow {
  make: string; model: string; generation?: string;
  year_from?: string; year_to?: string; engine_code?: string;
  fuel?: string; transmission?: string; drive?: string; chassis?: string;
}
export interface VehicleImportResult {
  rows: number; makes_created: number; models_created: number;
  generations_created: number; variants_created: number; engines_created: number;
}
export type ProductInsert = Omit<Tables['products']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type ProductUpdate = Tables['products']['Update'];
export type ProductCompatibilityInsert = Omit<Tables['product_compatibility']['Insert'], 'id' | 'created_at'> & CompatibilityVehicleFields;
export type ProductSupplierCodeInsert = Omit<Tables['product_supplier_codes']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type ContactInsert = Omit<Tables['contacts']['Insert'], 'id' | 'created_at' | 'updated_at'> & ContactGeoFields;
export type ContactUpdate = Tables['contacts']['Update'] & ContactGeoFields;
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
  signUp(params: {
    email: string;
    password: string;
    first_name?: string;
    last_name?: string;
  }): Promise<{ user_id: string }>;
  signIn(params: { email: string; password: string }): Promise<{ user_id: string }>;
  /** Starts an OAuth redirect flow; the browser leaves the app and returns to /auth/callback. */
  signInWithOAuth(provider: 'google'): Promise<void>;
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

// ── Print Templates API (Phase 15 — customizable print engine) ─────────────────
// PrintTemplate / settings types live in the print engine; imported type-only.
export type {
  PrintTemplate, TemplateSettings, PrintDocumentType,
} from '@/modules/print/engine/types';
import type { PrintTemplate as PrintTemplateRow, PrintDocumentType as PrintDocType } from '@/modules/print/engine/types';

export interface PrintTemplatesAPI {
  /** All saved templates for a company (default first). */
  list(company_id: string): Promise<PrintTemplateRow[]>;
  /** Resolve the template to use for a doc type: per-doc default → global
   *  default → a synthesized classic fallback (never throws / never null). */
  getResolved(company_id: string, documentType: PrintDocType): Promise<PrintTemplateRow>;
  create(company_id: string, template: Partial<PrintTemplateRow> & { name: string }): Promise<PrintTemplateRow>;
  update(id: string, patch: Partial<PrintTemplateRow>): Promise<PrintTemplateRow>;
  duplicate(id: string, newName: string): Promise<PrintTemplateRow>;
  remove(id: string): Promise<void>;
  /** Make this template the company-wide default (clears any previous default). */
  setDefault(company_id: string, id: string): Promise<void>;
  /** Pin a template as the default for a specific document type. */
  setDocTypeDefault(company_id: string, documentType: PrintDocType, id: string): Promise<void>;
  /** Current per-document-type default assignments: { document_type → template_id }. */
  listDocTypeDefaults(company_id: string): Promise<Record<string, string>>;
  /** Remove a per-document-type default (falls back to the global default). */
  clearDocTypeDefault(company_id: string, documentType: PrintDocType): Promise<void>;
}

// ── Profiles API ──────────────────────────────────────────────────────────────
export interface ProfilesAPI {
  getCurrent(): Promise<Profile | null>;
}

// ── Users & Roles (Phase 22) ───────────────────────────────────────────────
export type AppRole = 'admin' | 'accountant' | 'sales' | 'counter' | 'viewer';

export interface CompanyInviteRow {
  id:          string;
  company_id:  string;
  email:       string;
  role:        AppRole;
  status:      'pending' | 'accepted' | 'revoked';
  invited_by:  string | null;
  created_at:  string;
  accepted_at: string | null;
}

export interface PendingInvite {
  invite_id:    string;
  role:         AppRole;
  company_name: string;
}

/** A role row — the 5 system roles (is_system, company_id null) + per-company custom roles. */
export interface RoleRow {
  id:         string;
  company_id: string | null;
  key:        string;
  name:       string;
  is_system:  boolean;
}

export interface UsersAPI {
  /** Members (profiles) of the current company. */
  listUsers(company_id: string): Promise<Profile[]>;
  /** Pending invites for the current company (admin only). */
  listInvites(company_id: string): Promise<CompanyInviteRow[]>;
  /** The full role→permission matrix (global config, read by UI + RLS). */
  listRolePermissions(): Promise<{ role: AppRole; permission: string }[]>;
  /** Invite a teammate by email + role (admin only). Returns the invite id. */
  inviteUser(email: string, role: AppRole): Promise<string>;
  /** Revoke a pending invite (admin only). */
  revokeInvite(invite_id: string): Promise<void>;
  /** Change a member's role (admin only; last-admin guarded). */
  setRole(user_id: string, role: AppRole): Promise<void>;
  /** Activate / deactivate a member (admin only; last-admin guarded). */
  setActive(user_id: string, active: boolean): Promise<void>;
  /** Pending invite for the signed-in user's email (drives self-signup join). */
  myPendingInvite(): Promise<PendingInvite | null>;
  /** Accept the pending invite → attach this user's profile to the company. */
  acceptInvite(): Promise<{ company_id: string; role: AppRole }>;

  // ── Custom roles (Phase 23) ──────────────────────────────────────────────
  /** All roles visible to the company: 5 system roles + this company's custom roles. */
  listRoles(): Promise<RoleRow[]>;
  /** The signed-in user's effective permission strings (drives UI gating). */
  myPermissions(): Promise<string[]>;
  /** Create a custom role (admin only). `users.manage` is never grantable. Returns the role key. */
  createRole(name: string, permissions: string[]): Promise<string>;
  /** Replace a custom role's name + permissions (admin only). */
  updateRole(roleKey: string, name: string, permissions: string[]): Promise<void>;
  /** Delete a custom role (admin only; blocked if any user still has it). */
  deleteRole(roleKey: string): Promise<void>;

  // ── Per-user permission overrides (Phase 26) ─────────────────────────────
  /** A user's overrides on top of their role (admin only). */
  getUserOverrides(userId: string): Promise<{ permission: string; mode: 'allow' | 'deny' }[]>;
  /** Replace a user's overrides (admin only). users.manage is never overridable. */
  setUserOverrides(userId: string, allow: string[], deny: string[]): Promise<void>;
}

// ── Salespeople (Phase 12.16) ─────────────────────────────────────────────
export interface SalespersonRow {
  id:             string;
  company_id:     string;
  name:           string;
  name_ar:        string | null;
  email:          string | null;
  phone:          string | null;
  commission_pct: number;
  is_active:      boolean;
  notes:          string | null;
  created_at:     string;
  updated_at:     string;
}
export type SalespersonInsert = Omit<SalespersonRow, 'id' | 'created_at' | 'updated_at'>;
export type SalespersonUpdate = Partial<Omit<SalespersonRow, 'id' | 'company_id' | 'created_at' | 'updated_at'>>;

export interface SalespeopleAPI {
  /** Active salespeople for pickers. Active-only by default. */
  list(company_id: string, opts?: { include_inactive?: boolean }): Promise<SalespersonRow[]>;
  getById(id: string): Promise<SalespersonRow | null>;
  create(row: SalespersonInsert): Promise<SalespersonRow>;
  update(id: string, row: SalespersonUpdate): Promise<void>;
  /** Soft delete — sets is_active=false. Historical sales keep the FK. */
  deactivate(id: string): Promise<void>;
  activate(id: string): Promise<void>;
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
  /** Phase 32 C6 — re-point products off the duplicate onto the kept brand, then delete the duplicate (DEFINER, audited). */
  merge(keep_id: string, dup_id: string): Promise<void>;
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
  // Phase 32 — deep hierarchy: generations → variants, + reusable engines.
  listGenerations(model_id: string): Promise<VehicleGenerationRow[]>;
  createGeneration(row: VehicleGenerationInsert): Promise<VehicleGenerationRow>;
  updateGeneration(id: string, row: Partial<VehicleGenerationInsert>): Promise<void>;
  removeGeneration(id: string): Promise<void>;
  listVariants(generation_id: string): Promise<VehicleVariantRow[]>;
  createVariant(row: VehicleVariantInsert): Promise<VehicleVariantRow>;
  updateVariant(id: string, row: Partial<VehicleVariantInsert>): Promise<void>;
  removeVariant(id: string): Promise<void>;
  listEngines(company_id: string): Promise<VehicleEngineRow[]>;
  createEngine(row: VehicleEngineInsert): Promise<VehicleEngineRow>;
  updateEngine(id: string, row: Partial<VehicleEngineInsert>): Promise<void>;
  removeEngine(id: string): Promise<void>;
  /** Phase 32 C8 — bulk hierarchical upsert from flat CSV rows (find-or-create by natural key). */
  importVehicles(rows: VehicleImportRow[]): Promise<VehicleImportResult>;
}

// ── Phase 12.18: SmartEntitySearch result shapes ──────────────────────────
export interface ProductSearchRow {
  id:            string;
  sku:           string;
  name:          string;
  name_ar:       string | null;
  oe_number:     string | null;
  barcode:       string | null;
  brand_id:      string | null;
  brand_name:    string | null;
  category_id:   string | null;
  category_name: string | null;
  unit_id:       string | null;
  unit_code:     string | null;
  selling_price: number;
  is_active:     boolean;
  match_rank:    number;
}
export interface ProductSearchInput {
  company_id:        string;
  q?:                string;
  limit?:            number;
  brand_id?:         string;
  category_id?:      string;
  include_inactive?: boolean;
}
export interface ContactSearchRow {
  id:           string;
  type:         string;
  name:         string;
  name_ar:      string | null;
  phone:        string | null;
  email:        string | null;
  tax_id:       string | null;
  credit_limit: number;
  match_rank:   number;
}
export interface ContactSearchInput {
  company_id: string;
  q?:         string;
  type?:      'customer' | 'supplier' | null;
  limit?:     number;
}

export interface ProductsAPI {
  list(company_id: string): Promise<ProductRow[]>;
  search(company_id: string, query: string): Promise<ProductRow[]>;
  /**
   * SmartEntitySearch backend — server-side trigram-ranked search.
   * Returns inline display columns (sku, name, brand, oe, price) so the
   * dropdown can render the rich list without N+1 queries.
   * Hard-capped at 100 rows/query — designed for 100k+ catalogs.
   */
  smartSearch(input: ProductSearchInput): Promise<ProductSearchRow[]>;
  listByModel(company_id: string, model_id: string, year?: number): Promise<ProductRow[]>;
  /** Phase 32 — cascading fitment search: products whose compatibility covers the chosen vehicle (model/generation/variant + optional year). */
  listByVehicle(company_id: string, opts: { model_id: string; generation_id?: string | null; variant_id?: string | null; year?: number | null }): Promise<ProductRow[]>;
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

// ── Geography API (Phase 16 — regions for sales analysis) ──────────────────
export interface GeographicRegion {
  id:           string;
  company_id:   string | null;   // null = system row, visible to all tenants
  country_code: string;
  region_name:  string;
  region_type:  string;
  is_system:    boolean;
  is_active:    boolean;
}
export interface GeographyAPI {
  /** System + this company's regions for a country (active only, name-sorted). */
  listRegions(company_id: string, country_code: string): Promise<GeographicRegion[]>;
  /** Create a tenant region (is_system=false). */
  createRegion(company_id: string, input: { country_code: string; region_name: string; region_type?: string }): Promise<GeographicRegion>;
}

// ── Exchange Rates API (Phase 17 — multi-currency foundation) ──────────────
// ── Platform Admin (owner-only, cross-tenant) ─────────────────────────────
export interface AdminDashboard {
  total_companies:    number;
  active_companies:   number;
  new_registrations:  number;
  total_users:        number;
  total_invoices:     number;
  total_products:     number;
  database_bytes:     number;
  storage_bytes:      number;
  failed_logins_30d:  number;
  subscription_status: string | null;
  error_logs_count:    number | null;
  support_tickets_open: number | null;
  recent_companies:   { id: string; name: string; created_at: string; users: number }[];
  generated_at:       string;
}
export interface ExchangeRate {
  id:            string;
  company_id:    string;
  from_currency: string;
  to_currency:   string;
  exchange_rate: number;
  effective_date: string;
  created_at?:   string;
}
export interface ExchangeRatesAPI {
  list(company_id: string): Promise<ExchangeRate[]>;
  upsert(company_id: string, input: { from_currency: string; to_currency: string; exchange_rate: number; effective_date: string }): Promise<ExchangeRate>;
  remove(id: string): Promise<void>;
  /** Latest rate from→to effective on/before `onDate`; 1 when from===to or none. */
  getRate(company_id: string, from: string, to: string, onDate: string): Promise<number>;
}

export interface ContactsAPI {
  list(company_id: string, type?: 'customer' | 'supplier' | 'both' | null): Promise<ContactRow[]>;
  getById(id: string): Promise<ContactRow | null>;
  create(row: ContactInsert): Promise<ContactRow>;
  update(id: string, row: ContactUpdate): Promise<void>;
  remove(id: string): Promise<void>;
  /**
   * SmartEntitySearch backend — server-side ranked search on name/phone/
   * tax_id/email. Returns columns the customer/supplier pickers display.
   * Hard-capped at 100 rows/query.
   */
  smartSearch(input: ContactSearchInput): Promise<ContactSearchRow[]>;
  /**
   * Net advance balance held for this contact, as of TODAY, derived from the
   * GL. Positive = the customer has credit on file (we owe them money / they
   * paid in advance). Pulls SUM(credit - debit) on the contact-advance
   * account (2400 for customers, 1400 for suppliers).
   *
   * @param account_code '2400' for customer advances, '1400' for vendor
   *   advances. Defaults to '2400'.
   */
  getAdvanceBalance(
    company_id: string,
    contact_id: string,
    account_code?: '2400' | '1400',
  ): Promise<number>;
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
  /** The journal entry this GL line belongs to — drill-down target for the entry number. */
  journal_entry_id: string | null;
  date: string;
  entry_number: string;
  description: string;
  debit: number;
  credit: number;
  running_balance: number;
  /** Line-level related_doc_type (falls back to the JE's source_type). */
  source_type: string;
  /** Id of the source document (invoice / bill / payment / …), if any. */
  source_id: string | null;
  /** Human document number ("INV-1002", "BILL-1003") resolved from source_id. */
  source_number: string | null;
  /** Non-null when this JE was subsequently voided by another JE. */
  reversed_by_id: string | null;
  /** Non-null when this JE IS the reversal of another JE. */
  reversal_of_id: string | null;
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
  /** Phase 14.10 — edit an existing CoA row. System accounts allow name +
   *  name_ar + parent_id changes only; code/type/sub_type/is_system are
   *  locked client-side (the column itself is updatable so customizing
   *  isn't impossible, just guarded). For non-system rows everything is
   *  fair game. */
  update(id: string, row: CoaUpdate): Promise<CoaRow>;
  /** Phase 14.10 — soft-delete (sets is_active=false). Refuses to
   *  deactivate system accounts. Refuses if the account has ANY GL
   *  history (would orphan past JEs visually). */
  deactivate(id: string): Promise<void>;
  /** Re-activate a previously deactivated account. */
  activate(id: string): Promise<void>;
  /** Phase 14.14p — atomic CoA + (optional) bank_accounts insert. Replaces
   *  the Phase 14.13d two-call pattern so a failed bank insert no longer
   *  leaves an orphan CoA row. Pass `bank: null` for a CoA-only create. */
  createWithOptionalBank(input: CreateCoaWithBankInput): Promise<CreateCoaWithBankResult>;
}

export interface CreateCoaWithBankInput {
  coa: CoaInsert;
  bank: {
    account_type:    string;
    name?:           string | null;
    name_ar?:        string | null;
    account_number?: string | null;
    bank_name?:      string | null;
    iban?:           string | null;
    swift_code?:     string | null;
    branch?:         string | null;
    currency?:       string | null;
    is_active?:      boolean;
    is_default?:     boolean;
    opening_balance?: number;
  } | null;
}
export interface CreateCoaWithBankResult {
  coa_id:  string;
  bank_id: string | null;
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
  /**
   * Current on-hand quantity + MAC per product (summed across all warehouses).
   * Used by editor grids that need live "Available Stock" + "Margin %"
   * without N round trips. Sum-based (direction × quantity) so it's
   * correct even with reversal rows.
   */
  getCurrentStockMap(company_id: string): Promise<Record<string, { qty: number; mac: number }>>;
  /**
   * Phase 12.28 — wizard helper. Posts a one-shot 'opening_balance' row
   * to stock_ledger AND the balancing JE (Dr 1300 / Cr 3200). Rejects if
   * any prior stock_ledger row exists for this product+warehouse, since
   * opening stock is a one-time migration event — for subsequent
   * adjustments use the Inventory Adjustment flow instead.
   */
  postOpeningStock(input: {
    product_id: string;
    warehouse_id: string;
    quantity: number;
    unit_cost: number;
    date?: string;
  }): Promise<{ stock_ledger_id: string; journal_entry_id: string; entry_number: string; total_value: number }>;
  /**
   * Phase 14.15 — list all opening-stock rows posted via post_opening_stock.
   * Used by the Opening Inventory wizard to show "already posted" items.
   */
  listOpeningStock(company_id: string): Promise<Array<{
    stock_ledger_id: string;
    product_id:      string;
    sku:             string;
    product_name:    string;
    warehouse_id:    string;
    warehouse_name:  string;
    quantity:        number;
    unit_cost:       number;
    total_cost:      number;
    date:            string;
  }>>;
  /**
   * Phase 14.16b — void an opening stock entry.
   * Reverses the GL JE and hard-deletes the stock_ledger row,
   * clearing the one-shot guard so the product can be re-posted.
   */
  voidOpeningStock(stock_ledger_id: string): Promise<void>;
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

/** Cheque details captured when confirming a payment as a PDC. */
export interface PdcChequeInput {
  cheque_number: string;
  bank_name: string;
  /** Cheque due date (ISO yyyy-mm-dd) — when it can be deposited/cleared. */
  due_date: string;
}

export interface ConfirmPdcResult {
  payment_id: string;
  payment_number: string;
  pdc_id: string;
  pdc_number: string;
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
  /**
   * Unallocated payment sitting in 2400 Customer Advances for this contact.
   * Positive = customer has paid in advance / overpaid. Net amount the
   * customer actually owes = total - advance_credit (can be negative if
   * the customer has credit on file).
   */
  advance_credit: number;
  /** total - advance_credit. Negative means we owe them. */
  net_due: number;
}

/**
 * Per-contact breakdown of a control GL account (1200, 2100, 2400, 1400, …).
 * Used by the Trial Balance and Balance Sheet drill-downs so the user can
 * see WHICH customers / suppliers make up the balance on a control account.
 */
export interface ControlAccountContactLine {
  contact_id: string | null;
  contact_name: string;     // 'No contact' for rows without contact_id
  debit: number;
  credit: number;
  balance: number;          // debit - credit
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
  /** Source document UUID for drill-down (null for plain manual JEs). */
  doc_id?: string | null;
  debit: number;
  credit: number;
  balance: number;
  /** Phase 12.52 — source_type from the underlying journal_entries row
   *  (e.g. 'sales_invoice', 'sales_invoice_void', 'sales_payment',
   *  'customer_advance', 'manual'). Lets the UI render a clearer
   *  document label than the raw related_doc_type. */
  source_type?: string;
  /** True when the JE has been reversed by a later entry (void / edit). */
  is_reversed?: boolean;
  /** True when the JE itself IS a reversal of an earlier entry. */
  is_reversal?: boolean;
  /** Phase 12.54 — GL account this line hit ('1200' AR or '2400' Customer
   *  Advances). Statement queries both so overpayments show up as their
   *  own row with the correct label. */
  account_code?: string;
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
  /** Hard-delete a DRAFT invoice (and its items). Refuses if not draft —
   *  confirmed invoices must be voided, never deleted. */
  deleteDraft(invoice_id: string): Promise<void>;
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
  /** Confirm a DRAFT receipt as a Post-Dated Cheque: posts to 1250 PDC
   *  Receivable (not bank) and creates a linked pdc_cheques record that flows
   *  through Banking → PDC Received (clear-to-bank / bounce / cancel). */
  confirmAsPdc(payment_id: string, cheque: PdcChequeInput): Promise<ConfirmPdcResult>;
  applyAdvance(payment_id: string, invoice_id: string, amount: number): Promise<ApplyAdvanceResult>;
  void(payment_id: string, reason?: string): Promise<void>;
  /** Reopen a CONFIRMED receipt for editing: reverses its GL posting +
   *  advance applications, drops allocations, flips status back to 'draft'.
   *  Refuses if not confirmed, bank-reconciled, or in a locked period. */
  reopen(payment_id: string): Promise<void>;
  /** Hard-delete a DRAFT payment (and its allocations). Refuses if not draft —
   *  confirmed payments must be voided, never deleted. */
  deleteDraft(payment_id: string): Promise<void>;
  getNextNumber(company_id: string): Promise<string>;
  /**
   * Sum of allocations (amount_applied + discount) per doc id for the whole
   * company, filtered by doc_type. Used by list pages to show payment
   * status (Paid / Partial / Unpaid) without N round-trips.
   */
  getAppliedMap(company_id: string, doc_type: 'invoice' | 'vendor_bill'): Promise<Record<string, number>>;
}

export interface BankAccountsAPI {
  /** Active bank accounts. Default `includeInactive=false` keeps pickers clean. */
  list(company_id: string, opts?: { includeInactive?: boolean }): Promise<BankAccountRow[]>;
  getById(id: string): Promise<BankAccountRow | null>;
  create(row: BankAccountInsert): Promise<BankAccountRow>;
  update(id: string, row: Partial<BankAccountInsert>): Promise<void>;
  /** Hard delete. Will fail if any payment / expense / bank_transfer / pdc / reconciliation references it. */
  remove(id: string): Promise<void>;
}

export interface TaxRatesAPI {
  /** Returns only is_active=true rates (used by invoice/bill dropdowns). */
  list(company_id: string): Promise<TaxRateRow[]>;
  /** Returns ALL rates including inactive (used by settings page). */
  listAll(company_id: string): Promise<TaxRateRow[]>;
  create(row: TaxRateInsert): Promise<TaxRateRow>;
  update(id: string, patch: Partial<TaxRateInsert>): Promise<void>;
  /** Insert Standard 5%, Zero-rated 0%, Exempt for the company (idempotent per tax_type). */
  seedDefaults(company_id: string): Promise<void>;
}

// Phase 13.03 — dashboard summary cards (Income/Expense, Top Expenses,
// Bank Balances, Watchlist). One round trip via the get_dashboard_cards RPC.
export interface DashboardCards {
  period_start_12mo: string;
  period_start_fy:   string;
  monthly_pl:        Array<{ month: string; income: number; expense: number }>;
  top_expenses:      Array<{ account_code: string; account_name: string; amount: number }>;
  top_expenses_others: number;
  top_expenses_total:  number;
  bank_balances:     Array<{
    id: string; name: string; currency: string;
    account_type: string; balance: number;
  }>;
  watchlist:         Array<{ id: string; name: string; balance: number }>;
}

export interface ReportsAPI {
  getProfitAndLoss(company_id: string, from: string, to: string): Promise<ProfitAndLoss>;
  getBalanceSheet(company_id: string, as_of_date: string): Promise<BalanceSheet>;
  getARAgingReport(company_id: string, as_of_date: string): Promise<ARAgingReport>;

  /**
   * Per-contact breakdown of any control GL account (1200 AR, 2100 AP,
   * 2400 Customer Advances, 1400 Vendor Advances, etc.) as of a specific
   * date. Used to drill into Trial Balance / Balance Sheet rows.
   * Cumulative from fiscal start to `as_of_date`; returns one line per
   * distinct contact_id with debits, credits, and net balance.
   */
  getControlAccountByContact(
    company_id: string,
    account_code: string,
    as_of_date: string,
  ): Promise<ControlAccountContactLine[]>;
  getCustomerStatement(company_id: string, contact_id: string, from: string, to: string): Promise<CustomerStatement>;
  getStockValuation(company_id: string, as_of_date: string): Promise<StockValuationReport>;
  getAPAgingReport(company_id: string, as_of_date: string): Promise<APAgingReport>;
  getSupplierStatement(company_id: string, contact_id: string, from: string, to: string): Promise<SupplierStatement>;
  getGRNReconciliation(company_id: string, as_of_date: string): Promise<GRNReconciliationReport>;
  // Phase 6 reports
  getStockMovement(company_id: string, params: { product_id?: string; warehouse_id?: string; date_from: string; date_to: string; hide_reversed?: boolean }): Promise<StockMovementLine[]>;
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
  /**
   * Audit log entries for a specific document (entity_type, entity_id).
   * Used by the per-document Activity tab on editors. Sorted newest first.
   */
  getEntityAuditLog(company_id: string, entity_type: string, entity_id: string, limit?: number): Promise<AuditLogLine[]>;
  getReversalTrail(company_id: string, from: string, to: string): Promise<ReversalTrailLine[]>;
  getCashFlow(company_id: string, from: string, to: string): Promise<CashFlowStatement>;
  getOwnerDashboard(company_id: string): Promise<OwnerDashboard>;
  /** Phase 13.03 — bottom-of-dashboard cards (Income/Expense 12mo,
   *  Top Expenses YTD, Bank Balances, Watchlist) in one round trip. */
  getDashboardCards(company_id: string): Promise<DashboardCards>;
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
  /** Confirmed invoices minus confirmed credit notes, excl. VAT. */
  net_sales: number;
  /** Confirmed credit notes attributed to this salesperson, excl. VAT. */
  returns_total: number;
  gross_profit: number;
  gp_pct: number;
  avg_invoice_value: number;
  /** From the salespeople master; null for the Unassigned bucket. */
  commission_pct: number | null;
  /** net_sales × commission_pct / 100, floored at 0. */
  commission: number;
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

/** Place-wise breakdown row — emirates get their official VAT201 box code (1a–1g). */
export interface VATReturnRegionRow {
  region_name: string;
  box: string | null;
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
  /** Box 1 split by the customer's region (VAT201 boxes 1a–1g for AE emirates). */
  output_by_region?: VATReturnRegionRow[];
  /** Input VAT split by the supplier's region — analysis, not an FTA box. */
  input_by_region?: VATReturnRegionRow[];
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

/** Phase 40 — one period's flow KPIs, net of VAT (total − tax). */
export interface DashboardPeriodStats {
  sales: number;           // confirmed invoices in the period
  sales_prev: number;      // same-length comparison period (for delta %)
  purchases: number;       // confirmed vendor bills in the period
  purchases_prev: number;
}

export interface OwnerDashboard {
  // ── Today snapshots ────────────────────────────────────────────────────
  today_sales_count: number;
  today_sales_amount: number;
  today_sales_amount_prev: number;     // yesterday's confirmed sales (for delta %)
  today_purchases_amount: number;      // confirmed vendor bills today
  today_purchases_amount_prev: number; // yesterday's confirmed bill total
  // ── Phase 40 — Today / This Month / This Year KPI periods ─────────────
  period_stats: {
    today: DashboardPeriodStats;
    month: DashboardPeriodStats;   // month-to-date vs same days last month
    year:  DashboardPeriodStats;   // year-to-date vs same period last year
  };
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
  /** Phase 40 — daily trend for the current month */
  trend_month: { date: string; sales: number; purchases: number }[];
  /** Phase 40 — monthly trend for the current year (date = YYYY-MM-01) */
  trend_year: { date: string; sales: number; purchases: number }[];
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

// Phase 47 — itemized landed costs (freight, customs, insurance…). Standalone
// types (table not yet in generated database types).
export interface VendorBillLandedCostRow {
  id: string;
  company_id: string;
  bill_id: string;
  label: string;
  amount: number;
  credit_account_id: string;
  contact_id: string | null;
  sort_order: number;
  created_at: string;
}
export interface VendorBillLandedCostInsert {
  company_id: string;
  label: string;
  amount: number;
  credit_account_id: string;
  contact_id?: string | null;
  sort_order?: number;
}

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
  /** Source document UUID for drill-down (null for plain manual JEs). */
  doc_id?: string | null;
  debit: number;
  credit: number;
  balance: number;
  /** Phase 12.52 — mirrors CustomerStatementLine fields. */
  source_type?: string;
  is_reversed?: boolean;
  is_reversal?: boolean;
  /** Phase 12.54 — '2100' AP or '1400' Vendor Advances. */
  account_code?: string;
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
  /**
   * Phase 12.47 — Convert a PO into a draft vendor bill.
   *
   * Reads the PO + items, creates a new vendor_bills row in 'draft'
   * status with the same supplier / currency / lines, then marks the
   * source PO as 'closed' so it doesn't show up in the open list.
   * The bill stays draft so the user can review supplier_bill_number,
   * due_date and warehouse before confirming.
   */
  convertToBill(po_id: string): Promise<VendorBillRow>;
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
  /** Phase 47 — itemized landed-cost lines for a bill. */
  getLandedCosts(bill_id: string): Promise<VendorBillLandedCostRow[]>;
  create(row: VendorBillInsert, items: VendorBillItemInsert[], landedCosts?: VendorBillLandedCostInsert[]): Promise<VendorBillRow>;
  update(id: string, row: VendorBillUpdate, items: VendorBillItemInsert[], landedCosts?: VendorBillLandedCostInsert[]): Promise<void>;
  confirm(bill_id: string): Promise<BillConfirmResult>;
  /**
   * Re-open a CONFIRMED bill for editing: reverses its JE + stock rows and
   * sets status back to draft. Refuses if payments are applied or the bill
   * triggered a deferred-COGS flush. Re-confirm reposts everything.
   */
  edit(bill_id: string): Promise<void>;
  /** Hard-delete a DRAFT bill (and its items). Refuses if not draft —
   *  confirmed bills must be voided/reopened, never deleted. */
  deleteDraft(bill_id: string): Promise<void>;
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
  /** Confirm a DRAFT vendor payment as an issued Post-Dated Cheque: posts to
   *  2450 PDC Payable (not bank) and creates a linked pdc_cheques record. */
  confirmAsPdc(payment_id: string, cheque: PdcChequeInput): Promise<ConfirmPdcResult>;
  applyAdvance(payment_id: string, bill_id: string, amount: number): Promise<ApplyVendorAdvanceResult>;
  /** Reopen a CONFIRMED vendor payment for editing: reverses its GL posting +
   *  advance applications, drops allocations, flips status back to 'draft'.
   *  Refuses if not confirmed, bank-reconciled, or in a locked period. */
  reopen(payment_id: string): Promise<void>;
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
  /** Phase 34 — reverse a confirmed note + reopen as draft (edit-after-confirm). */
  reopen(id: string): Promise<void>;
  getNextNumber(company_id: string): Promise<string>;
}

export interface SalesReturnsAPI {
  list(company_id: string, params?: { status?: string; date_from?: string; date_to?: string }): Promise<SalesReturnRow[]>;
  getById(id: string): Promise<SalesReturnRow | null>;
  getItems(sales_return_id: string): Promise<SalesReturnItemRow[]>;
  create(row: SalesReturnInsert, items: SalesReturnItemInsert[]): Promise<SalesReturnRow>;
  /** Phase 33 — post the return by generating + confirming a linked credit note (GL + restock). */
  confirm(id: string): Promise<{ credit_note_id: string; credit_note_number: string }>;
  void(id: string, reason?: string): Promise<void>;
  /** Phase 34 — reverse a confirmed return (void its credit note) + reopen as draft. */
  reopen(id: string): Promise<void>;
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
  /** Phase 34 — reverse a confirmed note + reopen as draft (edit-after-confirm). */
  reopen(id: string): Promise<void>;
  getNextNumber(company_id: string): Promise<string>;
}

// ── Phase 8 row types ─────────────────────────────────────────────────────────
export type BankTransferRow = Tables['bank_transfers']['Row'];
export type BankTransferInsert = Omit<Tables['bank_transfers']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type BankTransferUpdate = Tables['bank_transfers']['Update'];

export type ExpenseRow = Tables['expenses']['Row'];
export type ExpenseInsert = Omit<Tables['expenses']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type ExpenseUpdate = Tables['expenses']['Update'];

// Phase 13.01 — expense_items child rows. Declared by hand (not yet in the
// generated database types) until the next supabase gen types run.
export interface ExpenseItemRow {
  id: string;
  expense_id: string;
  sort_order: number;
  expense_account_id: string;
  description: string | null;
  quantity: number;
  unit_amount: number;
  tax_rate: number;
  tax_amount: number;
  line_subtotal: number;
  line_total: number;
  is_billable: boolean;
  customer_id: string | null;
  billed_invoice_id: string | null;
  billed_invoice_item_id: string | null;
  created_at: string;
  updated_at: string;
}

export type ExpenseItemInsert = Omit<ExpenseItemRow,
  'id' | 'expense_id' | 'created_at' | 'updated_at' |
  'billed_invoice_id' | 'billed_invoice_item_id'
>;

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

// ── Phase 12.12: Bank Reconciliation ─────────────────────────────────────
export interface BankReconciliationRow {
  id:                          string;
  company_id:                  string;
  bank_account_id:             string;
  statement_end_date:          string;
  statement_closing_balance:   number;
  reconciled_book_balance:     number;
  outstanding_amount:          number;
  line_count:                  number;
  notes:                       string | null;
  status:                      'open' | 'locked';
  created_at:                  string;
  created_by:                  string | null;
  locked_at:                   string | null;
  locked_by:                   string | null;
}

/**
 * A general_ledger line eligible for bank reconciliation:
 * those posted to the bank account's COA, up to the statement end date.
 */
export interface ReconGlLine {
  id:                  string;          // general_ledger.id
  date:                string;
  je_number:           string;
  source_type:         string;
  source_id:           string | null;
  related_doc_type:    string | null;
  related_doc_id:      string | null;
  description:         string | null;
  debit:               number;
  credit:              number;
  reconciliation_id:   string | null;
}

export interface BankReconciliationSaveInput {
  company_id:                  string;
  bank_account_id:             string;
  statement_end_date:          string;
  statement_closing_balance:   number;
  gl_line_ids:                 string[];
  notes?:                      string | null;
  lock?:                       boolean;
}

export interface BankReconciliationsAPI {
  /** List recon headers, optionally filtered by bank account. Most recent first. */
  list(company_id: string, bank_account_id?: string): Promise<BankReconciliationRow[]>;
  getById(id: string): Promise<BankReconciliationRow | null>;
  /**
   * GL lines on the bank account's COA up to the statement end date.
   * Includes:
   *   - all unreconciled lines (reconciliation_id IS NULL), and
   *   - lines already reconciled UNDER THIS recon (so editing works)
   * Caller can also opt into including all reconciled lines for an audit view.
   */
  listGlLines(
    company_id: string,
    bank_account_id: string,
    up_to_date: string,
    opts?: { reconciliation_id?: string; include_all_reconciled?: boolean }
  ): Promise<ReconGlLine[]>;
  save(input: BankReconciliationSaveInput): Promise<BankReconciliationRow>;
  delete(id: string): Promise<void>;
  /**
   * IDs of payments that have at least one general_ledger line reconciled
   * (their bank-account GL line is matched against a bank statement).
   * Used by payment lists/editors to show a "Reconciled" badge.
   * Single batched query — far cheaper than per-row joins.
   */
  listReconciledPaymentIds(company_id: string): Promise<string[]>;
}

// Phase 8 API interfaces
export interface BankTransfersAPI {
  list(company_id: string, params?: { status?: string; date_from?: string; date_to?: string }): Promise<BankTransferRow[]>;
  getById(id: string): Promise<BankTransferRow>;
  create(data: BankTransferInsert): Promise<BankTransferRow>;
  update(id: string, data: BankTransferUpdate): Promise<BankTransferRow>;
  confirm(id: string): Promise<BankTransferConfirmResult>;
  void(id: string, reason?: string): Promise<void>;
  /** Phase 39 — Edit a CONFIRMED transfer: reverse the posting + back to draft. */
  reopen(id: string): Promise<void>;
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
  // ── Phase 13.01 — multi-line items ─────────────────────────────────────
  /** Load child line items for an expense, ordered by sort_order. */
  getItems(expense_id: string): Promise<ExpenseItemRow[]>;
  /** Replace the full set of line items for an expense in one go.
   *  Pattern matches invoices.updateWithItems: delete-then-insert under a
   *  single client call so the DB never sees partial state. */
  replaceItems(expense_id: string, items: ExpenseItemInsert[]): Promise<void>;
  /** Phase 14.14q — atomic header + items save. Replaces the two-call
   *  pattern (create/update header → replaceItems) with a single RPC so a
   *  failed item-replace rolls the header insert/update back too. Pass
   *  `id: null` for create, `id` for update. */
  saveWithItems(input: { id: string | null; header: ExpenseInsert; items: ExpenseItemInsert[] }): Promise<string>;
  /** Phase 21b — spend grouped by expense account, confirmed expenses only.
   *  Backs the "Top categories" bento tile. Sorted highest-spend first;
   *  account names are resolved by the caller from its CoA query. */
  categoryBreakdown(company_id: string): Promise<Array<{ account_id: string; amount: number }>>;
  /** Phase 25 — reverse a confirmed expense's posting and reopen it as a draft
   *  for editing + re-confirm (mirrors the payment reopen pattern). */
  reopen(id: string): Promise<void>;
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
// ── Public API keys (Phase 49) ──────────────────────────────────────────────
export type ApiScope = 'read' | 'write:contacts' | 'write:orders';
export interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;      // shown in the UI, e.g. sk_live_ab12cd34
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
}
export interface ApiKeysAPI {
  /** Whether the company's plan includes API access (paid gate). */
  hasApiAccess(): Promise<boolean>;
  /** Keys for the current company — never returns the secret. */
  list(): Promise<ApiKeyRow[]>;
  /** Generates the secret in the browser; returns the raw key ONCE (store it now). */
  create(name: string, scopes: ApiScope[]): Promise<{ id: string; api_key: string }>;
  /** Soft-revoke a key (keeps the row for audit). */
  revoke(id: string): Promise<void>;
}

export interface DataAdapter {
  auth: AuthAPI;
  companies: CompaniesAPI;
  printTemplates: PrintTemplatesAPI;
  profiles: ProfilesAPI;
  users: UsersAPI;
  apiKeys: ApiKeysAPI;
  onboarding: OnboardingAPI;
  // Phase 2
  categories: CategoriesAPI;
  brands: BrandsAPI;
  warehouses: WarehousesManagementAPI;
  units: UnitsManagementAPI;
  vehicleMakes: VehicleMakesAPI;
  products: ProductsAPI;
  contacts: ContactsAPI;
  geography: GeographyAPI;
  exchangeRates: ExchangeRatesAPI;
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
  // Phase 12.12: Bank Reconciliation
  bankReconciliations: BankReconciliationsAPI;
  // Phase 12.13: Admin / destructive operations
  admin: AdminAPI;
  // Phase 12.16: Salespeople master data
  salespeople: SalespeopleAPI;
  // Phase 14.09: Opening Balances wizard
  openingBalances: OpeningBalancesAPI;
  // Payroll P1 (owner override 2026-06-13)
  employees: EmployeesAPI;
  payroll: PayrollAPI;
  // Document numbering settings (2026-06-13)
  documentSequences: DocumentSequencesAPI;
  // Phase 31 — SaaS subscription & billing (M1/M2)
  billing: BillingAPI;
}

// ── Phase 31 — SaaS subscription & billing ──────────────────────────────────
// New tables aren't in the generated DB types yet; these are hand-written views.
export interface SubscriptionPlanView {
  code: string;
  name: string;
  monthly_price: number;
  /** Phase 35 — 6-month price (0 until the M3 migration is applied). */
  half_yearly_price?: number;
  yearly_price: number;
  price_currency: string;
  trial_days: number;
  features: Record<string, unknown>;
}
export interface SubscriptionView {
  id: string;
  company_id: string;
  status: string;
  billing_cycle: string | null;
  provider: string;
  grandfathered: boolean;
  trial_start: string | null;
  trial_end: string | null;
  trial_days_left: number | null;
  current_period_start: string | null;
  current_period_end: string | null;
  next_billing_date: string | null;
  amount: number | null;
  currency: string | null;
  cancel_at_period_end: boolean;
  plan: SubscriptionPlanView | null;
}
export interface BillingAddressRow {
  company_id: string;
  company_name: string | null;
  address: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  postal_code: string | null;
  tax_number: string | null;
  phone: string | null;
  email: string | null;
}
/** Phase 35 — one PayPal payment result (IDs only, never card data). */
export interface SubscriptionPaymentRow {
  id: string;
  provider: string;
  provider_payment_id: string | null;
  amount: number;
  currency: string;
  status: string;
  paid_at: string | null;
  created_at: string;
}

export interface BillingAPI {
  /** The caller's own subscription (+ plan), via get_my_subscription(). Null if none. */
  getSubscription(): Promise<SubscriptionView | null>;
  getAddress(company_id: string): Promise<BillingAddressRow | null>;
  upsertAddress(company_id: string, data: Partial<BillingAddressRow>): Promise<void>;
  /** Phase 35 — payment history (empty until the M3 migration is applied). */
  listPayments(company_id: string): Promise<SubscriptionPaymentRow[]>;
}

// ── Document numbering ──────────────────────────────────────────────────────
export type DocumentSequenceRow = Tables['document_sequences']['Row'];

export interface DocumentSequencesAPI {
  list(company_id: string): Promise<DocumentSequenceRow[]>;
  /**
   * Upsert one prefix's settings. `current_value` is the LAST issued
   * number — the next document gets current_value + 1.
   */
  save(company_id: string, prefix: string, patch: {
    format: string; pad_zeros: number; reset_yearly: boolean; current_value: number;
  }): Promise<void>;
}

// ── Payroll P1 — row types + APIs ───────────────────────────────────────────
export type EmployeeRow       = Tables['employees']['Row'];
export type EmployeeInsert    = Omit<Tables['employees']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type PayrollRunRow     = Tables['payroll_runs']['Row'];
export type PayrollRunInsert  = Omit<Tables['payroll_runs']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type PayrollRunItemRow    = Tables['payroll_run_items']['Row'];
export type PayrollRunItemInsert = Omit<Tables['payroll_run_items']['Insert'], 'id' | 'created_at'>;

export interface PayrollConfirmResult {
  run_id: string; je_id: string; entry_number: string;
  total_gross: number; total_net: number;
}
export interface PayrollPayResult {
  run_id: string; je_id: string; entry_number: string;
}

// Payroll P3a — gratuity settlement + leave salary
export type LeaveSalaryRow    = Tables['leave_salary_payments']['Row'];
export type LeaveSalaryInsert = Omit<Tables['leave_salary_payments']['Insert'], 'id' | 'created_at' | 'updated_at'>;

export interface EmployeesAPI {
  list(company_id: string, opts?: { includeInactive?: boolean }): Promise<EmployeeRow[]>;
  create(row: EmployeeInsert): Promise<EmployeeRow>;
  update(id: string, row: Partial<EmployeeInsert>): Promise<void>;
  getNextCode(company_id: string): Promise<string>;
}

export interface PayrollAPI {
  listRuns(company_id: string): Promise<PayrollRunRow[]>;
  getRun(id: string): Promise<PayrollRunRow | null>;
  getItems(run_id: string): Promise<PayrollRunItemRow[]>;
  /** Insert run header + items. Caller pre-fills items from active employees. */
  createRun(run: PayrollRunInsert, items: PayrollRunItemInsert[]): Promise<PayrollRunRow>;
  /** Replace items + notes on a DRAFT run. */
  updateRun(id: string, items: PayrollRunItemInsert[], notes?: string | null): Promise<void>;
  /** Hard-delete a DRAFT run (items cascade). */
  removeRun(id: string): Promise<void>;
  /** Posts the accrual JE: Dr 6100 / Cr 1450 (loans) / Cr 2350 (net). */
  confirmRun(run_id: string): Promise<PayrollConfirmResult>;
  /** Posts the payment JE: Dr 2350 / Cr bank. */
  payRun(run_id: string, bank_account_id: string, date?: string): Promise<PayrollPayResult>;
  getNextRunNumber(company_id: string): Promise<string>;

  // ── P3a: gratuity settlement ──
  /** End-of-service payout: Dr 2360 / Cr bank, optionally deactivate. */
  settleGratuity(employee_id: string, amount: number, bank_account_id: string, opts?: { date?: string; deactivate?: boolean }): Promise<{ je_id: string; entry_number: string }>;

  // ── P3a: leave salary (standalone) ──
  listLeaveSalary(company_id: string): Promise<LeaveSalaryRow[]>;
  createLeaveSalary(row: LeaveSalaryInsert): Promise<LeaveSalaryRow>;
  /** Posts Dr 6100 / Cr bank and marks the record paid. */
  payLeaveSalary(id: string): Promise<{ je_id: string; entry_number: string }>;
  removeLeaveSalary(id: string): Promise<void>;
}

// ── Phase 14.09: Opening Balances ─────────────────────────────────────────
/** Direction of a migrated opening row.
 *  - ar_owed         → unpaid customer invoice carried over (we expect to collect)
 *  - ap_owed         → unpaid supplier bill carried over (we expect to pay)
 *  - customer_credit → customer overpaid us in the old system; sits as advance
 *  - vendor_credit   → we overpaid the supplier in the old system; sits as advance
 */
export type OpeningBalanceType =
  | 'ar_owed'
  | 'ap_owed'
  | 'customer_credit'
  | 'vendor_credit';

export interface OpeningBalanceInput {
  type:        OpeningBalanceType;
  contact_id:  string;
  /** OLD system's document number; becomes invoice/bill/payment number. */
  doc_number:  string;
  /** ORIGINAL document date — drives aging once posted. */
  date:        string;
  /** Original due date (only meaningful for ar_owed / ap_owed). */
  due_date?:   string | null;
  amount:      number;
  currency?:   string;
  notes?:      string | null;
}

export interface OpeningBalanceResult {
  type:             OpeningBalanceType;
  doc_id:           string;
  doc_number:       string;
  journal_entry_id: string;
  entry_number:     string;
}

export interface OpeningBalancesAPI {
  /** Posts one opening-balance row; called in a loop from the wizard so
   *  each row gets its own JE keyed to the original document date. */
  post(input: OpeningBalanceInput): Promise<OpeningBalanceResult>;
  /** Phase 14.09b — posts one direct-GL opening balance against any
   *  CoA account (Dr/Cr the account; opposite leg lands on 3010
   *  Opening Balance Equity). Used for fixed assets, long-term, capital,
   *  retained earnings, cash on hand. */
  postGl(input: GLOpeningBalanceInput): Promise<GLOpeningBalanceResult>;
  /** Phase 14.09c — posts an opening balance against a specific BANK
   *  ACCOUNT (resolves to the bank's coa_account_id, updates the bank's
   *  opening_balance + opening_balance_date columns, and tags the JE
   *  with source_type='opening_bank'). Preferred over postGl for cash /
   *  bank lines because it keeps the bank reconciliation report in
   *  sync. */
  postBank(input: BankOpeningBalanceInput): Promise<BankOpeningBalanceResult>;
  /** Lists every opening-balance document ever posted for this company,
   *  for the wizard's "Already posted" review panel. Union of subsidiary
   *  opening rows (14.09), direct-GL openings (14.09b), and bank
   *  openings (14.09c). Voided rows are excluded by default. */
  listPosted(company_id: string): Promise<OpeningBalanceListed[]>;
  /** Phase 14.09b — current balance on 3010. Should be zero after a
   *  complete migration; non-zero is an audit flag. */
  get3010Balance(company_id: string): Promise<number>;
  /** Phase 14.09c — voids one posted opening row. Reverses the underlying
   *  JE and marks the source doc void (if any). Reason is shown in the
   *  audit log + the reversal JE description. */
  void(doc_id: string, doc_type: VoidableDocType, reason?: string): Promise<void>;
  /** Phase 14.14n — atomically edits a posted opening row. Voids the
   *  original and posts a fresh row with new values, all inside a single
   *  Postgres transaction. If the new post fails, the void is rolled back
   *  so the original row stays intact (no half-edited state). */
  edit(input: EditOpeningBalanceInput): Promise<EditOpeningBalanceResult>;
  /** Phase 14.14p — returns the non-voided opening-bank JE for a specific
   *  bank account (by source_id), or null if none has been posted yet.
   *  Used by the bank-accounts edit form to correctly call edit() vs postBank(). */
  getBankOpeningJE(bank_account_id: string): Promise<{
    doc_id: string; doc_number: string; date: string; amount: number;
  } | null>;
}

// ── Phase 14.14n: atomic edit ─────────────────────────────────────────────
export type EditOpeningPayload =
  | {
      kind: 'subsidiary';
      type:        OpeningBalanceType;
      contact_id:  string;
      doc_number:  string;
      date:        string;
      due_date?:   string | null;
      amount:      number;
      currency?:   string;
      notes?:      string | null;
    }
  | {
      kind: 'gl';
      account_id: string;
      direction:  'debit' | 'credit';
      amount:     number;
      date:       string;
      notes?:     string | null;
    }
  | {
      kind: 'bank';
      bank_account_id: string;
      direction:       'debit' | 'credit';
      amount:          number;
      date:            string;
      notes?:          string | null;
    };

export interface EditOpeningBalanceInput {
  doc_id:        string;
  void_doc_type: VoidableDocType;
  payload:       EditOpeningPayload;
}

export type EditOpeningBalanceResult =
  | OpeningBalanceResult
  | GLOpeningBalanceResult
  | BankOpeningBalanceResult;

export type VoidableDocType = 'invoice' | 'vendor_bill' | 'payment' | 'opening_gl' | 'opening_bank';

// ── Phase 14.09b: GL opening balances ─────────────────────────────────────
export interface GLOpeningBalanceInput {
  account_id: string;
  direction:  'debit' | 'credit';
  amount:     number;
  date:       string;
  notes?:     string | null;
}

export interface GLOpeningBalanceResult {
  journal_entry_id: string;
  entry_number:     string;
  account_code:     string;
  account_name:     string;
  direction:        'debit' | 'credit';
  amount:           number;
}

// Phase 14.09c — bank-specific opening balance.
export interface BankOpeningBalanceInput {
  bank_account_id: string;
  direction:       'debit' | 'credit';
  amount:          number;
  date:            string;
  notes?:          string | null;
}
export interface BankOpeningBalanceResult {
  journal_entry_id: string;
  entry_number:     string;
  bank_account_id:  string;
  bank_name:        string;
  account_code:     string;
  direction:        'debit' | 'credit';
  amount:           number;
}

export interface OpeningBalanceListed {
  type:        OpeningBalanceType | 'gl_debit' | 'gl_credit' | 'bank_debit' | 'bank_credit';
  /** Identifier for void(): for subsidiary rows it's the invoice/bill/
   *  payment id; for GL + bank rows it's the JE id. */
  doc_id:      string;
  /** Type tag passed back to openingBalances.void(). Matches what the
   *  void RPC's p_doc_type expects. */
  void_doc_type?: VoidableDocType;
  doc_number:  string;
  /** For subsidiary rows: the customer/supplier. For GL rows: empty
   *  (no contact). */
  contact_id:  string;
  contact_name: string;
  /** For GL rows: the CoA account code (e.g. "1500"). For subsidiary
   *  rows: empty. */
  account_code?: string;
  /** For GL rows: the CoA account name. */
  account_name?: string;
  date:        string;
  due_date?:   string | null;
  amount:      number;
  currency:    string;
  outstanding: number;             // remaining open portion
  status:      string;             // 'confirmed' | 'void' | 'paid' ...
  posted_at:   string;
}

// ── Phase 12.13: Admin ────────────────────────────────────────────────────
export interface ResetCompanyDataResult {
  company_id: string;
  reset_at:   string;
  counts:     Record<string, number>;
}

export interface AdminAPI {
  /**
   * DESTRUCTIVE. Wipes all transactional and operational data for a company
   * (invoices, bills, payments, GL, inventory ledger, contacts, products,
   * etc.) while preserving company, profiles, chart_of_accounts, masters,
   * and onboarding. The caller must be admin and must type the exact
   * company name as confirmation. Atomic — fails completely or succeeds
   * completely.
   */
  resetCompanyData(company_id: string, confirmation: string): Promise<ResetCompanyDataResult>;

  // ── Platform Admin (owner-only, cross-tenant) — Phase 20 ──
  /** True only for platform owners (platform_admins allow-list). */
  isPlatformAdmin(): Promise<boolean>;
  /** Cross-tenant platform metrics. Server-side refuses non-admins. */
  getDashboard(): Promise<AdminDashboard>;
}
