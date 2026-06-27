import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';
import { Select } from '@/ui/select';
import { Modal } from '@/ui/modal';
import { Table, type Column } from '@/ui/table';
import ImportExportButton from '@/modules/settings/import-export/ImportExportButton';
import type { BrandRow } from '@/data/adapter';
import { useFormInvalidBanner } from '@/hooks/use-form-invalid-banner';
import { FormErrorBanner } from '@/ui/form-error-banner';

const schema = z.object({
  name:         z.string().min(1, 'Required'),
  name_ar:      z.string(),
  country:      z.string(),
  manufacturer: z.string(),
  website:      z.string(),
  description:  z.string(),
});
type FormValues = z.infer<typeof schema>;

const EMPTY: FormValues = { name: '', name_ar: '', country: '', manufacturer: '', website: '', description: '' };

export default function BrandsPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BrandRow | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [mergeOpen, setMergeOpen] = useState(false);
  const [keepId, setKeepId] = useState('');
  const [dupId, setDupId] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: brands = [], isLoading } = useQuery({
    queryKey: ['brands', company_id],
    queryFn: () => getAdapter().brands.list(company_id!),
    enabled: !!company_id,
  });

  const { onInvalid, bannerMessage, clearBanner } = useFormInvalidBanner('brands');
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY,
  });

  function openAdd() {
    setEditing(null);
    reset(EMPTY);
    setOpen(true);
  }

  function openEdit(row: BrandRow) {
    setEditing(row);
    const r = row as any;
    reset({
      name: row.name, name_ar: row.name_ar ?? '',
      country: r.country ?? '', manufacturer: r.manufacturer ?? '',
      website: r.website ?? '', description: r.description ?? '',
    });
    setOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      // New enrichment fields are only sent when filled, so saving still works
      // before the Phase 32 (C1) brand columns exist (migration-tolerant).
      const row: any = { company_id: company_id!, name: values.name, name_ar: values.name_ar || null };
      if (values.country) row.country = values.country;
      if (values.manufacturer) row.manufacturer = values.manufacturer;
      if (values.website) row.website = values.website;
      if (values.description) row.description = values.description;
      if (editing) {
        await getAdapter().brands.update(editing.id, row);
      } else {
        await getAdapter().brands.create(row);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brands', company_id] });
      setOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => getAdapter().brands.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['brands', company_id] }),
  });

  const mergeMutation = useMutation({
    mutationFn: () => getAdapter().brands.merge(keepId, dupId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brands', company_id] });
      qc.invalidateQueries({ queryKey: ['products', company_id] });
      setMergeOpen(false);
      setKeepId(''); setDupId('');
    },
  });

  async function handleLogoUpload(brandId: string, file: File) {
    setUploading(brandId);
    try {
      const url = await getAdapter().brands.uploadLogo(company_id!, brandId, file);
      await getAdapter().brands.update(brandId, { logo_url: url });
      qc.invalidateQueries({ queryKey: ['brands', company_id] });
    } finally {
      setUploading(null);
    }
  }

  const q = search.trim().toLowerCase();
  const filtered = q
    ? brands.filter((b) => {
        const r = b as any;
        return [b.name, r.manufacturer, r.country].filter(Boolean).some((s: string) => s.toLowerCase().includes(q));
      })
    : brands;

  const columns: Column<BrandRow>[] = [
    {
      key: 'logo', header: '', width: '56px',
      render: (r) => (
        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-card border border-border-subtle bg-surface-muted">
          {r.logo_url
            ? <img src={r.logo_url} alt={r.name} className="h-full w-full object-contain" />
            : <span className="text-xs font-bold text-ink-tertiary">{r.name[0]}</span>}
        </div>
      ),
    },
    {
      key: 'name', header: t('catalog.brands.name'),
      render: (r) => (
        <div>
          <div className="font-medium">{r.name}</div>
          {r.name_ar && <div className="text-xs text-ink-tertiary" dir="rtl">{r.name_ar}</div>}
        </div>
      ),
    },
    { key: 'manufacturer', header: t('catalog.brands.manufacturer'), render: (r) => (r as any).manufacturer ?? '—' },
    { key: 'country', header: t('catalog.brands.country'), render: (r) => (r as any).country ?? '—' },
    {
      key: 'actions', header: '', width: '170px', align: 'end',
      render: (r) => (
        <div className="flex justify-end gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); fileRef.current?.setAttribute('data-brand-id', r.id); fileRef.current?.click(); }}
            disabled={uploading === r.id}
            className="text-xs text-ink-secondary hover:underline disabled:opacity-50"
          >
            {uploading === r.id ? t('common.loading') : t('catalog.brands.upload_logo')}
          </button>
          <button onClick={(e) => { e.stopPropagation(); openEdit(r); }} className="text-xs text-brand-600 hover:underline">{t('common.edit')}</button>
          <button onClick={(e) => { e.stopPropagation(); if (confirm(t('common.confirm_delete'))) deleteMutation.mutate(r.id); }} className="text-xs text-danger-500 hover:underline">{t('common.delete')}</button>
        </div>
      ),
    },
  ];

  const brandOptions = [{ value: '', label: t('common.select') }, ...brands.map((b) => ({ value: b.id, label: b.name }))];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink-primary">{t('catalog.brands.title')}</h1>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => { setKeepId(''); setDupId(''); setMergeOpen(true); }}>{t('catalog.brands.merge')}</Button>
          <ImportExportButton moduleKey="brands" />
          <Button size="sm" onClick={openAdd}>{t('common.add')} {t('catalog.brands.singular')}</Button>
        </div>
      </div>

      <Input placeholder={t('catalog.brands.search')} value={search} onChange={(e) => setSearch(e.target.value)} className="w-72" />

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const brandId = fileRef.current?.getAttribute('data-brand-id');
          if (file && brandId) handleLogoUpload(brandId, file);
          e.target.value = '';
        }}
      />

      {isLoading
        ? <div className="py-12 text-center text-ink-tertiary">{t('common.loading')}</div>
        : <Table columns={columns} rows={filtered} keyFn={(r) => r.id} emptyMessage={t('catalog.brands.empty')} />
      }

      {/* Add / Edit modal */}
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? t('catalog.brands.edit') : t('catalog.brands.add')}>
        <form onSubmit={handleSubmit((v) => { clearBanner(); return saveMutation.mutateAsync(v); }, onInvalid)} className="flex flex-col gap-4">
          <FormErrorBanner message={bannerMessage} onDismiss={clearBanner} />
          <Input label={t('catalog.brands.name')} required error={errors.name?.message} {...register('name')} />
          <Input label={t('catalog.brands.name_ar')} dir="rtl" {...register('name_ar')} />
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('catalog.brands.manufacturer')} {...register('manufacturer')} />
            <Input label={t('catalog.brands.country')} {...register('country')} />
          </div>
          <Input label={t('catalog.brands.website')} placeholder="https://" {...register('website')} />
          <Textarea label={t('catalog.brands.description')} rows={2} {...register('description')} />
          {saveMutation.error && <p className="text-xs text-danger-500">{String(saveMutation.error)}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={isSubmitting}>{t('common.save')}</Button>
          </div>
        </form>
      </Modal>

      {/* Merge duplicates modal */}
      <Modal open={mergeOpen} onClose={() => setMergeOpen(false)} title={t('catalog.brands.merge_title')}>
        <div className="flex flex-col gap-4">
          <Select label={t('catalog.brands.merge_keep')} options={brandOptions} value={keepId} onChange={(e) => setKeepId(e.target.value)} />
          <Select label={t('catalog.brands.merge_dup')} options={brandOptions} value={dupId} onChange={(e) => setDupId(e.target.value)} />
          <p className="rounded-card border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{t('catalog.brands.merge_warn')}</p>
          {keepId && dupId && keepId === dupId && <p className="text-xs text-danger-500">{t('catalog.brands.merge_same')}</p>}
          {mergeMutation.error && <p className="text-xs text-danger-500">{String(mergeMutation.error)}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setMergeOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="danger" loading={mergeMutation.isPending} disabled={!keepId || !dupId || keepId === dupId} onClick={() => mergeMutation.mutate()}>{t('catalog.brands.merge_cta')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
