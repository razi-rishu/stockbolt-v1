import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function GRNReconciliationPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [triggered, setTriggered] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['grn_reconciliation', company_id, asOf],
    queryFn: () => getAdapter().reports.getGRNReconciliation(company_id!, asOf),
    enabled: triggered && !!company_id,
  });

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-ink-primary">{t('reports.grn_reconciliation')}</h1>
      <p className="text-sm text-ink-secondary">{t('reports.grn_reconciliation_desc')}</p>
      <div className="flex items-end gap-3">
        <Input label={t('reports.as_of_date')} type="date" value={asOf} onChange={e => setAsOf(e.target.value)} />
        <Button size="sm" onClick={() => setTriggered(true)}>{t('reports.run')}</Button>
      </div>

      {isLoading && <div className="text-sm text-ink-tertiary">{t('common.loading')}</div>}
      {data && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-card border border-border-subtle bg-surface-card p-4">
              <p className="text-xs text-ink-tertiary">{t('reports.total_accrual')}</p>
              <p className="text-xl font-semibold text-ink-primary mt-1">{fmt(data.total_accrual)}</p>
            </div>
            <div className="rounded-card border border-border-subtle bg-surface-card p-4">
              <p className="text-xs text-ink-tertiary">{t('reports.total_billed')}</p>
              <p className="text-xl font-semibold text-green-600 mt-1">{fmt(data.total_billed)}</p>
            </div>
            <div className="rounded-card border border-border-subtle bg-surface-card p-4">
              <p className="text-xs text-ink-tertiary">{t('reports.total_unbilled')}</p>
              <p className="text-xl font-semibold text-orange-600 mt-1">{fmt(data.total_unbilled)}</p>
            </div>
          </div>

          <div className="rounded-card border border-border-subtle bg-surface-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle bg-surface-muted text-ink-tertiary text-xs">
                  <th className="px-4 py-3 text-start font-medium">{t('purchasing.grn_number')}</th>
                  <th className="px-4 py-3 text-start font-medium">{t('purchasing.supplier')}</th>
                  <th className="px-4 py-3 text-start font-medium">{t('purchasing.date')}</th>
                  <th className="px-4 py-3 text-end font-medium">{t('reports.total_cost')}</th>
                  <th className="px-4 py-3 text-end font-medium">{t('reports.billed')}</th>
                  <th className="px-4 py-3 text-end font-medium">{t('reports.unbilled')}</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map(line => (
                  <tr key={line.grn_id} className="border-b border-border-subtle last:border-0">
                    <td className="px-4 py-3 font-mono text-xs text-brand-700">{line.grn_number}</td>
                    <td className="px-4 py-3 text-ink-primary">{line.supplier_name}</td>
                    <td className="px-4 py-3 text-ink-secondary">{line.date}</td>
                    <td className="px-4 py-3 text-end font-mono">{fmt(line.total_cost)}</td>
                    <td className="px-4 py-3 text-end font-mono text-green-600">{fmt(line.billed_amount)}</td>
                    <td className="px-4 py-3 text-end font-mono text-orange-600">{fmt(line.unbilled_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
