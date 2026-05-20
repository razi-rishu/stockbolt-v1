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
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import type {
  BrandRow, CategoryRow, UnitRow, CoaRow,
  ContactRow, WarehouseRow,
} from '@/data/adapter';
import {
  Field, Input, Select, Textarea, PrefixInput, Badge, Panel, Grid,
} from '@/ui/primitives';
import { labelStyle } from '@/ui/theme';

// ── Step metadata ───────────────────────────────────────────────────────
const STEPS = [
  { id: 1, label: 'Basic info',       icon: '📦' },
  { id: 2, label: 'Pricing',          icon: '💰' },
  { id: 3, label: 'Identifiers',      icon: '🔖' },
  { id: 4, label: 'Supplier',         icon: '🚚' },
  { id: 5, label: 'Stock & location', icon: '🏭' },
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
  is_excise:           boolean;
  // Step 2
  selling_price:       string;
  tax_category:        'standard' | 'zero_rated' | 'exempt';
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
  oe_number: '', is_excise: false,
  selling_price: '', tax_category: 'standard', quality_tier: '',
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
  const navigate = useNavigate();
  const { company_id } = useAuthStore();

  const [step, setStep]           = useState(1);
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const [form, setForm]           = useState<WizardForm>(initialForm);
  const [showReview, setShowReview] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const { data: brands     = [] } = useQuery<BrandRow[]>(    { queryKey: ['brands',     company_id], queryFn: () => getAdapter().brands.list(company_id!),     enabled: !!company_id });
  const { data: categories = [] } = useQuery<CategoryRow[]>( { queryKey: ['categories', company_id], queryFn: () => getAdapter().categories.list(company_id!), enabled: !!company_id });
  const { data: units      = [] } = useQuery<UnitRow[]>(     { queryKey: ['units',      company_id], queryFn: () => getAdapter().units.list(company_id!),      enabled: !!company_id });
  const { data: coa        = [] } = useQuery<CoaRow[]>(      { queryKey: ['coa',        company_id], queryFn: () => getAdapter().coa.list(company_id!),        enabled: !!company_id });
  const { data: suppliers  = [] } = useQuery<ContactRow[]>(  { queryKey: ['contacts',   company_id, 'supplier'], queryFn: () => getAdapter().contacts.list(company_id!, 'supplier'), enabled: !!company_id });
  const { data: warehouses = [] } = useQuery<WarehouseRow[]>({ queryKey: ['warehouses', company_id], queryFn: () => getAdapter().warehouses.list(company_id!), enabled: !!company_id });

  function set<K extends keyof WizardForm>(k: K, v: WizardForm[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function validateStep(s: number): string | null {
    if (s === 1) {
      if (!form.name.trim()) return 'Name (English) is required';
      if (!form.sku.trim())  return 'SKU is required';
      if (!form.brand_id)    return 'Brand is required';
    }
    if (s === 2) {
      if (!form.selling_price) return 'Selling price is required';
      if (parseFloat(form.selling_price) < 0) return 'Selling price must be ≥ 0';
    }
    if (s === 5 && form.type === 'goods') {
      const qty = parseFloat(form.opening_stock) || 0;
      if (qty > 0 && !form.warehouse_id) return 'Warehouse is required to record opening stock';
      if (qty > 0 && !form.opening_stock_rate) return 'Opening stock rate is required when opening stock > 0';
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
        replacement_numbers: null,
        brand_id: form.brand_id || null,
        category_id: form.category_id || null,
        unit_id: form.unit_id || null,
        purchase_account_id: form.purchase_account_id || null,
        quality_tier: form.quality_tier ? (form.quality_tier as 'genuine' | 'oem' | 'premium' | 'economy') : null,
        selling_price: sellingPrice,
        tax_category: form.tax_category,
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
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: '#f8fafc', minHeight: '100vh', margin: '-1.5rem' }}>
      {showReview && (
        <ReviewModal
          form={form}
          brands={brands}
          suppliers={suppliers}
          warehouses={warehouses}
          onClose={() => setShowReview(false)}
          onConfirm={() => saveMutation.mutate()}
          saving={saveMutation.isPending}
        />
      )}

      {/* Top progress bar */}
      <div style={{ height: '3px', background: '#e2e8f0' }}>
        <div style={{
          height: '3px',
          background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
          width: `${progress}%`,
          transition: 'width .4s ease',
        }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', minHeight: 'calc(100vh - 3px)' }}>
        {/* Left sidebar with step nav */}
        <aside style={{ background: '#fff', borderRight: '1px solid #e2e8f0', padding: '24px 0', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '0 20px 20px', borderBottom: '1px solid #f1f5f9', marginBottom: '8px' }}>
            <div style={{
              fontSize: '11px', fontWeight: 700, color: '#94a3b8',
              textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '4px',
            }}>New item</div>
            <div style={{ fontSize: '13px', color: '#475569' }}>{form.name || 'Untitled item'}</div>
          </div>

          {STEPS.map((s) => {
            const isActive = s.id === step;
            const isDone   = completed.has(s.id);
            const clickable = isDone || s.id <= step;
            return (
              <div
                key={s.id}
                onClick={() => clickable && setStep(s.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '11px 20px',
                  cursor: clickable ? 'pointer' : 'default',
                  borderRight: isActive ? '2px solid #6366f1' : '2px solid transparent',
                  background: isActive ? '#eef2ff' : 'transparent',
                  transition: 'all .15s',
                }}
              >
                <div style={{
                  width: '24px', height: '24px', borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '11px', fontWeight: 700, flexShrink: 0,
                  background: isDone ? '#f0fdf4' : isActive ? '#eef2ff' : '#f8fafc',
                  color: isDone ? '#16a34a' : isActive ? '#4338ca' : '#94a3b8',
                  border: `1.5px solid ${isDone ? '#bbf7d0' : isActive ? '#c7d2fe' : '#e2e8f0'}`,
                }}>{isDone ? '✓' : s.id}</div>
                <span style={{
                  fontSize: '13px',
                  color: isDone ? '#16a34a' : isActive ? '#4338ca' : '#64748b',
                  fontWeight: isActive ? 600 : 400,
                }}>{s.label}</span>
              </div>
            );
          })}

          <div style={{ marginTop: 'auto', padding: '20px', borderTop: '1px solid #f1f5f9' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '8px' }}>Step {step} of 5</div>
            <div style={{ height: '4px', background: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ height: '4px', background: '#6366f1', width: `${progress}%`, borderRadius: '4px', transition: 'width .4s' }} />
            </div>
          </div>
        </aside>

        {/* Main content */}
        <div style={{ display: 'flex', flexDirection: 'column', background: '#f8fafc' }}>
          {/* Header */}
          <div style={{
            background: '#fff', borderBottom: '1px solid #e2e8f0',
            padding: '16px 28px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <div style={{
                fontSize: '11px', color: '#94a3b8',
                display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px',
              }}>
                <span style={{ cursor: 'pointer' }} onClick={() => navigate('/products')}>Inventory</span>
                <span>›</span>
                <span style={{ cursor: 'pointer' }} onClick={() => navigate('/products')}>Items</span>
                <span>›</span>
                <span>New item</span>
              </div>
              <div style={{ fontSize: '17px', fontWeight: 700, color: '#1e293b' }}>
                {STEPS[step - 1].icon} {STEPS[step - 1].label}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Badge color="amber">⏱ Draft</Badge>
              <button
                onClick={() => setShowReview(true)}
                style={{
                  padding: '7px 14px',
                  border: '1px solid #e2e8f0', borderRadius: '8px',
                  background: '#fff', fontSize: '12px',
                  cursor: 'pointer', color: '#475569',
                  display: 'flex', alignItems: 'center', gap: '5px',
                }}
              >👁 Preview</button>
            </div>
          </div>

          {/* Step body */}
          <div style={{ flex: 1, padding: '24px 28px', overflowY: 'auto' }}>
            {step === 1 && <Step1 form={form} set={set} brands={brands} categories={categories} units={units} />}
            {step === 2 && <Step2 form={form} set={set} coa={coa} />}
            {step === 3 && <Step3 form={form} set={set} />}
            {step === 4 && <Step4 form={form} set={set} suppliers={suppliers} />}
            {step === 5 && <Step5 form={form} set={set} warehouses={warehouses} />}

            {error && (
              <div style={{
                marginTop: '14px',
                background: '#fef2f2', border: '1px solid #fecaca',
                borderRadius: '8px', padding: '10px 14px',
                fontSize: '13px', color: '#dc2626',
              }}>{error}</div>
            )}
          </div>

          {/* Footer */}
          <div style={{
            background: '#fff', borderTop: '1px solid #e2e8f0',
            padding: '14px 28px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <button
              onClick={goPrev}
              disabled={step === 1}
              style={{
                padding: '9px 18px',
                border: '1px solid #e2e8f0', borderRadius: '8px',
                background: '#fff', fontSize: '13px',
                cursor: step === 1 ? 'not-allowed' : 'pointer',
                color: step === 1 ? '#cbd5e1' : '#475569',
                display: 'flex', alignItems: 'center', gap: '6px',
              }}
            >← Back</button>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => navigate('/products')}
                style={{
                  padding: '9px 18px',
                  border: '1px solid #e2e8f0', borderRadius: '8px',
                  background: '#fff', fontSize: '13px',
                  cursor: 'pointer', color: '#475569',
                }}
              >Cancel</button>
              <button
                onClick={goNext}
                disabled={!!validateStep(step)}
                style={{
                  padding: '9px 22px',
                  border: 'none', borderRadius: '8px',
                  background: validateStep(step) ? '#c7d2fe' : '#6366f1',
                  fontSize: '13px',
                  cursor: validateStep(step) ? 'not-allowed' : 'pointer',
                  color: '#fff', fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: '6px',
                  transition: 'background .15s',
                }}
              >
                {step === 5 ? 'Review & save' : `Next: ${STEPS[step].label}`} →
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
}: {
  form: WizardForm;
  set: <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => void;
  brands: BrandRow[];
  categories: CategoryRow[];
  units: UnitRow[];
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Panel icon="🏷️" title="Item identity">
        <div>
          <label style={labelStyle}>Type</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            {(['goods', 'service'] as const).map((t) => (
              <button
                key={t}
                onClick={() => set('type', t)}
                style={{
                  padding: '7px 18px', borderRadius: '7px',
                  border: `1.5px solid ${form.type === t ? '#6366f1' : '#e2e8f0'}`,
                  background: form.type === t ? '#eef2ff' : '#fff',
                  color: form.type === t ? '#4338ca' : '#64748b',
                  fontWeight: form.type === t ? 600 : 400,
                  fontSize: '13px', cursor: 'pointer',
                  transition: 'all .15s',
                }}
              >
                {t === 'goods' ? '📦 Goods' : '🛠 Service'}
              </button>
            ))}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px' }}>
            {form.type === 'service'
              ? 'Services skip stock movement and COGS — useful for labour, freight, fees.'
              : 'Goods are stock-tracked. Sales reduce inventory, purchases add to it.'}
          </div>
        </div>

        <Grid cols={2}>
          <Field label="Name (English)" required>
            <Input value={form.name}    onChange={(e) => set('name', e.target.value)}    placeholder="Item name in English" />
          </Field>
          <Field label="Name (Arabic)">
            <Input value={form.name_ar} onChange={(e) => set('name_ar', e.target.value)} placeholder="اسم الصنف" dir="rtl" />
          </Field>
        </Grid>

        <Grid cols={3}>
          <Field label="SKU" required>
            <Input value={form.sku} onChange={(e) => set('sku', e.target.value)} placeholder="e.g. ITEM-001" />
          </Field>
          <Field label="Unit">
            <Select value={form.unit_id} onChange={(e) => set('unit_id', e.target.value)}>
              <option value="">-- select --</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
            </Select>
          </Field>
          <Field label="Brand" required>
            <Select value={form.brand_id} onChange={(e) => set('brand_id', e.target.value)}>
              <option value="">-- select --</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
        </Grid>

        <Grid cols={2}>
          <Field label="Category">
            <Select value={form.category_id} onChange={(e) => set('category_id', e.target.value)}>
              <option value="">-- select --</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="OE / Replace number">
            <Input value={form.oe_number} onChange={(e) => set('oe_number', e.target.value)} placeholder="Alternate / OEM number" />
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
            style={{ accentColor: '#6366f1', width: '14px', height: '14px' }}
          />
          It is an excise product
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
          {[
            { label: 'Selling price', value: `AED ${selling.toFixed(2)}`, color: '#6366f1' },
            { label: 'Gross margin',  value: `${margin}%`, color: (margin as number) > 20 ? '#16a34a' : '#d97706' },
            { label: 'Markup',        value: `${markup}%`, color: '#0ea5e9' },
          ].map((s) => (
            <div key={s.label} style={{
              background: '#f8fafc', border: '1px solid #e2e8f0',
              borderRadius: '10px', padding: '12px 14px',
            }}>
              <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500, marginBottom: '4px' }}>{s.label}</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      <Panel icon="🏷️" title="Sales information">
        <Grid cols={2}>
          <Field label="Selling price" required>
            <PrefixInput
              prefix="AED" type="number" min="0" step="0.01"
              value={form.selling_price}
              onChange={(e) => set('selling_price', e.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label="Tax">
            <Select value={form.tax_category} onChange={(e) => set('tax_category', e.target.value as WizardForm['tax_category'])}>
              <option value="standard">Standard Rate [5%]</option>
              <option value="zero_rated">Zero Rated</option>
              <option value="exempt">Exempt</option>
            </Select>
          </Field>
        </Grid>
        <Field label="Quality tier">
          <Select value={form.quality_tier} onChange={(e) => set('quality_tier', e.target.value as WizardForm['quality_tier'])}>
            <option value="">-- none --</option>
            <option value="genuine">Genuine</option>
            <option value="oem">OEM</option>
            <option value="premium">Premium</option>
            <option value="economy">Economy</option>
          </Select>
        </Field>
        <Field label="Description">
          <Textarea
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Sales notes…"
            rows={2}
          />
        </Field>
      </Panel>

      <Panel icon="🛒" title="Purchase information">
        <Field label="Purchase account">
          <Select value={form.purchase_account_id} onChange={(e) => set('purchase_account_id', e.target.value)}>
            <option value="">(default: 1300 Inventory)</option>
            {coa
              .filter((a) => a.is_active && (a.type === 'asset' || a.type === 'expense'))
              .map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </Select>
        </Field>
        <div style={{ fontSize: '11px', color: '#94a3b8' }}>
          When this product appears on a vendor bill, it posts to this account.
          Cost basis is tracked dynamically via Moving Average Cost (MAC) — no static cost field.
        </div>
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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Panel icon="🔖" title="Barcode & tracking">
        <Grid cols={2}>
          <Field label="Barcode (EAN / UPC)">
            <Input value={form.barcode} onChange={(e) => set('barcode', e.target.value)} placeholder="Scan or enter barcode" />
          </Field>
          <Field label="Serial / batch tracking">
            <Select
              value={form.requires_serial ? 'serial' : 'none'}
              onChange={(e) => set('requires_serial', e.target.value === 'serial')}
            >
              <option value="none">None</option>
              <option value="serial">Serial number</option>
            </Select>
          </Field>
        </Grid>
        {form.barcode && (
          <div style={{
            background: '#f8fafc', border: '1px solid #e2e8f0',
            borderRadius: '10px', padding: '14px',
            display: 'flex', alignItems: 'center', gap: '12px',
          }}>
            <span style={{ fontSize: '28px' }}>🔲</span>
            <div>
              <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500 }}>Barcode preview</div>
              <div style={{
                fontFamily: 'monospace', fontSize: '18px', fontWeight: 700,
                letterSpacing: '3px', color: '#1e293b', marginTop: '2px',
              }}>{form.barcode}</div>
            </div>
            <Badge color="green">Valid</Badge>
          </div>
        )}
      </Panel>

      <Panel icon="🏷️" title="Tax / customs identifiers">
        <Grid cols={2}>
          <Field label="HSN / SAC code">
            <Input value={form.hsn_code} onChange={(e) => set('hsn_code', e.target.value)} placeholder="India GST classification" />
          </Field>
          <Field label="Country of origin">
            <Input value={form.country_of_origin} onChange={(e) => set('country_of_origin', e.target.value)} placeholder="e.g. UAE, China, India" />
          </Field>
        </Grid>
      </Panel>
    </div>
  );
}

// ── Step 4 — Supplier ───────────────────────────────────────────────────
function Step4({
  form, set, suppliers,
}: {
  form: WizardForm;
  set: <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => void;
  suppliers: ContactRow[];
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Panel icon="🚚" title="Primary supplier (optional)">
        <Grid cols={2}>
          <Field label="Supplier name">
            <Select value={form.supplier_id} onChange={(e) => set('supplier_id', e.target.value)}>
              <option value="">-- select supplier --</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Supplier item code">
            <Input value={form.supplier_sku} onChange={(e) => set('supplier_sku', e.target.value)} placeholder="Supplier's own SKU" />
          </Field>
        </Grid>
        <Grid cols={3}>
          <Field label="Lead time (days)">
            <Input
              type="number" min="0"
              value={form.lead_time_days}
              onChange={(e) => set('lead_time_days', e.target.value)}
              placeholder="e.g. 7"
            />
          </Field>
          <Field label="Min order qty">
            <Input
              type="number" min="0" step="0.001"
              value={form.min_order_qty}
              onChange={(e) => set('min_order_qty', e.target.value)}
              placeholder="e.g. 10"
            />
          </Field>
          <Field label="Payment terms (days)">
            <Input
              type="number" min="0"
              value={form.payment_terms_days}
              onChange={(e) => set('payment_terms_days', e.target.value)}
              placeholder="e.g. 30"
            />
          </Field>
        </Grid>
      </Panel>

      <Panel icon="📋" title="More suppliers">
        <div style={{
          border: '1px dashed #e2e8f0', borderRadius: '10px',
          padding: '20px', textAlign: 'center',
          color: '#94a3b8', fontSize: '13px',
        }}>
          You can add more suppliers after saving — Product detail › Supplier Codes tab.
        </div>
      </Panel>
    </div>
  );
}

// ── Step 5 — Stock & location ───────────────────────────────────────────
function Step5({
  form, set, warehouses,
}: {
  form: WizardForm;
  set: <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => void;
  warehouses: WarehouseRow[];
}) {
  const isService = form.type === 'service';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '12px 16px',
        background: '#fffbeb', border: '1px solid #fde68a',
        borderRadius: '10px', fontSize: '13px', color: '#92400e',
      }}>
        <span>⚠️</span>
        <span>Inventory tracking cannot be changed once transactions have been created for this item.</span>
      </div>

      <Panel icon="📦" title="Inventory thresholds">
        <Grid cols={2}>
          <Field label="Reorder level (min stock)">
            <Input type="number" min="0" step="0.001" value={form.min_stock_level} onChange={(e) => set('min_stock_level', e.target.value)} placeholder="0" />
          </Field>
          <Field label="Maximum stock (optional)">
            <Input type="number" min="0" step="0.001" value={form.max_stock_level} onChange={(e) => set('max_stock_level', e.target.value)} placeholder="—" />
          </Field>
        </Grid>
      </Panel>

      {!isService && (
        <Panel icon="📥" title="Opening stock (one-time)">
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
            Lets you record stock already on hand without entering a fake purchase. Posts an{' '}
            <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: '3px' }}>opening_balance</code>{' '}
            row to the stock ledger and a JE:{' '}
            <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: '3px' }}>Dr 1300 Inventory / Cr 3200 Owner&apos;s Equity</code>.
            Leave blank if not needed.
          </div>
          <Grid cols={3}>
            <Field label="Opening qty">
              <Input type="number" min="0" step="0.001" value={form.opening_stock}      onChange={(e) => set('opening_stock', e.target.value)} placeholder="0" />
            </Field>
            <Field label="Unit cost (AED)">
              <PrefixInput prefix="AED" type="number" min="0" step="0.01" value={form.opening_stock_rate} onChange={(e) => set('opening_stock_rate', e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Warehouse">
              <Select value={form.warehouse_id} onChange={(e) => set('warehouse_id', e.target.value)}>
                <option value="">-- select --</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </Field>
          </Grid>
          <Grid cols={2}>
            <Field label="Default aisle / rack">
              <Input value={form.default_aisle} onChange={(e) => set('default_aisle', e.target.value)} placeholder="e.g. A3-R2" />
            </Field>
            <Field label="Default bin / shelf">
              <Input value={form.default_bin} onChange={(e) => set('default_bin', e.target.value)} placeholder="e.g. Bin 12" />
            </Field>
          </Grid>
        </Panel>
      )}

      <Panel icon="✅" title="Status">
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#475569', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => set('is_active', e.target.checked)}
            style={{ accentColor: '#6366f1', width: '14px', height: '14px' }}
          />
          Active (un-tick to hide from pickers)
        </label>
      </Panel>
    </div>
  );
}

