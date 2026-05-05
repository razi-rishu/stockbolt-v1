import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type {
  DataAdapter, Company, Profile,
  CoaRow, CoaInsert, TaxRateInsert, PaymentMethodInsert, UnitInsert,
  WarehouseInsert, BankAccountInsert, CompanyUpdate, OnboardingRpcInput,
  CategoryRow, CategoryInsert, CategoryUpdate,
  BrandRow, BrandInsert, BrandUpdate,
  WarehouseRow, UnitRow,
  VehicleMakeRow, VehicleMakeInsert, VehicleModelRow, VehicleModelInsert,
  ProductRow, ProductInsert, ProductUpdate,
  ProductCompatibilityRow, ProductCompatibilityInsert,
  ProductSupplierCodeRow, ProductSupplierCodeInsert,
  ContactRow, ContactInsert, ContactUpdate,
  PriceLevelRow, PriceLevelInsert, PriceLevelUpdate,
  ProductPriceLevelRow, ProductPriceLevelInsert,
  JEPayload, JEPostResult, JournalEntryRow, GeneralLedgerRow,
  TrialBalance, LedgerEntry, StockLedgerRow, StockMovementPayload, StockBalance,
  // Phase 4
  InvoiceRow, InvoiceInsert, InvoiceUpdate, InvoiceItemRow, InvoiceItemInsert,
  SalesQuoteRow, SalesQuoteInsert, SalesQuoteUpdate, SalesQuoteItemRow, SalesQuoteItemInsert,
  PaymentRow, PaymentInsert, PaymentAllocationRow, PaymentAllocationInsert,
  BankAccountRow, TaxRateRow,
  InvoiceConfirmResult, PaymentConfirmResult, ApplyAdvanceResult,
  ProfitAndLoss, ProfitAndLossLine,
  BalanceSheet, BalanceSheetLine,
  ARAgingReport, ARAgingBucket,
  CustomerStatement, CustomerStatementLine,
  StockValuationReport, StockValuationLine,
  // Phase 5
  PurchaseOrderRow, PurchaseOrderItemRow,
  GoodsReceiptRow, GoodsReceiptItemRow,
  VendorBillRow, VendorBillItemRow,
  GRNConfirmResult, BillConfirmResult, VendorPaymentConfirmResult, ApplyVendorAdvanceResult,
  APAgingReport, APAgingBucket as APAgingBucketType,
  SupplierStatement, SupplierStatementLine,
  GRNReconciliationReport, GRNReconciliationLine,
  // Phase 6
  StockTransferRow, StockTransferItemRow,
  InventoryAdjustmentRow, AdjustmentItemRow,
  ProductSerialRow,
  TransferConfirmResult, AdjustmentConfirmResult,
  StockMovementLine, SlowMovingLine, ReorderLine, StockAgingLine, InventoryAdjustmentReportLine,
} from './adapter';
import { apAgingBucket } from '@/core/purchasing/purchase-calc';
import { stockAgingDays, stockAgingBucket } from '@/core/inventory/inventory-calc';
import { getSupabaseClient } from './supabase-client';

class SupabaseAuthError extends Error {
  constructor(message: string) { super(message); this.name = 'SupabaseAuthError'; }
}

class SupabaseDataError extends Error {
  constructor(message: string) { super(message); this.name = 'SupabaseDataError'; }
}

function assertNoError(error: { message: string } | null, context: string): void {
  if (error) throw new SupabaseDataError(`${context}: ${error.message}`);
}

