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
import { Badge } from '@/ui/badge';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import type { WarehouseRow } from '@/data/adapter';

const schema = z.object({
  code:     z.string().min(1, 'Required'),
  name:     z.string().min(1, 'Required'),
  name_ar:  z.string(),
  address:  z.string(),
  city:     z.string(),
  phone:    z.string(),
  is_default: z.boolean(),
  is_active:  z.boolean(),
});
type FormValues = z.infer<typeof schema>;

export default function WarehousesPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<WarehouseRow | null>(null);

  const { data: warehouses = [], isLoading } = useQuery({
    queryKey: ['warehouses', company_id],
    queryFn: () => getAdapter().warehouses.list(company_id!),
    enabled: !!company_id,
  });

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { code: '', name: '', name_ar: '', address: '', city: '', phone: '', is_default: false, is_active: true },
  });

  function openAdd() {
    setEditing(null);
    reset({ code: '', name: '', name_ar: '', address: '', city: '', phone: '', is_default: false, is_active: true });
    setOpen(true);
  }

  function openEdit(row: WarehouseRow) {
    setEditing(row);
    reset({ code: row.code, name: row.name, name_ar: row.name_ar ?? '', address: row.address ?? '', city: row.city ?? '', phone: row.phone ?? '', is_default: row.is_default, is_active: row.is_active });
    setOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const row = { company_id: company_id!, ...values, name_ar: values.name_ar || null, address: values.address || null, city: values.city || null, phone: values.phone || null };
      if (editing) await getAdapter().warehouses.update(editing.id, row);
      else await getAdapter().warehouses.create(row);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['warehouses', company_id] }); setOpen(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => getAdapter().warehouses.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouses', company_id] }),
  });

  const columns: Column<WarehouseRow>[] = [
    { key: 'code', header: t('settings.warehouses.code'), width: '80px', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: 'name', header: t('settings.warehouses.name'), render: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'name_ar', header: t('settings.warehouses.name_ar'), render: (r) => <span dir="rtl">{r.name_ar ?? '—'}</span> },
    { key: 'city', header: t('settings.warehouses.city'), render: (r) => r.city ?? '—' },
    { key: 'default', header: '', width: '80px', render: (r) => r.is_default ? <Badge variant="brand">{t('common.default')}</Badge> : null },
    { key: 'status', header: '', width: '80px', render: (r) => <Badge variant={r.is_active ? 'success' : 'muted'}>{r.is_active ? t('common.active') : t('common.inactive')}</Badge> },
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
        title={t('settings.warehouses.title')}
        subtitle={`${warehouses.length} ${warehouses.length === 1 ? 'warehouse' : 'warehouses'}`}
        actions={<Button size="sm" onClick={openAdd}>+ {t('common.add')} {t('settings.warehouses.singular')}</Button>}
      />

      {isLoading
        ? <div style={{ padding: '48px 0', textAlign: 'center', fontSize: '13px', color: theme.inkFaint }}>{t('common.loading')}</div>
        : <Table columns={columns} rows={warehouses} keyFn={(r) => r.id} emptyMessage={t('settings.warehouses.empty')} />
      }

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? t('settings.warehouses.edit') : t('settings.warehouses.add')} width="lg">
        <form onSubmit={handleSubmit((v) => saveMutation.mutateAsync(v))} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('settings.warehouses.code')} required error={errors.code?.message} {...register('code')} />
            <Input label={t('settings.warehouses.name')} required error={errors.name?.message} {...register('name')} />
          </div>
          <Input label={t('settings.warehouses.name_ar')} dir="rtl" {...register('name_ar')} />
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('settings.warehouses.address')} {...register('address')} />
            <Input label={t('settings.warehouses.city')} {...register('city')} />
          </div>
          <Input label={t('settings.warehouses.phone')} {...register('phone')} />
          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="h-4 w-4 rounded border-border-strong text-brand-500" {...register('is_default')} />
              <span className="text-sm text-ink-primary">{t('settings.warehouses.set_default')}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="h-4 w-4 rounded border-border-strong text-brand-500" {...register('is_active')} />
              <span className="text-sm text-ink-primary">{t('common.active')}</span>
            </label>
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
