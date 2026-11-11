import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '@/ui/input';
import { Modal } from '@/ui/modal';
import { Plus, Pencil, Trash2, MapPin, Phone, Warehouse, Loader2 } from 'lucide-react';
import '@/styles/stockbolt-ocean-teal.css';
import ImportExportButton from '@/modules/settings/import-export/ImportExportButton';
import type { WarehouseRow } from '@/data/adapter';
import { useFormInvalidBanner } from '@/hooks/use-form-invalid-banner';
import { FormErrorBanner } from '@/ui/form-error-banner';

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

  const { onInvalid, bannerMessage, clearBanner } = useFormInvalidBanner('warehouses');
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

  const del = (r: WarehouseRow) => { if (confirm(t('common.confirm_delete'))) deleteMutation.mutate(r.id); };
  const badges = (r: WarehouseRow) => (
    <>
      {r.is_default && <span className="sb-pill">{t('common.default')}</span>}
      <span className={`sb-pill ${r.is_active ? 'sb-pill-good' : 'sb-pill-muted'}`}>{r.is_active ? t('common.active') : t('common.inactive')}</span>
    </>
  );
  const actions = (r: WarehouseRow, size: number) => (
    <>
      <button type="button" className="sb-icon-btn" onClick={() => openEdit(r)} aria-label={`${t('common.edit')} ${r.name}`}>
        <Pencil size={size} aria-hidden="true" /><span>{t('common.edit')}</span>
      </button>
      {/* The default warehouse cannot be deleted — same rule as before. */}
      {!r.is_default && (
        <button type="button" className="sb-icon-btn sb-danger" onClick={() => del(r)} aria-label={`${t('common.delete')} ${r.name}`}>
          <Trash2 size={size} aria-hidden="true" /><span>{t('common.delete')}</span>
        </button>
      )}
    </>
  );

  // Ocean Teal (UI v1.1): look only. Same query, add / edit form, default
  // and active flags, delete rule and Import / Export as before.
  return (
    <div className="sb-ocean sb-page sb-clist" data-testid="warehouses-ocean" style={{ paddingBottom: 48 }}>
      <div className="sb-hero">
        <div className="sb-clist-head">
          <div style={{ minWidth: 0 }}>
            <h1 className="sb-title" style={{ marginTop: 0 }}>{t('settingsNav.items.warehouses.title')}</h1>
            <div className="sb-clist-count">{t('settingsPages.warehouses.count', { count: warehouses.length })}</div>
          </div>
          <div className="sb-actions" style={{ marginTop: 0 }}>
            <span className="sb-clist-io"><ImportExportButton moduleKey="warehouses" /></span>
            <button type="button" className="sb-primary-btn" onClick={openAdd}>
              <Plus size={18} aria-hidden="true" />{t('settings.warehouses.add')}
            </button>
          </div>
        </div>
      </div>

      <div className="sb-body">
        {isLoading ? (
          <div className="sb-card sb-empty">{t('common.loading')}</div>
        ) : warehouses.length === 0 ? (
          <div className="sb-card sb-empty">{t('settings.warehouses.empty')}</div>
        ) : (
          <>
            {/* Phone: one card per warehouse. */}
            <ul className="sb-clist-cards" aria-label={t('settingsNav.items.warehouses.title')}>
              {warehouses.map((r) => (
                <li key={r.id} className="sb-card sb-ccard">
                  <div className="sb-ccard-main" style={{ cursor: 'default' }}>
                    <span className="sb-avatar" aria-hidden="true"><Warehouse size={20} /></span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span className="sb-ccard-name">{r.name} <bdi dir="ltr" className="sb-wh-code">{r.code}</bdi></span>
                      {r.name_ar && <span className="sb-ccard-ar"><bdi>{r.name_ar}</bdi></span>}
                      <span className="sb-ccard-meta">
                        {r.city && <span><MapPin size={14} aria-hidden="true" />{r.city}</span>}
                        {r.phone && <span><Phone size={14} aria-hidden="true" /><bdi dir="ltr">{r.phone}</bdi></span>}
                      </span>
                    </span>
                  </div>
                  <div className="sb-ccard-foot">
                    {badges(r)}
                    <span style={{ flex: 1 }} />
                    {actions(r, 18)}
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop: the same columns as before, in an Ocean table. */}
            <div className="sb-card sb-ctable-wrap">
              <table className="sb-ctable sb-wh-table">
                <thead>
                  <tr>
                    <th>{t('settings.warehouses.code')}</th>
                    <th>{t('settings.warehouses.name')}</th>
                    <th>{t('settings.warehouses.name_ar')}</th>
                    <th>{t('settings.warehouses.city')}</th>
                    <th aria-label={t('common.active')} />
                    <th aria-label={t('common.edit')} />
                  </tr>
                </thead>
                <tbody>
                  {warehouses.map((r) => (
                    <tr key={r.id}>
                      <td><bdi dir="ltr" className="sb-wh-code">{r.code}</bdi></td>
                      <td style={{ fontWeight: 600 }}>{r.name}</td>
                      <td>{r.name_ar ? <bdi>{r.name_ar}</bdi> : '—'}</td>
                      <td>{r.city ?? '—'}</td>
                      <td><div className="sb-wh-badges">{badges(r)}</div></td>
                      <td><div className="sb-row-actions">{actions(r, 16)}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? t('settings.warehouses.edit') : t('settings.warehouses.add')} width="lg">
        <form onSubmit={handleSubmit((v) => { clearBanner(); return saveMutation.mutateAsync(v); }, onInvalid)} className="sb-ocean sb-form sb-modal-form">
          <FormErrorBanner message={bannerMessage} onDismiss={clearBanner} />
          <div className="sb-form-grid">
            <Input label={t('settings.warehouses.code')} required dir="ltr" error={errors.code?.message} aria-invalid={errors.code ? true : undefined} {...register('code')} />
            <Input label={t('settings.warehouses.name')} required error={errors.name?.message} aria-invalid={errors.name ? true : undefined} {...register('name')} />
          </div>
          <Input label={t('settings.warehouses.name_ar')} dir="rtl" {...register('name_ar')} />
          <div className="sb-form-grid">
            <Input label={t('settings.warehouses.address')} {...register('address')} />
            <Input label={t('settings.warehouses.city')} {...register('city')} />
          </div>
          <Input label={t('settings.warehouses.phone')} type="tel" dir="ltr" {...register('phone')} />
          <div className="sb-form-grid">
            <label className="sb-check-row">
              <input type="checkbox" {...register('is_default')} />
              <span className="sb-check-text">{t('settings.warehouses.set_default')}</span>
            </label>
            <label className="sb-check-row">
              <input type="checkbox" {...register('is_active')} />
              <span className="sb-check-text">{t('common.active')}</span>
            </label>
          </div>
          {saveMutation.error && <p className="sb-alert sb-alert-danger" role="alert">{String(saveMutation.error)}</p>}
          <div className="sb-form-actions">
            <button type="button" className="sb-secondary-btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
            <button type="submit" className="sb-primary-btn sb-btn-inline" disabled={isSubmitting}>
              {isSubmitting && <Loader2 size={18} className="sb-spin" aria-hidden="true" />}
              {t('common.save')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
