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
import type { Column } from '@/ui/table';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import { Plus } from 'lucide-react';
import ImportExportButton from '@/modules/settings/import-export/ImportExportButton';
import type { UnitRow } from '@/data/adapter';
import { useFormInvalidBanner } from '@/hooks/use-form-invalid-banner';
import { FormErrorBanner } from '@/ui/form-error-banner';
import { useArabicEnabled } from '@/hooks/use-arabic-enabled';

const schema = z.object({
  code:    z.string().min(1, 'Required'),
  name:    z.string().min(1, 'Required'),
  name_ar: z.string(),
});
type FormValues = z.infer<typeof schema>;

export default function UnitsOfMeasurePage() {
  const { t } = useTranslation();
  const arabicOn = useArabicEnabled();   // India companies: English only
  const { company_id } = useAuthStore();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UnitRow | null>(null);

  const { data: units = [], isLoading } = useQuery({
    queryKey: ['units', company_id],
    queryFn: () => getAdapter().units.list(company_id!),
    enabled: !!company_id,
  });

  const { onInvalid, bannerMessage, clearBanner } = useFormInvalidBanner('units-of-measure');
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { code: '', name: '', name_ar: '' },
  });

  function openAdd() { setEditing(null); reset({ code: '', name: '', name_ar: '' }); setOpen(true); }
  function openEdit(row: UnitRow) { setEditing(row); reset({ code: row.code, name: row.name, name_ar: row.name_ar ?? '' }); setOpen(true); }

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const row = { company_id: company_id!, code: values.code.toUpperCase(), name: values.name, name_ar: values.name_ar || null };
      if (editing) await getAdapter().units.update(editing.id, row);
      else await getAdapter().units.create(row);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['units', company_id] }); setOpen(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => getAdapter().units.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['units', company_id] }),
  });

  const columns: Column<UnitRow>[] = [
    { key: 'code', header: t('settings.units.code'), width: '80px', render: (r) => <bdi dir="ltr" className="sb-wh-code">{r.code}</bdi> },
    { key: 'name', header: t('settings.units.name'), render: (r) => r.name },
    ...(arabicOn ? [{ key: 'name_ar', header: t('settings.units.name_ar'), render: (r: UnitRow) => <span dir="rtl">{r.name_ar ?? '—'}</span> }] : []),
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

  // Ocean Teal (UI v1.1): look only — same query, form, save and delete.
  return (
    <OceanPage
      testid="units-ocean"
      title={t('settingsNav.items.units.title')}
      subtitle={t('settingsPages.units.count', { count: units.length })}
      actions={<>
        <span className="sb-clist-io"><ImportExportButton moduleKey="units" /></span>
        <button type="button" className="sb-primary-btn sb-btn-inline" onClick={openAdd}><Plus size={18} aria-hidden="true" />{t('settings.units.add')}</button>
      </>}
    >
      {isLoading
        ? <div className="sb-card sb-empty">{t('common.loading')}</div>
        : <OceanTable columns={columns} rows={units} keyFn={(r) => r.id} cardTitleKey="name" emptyMessage={t('settings.units.empty')} />
      }

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? t('settings.units.edit') : t('settings.units.add')}>
        <form onSubmit={handleSubmit((v) => { clearBanner(); return saveMutation.mutateAsync(v); }, onInvalid)} className="sb-ocean sb-form sb-modal-form">
          <FormErrorBanner message={bannerMessage} onDismiss={clearBanner} />
          <Input label={t('settings.units.code')} required error={errors.code?.message} {...register('code')} />
          <Input label={t('settings.units.name')} required error={errors.name?.message} {...register('name')} />
          {arabicOn && (
          <Input label={t('settings.units.name_ar')} dir="rtl" {...register('name_ar')} />
          )}
          {saveMutation.error && <p className="text-xs text-danger-500">{String(saveMutation.error)}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={isSubmitting}>{t('common.save')}</Button>
          </div>
        </form>
      </Modal>
    </OceanPage>
  );
}