// ── Review modal ────────────────────────────────────────────────────────
function ReviewModal({
  form, brands, suppliers, warehouses,
  onClose, onConfirm, saving,
}: {
  form: WizardForm;
  brands: BrandRow[];
  suppliers: ContactRow[];
  warehouses: WarehouseRow[];
  onClose: () => void;
  onConfirm: () => void;
  saving: boolean;
}) {
  const brandName    = brands.find((b) => b.id === form.brand_id)?.name        ?? '—';
  const supplierName = suppliers.find((s) => s.id === form.supplier_id)?.name  ?? '—';
  const warehouseName = warehouses.find((w) => w.id === form.warehouse_id)?.name ?? '—';
  const openingQty   = parseFloat(form.opening_stock)      || 0;
  const openingRate  = parseFloat(form.opening_stock_rate) || 0;
  const openingValue = openingQty * openingRate;

  const rows: [string, string][] = [
    ['Type',          form.type === 'goods' ? 'Goods (stock-tracked)' : 'Service (no stock)'],
    ['Name',          form.name],
    ['SKU',           form.sku],
    ['Brand',         brandName],
    ['Selling price', `AED ${(parseFloat(form.selling_price) || 0).toFixed(2)}`],
    ['Tax',           form.tax_category],
    ['Barcode',       form.barcode || '—'],
    ['HSN',           form.hsn_code || '—'],
    ['Country',       form.country_of_origin || '—'],
    ['Supplier',      supplierName],
    ['Opening stock', openingQty > 0 ? `${openingQty} × AED ${openingRate.toFixed(2)} = AED ${openingValue.toFixed(2)}` : '—'],
    ['Warehouse',     warehouseName],
    ['Active',        form.is_active ? 'Yes' : 'No'],
  ];

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        background: '#fff', borderRadius: '16px',
        width: '520px', maxHeight: '80vh', overflow: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,.2)',
      }}>
        <div style={{
          padding: '20px 24px 16px',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div style={{ fontSize: '17px', fontWeight: 700, color: '#1e293b' }}>Review item</div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>Confirm details before saving</div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#94a3b8' }}
          >✕</button>
        </div>
        <div style={{ padding: '16px 24px' }}>
          {rows.map(([k, v]) => (
            <div key={k} style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '8px 0', borderBottom: '1px solid #f1f5f9',
              fontSize: '13px',
            }}>
              <span style={{ color: '#64748b' }}>{k}</span>
              <span style={{ fontWeight: 500, color: '#1e293b' }}>{v}</span>
            </div>
          ))}
          {openingQty > 0 && form.type === 'goods' && (
            <div style={{
              marginTop: '12px',
              background: '#fffbeb', border: '1px solid #fde68a',
              borderRadius: '8px', padding: '10px 12px',
              fontSize: '12px', color: '#92400e',
            }}>
              ⚠ Saving will post a JE for the opening stock:
              Dr 1300 Inventory AED {openingValue.toFixed(2)} /
              Cr 3200 Owner&apos;s Equity AED {openingValue.toFixed(2)}.
            </div>
          )}
        </div>
        <div style={{
          padding: '16px 24px', borderTop: '1px solid #e2e8f0',
          display: 'flex', gap: '10px', justifyContent: 'flex-end',
        }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              padding: '9px 18px',
              border: '1px solid #e2e8f0', borderRadius: '8px',
              background: '#fff', fontSize: '13px',
              cursor: saving ? 'not-allowed' : 'pointer', color: '#64748b',
            }}
          >Edit</button>
          <button
            onClick={onConfirm}
            disabled={saving}
            style={{
              padding: '9px 20px',
              border: 'none', borderRadius: '8px',
              background: saving ? '#c7d2fe' : '#6366f1',
              fontSize: '13px',
              cursor: saving ? 'not-allowed' : 'pointer',
              color: '#fff', fontWeight: 600,
            }}
          >{saving ? 'Saving…' : 'Save item ✓'}</button>
        </div>
      </div>
    </div>
  );
}
