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
import { Modal } from '@/ui/modal';
import { Table, type Column } from '@/ui/table';
import ImportExportButton from '@/modules/settings/import-export/ImportExportButton';
import type { BrandRow } from '@/data/adapter';

const schema = z.object({
  name:    z.string().min(1, 'Required'),
  name_ar: z.string(),
});
type FormValues = z.infer<typeof schema>;

export default function BrandsPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BrandRow | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: brands = [], isLoading } = useQuery({
    queryKey: ['brands', company_id],
    queryFn: () => getAdapter().brands.list(company_id!),
    enabled: !!company_id,
  });

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', name_ar: '' },
  });

  function openAdd() {
    setEditing(null);
    reset({ name: '', name_ar: '' });
    setOpen(true);
  }

  function openEdit(row: BrandRow) {
    setEditing(row);
    reset({ name: row.name, name_ar: row.name_ar ?? '' });
    setOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const row = { company_id: company_id!, name: values.name, name_ar: values.name_ar || null };
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
    { key: 'name', header: t('catalog.brands.name'), render: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'name_ar', header: t('catalog.brands.name_ar'), render: (r) => <span dir="rtl">{r.name_ar ?? '—'}</span> },
    {
      key: 'actions', header: '', width: '160px',
      render: (r) => (
        <div className="flex gap-2">
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink-primary">{t('catalog.brands.title')}</h1>
        <div className="flex gap-2">
          <ImportExportButton moduleKey="brands" />
          <Button size="sm" onClick={openAdd}>{t('common.add')} {t('catalog.brands.singular')}</Button>
        </div>
      </div>

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
        : <Table columns={columns} rows={brands} keyFn={(r) => r.id} emptyMessage={t('catalog.brands.empty')} />
      }

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? t('catalog.brands.edit') : t('catalog.brands.add')}>
        <form onSubmit={handleSubmit((v) => saveMutation.mutateAsync(v))} className="flex flex-col gap-4">
          <Input label={t('catalog.brands.name')} required error={errors.name?.message} {...register('name')} />
          <Input label={t('catalog.brands.name_ar')} dir="rtl" {...register('name_ar')} />
          {saveMutation.error && <p className="text-xs text-danger-500">{String(saveMutation.error)}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={isSubmitting}>{t('common.save')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
