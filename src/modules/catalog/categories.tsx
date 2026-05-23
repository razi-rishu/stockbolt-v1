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
import ImportExportButton from '@/modules/settings/import-export/ImportExportButton';
import type { CategoryRow } from '@/data/adapter';

const schema = z.object({
  name:      z.string().min(1, 'Required'),
  name_ar:   z.string(),
  parent_id: z.string().nullable(),
});
type FormValues = z.infer<typeof schema>;

export default function CategoriesPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['categories', company_id],
    queryFn: () => getAdapter().categories.list(company_id!),
    enabled: !!company_id,
  });

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', name_ar: '', parent_id: null },
  });

  function openAdd() {
    setEditing(null);
    reset({ name: '', name_ar: '', parent_id: null });
    setOpen(true);
  }

  function openEdit(row: CategoryRow) {
    setEditing(row);
    reset({ name: row.name, name_ar: row.name_ar ?? '', parent_id: row.parent_id ?? null });
    setOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const row = { company_id: company_id!, ...values, name_ar: values.name_ar || null, parent_id: values.parent_id || null };
      if (editing) {
        await getAdapter().categories.update(editing.id, row);
      } else {
        await getAdapter().categories.create(row);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories', company_id] });
      setOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => getAdapter().categories.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories', company_id] }),
  });

  const parentMap = Object.fromEntries(categories.map((c) => [c.id, c.name]));

  const columns: Column<CategoryRow>[] = [
    { key: 'name', header: t('catalog.categories.name'), render: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'name_ar', header: t('catalog.categories.name_ar'), render: (r) => <span dir="rtl">{r.name_ar ?? '—'}</span> },
    { key: 'parent', header: t('catalog.categories.parent'), render: (r) => r.parent_id ? parentMap[r.parent_id] ?? '—' : '—' },
    {
      key: 'actions', header: '', width: '100px',
      render: (r) => (
        <div className="flex gap-2">
          <button onClick={(e) => { e.stopPropagation(); openEdit(r); }} className="text-xs text-brand-600 hover:underline">{t('common.edit')}</button>
          <button onClick={(e) => { e.stopPropagation(); if (confirm(t('common.confirm_delete'))) deleteMutation.mutate(r.id); }} className="text-xs text-danger-500 hover:underline">{t('common.delete')}</button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink-primary">{t('catalog.categories.title')}</h1>
        <div className="flex gap-2">
          <ImportExportButton moduleKey="categories" />
          <Button size="sm" onClick={openAdd}>{t('common.add')} {t('catalog.categories.singular')}</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-ink-tertiary">{t('common.loading')}</div>
      ) : (
        <Table columns={columns} rows={categories} keyFn={(r) => r.id} emptyMessage={t('catalog.categories.empty')} />
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? t('catalog.categories.edit') : t('catalog.categories.add')}>
        <form onSubmit={handleSubmit((v) => saveMutation.mutateAsync(v))} className="flex flex-col gap-4">
          <Input label={t('catalog.categories.name')} required error={errors.name?.message} {...register('name')} />
          <Input label={t('catalog.categories.name_ar')} dir="rtl" {...register('name_ar')} />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-ink-primary">{t('catalog.categories.parent')}</label>
            <select className="h-10 rounded-input border border-border-strong bg-surface-subtle px-4 text-sm focus:border-brand-500 focus:outline-none" {...register('parent_id')}>
              <option value="">{t('catalog.categories.no_parent')}</option>
              {categories.filter((c) => c.id !== editing?.id).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
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
