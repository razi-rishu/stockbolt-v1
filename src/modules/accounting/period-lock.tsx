import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { OceanPage } from '@/components/ocean-list';
import { Lock, Loader2 } from 'lucide-react';
import type { Company } from '@/data/adapter';

export default function PeriodLockPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const qc = useQueryClient();
  const [lockDate, setLockDate] = useState('');
  const [saved, setSaved] = useState(false);

  const { data: company } = useQuery<Company | null>({
    queryKey: ['company', company_id],
    queryFn: () => getAdapter().companies.getById(company_id!),
    enabled: !!company_id,
  });

  // Prefill the date input from the loaded company. Must be an effect —
  // setting state inside the query's `select` ran during render and
  // infinite-looped once the app shell began observing the same query.
  const loadedLock = (company as any)?.period_lock_date as string | null | undefined;
  useEffect(() => {
    if (loadedLock !== undefined) setLockDate(loadedLock ?? '');
  }, [loadedLock]);

  const saveMutation = useMutation({
    mutationFn: () => getAdapter().accounting.setPeriodLock(company_id!, lockDate || null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company', company_id] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const currentLock = (company as any)?.period_lock_date as string | null | undefined;

  // Ocean Teal (UI v1.1): look only — same lock date, prefill and save.
  return (
    <OceanPage narrow testid="period-lock-ocean" title={t('settingsNav.items.period_lock.title')} subtitle={t('settingsNav.items.period_lock.desc')}>
      <section className="sb-card sb-form" style={{ maxWidth: 560 }}>
        <div className="sb-form-head">
          <span className="sb-form-icon" aria-hidden="true"><Lock size={20} /></span>
          <span style={{ minWidth: 0 }}>
            <h2 className="sb-form-title">{t('accounting.period_lock_title')}</h2>
            <p className="sb-form-hint">{t('accounting.period_lock_hint')}</p>
          </span>
        </div>
        <div className="sb-form-stack">
          <div className="sb-pl-current">
            <span className="sb-info-label">{t('accounting.current_lock')}</span>
            <span className="sb-info-value">{currentLock ? <bdi dir="ltr">{currentLock}</bdi> : t('accounting.no_lock')}</span>
          </div>
          <label className="sb-select-field">
            <span className="sb-select-label">{t('accounting.new_lock_date')}</span>
            <input type="date" dir="ltr" className="sb-field" aria-label={t('accounting.new_lock_date')} value={lockDate} onChange={(e) => setLockDate(e.target.value)} style={{ maxWidth: 220 }} />
            <span className="sb-form-hint">{t('accounting.clear_lock_hint')}</span>
          </label>
          {saveMutation.isError && <p className="sb-alert sb-alert-danger" role="alert">{t('common.error')}</p>}
          {saved && <p className="sb-alert sb-alert-good" role="status">{t('common.saved')}</p>}
          <div className="sb-form-actions" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 size={18} className="sb-spin" aria-hidden="true" />}
              {t('common.save')}
            </button>
          </div>
        </div>
      </section>
    </OceanPage>
  );
}
