/**
 * ProductWizard — 5-step new-item flow (Phase 12.28).
 *
 * Triggered when a user clicks "+ Add Product" → /products/new. The
 * existing edit-mode form on the same route is only used for editing
 * existing products (Phase 12.26 view-first). For new products this
 * wizard is shown instead.
 *
 * Steps:
 *   1. Basic info — type (goods/service), names, SKU, brand, category, unit, OE, excise
 *   2. Pricing — selling price, tax, quality tier, description, live margin/markup calculator
 *   3. Identifiers — barcode, serial tracking, HSN, country of origin
 *   4. Supplier — primary supplier + item code + lead time + MOQ + payment terms
 *   5. Stock & location — opening stock + rate (goods only), min/max, warehouse + aisle + bin
 *
 * On Save:
 *   • INSERT product (+ supplier_code if set)
 *   • If type='goods' AND opening_stock > 0 → call post_opening_stock RPC
 *     (writes stock_ledger 'opening_balance' row + Dr 1300 / Cr 3200 JE)
 *   • Navigate to /products/<id> in read-only view.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { Textarea } from '@/ui/textarea';
import { Button } from '@/ui/button';
import { Modal } from '@/ui/modal';
import type {
  BrandRow, CategoryRow, UnitRow, CoaRow,
  ContactRow, WarehouseRow,
} from '@/data/adapter';

// ── Step metadata ───────────────────────────────────────────────────────
const STEPS = [
  { id: 1, label: 'Basic info' },
  { id: 2, label: 'Pricing' },
  { id: 3, label: 'Identifiers' },
  { id: 4, label: 'Supplier' },
  { id: 5, label: 'Stock & location' },
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

// ── Sub-components ──────────────────────────────────────────────────────

function StepNav({
  step, completed, onJump,
}: { step: number; completed: Set<number>; onJump: (s: number) => void }) {
  return (
    <aside className="w-56 shrink-0 rounded-card border border-border-subtle bg-surface-card p-3">
      <div className="px-2 pb-3 mb-1 border-b border-border-subtle">
        <div className="text-[10px] font-bold uppercase tracking-wider text-ink-tertiary">New product</div>
        <div className="mt-1 text-xs text-ink-secondary">Step {step} of 5</div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-muted">
          <div className="h-1 bg-brand-500 transition-all duration-300" style={{ width: `${(step / 5) * 100}%` }} />
        </div>
      </div>
      {STEPS.map((s) => {
        const isActive = s.id === step;
        const isDone = completed.has(s.id);
        const clickable = isDone || s.id <= step;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => clickable && onJump(s.id)}
            disabled={!clickable}
            className={`flex w-full items-center gap-3 rounded-card px-3 py-2 text-start text-sm transition-colors ${
              isActive ? 'bg-brand-50 text-brand-700 font-semibold' :
              isDone ? 'text-green-700 hover:bg-surface-muted/50 cursor-pointer' :
              clickable ? 'text-ink-secondary hover:bg-surface-muted/50 cursor-pointer' :
              'text-ink-tertiary cursor-not-allowed'
            }`}
          >
            <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              isDone ? 'bg-green-50 text-green-700 border border-green-200' :
              isActive ? 'bg-brand-100 text-brand-700 border border-brand-200' :
              'bg-surface-muted text-ink-tertiary border border-border-subtle'
            }`}>
              {isDone ? '✓' : s.id}
            </div>
            <span>{s.label}</span>
          </button>
        );
      })}
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-border-subtle bg-surface-card">
      <div className="border-b border-border-subtle bg-surface-muted px-5 py-2">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-ink-tertiary">{title}</h3>
      </div>
      <div className="space-y-4 p-5">{children}</div>
    </div>
  );
}

// ── Main wizard ─────────────────────────────────────────────────────────

export function ProductWizard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { company_id } = useAuthStore();

  const [step, setStep]           = useState(1);
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const [form, setForm]           = useState<WizardForm>(initialForm);
  const [showReview, setShowReview] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  // Reference data (cached across steps)
  const { data: brands     = [] } = useQuery<BrandRow[]>(    { queryKey: ['brands',     company_id], queryFn: () => getAdapter().brands.list(company_id!),     enabled: !!company_id });
  const { data: categories = [] } = useQuery<CategoryRow[]>( { queryKey: ['categories', company_id], queryFn: () => getAdapter().categories.list(company_id!), enabled: !!company_id });
  const { data: units      = [] } = useQuery<UnitRow[]>({ queryKey: ['units',      company_id], queryFn: () => getAdapter().units.list(company_id!),      enabled: !!company_id });
  const { data: coa        = [] } = useQuery<CoaRow[]>(      { queryKey: ['coa',        company_id], queryFn: () => getAdapter().coa.list(company_id!),        enabled: !!company_id });
  const { data: suppliers  = [] } = useQuery<ContactRow[]>(  { queryKey: ['contacts',   company_id, 'supplier'], queryFn: () => getAdapter().contacts.list(company_id!, 'supplier'), enabled: !!company_id });
  const { data: warehouses = [] } = useQuery<WarehouseRow[]>({ queryKey: ['warehouses', company_id], queryFn: () => getAdapter().warehouses.list(company_id!), enabled: !!company_id });

  function set<K extends keyof WizardForm>(k: K, v: WizardForm[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // ── Validation ─────────────────────────────────────────────────────
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
      // If opening_stock > 0 then warehouse is required.
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

  // ── Save ────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      const sellingPrice = parseFloat(form.selling_price) || 0;
      const minStock     = parseFloat(form.min_stock_level) || 0;
      const maxStock     = parseFloat(form.max_stock_level);
      const openingQty   = parseFloat(form.opening_stock) || 0;
      const openingRate  = parseFloat(form.opening_stock_rate) || 0;

      // 1) INSERT product
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
        // Phase 12.28 — new fields
        type: form.type,
        hsn_code: form.hsn_code.trim() || null,
        country_of_origin: form.country_of_origin.trim() || null,
        is_excise: form.is_excise,
        default_aisle: form.default_aisle.trim() || null,
        default_bin: form.default_bin.trim() || null,
      };

      const created = await getAdapter().products.create(productRow);

      // 2) Primary supplier code (if specified)
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

      // 3) Opening stock (goods only, qty > 0)
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
    onSuccess: (newId) => {
      setShowReview(false);
      navigate(`/products/${newId}`);
    },
    onError: (e: Error) => { setShowReview(false); setError(e.message); },
  });

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/products')} className="text-sm text-ink-secondary hover:text-ink-primary">
          ← {t('products.back')}
        </button>
        <h1 className="text-xl font-bold text-ink-primary">{t('products.new')}</h1>
      </div>

      <div className="flex gap-4">
        <StepNav step={step} completed={completed} onJump={(s) => { setError(null); setStep(s); }} />

        <div className="min-w-0 flex-1 flex flex-col gap-4">
          {/* Step 1 — Basic info */}
          {step === 1 && (
            <Section title="Item identity">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-secondary">Type</label>
                <div className="inline-flex rounded-card border border-border-subtle bg-surface-muted p-1">
                  {(['goods', 'service'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => set('type', v)}
                      className={`px-4 py-1.5 rounded-card text-sm transition-colors ${
                        form.type === v ? 'bg-surface-card text-brand-700 font-semibold shadow-sm' : 'text-ink-secondary'
                      }`}
                    >
                      {v === 'goods' ? '📦 Goods' : '🛠 Service'}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-ink-tertiary">
                  {form.type === 'service'
                    ? 'Services skip stock movement and COGS — useful for labour, freight, fees.'
                    : 'Goods are stock-tracked. Sales reduce inventory, purchases add to it.'}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="Name (English) *" value={form.name}    onChange={(e) => set('name', e.target.value)} />
                <Input label="Name (Arabic)"     value={form.name_ar} onChange={(e) => set('name_ar', e.target.value)} dir="rtl" />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Input label="SKU *" value={form.sku} onChange={(e) => set('sku', e.target.value)} />
                <Select
                  label="Unit"
                  options={[{ value: '', label: '—' }, ...units.map((u) => ({ value: u.id, label: `${u.code} — ${u.name}` }))]}
                  value={form.unit_id}
                  onChange={(e) => set('unit_id', e.target.value)}
                />
                <Select
                  label="Brand *"
                  options={[{ value: '', label: '—' }, ...brands.map((b) => ({ value: b.id, label: b.name }))]}
                  value={form.brand_id}
                  onChange={(e) => set('brand_id', e.target.value)}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Select
                  label="Category"
                  options={[{ value: '', label: '—' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
                  value={form.category_id}
                  onChange={(e) => set('category_id', e.target.value)}
                />
                <Input label="OE Number" value={form.oe_number} onChange={(e) => set('oe_number', e.target.value)} placeholder="Manufacturer part number" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-ink-primary">
                <input type="checkbox" className="h-4 w-4 rounded border-border-strong text-brand-500" checked={form.is_excise} onChange={(e) => set('is_excise', e.target.checked)} />
                This product is subject to excise tax
              </label>
            </Section>
          )}

          {/* Step 2 — Pricing */}
          {step === 2 && (
            <Step2Pricing form={form} set={set} coa={coa} />
          )}

          {/* Step 3 — Identifiers */}
          {step === 3 && (
            <Section title="Barcode &amp; identifiers">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="Barcode (EAN / UPC)" value={form.barcode} onChange={(e) => set('barcode', e.target.value)} placeholder="Scan or enter" />
                <Select
                  label="Serial / batch tracking"
                  options={[
                    { value: 'none',   label: 'None' },
                    { value: 'serial', label: 'Serial number' },
                  ]}
                  value={form.requires_serial ? 'serial' : 'none'}
                  onChange={(e) => set('requires_serial', e.target.value === 'serial')}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="HSN / SAC code"     value={form.hsn_code}          onChange={(e) => set('hsn_code', e.target.value)}          placeholder="India GST classification" />
                <Input label="Country of origin"  value={form.country_of_origin} onChange={(e) => set('country_of_origin', e.target.value)} placeholder="e.g. UAE, China, India" />
              </div>
            </Section>
          )}

          {/* Step 4 — Supplier */}
          {step === 4 && (
            <Section title="Primary supplier (optional)">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Select
                  label="Supplier"
                  options={[{ value: '', label: '—' }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]}
                  value={form.supplier_id}
                  onChange={(e) => set('supplier_id', e.target.value)}
                />
                <Input label="Supplier item code" value={form.supplier_sku} onChange={(e) => set('supplier_sku', e.target.value)} placeholder="Supplier's own SKU" />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Input label="Lead time (days)"     type="number" min="0"      value={form.lead_time_days}     onChange={(e) => set('lead_time_days', e.target.value)}     placeholder="e.g. 7" />
                <Input label="Min order qty"        type="number" min="0" step="0.001" value={form.min_order_qty}      onChange={(e) => set('min_order_qty', e.target.value)}      placeholder="e.g. 10" />
                <Input label="Payment terms (days)" type="number" min="0"      value={form.payment_terms_days} onChange={(e) => set('payment_terms_days', e.target.value)} placeholder="e.g. 30" />
              </div>
              <p className="text-xs text-ink-tertiary">Optional. You can add more suppliers and edit these later from the Supplier Codes tab.</p>
            </Section>
          )}

          {/* Step 5 — Stock & location */}
          {step === 5 && (
            <Step5Stock form={form} set={set} warehouses={warehouses} />
          )}

          {error && (
            <div className="rounded-card border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Footer nav */}
          <div className="flex items-center justify-between rounded-card border border-border-subtle bg-surface-card p-3">
            <Button variant="ghost" size="sm" onClick={goPrev} disabled={step === 1}>← Back</Button>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => navigate('/products')}>Cancel</Button>
              <Button size="sm" onClick={goNext}>
                {step === 5 ? 'Review & save →' : `Next: ${STEPS[step].label} →`}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Review modal */}
      {showReview && (
        <ReviewModal
          form={form}
          warehouses={warehouses}
          suppliers={suppliers}
          brands={brands}
          onClose={() => setShowReview(false)}
          onConfirm={() => saveMutation.mutate()}
          saving={saveMutation.isPending}
        />
      )}
    </div>
  );
}

// ── Step 2 — Pricing (with live margin calc) ────────────────────────────
function Step2Pricing({
  form, set, coa,
}: {
  form: WizardForm;
  set: <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => void;
  coa: CoaRow[];
}) {
  const selling = parseFloat(form.selling_price) || 0;
  // Cost is the opening_stock_rate if entered, otherwise no calc.
  const cost = parseFloat(form.opening_stock_rate) || 0;
  const { margin, markup } = useMemo(() => {
    if (selling <= 0 || cost <= 0) return { margin: null as number | null, markup: null as number | null };
    return {
      margin: +(((selling - cost) / selling) * 100).toFixed(1),
      markup: +(((selling - cost) / cost)    * 100).toFixed(1),
    };
  }, [selling, cost]);

  const purchaseAccountOpts = [
    { value: '', label: '(default: 1300 Inventory)' },
    ...coa
      .filter((a) => a.is_active && (a.type === 'asset' || a.type === 'expense'))
      .map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` })),
  ];

  return (
    <Section title="Pricing">
      {margin !== null && (
        <div className="grid grid-cols-3 gap-3">
          <Tile label="Selling price" value={`AED ${selling.toFixed(2)}`} color="brand" />
          <Tile label="Gross margin"  value={`${margin}%`} color={margin > 20 ? 'green' : 'amber'} />
          <Tile label="Markup"        value={`${markup}%`} color="blue" />
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Selling price (AED) *"
          type="number" min="0" step="0.01"
          value={form.selling_price}
          onChange={(e) => set('selling_price', e.target.value)}
        />
        <Select
          label="Tax category"
          options={[
            { value: 'standard',   label: 'Standard Rate (5%)' },
            { value: 'zero_rated', label: 'Zero Rated' },
            { value: 'exempt',     label: 'Exempt' },
          ]}
          value={form.tax_category}
          onChange={(e) => set('tax_category', e.target.value as WizardForm['tax_category'])}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="Quality tier"
          options={[
            { value: '',        label: '—' },
            { value: 'genuine', label: 'Genuine' },
            { value: 'oem',     label: 'OEM' },
            { value: 'premium', label: 'Premium' },
            { value: 'economy', label: 'Economy' },
          ]}
          value={form.quality_tier}
          onChange={(e) => set('quality_tier', e.target.value as WizardForm['quality_tier'])}
        />
        <Select
          label="Purchase account"
          options={purchaseAccountOpts}
          value={form.purchase_account_id}
          onChange={(e) => set('purchase_account_id', e.target.value)}
        />
      </div>
      <Textarea
        label="Description"
        rows={3}
        value={form.description}
        onChange={(e) => set('description', e.target.value)}
        placeholder="Internal notes / spec / part details"
      />
      <p className="text-xs text-ink-tertiary">
        Tip: enter Opening Stock Rate in Step 5 to see live margin / markup based on cost.
      </p>
    </Section>
  );
}

function Tile({ label, value, color }: { label: string; value: string; color: 'brand' | 'green' | 'amber' | 'blue' }) {
  const colorMap = {
    brand: 'text-brand-600',
    green: 'text-green-700',
    amber: 'text-amber-700',
    blue:  'text-blue-700',
  };
  return (
    <div className="rounded-card border border-border-subtle bg-surface-muted/40 px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-ink-tertiary">{label}</div>
      <div className={`mt-1 font-mono text-xl font-semibold ${colorMap[color]}`}>{value}</div>
    </div>
  );
}

// ── Step 5 — Stock & location ───────────────────────────────────────────
function Step5Stock({
  form, set, warehouses,
}: {
  form: WizardForm;
  set: <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => void;
  warehouses: WarehouseRow[];
}) {
  const isService = form.type === 'service';
  return (
    <>
      {isService && (
        <div className="rounded-card border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          ℹ This is a Service item — stock fields below are not applicable. You can still set min/max thresholds for tracking purposes.
        </div>
      )}
      <Section title="Inventory thresholds">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Reorder level (min stock)" type="number" min="0" step="0.001" value={form.min_stock_level} onChange={(e) => set('min_stock_level', e.target.value)} />
          <Input label="Maximum stock (optional)"  type="number" min="0" step="0.001" value={form.max_stock_level} onChange={(e) => set('max_stock_level', e.target.value)} />
        </div>
      </Section>

      {!isService && (
        <Section title="Opening stock (one-time)">
          <p className="text-xs text-ink-tertiary">
            Lets you record stock you already have on hand without entering a fake purchase bill.
            Posts an <span className="font-mono">opening_balance</span> row to the stock ledger and a JE:{' '}
            <span className="font-mono">Dr 1300 Inventory / Cr 3200 Owner&apos;s Equity</span>. Leave blank if not needed.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input label="Opening qty"           type="number" min="0" step="0.001" value={form.opening_stock}      onChange={(e) => set('opening_stock', e.target.value)} />
            <Input label="Unit cost (AED)"       type="number" min="0" step="0.01"  value={form.opening_stock_rate} onChange={(e) => set('opening_stock_rate', e.target.value)} placeholder="0.00" />
            <Select
              label="Warehouse"
              options={[{ value: '', label: '—' }, ...warehouses.map((w) => ({ value: w.id, label: w.name }))]}
              value={form.warehouse_id}
              onChange={(e) => set('warehouse_id', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Default aisle (optional)" value={form.default_aisle} onChange={(e) => set('default_aisle', e.target.value)} placeholder="e.g. A3-R2" />
            <Input label="Default bin (optional)"   value={form.default_bin}   onChange={(e) => set('default_bin', e.target.value)}   placeholder="e.g. Bin 12" />
          </div>
        </Section>
      )}

      <Section title="Status">
        <label className="flex items-center gap-2 cursor-pointer text-sm text-ink-primary">
          <input type="checkbox" className="h-4 w-4 rounded border-border-strong text-brand-500" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
          Active (un-tick to hide from pickers)
        </label>
      </Section>
    </>
  );
}

// ── Review modal ────────────────────────────────────────────────────────
function ReviewModal({
  form, warehouses, suppliers, brands,
  onClose, onConfirm, saving,
}: {
  form: WizardForm;
  warehouses: WarehouseRow[];
  suppliers: ContactRow[];
  brands: BrandRow[];
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
    ['Type',             form.type === 'goods' ? 'Goods (stock-tracked)' : 'Service (no stock)'],
    ['Name',             form.name],
    ['SKU',              form.sku],
    ['Brand',            brandName],
    ['Selling price',    `AED ${(parseFloat(form.selling_price) || 0).toFixed(2)}`],
    ['Tax',              form.tax_category],
    ['Barcode',          form.barcode || '—'],
    ['HSN',              form.hsn_code || '—'],
    ['Country',          form.country_of_origin || '—'],
    ['Supplier',         supplierName],
    ['Opening stock',    openingQty > 0 ? `${openingQty} × AED ${openingRate.toFixed(2)} = AED ${openingValue.toFixed(2)}` : '—'],
    ['Warehouse',        warehouseName],
    ['Active',           form.is_active ? 'Yes' : 'No'],
  ];

  return (
    <Modal open={true} onClose={onClose} title="Review and save" width="md">
      <div className="space-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-border-subtle py-2 text-sm last:border-0">
            <span className="text-ink-tertiary">{k}</span>
            <span className="font-medium text-ink-primary">{v}</span>
          </div>
        ))}
        {openingQty > 0 && form.type === 'goods' && (
          <div className="mt-3 rounded-card border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            ⚠ Saving will post a JE for the opening stock: Dr 1300 Inventory AED {openingValue.toFixed(2)} / Cr 3200 Owner&apos;s Equity AED {openingValue.toFixed(2)}.
          </div>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={saving}>Back to edit</Button>
        <Button onClick={onConfirm} loading={saving}>Save product</Button>
      </div>
    </Modal>
  );
}
