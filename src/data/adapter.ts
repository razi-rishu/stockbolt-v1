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

// ── Insert helpers (used by seed services) ───────────────────────────────────
export type CoaInsert = Omit<Tables['chart_of_accounts']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type TaxRateInsert = Omit<Tables['tax_rates']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type PaymentMethodInsert = Omit<Tables['payment_methods']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type UnitInsert = Omit<Tables['units_of_measure']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type WarehouseInsert = Omit<Tables['warehouses']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type BankAccountInsert = Omit<Tables['bank_accounts']['Insert'], 'id' | 'created_at' | 'updated_at'>;
export type CompanyUpdate = Tables['companies']['Update'];

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
// The onboarding API is split into two concerns:
// 1. createCompanyAndProfile — SECURITY DEFINER RPC (bypasses RLS for bootstrap)
// 2. Raw insert methods — used by src/core/seeds/* after profile exists
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
  /** Calls the complete_onboarding SECURITY DEFINER Postgres function. */
  createCompanyAndProfile(input: OnboardingRpcInput): Promise<{ company_id: string }>;

  // Low-level inserts used by src/core/seeds/* --------------------------------
  insertCoaBatch(rows: CoaInsert[]): Promise<CoaRow[]>;
  insertTaxRate(row: TaxRateInsert): Promise<void>;
  insertPaymentMethod(row: PaymentMethodInsert): Promise<void>;
  insertUnit(row: UnitInsert): Promise<void>;
  insertWarehouse(row: WarehouseInsert): Promise<{ id: string }>;
  insertBankAccount(row: BankAccountInsert): Promise<void>;
  getCoaByCodes(company_id: string, codes: string[]): Promise<CoaRow[]>;
}

// ── Root adapter ──────────────────────────────────────────────────────────────
/**
 * The single seam between UI / business code and the data backend.
 * Per AGENTS.md §7.3: UI components must import from this interface,
 * never `@supabase/supabase-js` directly.
 */
export interface DataAdapter {
  auth: AuthAPI;
  companies: CompaniesAPI;
  profiles: ProfilesAPI;
  onboarding: OnboardingAPI;
}
