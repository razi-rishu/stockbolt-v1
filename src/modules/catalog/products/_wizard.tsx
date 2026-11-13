/**
 * ProductWizard — 5-step new-item flow (Phase 12.28 / re-styled Phase 12.29).
 *
 * Visual styling adopted from the user-provided InventoryItemForm.jsx
 * sample (inline-CSS look, indigo accent, 220px step nav, light-grey
 * panel headers, top gradient progress bar). Data layer wires into
 * StockBolt's existing adapter (products / suppliers / units / coa /
 * warehouses / opening-stock RPC).
 *
 * Steps:
 *   1. Basic info — type, names, SKU, brand, category, unit, OE, excise
 *   2. Pricing — selling price, tax, quality tier, purchase account,
 *                description, live margin/markup calculator
 *   3. Identifiers — barcode, serial tracking, HSN, country of origin
 *   4. Supplier — primary supplier + item code + lead time + MOQ + payment terms
 *   5. Stock & location — opening stock + rate (goods only), min/max,
 *                          warehouse + aisle + bin, active toggle
 *
 * On Save:
 *   • INSERT product (+ supplier_code if set)
 *   • If type='goods' AND opening_stock > 0 → post_opening_stock RPC
 *     (writes stock_ledger 'opening_balance' row + Dr 1300 / Cr 3200 JE)
 *   • Navigate to /products/<id> in read-only view.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Package, Wallet, Barcode, Truck, Warehouse as WarehouseIcon, Tag, ShoppingCart,
  Landmark, ClipboardList, PackagePlus, CircleCheck, Plus, X, Check, Eye, AlertTriangle,
  ArrowLeft, ArrowRight, Wrench,
} from 'lucide-react';
import '@/styles/stockbolt-ocean-teal.css';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { DuplicateWarning } from '@/ui/duplicate-warning';
import { findProductDuplicates } from '@/lib/duplicate-check';
import { useCompanyCurrency, useCompanyCountry } from '@/hooks/use-company-currency';
import { defaultTaxRate } from '@/lib/locale';
import { TAX_TREATMENTS } from '@/lib/einvoice-metadata';
import type {
  BrandRow, CategoryRow, UnitRow, CoaRow,
  ContactRow, WarehouseRow,
} from '@/data/adapter';
import {
  Field, Input, Select, Textarea, PrefixInput, Grid,
} from '@/ui/primitives';
import { labelStyle } from '@/ui/theme';

// Ocean Teal (UI v1.1) — a local section card in place of the shared grey
// Panel, so the wizard reads like the rest of the Ocean screens.
function Panel({ icon, title, children }: { icon?: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="sb-card sb-pw-panel">
      <h3 className="sb-pw-panel-head">{icon && <span className="sb-pw-panel-ico" aria-hidden="true">{icon}</span>}{title}</h3>
      <div className="sb-pw-panel-body">{children}</div>
    </section>
  );
}
import { ContactQuickCreate } from '@/components/quick-create/contact-quick-create';
import { useInnerNav } from '@/hooks/use-inner-nav';
import { useArabicEnabled } from '@/hooks/use-arabic-enabled';

// ── Step metadata ───────────────────────────────────────────────────────
const STEPS = [
  { id: 1, key: 'step_basic',      Icon: Package },
  { id: 2, key: 'step_pricing',    Icon: Wallet },
  { id: 3, key: 'step_identifiers', Icon: Barcode },
  { id: 4, key: 'step_supplier',   Icon: Truck },
  { id: 5, key: 'step_stock',      Icon: WarehouseIcon },
] as const;

// ── Form state ──────────────────────────────────────────────────────────
interface WizardForm {
  // Step 1
  type:                'goods' | 'service';
  name:                string;
  name_ar:             string;
  sku:                 string;
  brand_id:            string;
  category_id:         string;
  unit_id:             string;
  oe_number:           string;
  replacement_numbers: string;
  is_excise:           boolean;
  // Step 2
  selling_price:       string;
  tax_category:        'standard' | 'zero_rated' | 'exempt';
  default_tax_treatment: string;   // Phase 58 (AC-4A) — e-invoice supply treatment
  quality_tier:        '' | 'genuine' | 'oem' | 'premium' | 'economy';
  description:         string;
  purchase_account_id: string;
  // Step 3
  barcode:             string;
  requires_serial:     boolean;
  hsn_code:            string;
  country_of_origin:   string;
  // Step 4
  supplier_id:         string;
  supplier_sku:        string;
  lead_time_days:      string;
  min_order_qty:       string;
  payment_terms_days:  string;
  // Step 5
  opening_stock:       string;
  opening_stock_rate:  string;
  min_stock_level:     string;
  max_stock_level:     string;
  warehouse_id:        string;
  default_aisle:       string;
  default_bin:         string;
  is_active:           boolean;
}

const initialForm: WizardForm = {
  type: 'goods',
  name: '', name_ar: '', sku: '',
  brand_id: '', category_id: '', unit_id: '',
  oe_number: '', replacement_numbers: '', is_excise: false,
  selling_price: '', tax_category: 'standard', default_tax_treatment: '', quality_tier: '',
  description: '', purchase_account_id: '',
  barcode: '', requires_serial: false,
  hsn_code: '', country_of_origin: '',
  supplier_id: '', supplier_sku: '',
  lead_time_days: '', min_order_qty: '', payment_terms_days: '',
  opening_stock: '', opening_stock_rate: '',
  min_stock_level: '0', max_stock_level: '',
  warehouse_id: '', default_aisle: '', default_bin: '',
  is_active: true,
};

// ── Main wizard ─────────────────────────────────────────────────────────
// (Form primitives moved to src/ui/primitives.tsx — Phase 12.30.)

export function ProductWizard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // The step rail is a side menu of its own: the main sidebar steps aside.
  useInnerNav();
  const { company_id } = useAuthStore();
  const companyCurrency = useCompanyCurrency();   // Issue 1 — localize money to tenant currency

  const [step, setStep]           = useState(1);
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const [form, setForm]           = useState<WizardForm>(initialForm);
  const [showReview, setShowReview] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  // Quick-create overlay state: which master to create, or '' for none
  const [openQcFor, setOpenQcFor] = useState<'' | 'brand' | 'unit' | 'category' | 'supplier' | 'warehouse'>('');
  const closeQC = () => setOpenQcFor('');

  const { data: brands     = [] } = useQuery<BrandRow[]>(    { queryKey: ['brands',     company_id], queryFn: () => getAdapter().brands.list(company_id!),     enabled: !!company_id });
  const { data: categories = [] } = useQuery<CategoryRow[]>( { queryKey: ['categories', company_id], queryFn: () => getAdapter().categories.list(company_id!), enabled: !!company_id });
  const { data: units      = [] } = useQuery<UnitRow[]>(     { queryKey: ['units',      company_id], queryFn: () => getAdapter().units.list(company_id!),      enabled: !!company_id });
  const { data: coa        = [] } = useQuery<CoaRow[]>(      { queryKey: ['coa',        company_id], queryFn: () => getAdapter().coa.list(company_id!),        enabled: !!company_id });
  const { data: suppliers  = [] } = useQuery<ContactRow[]>(  { queryKey: ['contacts',   company_id, 'supplier'], queryFn: () => getAdapter().contacts.list(company_id!, 'supplier'), enabled: !!company_id });
  const { data: warehouses = [] } = useQuery<WarehouseRow[]>({ queryKey: ['warehouses', company_id], queryFn: () => getAdapter().warehouses.list(company_id!), enabled: !!company_id });

  // The quick-add path is where a duplicate is most likely to be born: you
  // are mid-invoice, the part is not in the catalogue, you type it in. Same
  // check as the full product form, same component.
  const { data: productIdentities = [] } = useQuery({
    queryKey: ['productIdentities', company_id],
    queryFn:  () => getAdapter().products.listIdentities(company_id!),
    enabled:  !!company_id,
  });
  const duplicateHits = findProductDuplicates(productIdentities, {
    sku: form.sku, oe_number: form.oe_number, barcode: form.barcode,
  });

  function set<K extends keyof WizardForm>(k: K, v: WizardForm[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function validateStep(s: number): string | null {
    if (s === 1) {
      if (!form.name.trim()) return t('pwOcean.err_name');
      if (!form.sku.trim())  return t('pwOcean.err_sku');
      if (!form.brand_id)    return t('pwOcean.err_brand');
    }
    if (s === 2) {
      if (!form.selling_price) return t('pwOcean.err_price');
      if (parseFloat(form.selling_price) < 0) return t('pwOcean.err_price_neg');
    }
    if (s === 5 && form.type === 'goods') {
      const qty = parseFloat(form.opening_stock) || 0;
      if (qty > 0 && !form.warehouse_id) return t('pwOcean.err_wh');
      if (qty > 0 && !form.opening_stock_rate) return t('pwOcean.err_rate');
    }
    return null;
  }

  function goNext() {
    const err = validateStep(step);
    if (err) { setError(err); return; }
    setError(null);
    if (step < 5) {
      setCompleted((c) => new Set([...c, step]));
      setStep((s) => s + 1);
    } else {
      setShowReview(true);
    }
  }

  function goPrev() {
    setError(null);
    setStep((s) => Math.max(1, s - 1));
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const sellingPrice = parseFloat(form.selling_price) || 0;
      const minStock     = parseFloat(form.min_stock_level) || 0;
      const maxStock     = parseFloat(form.max_stock_level);
      const openingQty   = parseFloat(form.opening_stock) || 0;
      const openingRate  = parseFloat(form.opening_stock_rate) || 0;

      const productRow = {
        company_id: company_id!,
        sku: form.sku.trim(),
        name: form.name.trim(),
        name_ar: form.name_ar.trim() || null,
        description: form.description.trim() || null,
        description_ar: null,
        oe_number: form.oe_number.trim() || null,
        // Comma-separated cross-reference numbers → TEXT[] (matches the
        // product Edit form). Trims blanks; null when none entered.
        replacement_numbers: (() => {
          const arr = form.replacement_numbers.split(',').map(s => s.trim()).filter(Boolean);
          return arr.length ? arr : null;
        })(),
        brand_id: form.brand_id || null,
        category_id: form.category_id || null,
        unit_id: form.unit_id || null,
        purchase_account_id: form.purchase_account_id || null,
        quality_tier: form.quality_tier ? (form.quality_tier as 'genuine' | 'oem' | 'premium' | 'economy') : null,
        selling_price: sellingPrice,
        tax_category: form.tax_category,
        default_tax_treatment: form.default_tax_treatment || null,
        min_stock_level: minStock,
        max_stock_level: Number.isFinite(maxStock) ? maxStock : null,
        requires_serial: form.requires_serial,
        is_active: form.is_active,
        barcode: form.barcode.trim() || null,
        image_urls: null,
        weight_kg: null,
        type: form.type,
        hsn_code: form.hsn_code.trim() || null,
        country_of_origin: form.country_of_origin.trim() || null,
        is_excise: form.is_excise,
        default_aisle: form.default_aisle.trim() || null,
        default_bin: form.default_bin.trim() || null,
      };

      const created = await getAdapter().products.create(productRow);

      if (form.supplier_id && form.supplier_sku.trim()) {
        await getAdapter().products.upsertSupplierCode({
          company_id:         company_id!,
          product_id:         created.id,
          supplier_id:        form.supplier_id,
          supplier_sku:       form.supplier_sku.trim(),
          lead_time_days:     form.lead_time_days     ? parseInt(form.lead_time_days, 10)     : null,
          min_order_qty:      form.min_order_qty      ? parseFloat(form.min_order_qty)        : null,
          payment_terms_days: form.payment_terms_days ? parseInt(form.payment_terms_days, 10) : null,
        });
      }

      if (form.type === 'goods' && openingQty > 0 && form.warehouse_id) {
        await getAdapter().stockLedger.postOpeningStock({
          product_id:   created.id,
          warehouse_id: form.warehouse_id,
          quantity:     openingQty,
          unit_cost:    openingRate,
        });
      }

      return created.id;
    },
    onSuccess: (newId) => { setShowReview(false); navigate(`/products/${newId}`); },
    onError: (e: Error) => { setShowReview(false); setError(e.message); },
  });

  const progress = (step / 5) * 100;

  return (
    // Ocean Teal (UI v1.1): look only — same five steps, validation, quick
    // adds, review and save (product + supplier code + opening stock).
    <div className="sb-ocean sb-pw" data-testid="product-wizard-ocean">
      {/* ── Quick-create modals ── */}
      {openQcFor === 'brand' && (
        <BrandQC
          companyId={company_id!}
          onClose={closeQC}
          onCreated={(id) => { set('brand_id',    id); closeQC(); }}
        />
      )}
      {openQcFor === 'unit' && (
        <UnitQC
          companyId={company_id!}
          onClose={closeQC}
          onCreated={(id) => { set('unit_id',     id); closeQC(); }}
        />
      )}
      {openQcFor === 'category' && (
        <CategoryQC
          companyId={company_id!}
          categories={categories}
          onClose={closeQC}
          onCreated={(id) => { set('category_id', id); closeQC(); }}
        />
      )}
      {openQcFor === 'supplier' && (
        <ContactQuickCreate
          open
          type="supplier"
          onClose={closeQC}
          onCreated={(id) => { set('supplier_id', id); closeQC(); }}
        />
      )}
      {openQcFor === 'warehouse' && (
        <WarehouseQC
          companyId={company_id!}
          onClose={closeQC}
          onCreated={(id) => { set('warehouse_id', id); closeQC(); }}
        />
      )}

      {showReview && (
        <ReviewModal
          form={form}
          currency={companyCurrency}
          brands={brands}
          suppliers={suppliers}
          warehouses={warehouses}
          onClose={() => setShowReview(false)}
          onConfirm={() => saveMutation.mutate()}
          saving={saveMutation.isPending}
        />
      )}

      {/* Top progress bar */}
      <div className="sb-pw-progress" aria-hidden="true"><i style={{ width: `${progress}%` }} /></div>

      <div className="sb-pw-layout">
        {/* Step nav — a rail on desktop, a scrollable strip on phones */}
        <aside className="sb-card sb-pw-rail">
          <div className="sb-pw-rail-head">
            <div className="sb-pw-rail-kicker">{t('pwOcean.new_item')}</div>
            <div className="sb-pw-rail-name">{form.name || t('pwOcean.untitled')}</div>
          </div>
          <div className="sb-pw-steps" role="list">

          {STEPS.map((s) => {
            const isActive = s.id === step;
            const isDone   = completed.has(s.id);
            const clickable = isDone || s.id <= step;
            return (
              <button
                type="button"
                key={s.id}
                role="listitem"
                onClick={() => clickable && setStep(s.id)}
                disabled={!clickable}
                aria-current={isActive ? 'step' : undefined}
                className={`sb-pw-step ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}
              >
                <span className="sb-pw-step-dot">{isDone ? <Check size={14} aria-hidden="true" /> : s.id}</span>
                <span className="sb-pw-step-label">{t(`pwOcean.${s.key}`)}</span>
              </button>
            );
          })}
          </div>

          <div className="sb-pw-rail-foot">
            <div className="sb-pw-rail-count">{t('pwOcean.step_of', { step, total: 5 })}</div>
            <div className="sb-pw-minibar"><i style={{ width: `${progress}%` }} /></div>
          </div>
        </aside>

        {/* Main content */}
        <div className="sb-pw-main">
          {/* Header */}
          <div className="sb-card sb-pw-head">
            <div style={{ minWidth: 0 }}>
              <div className="sb-pw-crumb">
                <button type="button" onClick={() => navigate('/products')}>{t('nav.inventory')}</button>
                <span aria-hidden="true">›</span>
                <button type="button" onClick={() => navigate('/products')}>{t('products.title')}</button>
                <span aria-hidden="true">›</span>
                <span>{t('pwOcean.new_item')}</span>
              </div>
              <h1 className="sb-pw-title">
                {(() => { const I = STEPS[step - 1].Icon; return <I size={20} aria-hidden="true" />; })()}
                {t(`pwOcean.${STEPS[step - 1].key}`)}
              </h1>
            </div>
            <div className="sb-pw-head-actions">
              <span className="sb-pill sb-pill-warn" style={{ marginTop: 0 }}>{t('docStatus.draft')}</span>
              <button type="button" className="sb-btn-ghost sb-pw-btn" onClick={() => setShowReview(true)}>
                <Eye size={15} aria-hidden="true" /> {t('pwOcean.preview')}
              </button>
            </div>
          </div>

          {/* Step body */}
          <div className="sb-pw-body">
            {/* Shown on every step, not just the one with the SKU box: the
                identifiers are entered on step 1 and 3, and a warning you
                have already scrolled past is a warning you did not get. */}
            {duplicateHits.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <DuplicateWarning hits={duplicateHits} docType="product" />
              </div>
            )}
            {step === 1 && <Step1
              form={form} set={set}
              brands={brands} categories={categories} units={units}
              openBrandQC={() => setOpenQcFor('brand')}
              openUnitQC={() => setOpenQcFor('unit')}
              openCategoryQC={() => setOpenQcFor('category')}
            />}
            {step === 2 && <Step2 form={form} set={set} coa={coa} />}
            {step === 3 && <Step3 form={form} set={set} />}
            {step === 4 && <Step4
              form={form} set={set} suppliers={suppliers}
              openSupplierQC={() => setOpenQcFor('supplier')}
            />}
            {step === 5 && <Step5
              form={form} set={set} warehouses={warehouses}
              openWarehouseQC={() => setOpenQcFor('warehouse')}
            />}

            {error && <p className="sb-alert sb-alert-danger" role="alert" style={{ marginTop: 14 }}>{error}</p>}
          </div>

          {/* Footer */}
          <div className="sb-card sb-pw-foot">
            <button type="button" className="sb-btn-ghost sb-pw-btn" onClick={goPrev} disabled={step === 1}>
              <ArrowLeft size={15} className="sb-pw-flip" aria-hidden="true" /> {t('pwOcean.back')}
            </button>
            <div className="sb-pw-foot-actions">
              <button type="button" className="sb-btn-ghost sb-pw-btn" onClick={() => navigate('/products')}>{t('common.cancel')}</button>
              <button type="button" className="sb-primary-btn sb-btn-inline sb-pw-next" onClick={goNext} disabled={!!validateStep(step)}>
                {step === 5 ? t('pwOcean.review_save') : t('pwOcean.next', { step: t(`pwOcean.${STEPS[step].key}`) })}
                <ArrowRight size={16} className="sb-pw-flip" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Step 1 ──────────────────────────────────────────────────────────────
function Step1({
  form, set, brands, categories, units,
  openBrandQC, openUnitQC, openCategoryQC,
}: {
  form: WizardForm;
  set: <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => void;
  brands: BrandRow[];
  categories: CategoryRow[];
  units: UnitRow[];
  openBrandQC: () => void;
  openUnitQC: () => void;
  openCategoryQC: () => void;
}) {
  const { t } = useTranslation();
  const arabicOn = useArabicEnabled();   // India companies: English only
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Panel icon={<Tag size={17} />} title={t('pwOcean.sec_identity')}>
        <div>
          <label style={labelStyle}>{t('pwOcean.type')}</label>
          <div className="sb-pw-seg" role="group" aria-label={t('pwOcean.type')}>
            {(['goods', 'service'] as const).map((ty) => (
              <button
                key={ty}
                type="button"
                aria-pressed={form.type === ty}
                className={form.type === ty ? 'active' : ''}
                onClick={() => set('type', ty)}
              >
                {ty === 'goods' ? <Package size={15} aria-hidden="true" /> : <Wrench size={15} aria-hidden="true" />}
                {ty === 'goods' ? t('products.type_goods') : t('products.type_service')}
              </button>
            ))}
          </div>
          <div className="sb-form-hint" style={{ marginTop: '6px' }}>
            {form.type === 'service' ? t('pwOcean.service_hint') : t('pwOcean.goods_hint')}
          </div>
        </div>

        <Grid cols={2}>
          <Field label={t('pwOcean.name_en')} required>
            <Input value={form.name}    onChange={(e) => set('name', e.target.value)}    placeholder={t('pwOcean.name_en_ph')} />
          </Field>
          {arabicOn && (
          <Field label={t('pwOcean.name_ar')}>
            <Input value={form.name_ar} onChange={(e) => set('name_ar', e.target.value)} placeholder="اسم الصنف" dir="rtl" />
          </Field>
          )}
        </Grid>

        <Grid cols={3}>
          <Field label={t('products.sku')} required>
            <Input value={form.sku} onChange={(e) => set('sku', e.target.value)} placeholder={t('pwOcean.sku_ph')} />
          </Field>
          <Field label={t('products.unit')}>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Select value={form.unit_id} onChange={(e) => set('unit_id', e.target.value)}>
                  <option value="">{t('pwOcean.select')}</option>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
                </Select>
              </div>
              <QcBtn onClick={openUnitQC} label={t('pwOcean.add_unit')} />
            </div>
          </Field>
          <Field label={t('products.brand')} required>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Select value={form.brand_id} onChange={(e) => set('brand_id', e.target.value)}>
                  <option value="">{t('pwOcean.select')}</option>
                  {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </div>
              <QcBtn onClick={openBrandQC} label={t('pwOcean.add_brand')} />
            </div>
          </Field>
        </Grid>

        <Grid cols={2}>
          <Field label={t('products.category')}>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Select value={form.category_id} onChange={(e) => set('category_id', e.target.value)}>
                  <option value="">{t('pwOcean.select')}</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </div>
              <QcBtn onClick={openCategoryQC} label={t('pwOcean.add_category')} />
            </div>
          </Field>
          <Field label={t('pwOcean.oe')}>
            <Input value={form.oe_number} onChange={(e) => set('oe_number', e.target.value)} placeholder={t('pwOcean.oe_ph')} />
          </Field>
          <Field label={t('pwOcean.replacements')} hint={t('pwOcean.replacements_hint')}>
            <Input value={form.replacement_numbers} onChange={(e) => set('replacement_numbers', e.target.value)} placeholder={t('pwOcean.replacements_ph')} />
          </Field>
        </Grid>

        <label style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          fontSize: '13px', color: '#475569', cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={form.is_excise}
            onChange={(e) => set('is_excise', e.target.checked)}
            style={{ accentColor: 'var(--sb-primary)', width: '14px', height: '14px' }}
          />
          {t('pwOcean.excise')}
        </label>
      </Panel>
    </div>
  );
}

// ── Step 2 — Pricing ────────────────────────────────────────────────────
function Step2({
  form, set, coa,
}: {
  form: WizardForm;
  set: <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => void;
  coa: CoaRow[];
}) {
  const { t } = useTranslation();
  const companyCurrency = useCompanyCurrency();   // Issue 1 — localize money to tenant currency
  const stdRate = defaultTaxRate(useCompanyCountry());   // 5% GCC / 18% India
  const selling = parseFloat(form.selling_price) || 0;
  const cost    = parseFloat(form.opening_stock_rate) || 0;
  const { margin, markup } = useMemo(() => {
    if (selling <= 0 || cost <= 0) return { margin: null as number | null, markup: null as number | null };
    return {
      margin: +(((selling - cost) / selling) * 100).toFixed(1),
      markup: +(((selling - cost) / cost)    * 100).toFixed(1),
    };
  }, [selling, cost]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {margin !== null && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: '10px' }}>
          {[
            { label: t('pwOcean.selling_price'), value: `${companyCurrency} ${selling.toFixed(2)}`, color: 'var(--sb-primary-dark)' },
            { label: t('pwOcean.gross_margin'),  value: `${margin}%`, color: (margin as number) > 20 ? '#067647' : '#B45309' },
            { label: t('pwOcean.markup'),        value: `${markup}%`, color: '#0369A1' },
          ].map((s) => (
            <div key={s.label} className="sb-card sb-pw-stat">
              <div className="sb-pw-stat-label">{s.label}</div>
              <bdi dir="ltr" className="sb-pw-stat-val" style={{ color: s.color }}>{s.value}</bdi>
            </div>
          ))}
        </div>
      )}

      <Panel icon={<Tag size={17} />} title={t('pwOcean.sec_sales')}>
        <Grid cols={2}>
          <Field label={t('pwOcean.selling_price')} required>
            <PrefixInput
              prefix={companyCurrency} type="number" min="0" step="0.01"
              value={form.selling_price}
              onChange={(e) => set('selling_price', e.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label={t('common.tax')}>
            <Select value={form.tax_category} onChange={(e) => set('tax_category', e.target.value as WizardForm['tax_category'])}>
              <option value="standard">{t('pwOcean.std_rate', { rate: stdRate })}</option>
              <option value="zero_rated">{t('products.tax_zero_rated')}</option>
              <option value="exempt">{t('products.tax_exempt')}</option>
            </Select>
          </Field>
          <Field label={t('products.default_tax_treatment')}>
            <Select value={form.default_tax_treatment} onChange={(e) => set('default_tax_treatment', e.target.value)}>
              <option value="">{t('products.treatment_auto')}</option>
              {TAX_TREATMENTS.map((tr) => (
                <option key={tr} value={tr}>{t(`products.treatment_${tr}`)}</option>
              ))}
            </Select>
          </Field>
        </Grid>
        <Field label={t('products.quality_tier')}>
          <Select value={form.quality_tier} onChange={(e) => set('quality_tier', e.target.value as WizardForm['quality_tier'])}>
            <option value="">{t('common.none')}</option>
            <option value="genuine">{t('products.quality_genuine')}</option>
            <option value="oem">{t('products.quality_oem')}</option>
            <option value="premium">{t('products.quality_premium')}</option>
            <option value="economy">{t('products.quality_economy')}</option>
          </Select>
        </Field>
        <Field label={t('common.description')}>
          <Textarea
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder={t('pwOcean.sales_notes_ph')}
            rows={2}
          />
        </Field>
      </Panel>

      <Panel icon={<ShoppingCart size={17} />} title={t('pwOcean.sec_purchase')}>
        <Field label={t('prodOcean.purchase_account')}>
          <Select value={form.purchase_account_id} onChange={(e) => set('purchase_account_id', e.target.value)}>
            <option value="">{t('prodOcean.purchase_account_default')}</option>
            {coa
              .filter((a) => a.is_active && (a.type === 'asset' || a.type === 'expense'))
              .map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </Select>
        </Field>
        <div className="sb-form-hint">{t('pwOcean.purchase_hint')}</div>
      </Panel>
    </div>
  );
}

// ── Step 3 — Identifiers ────────────────────────────────────────────────
function Step3({
  form, set,
}: {
  form: WizardForm;
  set: <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => void;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Panel icon={<Barcode size={17} />} title={t('pwOcean.sec_barcode')}>
        <Grid cols={2}>
          <Field label={t('pwOcean.barcode')}>
            <Input value={form.barcode} onChange={(e) => set('barcode', e.target.value)} placeholder={t('pwOcean.barcode_ph')} />
          </Field>
          <Field label={t('pwOcean.serial')}>
            <Select
              value={form.requires_serial ? 'serial' : 'none'}
              onChange={(e) => set('requires_serial', e.target.value === 'serial')}
            >
              <option value="none">{t('common.none')}</option>
              <option value="serial">{t('pwOcean.serial_number')}</option>
            </Select>
          </Field>
        </Grid>
        {form.barcode && (
          <div className="sb-pw-barcode">
            <Barcode size={30} aria-hidden="true" style={{ color: 'var(--sb-primary)', flex: 'none' }} />
            <div style={{ minWidth: 0 }}>
              <div className="sb-pw-stat-label">{t('pwOcean.barcode_preview')}</div>
              <bdi dir="ltr" className="sb-pw-barcode-val">{form.barcode}</bdi>
            </div>
            <span className="sb-pill sb-pill-good" style={{ marginTop: 0, marginInlineStart: 'auto' }}>{t('pwOcean.valid')}</span>
          </div>
        )}
      </Panel>

      <Panel icon={<Landmark size={17} />} title={t('pwOcean.sec_customs')}>
        <Grid cols={2}>
          <Field label={t('products.hsn_code')}>
            <Input value={form.hsn_code} onChange={(e) => set('hsn_code', e.target.value)} placeholder={t('prodOcean.hsn_ph')} />
          </Field>
          <Field label={t('pwOcean.origin')}>
            <Input value={form.country_of_origin} onChange={(e) => set('country_of_origin', e.target.value)} placeholder={t('pwOcean.origin_ph')} />
          </Field>
        </Grid>
      </Panel>
    </div>
  );
}

// ── Step 4 — Supplier ───────────────────────────────────────────────────
function Step4({
  form, set, suppliers, openSupplierQC,
}: {
  form: WizardForm;
  set: <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => void;
  suppliers: ContactRow[];
  openSupplierQC: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Panel icon={<Truck size={17} />} title={t('pwOcean.sec_supplier')}>
        <Grid cols={2}>
          <Field label={t('pwOcean.supplier_name')}>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Select value={form.supplier_id} onChange={(e) => set('supplier_id', e.target.value)}>
                  <option value="">{t('pwOcean.select_supplier')}</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </div>
              <QcBtn onClick={openSupplierQC} label={t('pwOcean.add_supplier')} />
            </div>
          </Field>
          <Field label={t('pwOcean.supplier_code')}>
            <Input value={form.supplier_sku} onChange={(e) => set('supplier_sku', e.target.value)} placeholder={t('pwOcean.supplier_code_ph')} />
          </Field>
        </Grid>
        <Grid cols={3}>
          <Field label={t('pwOcean.lead_time')}>
            <Input
              type="number" min="0"
              value={form.lead_time_days}
              onChange={(e) => set('lead_time_days', e.target.value)}
              placeholder={t('pwOcean.eg', { v: 7 })}
            />
          </Field>
          <Field label={t('pwOcean.moq')}>
            <Input
              type="number" min="0" step="0.001"
              value={form.min_order_qty}
              onChange={(e) => set('min_order_qty', e.target.value)}
              placeholder={t('pwOcean.eg', { v: 10 })}
            />
          </Field>
          <Field label={t('pwOcean.terms')}>
            <Input
              type="number" min="0"
              value={form.payment_terms_days}
              onChange={(e) => set('payment_terms_days', e.target.value)}
              placeholder={t('pwOcean.eg', { v: 30 })}
            />
          </Field>
        </Grid>
      </Panel>

      <Panel icon={<ClipboardList size={17} />} title={t('pwOcean.sec_more_suppliers')}>
        <div className="sb-pw-dashed">{t('pwOcean.more_suppliers_hint')}</div>
      </Panel>
    </div>
  );
}

// ── Step 5 — Stock & location ───────────────────────────────────────────
function Step5({
  form, set, warehouses, openWarehouseQC,
}: {
  form: WizardForm;
  set: <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => void;
  warehouses: WarehouseRow[];
  openWarehouseQC: () => void;
}) {
  const { t } = useTranslation();
  const companyCurrency = useCompanyCurrency();   // Issue 1 — localize money to tenant currency
  const isService = form.type === 'service';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <p className="sb-alert sb-alert-warn" style={{ fontWeight: 400, display: 'flex', gap: 8, alignItems: 'center' }} role="note">
        <AlertTriangle size={16} aria-hidden="true" style={{ flex: 'none' }} />
        <span>{t('pwOcean.tracking_warn')}</span>
      </p>

      <Panel icon={<Package size={17} />} title={t('pwOcean.sec_thresholds')}>
        <Grid cols={2}>
          <Field label={t('pwOcean.reorder')}>
            <Input type="number" min="0" step="0.001" value={form.min_stock_level} onChange={(e) => set('min_stock_level', e.target.value)} placeholder="0" />
          </Field>
          <Field label={t('pwOcean.max_stock')}>
            <Input type="number" min="0" step="0.001" value={form.max_stock_level} onChange={(e) => set('max_stock_level', e.target.value)} placeholder="—" />
          </Field>
        </Grid>
      </Panel>

      {!isService && (
        <Panel icon={<PackagePlus size={17} />} title={t('pwOcean.sec_opening')}>
          <div className="sb-form-hint">
            {t('pwOcean.opening_hint')}{' '}
            <bdi dir="ltr"><code className="sb-pw-code">Dr 1300 / Cr 3200</code></bdi>
          </div>
          <Grid cols={3}>
            <Field label={t('pwOcean.opening_qty')}>
              <Input type="number" min="0" step="0.001" value={form.opening_stock}      onChange={(e) => set('opening_stock', e.target.value)} placeholder="0" />
            </Field>
            <Field label={t('pwOcean.unit_cost', { cur: companyCurrency })}>
              <PrefixInput prefix={companyCurrency} type="number" min="0" step="0.01" value={form.opening_stock_rate} onChange={(e) => set('opening_stock_rate', e.target.value)} placeholder="0.00" />
            </Field>
            <Field label={t('billOcean.warehouse')}>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Select value={form.warehouse_id} onChange={(e) => set('warehouse_id', e.target.value)}>
                    <option value="">{t('pwOcean.select')}</option>
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </Select>
                </div>
                <QcBtn onClick={openWarehouseQC} label={t('pwOcean.add_warehouse')} />
              </div>
            </Field>
          </Grid>
          <Grid cols={2}>
            <Field label={t('pwOcean.aisle')}>
              <Input value={form.default_aisle} onChange={(e) => set('default_aisle', e.target.value)} placeholder={t('pwOcean.eg', { v: 'A3-R2' })} />
            </Field>
            <Field label={t('pwOcean.bin')}>
              <Input value={form.default_bin} onChange={(e) => set('default_bin', e.target.value)} placeholder={t('pwOcean.bin_ph')} />
            </Field>
          </Grid>
        </Panel>
      )}

      <Panel icon={<CircleCheck size={17} />} title={t('common.status')}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: 'var(--sb-text)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => set('is_active', e.target.checked)}
            style={{ accentColor: 'var(--sb-primary)', width: '14px', height: '14px' }}
          />
          {t('pwOcean.active_hint')}
        </label>
      </Panel>
    </div>
  );
}

// ── Quick-create shared helpers ─────────────────────────────────────────

/** Small indigo "+" button that sits flush next to a Select. */
function QcBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} className="sb-pw-qc">
      <Plus size={17} aria-hidden="true" />
    </button>
  );
}

/** Lightweight inline modal shell — no Tailwind, pure inline styles. */
function WizardQcModal({
  title, onClose, children,
}: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="sb-ocean sb-pw-overlay" style={{ zIndex: 1200 }}>
      <div className="sb-pw-dialog" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: '420px' }}>
        <div className="sb-pw-dialog-head">
          <span className="sb-pw-dialog-title">{title}</span>
          <button type="button" onClick={onClose} className="sb-doc-line-del" style={{ color: 'var(--sb-text-secondary)' }} aria-label={t('common.close')}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="sb-form" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Shared error banner inside QC modals. */
function QcError({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <p className="sb-alert sb-alert-danger" role="alert" style={{ margin: 0 }}>{msg}</p>;
}

/** Shared Save / Cancel row inside QC modals. */
function QcActions({ onClose, onSave, saving, disabled }: {
  onClose: () => void; onSave: () => void; saving: boolean; disabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
      <button type="button" className="sb-btn-ghost sb-pw-btn" onClick={onClose} disabled={saving}>{t('common.cancel')}</button>
      <button type="button" className="sb-primary-btn sb-btn-inline" onClick={onSave} disabled={saving || disabled}>
        {saving ? t('common.saving') : t('pwOcean.create_select')}
      </button>
    </div>
  );
}

// ── Brand quick-create ───────────────────────────────────────────────────
function BrandQC({
  companyId, onClose, onCreated,
}: { companyId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useTranslation();
  const [name, setName]   = useState('');
  const [err, setErr]     = useState<string | null>(null);
  const qc                = useQueryClient();
  const mut = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error(t('pwOcean.err_brand_name'));
      return getAdapter().brands.create({ company_id: companyId, name: name.trim(), is_active: true });
    },
    onSuccess: (row) => { qc.invalidateQueries({ queryKey: ['brands'] }); onCreated(row.id); },
    onError: (e: Error) => setErr(e.message),
  });
  return (
    <WizardQcModal title={t('pwOcean.qc_brand')} onClose={onClose}>
      <QcError msg={err} />
      <Field label={t('pwOcean.brand_name')} required>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('pwOcean.brand_ph')} autoFocus />
      </Field>
      <QcActions onClose={onClose} onSave={() => { setErr(null); mut.mutate(); }} saving={mut.isPending} disabled={!name.trim()} />
    </WizardQcModal>
  );
}

// ── Unit quick-create ────────────────────────────────────────────────────
function UnitQC({
  companyId, onClose, onCreated,
}: { companyId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useTranslation();
  const [code, setCode]   = useState('');
  const [name, setName]   = useState('');
  const [err, setErr]     = useState<string | null>(null);
  const qc                = useQueryClient();
  const mut = useMutation({
    mutationFn: async () => {
      if (!code.trim()) throw new Error(t('pwOcean.err_unit_code'));
      if (!name.trim()) throw new Error(t('pwOcean.err_unit_name'));
      return getAdapter().units.create({
        company_id: companyId,
        code: code.trim().toUpperCase(),
        name: name.trim(),
      });
    },
    onSuccess: (row) => { qc.invalidateQueries({ queryKey: ['units'] }); onCreated(row.id); },
    onError: (e: Error) => setErr(e.message),
  });
  return (
    <WizardQcModal title={t('pwOcean.qc_unit')} onClose={onClose}>
      <QcError msg={err} />
      <Grid cols={2}>
        <Field label={t('pwOcean.code')} required>
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('pwOcean.eg', { v: 'PCS' })} autoFocus />
        </Field>
        <Field label={t('products.name')} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('pwOcean.unit_name_ph')} />
        </Field>
      </Grid>
      <QcActions onClose={onClose} onSave={() => { setErr(null); mut.mutate(); }} saving={mut.isPending} disabled={!code.trim() || !name.trim()} />
    </WizardQcModal>
  );
}

// ── Category quick-create ────────────────────────────────────────────────
function CategoryQC({
  companyId, categories, onClose, onCreated,
}: {
  companyId: string;
  categories: CategoryRow[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName]         = useState('');
  const [parentId, setParentId] = useState('');
  const [err, setErr]           = useState<string | null>(null);
  const qc                      = useQueryClient();
  const mut = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error(t('pwOcean.err_category_name'));
      return getAdapter().categories.create({
        company_id: companyId,
        name: name.trim(),
        parent_id: parentId || null,
        is_active: true,
        sort_order: 0,
      });
    },
    onSuccess: (row) => { qc.invalidateQueries({ queryKey: ['categories'] }); onCreated(row.id); },
    onError: (e: Error) => setErr(e.message),
  });
  return (
    <WizardQcModal title={t('pwOcean.qc_category')} onClose={onClose}>
      <QcError msg={err} />
      <Field label={t('pwOcean.category_name')} required>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('pwOcean.category_ph')} autoFocus />
      </Field>
      <Field label={t('pwOcean.parent_category')}>
        <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">{t('pwOcean.top_level')}</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <QcActions onClose={onClose} onSave={() => { setErr(null); mut.mutate(); }} saving={mut.isPending} disabled={!name.trim()} />
    </WizardQcModal>
  );
}

// ── Warehouse quick-create ───────────────────────────────────────────────
function WarehouseQC({
  companyId, onClose, onCreated,
}: { companyId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useTranslation();
  const [name, setName]   = useState('');
  const [code, setCode]   = useState('');
  const [err, setErr]     = useState<string | null>(null);
  const qc                = useQueryClient();
  const mut = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error(t('pwOcean.err_wh_name'));
      if (!code.trim()) throw new Error(t('pwOcean.err_wh_code'));
      return getAdapter().warehouses.create({
        company_id: companyId,
        name: name.trim(),
        code: code.trim().toUpperCase(),
        is_active: true,
        is_default: false,
      });
    },
    onSuccess: (row) => { qc.invalidateQueries({ queryKey: ['warehouses'] }); onCreated(row.id); },
    onError: (e: Error) => setErr(e.message),
  });
  return (
    <WizardQcModal title={t('pwOcean.qc_warehouse')} onClose={onClose}>
      <QcError msg={err} />
      <Field label={t('pwOcean.wh_name')} required>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('pwOcean.wh_name_ph')} autoFocus />
      </Field>
      <Field label={t('pwOcean.code')} required>
        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('pwOcean.eg', { v: 'WH-01' })} />
      </Field>
      <QcActions onClose={onClose} onSave={() => { setErr(null); mut.mutate(); }} saving={mut.isPending} disabled={!name.trim() || !code.trim()} />
    </WizardQcModal>
  );
}

// ── Review modal ────────────────────────────────────────────────────────
function ReviewModal({
  form, currency, brands, suppliers, warehouses,
  onClose, onConfirm, saving,
}: {
  form: WizardForm;
  currency: string;
  brands: BrandRow[];
  suppliers: ContactRow[];
  warehouses: WarehouseRow[];
  onClose: () => void;
  onConfirm: () => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const brandName    = brands.find((b) => b.id === form.brand_id)?.name        ?? '—';
  const supplierName = suppliers.find((s) => s.id === form.supplier_id)?.name  ?? '—';
  const warehouseName = warehouses.find((w) => w.id === form.warehouse_id)?.name ?? '—';
  const openingQty   = parseFloat(form.opening_stock)      || 0;
  const openingRate  = parseFloat(form.opening_stock_rate) || 0;
  const openingValue = openingQty * openingRate;

  const rows: [string, string][] = [
    [t('pwOcean.type'),          form.type === 'goods' ? t('pwOcean.goods_tracked') : t('pwOcean.service_no_stock')],
    [t('products.name'),         form.name],
    [t('products.sku'),          form.sku],
    [t('products.brand'),        brandName],
    [t('pwOcean.selling_price'), `${currency} ${(parseFloat(form.selling_price) || 0).toFixed(2)}`],
    [t('common.tax'),            t(`products.tax_${form.tax_category}`)],
    [t('products.barcode'),      form.barcode || '—'],
    [t('pwOcean.hsn'),           form.hsn_code || '—'],
    [t('pwOcean.country'),       form.country_of_origin || '—'],
    [t('pwOcean.supplier'),      supplierName],
    [t('pwOcean.opening_stock'), openingQty > 0 ? `${openingQty} × ${currency} ${openingRate.toFixed(2)} = ${currency} ${openingValue.toFixed(2)}` : '—'],
    [t('billOcean.warehouse'),   warehouseName],
    [t('common.active'),         form.is_active ? t('returns.yes') : t('returns.no')],
  ];

  return (
    <div className="sb-ocean sb-pw-overlay" style={{ zIndex: 1000 }}>
      <div className="sb-pw-dialog" role="dialog" aria-modal="true" aria-label={t('pwOcean.review_title')} style={{ maxWidth: '540px', maxHeight: '86vh', overflow: 'auto' }}>
        <div className="sb-pw-dialog-head">
          <div>
            <div className="sb-pw-dialog-title" style={{ fontSize: 18 }}>{t('pwOcean.review_title')}</div>
            <div className="sb-form-hint" style={{ margin: '2px 0 0' }}>{t('pwOcean.review_sub')}</div>
          </div>
          <button type="button" onClick={onClose} className="sb-doc-line-del" style={{ color: 'var(--sb-text-secondary)' }} aria-label={t('common.close')}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div style={{ padding: '16px 24px' }}>
          {rows.map(([k, v]) => (
            <div key={k} className="sb-pw-review-row">
              <span>{k}</span>
              <span>{v}</span>
            </div>
          ))}
          {openingQty > 0 && form.type === 'goods' && (
            <p className="sb-alert sb-alert-warn" style={{ fontWeight: 400, marginTop: 12 }}>
              {t('pwOcean.review_je', { amount: `${currency} ${openingValue.toFixed(2)}` })}
            </p>
          )}
        </div>
        <div className="sb-pw-dialog-foot">
          <button type="button" className="sb-btn-ghost sb-pw-btn" onClick={onClose} disabled={saving}>{t('common.edit')}</button>
          <button type="button" className="sb-primary-btn sb-btn-inline" onClick={onConfirm} disabled={saving}>
            <Check size={16} aria-hidden="true" /> {saving ? t('common.saving') : t('pwOcean.save_item')}
          </button>
        </div>
      </div>
    </div>
  );
}
