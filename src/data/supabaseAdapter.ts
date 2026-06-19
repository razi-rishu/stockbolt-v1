import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/database';
import { normalizeSettings, DEFAULT_TEMPLATE_SETTINGS } from '@/modules/print/engine/types';
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
  // Phase 7
  PosSessionRow,
  OpenSessionResult, CloseSessionResult, PosSaleResult,
  POSSessionReportLine, DailySalesSummaryLine,
  // Phase 8
  BankTransferRow,
  ExpenseRow, ExpenseItemRow,
  PDCChequeRow,
  BankTransferConfirmResult, ExpenseConfirmResult,
  CreatePDCResult, PDCActionResult, PDCCreateParams,
  DailyCashLine, BankReconLine,
  // Phase 9
  CreditNoteRow, CreditNoteItemRow, CreditNoteInsert, CreditNoteUpdate, CreditNoteItemInsert,
  SalesReturnRow, SalesReturnItemRow, SalesReturnInsert, SalesReturnItemInsert,
  DebitNoteRow, DebitNoteItemRow, DebitNoteInsert, DebitNoteUpdate, DebitNoteItemInsert,
  CreditNoteConfirmResult, DebitNoteConfirmResult,
  // Phase 10
  SalesByCustomerLine, SalesByProductLine, SalesByBrandLine,
  SalesByVehicleLine, SalesBySalespersonLine, SalesTrendLine,
  PurchasesBySupplierLine, PurchasesByProductLine, OutstandingPOLine,
  VATReturn, VATReturnBox,
  AuditLogLine, ReversalTrailLine,
  CashFlowStatement, CashFlowSection,
  OwnerDashboard,
  InvariantResult,
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
  if (!error) return;
  const msg = error.message || '';
  // A browser-level fetch failure means the request never reached Supabase
  // (no internet, or — most common on free tier — the project is paused).
  // Translate the cryptic "TypeError: Failed to fetch" into a clear action.
  if (/failed to fetch|networkerror|network error|load failed/i.test(msg)) {
    throw new SupabaseDataError(
      `${context}: Can't reach the server. Check your internet — or your Supabase project may be paused (open the Supabase dashboard and Resume it), then try again.`,
    );
  }
  throw new SupabaseDataError(`${context}: ${msg}`);
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
      async getPrintConfig(company_id) {
        const { data, error } = await client.from('companies').select('print_config').eq('id', company_id).single();
        assertNoError(error, 'companies.getPrintConfig');
        return (data?.print_config ?? {}) as unknown as import('./adapter').PrintConfig;
      },
      async savePrintConfig(company_id, config) {
        const { error } = await client.from('companies').update({ print_config: config as unknown as import('../types/database').Json }).eq('id', company_id);
        assertNoError(error, 'companies.savePrintConfig');
      },
    },

    // ── Print Templates (Phase 15) ───────────────────────────────────────────
    // The print_templates / print_template_defaults tables are added by the
    // Phase 15 migration and may not be in the generated Database types until
    // they're regenerated — so we access them through an untyped client handle.
    printTemplates: (() => {
      const db = client as unknown as SupabaseClient;
      type Row = import('./adapter').PrintTemplate;

      const map = (r: Record<string, unknown>): Row =>
        ({ ...r, settings: normalizeSettings(r.settings) }) as unknown as Row;

      const fallback = (company_id: string): Row => ({
        id: '', company_id, name: 'Default Template', template_style: 'classic',
        primary_color: '#0F172A', secondary_color: '#475569', accent_color: '#F5C242', text_color: '#0F172A',
        font_family: 'Inter', font_size: 'medium', logo_position: 'left', logo_size: 'medium',
        is_default: true, settings: DEFAULT_TEMPLATE_SETTINGS,
      });

      return {
        async list(company_id: string): Promise<Row[]> {
          const { data, error } = await db.from('print_templates')
            .select('*').eq('company_id', company_id)
            .order('is_default', { ascending: false }).order('created_at', { ascending: true });
          assertNoError(error, 'printTemplates.list');
          return (data ?? []).map(map);
        },

        async getResolved(company_id: string, documentType): Promise<Row> {
          // 1) per-doc-type default
          const { data: def } = await db.from('print_template_defaults')
            .select('template_id').eq('company_id', company_id).eq('document_type', documentType).maybeSingle();
          if (def?.template_id) {
            const { data: t } = await db.from('print_templates').select('*').eq('id', def.template_id).maybeSingle();
            if (t) return map(t);
          }
          // 2) company-wide default
          const { data: d } = await db.from('print_templates')
            .select('*').eq('company_id', company_id).eq('is_default', true).maybeSingle();
          if (d) return map(d);
          // 3) synthesized classic fallback (table empty / migration not yet run)
          return fallback(company_id);
        },

        async create(company_id: string, template): Promise<Row> {
          const insert = { ...template, company_id, settings: normalizeSettings(template.settings) };
          const { data, error } = await db.from('print_templates').insert(insert).select('*').single();
          assertNoError(error, 'printTemplates.create');
          return map(data);
        },

        async update(id: string, patch): Promise<Row> {
          const body = patch.settings ? { ...patch, settings: normalizeSettings(patch.settings) } : patch;
          const { data, error } = await db.from('print_templates').update(body).eq('id', id).select('*').single();
          assertNoError(error, 'printTemplates.update');
          return map(data);
        },

        async duplicate(id: string, newName: string): Promise<Row> {
          const { data: src, error: e1 } = await db.from('print_templates').select('*').eq('id', id).single();
          assertNoError(e1, 'printTemplates.duplicate.read');
          const { id: _id, created_at: _c, updated_at: _u, ...rest } = src as Record<string, unknown>;
          const { data, error } = await db.from('print_templates')
            .insert({ ...rest, name: newName, is_default: false }).select('*').single();
          assertNoError(error, 'printTemplates.duplicate');
          return map(data);
        },

        async remove(id: string): Promise<void> {
          const { error } = await db.from('print_templates').delete().eq('id', id);
          assertNoError(error, 'printTemplates.remove');
        },

        async setDefault(company_id: string, id: string): Promise<void> {
          // Clear the existing default first (partial unique index allows only one).
          const { error: e1 } = await db.from('print_templates')
            .update({ is_default: false }).eq('company_id', company_id).eq('is_default', true);
          assertNoError(e1, 'printTemplates.setDefault.clear');
          const { error: e2 } = await db.from('print_templates').update({ is_default: true }).eq('id', id);
          assertNoError(e2, 'printTemplates.setDefault.set');
        },

        async setDocTypeDefault(company_id: string, documentType, id: string): Promise<void> {
          const { error } = await db.from('print_template_defaults')
            .upsert({ company_id, document_type: documentType, template_id: id }, { onConflict: 'company_id,document_type' });
          assertNoError(error, 'printTemplates.setDocTypeDefault');
        },

        async listDocTypeDefaults(company_id: string): Promise<Record<string, string>> {
          const { data, error } = await db.from('print_template_defaults')
            .select('document_type, template_id').eq('company_id', company_id);
          assertNoError(error, 'printTemplates.listDocTypeDefaults');
          const out: Record<string, string> = {};
          for (const r of (data ?? []) as { document_type: string; template_id: string }[]) {
            out[r.document_type] = r.template_id;
          }
          return out;
        },

        async clearDocTypeDefault(company_id: string, documentType): Promise<void> {
          const { error } = await db.from('print_template_defaults')
            .delete().eq('company_id', company_id).eq('document_type', documentType);
          assertNoError(error, 'printTemplates.clearDocTypeDefault');
        },
      };
    })(),

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
      async smartSearch(input): Promise<import('./adapter').ProductSearchRow[]> {
        // Calls Phase 12.18 search_products RPC. Server-side trigram +
        // exact match; hard-capped at 100 rows.
        const { data, error } = await (client.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)
          ('search_products', {
            p_company_id:        input.company_id,
            p_q:                 input.q ?? null,
            p_limit:             input.limit ?? 20,
            p_brand_id:          input.brand_id ?? null,
            p_category_id:       input.category_id ?? null,
            p_include_inactive:  input.include_inactive ?? false,
          });
        assertNoError(error as Error | null, 'products.smartSearch');
        return (data as import('./adapter').ProductSearchRow[]) ?? [];
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
    // ── Geography (Phase 16) — untyped handle until generated types refresh ──
    geography: (() => {
      const db = client as unknown as SupabaseClient;
      type Region = import('./adapter').GeographicRegion;
      return {
        async listRegions(company_id: string, country_code: string): Promise<Region[]> {
          const { data, error } = await db.from('geographic_regions')
            .select('*')
            .eq('country_code', country_code)
            .eq('is_active', true)
            .or(`company_id.is.null,company_id.eq.${company_id}`)
            .order('region_name', { ascending: true });
          assertNoError(error, 'geography.listRegions');
          return (data ?? []) as Region[];
        },
        async createRegion(company_id: string, input): Promise<Region> {
          const { data, error } = await db.from('geographic_regions')
            .insert({
              company_id,
              country_code: input.country_code,
              region_name:  input.region_name,
              region_type:  input.region_type ?? 'region',
              is_system:    false,
            })
            .select('*').single();
          assertNoError(error, 'geography.createRegion');
          return data as Region;
        },
      };
    })(),

    // ── Exchange rates (Phase 17) — untyped handle until generated types refresh ──
    exchangeRates: (() => {
      const db = client as unknown as SupabaseClient;
      type Rate = import('./adapter').ExchangeRate;
      return {
        async list(company_id: string): Promise<Rate[]> {
          const { data, error } = await db.from('exchange_rates')
            .select('*').eq('company_id', company_id)
            .order('effective_date', { ascending: false });
          assertNoError(error, 'exchangeRates.list');
          return (data ?? []) as Rate[];
        },
        async upsert(company_id: string, input): Promise<Rate> {
          const { data, error } = await db.from('exchange_rates')
            .upsert({ company_id, ...input }, { onConflict: 'company_id,from_currency,to_currency,effective_date' })
            .select('*').single();
          assertNoError(error, 'exchangeRates.upsert');
          return data as Rate;
        },
        async remove(id: string): Promise<void> {
          const { error } = await db.from('exchange_rates').delete().eq('id', id);
          assertNoError(error, 'exchangeRates.remove');
        },
        async getRate(company_id: string, from: string, to: string, onDate: string): Promise<number> {
          if (from === to) return 1;
          const { data } = await db.from('exchange_rates')
            .select('exchange_rate')
            .eq('company_id', company_id).eq('from_currency', from).eq('to_currency', to)
            .lte('effective_date', onDate)
            .order('effective_date', { ascending: false }).limit(1).maybeSingle();
          return data?.exchange_rate ? Number(data.exchange_rate) : 1;
        },
      };
    })(),

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
        // country_code/region_id/area_id exist in the DB (Phase 16) but may not
        // be in the generated Insert type yet — cast through the row shape.
        const { data, error } = await client.from('contacts').insert(row as Database['public']['Tables']['contacts']['Insert']).select().single();
        assertNoError(error, 'contacts.create');
        return data!;
      },
      async update(id, row: ContactUpdate) {
        const { error } = await client.from('contacts').update(row as Database['public']['Tables']['contacts']['Update']).eq('id', id);
        assertNoError(error, 'contacts.update');
      },
      async remove(id) {
        const { error } = await client.from('contacts').delete().eq('id', id);
        assertNoError(error, 'contacts.remove');
      },
      async smartSearch(input): Promise<import('./adapter').ContactSearchRow[]> {
        // Calls Phase 12.18 search_contacts RPC.
        const { data, error } = await (client.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)
          ('search_contacts', {
            p_company_id: input.company_id,
            p_q:          input.q ?? null,
            p_type:       input.type ?? null,
            p_limit:      input.limit ?? 20,
          });
        assertNoError(error as Error | null, 'contacts.smartSearch');
        return (data as import('./adapter').ContactSearchRow[]) ?? [];
      },
      async getAdvanceBalance(company_id, contact_id, account_code = '2400'): Promise<number> {
        // Phase 12.24 — sum of (credit - debit) on the contact-advance
        // GL account for this contact. Positive = customer has paid in
        // advance / overpaid (we owe them); zero = no credit on file.
        // Works for both customer (2400) and supplier (1400) sides.
        const { data, error } = await client
          .from('general_ledger')
          .select('debit, credit')
          .eq('company_id',  company_id)
          .eq('contact_id',  contact_id)
          .eq('account_code', account_code);
        assertNoError(error, 'contacts.getAdvanceBalance');
        let credit = 0, debit = 0;
        for (const r of (data ?? []) as { debit: number; credit: number }[]) {
          credit += Number(r.credit ?? 0);
          debit  += Number(r.debit  ?? 0);
        }
        // For 2400 (liability) the natural balance is CR > DR. We return
        // (credit - debit) so a positive number means "customer has credit".
        // For 1400 (asset) the natural balance is DR > CR, so we flip the
        // sign — positive still means "supplier holds OUR money".
        if (account_code === '1400') return debit - credit;
        return credit - debit;
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

        // Aggregate gross debit + credit per account
        const map: Record<string, { debit: number; credit: number }> = {};
        for (const row of rows ?? []) {
          if (!map[row.account_code]) map[row.account_code] = { debit: 0, credit: 0 };
          map[row.account_code].debit  += row.debit;
          map[row.account_code].credit += row.credit;
        }

        // A proper Trial Balance shows the NET balance per account on
        // whichever side is normal for that account. Accounts whose net
        // is exactly zero (e.g. fully-reversed JEs after a void) are
        // hidden — otherwise the user sees big gross numbers and
        // mistakenly thinks the void didn't work.
        //
        // Net = debit - credit.
        //   net > 0   → show in debit column,  credit = 0
        //   net < 0   → show in credit column, debit  = 0
        //   net ≈ 0   → drop the row entirely
        const EPS = 0.005;
        const lines: import('./adapter').TrialBalanceLine[] = Object.entries(map)
          .map(([code, v]) => {
            const net = +(v.debit - v.credit).toFixed(2);
            return {
              account_code: code,
              account_name: coaMap[code]?.name ?? code,
              account_type: coaMap[code]?.type ?? '',
              debit:  net >  EPS ? net      : 0,
              credit: net < -EPS ? -net     : 0,
            };
          })
          .filter(l => l.debit !== 0 || l.credit !== 0)
          .sort((a, b) => a.account_code.localeCompare(b.account_code));

        const total_debit  = lines.reduce((s, l) => s + l.debit,  0);
        const total_credit = lines.reduce((s, l) => s + l.credit, 0);
        return { lines, total_debit, total_credit, as_of_date };
      },
      async getLedgerEntries(company_id, account_code, from, to): Promise<LedgerEntry[]> {
        const { data: glRows, error: e1 } = await client
          .from('general_ledger')
          .select('id, date, debit, credit, description, journal_entry_id, related_doc_type, related_doc_id')
          .eq('company_id', company_id)
          .eq('account_code', account_code)
          .gte('date', from)
          .lte('date', to)
          .order('date')
          .order('created_at');
        assertNoError(e1, 'accounting.getLedgerEntries.gl');

        // Fetch entry numbers + reversal links + JE-level source for JE ids
        const jeIds = [...new Set((glRows ?? []).map((r) => r.journal_entry_id))];
        const jeMap: Record<string, {
          entry_number: string;
          reversed_by_id: string | null;
          reversal_of_id: string | null;
          source_type: string;
          source_id: string | null;
        }> = {};
        if (jeIds.length > 0) {
          const { data: jes } = await client
            .from('journal_entries')
            .select('id, entry_number, reversed_by_id, reversal_of_id, source_type, source_id')
            .in('id', jeIds);
          for (const je of jes ?? []) {
            jeMap[je.id] = {
              entry_number:   je.entry_number,
              reversed_by_id: (je as any).reversed_by_id ?? null,
              reversal_of_id: (je as any).reversal_of_id ?? null,
              source_type:    (je as any).source_type ?? '',
              source_id:      (je as any).source_id ?? null,
            };
          }
        }

        // Resolve source document numbers ("INV-1002") — one batch query per
        // document type present. Unknown types just render their type label.
        const DOC_SOURCES: Record<string, { table: string; column: string }> = {
          invoice:              { table: 'invoices',              column: 'invoice_number' },
          vendor_bill:          { table: 'vendor_bills',          column: 'bill_number' },
          payment:              { table: 'payments',              column: 'payment_number' },
          expense:              { table: 'expenses',              column: 'expense_number' },
          goods_receipt:        { table: 'goods_receipts',        column: 'grn_number' },
          credit_note:          { table: 'credit_notes',          column: 'credit_note_number' },
          debit_note:           { table: 'debit_notes',           column: 'debit_note_number' },
          sales_return:         { table: 'sales_returns',         column: 'return_number' },
          inventory_adjustment: { table: 'inventory_adjustments', column: 'adjustment_number' },
          stock_transfer:       { table: 'stock_transfers',       column: 'transfer_number' },
          bank_transfer:        { table: 'bank_transfers',        column: 'transfer_number' },
        };
        const idsByType: Record<string, Set<string>> = {};
        for (const r of glRows ?? []) {
          const je = jeMap[r.journal_entry_id];
          const type = (r as any).related_doc_type || je?.source_type || '';
          const id   = (r as any).related_doc_id || je?.source_id || null;
          if (id && DOC_SOURCES[type]) (idsByType[type] ??= new Set()).add(id);
        }
        const numberMap: Record<string, string> = {}; // `${type}:${id}` → doc number
        await Promise.all(Object.entries(idsByType).map(async ([type, ids]) => {
          const src = DOC_SOURCES[type];
          const { data } = await client
            .from(src.table as never)
            .select(`id, ${src.column}`)
            .in('id', [...ids]);
          for (const row of (data ?? []) as Array<Record<string, string>>) {
            numberMap[`${type}:${row.id}`] = row[src.column];
          }
        }));

        let running = 0;
        return (glRows ?? []).map((r) => {
          running += r.debit - r.credit;
          const jeInfo = jeMap[r.journal_entry_id];
          const srcType = (r as any).related_doc_type || jeInfo?.source_type || '';
          const srcId   = (r as any).related_doc_id || jeInfo?.source_id || null;
          return {
            id: r.id,
            date: r.date,
            entry_number: jeInfo?.entry_number ?? '',
            description: r.description ?? '',
            debit: r.debit,
            credit: r.credit,
            running_balance: running,
            source_type: srcType,
            source_id: srcId,
            source_number: srcId ? (numberMap[`${srcType}:${srcId}`] ?? null) : null,
            reversed_by_id: jeInfo?.reversed_by_id ?? null,
            reversal_of_id: jeInfo?.reversal_of_id ?? null,
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
          .select('direction, quantity, running_avg_cost')
          .eq('company_id', company_id)
          .eq('product_id', product_id)
          .eq('warehouse_id', warehouse_id);
        assertNoError(error, 'stockLedger.getBalance');
        // Sum direction × quantity over ALL rows (including reversals).
        // Previously we picked latest row by created_at + excluded
        // reversals — wrong because (a) reversal rows are legitimate
        // movements that should net out, and (b) multiple rows in one
        // transaction share created_at, making the "latest" non-deterministic.
        let qty = 0;
        let mac = 0;
        for (const r of (data ?? []) as { direction: number | null; quantity: number | null; running_avg_cost: number | null }[]) {
          qty += Number(r.direction ?? 0) * Number(r.quantity ?? 0);
          const c = Number(r.running_avg_cost ?? 0);
          if (c > 0) mac = c; // MAC is constant within a transaction; last non-zero is the current value
        }
        return { product_id, warehouse_id, quantity: qty, unit_cost: mac, total_value: qty * mac };
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
      async postOpeningStock(input): Promise<{ stock_ledger_id: string; journal_entry_id: string; entry_number: string; total_value: number }> {
        // Phase 12.28 — wizard-driven one-shot opening balance.
        const { data, error } = await (client.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)
          ('post_opening_stock', {
            p_product_id:   input.product_id,
            p_warehouse_id: input.warehouse_id,
            p_quantity:     input.quantity,
            p_unit_cost:    input.unit_cost,
            p_date:         input.date ?? null,
          });
        assertNoError(error as Error | null, 'stockLedger.postOpeningStock');
        return data as { stock_ledger_id: string; journal_entry_id: string; entry_number: string; total_value: number };
      },
      // Phase 14.15 — list all opening-stock rows for the Opening Inventory wizard.
      async listOpeningStock(company_id) {
        const { data, error } = await (client.from('stock_ledger') as any)
          .select(`
            id,
            product_id,
            warehouse_id,
            quantity,
            unit_cost,
            total_cost,
            date,
            products ( sku, name ),
            warehouses ( name )
          `)
          .eq('company_id', company_id)
          .eq('type', 'opening_balance')
          .order('date', { ascending: false });
        assertNoError(error as Error | null, 'stockLedger.listOpeningStock');
        return ((data ?? []) as any[]).map((r) => ({
          stock_ledger_id: r.id as string,
          product_id:      r.product_id as string,
          sku:             (r.products?.sku ?? '') as string,
          product_name:    (r.products?.name ?? '') as string,
          warehouse_id:    r.warehouse_id as string,
          warehouse_name:  (r.warehouses?.name ?? '') as string,
          quantity:        Number(r.quantity),
          unit_cost:       Number(r.unit_cost),
          total_cost:      Number(r.total_cost),
          date:            r.date as string,
        }));
      },
      // Phase 14.16b — void an opening stock entry (reverses GL JE + removes stock_ledger row).
      async voidOpeningStock(stock_ledger_id) {
        const { error } = await client.rpc('void_opening_stock' as any, {
          p_stock_ledger_id: stock_ledger_id,
        });
        assertNoError(error as Error | null, 'stockLedger.voidOpeningStock');
      },
      async getCurrentStockMap(company_id): Promise<Record<string, { qty: number; mac: number }>> {
        // Single query, then SUM(direction × quantity) per product across
        // all warehouses + take latest non-zero running_avg_cost as MAC.
        // Matches the dashboard / valuation approach so numbers stay
        // consistent app-wide.
        const { data, error } = await client.from('stock_ledger')
          .select('product_id, direction, quantity, running_avg_cost')
          .eq('company_id', company_id)
          .limit(10000);
        assertNoError(error, 'stockLedger.getCurrentStockMap');
        const map: Record<string, { qty: number; mac: number }> = {};
        for (const r of (data ?? []) as { product_id: string | null; direction: number | null; quantity: number | null; running_avg_cost: number | null }[]) {
          if (!r.product_id) continue;
          if (!map[r.product_id]) map[r.product_id] = { qty: 0, mac: 0 };
          map[r.product_id].qty += Number(r.direction ?? 0) * Number(r.quantity ?? 0);
          const c = Number(r.running_avg_cost ?? 0);
          // MAC is constant within a transaction; keep last non-zero.
          if (c > 0) map[r.product_id].mac = c;
        }
        return map;
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
      // Phase 14.10 — edit CoA row. Client-side gating decides which
      // fields to send for system accounts; the DB itself accepts any
      // column so a future migration could harden if needed.
      async update(id, row): Promise<CoaRow> {
        const { data, error } = await client.from('chart_of_accounts').update(row).eq('id', id).select().single();
        assertNoError(error, 'coa.update');
        return data!;
      },
      // Phase 14.10 — soft-delete (is_active=false). Guards:
      //   - refuse if is_system=true
      //   - refuse if any general_ledger row references this account
      //     (we don't want orphaned history with no visible parent)
      async deactivate(id) {
        // Read the row first so we can guard system accounts.
        const { data: row, error: readErr } = await client
          .from('chart_of_accounts').select('id, is_system, code, name')
          .eq('id', id).single();
        assertNoError(readErr, 'coa.deactivate/read');
        if (row?.is_system) {
          throw new Error(`Cannot deactivate system account ${row.code} ${row.name} — it's used by built-in RPCs.`);
        }
        // GL history guard. count={ exact, head: true } returns just the
        // count, no rows; cheap.
        const glHistory = await (client.from as unknown as (t: string) => {
          select: (cols: string, opts: { count: 'exact'; head: true }) => {
            eq: (k: string, v: unknown) => Promise<{ count: number | null; error: unknown }>;
          };
        })('general_ledger')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', id);
        assertNoError(glHistory.error as Error | null, 'coa.deactivate/glcount');
        if ((glHistory.count ?? 0) > 0) {
          throw new Error(
            `Cannot deactivate — this account has ${glHistory.count} journal-entry line(s) in its history. ` +
            `Deactivating would hide them. Either reverse the entries first or post offsetting JEs to zero it out.`
          );
        }
        const { error } = await client.from('chart_of_accounts').update({ is_active: false }).eq('id', id);
        assertNoError(error, 'coa.deactivate');
      },
      async activate(id) {
        const { error } = await client.from('chart_of_accounts').update({ is_active: true }).eq('id', id);
        assertNoError(error, 'coa.activate');
      },
      async createWithOptionalBank(input) {
        // Phase 14.14p — atomic CoA + bank insert. The RPC wraps both in one
        // transaction; if the bank insert fails, the CoA insert rolls back.
        const { data, error } = await (
          client.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
        )('create_coa_with_optional_bank', {
          p_coa:  input.coa as unknown as Record<string, unknown>,
          p_bank: input.bank as unknown as Record<string, unknown> | null,
        });
        assertNoError(error as Error | null, 'coa.createWithOptionalBank');
        const out = data as { coa_id: string; bank_id: string | null };
        return { coa_id: out.coa_id, bank_id: out.bank_id ?? null };
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

    // ── Phase 4: Tax Rates ────────────────────────────────────────────────
    taxRates: {
      async list(company_id): Promise<TaxRateRow[]> {
        const { data, error } = await client.from('tax_rates').select('*')
          .eq('company_id', company_id).eq('is_active', true).order('name');
        assertNoError(error, 'taxRates.list');
        return data ?? [];
      },
      async listAll(company_id): Promise<TaxRateRow[]> {
        const { data, error } = await client.from('tax_rates').select('*')
          .eq('company_id', company_id).order('name');
        assertNoError(error, 'taxRates.listAll');
        return data ?? [];
      },
      async create(row): Promise<TaxRateRow> {
        const { data, error } = await client.from('tax_rates').insert(row).select().single();
        assertNoError(error, 'taxRates.create');
        return data!;
      },
      async update(id, patch): Promise<void> {
        const { error } = await client.from('tax_rates').update(patch).eq('id', id);
        assertNoError(error, 'taxRates.update');
      },
      async seedDefaults(company_id): Promise<void> {
        const DEFAULTS = [
          { name: 'VAT 5%',          tax_type: 'standard',  rate: 5.00,  is_active: true },
          { name: 'Zero-rated (0%)', tax_type: 'zero_rated', rate: 0.00, is_active: true },
          { name: 'Exempt',          tax_type: 'exempt',     rate: 0.00, is_active: true },
        ];
        // Check which tax_types already exist for this company
        const { data: existing } = await client.from('tax_rates').select('tax_type')
          .eq('company_id', company_id);
        const existingTypes = new Set((existing ?? []).map(r => r.tax_type));
        const toInsert = DEFAULTS.filter(d => !existingTypes.has(d.tax_type))
          .map(d => ({ ...d, company_id }));
        if (toInsert.length === 0) return;
        const { error } = await client.from('tax_rates').insert(toInsert);
        assertNoError(error, 'taxRates.seedDefaults');
      },
    },

    // ── Phase 4: Bank Accounts ────────────────────────────────────────────
    bankAccounts: {
      async list(company_id, opts): Promise<BankAccountRow[]> {
        let q = client.from('bank_accounts').select('*').eq('company_id', company_id);
        if (!opts?.includeInactive) q = q.eq('is_active', true);
        const { data, error } = await q.order('name');
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
      async remove(id) {
        // Hard delete. Postgres will raise a foreign-key violation if any
        // payment / expense / bank_transfer / pdc / reconciliation references
        // this row — caller's onError surfaces the message to the operator.
        const { error } = await client.from('bank_accounts').delete().eq('id', id);
        assertNoError(error, 'bankAccounts.remove');
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
        // 1. Update invoice header
        const { error: hErr } = await client.from('invoices').update(row).eq('id', id);
        assertNoError(hErr, 'invoices.update header');

        // 2. Clear deferred_cogs_queue rows for this invoice BEFORE deleting
        //    items. deferred_cogs_queue.invoice_item_id has ON DELETE RESTRICT
        //    (per Phase 0 §I), so any pending or flushed COGS rows pointing
        //    to the items would block the delete below. After edit_invoice
        //    runs (called by the editor's saveMutation), it will:
        //      - reverse the original JE incl. any flushed COGS JEs
        //      - re-queue deferred COGS for the new items if needed
        //    So the old queue entries are safely disposable here.
        const { error: dcqErr } = await client.from('deferred_cogs_queue')
          .delete().eq('sale_invoice_id', id);
        assertNoError(dcqErr, 'invoices.update clear deferred_cogs_queue');

        // 3. Replace items
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
      async deleteDraft(invoice_id): Promise<void> {
        // Drafts only — a draft has never posted to the GL, so a hard delete
        // is safe. Guard on status so a confirmed invoice can never be wiped.
        const { data: inv, error: fErr } = await client.from('invoices').select('status').eq('id', invoice_id).single();
        assertNoError(fErr, 'invoices.deleteDraft fetch');
        if ((inv as { status?: string } | null)?.status !== 'draft') {
          throw new Error('Only draft invoices can be deleted. Void a confirmed invoice instead.');
        }
        const { error: itErr } = await client.from('invoice_items').delete().eq('invoice_id', invoice_id);
        assertNoError(itErr, 'invoices.deleteDraft items');
        const { error } = await client.from('invoices').delete().eq('id', invoice_id).eq('status', 'draft');
        assertNoError(error, 'invoices.deleteDraft');
      },
      async getNextNumber(company_id): Promise<string> {
        const { data, error } = await client.rpc('get_next_document_number', {
          p_company_id: company_id,
          p_prefix: 'INV',
        });
        assertNoError(error, 'invoices.getNextNumber');
        return data as string;
      },

      async listOpenForContact(company_id, contact_id): Promise<import('./adapter').OpenInvoice[]> {
        // 1. Confirmed invoices for this contact, oldest first (FIFO)
        const { data: invs, error: invErr } = await client
          .from('invoices')
          .select('*')
          .eq('company_id', company_id)
          .eq('contact_id', contact_id)
          .eq('status', 'confirmed')
          .order('date', { ascending: true });
        assertNoError(invErr, 'invoices.listOpenForContact invoices');

        const rows = (invs ?? []) as InvoiceRow[];
        if (rows.length === 0) return [];

        // 2. Allocations already applied to those invoices
        const ids = rows.map(r => r.id);
        const { data: allocs, error: aErr } = await client
          .from('payment_allocations')
          .select('doc_id, amount_applied, discount_amount')
          .eq('company_id', company_id)
          .eq('doc_type', 'invoice')
          .in('doc_id', ids);
        assertNoError(aErr, 'invoices.listOpenForContact allocations');

        const appliedById: Record<string, number> = {};
        for (const a of (allocs ?? []) as { doc_id: string; amount_applied: number; discount_amount: number }[]) {
          appliedById[a.doc_id] = (appliedById[a.doc_id] ?? 0) + Number(a.amount_applied) + Number(a.discount_amount ?? 0);
        }

        // 3. Compute outstanding; drop fully-paid invoices
        return rows
          .map(r => ({
            ...r,
            outstanding: Number(r.total_amount) - (appliedById[r.id] ?? 0),
          }))
          .filter(r => r.outstanding > 0.005);
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
      async update(id, row, allocations): Promise<PaymentRow> {
        // Atomic update + allocation replace via update_payment_draft RPC.
        // RPC enforces status='draft', period-lock, doc/contact match,
        // doc_type/payment_type match, and total <= amount.
        // Semantics:
        //   allocations === undefined → do NOT touch existing allocations
        //   allocations === []        → clear all allocations
        //   allocations === [...]     → replace with this set
        const allocPayload =
          allocations === undefined
            ? null
            : allocations.map(a => ({
                doc_type:       a.doc_type,
                doc_id:         a.doc_id,
                amount_applied: a.amount_applied,
              }));
        const { data, error } = await (client.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)
          ('update_payment_draft', {
            p_payment_id:  id,
            p_row:         row as Record<string, unknown>,
            p_allocations: allocPayload,
          });
        assertNoError(error as Error | null, 'payments.update');
        return data as PaymentRow;
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
        // Phase 14 — proper GL-reversing void (mirrors void_invoice). Reverses
        // the receipt's JE, reopens any invoice it paid, marks status=void.
        const { error } = await client.rpc('void_payment' as never, {
          p_payment_id: payment_id, p_reason: reason ?? undefined,
        } as never);
        assertNoError(error, 'payments.void');
      },
      async reopen(payment_id): Promise<void> {
        // Phase 18 — reverse the posting + reopen as draft so a confirmed
        // receipt can be edited, then re-confirmed via the normal draft path.
        const { error } = await client.rpc('reopen_payment' as never, {
          p_payment_id: payment_id,
        } as never);
        assertNoError(error, 'payments.reopen');
      },
      async deleteDraft(payment_id): Promise<void> {
        // Drafts only — a draft payment has never posted to the GL, so a hard
        // delete is safe. Guard on status so a confirmed payment is never wiped.
        const { data: p, error: fErr } = await client.from('payments').select('status').eq('id', payment_id).single();
        assertNoError(fErr, 'payments.deleteDraft fetch');
        if ((p as { status?: string } | null)?.status !== 'draft') {
          throw new Error('Only draft payments can be deleted. Void a confirmed payment instead.');
        }
        await client.from('payment_allocations').delete().eq('payment_id', payment_id);
        const { error } = await client.from('payments').delete().eq('id', payment_id).eq('status', 'draft');
        assertNoError(error, 'payments.deleteDraft');
      },
      async getNextNumber(company_id): Promise<string> {
        const { data, error } = await client.rpc('get_next_document_number', {
          p_company_id: company_id,
          p_prefix: 'REC',
        });
        assertNoError(error, 'payments.getNextNumber');
        return data as string;
      },
      async getAppliedMap(company_id, doc_type): Promise<Record<string, number>> {
        // Same semantics as listOpenForContact: applied = amount_applied
        // + discount (cash-discount counts as settled).
        const { data, error } = await client
          .from('payment_allocations')
          .select('doc_id, amount_applied, discount_amount')
          .eq('company_id', company_id)
          .eq('doc_type', doc_type);
        assertNoError(error, 'payments.getAppliedMap');
        const map: Record<string, number> = {};
        for (const a of (data ?? []) as { doc_id: string; amount_applied: number; discount_amount: number }[]) {
          map[a.doc_id] = (map[a.doc_id] ?? 0) + Number(a.amount_applied) + Number(a.discount_amount ?? 0);
        }
        return map;
      },
    },

    // ── Phase 4: Reports ──────────────────────────────────────────────────
    reports: {
      async getProfitAndLoss(company_id, from, to): Promise<ProfitAndLoss> {
        // Note: chart_of_accounts.type uses values 'asset','liability','equity','income','expense'
        // (per the CHECK constraint). Earlier code mistakenly read account_type/'revenue';
        // fixed here to use real column names.
        const { data, error } = await client
          .from('general_ledger')
          .select('account_code, debit, credit, chart_of_accounts!inner(name, type, sub_type)')
          .eq('company_id', company_id)
          .gte('date', from)
          .lte('date', to);
        assertNoError(error, 'reports.getProfitAndLoss');

        const byCode: Record<string, { name: string; type: string; sub_type: string | null; debit: number; credit: number }> = {};
        for (const row of data ?? []) {
          const coa = row.chart_of_accounts as unknown as { name: string; type: string; sub_type: string | null };
          if (!['income', 'expense'].includes(coa.type)) continue;
          if (!byCode[row.account_code]) {
            byCode[row.account_code] = { name: coa.name, type: coa.type, sub_type: coa.sub_type, debit: 0, credit: 0 };
          }
          byCode[row.account_code].debit += Number(row.debit);
          byCode[row.account_code].credit += Number(row.credit);
        }

        const lines: ProfitAndLossLine[] = Object.entries(byCode).map(([code, v]) => ({
          account_code: code,
          account_name: v.name,
          account_type: v.type,
          sub_type: v.sub_type,
          // Income: credit balance is positive. Expense: debit balance is positive.
          amount: v.type === 'income' ? v.credit - v.debit : v.debit - v.credit,
        }));

        // Direct income (Sales) ↔ above Gross Profit. NULL sub_type defaults to direct
        // (so legacy rows still appear in the Sales section rather than disappearing).
        const isDirect = (l: ProfitAndLossLine) => l.sub_type !== 'indirect';

        const revenue   = lines.filter(l => l.account_type === 'income'  &&  isDirect(l)).reduce((s, l) => s + l.amount, 0);
        const cogs      = lines.filter(l => l.account_type === 'expense' &&  isDirect(l)).reduce((s, l) => s + l.amount, 0);
        const otherInc  = lines.filter(l => l.account_type === 'income'  && !isDirect(l)).reduce((s, l) => s + l.amount, 0);
        const opex      = lines.filter(l => l.account_type === 'expense' && !isDirect(l)).reduce((s, l) => s + l.amount, 0);

        const grossProfit = revenue - cogs;
        const netProfit   = grossProfit + otherInc - opex;

        return {
          period_start: from,
          period_end: to,
          revenue,
          cogs,
          gross_profit: grossProfit,
          other_income: otherInc,
          operating_expenses: opex,
          net_profit: netProfit,
          lines,
        };
      },

      async getBalanceSheet(company_id, as_of_date): Promise<BalanceSheet> {
        // Pull ALL GL rows up to as_of_date (asset, liability, equity, income,
        // expense). Income and expense get folded into a synthetic equity line
        // below ("Current Period Earnings") so the accounting identity
        //   Assets = Liabilities + Equity
        // holds — without that fold the BS never balances during an open period.
        const { data, error } = await client
          .from('general_ledger')
          .select('account_code, debit, credit, chart_of_accounts!inner(name, type, sub_type)')
          .eq('company_id', company_id)
          .lte('date', as_of_date);
        assertNoError(error, 'reports.getBalanceSheet');

        const byCode: Record<string, { name: string; type: string; sub_type: string | null; debit: number; credit: number }> = {};
        // Net income running total (Revenue − Expenses) over the period
        // from fiscal start to as_of_date. Year-end close JEs zero out the
        // income/expense accounts and push into retained earnings, so this
        // sum naturally tracks the un-closed period's earnings only.
        let incomeMinusExpense = 0;
        for (const row of data ?? []) {
          const coa = row.chart_of_accounts as unknown as { name: string; type: string; sub_type: string | null };
          const debit  = Number(row.debit);
          const credit = Number(row.credit);

          if (coa.type === 'income') {
            // Revenue: natural credit balance. Add (credit − debit) to net income.
            incomeMinusExpense += credit - debit;
            continue;
          }
          if (coa.type === 'expense') {
            // Expense: natural debit balance. Subtract (debit − credit) from net income.
            incomeMinusExpense -= debit - credit;
            continue;
          }
          if (!['asset', 'liability', 'equity'].includes(coa.type)) continue;

          if (!byCode[row.account_code]) {
            byCode[row.account_code] = { name: coa.name, type: coa.type, sub_type: coa.sub_type, debit: 0, credit: 0 };
          }
          byCode[row.account_code].debit  += debit;
          byCode[row.account_code].credit += credit;
        }

        const lines: BalanceSheetLine[] = Object.entries(byCode).map(([code, v]) => ({
          account_code: code,
          account_name: v.name,
          account_type: v.type,
          sub_type: v.sub_type,
          // Asset: debit balance positive. Liability/Equity: credit balance positive.
          balance: v.type === 'asset' ? v.debit - v.credit : v.credit - v.debit,
        }));

        // Synthetic equity line — the period's net income. Without this the
        // BS never balances mid-period. After year-end close this naturally
        // becomes zero (income/expense accounts get zeroed and the amount
        // is moved into a real retained-earnings equity account).
        if (Math.abs(incomeMinusExpense) > 0.005) {
          lines.push({
            account_code: '__CPE__',
            account_name: 'Current Period Earnings',
            account_type: 'equity',
            sub_type: null,
            balance: incomeMinusExpense,
          });
        }

        // NULL/missing sub_type defaults: assets→'current', liabilities→'current'
        // (matches the migration backfill — legacy rows still appear in the
        // "Current" bucket rather than disappearing).
        const isCurrentAsset = (l: BalanceSheetLine) =>
          l.account_type === 'asset' && l.sub_type !== 'fixed';
        const isFixedAsset = (l: BalanceSheetLine) =>
          l.account_type === 'asset' && l.sub_type === 'fixed';
        const isCurrentLiab = (l: BalanceSheetLine) =>
          l.account_type === 'liability' && l.sub_type !== 'long_term';
        const isLongTermLiab = (l: BalanceSheetLine) =>
          l.account_type === 'liability' && l.sub_type === 'long_term';

        const currentAssets       = lines.filter(isCurrentAsset).reduce((s, l) => s + l.balance, 0);
        const fixedAssets         = lines.filter(isFixedAsset).reduce((s, l) => s + l.balance, 0);
        const currentLiabilities  = lines.filter(isCurrentLiab).reduce((s, l) => s + l.balance, 0);
        const longTermLiabilities = lines.filter(isLongTermLiab).reduce((s, l) => s + l.balance, 0);
        const totalAssets         = currentAssets + fixedAssets;
        const totalLiabilities    = currentLiabilities + longTermLiabilities;
        const totalEquity         = lines.filter(l => l.account_type === 'equity').reduce((s, l) => s + l.balance, 0);

        return {
          as_of_date,
          current_assets: currentAssets,
          fixed_assets: fixedAssets,
          total_assets: totalAssets,
          current_liabilities: currentLiabilities,
          long_term_liabilities: longTermLiabilities,
          total_liabilities: totalLiabilities,
          total_equity: totalEquity,
          working_capital: currentAssets - currentLiabilities,
          lines,
        };
      },

      async getControlAccountByContact(
        company_id: string,
        account_code: string,
        as_of_date: string,
      ): Promise<import('./adapter').ControlAccountContactLine[]> {
        // Phase 12.24 — used by TB / BS drill-downs. Returns one row per
        // distinct contact_id (with a synthetic "(no contact)" row for
        // any null contact_ids) showing the cumulative debits, credits
        // and net balance from fiscal start through as_of_date.
        const { data, error } = await client
          .from('general_ledger')
          .select('contact_id, debit, credit, contacts(name)')
          .eq('company_id',   company_id)
          .eq('account_code', account_code)
          .lte('date',        as_of_date);
        assertNoError(error, 'reports.getControlAccountByContact');

        type Row = { contact_id: string | null; debit: number; credit: number; contacts: { name: string } | null };
        const byContact: Record<string, { name: string; debit: number; credit: number }> = {};
        for (const r of (data ?? []) as unknown as Row[]) {
          const key = r.contact_id ?? '__no_contact__';
          if (!byContact[key]) {
            byContact[key] = {
              name: r.contact_id ? (r.contacts?.name ?? r.contact_id) : '(no contact)',
              debit: 0, credit: 0,
            };
          }
          byContact[key].debit  += Number(r.debit  ?? 0);
          byContact[key].credit += Number(r.credit ?? 0);
        }

        return Object.entries(byContact)
          .map(([key, v]) => ({
            contact_id: key === '__no_contact__' ? null : key,
            contact_name: v.name,
            debit: v.debit,
            credit: v.credit,
            balance: v.debit - v.credit,
          }))
          // Drop rows that net to zero — they shouldn't clutter the drill-down.
          .filter(r => Math.abs(r.balance) > 0.005)
          // Largest absolute balance first.
          .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
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
          .select('doc_id, amount_applied, discount_amount')
          .eq('company_id', company_id)
          .eq('doc_type', 'invoice');
        assertNoError(allocErr, 'reports.getARAgingReport allocs');

        const allocByInv: Record<string, number> = {};
        for (const a of allocs ?? []) {
          allocByInv[a.doc_id] = (allocByInv[a.doc_id] ?? 0) + Number(a.amount_applied) + Number(a.discount_amount ?? 0);
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
              // Phase 12.24 — populated after the loop from 2400 GL.
              advance_credit: 0, net_due: 0,
            };
          }
          const b = bucketMap[inv.contact_id];
          if (daysPast <= 30) b.current += outstanding;
          else if (daysPast <= 60) b.days_31_60 += outstanding;
          else if (daysPast <= 90) b.days_61_90 += outstanding;
          else b.over_90 += outstanding;
          b.total += outstanding;
        }

        // Phase 12.24 — also pull the per-customer advance balance from
        // 2400, so the aging report shows the FULL position for each
        // customer (open invoices minus advance credit on file). A
        // customer with 1,000 outstanding and 200 advance owes 800 net.
        const { data: advRows, error: advErr } = await client
          .from('general_ledger')
          .select('contact_id, debit, credit')
          .eq('company_id', company_id)
          .eq('account_code', '2400')
          .lte('date', as_of_date);
        assertNoError(advErr, 'reports.getARAgingReport advances');

        const advanceByContact: Record<string, number> = {};
        for (const r of (advRows ?? []) as { contact_id: string | null; debit: number; credit: number }[]) {
          if (!r.contact_id) continue;
          // Liability account — credit > debit means customer credit.
          advanceByContact[r.contact_id] =
            (advanceByContact[r.contact_id] ?? 0) + (Number(r.credit ?? 0) - Number(r.debit ?? 0));
        }

        // Surface customers who have ONLY an advance (no open invoices)
        // so they don't disappear from the aging view.
        for (const [contactId, advance] of Object.entries(advanceByContact)) {
          if (Math.abs(advance) < 0.005) continue;
          if (!bucketMap[contactId]) {
            // Look up name lazily from the invoices fetch (won't be there
            // for an advance-only customer); fall back to the contact_id.
            bucketMap[contactId] = {
              contact_id: contactId,
              contact_name: contactId, // backfill below if we have it from another query
              current: 0, days_31_60: 0, days_61_90: 0, over_90: 0, total: 0,
              advance_credit: 0, net_due: 0,
            };
          }
        }

        // Finish populating advance_credit + net_due on every bucket.
        for (const b of Object.values(bucketMap)) {
          const adv = advanceByContact[b.contact_id] ?? 0;
          (b as ARAgingBucket).advance_credit = +adv.toFixed(2);
          (b as ARAgingBucket).net_due        = +(b.total - adv).toFixed(2);
        }

        // For any new buckets created above without a contact_name, fetch
        // names in one extra round trip. Cheap; usually 0–1 contacts.
        const namelessIds = Object.values(bucketMap)
          .filter(b => b.contact_name === b.contact_id)
          .map(b => b.contact_id);
        if (namelessIds.length > 0) {
          const { data: nameRows } = await client
            .from('contacts').select('id, name').in('id', namelessIds);
          for (const r of (nameRows ?? []) as { id: string; name: string }[]) {
            if (bucketMap[r.id]) bucketMap[r.id].contact_name = r.name;
          }
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

        // Phase 12.54 — query BOTH 1200 AR and 2400 Customer Advances so
        // overpayments show up on the statement. Previously the query
        // only hit 1200, which meant the AR-side of payments appeared
        // but the advance portion (cash the customer is sitting in
        // credit) didn't — closing balance overstated what they owe by
        // exactly the advance balance.
        //
        // Sign convention for the running balance (debit - credit) is
        // the same across both accounts because:
        //   1200 (AR, debit-balance): debit = customer owes more,
        //                              credit = paid
        //   2400 (Customer Advances, credit-balance): seen from the
        //                              customer's perspective, a credit
        //                              entry means they have credit
        //                              with us (we owe them), so it
        //                              reduces "amount customer owes
        //                              us". `debit - credit` produces
        //                              a NEGATIVE contribution from
        //                              advance-side credits, exactly
        //                              what we want.
        const { data: glRows, error: glErr } = await client
          .from('general_ledger')
          .select('id, date, debit, credit, description, account_code, related_doc_type, related_doc_id, journal_entries(entry_number, source_type, reversed_by_id, reversal_of_id)')
          .eq('company_id', company_id)
          .eq('contact_id', contact_id)
          .in('account_code', ['1200', '2400'])
          .gte('date', from)
          .lte('date', to)
          .order('date')
          .order('created_at');
        assertNoError(glErr, 'reports.getCustomerStatement gl');

        let balance = 0;
        const lines: CustomerStatementLine[] = (glRows ?? []).map(row => {
          const je = row.journal_entries as unknown as {
            entry_number: string;
            source_type: string | null;
            reversed_by_id: string | null;
            reversal_of_id: string | null;
          } | null;
          balance += Number(row.debit) - Number(row.credit);
          return {
            date: row.date as string,
            doc_type: row.related_doc_type ?? 'je',
            doc_number: je?.entry_number ?? row.id,
            debit: Number(row.debit),
            credit: Number(row.credit),
            balance,
            source_type: je?.source_type ?? undefined,
            is_reversed: !!je?.reversed_by_id,
            is_reversal: !!je?.reversal_of_id,
            account_code: row.account_code as string | undefined,
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
          // Trade AP + category payables (rent 2110, utilities 2120) so the
          // aging covers everything we owe a supplier, wherever it posts.
          .in('account_code', ['2100', '2110', '2120'])
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

        // Phase 12.54 — query BOTH 2100 AP and 1400 Vendor Advances so
        // overpayments to the supplier (advances we still hold against
        // them) show up on the statement instead of leaving the closing
        // balance overstating what we owe. Sign convention `credit -
        // debit` works across both because:
        //   2100 (AP, credit-balance): credit = we owe more,
        //                              debit  = we paid
        //   1400 (Vendor Advances, asset): debit  = we prepaid (supplier
        //                              owes us → reduces "we owe
        //                              supplier"), credit = applied to
        //                              a bill (we owe more again).
        //                              `credit - debit` yields a
        //                              negative contribution from debit
        //                              entries on 1400, which is the
        //                              right effect.
        const { data: glRows, error: glErr } = await client
          .from('general_ledger')
          .select('id, date, debit, credit, description, account_code, related_doc_type, related_doc_id, journal_entries(entry_number, source_type, reversed_by_id, reversal_of_id)')
          .eq('company_id', company_id)
          .eq('contact_id', contact_id)
          .in('account_code', ['2100', '2110', '2120', '1400'])
          .gte('date', from)
          .lte('date', to)
          .order('date')
          .order('created_at');
        assertNoError(glErr, 'reports.getSupplierStatement gl');

        let balance = 0;
        const lines: SupplierStatementLine[] = (glRows ?? []).map(row => {
          const je = row.journal_entries as unknown as {
            entry_number: string;
            source_type: string | null;
            reversed_by_id: string | null;
            reversal_of_id: string | null;
          } | null;
          balance += Number(row.credit) - Number(row.debit);
          return {
            date: row.date as string,
            doc_type: row.related_doc_type ?? 'je',
            doc_number: je?.entry_number ?? row.id,
            debit: Number(row.debit),
            credit: Number(row.credit),
            balance,
            source_type: je?.source_type ?? undefined,
            is_reversed: !!je?.reversed_by_id,
            is_reversal: !!je?.reversal_of_id,
            account_code: row.account_code as string | undefined,
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
        // Phase 12.16 fix: sum direction × quantity per (product, warehouse)
        // to get current on-hand qty. Previous version used "latest row by
        // created_at" but rows from the same transaction (e.g. void
        // reversing multiple sales at once) share identical created_at
        // and Postgres's tiebreaker is undefined — leading to wrong qty.
        const { data, error } = await client
          .from('stock_ledger')
          .select('product_id, warehouse_id, direction, quantity, running_avg_cost, products(sku, name), warehouses(name)')
          .eq('company_id', company_id)
          .lte('date', as_of_date);
        assertNoError(error, 'reports.getStockValuation');

        type Row = {
          product_id: string;
          warehouse_id: string;
          direction: number | null;
          quantity: number | null;
          running_avg_cost: number | null;
          products: { sku: string; name: string } | null;
          warehouses: { name: string } | null;
        };
        const agg: Record<string, {
          product_id: string;
          warehouse_id: string;
          product_code: string;
          product_name: string;
          warehouse_name: string;
          qty: number;
          unit_cost: number;
        }> = {};

        for (const row of (data ?? []) as Row[]) {
          if (!row.product_id || !row.warehouse_id) continue;
          const key = `${row.product_id}::${row.warehouse_id}`;
          if (!agg[key]) {
            agg[key] = {
              product_id:     row.product_id,
              warehouse_id:   row.warehouse_id,
              product_code:   row.products?.sku ?? '',
              product_name:   row.products?.name ?? '',
              warehouse_name: row.warehouses?.name ?? '',
              qty:            0,
              unit_cost:      Number(row.running_avg_cost ?? 0),
            };
          }
          agg[key].qty += Number(row.direction ?? 0) * Number(row.quantity ?? 0);
          // MAC is constant within a transaction; latest non-zero wins.
          const cost = Number(row.running_avg_cost ?? 0);
          if (cost > 0) agg[key].unit_cost = cost;
        }

        const lines: StockValuationLine[] = Object.values(agg)
          .filter(a => a.qty > 0)
          .map(a => ({
            product_id:     a.product_id,
            product_code:   a.product_code,
            product_name:   a.product_name,
            warehouse_id:   a.warehouse_id,
            warehouse_name: a.warehouse_name,
            quantity:       a.qty,
            unit_cost:      a.unit_cost,
            total_value:    a.qty * a.unit_cost,
          }));

        return {
          as_of_date,
          lines,
          total_value: lines.reduce((s, l) => s + l.total_value, 0),
        };
      },

      // Phase 6 reports ──────────────────────────────────────────────────────
      async getStockMovement(company_id, params): Promise<StockMovementLine[]> {
        // We fetch `id` + `reversal_of_id` so we can collapse reversal
        // pairs when the caller asks for a "clean" view. The stock_ledger
        // is an audit log — every void / edit_reversal leaves both the
        // original row AND its reversal row in place. When hide_reversed
        // is true we drop BOTH halves of each cancelled pair so the user
        // sees only the entries that actually contribute to the current
        // on-hand quantity.
        let q = client
          .from('stock_ledger')
          .select('id, reversal_of_id, product_id, warehouse_id, date, type, direction, quantity, unit_cost, running_qty, running_avg_cost, products(name, sku), warehouses(name)')
          .eq('company_id', company_id)
          .gte('date', params.date_from)
          .lte('date', params.date_to);
        if (params.product_id)   q = q.eq('product_id',   params.product_id);
        if (params.warehouse_id) q = q.eq('warehouse_id', params.warehouse_id);
        const { data, error } = await q.order('created_at');
        assertNoError(error, 'reports.getStockMovement');

        type Row = {
          id: string;
          reversal_of_id: string | null;
          product_id: string;
          warehouse_id: string;
          date: string;
          type: string | null;
          direction: number;
          quantity: number;
          unit_cost: number;
          running_qty: number;
          running_avg_cost: number | null;
          products: { name: string; sku: string } | null;
          warehouses: { name: string } | null;
        };
        let rows = (data ?? []) as unknown as Row[];

        if (params.hide_reversed) {
          // Step 1: collect ids of original rows that have been reversed.
          //         A reversal row carries reversal_of_id = original.id.
          const reversedOriginalIds = new Set<string>();
          for (const r of rows) {
            if (r.reversal_of_id) reversedOriginalIds.add(r.reversal_of_id);
          }
          // Step 2: keep only rows that are neither a reversal entry
          //         themselves nor an original that has been reversed.
          rows = rows.filter(r =>
            r.reversal_of_id === null && !reversedOriginalIds.has(r.id),
          );
        }

        return rows.map(r => {
          const qty  = Number(r.running_qty);
          const cost = Number(r.unit_cost);
          return {
            product_id: r.product_id, product_name: r.products?.name ?? '', sku: r.products?.sku ?? '',
            warehouse_id: r.warehouse_id, warehouse_name: r.warehouses?.name ?? '',
            date: r.date, movement_type: r.type ?? '', direction: Number(r.direction),
            quantity: Number(r.quantity), unit_cost: cost,
            running_qty: qty, running_value: qty * Number(r.running_avg_cost ?? 0),
          };
        });
      },

      async getSlowMoving(company_id, params): Promise<SlowMovingLine[]> {
        const today = new Date().toISOString().slice(0, 10);
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
          const days = stockAgingDays(row.date as string, today);
          if (days < params.threshold_days) continue;
          const cost = Number(row.running_avg_cost ?? 0);
          const p = row.products as unknown as { name: string; sku: string } | null;
          const w = row.warehouses as unknown as { name: string } | null;
          lines.push({
            product_id: row.product_id, product_name: p?.name ?? '', sku: p?.sku ?? '',
            warehouse_id: row.warehouse_id, warehouse_name: w?.name ?? '',
            qty_on_hand: qty, unit_cost: cost, stock_value: qty * cost,
            last_movement_date: row.date as string,
            days_idle: days, aging_bucket: stockAgingBucket(days),
          });
        }
        return lines.sort((a, b) => b.days_idle - a.days_idle);
      },

      async getReorderReport(company_id): Promise<ReorderLine[]> {
        const { data, error } = await client
          .from('stock_ledger')
          .select('product_id, warehouse_id, running_qty, running_avg_cost, products(name, sku, min_stock_level), warehouses(name)')
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
            qty_on_hand: qty, unit_cost: Number(row.running_avg_cost ?? 0),
            min_stock_level: min, shortage: min - qty,
          });
        }
        return lines.sort((a, b) => b.shortage - a.shortage);
      },

      async getStockAging(company_id): Promise<StockAgingLine[]> {
        const today = new Date().toISOString().slice(0, 10);
        const { data, error } = await client
          .from('stock_ledger')
          .select('product_id, warehouse_id, running_qty, running_avg_cost, date, products(name, sku), warehouses(name)')
          .eq('company_id', company_id)
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
          const cost = Number(row.running_avg_cost ?? 0);
          const days = stockAgingDays(row.date as string, today);
          const p = row.products as unknown as { name: string; sku: string } | null;
          const w = row.warehouses as unknown as { name: string } | null;
          lines.push({
            product_id: row.product_id, product_name: p?.name ?? '', sku: p?.sku ?? '',
            warehouse_id: row.warehouse_id, warehouse_name: w?.name ?? '',
            qty_on_hand: qty, unit_cost: cost, stock_value: qty * cost,
            last_movement_date: row.date as string,
            days_idle: days, aging_bucket: stockAgingBucket(days),
          });
        }
        return lines;
      },

      async getInventoryAdjustmentReport(company_id, params): Promise<InventoryAdjustmentReportLine[]> {
        const { data, error } = await client
          .from('inventory_adjustments')
          .select('id, adjustment_number, date, reason, warehouse_id, inventory_adjustment_items(difference, unit_cost)')
          .eq('company_id', company_id)
          .eq('status', 'confirmed')
          .gte('date', params.date_from)
          .lte('date', params.date_to)
          .order('date');
        assertNoError(error, 'reports.getInventoryAdjustmentReport');
        return (data ?? []).map(adj => {
          const items = adj.inventory_adjustment_items as unknown as { difference: number; unit_cost: number | null }[] | null ?? [];
          const totalGain = items.filter(i => Number(i.difference) > 0)
            .reduce((s, i) => s + Number(i.difference) * Number(i.unit_cost ?? 0), 0);
          const totalLoss = items.filter(i => Number(i.difference) < 0)
            .reduce((s, i) => s + Math.abs(Number(i.difference)) * Number(i.unit_cost ?? 0), 0);
          return {
            adjustment_id: adj.id,
            adjustment_number: adj.adjustment_number,
            date: adj.date as string,
            warehouse_id: adj.warehouse_id ?? '',
            reason: adj.reason,
            total_gain: totalGain,
            total_loss: totalLoss,
            net: totalGain - totalLoss,
          };
        });
      },

      // Phase 8 — Daily Cash Report
      async dailyCash(company_id, date): Promise<DailyCashLine[]> {
        const { data, error } = await client.rpc('get_daily_cash_report', {
          p_company_id: company_id,
          p_date: date,
        });
        assertNoError(error, 'reports.dailyCash');
        return (data ?? []) as DailyCashLine[];
      },

      // Phase 8 — Bank Reconciliation
      async bankRecon(company_id, account_id, date_from, date_to): Promise<BankReconLine[]> {
        const { data, error } = await client.rpc('get_bank_recon', {
          p_company_id: company_id,
          p_account_id: account_id,
          p_date_from: date_from,
          p_date_to: date_to,
        });
        assertNoError(error, 'reports.bankRecon');
        return (data ?? []) as BankReconLine[];
      },

      // Phase 10 reports ─────────────────────────────────────────────────────
      async getSalesByCustomer(company_id, from, to): Promise<SalesByCustomerLine[]> {
        const { data: invRows, error: invErr } = await client
          .from('invoices')
          .select('id, contact_id, subtotal, contacts(name), invoice_items(quantity, unit_price, discount_percent, cost_at_sale)')
          .eq('company_id', company_id)
          .eq('status', 'confirmed')
          .gte('date', from).lte('date', to);
        assertNoError(invErr, 'getSalesByCustomer invoices');

        const { data: cnRows, error: cnErr } = await client
          .from('credit_notes')
          .select('contact_id, subtotal')
          .eq('company_id', company_id)
          .eq('status', 'confirmed')
          .gte('date', from).lte('date', to);
        assertNoError(cnErr, 'getSalesByCustomer credit_notes');

        const byContact: Record<string, { name: string; count: number; gross: number; cogs: number; returns: number }> = {};
        for (const inv of invRows ?? []) {
          const contact = inv.contacts as unknown as { name: string } | null;
          if (!byContact[inv.contact_id]) byContact[inv.contact_id] = { name: contact?.name ?? '', count: 0, gross: 0, cogs: 0, returns: 0 };
          byContact[inv.contact_id].count += 1;
          byContact[inv.contact_id].gross += Number(inv.subtotal);
          const items = (inv.invoice_items as unknown as { quantity: number; unit_price: number; cost_at_sale: number | null }[] | null) ?? [];
          for (const it of items) {
            byContact[inv.contact_id].cogs += Number(it.cost_at_sale ?? 0) * Number(it.quantity);
          }
        }
        for (const cn of cnRows ?? []) {
          if (byContact[cn.contact_id]) byContact[cn.contact_id].returns += Number(cn.subtotal);
        }
        return Object.entries(byContact).map(([id, b]) => {
          const net = b.gross - b.returns;
          const gp = net - b.cogs;
          return { contact_id: id, contact_name: b.name, invoice_count: b.count, gross_sales: b.gross, returns: b.returns, net_sales: net, gross_profit: gp, gp_pct: net > 0 ? Math.round(gp / net * 1000) / 10 : 0 };
        }).sort((a, b) => b.net_sales - a.net_sales);
      },

      async getSalesByProduct(company_id, from, to): Promise<SalesByProductLine[]> {
        const { data, error } = await client
          .from('invoice_items')
          .select('product_id, quantity, unit_price, discount_percent, cost_at_sale, products(code, name, brands(name)), invoices!inner(company_id, status, date)')
          .eq('invoices.company_id', company_id)
          .eq('invoices.status', 'confirmed')
          .gte('invoices.date', from).lte('invoices.date', to);
        assertNoError(error, 'getSalesByProduct');
        const byProduct: Record<string, { sku: string; name: string; brand: string; qty: number; sales: number; cogs: number }> = {};
        for (const row of data ?? []) {
          const p = row.products as unknown as { code: string; name: string; brands: { name: string } | null } | null;
          const id = row.product_id ?? 'none';
          if (!byProduct[id]) byProduct[id] = { sku: p?.code ?? '', name: p?.name ?? '', brand: p?.brands?.name ?? '', qty: 0, sales: 0, cogs: 0 };
          const qty = Number(row.quantity);
          const net = qty * Number(row.unit_price) * (1 - Number(row.discount_percent ?? 0) / 100);
          byProduct[id].qty += qty;
          byProduct[id].sales += net;
          byProduct[id].cogs += Number(row.cost_at_sale ?? 0) * qty;
        }
        return Object.entries(byProduct).map(([id, b]) => {
          const gp = b.sales - b.cogs;
          return { product_id: id, sku: b.sku, product_name: b.name, brand_name: b.brand, qty_sold: b.qty, net_sales: b.sales, gross_profit: gp, gp_pct: b.sales > 0 ? Math.round(gp / b.sales * 1000) / 10 : 0 };
        }).sort((a, b) => b.net_sales - a.net_sales);
      },

      async getSalesByBrand(company_id, from, to): Promise<SalesByBrandLine[]> {
        const { data, error } = await client
          .from('invoice_items')
          .select('quantity, unit_price, discount_percent, cost_at_sale, products(brand_id, brands(name)), invoices!inner(company_id, status, date)')
          .eq('invoices.company_id', company_id)
          .eq('invoices.status', 'confirmed')
          .gte('invoices.date', from).lte('invoices.date', to);
        assertNoError(error, 'getSalesByBrand');
        const byBrand: Record<string, { name: string; qty: number; revenue: number; cogs: number }> = {};
        for (const row of data ?? []) {
          const p = row.products as unknown as { brand_id: string | null; brands: { name: string } | null } | null;
          const id = p?.brand_id ?? 'none';
          if (!byBrand[id]) byBrand[id] = { name: p?.brands?.name ?? 'No Brand', qty: 0, revenue: 0, cogs: 0 };
          const qty = Number(row.quantity);
          const net = qty * Number(row.unit_price) * (1 - Number(row.discount_percent ?? 0) / 100);
          byBrand[id].qty += qty;
          byBrand[id].revenue += net;
          byBrand[id].cogs += Number(row.cost_at_sale ?? 0) * qty;
        }
        return Object.entries(byBrand).map(([id, b]) => {
          const gp = b.revenue - b.cogs;
          return { brand_id: id, brand_name: b.name, qty_sold: b.qty, revenue: b.revenue, gross_profit: gp, gp_pct: b.revenue > 0 ? Math.round(gp / b.revenue * 1000) / 10 : 0, stock_value: 0 };
        }).sort((a, b) => b.revenue - a.revenue);
      },

      async getSalesByVehicle(company_id, from, to): Promise<SalesByVehicleLine[]> {
        const { data, error } = await client
          .from('invoice_items')
          .select('quantity, unit_price, discount_percent, cost_at_sale, product_id, invoices!inner(company_id, status, date)')
          .eq('invoices.company_id', company_id)
          .eq('invoices.status', 'confirmed')
          .gte('invoices.date', from).lte('invoices.date', to);
        assertNoError(error, 'getSalesByVehicle inv_items');

        const productIds = [...new Set((data ?? []).map(r => r.product_id).filter(Boolean) as string[])];
        if (productIds.length === 0) return [];

        const { data: compatData, error: cErr } = await client
          .from('product_compatibility')
          .select('product_id, make_id, model_id, vehicle_makes(name), vehicle_models(name)')
          .in('product_id', productIds);
        assertNoError(cErr, 'getSalesByVehicle compat');

        const itemMap: Record<string, { qty: number; sales: number; cogs: number }> = {};
        for (const row of data ?? []) {
          if (!row.product_id) continue;
          if (!itemMap[row.product_id]) itemMap[row.product_id] = { qty: 0, sales: 0, cogs: 0 };
          const qty = Number(row.quantity);
          itemMap[row.product_id].qty += qty;
          itemMap[row.product_id].sales += qty * Number(row.unit_price) * (1 - Number(row.discount_percent ?? 0) / 100);
          itemMap[row.product_id].cogs += Number(row.cost_at_sale ?? 0) * qty;
        }

        const byVehicle: Record<string, SalesByVehicleLine> = {};
        for (const c of compatData ?? []) {
          const make = c.vehicle_makes as unknown as { name: string } | null;
          const model = c.vehicle_models as unknown as { name: string } | null;
          const key = `${c.make_id}::${c.model_id ?? 'all'}`;
          if (!byVehicle[key]) byVehicle[key] = { make_id: c.make_id, make_name: make?.name ?? '', model_id: c.model_id, model_name: model?.name ?? null, qty: 0, revenue: 0, gross_profit: 0 };
          const m = itemMap[c.product_id];
          if (m) {
            byVehicle[key].qty += m.qty;
            byVehicle[key].revenue += m.sales;
            byVehicle[key].gross_profit += m.sales - m.cogs;
          }
        }
        return Object.values(byVehicle).sort((a, b) => b.revenue - a.revenue);
      },

      async getSalesBySalesperson(company_id, from, to): Promise<SalesBySalespersonLine[]> {
        // Phase 12.16: salesperson_id now FKs to salespeople (not profiles).
        // Join salespeople(name) instead of profiles(full_name).
        const { data, error } = await client
          .from('invoices')
          .select('id, salesperson_id, subtotal, salespeople(name), invoice_items(quantity, unit_price, discount_percent, cost_at_sale)')
          .eq('company_id', company_id)
          .eq('status', 'confirmed')
          .gte('date', from).lte('date', to);
        assertNoError(error, 'getSalesBySalesperson');
        const by: Record<string, { name: string; count: number; sales: number; cogs: number }> = {};
        for (const inv of data ?? []) {
          const spId = inv.salesperson_id ?? 'unassigned';
          const sp = inv.salespeople as unknown as { name: string } | null;
          if (!by[spId]) by[spId] = { name: sp?.name ?? 'Unassigned', count: 0, sales: 0, cogs: 0 };
          by[spId].count += 1;
          const items = (inv.invoice_items as unknown as { quantity: number; unit_price: number; discount_percent: number; cost_at_sale: number | null }[] | null) ?? [];
          for (const it of items) {
            const net = Number(it.quantity) * Number(it.unit_price) * (1 - Number(it.discount_percent ?? 0) / 100);
            by[spId].sales += net;
            by[spId].cogs += Number(it.cost_at_sale ?? 0) * Number(it.quantity);
          }
        }
        return Object.entries(by).map(([id, b]) => {
          const gp = b.sales - b.cogs;
          return { salesperson_id: id === 'unassigned' ? null : id, salesperson_name: b.name, invoice_count: b.count, net_sales: b.sales, gross_profit: gp, gp_pct: b.sales > 0 ? Math.round(gp / b.sales * 1000) / 10 : 0, avg_invoice_value: b.count > 0 ? Math.round(b.sales / b.count * 100) / 100 : 0 };
        }).sort((a, b) => b.net_sales - a.net_sales);
      },

      async getSalesTrend(company_id, from, to, bucket): Promise<SalesTrendLine[]> {
        const { data, error } = await client
          .from('invoices')
          .select('id, date, subtotal, invoice_items(quantity, unit_price, discount_percent, cost_at_sale)')
          .eq('company_id', company_id)
          .eq('status', 'confirmed')
          .gte('date', from).lte('date', to)
          .order('date');
        assertNoError(error, 'getSalesTrend');

        const { data: cnRows } = await client
          .from('credit_notes')
          .select('date, subtotal')
          .eq('company_id', company_id)
          .eq('status', 'confirmed')
          .gte('date', from).lte('date', to);

        const bucketKey = (date: string) => {
          const d = new Date(date);
          if (bucket === 'day')   return date.slice(0, 10);
          if (bucket === 'week')  { const w = new Date(d); w.setDate(d.getDate() - d.getDay()); return w.toISOString().slice(0, 10); }
          return date.slice(0, 7);
        };
        const by: Record<string, { count: number; gross: number; cogs: number; returns: number }> = {};
        for (const inv of data ?? []) {
          const k = bucketKey(inv.date as string);
          if (!by[k]) by[k] = { count: 0, gross: 0, cogs: 0, returns: 0 };
          by[k].count += 1;
          by[k].gross += Number(inv.subtotal);
          const items = (inv.invoice_items as unknown as { quantity: number; unit_price: number; discount_percent: number; cost_at_sale: number | null }[] | null) ?? [];
          for (const it of items) {
            by[k].cogs += Number(it.cost_at_sale ?? 0) * Number(it.quantity);
          }
        }
        for (const cn of cnRows ?? []) {
          const k = bucketKey((cn as { date: string; subtotal: number }).date);
          if (!by[k]) by[k] = { count: 0, gross: 0, cogs: 0, returns: 0 };
          by[k].returns += Number((cn as { date: string; subtotal: number }).subtotal);
        }
        return Object.entries(by).sort(([a], [b]) => a.localeCompare(b)).map(([k, b]) => {
          const net = b.gross - b.returns;
          return { bucket: k, invoice_count: b.count, gross_sales: b.gross, returns: b.returns, net_sales: net, gross_profit: net - b.cogs };
        });
      },

      async getPurchasesBySupplier(company_id, from, to): Promise<PurchasesBySupplierLine[]> {
        const { data, error } = await client
          .from('vendor_bills')
          .select('supplier_id, total_amount, contacts!vendor_bills_supplier_id_fkey(name)')
          .eq('company_id', company_id)
          .eq('status', 'confirmed')
          .gte('date', from).lte('date', to);
        assertNoError(error, 'getPurchasesBySupplier');
        const by: Record<string, { name: string; count: number; total: number }> = {};
        let grandTotal = 0;
        for (const b of data ?? []) {
          const contact = b.contacts as unknown as { name: string } | null;
          if (!by[b.supplier_id]) by[b.supplier_id] = { name: contact?.name ?? '', count: 0, total: 0 };
          by[b.supplier_id].count += 1;
          by[b.supplier_id].total += Number(b.total_amount);
          grandTotal += Number(b.total_amount);
        }
        return Object.entries(by).map(([id, s]) => ({
          contact_id: id, contact_name: s.name, bill_count: s.count, gross_purchases: s.total, returns: 0, net_purchases: s.total,
          pct_of_total: grandTotal > 0 ? Math.round(s.total / grandTotal * 1000) / 10 : 0,
        })).sort((a, b) => b.net_purchases - a.net_purchases);
      },

      async getPurchasesByProduct(company_id, from, to): Promise<PurchasesByProductLine[]> {
        const { data, error } = await client
          .from('goods_receipt_items')
          .select('product_id, qty_received, unit_cost, products(code, name), goods_receipts!inner(company_id, status, date)')
          .eq('goods_receipts.company_id', company_id)
          .eq('goods_receipts.status', 'received')
          .gte('goods_receipts.date', from).lte('goods_receipts.date', to);
        assertNoError(error, 'getPurchasesByProduct');
        const by: Record<string, { sku: string; name: string; qty: number; cost: number }> = {};
        for (const row of data ?? []) {
          const p = row.products as unknown as { code: string; name: string } | null;
          const id = row.product_id ?? 'none';
          if (!by[id]) by[id] = { sku: p?.code ?? '', name: p?.name ?? '', qty: 0, cost: 0 };
          const qty = Number(row.qty_received);
          by[id].qty += qty;
          by[id].cost += qty * Number(row.unit_cost ?? 0);
        }
        return Object.entries(by).map(([id, b]) => ({
          product_id: id, sku: b.sku, product_name: b.name, qty_purchased: b.qty, total_cost: b.cost, avg_unit_cost: b.qty > 0 ? Math.round(b.cost / b.qty * 100) / 100 : 0,
        })).sort((a, b) => b.total_cost - a.total_cost);
      },

      async getOutstandingPOs(company_id): Promise<OutstandingPOLine[]> {
        const { data, error } = await client
          .from('purchase_orders')
          .select('id, po_number, supplier_id, date, expected_delivery_date, total_amount, contacts(name), goods_receipts(total_amount, status)')
          .eq('company_id', company_id)
          .in('status', ['draft', 'sent', 'partial'])
          .order('date', { ascending: false });
        assertNoError(error, 'getOutstandingPOs');
        return (data ?? []).map(po => {
          const contact = po.contacts as unknown as { name: string } | null;
          const grns = (po.goods_receipts as unknown as { total_amount: number; status: string }[] | null) ?? [];
          const received = grns.filter(g => g.status === 'received').reduce((s, g) => s + Number(g.total_amount), 0);
          const total = Number(po.total_amount ?? 0);
          return { po_id: po.id, po_number: po.po_number, supplier_name: contact?.name ?? '', date: po.date as string, expected_delivery: po.expected_delivery_date as string | null, total, received_value: received, pending_value: Math.max(0, total - received) };
        });
      },

      async getVATReturn(company_id, from, to): Promise<VATReturn> {
        // Output VAT (account 2200) — credits = VAT collected on sales
        const { data: outRows, error: outErr } = await client
          .from('general_ledger')
          .select('debit, credit, contact_id')
          .eq('company_id', company_id)
          .eq('account_code', '2200')
          .gte('date', from).lte('date', to);
        assertNoError(outErr, 'getVATReturn output');

        const totalOutputVAT = (outRows ?? []).reduce((s, r) => s + Number(r.credit) - Number(r.debit), 0);

        // Input VAT (account 1500) — debits = VAT paid on purchases
        const { data: inRows, error: inErr } = await client
          .from('general_ledger')
          .select('debit, credit')
          .eq('company_id', company_id)
          .eq('account_code', '1500')
          .gte('date', from).lte('date', to);
        assertNoError(inErr, 'getVATReturn input');

        const totalInputVAT = (inRows ?? []).reduce((s, r) => s + Number(r.debit) - Number(r.credit), 0);

        // Get sales subtotal for Box 1 (standard-rated)
        const { data: salesRows, error: salesErr } = await client
          .from('general_ledger')
          .select('debit, credit')
          .eq('company_id', company_id)
          .eq('account_code', '4100')
          .gte('date', from).lte('date', to);
        assertNoError(salesErr, 'getVATReturn sales');
        const totalSales = (salesRows ?? []).reduce((s, r) => s + Number(r.credit) - Number(r.debit), 0);

        const { data: expRows, error: expErr } = await client
          .from('general_ledger')
          .select('debit, credit')
          .eq('company_id', company_id)
          .eq('account_code', '5100')
          .gte('date', from).lte('date', to);
        assertNoError(expErr, 'getVATReturn expenses');
        const totalExpenses = (expRows ?? []).reduce((s, r) => s + Number(r.debit) - Number(r.credit), 0);

        const outputBoxes: VATReturnBox[] = [
          { box: '1', label: 'Standard Rated Supplies', taxable_amount: Math.max(0, totalSales), vat_amount: Math.max(0, totalOutputVAT) },
          { box: '4', label: 'Zero Rated Supplies', taxable_amount: 0, vat_amount: 0 },
          { box: '5', label: 'Exempt Supplies', taxable_amount: 0, vat_amount: 0 },
        ];
        const inputBoxes: VATReturnBox[] = [
          { box: '9', label: 'Standard Rated Expenses', taxable_amount: Math.max(0, totalExpenses), vat_amount: Math.max(0, totalInputVAT) },
        ];
        return { period_start: from, period_end: to, output_boxes: outputBoxes, total_output_vat: Math.max(0, totalOutputVAT), input_boxes: inputBoxes, total_input_vat: Math.max(0, totalInputVAT), net_vat_payable: Math.max(0, totalOutputVAT) - Math.max(0, totalInputVAT) };
      },

      async getAuditLog(company_id, params): Promise<AuditLogLine[]> {
        let q = client
          .from('audit_logs')
          .select('id, created_at, user_id, action, entity_type, entity_id, old_data, new_data, profiles(email)')
          .eq('company_id', company_id)
          .order('created_at', { ascending: false })
          .limit(params.limit ?? 500);
        if (params.from) q = q.gte('created_at', params.from);
        if (params.to)   q = q.lte('created_at', params.to + 'T23:59:59');
        const { data, error } = await q;
        assertNoError(error, 'getAuditLog');
        return (data ?? []).map(r => {
          const profile = r.profiles as unknown as { email: string } | null;
          return {
            id: r.id, created_at: r.created_at as string,
            user_id: r.user_id, user_email: profile?.email ?? r.user_id,
            action: r.action, entity_type: r.entity_type, entity_id: r.entity_id,
            old_values: r.old_data as Record<string, unknown> | null,
            new_values: r.new_data as Record<string, unknown> | null,
          };
        });
      },

      async getEntityAuditLog(company_id, entity_type, entity_id, limit): Promise<AuditLogLine[]> {
        // Per-document activity feed. Same shape as getAuditLog but
        // filtered to a single (entity_type, entity_id).
        const { data, error } = await client
          .from('audit_logs')
          .select('id, created_at, user_id, action, entity_type, entity_id, old_data, new_data, profiles(email)')
          .eq('company_id', company_id)
          .eq('entity_type', entity_type)
          .eq('entity_id', entity_id)
          .order('created_at', { ascending: false })
          .limit(limit ?? 100);
        assertNoError(error, 'getEntityAuditLog');
        return (data ?? []).map(r => {
          const profile = r.profiles as unknown as { email: string } | null;
          return {
            id: r.id, created_at: r.created_at as string,
            user_id: r.user_id, user_email: profile?.email ?? r.user_id,
            action: r.action, entity_type: r.entity_type, entity_id: r.entity_id,
            old_values: r.old_data as Record<string, unknown> | null,
            new_values: r.new_data as Record<string, unknown> | null,
          };
        });
      },

      async getReversalTrail(company_id, from, to): Promise<ReversalTrailLine[]> {
        const { data, error } = await client
          .from('journal_entries')
          .select('id, entry_number, date, source_type, total_debit, reversed_by_id, reversed_je:journal_entries!reversed_by_id(entry_number, date, profiles(email))')
          .eq('company_id', company_id)
          .not('reversed_by_id', 'is', null)
          .gte('date', from).lte('date', to)
          .order('date', { ascending: false });
        assertNoError(error, 'getReversalTrail');
        return (data ?? []).map(r => {
          const rev = r.reversed_je as unknown as { entry_number: string; date: string; profiles: { email: string } | null } | null;
          return {
            original_entry_number: r.entry_number,
            original_date: r.date as string,
            reversal_entry_number: rev?.entry_number ?? '',
            reversal_date: rev?.date ?? '',
            amount: Number(r.total_debit),
            source_type: r.source_type ?? '',
            reversed_by: rev?.profiles?.email ?? '',
          };
        });
      },

      async getCashFlow(company_id, from, to): Promise<CashFlowStatement> {
        // ── Indirect cash flow, rebuilt account-driven so it ALWAYS reconciles ──
        // By double-entry, over any period:
        //   Δcash = NetProfit + Σ(cash-effect of every non-cash balance-sheet account)
        // where cash-effect = (Σcredit − Σdebit) for the account in the period
        // (an asset increase consumes cash → negative; a liability/equity
        // increase is a source → positive). We classify each balance-sheet
        // account into Operating / Investing / Financing by its CoA type, so
        // nothing (opening-balance equity, capital, payroll accruals, PDCs,
        // accruals, fixed assets…) can be silently dropped — which is what
        // broke the old hard-coded version.
        const pl = await this.getProfitAndLoss(company_id, from, to);
        const netProfit = pl.net_profit;

        const prevDay = (d: string) => { const dt = new Date(d); dt.setDate(dt.getDate() - 1); return dt.toISOString().slice(0, 10); };

        // Actual cash (11xx, incl. cash/bank sub-accounts) from the GL.
        const cashAsOf = async (date: string) => {
          const { data } = await client
            .from('general_ledger')
            .select('debit, credit')
            .eq('company_id', company_id)
            .like('account_code', '11%')
            .lte('date', date);
          return (data ?? []).reduce((s, r) => s + (Number(r.debit) - Number(r.credit)), 0);
        };
        const openingCash = await cashAsOf(prevDay(from));
        const closingCash = await cashAsOf(to);

        // Period movement per account code.
        const { data: glRows } = await client
          .from('general_ledger')
          .select('account_code, debit, credit')
          .eq('company_id', company_id)
          .gte('date', from).lte('date', to);
        const move = new Map<string, { dr: number; cr: number }>();
        for (const r of glRows ?? []) {
          const code = (r as { account_code: string }).account_code;
          const m = move.get(code) ?? { dr: 0, cr: 0 };
          m.dr += Number(r.debit)  || 0;
          m.cr += Number(r.credit) || 0;
          move.set(code, m);
        }

        // Classify each account by its CoA type/sub_type (fallback to prefix).
        // NOTE: query directly — `this` here is the `reports` sub-object, which
        // does not expose `coa` (that lives on the adapter root).
        const { data: coaData } = await client
          .from('chart_of_accounts')
          .select('code, name, type, sub_type')
          .eq('company_id', company_id);
        const byCode = new Map((coaData ?? []).map((a) => [(a as { code: string }).code, a]));
        type Bucket = 'cash' | 'pl' | 'operating' | 'investing' | 'financing';
        const classify = (code: string): Bucket => {
          if (code.startsWith('11')) return 'cash';
          const a = byCode.get(code) as ({ type?: string; sub_type?: string } | undefined);
          if (a?.type) {
            if (a.type === 'income' || a.type === 'expense') return 'pl';
            if (a.type === 'equity')    return 'financing';
            if (a.type === 'liability') return a.sub_type === 'long_term' ? 'financing' : 'operating';
            if (a.type === 'asset')     return a.sub_type === 'fixed' ? 'investing' : 'operating';
          }
          if (/^[456]/.test(code)) return 'pl';
          if (code.startsWith('3'))  return 'financing';
          return 'operating';
        };
        const nameOf = (code: string) => (byCode.get(code) as { name?: string } | undefined)?.name ?? code;

        const operating: CashFlowSection[] = [];
        const investing: CashFlowSection[] = [];
        const financing: CashFlowSection[] = [];

        for (const code of Array.from(move.keys()).sort((a, b) => a.localeCompare(b))) {
          const bucket = classify(code);
          if (bucket === 'cash' || bucket === 'pl') continue; // cash is the result; P&L already in netProfit
          const m = move.get(code)!;
          const cashEffect = m.cr - m.dr;            // asset↑ → −, liability/equity↑ → +
          if (Math.abs(cashEffect) < 0.005) continue;
          const line: CashFlowSection = { label: nameOf(code), amount: cashEffect };
          if (bucket === 'investing') investing.push(line);
          else if (bucket === 'financing') financing.push(line);
          else operating.push(line);
        }

        const sum = (arr: CashFlowSection[]) => arr.reduce((s, i) => s + i.amount, 0);
        let netOperating = netProfit + sum(operating);
        const netInvesting = sum(investing);
        const netFinancing = sum(financing);
        let netIncrease = netOperating + netInvesting + netFinancing;

        // Reconciliation guard — by construction this equals the real cash
        // delta. If a P&L quirk leaves a residual, surface it as an explicit
        // line so the statement always ties out to the GL cash movement.
        const residual = (closingCash - openingCash) - netIncrease;
        if (Math.abs(residual) > 0.01) {
          operating.push({ label: 'Unclassified / other', amount: residual });
          netOperating += residual;
          netIncrease = closingCash - openingCash;
        }

        return {
          period_start: from, period_end: to,
          net_profit: netProfit,
          operating_adjustments: [],
          working_capital_changes: operating,
          net_operating: netOperating,
          investing_activities: investing,
          net_investing: netInvesting,
          financing_activities: financing,
          net_financing: netFinancing,
          net_increase: netIncrease,
          opening_cash: openingCash,
          closing_cash: closingCash,
        };
      },

      // Phase 13.03 — dashboard cards via single RPC. Returns the four
      // datasets the React dashboard renders below the KPI tiles. The
      // RPC isn't in the generated Database['Functions'] union yet (next
      // supabase gen types run will pick it up); the cast bypasses that.
      //
      // CRITICAL — must call rpc as a method on `client` so `this` stays
      // bound. Assigning client.rpc to a local const detaches `this`
      // and supabase-js then throws "Cannot read properties of undefined
      // (reading 'rest')" because it tries to read this.rest (the REST
      // config) inside the call. Mirror the inline-cast pattern used by
      // bankReconciliations.save.
      async getDashboardCards(company_id): Promise<import('./adapter').DashboardCards> {
        const { data, error } = await (
          client.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
        )('get_dashboard_cards', { p_company_id: company_id });
        assertNoError(error as Error | null, 'reports.getDashboardCards');
        return data as import('./adapter').DashboardCards;
      },

      async getOwnerDashboard(company_id): Promise<OwnerDashboard> {
        // Date helpers
        const todayDate = new Date();
        const today = todayDate.toISOString().slice(0, 10);
        const yesterday = new Date(todayDate.getTime() - 86_400_000).toISOString().slice(0, 10);
        const monthStart = today.slice(0, 7) + '-01';
        const last7 = new Date(todayDate.getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
        const last30 = new Date(todayDate.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);

        // Helper: GL balance for a single account code up to a given date (inclusive).
        // normalDebit=true for asset/expense (DR-CR), false for liability/revenue (CR-DR).
        const balanceAsOf = async (code: string, asOf: string, normalDebit: boolean): Promise<number> => {
          const { data } = await client
            .from('general_ledger')
            .select('debit, credit')
            .eq('company_id', company_id)
            .eq('account_code', code)
            .lte('date', asOf);
          const net = (data ?? []).reduce((s, r) => s + (Number(r.debit) - Number(r.credit)), 0);
          return normalDebit ? net : -net;
        };
        // Same as above but matches code prefix (e.g. "11" matches 1100, 1110).
        const balanceLikeAsOf = async (prefix: string, asOf: string): Promise<number> => {
          const { data } = await client
            .from('general_ledger')
            .select('debit, credit')
            .eq('company_id', company_id)
            .like('account_code', prefix + '%')
            .lte('date', asOf);
          return (data ?? []).reduce((s, r) => s + (Number(r.debit) - Number(r.credit)), 0);
        };

        const [
          { data: todayInvs },     { data: yestInvs },
          { data: todayBills },    { data: yestBills },
          arNow, arPrev,
          apNow, apPrev,
          invNow, invPrev,
          cashNow,
          { count: skuCountNow },
          { count: skuCountPrev },
          { data: topProds },
          { data: lowStock },
          { data: overdueInvs },
          { data: trendInvs },
          { data: trendBills },
          { data: recentProds },
        ] = await Promise.all([
          client.from('invoices').select('total_amount').eq('company_id', company_id).eq('status', 'confirmed').eq('date', today),
          client.from('invoices').select('total_amount').eq('company_id', company_id).eq('status', 'confirmed').eq('date', yesterday),
          client.from('vendor_bills').select('total_amount').eq('company_id', company_id).eq('status', 'confirmed').eq('date', today),
          client.from('vendor_bills').select('total_amount').eq('company_id', company_id).eq('status', 'confirmed').eq('date', yesterday),

          balanceAsOf('1200', today,  true),
          balanceAsOf('1200', last30, true),
          (async () => (await balanceAsOf('2100', today,  false)) + (await balanceAsOf('2110', today,  false)) + (await balanceAsOf('2120', today,  false)))(),
          (async () => (await balanceAsOf('2100', last30, false)) + (await balanceAsOf('2110', last30, false)) + (await balanceAsOf('2120', last30, false)))(),
          balanceAsOf('1300', today,  true),
          balanceAsOf('1300', last30, true),
          balanceLikeAsOf('11', today),

          client.from('products').select('*', { count: 'exact', head: true })
            .eq('company_id', company_id).eq('is_active', true),
          client.from('products').select('*', { count: 'exact', head: true })
            .eq('company_id', company_id).eq('is_active', true)
            .lt('created_at', last30 + 'T00:00:00'),

          client.from('invoice_items').select('product_id, quantity, unit_price, discount_percent, products(name), invoices!inner(company_id, status, date)').eq('invoices.company_id', company_id).eq('invoices.status', 'confirmed').gte('invoices.date', monthStart).lte('invoices.date', today).limit(500),

          // Current stock per (product, warehouse) — pulled directly from
          // stock_ledger via SUM(direction × quantity). We used to read
          // the latest running_qty by created_at, but multiple rows in
          // one transaction (e.g. a void that reverses 4 sales at once)
          // share identical created_at, so Postgres returned them in
          // undefined order and the dedup could pick an intermediate row.
          // SUM is deterministic and self-corrects against any historical
          // chaos in the ledger.
          client.from('stock_ledger').select('product_id, warehouse_id, direction, quantity, products(min_stock_level)').eq('company_id', company_id).limit(5000),

          client.from('invoices').select('id, total_amount').eq('company_id', company_id).eq('status', 'confirmed').lt('due_date', today).limit(500),

          // 7-day trend — sales
          client.from('invoices').select('date, total_amount').eq('company_id', company_id).eq('status', 'confirmed').gte('date', last7).lte('date', today),
          // 7-day trend — purchases
          client.from('vendor_bills').select('date, total_amount').eq('company_id', company_id).eq('status', 'confirmed').gte('date', last7).lte('date', today),

          // Recent inventory: latest 5 active products + a unit code (best-effort)
          client.from('products').select('id, name, oe_number, sku, unit_id, units_of_measure(code)')
            .eq('company_id', company_id).eq('is_active', true)
            .order('created_at', { ascending: false }).limit(5),
        ]);

        const todayCount     = (todayInvs ?? []).length;
        const todayAmount    = (todayInvs ?? []).reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
        const yestAmount     = (yestInvs ?? []).reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
        const todayPurchases = (todayBills ?? []).reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
        const yestPurchases  = (yestBills ?? []).reduce((s, r) => s + Number(r.total_amount ?? 0), 0);

        // Top products by revenue this month
        const prodRevenue: Record<string, { name: string; qty: number; rev: number }> = {};
        for (const r of (topProds ?? []) as unknown as { product_id: string | null; quantity: number; unit_price: number; discount_percent: number; products: { name: string } | null }[]) {
          const id = r.product_id ?? 'none';
          if (!prodRevenue[id]) prodRevenue[id] = { name: r.products?.name ?? '', qty: 0, rev: 0 };
          prodRevenue[id].qty += Number(r.quantity);
          prodRevenue[id].rev += Number(r.quantity) * Number(r.unit_price) * (1 - Number(r.discount_percent ?? 0) / 100);
        }
        const topProducts = Object.entries(prodRevenue).sort(([, a], [, b]) => b.rev - a.rev).slice(0, 5).map(([id, v]) => ({ product_id: id, name: v.name, qty: v.qty, revenue: v.rev }));

        // Sum direction × quantity over all stock_ledger rows per
        // (product, warehouse). Result = current on-hand quantity. Then
        // collapse to per-product totals and apply min_stock_level for
        // the low-stock count. Authoritative and order-independent.
        type LowStockRow = {
          product_id: string | null;
          warehouse_id: string | null;
          direction: number | null;
          quantity: number | null;
          products: { min_stock_level: number | null } | null;
        };
        const perPwh: Record<string, { product_id: string; qty: number; min: number }> = {};
        for (const r of (lowStock ?? []) as LowStockRow[]) {
          if (!r.product_id) continue;
          const key = `${r.product_id}::${r.warehouse_id ?? ''}`;
          if (!perPwh[key]) {
            perPwh[key] = {
              product_id: r.product_id,
              qty:        0,
              min:        Number(r.products?.min_stock_level ?? 0),
            };
          }
          perPwh[key].qty += Number(r.direction ?? 0) * Number(r.quantity ?? 0);
        }
        const latestQtyByProduct: Record<string, number> = {};
        let lowStockCount = 0;
        for (const row of Object.values(perPwh)) {
          latestQtyByProduct[row.product_id] = (latestQtyByProduct[row.product_id] ?? 0) + row.qty;
          if (row.min > 0 && row.qty <= row.min) lowStockCount++;
        }

        // 7-day trend — build a date-keyed map then iterate days for a complete series
        const salesByDate: Record<string, number> = {};
        for (const r of (trendInvs ?? []) as { date: string; total_amount: number }[]) {
          salesByDate[r.date] = (salesByDate[r.date] ?? 0) + Number(r.total_amount ?? 0);
        }
        const purchasesByDate: Record<string, number> = {};
        for (const r of (trendBills ?? []) as { date: string; total_amount: number }[]) {
          purchasesByDate[r.date] = (purchasesByDate[r.date] ?? 0) + Number(r.total_amount ?? 0);
        }
        const trend7d: { date: string; sales: number; purchases: number }[] = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date(todayDate.getTime() - i * 86_400_000).toISOString().slice(0, 10);
          trend7d.push({ date: d, sales: salesByDate[d] ?? 0, purchases: purchasesByDate[d] ?? 0 });
        }

        // Overdue: confirmed invoices past due AND with positive outstanding
        let overdueCount = 0;
        const overdueRows = (overdueInvs ?? []) as { id: string; total_amount: number }[];
        if (overdueRows.length > 0) {
          const ids = overdueRows.map((i) => i.id);
          const { data: allocs } = await client
            .from('payment_allocations')
            .select('doc_id, amount_applied, discount_amount')
            .in('doc_id', ids)
            .eq('doc_type', 'invoice');
          const paidByInv: Record<string, number> = {};
          for (const a of (allocs ?? []) as { doc_id: string; amount_applied: number; discount_amount: number }[]) {
            paidByInv[a.doc_id] = (paidByInv[a.doc_id] ?? 0) + Number(a.amount_applied) + Number(a.discount_amount ?? 0);
          }
          overdueCount = overdueRows.filter(
            (i) => Number(i.total_amount) - (paidByInv[i.id] ?? 0) > 0.01,
          ).length;
        }

        // Recent inventory: map latest products + their current stock total
        const recentInventory = ((recentProds ?? []) as unknown as { id: string; name: string; oe_number: string | null; sku: string; units_of_measure: { code: string } | null }[]).map((p) => ({
          product_id: p.id,
          name: p.name,
          oe_number: p.oe_number,
          sku: p.sku,
          unit_code: p.units_of_measure?.code ?? 'PCS',
          quantity: latestQtyByProduct[p.id] ?? 0,
        }));

        return {
          today_sales_count: todayCount,
          today_sales_amount: todayAmount,
          today_sales_amount_prev: yestAmount,
          today_purchases_amount: todayPurchases,
          today_purchases_amount_prev: yestPurchases,
          inventory_value: Math.max(0, invNow),
          inventory_value_prev: Math.max(0, invPrev),
          sku_count: skuCountNow ?? 0,
          sku_count_prev: skuCountPrev ?? 0,
          outstanding_ar: Math.max(0, arNow),
          outstanding_ar_prev: Math.max(0, arPrev),
          outstanding_ap: Math.max(0, apNow),
          outstanding_ap_prev: Math.max(0, apPrev),
          cash_and_bank: cashNow,
          top_products: topProducts,
          top_customers: [],
          low_stock_count: lowStockCount,
          overdue_invoices_count: overdueCount,
          trend_7d: trend7d,
          recent_inventory: recentInventory,
        };
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

      // ── Phase 12.47 — convert PO to draft Vendor Bill ────────────────────
      async convertToBill(po_id): Promise<VendorBillRow> {
        // 1. Fetch the source PO + items.
        const { data: po, error: poErr } = await client
          .from('purchase_orders').select('*').eq('id', po_id).single();
        assertNoError(poErr, 'purchaseOrders.convertToBill fetch PO');
        if (!po) throw new Error('Purchase order not found');
        if (po.status === 'closed' || po.status === 'void') {
          throw new Error(`Cannot convert a ${po.status} purchase order to a bill.`);
        }

        const { data: poItems, error: piErr } = await client
          .from('purchase_order_items').select('*')
          .eq('po_id', po_id).order('sort_order');
        assertNoError(piErr, 'purchaseOrders.convertToBill fetch items');

        // 2. Allocate a fresh BILL- number.
        const { data: numData, error: numErr } = await client
          .rpc('get_next_document_number', { p_company_id: po.company_id, p_prefix: 'BILL' });
        assertNoError(numErr, 'purchaseOrders.convertToBill number');

        // 3. Insert the draft bill. Stays draft so the user can review
        //    supplier_bill_number, due_date, warehouse before confirming
        //    (which is when GL + stock posting happens via confirm_vendor_bill).
        const billRow = {
          company_id:           po.company_id,
          bill_number:          numData as string,
          supplier_id:          po.supplier_id,
          supplier_bill_number: null,
          date:                 new Date().toISOString().slice(0, 10),
          due_date:             null,
          reference:            po.reference ?? po.po_number,
          currency:             po.currency,
          exchange_rate:        po.exchange_rate,
          subtotal:             po.subtotal,
          discount_amount:      po.discount_amount,
          tax_amount:           po.tax_amount,
          total_amount:         po.total_amount,
          status:               'draft' as const,
          linked_grn_id:        null,
          notes:                po.notes ?? null,
        };
        const { data: bill, error: billErr } = await client
          .from('vendor_bills').insert(billRow).select().single();
        assertNoError(billErr, 'purchaseOrders.convertToBill insert bill');

        // 4. Copy line items 1:1 (preserves discount/tax math from the PO).
        const billItems = (poItems ?? []).map((pi, i) => ({
          bill_id:          bill!.id,
          product_id:       pi.product_id,
          description:      pi.description,
          description_ar:   pi.description_ar,
          quantity:         pi.quantity,
          unit_id:          pi.unit_id,
          unit_cost:        pi.unit_cost,
          discount_percent: pi.discount_percent,
          discount_amount:  pi.discount_amount,
          tax_category:     pi.tax_category,
          tax_rate:         pi.tax_rate,
          tax_amount:       pi.tax_amount,
          line_subtotal:    pi.line_subtotal,
          line_total:       pi.line_total,
          sort_order:       i,
          coa_account_id:   null,
          linked_grn_item_id: null,
        }));
        if (billItems.length > 0) {
          const { error: biErr } = await client.from('vendor_bill_items').insert(billItems);
          assertNoError(biErr, 'purchaseOrders.convertToBill insert items');
        }

        // 5. Close the source PO so it leaves the open list. The CHECK
        //    constraint allows: draft / sent / partially_received /
        //    received / closed / void — closed is the right terminal
        //    state once the bill side is live.
        const { error: updErr } = await client
          .from('purchase_orders').update({ status: 'closed' }).eq('id', po_id);
        assertNoError(updErr, 'purchaseOrders.convertToBill close PO');

        return bill!;
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
      async edit(bill_id) {
        const { error } = await client.rpc('edit_vendor_bill' as never, { p_bill_id: bill_id } as never);
        assertNoError(error, 'vendorBills.edit');
      },
      async deleteDraft(bill_id) {
        // Drafts only — a draft bill has never posted to the GL or stock, so a
        // hard delete is safe. Guard on status so a confirmed bill is never wiped.
        const { data: bill, error: fErr } = await client.from('vendor_bills').select('status').eq('id', bill_id).single();
        assertNoError(fErr, 'vendorBills.deleteDraft fetch');
        if ((bill as { status?: string } | null)?.status !== 'draft') {
          throw new Error('Only draft bills can be deleted. Re-open a confirmed bill to a draft first.');
        }
        await client.from('vendor_bill_items').delete().eq('bill_id', bill_id);
        const { error } = await client.from('vendor_bills').delete().eq('id', bill_id).eq('status', 'draft');
        assertNoError(error, 'vendorBills.deleteDraft');
      },
      async getNextNumber(company_id) {
        const { data, error } = await client.rpc('get_next_document_number', { p_company_id: company_id, p_prefix: 'BILL' });
        assertNoError(error, 'vendorBills.getNextNumber');
        return data as string;
      },

      async listOpenForSupplier(company_id, supplier_id): Promise<import('./adapter').OpenVendorBill[]> {
        const { data: bills, error: bErr } = await client
          .from('vendor_bills')
          .select('*')
          .eq('company_id', company_id)
          .eq('supplier_id', supplier_id)
          .eq('status', 'confirmed')
          .order('date', { ascending: true });
        assertNoError(bErr, 'vendorBills.listOpenForSupplier bills');

        const rows = (bills ?? []) as VendorBillRow[];
        if (rows.length === 0) return [];

        const ids = rows.map(r => r.id);
        const { data: allocs, error: aErr } = await client
          .from('payment_allocations')
          .select('doc_id, amount_applied, discount_amount')
          .eq('company_id', company_id)
          .eq('doc_type', 'vendor_bill')
          .in('doc_id', ids);
        assertNoError(aErr, 'vendorBills.listOpenForSupplier allocations');

        const appliedById: Record<string, number> = {};
        for (const a of (allocs ?? []) as { doc_id: string; amount_applied: number; discount_amount: number }[]) {
          appliedById[a.doc_id] = (appliedById[a.doc_id] ?? 0) + Number(a.amount_applied) + Number(a.discount_amount ?? 0);
        }

        return rows
          .map(r => ({
            ...r,
            outstanding: Number(r.total_amount) - (appliedById[r.id] ?? 0),
          }))
          .filter(r => r.outstanding > 0.005);
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
      async update(id, row, allocations) {
        // Same RPC as customer side — the RPC checks payment.type
        // internally and validates doc_type accordingly.
        // undefined → don't touch existing allocations.
        // []        → clear all allocations.
        // [...]     → replace.
        const allocPayload =
          allocations === undefined
            ? null
            : allocations.map(a => ({
                doc_type:       a.doc_type,
                doc_id:         a.doc_id,
                amount_applied: a.amount_applied,
              }));
        const { data, error } = await (client.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)
          ('update_payment_draft', {
            p_payment_id:  id,
            p_row:         row as Record<string, unknown>,
            p_allocations: allocPayload,
          });
        assertNoError(error as Error | null, 'vendorPayments.update');
        return data as PaymentRow;
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
      async reopen(payment_id): Promise<void> {
        // Phase 18 — reverse the posting + reopen as draft so a confirmed
        // vendor payment can be edited, then re-confirmed via the draft path.
        const { error } = await client.rpc('reopen_vendor_payment' as never, {
          p_payment_id: payment_id,
        } as never);
        assertNoError(error, 'vendorPayments.reopen');
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

    // ── POS ───────────────────────────────────────────────────────────────────
    pos: {
      async openSession(warehouse_id, opening_cash) {
        const { data, error } = await client.rpc('open_pos_session', {
          p_warehouse_id: warehouse_id,
          p_opening_cash: opening_cash,
        });
        assertNoError(error, 'pos.openSession');
        return data as unknown as OpenSessionResult;
      },
      async getOpenSession(_company_id) {
        // RLS ensures company scoping; filter by current user's open session
        const { data } = await client
          .from('pos_sessions')
          .select('*')
          .eq('status', 'open')
          .order('opened_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        return (data ?? null) as PosSessionRow | null;
      },
      async closeSession(session_id, counted_cash, variance_reason) {
        const { data, error } = await client.rpc('close_pos_session', {
          p_session_id:       session_id,
          p_counted_cash:     counted_cash,
          p_variance_reason:  variance_reason ?? undefined,
        });
        assertNoError(error, 'pos.closeSession');
        return data as unknown as CloseSessionResult;
      },
      async confirmSale(session_id, items, payment_method, customer_id, notes) {
        const { data, error } = await client.rpc('confirm_pos_sale', {
          p_session_id:     session_id,
          p_items:          items as unknown as Json,
          p_payment_method: payment_method,
          p_customer_id:    customer_id ?? undefined,
          p_notes:          notes ?? undefined,
        });
        assertNoError(error, 'pos.confirmSale');
        return data as unknown as PosSaleResult;
      },
      async getSessionSales(session_id) {
        const { data, error } = await client
          .from('invoices')
          .select('*')
          .eq('pos_session_id', session_id)
          .order('created_at', { ascending: true });
        assertNoError(error, 'pos.getSessionSales');
        return (data ?? []) as InvoiceRow[];
      },
      async listSessions(company_id, params) {
        let q = client.from('pos_sessions').select('*').eq('company_id', company_id);
        if (params?.status) q = q.eq('status', params.status);
        if (params?.date_from) q = q.gte('opened_at', params.date_from);
        if (params?.date_to)   q = q.lte('opened_at', params.date_to + 'T23:59:59');
        const { data, error } = await q.order('opened_at', { ascending: false });
        assertNoError(error, 'pos.listSessions');
        return (data ?? []) as PosSessionRow[];
      },
      async getPOSSessionReport(company_id, params) {
        let q = client
          .from('pos_sessions')
          .select('*, warehouses(name)')
          .eq('company_id', company_id);
        if (params?.date_from) q = q.gte('opened_at', params.date_from);
        if (params?.date_to)   q = q.lte('opened_at', params.date_to + 'T23:59:59');
        const { data, error } = await q.order('opened_at', { ascending: false });
        assertNoError(error, 'pos.getPOSSessionReport');
        return ((data ?? []) as Record<string, unknown>[]).map(s => ({
          session_id:           s.id as string,
          session_number:       s.session_number as string,
          opened_at:            s.opened_at as string,
          closed_at:            s.closed_at as string | null,
          warehouse_id:         s.warehouse_id as string,
          warehouse_name:       ((s.warehouses as Record<string, unknown>)?.name as string) ?? '',
          opening_cash:         (s.opening_cash as number) ?? 0,
          total_sales_amount:   (s.total_sales_amount as number) ?? 0,
          total_sales_count:    (s.total_sales_count as number) ?? 0,
          closing_cash_counted: s.closing_cash_counted as number | null,
          cash_variance:        s.cash_variance as number | null,
          status:               s.status as string,
        })) as POSSessionReportLine[];
      },
      async getDailySalesSummary(company_id, params) {
        const { data, error } = await client
          .from('invoices')
          .select('date, sale_channel, total_amount')
          .eq('company_id', company_id)
          .in('sale_channel', ['pos_cash', 'pos_card', 'pos_credit'])
          .eq('status', 'confirmed')
          .gte('date', params.date_from)
          .lte('date', params.date_to)
          .order('date');
        assertNoError(error, 'pos.getDailySalesSummary');
        // Group by date
        const byDate = new Map<string, DailySalesSummaryLine>();
        for (const row of (data ?? []) as { date: string; sale_channel: string; total_amount: number }[]) {
          const d = row.date as string;
          if (!byDate.has(d)) {
            byDate.set(d, { date: d, cash_total: 0, card_total: 0, credit_total: 0, grand_total: 0, invoice_count: 0 });
          }
          const entry = byDate.get(d)!;
          if (row.sale_channel === 'pos_cash')   entry.cash_total   += row.total_amount;
          if (row.sale_channel === 'pos_card')   entry.card_total   += row.total_amount;
          if (row.sale_channel === 'pos_credit') entry.credit_total += row.total_amount;
          entry.grand_total += row.total_amount;
          entry.invoice_count++;
        }
        return Array.from(byDate.values());
      },
    },

    // ── Phase 8: Bank Transfers ───────────────────────────────────────────────
    bankTransfers: {
      async list(company_id, params) {
        let q = client.from('bank_transfers').select('*').eq('company_id', company_id);
        if (params?.status)    q = q.eq('status', params.status);
        if (params?.date_from) q = q.gte('date', params.date_from);
        if (params?.date_to)   q = q.lte('date', params.date_to);
        const { data, error } = await q.order('date', { ascending: false });
        assertNoError(error, 'bankTransfers.list');
        return (data ?? []) as BankTransferRow[];
      },
      async getById(id) {
        const { data, error } = await client.from('bank_transfers').select('*').eq('id', id).single();
        assertNoError(error, 'bankTransfers.getById');
        return data as BankTransferRow;
      },
      async create(data) {
        const { data: row, error } = await client.from('bank_transfers').insert(data).select().single();
        assertNoError(error, 'bankTransfers.create');
        return row as BankTransferRow;
      },
      async update(id, data) {
        const { data: row, error } = await client.from('bank_transfers').update(data).eq('id', id).select().single();
        assertNoError(error, 'bankTransfers.update');
        return row as BankTransferRow;
      },
      async confirm(id) {
        const { data, error } = await client.rpc('confirm_bank_transfer', { p_transfer_id: id });
        assertNoError(error, 'bankTransfers.confirm');
        return data as unknown as BankTransferConfirmResult;
      },
      async void(id, reason) {
        const { error } = await client.rpc('void_bank_transfer', { p_transfer_id: id, p_void_reason: reason ?? undefined });
        assertNoError(error, 'bankTransfers.void');
        return;
      },
      async getNextNumber(company_id) {
        const { data, error } = await client.rpc('get_next_document_number', { p_company_id: company_id, p_prefix: 'TRF' });
        assertNoError(error, 'bankTransfers.getNextNumber');
        return data as string;
      },
    },

    // ── Phase 8: Expenses ─────────────────────────────────────────────────────
    expenses: {
      async list(company_id, params) {
        let q = client.from('expenses').select('*').eq('company_id', company_id);
        if (params?.status)    q = q.eq('status', params.status);
        if (params?.date_from) q = q.gte('date', params.date_from);
        if (params?.date_to)   q = q.lte('date', params.date_to);
        const { data, error } = await q.order('date', { ascending: false });
        assertNoError(error, 'expenses.list');
        return (data ?? []) as ExpenseRow[];
      },
      async getById(id) {
        const { data, error } = await client.from('expenses').select('*').eq('id', id).single();
        assertNoError(error, 'expenses.getById');
        return data as ExpenseRow;
      },
      async create(data) {
        const { data: row, error } = await client.from('expenses').insert(data).select().single();
        assertNoError(error, 'expenses.create');
        return row as ExpenseRow;
      },
      async update(id, data) {
        const { data: row, error } = await client.from('expenses').update(data).eq('id', id).select().single();
        assertNoError(error, 'expenses.update');
        return row as ExpenseRow;
      },
      async confirm(id) {
        const { data, error } = await client.rpc('confirm_expense', { p_expense_id: id });
        assertNoError(error, 'expenses.confirm');
        return data as unknown as ExpenseConfirmResult;
      },
      async void(id, reason) {
        const { error } = await client.rpc('void_expense', { p_expense_id: id, p_void_reason: reason ?? undefined });
        assertNoError(error, 'expenses.void');
        return;
      },
      async getNextNumber(company_id) {
        const { data, error } = await client.rpc('get_next_document_number', { p_company_id: company_id, p_prefix: 'EXP' });
        assertNoError(error, 'expenses.getNextNumber');
        return data as string;
      },
      // ── Phase 13.01 — multi-line item I/O. expense_items isn't in the
      //   generated database types yet; bypass the typed client with a
      //   raw any-cast (same pattern used by bankReconciliations.save). ──
      async getItems(expense_id) {
        const raw = client as unknown as {
          from: (t: string) => { select: (c: string) => {
            eq: (col: string, val: string) => {
              order: (col: string) => Promise<{ data: unknown; error: unknown }>
            }
          } }
        };
        const { data, error } = await raw
          .from('expense_items')
          .select('*')
          .eq('expense_id', expense_id)
          .order('sort_order');
        assertNoError(error as Error | null, 'expenses.getItems');
        return (data ?? []) as ExpenseItemRow[];
      },
      async replaceItems(expense_id, items) {
        // Delete-then-insert. Single round trip each; the inner expense
        // total is already updated by the caller so the JE postings on
        // confirm read the correct sum.
        const raw = client as unknown as {
          from: (t: string) => {
            delete: () => { eq: (col: string, val: string) => Promise<{ error: unknown }> };
            insert: (rows: unknown[]) => Promise<{ error: unknown }>;
          };
        };
        const { error: delErr } = await raw.from('expense_items').delete().eq('expense_id', expense_id);
        assertNoError(delErr as Error | null, 'expenses.replaceItems/delete');
        if (items.length === 0) return;
        const rows = items.map((i, idx) => ({ ...i, expense_id, sort_order: idx }));
        const { error: insErr } = await raw.from('expense_items').insert(rows);
        assertNoError(insErr as Error | null, 'expenses.replaceItems/insert');
      },
      async saveWithItems({ id, header, items }) {
        // Phase 14.14q — atomic header + items via single RPC. If the items
        // re-insert fails, the header insert/update rolls back too.
        const { data, error } = await (
          client.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
        )('save_expense_with_items', {
          p_id:     id,
          p_header: header as unknown as Record<string, unknown>,
          p_items:  items as unknown as Record<string, unknown>[],
        });
        assertNoError(error as Error | null, 'expenses.saveWithItems');
        return data as string;
      },
    },

    // ── Phase 8: PDC Cheques ──────────────────────────────────────────────────
    pdcCheques: {
      async list(company_id, params) {
        let q = client.from('pdc_cheques').select('*').eq('company_id', company_id);
        if (params?.type)      q = q.eq('type', params.type);
        if (params?.status)    q = q.eq('status', params.status);
        if (params?.date_from) q = q.gte('due_date', params.date_from);
        if (params?.date_to)   q = q.lte('due_date', params.date_to);
        const { data, error } = await q.order('due_date', { ascending: false });
        assertNoError(error, 'pdcCheques.list');
        return (data ?? []) as PDCChequeRow[];
      },
      async getById(id) {
        const { data, error } = await client.from('pdc_cheques').select('*').eq('id', id).single();
        assertNoError(error, 'pdcCheques.getById');
        return data as PDCChequeRow;
      },
      async create(params: PDCCreateParams) {
        const { data, error } = await client.rpc('create_pdc', {
          p_type:               params.type,
          p_contact_id:         params.contact_id,
          p_cheque_number:      params.cheque_number,
          p_amount:             params.amount,
          p_issue_date:         params.issue_date,
          p_due_date:           params.due_date,
          p_bank_name:          params.bank_name ?? undefined,
          p_currency:           params.currency,
          p_deposit_account_id: params.deposit_account_id ?? undefined,
          p_linked_payment_id:  params.linked_payment_id ?? undefined,
          p_is_advance:         params.is_advance ?? false,
          p_notes:              params.notes ?? undefined,
        });
        assertNoError(error, 'pdcCheques.create');
        return data as unknown as CreatePDCResult;
      },
      async deposit(pdc_id) {
        const { data, error } = await client.rpc('deposit_pdc', { p_pdc_id: pdc_id });
        assertNoError(error, 'pdcCheques.deposit');
        return data as unknown as PDCActionResult;
      },
      async clear(pdc_id, deposit_account_id) {
        const { data, error } = await client.rpc('clear_pdc', {
          p_pdc_id:             pdc_id,
          p_deposit_account_id: deposit_account_id ?? undefined,
        });
        assertNoError(error, 'pdcCheques.clear');
        return data as unknown as PDCActionResult;
      },
      async bounce(pdc_id) {
        const { data, error } = await client.rpc('bounce_pdc', { p_pdc_id: pdc_id });
        assertNoError(error, 'pdcCheques.bounce');
        return data as unknown as PDCActionResult;
      },
      async cancel(pdc_id) {
        const { data, error } = await client.rpc('cancel_pdc', { p_pdc_id: pdc_id });
        assertNoError(error, 'pdcCheques.cancel');
        return data as unknown as PDCActionResult;
      },
    },

    // ── Phase 9: Credit Notes ─────────────────────────────────────────────────
    creditNotes: {
      async list(company_id, params): Promise<CreditNoteRow[]> {
        let q = client.from('credit_notes').select('*').eq('company_id', company_id);
        if (params?.status)     q = q.eq('status', params.status);
        if (params?.contact_id) q = q.eq('contact_id', params.contact_id);
        if (params?.date_from)  q = q.gte('date', params.date_from);
        if (params?.date_to)    q = q.lte('date', params.date_to);
        const { data, error } = await q.order('date', { ascending: false });
        assertNoError(error, 'creditNotes.list');
        return (data ?? []) as CreditNoteRow[];
      },
      async getById(id): Promise<CreditNoteRow | null> {
        const { data, error } = await client.from('credit_notes').select('*').eq('id', id).single();
        if (error?.code === 'PGRST116') return null;
        assertNoError(error, 'creditNotes.getById');
        return data as CreditNoteRow;
      },
      async getItems(credit_note_id): Promise<CreditNoteItemRow[]> {
        const { data, error } = await client.from('credit_note_items').select('*')
          .eq('credit_note_id', credit_note_id).order('sort_order');
        assertNoError(error, 'creditNotes.getItems');
        return (data ?? []) as CreditNoteItemRow[];
      },
      async create(row: CreditNoteInsert, items: CreditNoteItemInsert[]): Promise<CreditNoteRow> {
        const { data: cn, error: hErr } = await client.from('credit_notes').insert(row).select().single();
        assertNoError(hErr, 'creditNotes.create header');
        const itemsWithId = items.map((it, i) => ({ ...it, credit_note_id: cn!.id, sort_order: i }));
        const { error: iErr } = await client.from('credit_note_items').insert(itemsWithId);
        assertNoError(iErr, 'creditNotes.create items');
        return cn as CreditNoteRow;
      },
      async update(id, row: CreditNoteUpdate, items: CreditNoteItemInsert[]): Promise<void> {
        const { error: hErr } = await client.from('credit_notes').update(row).eq('id', id);
        assertNoError(hErr, 'creditNotes.update header');
        await client.from('credit_note_items').delete().eq('credit_note_id', id);
        const itemsWithId = items.map((it, i) => ({ ...it, credit_note_id: id, sort_order: i }));
        const { error: iErr } = await client.from('credit_note_items').insert(itemsWithId);
        assertNoError(iErr, 'creditNotes.update items');
      },
      async confirm(id): Promise<CreditNoteConfirmResult> {
        const { data, error } = await client.rpc('confirm_credit_note', { p_credit_note_id: id });
        assertNoError(error, 'creditNotes.confirm');
        return data as unknown as CreditNoteConfirmResult;
      },
      async void(id, reason?): Promise<void> {
        const { error } = await client.rpc('void_credit_note', {
          p_credit_note_id: id,
          p_reason: reason ?? undefined,
        });
        assertNoError(error, 'creditNotes.void');
      },
      async getNextNumber(company_id): Promise<string> {
        const { data, error } = await client.rpc('get_next_document_number', {
          p_company_id: company_id,
          p_prefix: 'CN',
        });
        assertNoError(error, 'creditNotes.getNextNumber');
        return data as string;
      },
    },

    // ── Phase 9: Sales Returns ────────────────────────────────────────────────
    salesReturns: {
      async list(company_id, params): Promise<SalesReturnRow[]> {
        let q = client.from('sales_returns').select('*').eq('company_id', company_id);
        if (params?.status)    q = q.eq('status', params.status);
        if (params?.date_from) q = q.gte('date', params.date_from);
        if (params?.date_to)   q = q.lte('date', params.date_to);
        const { data, error } = await q.order('date', { ascending: false });
        assertNoError(error, 'salesReturns.list');
        return (data ?? []) as SalesReturnRow[];
      },
      async getById(id): Promise<SalesReturnRow | null> {
        const { data, error } = await client.from('sales_returns').select('*').eq('id', id).single();
        if (error?.code === 'PGRST116') return null;
        assertNoError(error, 'salesReturns.getById');
        return data as SalesReturnRow;
      },
      async getItems(sales_return_id): Promise<SalesReturnItemRow[]> {
        const { data, error } = await client.from('sales_return_items').select('*')
          .eq('sales_return_id', sales_return_id);
        assertNoError(error, 'salesReturns.getItems');
        return (data ?? []) as SalesReturnItemRow[];
      },
      async create(row: SalesReturnInsert, items: SalesReturnItemInsert[]): Promise<SalesReturnRow> {
        const { data: sr, error: hErr } = await client.from('sales_returns').insert(row).select().single();
        assertNoError(hErr, 'salesReturns.create header');
        const itemsWithId = items.map(it => ({ ...it, sales_return_id: sr!.id }));
        const { error: iErr } = await client.from('sales_return_items').insert(itemsWithId);
        assertNoError(iErr, 'salesReturns.create items');
        return sr as SalesReturnRow;
      },
      async getNextNumber(company_id): Promise<string> {
        const { data, error } = await client.rpc('get_next_document_number', {
          p_company_id: company_id,
          p_prefix: 'SR',
        });
        assertNoError(error, 'salesReturns.getNextNumber');
        return data as string;
      },
    },

    // ── Phase 9: Debit Notes ──────────────────────────────────────────────────
    debitNotes: {
      async list(company_id, params): Promise<DebitNoteRow[]> {
        let q = client.from('debit_notes').select('*').eq('company_id', company_id);
        if (params?.status)      q = q.eq('status', params.status);
        if (params?.supplier_id) q = q.eq('supplier_id', params.supplier_id);
        if (params?.date_from)   q = q.gte('date', params.date_from);
        if (params?.date_to)     q = q.lte('date', params.date_to);
        const { data, error } = await q.order('date', { ascending: false });
        assertNoError(error, 'debitNotes.list');
        return (data ?? []) as DebitNoteRow[];
      },
      async getById(id): Promise<DebitNoteRow | null> {
        const { data, error } = await client.from('debit_notes').select('*').eq('id', id).single();
        if (error?.code === 'PGRST116') return null;
        assertNoError(error, 'debitNotes.getById');
        return data as DebitNoteRow;
      },
      async getItems(debit_note_id): Promise<DebitNoteItemRow[]> {
        const { data, error } = await client.from('debit_note_items').select('*')
          .eq('debit_note_id', debit_note_id).order('sort_order');
        assertNoError(error, 'debitNotes.getItems');
        return (data ?? []) as DebitNoteItemRow[];
      },
      async create(row: DebitNoteInsert, items: DebitNoteItemInsert[]): Promise<DebitNoteRow> {
        const { data: dn, error: hErr } = await client.from('debit_notes').insert(row).select().single();
        assertNoError(hErr, 'debitNotes.create header');
        const itemsWithId = items.map((it, i) => ({ ...it, debit_note_id: dn!.id, sort_order: i }));
        const { error: iErr } = await client.from('debit_note_items').insert(itemsWithId);
        assertNoError(iErr, 'debitNotes.create items');
        return dn as DebitNoteRow;
      },
      async update(id, row: DebitNoteUpdate, items: DebitNoteItemInsert[]): Promise<void> {
        const { error: hErr } = await client.from('debit_notes').update(row).eq('id', id);
        assertNoError(hErr, 'debitNotes.update header');
        await client.from('debit_note_items').delete().eq('debit_note_id', id);
        const itemsWithId = items.map((it, i) => ({ ...it, debit_note_id: id, sort_order: i }));
        const { error: iErr } = await client.from('debit_note_items').insert(itemsWithId);
        assertNoError(iErr, 'debitNotes.update items');
      },
      async confirm(id): Promise<DebitNoteConfirmResult> {
        const { data, error } = await client.rpc('confirm_debit_note', { p_debit_note_id: id });
        assertNoError(error, 'debitNotes.confirm');
        return data as unknown as DebitNoteConfirmResult;
      },
      async void(id, reason?): Promise<void> {
        const { error } = await client.rpc('void_debit_note', {
          p_debit_note_id: id,
          p_reason: reason ?? undefined,
        });
        assertNoError(error, 'debitNotes.void');
      },
      async getNextNumber(company_id): Promise<string> {
        const { data, error } = await client.rpc('get_next_document_number', {
          p_company_id: company_id,
          p_prefix: 'DN',
        });
        assertNoError(error, 'debitNotes.getNextNumber');
        return data as string;
      },
    },

    // ── Phase 10: System Health ───────────────────────────────────────────────
    systemHealth: {
      async check(company_id, as_of_date): Promise<InvariantResult[]> {
        const { data, error } = await (client.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)
          ('verify_invariants', {
            p_company_id: company_id,
            p_as_of_date: as_of_date ?? new Date().toISOString().slice(0, 10),
          });
        assertNoError(error as Error | null, 'systemHealth.check');
        return (data as InvariantResult[]) ?? [];
      },
      async findMalformedJEs(company_id, as_of_date): Promise<import('./adapter').MalformedJE[]> {
        const { data, error } = await (client.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)
          ('find_malformed_jes', {
            p_company_id: company_id,
            p_as_of_date: as_of_date ?? new Date().toISOString().slice(0, 10),
          });
        assertNoError(error as Error | null, 'systemHealth.findMalformedJEs');
        return (data as import('./adapter').MalformedJE[]) ?? [];
      },
      async repairVendorBillJE(je_id): Promise<import('./adapter').RepairResult> {
        const { data, error } = await (client.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)
          ('repair_vendor_bill_je', { p_je_id: je_id });
        assertNoError(error as Error | null, 'systemHealth.repairVendorBillJE');
        return data as import('./adapter').RepairResult;
      },
      async findArMismatches(company_id, as_of_date): Promise<import('./adapter').ArMismatch[]> {
        const { data, error } = await (client.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)
          ('find_ar_mismatches', {
            p_company_id: company_id,
            p_as_of_date: as_of_date ?? new Date().toISOString().slice(0, 10),
          });
        assertNoError(error as Error | null, 'systemHealth.findArMismatches');
        return (data as import('./adapter').ArMismatch[]) ?? [];
      },
      async findStockMismatches(company_id, as_of_date): Promise<import('./adapter').StockMismatch[]> {
        const { data, error } = await (client.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)
          ('find_stock_mismatches', {
            p_company_id: company_id,
            p_as_of_date: as_of_date ?? new Date().toISOString().slice(0, 10),
          });
        assertNoError(error as Error | null, 'systemHealth.findStockMismatches');
        return (data as import('./adapter').StockMismatch[]) ?? [];
      },
    },

    // ── Phase 12.12: Bank Reconciliation ──────────────────────────────────────
    bankReconciliations: {
      async list(company_id, bank_account_id): Promise<import('./adapter').BankReconciliationRow[]> {
        // Use raw client cast since bank_reconciliations isn't in the
        // generated types yet (added in Phase 12.12 migration).
        const c = client as unknown as {
          from: (t: string) => {
            select: (c: string) => {
              eq: (k: string, v: unknown) => {
                eq: (k: string, v: unknown) => { order: (col: string, opts: { ascending: boolean }) => Promise<{ data: unknown; error: unknown }> };
                order: (col: string, opts: { ascending: boolean }) => Promise<{ data: unknown; error: unknown }>;
              };
            };
          };
        };
        const base = c.from('bank_reconciliations').select('*').eq('company_id', company_id);
        const q = bank_account_id ? base.eq('bank_account_id', bank_account_id) : base;
        const { data, error } = await q.order('statement_end_date', { ascending: false });
        assertNoError(error as Error | null, 'bankReconciliations.list');
        return (data as import('./adapter').BankReconciliationRow[]) ?? [];
      },

      async getById(id): Promise<import('./adapter').BankReconciliationRow | null> {
        const { data, error } = await (client.from as unknown as (t: string) => { select: (c: string) => { eq: (col: string, val: unknown) => { single: () => Promise<{ data: unknown; error: { code?: string } | null }> } } })('bank_reconciliations')
          .select('*').eq('id', id).single();
        if (error?.code === 'PGRST116') return null;
        assertNoError(error as Error | null, 'bankReconciliations.getById');
        return data as import('./adapter').BankReconciliationRow;
      },

      async listGlLines(company_id, bank_account_id, up_to_date, opts): Promise<import('./adapter').ReconGlLine[]> {
        // Read general_ledger joined to journal_entries for je_number +
        // source_type, filtered to the bank account's COA, dated <=
        // statement end. By default we exclude lines reconciled under
        // OTHER recons; lines reconciled under THIS recon (if editing)
        // are included so the user sees their existing matches.
        // The bank-account-to-COA lookup is done with a sub-select.
        const includeAll = opts?.include_all_reconciled === true;
        const reconId    = opts?.reconciliation_id ?? null;

        // Step 1: get bank's COA id.
        const { data: ba, error: baErr } = await (client.from as unknown as (t: string) => { select: (c: string) => { eq: (col: string, val: unknown) => { single: () => Promise<{ data: unknown; error: unknown }> } } })('bank_accounts')
          .select('coa_account_id').eq('id', bank_account_id).single();
        assertNoError(baErr as Error | null, 'bankReconciliations.listGlLines/bank lookup');
        const coa = (ba as { coa_account_id: string } | null)?.coa_account_id;
        if (!coa) throw new Error('Bank account has no GL account mapped');

        // Step 2: pull GL lines on that COA up to the statement date.
        const filters: Record<string, unknown> = {
          company_id,
          account_id: coa,
        };
        // We can't easily express "lte date" + optional "reconciliation_id IS NULL OR = X"
        // through the typed client. Use the raw any-cast pattern (same as other
        // dynamic queries elsewhere in this adapter).
        const rawClient = client as unknown as {
          from: (t: string) => {
            select: (c: string) => {
              match: (m: Record<string, unknown>) => {
                lte: (col: string, val: string) => {
                  order: (col: string, opts: { ascending: boolean }) => Promise<{ data: unknown; error: unknown }>;
                };
              };
            };
          };
        };
        // Phase 12.53 — DO NOT select `source_type` at the top level here.
        // That column lives on `journal_entries`, NOT on `general_ledger`,
        // so PostgREST 400's the entire query and the user sees no rows
        // (the "cannot find the data" symptom on the Bank Reconciliation
        // page). The nested `journal_entries(...source_type, source_id)`
        // is the correct source; the mapper below already prefers it.
        const { data, error } = await rawClient
          .from('general_ledger')
          .select(`
            id, date, debit, credit, description,
            related_doc_type, related_doc_id, reconciliation_id,
            journal_entries:journal_entry_id ( entry_number, source_type, source_id )
          `)
          .match(filters)
          .lte('date', up_to_date)
          .order('date', { ascending: true });
        assertNoError(error as Error | null, 'bankReconciliations.listGlLines/gl select');

        const rows = (data ?? []) as Array<{
          id: string; date: string; debit: number; credit: number;
          description: string | null;
          related_doc_type: string | null;
          related_doc_id: string | null;
          reconciliation_id: string | null;
          journal_entries: { entry_number: string; source_type: string; source_id: string | null } | null;
        }>;

        return rows
          .filter(r => {
            if (includeAll) return true;
            if (r.reconciliation_id === null) return true;
            if (reconId && r.reconciliation_id === reconId) return true;
            return false;
          })
          .map(r => ({
            id:                 r.id,
            date:               r.date,
            je_number:          r.journal_entries?.entry_number ?? '',
            // source_type / source_id come from the nested journal_entries
            // join only (they don't exist on general_ledger).
            source_type:        r.journal_entries?.source_type ?? '',
            source_id:          r.journal_entries?.source_id ?? null,
            related_doc_type:   r.related_doc_type,
            related_doc_id:     r.related_doc_id,
            description:        r.description,
            debit:              Number(r.debit),
            credit:             Number(r.credit),
            reconciliation_id:  r.reconciliation_id,
          }));
      },

      async save(input): Promise<import('./adapter').BankReconciliationRow> {
        const { data, error } = await (client.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)
          ('save_bank_reconciliation', {
            p_company_id:                input.company_id,
            p_bank_account_id:           input.bank_account_id,
            p_statement_end_date:        input.statement_end_date,
            p_statement_closing_balance: input.statement_closing_balance,
            p_gl_line_ids:               input.gl_line_ids,
            p_notes:                     input.notes ?? null,
            p_lock:                      input.lock ?? false,
          });
        assertNoError(error as Error | null, 'bankReconciliations.save');
        return data as import('./adapter').BankReconciliationRow;
      },

      async delete(id): Promise<void> {
        const { error } = await (client.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)
          ('delete_bank_reconciliation', { p_id: id });
        assertNoError(error as Error | null, 'bankReconciliations.delete');
      },

      async listReconciledPaymentIds(company_id): Promise<string[]> {
        // Pulls the set of payment IDs that have at least one
        // general_ledger line stamped with a reconciliation_id.
        // related_doc_type='payment' covers BOTH customer (inbound)
        // and vendor (outbound) payments since they share the
        // payments table and the confirm_* RPCs both write
        // related_doc_type='payment' on the bank-account GL line.
        const c = client as unknown as {
          from: (t: string) => {
            select: (c: string) => {
              eq: (k: string, v: unknown) => {
                eq: (k: string, v: unknown) => {
                  not: (k: string, op: string, v: unknown) => Promise<{ data: unknown; error: unknown }>;
                };
              };
            };
          };
        };
        const { data, error } = await c
          .from('general_ledger')
          .select('related_doc_id')
          .eq('company_id', company_id)
          .eq('related_doc_type', 'payment')
          .not('reconciliation_id', 'is', null);
        assertNoError(error as Error | null, 'bankReconciliations.listReconciledPaymentIds');
        const ids = ((data ?? []) as Array<{ related_doc_id: string | null }>)
          .map(r => r.related_doc_id)
          .filter((id): id is string => !!id);
        return Array.from(new Set(ids));
      },
    },

    // ── Phase 12.13: Admin / destructive operations ───────────────────────
    admin: {
      async resetCompanyData(company_id, confirmation): Promise<import('./adapter').ResetCompanyDataResult> {
        const { data, error } = await (client.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)
          ('reset_company_data', {
            company_id:   company_id,
            confirmation: confirmation,
          });
        assertNoError(error as Error | null, 'admin.resetCompanyData');
        return data as import('./adapter').ResetCompanyDataResult;
      },
    },

    // ── Phase 12.16: Salespeople master ───────────────────────────────────
    salespeople: {
      async list(company_id, opts) {
        const c = client as unknown as {
          from: (t: string) => {
            select: (cols: string) => {
              eq: (k: string, v: unknown) => {
                eq: (k: string, v: unknown) => { order: (col: string) => Promise<{ data: unknown; error: unknown }> };
                order: (col: string) => Promise<{ data: unknown; error: unknown }>;
              };
            };
          };
        };
        const base = c.from('salespeople').select('*').eq('company_id', company_id);
        const q = opts?.include_inactive ? base : base.eq('is_active', true);
        const { data, error } = await q.order('name');
        assertNoError(error as Error | null, 'salespeople.list');
        return (data as import('./adapter').SalespersonRow[]) ?? [];
      },
      async getById(id) {
        const { data, error } = await (client.from as unknown as (t: string) => { select: (c: string) => { eq: (k: string, v: unknown) => { single: () => Promise<{ data: unknown; error: { code?: string } | null }> } } })('salespeople')
          .select('*').eq('id', id).single();
        if (error?.code === 'PGRST116') return null;
        assertNoError(error as Error | null, 'salespeople.getById');
        return data as import('./adapter').SalespersonRow;
      },
      async create(row) {
        const { data, error } = await (client.from as unknown as (t: string) => { insert: (r: unknown) => { select: () => { single: () => Promise<{ data: unknown; error: unknown }> } } })('salespeople')
          .insert(row).select().single();
        assertNoError(error as Error | null, 'salespeople.create');
        return data as import('./adapter').SalespersonRow;
      },
      async update(id, row) {
        const { error } = await (client.from as unknown as (t: string) => { update: (r: unknown) => { eq: (k: string, v: unknown) => Promise<{ error: unknown }> } })('salespeople')
          .update(row).eq('id', id);
        assertNoError(error as Error | null, 'salespeople.update');
      },
      async deactivate(id) {
        const { error } = await (client.from as unknown as (t: string) => { update: (r: unknown) => { eq: (k: string, v: unknown) => Promise<{ error: unknown }> } })('salespeople')
          .update({ is_active: false }).eq('id', id);
        assertNoError(error as Error | null, 'salespeople.deactivate');
      },
      async activate(id) {
        const { error } = await (client.from as unknown as (t: string) => { update: (r: unknown) => { eq: (k: string, v: unknown) => Promise<{ error: unknown }> } })('salespeople')
          .update({ is_active: true }).eq('id', id);
        assertNoError(error as Error | null, 'salespeople.activate');
      },
    },

    // ── Phase 14.09 / 14.09b: Opening Balances ─────────────────────────────
    openingBalances: {
      async post(input) {
        const { data, error } = await (
          client.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
        )('post_opening_balance', {
          p_type:       input.type,
          p_contact_id: input.contact_id,
          p_doc_number: input.doc_number,
          p_date:       input.date,
          p_due_date:   input.due_date ?? null,
          p_amount:     input.amount,
          p_currency:   input.currency ?? 'AED',
          p_notes:      input.notes ?? null,
        });
        assertNoError(error as Error | null, 'openingBalances.post');
        return data as unknown as import('./adapter').OpeningBalanceResult;
      },
      async postGl(input) {
        // Phase 14.09b — direct GL opening; Dr/Cr any CoA account.
        const { data, error } = await (
          client.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
        )('post_gl_opening_balance', {
          p_account_id: input.account_id,
          p_direction:  input.direction,
          p_amount:     input.amount,
          p_date:       input.date,
          p_notes:      input.notes ?? null,
        });
        assertNoError(error as Error | null, 'openingBalances.postGl');
        return data as unknown as import('./adapter').GLOpeningBalanceResult;
      },
      async postBank(input) {
        // Phase 14.09c — bank-specific opening; resolves to bank's CoA +
        // updates bank_accounts.opening_balance for the recon report.
        const { data, error } = await (
          client.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
        )('post_bank_opening_balance', {
          p_bank_account_id: input.bank_account_id,
          p_direction:       input.direction,
          p_amount:          input.amount,
          p_date:            input.date,
          p_notes:           input.notes ?? null,
        });
        assertNoError(error as Error | null, 'openingBalances.postBank');
        return data as unknown as import('./adapter').BankOpeningBalanceResult;
      },
      async void(doc_id, doc_type, reason) {
        // Phase 14.09c — reverse the opening JE + mark source doc void.
        const { error } = await (
          client.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
        )('void_opening_balance', {
          p_doc_id:   doc_id,
          p_doc_type: doc_type,
          p_reason:   reason ?? null,
        });
        assertNoError(error as Error | null, 'openingBalances.void');
      },
      async edit(input) {
        // Phase 14.14n — atomic void + re-post under a single Postgres
        // transaction. Strips `kind` from the payload (it's a discriminant
        // for the frontend only; the RPC takes it as a separate parameter).
        const { kind, ...rest } = input.payload;
        const { data, error } = await (
          client.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
        )('edit_opening_balance', {
          p_doc_id:        input.doc_id,
          p_void_doc_type: input.void_doc_type,
          p_kind:          kind,
          p_payload:       rest,
        });
        assertNoError(error as Error | null, 'openingBalances.edit');
        return data as import('./adapter').EditOpeningBalanceResult;
      },
      async get3010Balance(company_id) {
        const { data, error } = await (
          client.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
        )('opening_balance_3010', { p_company_id: company_id });
        assertNoError(error as Error | null, 'openingBalances.get3010Balance');
        return Number(data ?? 0);
      },
      async getBankOpeningJE(bank_account_id) {
        // Phase 14.14p — targeted lookup by source_id so the bank-accounts
        // edit form can distinguish edit() vs postBank() without a full
        // listPosted() round-trip (avoids race conditions on slow connections).
        //
        // Two-step query: JE header first, then GL lines separately.
        // CRITICAL: must call client.from() as a method on `client` so `this`
        // stays bound. Extracting to a variable (const f = client.from; f(...))
        // detaches `this` and supabase-js throws "reading 'rest'".

        // Step 1: find the active (non-voided, non-reversal) opening JE for this bank account.
        // BOTH conditions required — matches the invariant in post_bank_opening_balance (14.14r):
        //   reversed_by_id IS NULL  → JE has NOT been voided
        //   reversal_of_id  IS NULL → JE IS NOT itself a void/reversal entry
        // reverse_journal_entry() copies source_type + source_id onto the void JE, so without
        // the second filter .maybeSingle() can see both the void entry and the active repost
        // and throw "multiple rows returned" → TanStack catches → existingBankOb=undefined → "Post" shown.
        const { data: jeData, error: jeError } = await (client.from('journal_entries') as any)
          .select('id, entry_number, date')
          .eq('source_type', 'opening_bank')
          .eq('source_id', bank_account_id)
          .is('reversed_by_id', null)
          .is('reversal_of_id', null)
          .maybeSingle();
        assertNoError(jeError as Error | null, 'openingBalances.getBankOpeningJE/je');
        if (!jeData) return null;

        const je = jeData as { id: string; entry_number: string; date: string };

        // Step 2: fetch the GL lines for that JE separately
        const { data: glData, error: glError } = await (client.from('general_ledger') as any)
          .select('account_code, debit, credit')
          .eq('journal_entry_id', je.id);
        assertNoError(glError as Error | null, 'openingBalances.getBankOpeningJE/lines');

        const lines = (glData ?? []) as Array<{ account_code: string; debit: number; credit: number }>;
        // The non-3010 line is the bank-account side (debit for positive OB).
        const target = lines.find((l) => l.account_code !== '3010');
        if (!target) return null;
        const isDebit = Number(target.debit ?? 0) > 0;
        const amount  = isDebit ? Number(target.debit) : Number(target.credit);
        return { doc_id: je.id, doc_number: je.entry_number, date: je.date, amount };
      },

      async listPosted(company_id) {
        // Union the three sources (opening invoices, opening bills, opening
        // payments) and enrich with the contact name. Each table carries
        // is_opening so the filter is cheap thanks to the partial indexes
        // from the 14.09 migration.
        // CRITICAL: call client.from() as a method (not detached to a variable)
        // so `this` stays bound inside supabase-js. Extracting to a local
        // const loses the binding and causes "Cannot read properties of undefined
        // (reading 'rest')" — see getDashboardCards comment for full explanation.
        const [invR, billR, payR] = await Promise.all([
          (client.from('invoices') as any)
            .select('id, invoice_number, contact_id, contacts:contact_id (name), date, due_date, total_amount, currency, status, created_at, is_opening')
            .eq('company_id', company_id).eq('is_opening', true),
          (client.from('vendor_bills') as any)
            .select('id, bill_number, supplier_id, contacts:supplier_id (name), date, due_date, total_amount, currency, status, created_at, is_opening')
            .eq('company_id', company_id).eq('is_opening', true),
          (client.from('payments') as any)
            .select('id, payment_number, contact_id, contacts:contact_id (name), date, amount, currency, status, created_at, type, is_opening')
            .eq('company_id', company_id).eq('is_opening', true),
        ]);
        assertNoError(invR.error  as Error | null, 'openingBalances.listPosted/invoices');
        assertNoError(billR.error as Error | null, 'openingBalances.listPosted/bills');
        assertNoError(payR.error  as Error | null, 'openingBalances.listPosted/payments');

        type RawInv  = { id: string; invoice_number: string; contact_id: string;
                         contacts?: { name: string } | null; date: string; due_date: string | null;
                         total_amount: number; currency: string; status: string; created_at: string };
        type RawBill = { id: string; bill_number: string; supplier_id: string;
                         contacts?: { name: string } | null; date: string; due_date: string | null;
                         total_amount: number; currency: string; status: string; created_at: string };
        type RawPay  = { id: string; payment_number: string; contact_id: string;
                         contacts?: { name: string } | null; date: string; amount: number;
                         currency: string; status: string; created_at: string; type: 'inbound' | 'outbound' };
        const out: import('./adapter').OpeningBalanceListed[] = [];
        // Phase 14.09c — listPosted now hides voided rows from the
        // wizard by default (status === 'void' means the operator has
        // already reversed it).
        for (const r of (invR.data as RawInv[] ?? [])) {
          if (r.status === 'void') continue;
          out.push({
            type: 'ar_owed', doc_id: r.id, void_doc_type: 'invoice',
            doc_number: r.invoice_number,
            contact_id: r.contact_id, contact_name: r.contacts?.name ?? '—',
            date: r.date, due_date: r.due_date,
            amount: Number(r.total_amount), currency: r.currency,
            outstanding: Number(r.total_amount),
            status: r.status, posted_at: r.created_at,
          });
        }
        for (const r of (billR.data as RawBill[] ?? [])) {
          if (r.status === 'void') continue;
          out.push({
            type: 'ap_owed', doc_id: r.id, void_doc_type: 'vendor_bill',
            doc_number: r.bill_number,
            contact_id: r.supplier_id, contact_name: r.contacts?.name ?? '—',
            date: r.date, due_date: r.due_date,
            amount: Number(r.total_amount), currency: r.currency,
            outstanding: Number(r.total_amount),
            status: r.status, posted_at: r.created_at,
          });
        }
        for (const r of (payR.data as RawPay[] ?? [])) {
          if (r.status === 'void') continue;
          out.push({
            type: r.type === 'outbound' ? 'vendor_credit' : 'customer_credit',
            doc_id: r.id, void_doc_type: 'payment',
            doc_number: r.payment_number,
            contact_id: r.contact_id, contact_name: r.contacts?.name ?? '—',
            date: r.date, due_date: null,
            amount: Number(r.amount), currency: r.currency,
            outstanding: Number(r.amount),
            status: r.status, posted_at: r.created_at,
          });
        }

        // Phase 14.09b + 14.09c — pure-GL + bank-specific openings.
        // Two-step query: JE headers first, then GL lines separately.
        // Avoids the PostgREST embedded-join syntax `table (cols)` which
        // silently returns null lines. reversed_by_id IS NULL filters voided JEs.
        // CRITICAL: client.from() called as a method (not extracted to a variable)
        // so `this` remains bound — see getDashboardCards comment.
        const jeQR = await (client.from('journal_entries') as any)
          .select('id, entry_number, date, description, source_type, source_id, created_at')
          .eq('company_id', company_id)
          .in('source_type', ['opening_gl', 'opening_bank'])
          .is('reversed_by_id', null)
          .is('reversal_of_id', null);  // exclude void/reversal JEs (they copy source_type+source_id)
        assertNoError(jeQR.error as Error | null, 'openingBalances.listPosted/gl+bank/je');

        type RawOpenJE = {
          id: string; entry_number: string; date: string; description: string;
          source_type: 'opening_gl' | 'opening_bank';
          source_id: string | null; created_at: string;
        };
        const openingJEs: RawOpenJE[] = jeQR.data ?? [];

        if (openingJEs.length > 0) {
          const jeIds = openingJEs.map((j: RawOpenJE) => j.id);

          // Fetch GL lines for those JE IDs separately (avoids embedded join)
          const glQR = await (client.from('general_ledger') as any)
            .select('journal_entry_id, account_id, account_code, debit, credit')
            .in('journal_entry_id', jeIds);
          assertNoError(glQR.error as Error | null, 'openingBalances.listPosted/gl+bank/lines');

          type RawGLLine = {
            journal_entry_id: string; account_id: string;
            account_code: string; debit: number; credit: number;
          };
          const glByJeId: Record<string, RawGLLine[]> = {};
          for (const gl of (glQR.data ?? []) as RawGLLine[]) {
            if (!glByJeId[gl.journal_entry_id]) glByJeId[gl.journal_entry_id] = [];
            glByJeId[gl.journal_entry_id].push(gl);
          }

          // Bank names for bank-type openings
          const bankIds = openingJEs
            .filter((j: RawOpenJE) => j.source_type === 'opening_bank' && j.source_id)
            .map((j: RawOpenJE) => j.source_id as string);
          const bankNameById: Record<string, string> = {};
          if (bankIds.length > 0) {
            const bankR = await (client.from('bank_accounts') as any).select('id, name').in('id', bankIds);
            for (const b of (bankR.data ?? []) as Array<{ id: string; name: string }>) {
              bankNameById[b.id] = b.name;
            }
          }

          for (const je of openingJEs) {
            const lines = glByJeId[je.id] ?? [];
            const target = lines.find((l: RawGLLine) => l.account_code !== '3010');
            if (!target) continue;
            const isDebit = Number(target.debit ?? 0) > 0;
            const amount  = isDebit ? Number(target.debit) : Number(target.credit);

            if (je.source_type === 'opening_bank') {
              const bankName = je.source_id ? bankNameById[je.source_id] ?? '' : '';
              out.push({
                type: isDebit ? 'bank_debit' : 'bank_credit',
                doc_id: je.id, void_doc_type: 'opening_bank',
                doc_number: je.entry_number,
                contact_id: '', contact_name: '',
                account_code: target.account_code,
                account_name: bankName || target.account_code,
                date: je.date, due_date: null,
                amount, currency: 'AED',
                outstanding: amount,
                status: 'confirmed',
                posted_at: je.created_at,
              });
            } else {
              // opening_gl
              out.push({
                type: isDebit ? 'gl_debit' : 'gl_credit',
                doc_id: je.id, void_doc_type: 'opening_gl',
                doc_number: je.entry_number,
                contact_id: '', contact_name: '',
                account_code: target.account_code,
                account_name: (je.description ?? '').replace(/^Opening balance — \d+ /, '') || target.account_code,
                date: je.date, due_date: null,
                amount, currency: 'AED',
                outstanding: amount,
                status: 'confirmed',
                posted_at: je.created_at,
              });
            }
          }
        }

        return out.sort((a, b) => (b.posted_at ?? '').localeCompare(a.posted_at ?? ''));
      },
    },

    // ── Payroll P1 (owner override 2026-06-13) ───────────────────────────
    employees: {
      async list(company_id, opts) {
        let q = client.from('employees').select('*')
          .eq('company_id', company_id)
          .order('code', { ascending: true });
        if (!opts?.includeInactive) q = q.eq('is_active', true);
        const { data, error } = await q;
        assertNoError(error, 'employees.list');
        return data ?? [];
      },
      async create(row) {
        const { data, error } = await client.from('employees').insert(row).select().single();
        assertNoError(error, 'employees.create');
        return data!;
      },
      async update(id, row) {
        const { error } = await client.from('employees')
          .update({ ...row, updated_at: new Date().toISOString() })
          .eq('id', id);
        assertNoError(error, 'employees.update');
      },
      async getNextCode(company_id) {
        const { data, error } = await client.from('employees')
          .select('code').eq('company_id', company_id)
          .order('code', { ascending: false }).limit(1);
        assertNoError(error, 'employees.getNextCode');
        const last = data?.[0]?.code ?? 'EMP-0000';
        const n = parseInt(String(last).replace(/\D/g, ''), 10) || 0;
        return `EMP-${String(n + 1).padStart(4, '0')}`;
      },
    },
    payroll: {
      async listRuns(company_id) {
        const { data, error } = await client.from('payroll_runs').select('*')
          .eq('company_id', company_id)
          .order('period_year', { ascending: false })
          .order('period_month', { ascending: false });
        assertNoError(error, 'payroll.listRuns');
        return data ?? [];
      },
      async getRun(id) {
        const { data, error } = await client.from('payroll_runs').select('*').eq('id', id).single();
        if (error?.code === 'PGRST116') return null;
        assertNoError(error, 'payroll.getRun');
        return data;
      },
      async getItems(run_id) {
        const { data, error } = await client.from('payroll_run_items').select('*')
          .eq('run_id', run_id).order('created_at');
        assertNoError(error, 'payroll.getItems');
        return data ?? [];
      },
      async createRun(run, items) {
        const { data, error } = await client.from('payroll_runs').insert(run).select().single();
        assertNoError(error, 'payroll.createRun');
        if (items.length > 0) {
          const withRun = items.map(i => ({ ...i, run_id: data!.id }));
          const { error: e2 } = await client.from('payroll_run_items').insert(withRun);
          assertNoError(e2, 'payroll.createRun.items');
        }
        return data!;
      },
      async updateRun(id, items, notes) {
        // Guard client-side; the RPCs guard server-side too.
        const { data: run } = await client.from('payroll_runs').select('status, company_id').eq('id', id).single();
        if (run?.status !== 'draft') throw new Error('Only draft payroll runs can be edited');
        const { error: eDel } = await client.from('payroll_run_items').delete().eq('run_id', id);
        assertNoError(eDel, 'payroll.updateRun.clear');
        if (items.length > 0) {
          const withRun = items.map(i => ({ ...i, run_id: id }));
          const { error: eIns } = await client.from('payroll_run_items').insert(withRun);
          assertNoError(eIns, 'payroll.updateRun.items');
        }
        const { error: eUpd } = await client.from('payroll_runs')
          .update({ notes: notes ?? null, updated_at: new Date().toISOString() })
          .eq('id', id);
        assertNoError(eUpd, 'payroll.updateRun');
      },
      async removeRun(id) {
        const { data: run } = await client.from('payroll_runs').select('status').eq('id', id).single();
        if (run?.status !== 'draft') throw new Error('Only draft payroll runs can be deleted');
        const { error } = await client.from('payroll_runs').delete().eq('id', id);
        assertNoError(error, 'payroll.removeRun');
      },
      async confirmRun(run_id) {
        const { data, error } = await client.rpc('confirm_payroll_run' as never, { p_run_id: run_id } as never);
        assertNoError(error, 'payroll.confirmRun');
        return data as unknown as import('./adapter').PayrollConfirmResult;
      },
      async payRun(run_id, bank_account_id, date) {
        const { data, error } = await client.rpc('pay_payroll_run' as never, {
          p_run_id: run_id, p_bank_account_id: bank_account_id, p_date: date ?? null,
        } as never);
        assertNoError(error, 'payroll.payRun');
        return data as unknown as import('./adapter').PayrollPayResult;
      },
      async getNextRunNumber(company_id) {
        const { data, error } = await client.rpc('get_next_document_number', {
          p_company_id: company_id, p_prefix: 'PAY',
        });
        assertNoError(error, 'payroll.getNextRunNumber');
        return data as string;
      },
      async settleGratuity(employee_id, amount, bank_account_id, opts) {
        const { data, error } = await client.rpc('settle_gratuity' as never, {
          p_employee_id: employee_id, p_amount: amount, p_bank_account_id: bank_account_id,
          p_date: opts?.date ?? null, p_deactivate: opts?.deactivate ?? true,
        } as never);
        assertNoError(error, 'payroll.settleGratuity');
        return data as unknown as { je_id: string; entry_number: string };
      },
      async listLeaveSalary(company_id) {
        const { data, error } = await client.from('leave_salary_payments').select('*')
          .eq('company_id', company_id).order('date', { ascending: false });
        assertNoError(error, 'payroll.listLeaveSalary');
        return data ?? [];
      },
      async createLeaveSalary(row) {
        const { data, error } = await client.from('leave_salary_payments').insert(row).select().single();
        assertNoError(error, 'payroll.createLeaveSalary');
        return data!;
      },
      async payLeaveSalary(id) {
        const { data, error } = await client.rpc('pay_leave_salary' as never, { p_id: id } as never);
        assertNoError(error, 'payroll.payLeaveSalary');
        return data as unknown as { je_id: string; entry_number: string };
      },
      async removeLeaveSalary(id) {
        const { data: row } = await client.from('leave_salary_payments').select('status').eq('id', id).single();
        if (row?.status === 'paid') throw new Error('Paid leave salary cannot be deleted');
        const { error } = await client.from('leave_salary_payments').delete().eq('id', id);
        assertNoError(error, 'payroll.removeLeaveSalary');
      },
    },

    // ── Document numbering settings (2026-06-13) ─────────────────────────
    documentSequences: {
      async list(company_id) {
        const { data, error } = await client.from('document_sequences').select('*')
          .eq('company_id', company_id).order('prefix');
        assertNoError(error, 'documentSequences.list');
        return data ?? [];
      },
      async save(company_id, prefix, patch) {
        const { error } = await client.from('document_sequences').upsert({
          company_id, prefix,
          format: patch.format,
          pad_zeros: patch.pad_zeros,
          reset_yearly: patch.reset_yearly,
          current_value: patch.current_value,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'company_id,prefix' });
        assertNoError(error, 'documentSequences.save');
      },
    },
  };
}