export function createSupabaseAdapter(
  client: SupabaseClient<Database> = getSupabaseClient(),
): DataAdapter {
  return {
    // ── Auth ───────────────────────────────────────────────────────────────
    auth: {
      async signUp({ email, password }) {
        const { data, error } = await client.auth.signUp({ email, password });
        if (error) throw new SupabaseAuthError(error.message);
        if (!data.user) throw new SupabaseAuthError('signUp returned no user');
        return { user_id: data.user.id };
      },
      async signIn({ email, password }) {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw new SupabaseAuthError(error.message);
        if (!data.user) throw new SupabaseAuthError('signIn returned no user');
        return { user_id: data.user.id };
      },
      async signOut() {
        const { error } = await client.auth.signOut();
        if (error) throw new SupabaseAuthError(error.message);
      },
      async getCurrentUserId() {
        const { data } = await client.auth.getUser();
        return data.user?.id ?? null;
      },
      async getSession() {
        const { data } = await client.auth.getSession();
        const session = data.session;
        if (!session) return null;
        return { user_id: session.user.id, email: session.user.email ?? '' };
      },
      onAuthStateChange(callback) {
        const { data } = client.auth.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
            callback('SIGNED_IN', session?.user.id ?? null);
          } else if (event === 'SIGNED_OUT') {
            callback('SIGNED_OUT', null);
          }
        });
        return () => data.subscription.unsubscribe();
      },
      async sendPasswordResetEmail(email) {
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw new SupabaseAuthError(error.message);
      },
      async updatePassword(password) {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw new SupabaseAuthError(error.message);
      },
    },

    // ── Companies ──────────────────────────────────────────────────────────
    companies: {
      async list(): Promise<Company[]> {
        const { data, error } = await client.from('companies').select('*');
        assertNoError(error, 'companies.list');
        return data ?? [];
      },
      async getById(id): Promise<Company | null> {
        const { data, error } = await client.from('companies').select('*').eq('id', id).maybeSingle();
        assertNoError(error, 'companies.getById');
        return data;
      },
      async update(id, data: CompanyUpdate) {
        const { error } = await client.from('companies').update(data).eq('id', id);
        assertNoError(error, 'companies.update');
      },
      async uploadLogo(company_id, file) {
        const ext = file.name.split('.').pop() ?? 'png';
        const path = `${company_id}/logo.${ext}`;
        const { error } = await client.storage.from('logos').upload(path, file, { upsert: true, contentType: file.type });
        if (error) throw new SupabaseDataError(`uploadLogo: ${error.message}`);
        const { data } = client.storage.from('logos').getPublicUrl(path);
        return data.publicUrl;
      },
    },

    // ── Profiles ───────────────────────────────────────────────────────────
    profiles: {
      async getCurrent(): Promise<Profile | null> {
        const { data: userData } = await client.auth.getUser();
        const userId = userData.user?.id;
        if (!userId) return null;
        const { data, error } = await client.from('profiles').select('*').eq('id', userId).maybeSingle();
        assertNoError(error, 'profiles.getCurrent');
        return data;
      },
    },

    // ── Onboarding ─────────────────────────────────────────────────────────
    onboarding: {
      async createCompanyAndProfile(input: OnboardingRpcInput) {
        const { data, error } = await client.rpc('complete_onboarding', { p_data: input as any });
        if (error) throw new SupabaseDataError(`complete_onboarding: ${error.message}`);
        const result = (data as unknown) as { company_id: string };
        return { company_id: result.company_id };
      },
      async insertCoaBatch(rows: CoaInsert[]): Promise<CoaRow[]> {
        const { data, error } = await client.from('chart_of_accounts').insert(rows).select();
        assertNoError(error, 'onboarding.insertCoaBatch');
        return (data ?? []) as CoaRow[];
      },
      async insertTaxRate(row: TaxRateInsert) {
        const { error } = await client.from('tax_rates').insert(row);
        assertNoError(error, 'onboarding.insertTaxRate');
      },
      async insertPaymentMethod(row: PaymentMethodInsert) {
        const { error } = await client.from('payment_methods').insert(row);
        assertNoError(error, 'onboarding.insertPaymentMethod');
      },
      async insertUnit(row: UnitInsert) {
        const { error } = await client.from('units_of_measure').insert(row);
        assertNoError(error, 'onboarding.insertUnit');
      },
      async insertWarehouse(row: WarehouseInsert) {
        const { data, error } = await client.from('warehouses').insert(row).select('id').single();
        assertNoError(error, 'onboarding.insertWarehouse');
        return { id: data!.id };
      },
      async insertBankAccount(row: BankAccountInsert) {
        const { error } = await client.from('bank_accounts').insert(row);
        assertNoError(error, 'onboarding.insertBankAccount');
      },
      async getCoaByCodes(company_id, codes) {
        const { data, error } = await client.from('chart_of_accounts').select('*').eq('company_id', company_id).in('code', codes);
        assertNoError(error, 'onboarding.getCoaByCodes');
        return (data ?? []) as CoaRow[];
      },
    },

    // ── Phase 2: Categories ────────────────────────────────────────────────
    categories: {
      async list(company_id): Promise<CategoryRow[]> {
        const { data, error } = await client.from('categories').select('*').eq('company_id', company_id).order('sort_order').order('name');
        assertNoError(error, 'categories.list');
        return data ?? [];
      },
      async create(row: CategoryInsert): Promise<CategoryRow> {
        const { data, error } = await client.from('categories').insert(row).select().single();
        assertNoError(error, 'categories.create');
        return data!;
      },
      async update(id, row: CategoryUpdate) {
        const { error } = await client.from('categories').update(row).eq('id', id);
        assertNoError(error, 'categories.update');
      },
      async remove(id) {
        const { error } = await client.from('categories').delete().eq('id', id);
        assertNoError(error, 'categories.remove');
      },
    },

    // ── Phase 2: Brands ────────────────────────────────────────────────────
    brands: {
      async list(company_id): Promise<BrandRow[]> {
        const { data, error } = await client.from('brands').select('*').eq('company_id', company_id).order('name');
        assertNoError(error, 'brands.list');
        return data ?? [];
      },
      async create(row: BrandInsert): Promise<BrandRow> {
        const { data, error } = await client.from('brands').insert(row).select().single();
        assertNoError(error, 'brands.create');
        return data!;
      },
      async update(id, row: BrandUpdate) {
        const { error } = await client.from('brands').update(row).eq('id', id);
        assertNoError(error, 'brands.update');
      },
      async remove(id) {
        const { error } = await client.from('brands').delete().eq('id', id);
        assertNoError(error, 'brands.remove');
      },
      async uploadLogo(company_id, brand_id, file) {
        const ext = file.name.split('.').pop() ?? 'png';
        const path = `${company_id}/brands/${brand_id}/logo.${ext}`;
        const { error } = await client.storage.from('logos').upload(path, file, { upsert: true, contentType: file.type });
        if (error) throw new SupabaseDataError(`brands.uploadLogo: ${error.message}`);
        const { data } = client.storage.from('logos').getPublicUrl(path);
        return data.publicUrl;
      },
    },

    // ── Phase 2: Warehouses (management) ──────────────────────────────────
    warehouses: {
      async list(company_id): Promise<WarehouseRow[]> {
        const { data, error } = await client.from('warehouses').select('*').eq('company_id', company_id).order('name');
        assertNoError(error, 'warehouses.list');
        return data ?? [];
      },
      async create(row: WarehouseInsert): Promise<WarehouseRow> {
        const { data, error } = await client.from('warehouses').insert(row).select().single();
        assertNoError(error, 'warehouses.create');
        return data!;
      },
      async update(id, row) {
        const { error } = await client.from('warehouses').update(row).eq('id', id);
        assertNoError(error, 'warehouses.update');
      },
      async remove(id) {
        const { error } = await client.from('warehouses').delete().eq('id', id);
        assertNoError(error, 'warehouses.remove');
      },
    },

    // ── Phase 2: Units of Measure (management) ─────────────────────────────
    units: {
      async list(company_id): Promise<UnitRow[]> {
        const { data, error } = await client.from('units_of_measure').select('*').eq('company_id', company_id).order('code');
        assertNoError(error, 'units.list');
        return data ?? [];
      },
      async create(row: UnitInsert): Promise<UnitRow> {
        const { data, error } = await client.from('units_of_measure').insert(row).select().single();
        assertNoError(error, 'units.create');
        return data!;
      },
      async update(id, row) {
        const { error } = await client.from('units_of_measure').update(row).eq('id', id);
        assertNoError(error, 'units.update');
      },
      async remove(id) {
        const { error } = await client.from('units_of_measure').delete().eq('id', id);
        assertNoError(error, 'units.remove');
      },
    },

    // ── Phase 2: Vehicle Makes & Models ────────────────────────────────────
    vehicleMakes: {
      async list(company_id): Promise<VehicleMakeRow[]> {
        const { data, error } = await client.from('vehicle_makes').select('*').eq('company_id', company_id).order('name');
        assertNoError(error, 'vehicleMakes.list');
        return data ?? [];
      },
      async create(row: VehicleMakeInsert): Promise<VehicleMakeRow> {
        const { data, error } = await client.from('vehicle_makes').insert(row).select().single();
        assertNoError(error, 'vehicleMakes.create');
        return data!;
      },
      async update(id, name) {
        const { error } = await client.from('vehicle_makes').update({ name }).eq('id', id);
        assertNoError(error, 'vehicleMakes.update');
      },
      async remove(id) {
        const { error } = await client.from('vehicle_makes').delete().eq('id', id);
        assertNoError(error, 'vehicleMakes.remove');
      },
      async listModels(make_id): Promise<VehicleModelRow[]> {
        const { data, error } = await client.from('vehicle_models').select('*').eq('make_id', make_id).order('name');
        assertNoError(error, 'vehicleMakes.listModels');
        return data ?? [];
      },
      async createModel(row: VehicleModelInsert): Promise<VehicleModelRow> {
        const { data, error } = await client.from('vehicle_models').insert(row).select().single();
        assertNoError(error, 'vehicleMakes.createModel');
        return data!;
      },
      async updateModel(id, row) {
        const { error } = await client.from('vehicle_models').update(row).eq('id', id);
        assertNoError(error, 'vehicleMakes.updateModel');
      },
      async removeModel(id) {
        const { error } = await client.from('vehicle_models').delete().eq('id', id);
        assertNoError(error, 'vehicleMakes.removeModel');
      },
    },

    // ── Phase 2: Products ──────────────────────────────────────────────────
    products: {
      async list(company_id): Promise<ProductRow[]> {
        const { data, error } = await client.from('products').select('*').eq('company_id', company_id).order('name');
        assertNoError(error, 'products.list');
        return data ?? [];
      },
      async search(company_id, query): Promise<ProductRow[]> {
        if (!query.trim()) return [];
        const q = query.trim();

        // Direct column search
        const { data: direct, error: e1 } = await client
          .from('products')
          .select('*')
          .eq('company_id', company_id)
          .or(`sku.ilike.%${q}%,name.ilike.%${q}%,name_ar.ilike.%${q}%,oe_number.ilike.%${q}%`);
        assertNoError(e1, 'products.search.direct');

        // Supplier code search
        const { data: codehits, error: e2 } = await client
          .from('product_supplier_codes')
          .select('product_id')
          .eq('company_id', company_id)
          .ilike('supplier_sku', `%${q}%`);
        assertNoError(e2, 'products.search.supplierCodes');

        const extraIds = (codehits ?? []).map((r) => r.product_id).filter(Boolean) as string[];
        const directIds = new Set((direct ?? []).map((r) => r.id));
        const newIds = extraIds.filter((id) => !directIds.has(id));

        let extra: ProductRow[] = [];
        if (newIds.length > 0) {
          const { data: extraRows, error: e3 } = await client.from('products').select('*').in('id', newIds);
          assertNoError(e3, 'products.search.extraRows');
          extra = extraRows ?? [];
        }

        return [...(direct ?? []), ...extra];
      },
      async listByModel(company_id, model_id, year?): Promise<ProductRow[]> {
        let q = client
          .from('product_compatibility')
          .select('product_id')
          .eq('model_id', model_id);
        if (year) {
          q = (q as any)
            .or(`year_from.is.null,year_from.lte.${year}`)
            .or(`year_to.is.null,year_to.gte.${year}`);
        }
        const { data: compat, error: e1 } = await q;
        assertNoError(e1, 'products.listByModel.compat');
        const ids = [...new Set((compat ?? []).map((r: any) => r.product_id as string))];
        if (ids.length === 0) return [];
        const { data, error } = await client.from('products').select('*').eq('company_id', company_id).in('id', ids).order('name');
        assertNoError(error, 'products.listByModel');
        return data ?? [];
      },
      async getById(id): Promise<ProductRow | null> {
        const { data, error } = await client.from('products').select('*').eq('id', id).maybeSingle();
        assertNoError(error, 'products.getById');
        return data;
      },
      async create(row: ProductInsert): Promise<ProductRow> {
        const { data, error } = await client.from('products').insert(row).select().single();
        assertNoError(error, 'products.create');
        return data!;
      },
      async update(id, row: ProductUpdate) {
        const { error } = await client.from('products').update(row).eq('id', id);
        assertNoError(error, 'products.update');
      },
      async remove(id) {
        const { error } = await client.from('products').delete().eq('id', id);
        assertNoError(error, 'products.remove');
      },
      async uploadImage(company_id, product_id, file) {
        const ext = file.name.split('.').pop() ?? 'jpg';
        const path = `${company_id}/${product_id}/${Date.now()}.${ext}`;
        const { error } = await client.storage.from('products').upload(path, file, { upsert: false, contentType: file.type });
        if (error) throw new SupabaseDataError(`products.uploadImage: ${error.message}`);
        const { data } = client.storage.from('products').getPublicUrl(path);
        return data.publicUrl;
      },
      async listCompatibility(product_id): Promise<ProductCompatibilityRow[]> {
        const { data, error } = await client.from('product_compatibility').select('*').eq('product_id', product_id);
        assertNoError(error, 'products.listCompatibility');
        return data ?? [];
      },
      async addCompatibility(row: ProductCompatibilityInsert): Promise<ProductCompatibilityRow> {
        const { data, error } = await client.from('product_compatibility').insert(row).select().single();
        assertNoError(error, 'products.addCompatibility');
        return data!;
      },
      async removeCompatibility(id) {
        const { error } = await client.from('product_compatibility').delete().eq('id', id);
        assertNoError(error, 'products.removeCompatibility');
      },
      async listSupplierCodes(product_id): Promise<ProductSupplierCodeRow[]> {
        const { data, error } = await client.from('product_supplier_codes').select('*').eq('product_id', product_id);
        assertNoError(error, 'products.listSupplierCodes');
        return data ?? [];
      },
      async upsertSupplierCode(row: ProductSupplierCodeInsert) {
        const { error } = await client.from('product_supplier_codes').upsert(row, { onConflict: 'product_id,supplier_id' });
        assertNoError(error, 'products.upsertSupplierCode');
      },
      async removeSupplierCode(id) {
        const { error } = await client.from('product_supplier_codes').delete().eq('id', id);
        assertNoError(error, 'products.removeSupplierCode');
      },
      async listPriceOverrides(product_id): Promise<ProductPriceLevelRow[]> {
        const { data, error } = await client.from('product_price_levels').select('*').eq('product_id', product_id);
        assertNoError(error, 'products.listPriceOverrides');
        return data ?? [];
      },
      async upsertPriceOverride(row: ProductPriceLevelInsert) {
        const { error } = await client.from('product_price_levels').upsert(row, { onConflict: 'product_id,price_level_id' });
        assertNoError(error, 'products.upsertPriceOverride');
      },
      async removePriceOverride(id) {
        const { error } = await client.from('product_price_levels').delete().eq('id', id);
        assertNoError(error, 'products.removePriceOverride');
      },
    },

    // ── Phase 2: Contacts ──────────────────────────────────────────────────
    contacts: {
      async list(company_id, type = null): Promise<ContactRow[]> {
        let q = client.from('contacts').select('*').eq('company_id', company_id);
        if (type) q = q.eq('type', type);
        const { data, error } = await q.order('name');
        assertNoError(error, 'contacts.list');
        return data ?? [];
      },
      async getById(id): Promise<ContactRow | null> {
        const { data, error } = await client.from('contacts').select('*').eq('id', id).maybeSingle();
        assertNoError(error, 'contacts.getById');
        return data;
      },
      async create(row: ContactInsert): Promise<ContactRow> {
        const { data, error } = await client.from('contacts').insert(row).select().single();
        assertNoError(error, 'contacts.create');
        return data!;
      },
      async update(id, row: ContactUpdate) {
        const { error } = await client.from('contacts').update(row).eq('id', id);
        assertNoError(error, 'contacts.update');
      },
      async remove(id) {
        const { error } = await client.from('contacts').delete().eq('id', id);
        assertNoError(error, 'contacts.remove');
      },
    },

    // ── Phase 3: Accounting ────────────────────────────────────────────────
    accounting: {
      async postJE(payload: JEPayload): Promise<JEPostResult> {
        const { data, error } = await client.rpc('post_journal_entry', { p_data: payload as any });
        if (error) throw new SupabaseDataError(`accounting.postJE: ${error.message}`);
        const result = data as unknown as JEPostResult;
        return result;
      },
      async reverseJE(je_id, description?): Promise<JEPostResult> {
        const { data, error } = await client.rpc('reverse_journal_entry', {
          p_je_id: je_id, p_description: description ?? null,
        } as any);
        if (error) throw new SupabaseDataError(`accounting.reverseJE: ${error.message}`);
        return data as unknown as JEPostResult;
      },
      async listJEs(company_id, limit = 200): Promise<JournalEntryRow[]> {
        const { data, error } = await client.from('journal_entries').select('*')
          .eq('company_id', company_id).order('date', { ascending: false }).order('created_at', { ascending: false }).limit(limit);
        assertNoError(error, 'accounting.listJEs');
        return data ?? [];
      },
      async getJEById(id): Promise<JournalEntryRow | null> {
        const { data, error } = await client.from('journal_entries').select('*').eq('id', id).maybeSingle();
        assertNoError(error, 'accounting.getJEById');
        return data;
      },
      async getGLLines(je_id): Promise<GeneralLedgerRow[]> {
        const { data, error } = await client.from('general_ledger').select('*').eq('journal_entry_id', je_id).order('debit', { ascending: false });
        assertNoError(error, 'accounting.getGLLines');
        return data ?? [];
      },
      async getTrialBalance(company_id, as_of_date): Promise<TrialBalance> {
        // Fetch all GL rows up to as_of_date
        const { data: rows, error } = await client
          .from('general_ledger')
          .select('account_code, debit, credit')
          .eq('company_id', company_id)
          .lte('date', as_of_date);
        assertNoError(error, 'accounting.getTrialBalance');

        // Fetch CoA for names and types
        const { data: coa } = await client.from('chart_of_accounts').select('code, name, name_ar, type').eq('company_id', company_id);
        const coaMap = Object.fromEntries((coa ?? []).map((a) => [a.code, a]));

        // Aggregate by account_code
        const map: Record<string, { debit: number; credit: number }> = {};
        for (const row of rows ?? []) {
          if (!map[row.account_code]) map[row.account_code] = { debit: 0, credit: 0 };
          map[row.account_code].debit  += row.debit;
          map[row.account_code].credit += row.credit;
        }

        const lines: import('./adapter').TrialBalanceLine[] = Object.entries(map)
          .filter(([, v]) => v.debit !== 0 || v.credit !== 0)
          .map(([code, v]) => ({
            account_code: code,
            account_name: coaMap[code]?.name ?? code,
            account_type: coaMap[code]?.type ?? '',
            debit:  v.debit,
            credit: v.credit,
          }))
          .sort((a, b) => a.account_code.localeCompare(b.account_code));

        const total_debit  = lines.reduce((s, l) => s + l.debit,  0);
        const total_credit = lines.reduce((s, l) => s + l.credit, 0);
        return { lines, total_debit, total_credit, as_of_date };
      },
      async getLedgerEntries(company_id, account_code, from, to): Promise<LedgerEntry[]> {
        const { data: glRows, error: e1 } = await client
          .from('general_ledger')
          .select('id, date, debit, credit, description, journal_entry_id, related_doc_type')
          .eq('company_id', company_id)
          .eq('account_code', account_code)
          .gte('date', from)
          .lte('date', to)
          .order('date')
          .order('created_at');
        assertNoError(e1, 'accounting.getLedgerEntries.gl');

        // Fetch entry numbers for JE ids
        const jeIds = [...new Set((glRows ?? []).map((r) => r.journal_entry_id))];
        const jeMap: Record<string, string> = {};
        if (jeIds.length > 0) {
          const { data: jes } = await client.from('journal_entries').select('id, entry_number').in('id', jeIds);
          for (const je of jes ?? []) jeMap[je.id] = je.entry_number;
        }

        let running = 0;
        return (glRows ?? []).map((r) => {
          running += r.debit - r.credit;
          return {
            id: r.id,
            date: r.date,
            entry_number: jeMap[r.journal_entry_id] ?? '',
            description: r.description ?? '',
            debit: r.debit,
            credit: r.credit,
            running_balance: running,
            source_type: r.related_doc_type ?? '',
          };
        });
      },
      async setPeriodLock(company_id, lock_date): Promise<void> {
        const { error } = await client.from('companies').update({ period_lock_date: lock_date } as any).eq('id', company_id);
        assertNoError(error, 'accounting.setPeriodLock');
      },
    },

    // ── Phase 3: Stock Ledger ──────────────────────────────────────────────
    stockLedger: {
      async postMovement(payload: StockMovementPayload): Promise<StockLedgerRow> {
        // Compute running_qty and running_avg_cost
        const balance = await (this as any).getBalance(payload.company_id, payload.product_id, payload.warehouse_id);
        const old_qty  = balance.quantity;
        const old_mac  = balance.unit_cost;
        const new_qty  = old_qty + payload.direction * payload.quantity;

        let new_mac = old_mac;
        if (payload.direction === 1) {
          new_mac = old_qty + payload.quantity > 0
            ? (old_mac * old_qty + payload.unit_cost * payload.quantity) / (old_qty + payload.quantity)
            : payload.unit_cost;
        }

        const row = {
          company_id:       payload.company_id,
          product_id:       payload.product_id,
          warehouse_id:     payload.warehouse_id,
          date:             payload.date,
          type:             payload.type,
          direction:        payload.direction,
          quantity:         payload.quantity,
          unit_cost:        payload.unit_cost,
          total_cost:       payload.quantity * payload.unit_cost,
          running_qty:      new_qty,
          running_avg_cost: new_mac,
          related_doc_type: payload.related_doc_type ?? null,
          related_doc_id:   payload.related_doc_id ?? null,
          notes:            payload.notes ?? null,
        };
        const { data, error } = await client.from('stock_ledger').insert(row).select().single();
        assertNoError(error, 'stockLedger.postMovement');
        return data!;
      },
      async getBalance(company_id, product_id, warehouse_id): Promise<StockBalance> {
        const { data, error } = await client
          .from('stock_ledger')
          .select('quantity, direction, unit_cost, running_qty, running_avg_cost')
          .eq('company_id', company_id)
          .eq('product_id', product_id)
          .eq('warehouse_id', warehouse_id)
          .is('reversal_of_id', null)
          .order('created_at', { ascending: false })
          .limit(1);
        assertNoError(error, 'stockLedger.getBalance');
        if (data && data.length > 0) {
          const last = data[0];
          const qty  = last.running_qty as unknown as number ?? 0;
          const mac  = last.running_avg_cost as unknown as number ?? 0;
          return { product_id, warehouse_id, quantity: qty, unit_cost: mac, total_value: qty * mac };
        }
        return { product_id, warehouse_id, quantity: 0, unit_cost: 0, total_value: 0 };
      },
      async getMAC(company_id, product_id): Promise<number> {
        // MAC is company-wide: take the most recent running_avg_cost across all warehouses
        const { data, error } = await client
          .from('stock_ledger')
          .select('running_avg_cost')
          .eq('company_id', company_id)
          .eq('product_id', product_id)
          .is('reversal_of_id', null)
          .order('created_at', { ascending: false })
          .limit(1);
        assertNoError(error, 'stockLedger.getMAC');
        return (data?.[0]?.running_avg_cost as unknown as number) ?? 0;
      },
      async getLedger(company_id, product_id, warehouse_id?): Promise<StockLedgerRow[]> {
        let q = client.from('stock_ledger').select('*')
          .eq('company_id', company_id).eq('product_id', product_id);
        if (warehouse_id) q = q.eq('warehouse_id', warehouse_id);
        const { data, error } = await q.order('date').order('created_at');
        assertNoError(error, 'stockLedger.getLedger');
        return data ?? [];
      },
    },

    // ── Phase 3: Chart of Accounts ────────────────────────────────────────
    coa: {
      async list(company_id): Promise<CoaRow[]> {
        const { data, error } = await client.from('chart_of_accounts').select('*').eq('company_id', company_id).order('code');
        assertNoError(error, 'coa.list');
        return data ?? [];
      },
      async create(row: CoaInsert): Promise<CoaRow> {
        const { data, error } = await client.from('chart_of_accounts').insert(row).select().single();
        assertNoError(error, 'coa.create');
        return data!;
      },
    },

    // ── Phase 2: Price Levels ──────────────────────────────────────────────
    priceLevels: {
      async list(company_id): Promise<PriceLevelRow[]> {
        const { data, error } = await client.from('price_levels').select('*').eq('company_id', company_id).order('sort_order').order('name');
        assertNoError(error, 'priceLevels.list');
        return data ?? [];
      },
      async create(row: PriceLevelInsert): Promise<PriceLevelRow> {
        const { data, error } = await client.from('price_levels').insert(row).select().single();
        assertNoError(error, 'priceLevels.create');
        return data!;
      },
      async update(id, row: PriceLevelUpdate) {
        const { error } = await client.from('price_levels').update(row).eq('id', id);
        assertNoError(error, 'priceLevels.update');
      },
      async remove(id) {
        const { error } = await client.from('price_levels').delete().eq('id', id);
        assertNoError(error, 'priceLevels.remove');
      },
    },

    // ── Phase 4: Tax Rates (read-only lookup) ─────────────────────────────
    taxRates: {
      async list(company_id): Promise<TaxRateRow[]> {
        const { data, error } = await client.from('tax_rates').select('*')
          .eq('company_id', company_id).eq('is_active', true).order('name');
        assertNoError(error, 'taxRates.list');
        return data ?? [];
      },
    },

    // ── Phase 4: Bank Accounts ────────────────────────────────────────────
    bankAccounts: {
      async list(company_id): Promise<BankAccountRow[]> {
        const { data, error } = await client.from('bank_accounts').select('*')
          .eq('company_id', company_id).eq('is_active', true).order('name');
        assertNoError(error, 'bankAccounts.list');
        return data ?? [];
      },
      async getById(id): Promise<BankAccountRow | null> {
        const { data, error } = await client.from('bank_accounts').select('*').eq('id', id).single();
        if (error?.code === 'PGRST116') return null;
        assertNoError(error, 'bankAccounts.getById');
        return data;
      },
      async create(row: BankAccountInsert): Promise<BankAccountRow> {
        const { data, error } = await client.from('bank_accounts').insert(row).select().single();
        assertNoError(error, 'bankAccounts.create');
        return data!;
      },
      async update(id, row) {
        const { error } = await client.from('bank_accounts').update(row).eq('id', id);
        assertNoError(error, 'bankAccounts.update');
      },
    },

    // ── Phase 4: Invoices ─────────────────────────────────────────────────
    invoices: {
      async list(company_id, status?): Promise<InvoiceRow[]> {
        let q = client.from('invoices').select('*').eq('company_id', company_id);
        if (status) q = q.eq('status', status);
        const { data, error } = await q.order('date', { ascending: false }).order('invoice_number', { ascending: false });
        assertNoError(error, 'invoices.list');
        return data ?? [];
      },
      async getById(id): Promise<InvoiceRow | null> {
        const { data, error } = await client.from('invoices').select('*').eq('id', id).single();
        if (error?.code === 'PGRST116') return null;
        assertNoError(error, 'invoices.getById');
        return data;
      },
      async getItems(invoice_id): Promise<InvoiceItemRow[]> {
        const { data, error } = await client.from('invoice_items').select('*')
          .eq('invoice_id', invoice_id).order('sort_order');
        assertNoError(error, 'invoices.getItems');
        return data ?? [];
      },
      async create(row: InvoiceInsert, items: InvoiceItemInsert[]): Promise<InvoiceRow> {
        const { data: inv, error: invErr } = await client.from('invoices').insert(row).select().single();
        assertNoError(invErr, 'invoices.create header');
        const itemsWithId = items.map((it, i) => ({ ...it, invoice_id: inv!.id, sort_order: i }));
        const { error: itemsErr } = await client.from('invoice_items').insert(itemsWithId);
        assertNoError(itemsErr, 'invoices.create items');
        return inv!;
      },
      async update(id, row: InvoiceUpdate, items: InvoiceItemInsert[]): Promise<void> {
        const { error: hErr } = await client.from('invoices').update(row).eq('id', id);
        assertNoError(hErr, 'invoices.update header');
        const { error: dErr } = await client.from('invoice_items').delete().eq('invoice_id', id);
        assertNoError(dErr, 'invoices.update delete items');
        const itemsWithId = items.map((it, i) => ({ ...it, invoice_id: id, sort_order: i }));
        const { error: iErr } = await client.from('invoice_items').insert(itemsWithId);
        assertNoError(iErr, 'invoices.update insert items');
      },
      async confirm(invoice_id): Promise<InvoiceConfirmResult> {
        const { data, error } = await client.rpc('confirm_invoice', { p_invoice_id: invoice_id });
        assertNoError(error, 'invoices.confirm');
        return data as unknown as InvoiceConfirmResult;
      },
      async void(invoice_id, reason?): Promise<void> {
        const { error } = await client.rpc('void_invoice', {
          p_invoice_id: invoice_id,
          p_reason: reason ?? undefined,
        });
        assertNoError(error, 'invoices.void');
      },
      async edit(invoice_id): Promise<void> {
        const { error } = await client.rpc('edit_invoice', { p_invoice_id: invoice_id });
        assertNoError(error, 'invoices.edit');
      },
      async getNextNumber(company_id): Promise<string> {
        const { data, error } = await client.rpc('get_next_document_number', {
          p_company_id: company_id,
          p_prefix: 'INV',
        });
        assertNoError(error, 'invoices.getNextNumber');
        return data as string;
      },
    },

    // ── Phase 4: Sales Quotes ─────────────────────────────────────────────
    salesQuotes: {
      async list(company_id): Promise<SalesQuoteRow[]> {
        const { data, error } = await client.from('sales_quotes').select('*')
          .eq('company_id', company_id)
          .order('date', { ascending: false });
        assertNoError(error, 'salesQuotes.list');
        return data ?? [];
      },
      async getById(id): Promise<SalesQuoteRow | null> {
        const { data, error } = await client.from('sales_quotes').select('*').eq('id', id).single();
        if (error?.code === 'PGRST116') return null;
        assertNoError(error, 'salesQuotes.getById');
        return data;
      },
      async getItems(quote_id): Promise<SalesQuoteItemRow[]> {
        const { data, error } = await client.from('sales_quote_items').select('*')
          .eq('quote_id', quote_id).order('sort_order');
        assertNoError(error, 'salesQuotes.getItems');
        return data ?? [];
      },
      async create(row: SalesQuoteInsert, items: SalesQuoteItemInsert[]): Promise<SalesQuoteRow> {
        const { data: q, error: qErr } = await client.from('sales_quotes').insert(row).select().single();
        assertNoError(qErr, 'salesQuotes.create header');
        const itemsWithId = items.map((it, i) => ({ ...it, quote_id: q!.id, sort_order: i }));
        const { error: iErr } = await client.from('sales_quote_items').insert(itemsWithId);
        assertNoError(iErr, 'salesQuotes.create items');
        return q!;
      },
      async update(id, row: SalesQuoteUpdate, items: SalesQuoteItemInsert[]): Promise<void> {
        const { error: hErr } = await client.from('sales_quotes').update(row).eq('id', id);
        assertNoError(hErr, 'salesQuotes.update header');
        const { error: dErr } = await client.from('sales_quote_items').delete().eq('quote_id', id);
        assertNoError(dErr, 'salesQuotes.update delete items');
        const itemsWithId = items.map((it, i) => ({ ...it, quote_id: id, sort_order: i }));
        const { error: iErr } = await client.from('sales_quote_items').insert(itemsWithId);
        assertNoError(iErr, 'salesQuotes.update insert items');
      },
      async convertToInvoice(quote_id): Promise<InvoiceRow> {
        const { data: q, error: qErr } = await client.from('sales_quotes').select('*').eq('id', quote_id).single();
        assertNoError(qErr, 'salesQuotes.convertToInvoice fetch quote');
        const { data: qItems, error: qiErr } = await client.from('sales_quote_items').select('*')
          .eq('quote_id', quote_id).order('sort_order');
        assertNoError(qiErr, 'salesQuotes.convertToInvoice fetch items');

        const { data: numData, error: numErr } = await client.rpc('get_next_document_number', {
          p_company_id: q!.company_id, p_prefix: 'INV',
        });
        assertNoError(numErr, 'salesQuotes.convertToInvoice number');

        const invRow: InvoiceInsert = {
          company_id: q!.company_id,
          invoice_number: numData as string,
          contact_id: q!.contact_id,
          salesperson_id: q!.salesperson_id ?? null,
          warehouse_id: null,
          date: new Date().toISOString().slice(0, 10),
          due_date: null,
          reference: q!.reference ?? null,
          price_level_id: q!.price_level_id ?? null,
          currency: q!.currency,
          exchange_rate: q!.exchange_rate,
          prices_inclusive: q!.prices_inclusive,
          subtotal: q!.subtotal,
          discount_amount: q!.discount_amount,
          tax_amount: q!.tax_amount,
          total_amount: q!.total_amount,
          status: 'draft',
          source_quote_id: quote_id,
          source_order_id: null,
          sale_channel: 'standard',
          terms: q!.terms ?? null,
          terms_ar: q!.terms_ar ?? null,
          notes: q!.notes ?? null,
          void_reason: null,
          voided_at: null,
          voided_by: null,
        };
        const { data: inv, error: invErr } = await client.from('invoices').insert(invRow).select().single();
        assertNoError(invErr, 'salesQuotes.convertToInvoice insert invoice');

        const invItems = (qItems ?? []).map((qi, i) => ({
          invoice_id: inv!.id,
          product_id: qi.product_id,
          description: qi.description,
          description_ar: qi.description_ar,
          quantity: qi.quantity,
          unit_id: qi.unit_id,
          unit_price: qi.unit_price,
          discount_percent: qi.discount_percent,
          discount_amount: qi.discount_amount,
          tax_category: qi.tax_category,
          tax_rate: qi.tax_rate,
          tax_amount: qi.tax_amount,
          line_subtotal: qi.line_subtotal,
          line_total: qi.line_total,
          sort_order: i,
          cost_at_sale: null,
          serial_id: null,
        }));
        const { error: iiErr } = await client.from('invoice_items').insert(invItems);
        assertNoError(iiErr, 'salesQuotes.convertToInvoice insert invoice items');

        const { error: updErr } = await client.from('sales_quotes')
          .update({ status: 'fully_invoiced', invoiced_amount: q!.total_amount })
          .eq('id', quote_id);
        assertNoError(updErr, 'salesQuotes.convertToInvoice update quote status');

        return inv!;
      },
      async remove(id): Promise<void> {
        const { error } = await client.from('sales_quotes').delete().eq('id', id);
        assertNoError(error, 'salesQuotes.remove');
      },
      async getNextNumber(company_id): Promise<string> {
        const { data, error } = await client.rpc('get_next_document_number', {
          p_company_id: company_id,
          p_prefix: 'QT',
        });
        assertNoError(error, 'salesQuotes.getNextNumber');
        return data as string;
      },
    },

    // ── Phase 4: Payments ─────────────────────────────────────────────────
    payments: {
      async list(company_id, type?): Promise<PaymentRow[]> {
        let q = client.from('payments').select('*').eq('company_id', company_id);
        if (type) q = q.eq('type', type);
        const { data, error } = await q.order('date', { ascending: false });
        assertNoError(error, 'payments.list');
        return data ?? [];
      },
      async getById(id): Promise<PaymentRow | null> {
        const { data, error } = await client.from('payments').select('*').eq('id', id).single();
        if (error?.code === 'PGRST116') return null;
        assertNoError(error, 'payments.getById');
        return data;
      },
      async getAllocations(payment_id): Promise<PaymentAllocationRow[]> {
        const { data, error } = await client.from('payment_allocations').select('*')
          .eq('payment_id', payment_id).order('created_at');
        assertNoError(error, 'payments.getAllocations');
        return data ?? [];
      },
      async create(row: PaymentInsert, allocations?: PaymentAllocationInsert[]): Promise<PaymentRow> {
        const { data: pmt, error: pmtErr } = await client.from('payments').insert(row).select().single();
        assertNoError(pmtErr, 'payments.create');
        if (allocations && allocations.length > 0) {
          const allocsWithId = allocations.map(a => ({ ...a, payment_id: pmt!.id, company_id: row.company_id }));
          const { error: aErr } = await client.from('payment_allocations').insert(allocsWithId);
          assertNoError(aErr, 'payments.create allocations');
        }
        return pmt!;
      },
      async confirm(payment_id): Promise<PaymentConfirmResult> {
        const { data, error } = await client.rpc('confirm_payment', { p_payment_id: payment_id });
        assertNoError(error, 'payments.confirm');
        return data as unknown as PaymentConfirmResult;
      },
      async applyAdvance(payment_id, invoice_id, amount): Promise<ApplyAdvanceResult> {
        const { data, error } = await client.rpc('apply_advance', {
          p_payment_id: payment_id,
          p_invoice_id: invoice_id,
          p_amount: amount,
        });
        assertNoError(error, 'payments.applyAdvance');
        return data as unknown as ApplyAdvanceResult;
      },
      async void(payment_id, reason?): Promise<void> {
        const { error } = await client.from('payments').update({
          status: 'void',
          void_reason: reason ?? null,
          voided_at: new Date().toISOString(),
        }).eq('id', payment_id);
        assertNoError(error, 'payments.void');
      },
      async getNextNumber(company_id): Promise<string> {
        const { data, error } = await client.rpc('get_next_document_number', {
          p_company_id: company_id,
          p_prefix: 'REC',
        });
        assertNoError(error, 'payments.getNextNumber');
        return data as string;
      },
    },

    // ── Phase 4: Reports ──────────────────────────────────────────────────
    reports: {
      async getProfitAndLoss(company_id, from, to): Promise<ProfitAndLoss> {
        const { data, error } = await client
          .from('general_ledger')
          .select('account_code, debit, credit, chart_of_accounts!inner(name, account_type)')
          .eq('company_id', company_id)
          .gte('date', from)
          .lte('date', to);
        assertNoError(error, 'reports.getProfitAndLoss');

        const byCode: Record<string, { name: string; type: string; debit: number; credit: number }> = {};
        for (const row of data ?? []) {
          const coa = row.chart_of_accounts as unknown as { name: string; account_type: string };
          if (!['revenue', 'expense'].includes(coa.account_type)) continue;
          if (!byCode[row.account_code]) byCode[row.account_code] = { name: coa.name, type: coa.account_type, debit: 0, credit: 0 };
          byCode[row.account_code].debit += Number(row.debit);
          byCode[row.account_code].credit += Number(row.credit);
        }

        const lines: ProfitAndLossLine[] = Object.entries(byCode).map(([code, v]) => ({
          account_code: code,
          account_name: v.name,
          account_type: v.type,
          amount: v.type === 'revenue' ? v.credit - v.debit : v.debit - v.credit,
        }));

        const revenue = lines.filter(l => l.account_type === 'revenue').reduce((s, l) => s + l.amount, 0);
        const cogs = lines.find(l => l.account_code === '5100')?.amount ?? 0;
        const opex = lines.filter(l => l.account_type === 'expense' && l.account_code !== '5100').reduce((s, l) => s + l.amount, 0);

        return {
          period_start: from,
          period_end: to,
          revenue,
          cogs,
          gross_profit: revenue - cogs,
          operating_expenses: opex,
          net_profit: revenue - cogs - opex,
          lines,
        };
      },

      async getBalanceSheet(company_id, as_of_date): Promise<BalanceSheet> {
        const { data, error } = await client
          .from('general_ledger')
          .select('account_code, debit, credit, chart_of_accounts!inner(name, account_type)')
          .eq('company_id', company_id)
          .lte('date', as_of_date);
        assertNoError(error, 'reports.getBalanceSheet');

        const byCode: Record<string, { name: string; type: string; debit: number; credit: number }> = {};
        for (const row of data ?? []) {
          const coa = row.chart_of_accounts as unknown as { name: string; account_type: string };
          if (!['asset', 'liability', 'equity'].includes(coa.account_type)) continue;
          if (!byCode[row.account_code]) byCode[row.account_code] = { name: coa.name, type: coa.account_type, debit: 0, credit: 0 };
          byCode[row.account_code].debit += Number(row.debit);
          byCode[row.account_code].credit += Number(row.credit);
        }

        const lines: BalanceSheetLine[] = Object.entries(byCode).map(([code, v]) => ({
          account_code: code,
          account_name: v.name,
          account_type: v.type,
          balance: v.type === 'asset' ? v.debit - v.credit : v.credit - v.debit,
        }));

        const totalAssets = lines.filter(l => l.account_type === 'asset').reduce((s, l) => s + l.balance, 0);
        const totalLiabilities = lines.filter(l => l.account_type === 'liability').reduce((s, l) => s + l.balance, 0);
        const totalEquity = lines.filter(l => l.account_type === 'equity').reduce((s, l) => s + l.balance, 0);

        return { as_of_date, total_assets: totalAssets, total_liabilities: totalLiabilities, total_equity: totalEquity, lines };
      },

      async getARAgingReport(company_id, as_of_date): Promise<ARAgingReport> {
        const { data: invs, error: invErr } = await client
          .from('invoices')
          .select('id, invoice_number, contact_id, due_date, total_amount, contacts(name)')
          .eq('company_id', company_id)
          .eq('status', 'confirmed')
          .lte('date', as_of_date);
        assertNoError(invErr, 'reports.getARAgingReport invoices');

        const { data: allocs, error: allocErr } = await client
          .from('payment_allocations')
          .select('doc_id, amount_applied')
          .eq('company_id', company_id)
          .eq('doc_type', 'invoice');
        assertNoError(allocErr, 'reports.getARAgingReport allocs');

        const allocByInv: Record<string, number> = {};
        for (const a of allocs ?? []) {
          allocByInv[a.doc_id] = (allocByInv[a.doc_id] ?? 0) + Number(a.amount_applied);
        }

        const asOf = new Date(as_of_date);
        const bucketMap: Record<string, ARAgingBucket> = {};

        for (const inv of invs ?? []) {
          const contact = inv.contacts as unknown as { name: string };
          const outstanding = Number(inv.total_amount) - (allocByInv[inv.id] ?? 0);
          if (outstanding <= 0) continue;

          const dueDate = inv.due_date ? new Date(inv.due_date) : asOf;
          const daysPast = Math.max(0, Math.floor((asOf.getTime() - dueDate.getTime()) / 86400000));

          if (!bucketMap[inv.contact_id]) {
            bucketMap[inv.contact_id] = {
              contact_id: inv.contact_id,
              contact_name: contact?.name ?? inv.contact_id,
              current: 0, days_31_60: 0, days_61_90: 0, over_90: 0, total: 0,
            };
          }
          const b = bucketMap[inv.contact_id];
          if (daysPast <= 30) b.current += outstanding;
          else if (daysPast <= 60) b.days_31_60 += outstanding;
          else if (daysPast <= 90) b.days_61_90 += outstanding;
          else b.over_90 += outstanding;
          b.total += outstanding;
        }

        const buckets = Object.values(bucketMap);
        return {
          as_of_date,
          buckets,
          total_current:  buckets.reduce((s, b) => s + b.current, 0),
          total_31_60:    buckets.reduce((s, b) => s + b.days_31_60, 0),
          total_61_90:    buckets.reduce((s, b) => s + b.days_61_90, 0),
          total_over_90:  buckets.reduce((s, b) => s + b.over_90, 0),
          grand_total:    buckets.reduce((s, b) => s + b.total, 0),
        };
      },

      async getCustomerStatement(company_id, contact_id, from, to): Promise<CustomerStatement> {
        const { data: contact, error: cErr } = await client.from('contacts').select('name')
          .eq('id', contact_id).single();
        assertNoError(cErr, 'reports.getCustomerStatement contact');

        const { data: glRows, error: glErr } = await client
          .from('general_ledger')
          .select('id, date, debit, credit, description, related_doc_type, related_doc_id, journal_entries(entry_number)')
          .eq('company_id', company_id)
          .eq('contact_id', contact_id)
          .eq('account_code', '1200')
          .gte('date', from)
          .lte('date', to)
          .order('date')
          .order('created_at');
        assertNoError(glErr, 'reports.getCustomerStatement gl');

        let balance = 0;
        const lines: CustomerStatementLine[] = (glRows ?? []).map(row => {
          const je = row.journal_entries as unknown as { entry_number: string } | null;
          balance += Number(row.debit) - Number(row.credit);
          return {
            date: row.date as string,
            doc_type: row.related_doc_type ?? 'je',
            doc_number: je?.entry_number ?? row.id,
            debit: Number(row.debit),
            credit: Number(row.credit),
            balance,
          };
        });

        return {
          contact_id,
          contact_name: (contact as { name: string })?.name ?? contact_id,
          from_date: from,
          to_date: to,
          opening_balance: 0,
          lines,
          closing_balance: balance,
        };
      },

      async getAPAgingReport(company_id, as_of_date): Promise<APAgingReport> {
        const { data: glRows, error } = await client
          .from('general_ledger')
          .select('contact_id, debit, credit, date, related_doc_type, related_doc_id, contacts(name)')
          .eq('company_id', company_id)
          .eq('account_code', '2100')
          .lte('date', as_of_date);
        assertNoError(error, 'reports.getAPAgingReport');

        const byContact: Record<string, { name: string; current: number; days_31_60: number; days_61_90: number; over_90: number }> = {};
        for (const row of glRows ?? []) {
          if (!row.contact_id) continue;
          const net = Number(row.credit) - Number(row.debit);
          if (net === 0) continue;
          if (!byContact[row.contact_id]) {
            const contact = row.contacts as unknown as { name: string } | null;
            byContact[row.contact_id] = { name: contact?.name ?? '', current: 0, days_31_60: 0, days_61_90: 0, over_90: 0 };
          }
          const bucket = apAgingBucket(row.date as string | null, as_of_date);
          byContact[row.contact_id][bucket === 'current' ? 'current' : bucket === '31_60' ? 'days_31_60' : bucket === '61_90' ? 'days_61_90' : 'over_90'] += net;
        }

        const buckets: APAgingBucketType[] = Object.entries(byContact).map(([id, b]) => ({
          contact_id: id, contact_name: b.name,
          current: b.current, days_31_60: b.days_31_60, days_61_90: b.days_61_90, over_90: b.over_90,
          total: b.current + b.days_31_60 + b.days_61_90 + b.over_90,
        })).filter(b => b.total > 0);

        return {
          as_of_date,
          buckets,
          total_current: buckets.reduce((s, b) => s + b.current, 0),
          total_31_60:   buckets.reduce((s, b) => s + b.days_31_60, 0),
          total_61_90:   buckets.reduce((s, b) => s + b.days_61_90, 0),
          total_over_90: buckets.reduce((s, b) => s + b.over_90, 0),
          grand_total:   buckets.reduce((s, b) => s + b.total, 0),
        };
      },

      async getSupplierStatement(company_id, contact_id, from, to): Promise<SupplierStatement> {
        const { data: contact, error: cErr } = await client.from('contacts').select('name').eq('id', contact_id).single();
        assertNoError(cErr, 'reports.getSupplierStatement contact');

        const { data: glRows, error: glErr } = await client
          .from('general_ledger')
          .select('id, date, debit, credit, description, related_doc_type, related_doc_id, journal_entries(entry_number)')
          .eq('company_id', company_id)
          .eq('contact_id', contact_id)
          .eq('account_code', '2100')
          .gte('date', from)
          .lte('date', to)
          .order('date')
          .order('created_at');
        assertNoError(glErr, 'reports.getSupplierStatement gl');

        let balance = 0;
        const lines: SupplierStatementLine[] = (glRows ?? []).map(row => {
          const je = row.journal_entries as unknown as { entry_number: string } | null;
          balance += Number(row.credit) - Number(row.debit);
          return {
            date: row.date as string,
            doc_type: row.related_doc_type ?? 'je',
            doc_number: je?.entry_number ?? row.id,
            debit: Number(row.debit),
            credit: Number(row.credit),
            balance,
          };
        });

        return {
          contact_id, contact_name: (contact as { name: string })?.name ?? contact_id,
          from_date: from, to_date: to,
          opening_balance: 0, lines, closing_balance: balance,
        };
      },

      async getGRNReconciliation(company_id, as_of_date): Promise<GRNReconciliationReport> {
        const { data: grns, error } = await client
          .from('goods_receipts')
          .select('id, grn_number, supplier_id, date, contacts(name), goods_receipt_items(total_cost)')
          .eq('company_id', company_id)
          .eq('status', 'received')
          .lte('date', as_of_date);
        assertNoError(error, 'reports.getGRNReconciliation');

        const lines: GRNReconciliationLine[] = (grns ?? []).map(grn => {
          const contact = grn.contacts as unknown as { name: string } | null;
          const items = grn.goods_receipt_items as unknown as { total_cost: number }[] | null;
          const totalCost = (items ?? []).reduce((s, i) => s + Number(i.total_cost), 0);
          return {
            grn_id: grn.id, grn_number: grn.grn_number,
            supplier_id: grn.supplier_id, supplier_name: contact?.name ?? '',
            date: grn.date as string,
            total_cost: totalCost, billed_amount: 0, unbilled_amount: totalCost,
          };
        });

        return {
          as_of_date, lines,
          total_accrual:  lines.reduce((s, l) => s + l.total_cost, 0),
          total_billed:   0,
          total_unbilled: lines.reduce((s, l) => s + l.unbilled_amount, 0),
        };
      },

      async getStockValuation(company_id, as_of_date): Promise<StockValuationReport> {
        const { data, error } = await client
          .from('stock_ledger')
          .select('product_id, warehouse_id, running_qty, running_avg_cost, created_at, products(code, name), warehouses(name)')
          .eq('company_id', company_id)
          .lte('date', as_of_date)
          .order('created_at', { ascending: false });
        assertNoError(error, 'reports.getStockValuation');

        const seen = new Set<string>();
        const lines: StockValuationLine[] = [];

        for (const row of data ?? []) {
          const key = `${row.product_id}::${row.warehouse_id}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const qty = Number(row.running_qty);
          if (qty <= 0) continue;

          const product = row.products as unknown as { code: string; name: string } | null;
          const warehouse = row.warehouses as unknown as { name: string } | null;
          const unitCost = Number(row.running_avg_cost);

          lines.push({
            product_id: row.product_id,
            product_code: product?.code ?? '',
            product_name: product?.name ?? '',
            warehouse_id: row.warehouse_id,
            warehouse_name: warehouse?.name ?? '',
            quantity: qty,
            unit_cost: unitCost,
            total_value: qty * unitCost,
          });
        }

        return {
          as_of_date,
          lines,
          total_value: lines.reduce((s, l) => s + l.total_value, 0),
        };
      },

      // Phase 6 reports ──────────────────────────────────────────────────────
      async getStockMovement(company_id, product_id, from, to): Promise<StockMovementLine[]> {
        const { data, error } = await client
          .from('stock_ledger')
          .select('product_id, warehouse_id, date, type, direction, quantity, unit_cost, running_qty, products(name, sku), warehouses(name)')
          .eq('company_id', company_id)
          .eq('product_id', product_id)
          .gte('date', from)
          .lte('date', to)
          .order('created_at');
        assertNoError(error, 'reports.getStockMovement');
        return (data ?? []).map(r => {
          const p = r.products as unknown as { name: string; sku: string } | null;
          const w = r.warehouses as unknown as { name: string } | null;
          return {
            product_id: r.product_id, product_name: p?.name ?? '', sku: p?.sku ?? '',
            warehouse_id: r.warehouse_id, warehouse_name: w?.name ?? '',
            date: r.date as string, type: r.type, direction: Number(r.direction),
            quantity: Number(r.quantity), unit_cost: Number(r.unit_cost),
            running_qty: Number(r.running_qty),
          };
        });
      },

      async getSlowMoving(company_id, threshold_days, as_of): Promise<SlowMovingLine[]> {
        // Get latest stock_ledger row per product+warehouse
        const { data, error } = await client
          .from('stock_ledger')
          .select('product_id, warehouse_id, running_qty, running_avg_cost, date, products(name, sku), warehouses(name)')
          .eq('company_id', company_id)
          .order('created_at', { ascending: false });
        assertNoError(error, 'reports.getSlowMoving');

        const seen = new Set<string>();
        const lines: SlowMovingLine[] = [];
        for (const row of data ?? []) {
          const key = `${row.product_id}::${row.warehouse_id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const qty = Number(row.running_qty);
          if (qty <= 0) continue;
          const days = stockAgingDays(row.date as string, as_of);
          if (days < threshold_days) continue;
          const p = row.products as unknown as { name: string; sku: string } | null;
          const w = row.warehouses as unknown as { name: string } | null;
          lines.push({
            product_id: row.product_id, product_name: p?.name ?? '', sku: p?.sku ?? '',
            warehouse_id: row.warehouse_id, warehouse_name: w?.name ?? '',
            current_qty: qty, last_movement_date: row.date as string,
            days_since_movement: days,
            stock_value: qty * Number(row.running_avg_cost),
          });
        }
        return lines.sort((a, b) => b.days_since_movement - a.days_since_movement);
      },

      async getReorderReport(company_id): Promise<ReorderLine[]> {
        // Get current qty per product+warehouse; join products for min_stock_level
        const { data, error } = await client
          .from('stock_ledger')
          .select('product_id, warehouse_id, running_qty, products(name, sku, min_stock_level), warehouses(name)')
          .eq('company_id', company_id)
          .order('created_at', { ascending: false });
        assertNoError(error, 'reports.getReorderReport');

        const seen = new Set<string>();
        const lines: ReorderLine[] = [];
        for (const row of data ?? []) {
          const key = `${row.product_id}::${row.warehouse_id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const p = row.products as unknown as { name: string; sku: string; min_stock_level: number } | null;
          const w = row.warehouses as unknown as { name: string } | null;
          const qty = Number(row.running_qty);
          const min = Number(p?.min_stock_level ?? 0);
          if (qty > min) continue;
          lines.push({
            product_id: row.product_id, product_name: p?.name ?? '', sku: p?.sku ?? '',
            warehouse_id: row.warehouse_id, warehouse_name: w?.name ?? '',
            current_qty: qty, min_stock_level: min, shortage: min - qty,
          });
        }
        return lines.sort((a, b) => b.shortage - a.shortage);
      },

      async getStockAging(company_id, as_of): Promise<StockAgingLine[]> {
        const { data, error } = await client
          .from('stock_ledger')
          .select('product_id, warehouse_id, running_qty, running_avg_cost, date, products(name, sku), warehouses(name)')
          .eq('company_id', company_id)
          .lte('date', as_of)
          .order('created_at', { ascending: false });
        assertNoError(error, 'reports.getStockAging');

        const seen = new Set<string>();
        const lines: StockAgingLine[] = [];
        for (const row of data ?? []) {
          const key = `${row.product_id}::${row.warehouse_id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const qty = Number(row.running_qty);
          if (qty <= 0) continue;
          const cost = Number(row.running_avg_cost);
          const days = stockAgingDays(row.date as string, as_of);
          const bucket = stockAgingBucket(days);
          const value = qty * cost;
          const p = row.products as unknown as { name: string; sku: string } | null;
          const w = row.warehouses as unknown as { name: string } | null;
          lines.push({
            product_id: row.product_id, product_name: p?.name ?? '', sku: p?.sku ?? '',
            warehouse_id: row.warehouse_id, warehouse_name: w?.name ?? '',
            current_qty: qty, unit_cost: cost,
            bucket_0_30:    bucket === '0_30'    ? value : 0,
            bucket_31_60:   bucket === '31_60'   ? value : 0,
            bucket_61_90:   bucket === '61_90'   ? value : 0,
            bucket_over_90: bucket === 'over_90' ? value : 0,
            total_value: value,
          });
        }
        return lines;
      },

      async getInventoryAdjustmentReport(company_id, from, to): Promise<InventoryAdjustmentReportLine[]> {
        const { data, error } = await client
          .from('inventory_adjustments')
          .select('id, adjustment_number, date, reason, warehouses(name), inventory_adjustment_items(difference, unit_cost)')
          .eq('company_id', company_id)
          .eq('status', 'confirmed')
          .gte('date', from)
          .lte('date', to)
          .order('date');
        assertNoError(error, 'reports.getInventoryAdjustmentReport');
        return (data ?? []).map(adj => {
          const w = adj.warehouses as unknown as { name: string } | null;
          const items = adj.inventory_adjustment_items as unknown as { difference: number; unit_cost: number | null }[] | null ?? [];
          const totalGain = items.filter(i => Number(i.difference) > 0)
            .reduce((s, i) => s + Number(i.difference) * Number(i.unit_cost ?? 0), 0);
          const totalLoss = items.filter(i => Number(i.difference) < 0)
            .reduce((s, i) => s + Math.abs(Number(i.difference)) * Number(i.unit_cost ?? 0), 0);
          return {
            adjustment_id: adj.id,
            adjustment_number: adj.adjustment_number,
            date: adj.date as string,
            warehouse_name: w?.name ?? '',
            reason: adj.reason,
            total_gain: totalGain,
            total_loss: totalLoss,
            net: totalGain - totalLoss,
          };
        });
      },
    },

    // ── Purchase Orders ───────────────────────────────────────────────────────
    purchaseOrders: {
      async list(company_id, status) {
        let q = client.from('purchase_orders').select('*').eq('company_id', company_id).order('date', { ascending: false });
        if (status) q = q.eq('status', status);
        const { data, error } = await q;
        assertNoError(error, 'purchaseOrders.list');
        return (data ?? []) as PurchaseOrderRow[];
      },
      async getById(id) {
        const { data, error } = await client.from('purchase_orders').select('*').eq('id', id).single();
        if (error?.code === 'PGRST116') return null;
        assertNoError(error, 'purchaseOrders.getById');
        return data as PurchaseOrderRow;
      },
      async getItems(po_id) {
        const { data, error } = await client.from('purchase_order_items').select('*').eq('po_id', po_id).order('sort_order');
        assertNoError(error, 'purchaseOrders.getItems');
        return (data ?? []) as PurchaseOrderItemRow[];
      },
      async create(row, items) {
        const { data, error } = await client.from('purchase_orders').insert(row).select().single();
        assertNoError(error, 'purchaseOrders.create');
        const po = data as PurchaseOrderRow;
        if (items.length > 0) {
          const { error: iErr } = await client.from('purchase_order_items').insert(items.map(i => ({ ...i, po_id: po.id })));
          assertNoError(iErr, 'purchaseOrders.create items');
        }
        return po;
      },
      async update(id, row, items) {
        const { error } = await client.from('purchase_orders').update(row).eq('id', id);
        assertNoError(error, 'purchaseOrders.update');
        await client.from('purchase_order_items').delete().eq('po_id', id);
        if (items.length > 0) {
          const { error: iErr } = await client.from('purchase_order_items').insert(items.map(i => ({ ...i, po_id: id })));
          assertNoError(iErr, 'purchaseOrders.update items');
        }
      },
      async send(id) {
        const { error } = await client.from('purchase_orders').update({ status: 'sent' }).eq('id', id);
        assertNoError(error, 'purchaseOrders.send');
      },
      async close(id) {
        const { error } = await client.from('purchase_orders').update({ status: 'closed' }).eq('id', id);
        assertNoError(error, 'purchaseOrders.close');
      },
      async getNextNumber(company_id) {
        const { data, error } = await client.rpc('get_next_document_number', { p_company_id: company_id, p_prefix: 'PO' });
        assertNoError(error, 'purchaseOrders.getNextNumber');
        return data as string;
      },
    },

    // ── Goods Receipts ────────────────────────────────────────────────────────
    goodsReceipts: {
      async list(company_id, status) {
        let q = client.from('goods_receipts').select('*').eq('company_id', company_id).order('date', { ascending: false });
        if (status) q = q.eq('status', status);
        const { data, error } = await q;
        assertNoError(error, 'goodsReceipts.list');
        return (data ?? []) as GoodsReceiptRow[];
      },
      async getById(id) {
        const { data, error } = await client.from('goods_receipts').select('*').eq('id', id).single();
        if (error?.code === 'PGRST116') return null;
        assertNoError(error, 'goodsReceipts.getById');
        return data as GoodsReceiptRow;
      },
      async getItems(grn_id) {
        const { data, error } = await client.from('goods_receipt_items').select('*').eq('grn_id', grn_id);
        assertNoError(error, 'goodsReceipts.getItems');
        return (data ?? []) as GoodsReceiptItemRow[];
      },
      async create(row, items) {
        const { data, error } = await client.from('goods_receipts').insert(row).select().single();
        assertNoError(error, 'goodsReceipts.create');
        const grn = data as GoodsReceiptRow;
        if (items.length > 0) {
          const { error: iErr } = await client.from('goods_receipt_items').insert(items.map(i => ({ ...i, grn_id: grn.id })));
          assertNoError(iErr, 'goodsReceipts.create items');
        }
        return grn;
      },
      async update(id, row, items) {
        const { error } = await client.from('goods_receipts').update(row).eq('id', id);
        assertNoError(error, 'goodsReceipts.update');
        await client.from('goods_receipt_items').delete().eq('grn_id', id);
        if (items.length > 0) {
          const { error: iErr } = await client.from('goods_receipt_items').insert(items.map(i => ({ ...i, grn_id: id })));
          assertNoError(iErr, 'goodsReceipts.update items');
        }
      },
      async confirm(grn_id) {
        const { data, error } = await client.rpc('confirm_grn', { p_grn_id: grn_id });
        assertNoError(error, 'goodsReceipts.confirm');
        return data as unknown as GRNConfirmResult;
      },
      async getNextNumber(company_id) {
        const { data, error } = await client.rpc('get_next_document_number', { p_company_id: company_id, p_prefix: 'GRN' });
        assertNoError(error, 'goodsReceipts.getNextNumber');
        return data as string;
      },
    },

    // ── Vendor Bills ──────────────────────────────────────────────────────────
    vendorBills: {
      async list(company_id, status) {
        let q = client.from('vendor_bills').select('*').eq('company_id', company_id).order('date', { ascending: false });
        if (status) q = q.eq('status', status);
        const { data, error } = await q;
        assertNoError(error, 'vendorBills.list');
        return (data ?? []) as VendorBillRow[];
      },
      async getById(id) {
        const { data, error } = await client.from('vendor_bills').select('*').eq('id', id).single();
        if (error?.code === 'PGRST116') return null;
        assertNoError(error, 'vendorBills.getById');
        return data as VendorBillRow;
      },
      async getItems(bill_id) {
        const { data, error } = await client.from('vendor_bill_items').select('*').eq('bill_id', bill_id).order('sort_order');
        assertNoError(error, 'vendorBills.getItems');
        return (data ?? []) as VendorBillItemRow[];
      },
      async create(row, items) {
        const { data, error } = await client.from('vendor_bills').insert(row).select().single();
        assertNoError(error, 'vendorBills.create');
        const bill = data as VendorBillRow;
        if (items.length > 0) {
          const { error: iErr } = await client.from('vendor_bill_items').insert(items.map(i => ({ ...i, bill_id: bill.id })));
          assertNoError(iErr, 'vendorBills.create items');
        }
        return bill;
      },
      async update(id, row, items) {
        const { error } = await client.from('vendor_bills').update(row).eq('id', id);
        assertNoError(error, 'vendorBills.update');
        await client.from('vendor_bill_items').delete().eq('bill_id', id);
        if (items.length > 0) {
          const { error: iErr } = await client.from('vendor_bill_items').insert(items.map(i => ({ ...i, bill_id: id })));
          assertNoError(iErr, 'vendorBills.update items');
        }
      },
      async confirm(bill_id) {
        const { data, error } = await client.rpc('confirm_vendor_bill', { p_bill_id: bill_id });
        assertNoError(error, 'vendorBills.confirm');
        return data as unknown as BillConfirmResult;
      },
      async getNextNumber(company_id) {
        const { data, error } = await client.rpc('get_next_document_number', { p_company_id: company_id, p_prefix: 'BILL' });
        assertNoError(error, 'vendorBills.getNextNumber');
        return data as string;
      },
    },

    // ── Vendor Payments ───────────────────────────────────────────────────────
    vendorPayments: {
      async list(company_id) {
        const { data, error } = await client.from('payments').select('*')
          .eq('company_id', company_id).eq('type', 'outbound').order('date', { ascending: false });
        assertNoError(error, 'vendorPayments.list');
        return (data ?? []) as PaymentRow[];
      },
      async getById(id) {
        const { data, error } = await client.from('payments').select('*').eq('id', id).single();
        if (error?.code === 'PGRST116') return null;
        assertNoError(error, 'vendorPayments.getById');
        return data as PaymentRow;
      },
      async getAllocations(payment_id) {
        const { data, error } = await client.from('payment_allocations').select('*').eq('payment_id', payment_id);
        assertNoError(error, 'vendorPayments.getAllocations');
        return (data ?? []) as PaymentAllocationRow[];
      },
      async create(row, allocations) {
        const { data, error } = await client.from('payments').insert(row).select().single();
        assertNoError(error, 'vendorPayments.create');
        const pmt = data as PaymentRow;
        if (allocations && allocations.length > 0) {
          const { error: aErr } = await client.from('payment_allocations').insert(
            allocations.map(a => ({ ...a, payment_id: pmt.id, company_id: pmt.company_id }))
          );
          assertNoError(aErr, 'vendorPayments.create allocations');
        }
        return pmt;
      },
      async confirm(payment_id) {
        const { data, error } = await client.rpc('confirm_vendor_payment', { p_payment_id: payment_id });
        assertNoError(error, 'vendorPayments.confirm');
        return data as unknown as VendorPaymentConfirmResult;
      },
      async applyAdvance(payment_id, bill_id, amount) {
        const { data, error } = await client.rpc('apply_vendor_advance', { p_payment_id: payment_id, p_bill_id: bill_id, p_amount: amount });
        assertNoError(error, 'vendorPayments.applyAdvance');
        return data as unknown as ApplyVendorAdvanceResult;
      },
      async getNextNumber(company_id) {
        const { data, error } = await client.rpc('get_next_document_number', { p_company_id: company_id, p_prefix: 'VP' });
        assertNoError(error, 'vendorPayments.getNextNumber');
        return data as string;
      },
    },

    // ── Stock Transfers ───────────────────────────────────────────────────────
    stockTransfers: {
      async list(company_id, status) {
        let q = client.from('stock_transfers').select('*').eq('company_id', company_id).order('date', { ascending: false });
        if (status) q = q.eq('status', status);
        const { data, error } = await q;
        assertNoError(error, 'stockTransfers.list');
        return (data ?? []) as StockTransferRow[];
      },
      async getById(id) {
        const { data, error } = await client.from('stock_transfers').select('*').eq('id', id).single();
        if (error?.code === 'PGRST116') return null;
        assertNoError(error, 'stockTransfers.getById');
        return data as StockTransferRow;
      },
      async getItems(transfer_id) {
        const { data, error } = await client.from('stock_transfer_items').select('*').eq('transfer_id', transfer_id);
        assertNoError(error, 'stockTransfers.getItems');
        return (data ?? []) as StockTransferItemRow[];
      },
      async create(row, items) {
        const { data, error } = await client.from('stock_transfers').insert(row).select().single();
        assertNoError(error, 'stockTransfers.create');
        const transfer = data as StockTransferRow;
        if (items.length > 0) {
          const { error: iErr } = await client.from('stock_transfer_items').insert(items.map(i => ({ ...i, transfer_id: transfer.id })));
          assertNoError(iErr, 'stockTransfers.create items');
        }
        return transfer;
      },
      async update(id, row, items) {
        const { error } = await client.from('stock_transfers').update(row).eq('id', id);
        assertNoError(error, 'stockTransfers.update');
        await client.from('stock_transfer_items').delete().eq('transfer_id', id);
        if (items.length > 0) {
          const { error: iErr } = await client.from('stock_transfer_items').insert(items.map(i => ({ ...i, transfer_id: id })));
          assertNoError(iErr, 'stockTransfers.update items');
        }
      },
      async confirm(transfer_id) {
        const { data, error } = await client.rpc('confirm_stock_transfer', { p_transfer_id: transfer_id });
        assertNoError(error, 'stockTransfers.confirm');
        return data as unknown as TransferConfirmResult;
      },
      async getNextNumber(company_id) {
        const { data, error } = await client.rpc('get_next_document_number', { p_company_id: company_id, p_prefix: 'TRF' });
        assertNoError(error, 'stockTransfers.getNextNumber');
        return data as string;
      },
    },

    // ── Inventory Adjustments ─────────────────────────────────────────────────
    inventoryAdjustments: {
      async list(company_id, status) {
        let q = client.from('inventory_adjustments').select('*').eq('company_id', company_id).order('date', { ascending: false });
        if (status) q = q.eq('status', status);
        const { data, error } = await q;
        assertNoError(error, 'inventoryAdjustments.list');
        return (data ?? []) as InventoryAdjustmentRow[];
      },
      async getById(id) {
        const { data, error } = await client.from('inventory_adjustments').select('*').eq('id', id).single();
        if (error?.code === 'PGRST116') return null;
        assertNoError(error, 'inventoryAdjustments.getById');
        return data as InventoryAdjustmentRow;
      },
      async getItems(adjustment_id) {
        const { data, error } = await client.from('inventory_adjustment_items').select('*').eq('adjustment_id', adjustment_id);
        assertNoError(error, 'inventoryAdjustments.getItems');
        return (data ?? []) as AdjustmentItemRow[];
      },
      async create(row, items) {
        const { data, error } = await client.from('inventory_adjustments').insert(row).select().single();
        assertNoError(error, 'inventoryAdjustments.create');
        const adj = data as InventoryAdjustmentRow;
        if (items.length > 0) {
          const { error: iErr } = await client.from('inventory_adjustment_items').insert(items.map(i => ({ ...i, adjustment_id: adj.id })));
          assertNoError(iErr, 'inventoryAdjustments.create items');
        }
        return adj;
      },
      async confirm(adjustment_id) {
        const { data, error } = await client.rpc('confirm_inventory_adjustment', { p_adjustment_id: adjustment_id });
        assertNoError(error, 'inventoryAdjustments.confirm');
        return data as unknown as AdjustmentConfirmResult;
      },
      async getNextNumber(company_id) {
        const { data, error } = await client.rpc('get_next_document_number', { p_company_id: company_id, p_prefix: 'ADJ' });
        assertNoError(error, 'inventoryAdjustments.getNextNumber');
        return data as string;
      },
    },

    // ── Product Serials ───────────────────────────────────────────────────────
    productSerials: {
      async listByProduct(company_id, product_id) {
        const { data, error } = await client.from('product_serials').select('*')
          .eq('company_id', company_id).eq('product_id', product_id).order('created_at', { ascending: false });
        assertNoError(error, 'productSerials.listByProduct');
        return (data ?? []) as ProductSerialRow[];
      },
      async listByWarehouse(company_id, warehouse_id, status) {
        let q = client.from('product_serials').select('*')
          .eq('company_id', company_id).eq('warehouse_id', warehouse_id);
        if (status) q = q.eq('status', status);
        const { data, error } = await q.order('created_at', { ascending: false });
        assertNoError(error, 'productSerials.listByWarehouse');
        return (data ?? []) as ProductSerialRow[];
      },
      async create(row) {
        const { data, error } = await client.from('product_serials').insert(row).select().single();
        assertNoError(error, 'productSerials.create');
        return data as ProductSerialRow;
      },
      async updateStatus(id, status) {
        const { error } = await client.from('product_serials').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
        assertNoError(error, 'productSerials.updateStatus');
      },
    },
  };
}
