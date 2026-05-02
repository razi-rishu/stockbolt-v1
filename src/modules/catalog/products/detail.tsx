import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import { Badge } from '@/ui/badge';
import { Modal } from '@/ui/modal';
import type { ProductCompatibilityRow, ProductSupplierCodeRow, ContactRow, VehicleMakeRow, VehicleModelRow } from '@/data/adapter';

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
  quality_tier:       z.string().nullable(),
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

export default function ProductDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const { company_id } = useAuthStore();
  const qc = useQueryClient();
  const imgRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<'details' | 'compat' | 'suppliers' | 'images'>('details');
  const [compatModal, setCompatModal] = useState(false);
  const [supplierModal, setSupplierModal] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);

  // Compatibility form state
  const [compatMakeId, setCompatMakeId] = useState('');
  const [compatModelId, setCompatModelId] = useState('');
  const [compatYearFrom, setCompatYearFrom] = useState('');
  const [compatYearTo, setCompatYearTo] = useState('');
  const [compatEngine, setCompatEngine] = useState('');

  // Supplier code form state
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
  const { data: makes = [] } = useQuery<VehicleMakeRow[]>({ queryKey: ['vehicle_makes', company_id], queryFn: () => getAdapter().vehicleMakes.list(company_id!), enabled: !!company_id });
  const { data: models = [] } = useQuery<VehicleModelRow[]>({ queryKey: ['vehicle_models', compatMakeId], queryFn: () => getAdapter().vehicleMakes.listModels(compatMakeId), enabled: !!compatMakeId });
  const { data: suppliers = [] } = useQuery<ContactRow[]>({ queryKey: ['contacts', company_id, 'supplier'], queryFn: () => getAdapter().contacts.list(company_id!, 'supplier'), enabled: !!company_id });
  const { data: compat = [] } = useQuery<ProductCompatibilityRow[]>({ queryKey: ['compat', id], queryFn: () => getAdapter().products.listCompatibility(id!), enabled: !isNew && !!id });
  const { data: supplierCodes = [] } = useQuery<ProductSupplierCodeRow[]>({ queryKey: ['supplier_codes', id], queryFn: () => getAdapter().products.listSupplierCodes(id!), enabled: !isNew && !!id });
  const { data: images } = useQuery({ queryKey: ['product', id], queryFn: () => getAdapter().products.getById(id!), enabled: !isNew && !!id, select: (p) => p?.image_urls ?? [] });

  const { register, handleSubmit, formState: { errors, isSubmitting, isDirty } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    values: product ? {
      sku: product.sku, name: product.name, name_ar: product.name_ar ?? '',
      description: product.description ?? '', description_ar: product.description_ar ?? '',
      oe_number: product.oe_number ?? '', replacement_numbers: (product.replacement_numbers ?? []).join(', '),
      brand_id: product.brand_id ?? null, category_id: product.category_id ?? null, unit_id: product.unit_id ?? null,
      quality_tier: product.quality_tier ?? null, selling_price: Number(product.selling_price),
      tax_category: product.tax_category as 'standard' | 'zero_rated' | 'exempt',
      min_stock_level: Number(product.min_stock_level), requires_serial: product.requires_serial, is_active: product.is_active, barcode: product.barcode ?? '',
    } : { sku: '', name: '', name_ar: '', description: '', description_ar: '', oe_number: '', replacement_numbers: '', brand_id: null, category_id: null, unit_id: null, quality_tier: null, selling_price: 0, tax_category: 'standard', min_stock_level: 0, requires_serial: false, is_active: true, barcode: '' },
  });

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const replacements = values.replacement_numbers.split(',').map((s) => s.trim()).filter(Boolean);
      const row = {
        company_id: company_id!, sku: values.sku, name: values.name, name_ar: values.name_ar || null,
        description: values.description || null, description_ar: values.description_ar || null,
        oe_number: values.oe_number || null, replacement_numbers: replacements.length ? replacements : null,
        brand_id: values.brand_id || null, category_id: values.category_id || null, unit_id: values.unit_id || null,
        quality_tier: (values.quality_tier as 'genuine' | 'oem' | 'premium' | 'economy' | null) || null,
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
    mutationFn: () => getAdapter().products.addCompatibility({
      product_id: id!, make_id: compatMakeId,
      model_id: compatModelId || null, year_from: compatYearFrom ? parseInt(compatYearFrom) : null,
      year_to: compatYearTo ? parseInt(compatYearTo) : null, engine: compatEngine || null, notes: null,
    }),
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

  const makeMap = Object.fromEntries(makes.map((m) => [m.id, m.name]));
  const modelMap = Object.fromEntries((models as VehicleModelRow[]).map((m) => [m.id, m.name]));
  const supplierMap = Object.fromEntries(suppliers.map((s) => [s.id, s.name]));

  const tabs = ['details', 'compat', 'suppliers', 'images'] as const;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/products')} className="text-sm text-ink-secondary hover:text-ink-primary">← {t('products.back')}</button>
        <h1 className="text-xl font-bold text-ink-primary">{isNew ? t('products.new') : (product?.name ?? t('common.loading'))}</h1>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 border-b border-border-subtle">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${activeTab === tab ? 'border-brand-500 text-brand-600' : 'border-transparent text-ink-secondary hover:text-ink-primary'}`}
          >
            {t(`products.tab_${tab}`)}
          </button>
        ))}
      </div>

      {activeTab === 'details' && (
        <form onSubmit={handleSubmit((v) => saveMutation.mutateAsync(v))} className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label={t('products.sku')} required error={errors.sku?.message} {...register('sku')} />
            <Input label={t('products.barcode')} {...register('barcode')} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label={t('products.name')} required error={errors.name?.message} {...register('name')} />
            <Input label={t('products.name_ar')} dir="rtl" {...register('name_ar')} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Textarea label={t('products.description')} {...register('description')} />
            <Textarea label={t('products.description_ar')} dir="rtl" {...register('description_ar')} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label={t('products.oe_number')} {...register('oe_number')} />
            <Input label={t('products.replacement_numbers')} hint={t('products.replacement_hint')} {...register('replacement_numbers')} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Select label={t('products.brand')} options={[{ value: '', label: t('common.none') }, ...brands.map((b) => ({ value: b.id, label: b.name }))]} {...register('brand_id')} />
            <Select label={t('products.category')} options={[{ value: '', label: t('common.none') }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} {...register('category_id')} />
            <Select label={t('products.unit')} options={[{ value: '', label: t('common.none') }, ...units.map((u) => ({ value: u.id, label: u.code }))]} {...register('unit_id')} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Select label={t('products.quality_tier')} options={QUALITY_OPTIONS.map((q) => ({ value: q, label: q ? t(`products.quality_${q}`) : t('common.none') }))} {...register('quality_tier')} />
            <Input label={t('products.selling_price')} type="number" step="0.01" required error={errors.selling_price?.message} {...register('selling_price')} />
            <Select label={t('products.tax_category')} options={TAX_OPTIONS.map((q) => ({ value: q, label: t(`products.tax_${q}`) }))} {...register('tax_category')} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label={t('products.min_stock')} type="number" step="0.001" {...register('min_stock_level')} />
            <div className="flex flex-col gap-3 pt-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="h-4 w-4 rounded border-border-strong text-brand-500" {...register('requires_serial')} />
                <span className="text-sm text-ink-primary">{t('products.requires_serial')}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="h-4 w-4 rounded border-border-strong text-brand-500" {...register('is_active')} />
                <span className="text-sm text-ink-primary">{t('common.active')}</span>
              </label>
            </div>
          </div>
          {saveMutation.error && <p className="text-sm text-danger-500">{String(saveMutation.error)}</p>}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => navigate('/products')}>{t('common.cancel')}</Button>
            <Button type="submit" loading={isSubmitting} disabled={!isNew && !isDirty}>{t('common.save')}</Button>
          </div>
        </form>
      )}

      {activeTab === 'compat' && !isNew && (
        <div className="flex flex-col gap-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => { setCompatMakeId(''); setCompatModelId(''); setCompatYearFrom(''); setCompatYearTo(''); setCompatEngine(''); setCompatModal(true); }}>{t('common.add')} {t('products.compatibility')}</Button>
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
                    </div>
                    <button onClick={() => removeCompatMutation.mutate(c.id)} className="text-xs text-danger-500 hover:underline">{t('common.delete')}</button>
                  </div>
                ))}
              </div>
          }
        </div>
      )}

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

      {/* Compatibility modal */}
      <Modal open={compatModal} onClose={() => setCompatModal(false)} title={t('products.add_compat')}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-ink-primary">{t('products.make')} <span className="text-danger-500">*</span></label>
            <select className="h-10 rounded-input border border-border-strong bg-surface-subtle px-4 text-sm focus:border-brand-500 focus:outline-none" value={compatMakeId} onChange={(e) => { setCompatMakeId(e.target.value); setCompatModelId(''); }}>
              <option value="">{t('common.select')}</option>
              {makes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          {compatMakeId && (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-ink-primary">{t('products.model')}</label>
              <select className="h-10 rounded-input border border-border-strong bg-surface-subtle px-4 text-sm focus:border-brand-500 focus:outline-none" value={compatModelId} onChange={(e) => setCompatModelId(e.target.value)}>
                <option value="">{t('products.all_models')}</option>
                {(models as VehicleModelRow[]).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
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

      {/* Supplier code modal */}
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

      {/* Status badge on header */}
      {product && <div className="fixed bottom-4 end-6"><Badge variant={product.is_active ? 'success' : 'muted'}>{product.is_active ? t('common.active') : t('common.inactive')}</Badge></div>}
    </div>
  );
}
