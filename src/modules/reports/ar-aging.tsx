import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayIso() { return new Date().toISOString().slice(0, 10); }

export default function ARAgingPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const [asOf, setAsOf] = useState(todayIso);
  const [trigger, setTrigger] = useState(0);

  const { data: ar, isLoading, error } = useQuery({
    queryKey: ['ar_aging', company_id, asOf, trigger],
    queryFn: () => getAdapter().reports.getARAgingReport(company_id!, asOf),
    enabled: !!company_id && trigger > 0,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-ink-primary">{t('reports.ar_aging_title')}</h1>

      <div className="flex items-center gap-3 rounded-card border border-border-subtle bg-surface-card px-5 py-3">
        <Input type="date" label={t('reports.as_of_date')} value={asOf} onChange={e => setAsOf(e.target.value)} />
        <div className="mt-5">
          <Button size="sm" onClick={() => setTrigger(n => n + 1)}>{t('reports.run')}</Button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-ink-secondary">{t('common.loading')}</p>}
      {error && <p className="text-sm text-red-600">{String(error)}</p>}

      {ar && ar.buckets.length === 0 && (
        <p className="text-sm text-ink-tertiary">{t('reports.no_outstanding')}</p>
      )}

      {ar && ar.buckets.length > 0 && (
        <div className="rounded-card border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-5 py-3 text-sm text-ink-secondary">
            {t('reports.as_of_date')}: {asOf}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                <th className="px-4 py-2.5 text-start font-medium">{t('reports.customer')}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t('reports.current')}</th>
                <th className="px-4 py-2.5 text-end font-medium">31–60</th>
                <th className="px-4 py-2.5 text-end font-medium">61–90</th>
                <th className="px-4 py-2.5 text-end font-medium">&gt;90</th>
                <th className="px-4 py-2.5 text-end font-medium">{t('reports.total')}</th>
              </tr>
            </thead>
            <tbody>
              {ar.buckets.map(b => (
                <tr key={b.contact_id} className="border-b border-border-subtle last:border-0">
                  <td className="px-4 py-2.5 text-ink-primary">{b.contact_name}</td>
                  <td className="px-4 py-2.5 text-end font-mono text-ink-primary">{b.current > 0 ? fmt(b.current) : '—'}</td>
                  <td className="px-4 py-2.5 text-end font-mono text-orange-600">{b.days_31_60 > 0 ? fmt(b.days_31_60) : '—'}</td>
                  <td className="px-4 py-2.5 text-end font-mono text-red-500">{b.days_61_90 > 0 ? fmt(b.days_61_90) : '—'}</td>
                  <td className="px-4 py-2.5 text-end font-mono text-red-700">{b.over_90 > 0 ? fmt(b.over_90) : '—'}</td>
                  <td className="px-4 py-2.5 text-end font-mono font-semibold text-ink-primary">{fmt(b.total)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-border-subtle bg-surface-muted font-semibold">
                <td className="px-4 py-2.5 text-ink-primary">{t('reports.total')}</td>
                <td className="px-4 py-2.5 text-end font-mono">{fmt(ar.total_current)}</td>
                <td className="px-4 py-2.5 text-end font-mono">{fmt(ar.total_31_60)}</td>
                <td className="px-4 py-2.5 text-end font-mono">{fmt(ar.total_61_90)}</td>
                <td className="px-4 py-2.5 text-end font-mono">{fmt(ar.total_over_90)}</td>
                <td className="px-4 py-2.5 text-end font-mono">{fmt(ar.grand_total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
