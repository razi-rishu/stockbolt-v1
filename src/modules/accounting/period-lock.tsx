import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
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

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-ink-primary">{t('accounting.period_lock_title')}</h1>

      <div className="max-w-md rounded-card border border-border-subtle bg-surface-card p-5 space-y-4">
        <p className="text-sm text-ink-secondary">{t('accounting.period_lock_hint')}</p>

        <div>
          <p className="mb-1 text-xs font-medium text-ink-secondary">{t('accounting.current_lock')}</p>
          <p className="text-sm font-medium text-ink-primary">
            {currentLock ? currentLock : t('accounting.no_lock')}
          </p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('accounting.new_lock_date')}</label>
          <Input
            type="date"
            value={lockDate}
            onChange={(e) => setLockDate(e.target.value)}
            className="w-48"
          />
          <p className="mt-1 text-xs text-ink-tertiary">{t('accounting.clear_lock_hint')}</p>
        </div>

        {saveMutation.isError && <p className="text-xs text-red-500">{t('common.error')}</p>}
        {saved && <p className="text-xs text-green-600">{t('common.saved')}</p>}

        <Button
          size="sm"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
        >
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}
