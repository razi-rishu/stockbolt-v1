import { useState } from 'react';
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
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import { Badge } from '@/ui/badge';
import ImportExportButton from '@/modules/settings/import-export/ImportExportButton';
import type { PriceLevelRow } from '@/data/adapter';

const schema = z.object({
  name:           z.string().min(1, 'Required'),
  name_ar:        z.string(),
  markup_percent: z.string(),
  is_default:     z.boolean(),
  sort_order:     z.coerce.number(),
});
type FormValues = z.infer<typeof schema>;

export default function PriceLevelsPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PriceLevelRow | null>(null);

  const { data: levels = [], isLoading } = useQuery({
    queryKey: ['price_levels', company_id],
    queryFn: () => getAdapter().priceLevels.list(company_id!),
    enabled: !!company_id,
  });

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema) as any,
    defaultValues: { name: '', name_ar: '', markup_percent: '', is_default: false, sort_order: 0 },
  });

  function openAdd() { setEditing(null); reset({ name: '', name_ar: '', markup_percent: '', is_default: false, sort_order: 0 }); setOpen(true); }
  function openEdit(row: PriceLevelRow) {
    setEditing(row);
    reset({ name: row.name, name_ar: row.name_ar ?? '', markup_percent: row.markup_percent != null ? String(row.markup_percent) : '', is_default: row.is_default, sort_order: row.sort_order });
    setOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const markup = values.markup_percent !== '' ? parseFloat(values.markup_percent) : null;
      const row = { company_id: company_id!, name: values.name, name_ar: values.name_ar || null, markup_percent: markup, is_default: values.is_default, sort_order: values.sort_order, is_active: true };
      if (editing) await getAdapter().priceLevels.update(editing.id, row);
      else await getAdapter().priceLevels.create(row);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['price_levels', company_id] }); setOpen(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => getAdapter().priceLevels.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['price_levels', company_id] }),
  });

  const columns: Column<PriceLevelRow>[] = [
    { key: 'name', header: t('settings.price_levels.name'), render: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'name_ar', header: t('settings.price_levels.name_ar'), render: (r) => <span dir="rtl">{r.name_ar ?? '—'}</span> },
    { key: 'markup', header: t('settings.price_levels.markup'), render: (r) => r.markup_percent != null ? `${r.markup_percent}%` : '—' },
    { key: 'default', header: '', width: '80px', render: (r) => r.is_default ? <Badge variant="brand">{t('common.default')}</Badge> : null },
    {
      key: 'actions', header: '', width: '100px',
      render: (r) => (
        <div className="flex gap-2">
          <button onClick={(e) => { e.stopPropagation(); openEdit(r); }} className="text-xs text-brand-600 hover:underline">{t('common.edit')}</button>
          {!r.is_default && <button onClick={(e) => { e.stopPropagation(); if (confirm(t('common.confirm_delete'))) deleteMutation.mutate(r.id); }} className="text-xs text-danger-500 hover:underline">{t('common.delete')}</button>}
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title={t('settings.price_levels.title')}
        subtitle={t('settings.price_levels.description')}
        actions={
          <div style={{ display: 'flex', gap: '8px' }}>
            <ImportExportButton moduleKey="priceLevels" />
            <Button size="sm" onClick={openAdd}>+ {t('common.add')} {t('settings.price_levels.singular')}</Button>
          </div>
        }
      />

      {isLoading
        ? <div style={{ padding: '48px 0', textAlign: 'center', fontSize: '13px', color: theme.inkFaint }}>{t('common.loading')}</div>
        : <Table columns={columns} rows={levels} keyFn={(r) => r.id} emptyMessage={t('settings.price_levels.empty')} />
      }

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? t('settings.price_levels.edit') : t('settings.price_levels.add')}>
        <form onSubmit={handleSubmit((v) => saveMutation.mutateAsync(v as FormValues))} className="flex flex-col gap-4">
          <Input label={t('settings.price_levels.name')} required error={errors.name?.message} {...register('name')} />
          <Input label={t('settings.price_levels.name_ar')} dir="rtl" {...register('name_ar')} />
          <Input label={t('settings.price_levels.markup')} type="number" step="0.01" hint={t('settings.price_levels.markup_hint')} {...register('markup_percent')} />
          <Input label={t('settings.price_levels.sort_order')} type="number" {...register('sort_order')} />
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="h-4 w-4 rounded border-border-strong text-brand-500" {...register('is_default')} />
            <span className="text-sm text-ink-primary">{t('settings.price_levels.set_default')}</span>
          </label>
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
