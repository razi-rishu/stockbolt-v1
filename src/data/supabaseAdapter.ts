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
} from './adapter';
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
  };
}
