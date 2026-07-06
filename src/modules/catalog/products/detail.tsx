import React, { useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';
import { Select } from '@/ui/select';
import { Modal } from '@/ui/modal';
import type { ProductCompatibilityRow, ProductSupplierCodeRow, ContactRow, VehicleMakeRow, VehicleModelRow, VehicleGenerationRow, VehicleVariantRow, VehicleEngineRow, CoaRow } from '@/data/adapter';
import { ProductStockTab } from './_stock-tab';
import { ProductWizard } from './_wizard';
import { useFormInvalidBanner } from '@/hooks/use-form-invalid-banner';
import { FormErrorBanner } from '@/ui/form-error-banner';

const schema = z.object({
  sku:                z.string().min(1, 'Required'),
  name:               z.string().min(1, 'Required'),
  name_ar:            z.string(),
  description:        z.string(),
  description_ar:     z.string(),
  oe_number:          z.string(),
  replacement_numbers:z.string(),
  brand_id:           z.string().nullable(),
  category_id:        z.string().nullable(),
  unit_id:            z.string().nullable(),
  purchase_account_id:z.string().nullable(),
  quality_tier:       z.string().nullable(),
  type:               z.enum(['goods', 'service']),
  selling_price:      z.coerce.number().min(0),
  tax_category:       z.enum(['standard', 'zero_rated', 'exempt']),
  min_stock_level:    z.coerce.number().min(0),
  requires_serial:    z.boolean(),
  is_active:          z.boolean(),
  barcode:            z.string(),
});
type FormValues = z.infer<typeof schema>;

const QUALITY_OPTIONS = ['', 'genuine', 'oem', 'premium', 'economy'];
const TAX_OPTIONS = ['standard', 'zero_rated', 'exempt'];

// ── Design tokens (inline) ──────────────────────────────────────────
const S = {
  card: {
    background: '#fff',
    border: '1px solid #e4e4e7',
    borderRadius: '12px',
    overflow: 'hidden',
    boxShadow: '0 1px 3px rgba(9,9,11,.05)',
  } as React.CSSProperties,
  head: {
    padding: '10px 18px',
    background: '#f8fafc',
    borderBottom: '1px solid #e4e4e7',
    fontSize: '10px',
    fontWeight: 700,
    color: '#64748b',
    textTransform: 'uppercase' as const,
    letterSpacing: '.07em',
  } as React.CSSProperties,
  body: {
    padding: '18px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '14px',
  } as React.CSSProperties,
  row2: {
    display: 'grid',
    // min(100%, 280px) lets the pair stack to one column on narrow screens
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
    gap: '12px',
  } as React.CSSProperties,
};

export default function ProductDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const { company_id } = useAuthStore();
  const qc = useQueryClient();
  const imgRef = useRef<HTMLInputElement>(null);

  const [searchParams] = useSearchParams();
  const initialTab =
    (searchParams.get('tab') as 'details' | 'stock' | 'compat' | 'suppliers' | 'images' | null)
    ?? 'details';
  const [activeTab, setActiveTab] = useState<'details' | 'stock' | 'compat' | 'suppliers' | 'images'>(initialTab);
  const [editMode, setEditMode] = useState(isNew);
  const [compatModal, setCompatModal] = useState(false);
  const [supplierModal, setSupplierModal] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);

  const [compatMakeId, setCompatMakeId] = useState('');
  const [compatModelId, setCompatModelId] = useState('');
  const [compatGenId, setCompatGenId] = useState('');
  const [compatVarId, setCompatVarId] = useState('');
  const [compatYearFrom, setCompatYearFrom] = useState('');
  const [compatYearTo, setCompatYearTo] = useState('');
  const [compatEngine, setCompatEngine] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [supplierSku, setSupplierSku] = useState('');

  const { data: product } = useQuery({
    queryKey: ['product', id],
    queryFn: () => getAdapter().products.getById(id!),
    enabled: !isNew && !!id,
  });

  const { data: brands = [] } = useQuery({ queryKey: ['brands', company_id], queryFn: () => getAdapter().brands.list(company_id!), enabled: !!company_id });
  const { data: categories = [] } = useQuery({ queryKey: ['categories', company_id], queryFn: () => getAdapter().categories.list(company_id!), enabled: !!company_id });
  const { data: units = [] } = useQuery({ queryKey: ['units', company_id], queryFn: () => getAdapter().units.list(company_id!), enabled: !!company_id });
  const { data: coaAccounts = [] } = useQuery<CoaRow[]>({ queryKey: ['coa', company_id], queryFn: () => getAdapter().coa.list(company_id!), enabled: !!company_id });
  const { data: makes = [] } = useQuery<VehicleMakeRow[]>({ queryKey: ['vehicle_makes', company_id], queryFn: () => getAdapter().vehicleMakes.list(company_id!), enabled: !!company_id });
  const { data: models = [] } = useQuery<VehicleModelRow[]>({ queryKey: ['vehicle_models', compatMakeId], queryFn: () => getAdapter().vehicleMakes.listModels(compatMakeId), enabled: !!compatMakeId });
  const { data: compatGenerations = [] } = useQuery<VehicleGenerationRow[]>({ queryKey: ['vehicle_generations', compatModelId], queryFn: () => getAdapter().vehicleMakes.listGenerations(compatModelId), enabled: !!compatModelId });
  const { data: compatVariants = [] } = useQuery<VehicleVariantRow[]>({ queryKey: ['vehicle_variants', compatGenId], queryFn: () => getAdapter().vehicleMakes.listVariants(compatGenId), enabled: !!compatGenId });
  const { data: compatEngines = [] } = useQuery<VehicleEngineRow[]>({ queryKey: ['vehicle_engines', company_id], queryFn: () => getAdapter().vehicleMakes.listEngines(company_id!), enabled: !!company_id });
  const { data: suppliers = [] } = useQuery<ContactRow[]>({ queryKey: ['contacts', company_id, 'supplier'], queryFn: () => getAdapter().contacts.list(company_id!, 'supplier'), enabled: !!company_id });
  const { data: compat = [] } = useQuery<ProductCompatibilityRow[]>({ queryKey: ['compat', id], queryFn: () => getAdapter().products.listCompatibility(id!), enabled: !isNew && !!id });
  const { data: supplierCodes = [] } = useQuery<ProductSupplierCodeRow[]>({ queryKey: ['supplier_codes', id], queryFn: () => getAdapter().products.listSupplierCodes(id!), enabled: !isNew && !!id });
  const { data: images } = useQuery({ queryKey: ['product', id], queryFn: () => getAdapter().products.getById(id!), enabled: !isNew && !!id, select: (p) => p?.image_urls ?? [] });

  const { onInvalid, bannerMessage, clearBanner } = useFormInvalidBanner('product-detail');
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema) as any,
    values: product ? {
      sku: product.sku, name: product.name, name_ar: product.name_ar ?? '',
      description: product.description ?? '', description_ar: product.description_ar ?? '',
      oe_number: product.oe_number ?? '', replacement_numbers: (product.replacement_numbers ?? []).join(', '),
      brand_id: product.brand_id ?? null, category_id: product.category_id ?? null, unit_id: product.unit_id ?? null,
      purchase_account_id: (product as { purchase_account_id?: string | null }).purchase_account_id ?? null,
      quality_tier: product.quality_tier ?? null,
      type: (((product as { type?: string }).type === 'service') ? 'service' : 'goods') as 'goods' | 'service',
      selling_price: Number(product.selling_price),
      tax_category: product.tax_category as 'standard' | 'zero_rated' | 'exempt',
      min_stock_level: Number(product.min_stock_level), requires_serial: product.requires_serial, is_active: product.is_active, barcode: product.barcode ?? '',
    } : { sku: '', name: '', name_ar: '', description: '', description_ar: '', oe_number: '', replacement_numbers: '', brand_id: null, category_id: null, unit_id: null, purchase_account_id: null, quality_tier: null, type: 'goods' as const, selling_price: 0, tax_category: 'standard', min_stock_level: 0, requires_serial: false, is_active: true, barcode: '' },
  });

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const replacements = values.replacement_numbers.split(',').map((s) => s.trim()).filter(Boolean);
      const row = {
        company_id: company_id!, sku: values.sku, name: values.name, name_ar: values.name_ar || null,
        description: values.description || null, description_ar: values.description_ar || null,
        oe_number: values.oe_number || null, replacement_numbers: replacements.length ? replacements : null,
        brand_id: values.brand_id || null, category_id: values.category_id || null, unit_id: values.unit_id || null,
        purchase_account_id: values.purchase_account_id || null,
        quality_tier: (values.quality_tier as 'genuine' | 'oem' | 'premium' | 'economy' | null) || null,
        // Goods vs Service drives the posting engine (services never touch stock/COGS).
        type: values.type,
        selling_price: values.selling_price, tax_category: values.tax_category,
        min_stock_level: values.min_stock_level, requires_serial: values.requires_serial, is_active: values.is_active,
        barcode: values.barcode || null, image_urls: product?.image_urls ?? null,
        max_stock_level: null, weight_kg: null,
      };
      if (isNew) {
        const p = await getAdapter().products.create(row);
        return p.id;
      } else {
        await getAdapter().products.update(id!, row);
        return id!;
      }
    },
    onSuccess: (newId) => {
      qc.invalidateQueries({ queryKey: ['products', company_id] });
      if (isNew) navigate(`/products/${newId}`, { replace: true });
    },
  });

  const addCompatMutation = useMutation({
    mutationFn: () => {
      // generation_id/variant_id are only sent when picked, so adding compatibility
      // still works before the Phase 32 columns exist (migration-tolerant).
      const row: any = {
        product_id: id!, make_id: compatMakeId,
        model_id: compatModelId || null, year_from: compatYearFrom ? parseInt(compatYearFrom) : null,
        year_to: compatYearTo ? parseInt(compatYearTo) : null, engine: compatEngine || null, notes: null,
      };
      if (compatGenId) row.generation_id = compatGenId;
      if (compatVarId) row.variant_id = compatVarId;
      return getAdapter().products.addCompatibility(row);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['compat', id] }); setCompatModal(false); },
  });

  const removeCompatMutation = useMutation({
    mutationFn: (cid: string) => getAdapter().products.removeCompatibility(cid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['compat', id] }),
  });

  const addSupplierMutation = useMutation({
    mutationFn: () => getAdapter().products.upsertSupplierCode({ company_id: company_id!, product_id: id!, supplier_id: supplierId, supplier_sku: supplierSku, last_purchase_price: null, last_purchase_date: null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['supplier_codes', id] }); setSupplierModal(false); },
  });

  const removeSupplierMutation = useMutation({
    mutationFn: (sid: string) => getAdapter().products.removeSupplierCode(sid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplier_codes', id] }),
  });

  async function handleImageUpload(file: File) {
    if (!id || isNew) return;
    setUploadingImg(true);
    try {
      const url = await getAdapter().products.uploadImage(company_id!, id, file);
      const current = product?.image_urls ?? [];
      await getAdapter().products.update(id, { image_urls: [...current, url] });
      qc.invalidateQueries({ queryKey: ['product', id] });
    } finally { setUploadingImg(false); }
  }

  if (isNew) {
    return <ProductWizard />;
  }

  const makeMap = Object.fromEntries(makes.map((m) => [m.id, m.name]));
  const modelMap = Object.fromEntries((models as VehicleModelRow[]).map((m) => [m.id, m.name]));
  const supplierMap = Object.fromEntries(suppliers.map((s) => [s.id, s.name]));

  const tabs = ['details', 'stock', 'compat', 'suppliers', 'images'] as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1000px' }}>

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <button
            onClick={() => navigate('/products')}
            style={{ fontSize: '12px', color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            ← {t('products.back')}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.01em', lineHeight: 1.2 }}>
              {product?.name ?? t('common.loading')}
            </h1>
            {product && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                padding: '3px 9px', borderRadius: '999px', fontSize: '11px', fontWeight: 600,
                background: product.is_active ? '#f0fdf4' : '#f4f4f5',
                color: product.is_active ? '#15803d' : '#71717a',
                border: `1px solid ${product.is_active ? '#bbf7d0' : '#d4d4d8'}`,
              }}>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: product.is_active ? '#16a34a' : '#a1a1aa', flexShrink: 0 }} />
                {product.is_active ? t('common.active') : t('common.inactive')}
              </span>
            )}
            {product?.sku && (
              <span style={{ fontSize: '12px', fontFamily: 'ui-monospace, monospace', color: '#64748b', background: '#f1f5f9', padding: '2px 8px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                {product.sku}
              </span>
            )}
          </div>
        </div>
        {!editMode && (
          <Button type="button" size="sm" onClick={() => setEditMode(true)} style={{ flexShrink: 0, marginTop: '24px' }}>
            ✎ {t('common.edit')}
          </Button>
        )}
      </div>

      {/* ── Tab nav ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '2px', borderBottom: '1px solid #e4e4e7', marginBottom: '2px' }}>
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '8px 16px',
              fontSize: '13px',
              fontWeight: 500,
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid #7c3aed' : '2px solid transparent',
              marginBottom: '-1px',
              color: activeTab === tab ? '#7c3aed' : '#64748b',
              cursor: 'pointer',
              transition: 'color .12s',
            }}
          >
            {t(`products.tab_${tab}`)}
          </button>
        ))}
      </div>

      {/* ── Details tab ──────────────────────────────────────────────────── */}
      {activeTab === 'details' && (
        <form
          onSubmit={handleSubmit(async (v) => {
            clearBanner();
            await saveMutation.mutateAsync(v as FormValues);
            if (!isNew) setEditMode(false);
          }, onInvalid)}
          style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
        >
          <FormErrorBanner message={bannerMessage} onDismiss={clearBanner} />

          <fieldset
            disabled={!editMode}
            style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '14px', opacity: editMode ? 1 : 0.82 }}
          >

          {/* ── Section 1: Item Information ─────────────────────────── */}
          <div style={S.card}>
            <div style={S.head}>Item Information</div>
            <div style={S.body}>
              <div style={S.row2}>
                <Input label={t('products.name')} required error={errors.name?.message} {...register('name')} />
                <Input label={t('products.name_ar')} dir="rtl" {...register('name_ar')} />
              </div>
              <div style={S.row2}>
                <Textarea label={t('products.description')} {...register('description')} />
                <Textarea label={t('products.description_ar')} dir="rtl" {...register('description_ar')} />
              </div>
            </div>
          </div>

          {/* ── Section 2: Identifiers + Classification (2-col) ──────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: '14px' }}>

            <div style={S.card}>
              <div style={S.head}>Identifiers</div>
              <div style={S.body}>
                <Input label={t('products.sku')} required error={errors.sku?.message} {...register('sku')} />
                <Input label={t('products.barcode')} {...register('barcode')} />
                <Input label={t('products.oe_number')} {...register('oe_number')} />
                <Input label={t('products.replacement_numbers')} hint={t('products.replacement_hint')} {...register('replacement_numbers')} />
              </div>
            </div>

            <div style={S.card}>
              <div style={S.head}>Classification</div>
              <div style={S.body}>
                <Select label={t('products.brand')} options={[{ value: '', label: t('common.none') }, ...brands.map((b) => ({ value: b.id, label: b.name }))]} {...register('brand_id')} />
                <Select label={t('products.category')} options={[{ value: '', label: t('common.none') }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} {...register('category_id')} />
                <Select label={t('products.unit')} options={[{ value: '', label: t('common.none') }, ...units.map((u) => ({ value: u.id, label: u.code }))]} {...register('unit_id')} />
                <Select label={t('products.quality_tier')} options={QUALITY_OPTIONS.map((q) => ({ value: q, label: q ? t(`products.quality_${q}`) : t('common.none') }))} {...register('quality_tier')} />
                <Select
                  label={t('products.item_type')}
                  options={[
                    { value: 'goods', label: t('products.type_goods') },
                    { value: 'service', label: t('products.type_service') },
                  ]}
                  {...register('type')}
                />
              </div>
            </div>
          </div>

          {/* ── Section 3: Sales Information + Purchase Information ──── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: '14px' }}>

            {/* Sales */}
            <div style={S.card}>
              <div style={{ ...S.head, background: '#faf5ff', borderBottom: '1px solid #ede9fe', color: '#5b21b6' }}>
                Sales Information
              </div>
              <div style={S.body}>
                <Input
                  label={t('products.selling_price')}
                  type="number"
                  step="0.01"
                  required
                  error={errors.selling_price?.message}
                  {...register('selling_price')}
                />
                <Select
                  label={t('products.tax_category')}
                  options={TAX_OPTIONS.map((q) => ({ value: q, label: t(`products.tax_${q}`) }))}
                  {...register('tax_category')}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingTop: '2px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#1e293b', userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      style={{ width: '15px', height: '15px', accentColor: '#7c3aed', cursor: 'pointer' }}
                      {...register('requires_serial')}
                    />
                    {t('products.requires_serial')}
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#1e293b', userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      style={{ width: '15px', height: '15px', accentColor: '#7c3aed', cursor: 'pointer' }}
                      {...register('is_active')}
                    />
                    {t('common.active')}
                  </label>
                </div>
              </div>
            </div>

            {/* Purchase */}
            <div style={S.card}>
              <div style={{ ...S.head, background: '#f0fdf4', borderBottom: '1px solid #bbf7d0', color: '#15803d' }}>
                Purchase Information
              </div>
              <div style={S.body}>
                <div>
                  <Select
                    label="Purchase Account"
                    options={[
                      { value: '', label: '(default: 1300 Inventory)' },
                      ...coaAccounts
                        .filter((a) => a.is_active && (a.type === 'asset' || a.type === 'cogs' || a.type === 'expense'))
                        .map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` })),
                    ]}
                    {...register('purchase_account_id')}
                  />
                  <p style={{ marginTop: '4px', fontSize: '11px', color: '#94a3b8', lineHeight: '1.5' }}>
                    Asset accounts (1xxx) also move stock; expense accounts (5xxx/6xxx) post as a pure cost.
                  </p>
                </div>
                <Input label={t('products.min_stock')} type="number" step="0.001" {...register('min_stock_level')} />
              </div>
            </div>

          </div>
          </fieldset>

          {saveMutation.error && (
            <p style={{ fontSize: '12px', color: '#dc2626', padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px' }}>
              {String(saveMutation.error)}
            </p>
          )}

          {editMode && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', paddingTop: '4px' }}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => { reset(); setEditMode(false); }}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" loading={isSubmitting} disabled={isSubmitting}>{t('common.save')}</Button>
            </div>
          )}
        </form>
      )}

      {/* ── Stock tab ────────────────────────────────────────────────────── */}
      {activeTab === 'stock' && !isNew && id && company_id && (
        <ProductStockTab companyId={company_id} productId={id} />
      )}

      {/* ── Compatibility tab ────────────────────────────────────────────── */}
      {activeTab === 'compat' && !isNew && (
        <div className="flex flex-col gap-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => { setCompatMakeId(''); setCompatModelId(''); setCompatGenId(''); setCompatVarId(''); setCompatYearFrom(''); setCompatYearTo(''); setCompatEngine(''); setCompatModal(true); }}>{t('common.add')} {t('products.compatibility')}</Button>
          </div>
          {compat.length === 0
            ? <p className="py-8 text-center text-sm text-ink-tertiary">{t('products.no_compat')}</p>
            : <div className="flex flex-col gap-2">
                {compat.map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded-card border border-border-subtle px-4 py-3">
                    <div className="text-sm">
                      <span className="font-medium">{makeMap[c.make_id] ?? c.make_id}</span>
                      {c.model_id && <span className="ms-2 text-ink-secondary">{modelMap[c.model_id] ?? c.model_id}</span>}
                      {(c.year_from || c.year_to) && <span className="ms-2 text-ink-tertiary">{c.year_from}–{c.year_to}</span>}
                      {c.engine && <span className="ms-2 text-ink-tertiary">{c.engine}</span>}
                      {c.variant_id
                        ? <span className="ms-2 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-brand-700">{t('products.fits_variant')}</span>
                        : c.generation_id
                          ? <span className="ms-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">{t('products.fits_generation')}</span>
                          : null}
                    </div>
                    <button onClick={() => removeCompatMutation.mutate(c.id)} className="text-xs text-danger-500 hover:underline">{t('common.delete')}</button>
                  </div>
                ))}
              </div>
          }
        </div>
      )}

      {/* ── Suppliers tab ────────────────────────────────────────────────── */}
      {activeTab === 'suppliers' && !isNew && (
        <div className="flex flex-col gap-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => { setSupplierId(''); setSupplierSku(''); setSupplierModal(true); }}>{t('common.add')} {t('products.supplier_code')}</Button>
          </div>
          {supplierCodes.length === 0
            ? <p className="py-8 text-center text-sm text-ink-tertiary">{t('products.no_supplier_codes')}</p>
            : <div className="flex flex-col gap-2">
                {supplierCodes.map((sc) => (
                  <div key={sc.id} className="flex items-center justify-between rounded-card border border-border-subtle px-4 py-3">
                    <div className="text-sm">
                      <span className="font-medium">{supplierMap[sc.supplier_id] ?? sc.supplier_id}</span>
                      <span className="ms-3 font-mono text-xs text-ink-secondary">{sc.supplier_sku}</span>
                      {sc.last_purchase_price && <span className="ms-3 text-ink-tertiary">{t('products.last_price')}: {Number(sc.last_purchase_price).toFixed(2)}</span>}
                    </div>
                    <button onClick={() => removeSupplierMutation.mutate(sc.id)} className="text-xs text-danger-500 hover:underline">{t('common.delete')}</button>
                  </div>
                ))}
              </div>
          }
        </div>
      )}

      {/* ── Images tab ──────────────────────────────────────────────────── */}
      {activeTab === 'images' && !isNew && (
        <div className="flex flex-col gap-4">
          <div className="flex justify-end">
            <Button size="sm" loading={uploadingImg} onClick={() => imgRef.current?.click()}>{t('products.upload_image')}</Button>
            <input ref={imgRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); e.target.value = ''; }} />
          </div>
          {(images ?? []).length === 0
            ? <p className="py-8 text-center text-sm text-ink-tertiary">{t('products.no_images')}</p>
            : <div className="grid grid-cols-3 gap-4 sm:grid-cols-4">
                {(images ?? []).map((url, i) => (
                  <div key={i} className="aspect-square overflow-hidden rounded-card border border-border-subtle">
                    <img src={url} alt={`Product image ${i + 1}`} className="h-full w-full object-cover" />
                  </div>
                ))}
              </div>
          }
        </div>
      )}

      {isNew && activeTab !== 'details' && (
        <p className="py-8 text-center text-sm text-ink-tertiary">{t('products.save_first')}</p>
      )}

      {/* ── Compatibility modal ─────────────────────────────────────────── */}
      <Modal open={compatModal} onClose={() => setCompatModal(false)} title={t('products.add_compat')}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-ink-primary">{t('products.make')} <span className="text-danger-500">*</span></label>
            <select className="h-10 rounded-input border border-border-strong bg-surface-subtle px-4 text-sm focus:border-brand-500 focus:outline-none" value={compatMakeId} onChange={(e) => { setCompatMakeId(e.target.value); setCompatModelId(''); setCompatGenId(''); setCompatVarId(''); }}>
              <option value="">{t('common.select')}</option>
              {makes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          {compatMakeId && (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-ink-primary">{t('products.model')}</label>
              <select className="h-10 rounded-input border border-border-strong bg-surface-subtle px-4 text-sm focus:border-brand-500 focus:outline-none" value={compatModelId} onChange={(e) => { setCompatModelId(e.target.value); setCompatGenId(''); setCompatVarId(''); }}>
                <option value="">{t('products.all_models')}</option>
                {(models as VehicleModelRow[]).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          )}
          {compatModelId && (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-ink-primary">{t('products.generation')}</label>
              <select className="h-10 rounded-input border border-border-strong bg-surface-subtle px-4 text-sm focus:border-brand-500 focus:outline-none" value={compatGenId} onChange={(e) => { setCompatGenId(e.target.value); setCompatVarId(''); }}>
                <option value="">{t('products.all_generations')}</option>
                {compatGenerations.map((g) => <option key={g.id} value={g.id}>{g.name}{(g.year_from || g.year_to) ? ` (${g.year_from ?? '…'}–${g.year_to ?? 'now'})` : ''}</option>)}
              </select>
            </div>
          )}
          {compatGenId && (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-ink-primary">{t('products.variant')}</label>
              <select
                className="h-10 rounded-input border border-border-strong bg-surface-subtle px-4 text-sm focus:border-brand-500 focus:outline-none"
                value={compatVarId}
                onChange={(e) => {
                  const vid = e.target.value;
                  setCompatVarId(vid);
                  const v = compatVariants.find((x) => x.id === vid);
                  if (v) {
                    // Denormalise the variant into the free-text engine/year fields so the
                    // saved row stays human-readable in the list without a join.
                    const eng = compatEngines.find((en) => en.id === v.engine_id);
                    const desc = v.label || [eng?.engine_code, v.fuel_type, v.transmission].filter(Boolean).join(' · ');
                    if (desc) setCompatEngine(desc);
                    if (v.year_from) setCompatYearFrom(String(v.year_from));
                    if (v.year_to) setCompatYearTo(String(v.year_to));
                  }
                }}
              >
                <option value="">{t('products.all_variants')}</option>
                {compatVariants.map((v) => {
                  const eng = compatEngines.find((en) => en.id === v.engine_id);
                  const lbl = v.label || [eng?.engine_code, v.fuel_type, v.transmission].filter(Boolean).join(' · ') || t('products.variant');
                  return <option key={v.id} value={v.id}>{lbl}</option>;
                })}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('products.year_from')} type="number" value={compatYearFrom} onChange={(e) => setCompatYearFrom(e.target.value)} />
            <Input label={t('products.year_to')} type="number" value={compatYearTo} onChange={(e) => setCompatYearTo(e.target.value)} />
          </div>
          <Input label={t('products.engine')} value={compatEngine} onChange={(e) => setCompatEngine(e.target.value)} />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setCompatModal(false)}>{t('common.cancel')}</Button>
            <Button loading={addCompatMutation.isPending} disabled={!compatMakeId} onClick={() => addCompatMutation.mutate()}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>

      {/* ── Supplier code modal ─────────────────────────────────────────── */}
      <Modal open={supplierModal} onClose={() => setSupplierModal(false)} title={t('products.add_supplier_code')}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-ink-primary">{t('products.supplier')} <span className="text-danger-500">*</span></label>
            <select className="h-10 rounded-input border border-border-strong bg-surface-subtle px-4 text-sm focus:border-brand-500 focus:outline-none" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">{t('common.select')}</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <Input label={t('products.supplier_sku')} required value={supplierSku} onChange={(e) => setSupplierSku(e.target.value)} />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setSupplierModal(false)}>{t('common.cancel')}</Button>
            <Button loading={addSupplierMutation.isPending} disabled={!supplierId || !supplierSku} onClick={() => addSupplierMutation.mutate()}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>

    </div>
  );
}
