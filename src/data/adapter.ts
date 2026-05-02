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
}
