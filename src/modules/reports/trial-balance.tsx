import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import type { TrialBalance, TrialBalanceLine } from '@/data/adapter';

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const TYPE_ORDER = ['asset', 'liability', 'equity', 'revenue', 'expense'];

export default function TrialBalancePage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();

  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [queryDate, setQueryDate] = useState<string | null>(null);

  const { data, isFetching } = useQuery<TrialBalance>({
    queryKey: ['trial_balance', company_id, queryDate],
    queryFn: () => getAdapter().accounting.getTrialBalance(company_id!, queryDate!),
    enabled: !!company_id && !!queryDate,
  });

  function handleRun(e: React.FormEvent) {
    e.preventDefault();
    setQueryDate(asOfDate);
  }

  // Group lines by account type
  const grouped: Record<string, TrialBalanceLine[]> = {};
  for (const line of data?.lines ?? []) {
    if (!grouped[line.account_type]) grouped[line.account_type] = [];
    grouped[line.account_type].push(line);
  }
  const types = TYPE_ORDER.filter((t2) => grouped[t2]?.length > 0);

  const isBalanced = data ? Math.abs(data.total_debit - data.total_credit) <= 0.01 : true;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-ink-primary">{t('reports.trial_balance')}</h1>

      <form onSubmit={handleRun} className="flex items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('reports.as_of_date')}</label>
          <Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="w-40" />
        </div>
        <Button type="submit" size="sm">{t('reports.run')}</Button>
      </form>

      {isFetching && <p className="text-sm text-ink-secondary">{t('common.loading')}</p>}

      {data && !isFetching && (
        <div className="rounded-card border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-4 py-3">
            <p className="font-medium text-ink-primary">{t('reports.trial_balance')}</p>
            <p className="text-xs text-ink-tertiary">{t('reports.as_of')} {data.as_of_date}</p>
          </div>

          {data.lines.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-tertiary">{t('reports.tb_empty')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                  <th className="px-4 py-2 text-start font-medium">{t('accounting.code')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('accounting.account_name')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('accounting.type')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('accounting.debit')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('accounting.credit')}</th>
                </tr>
              </thead>
              <tbody>
                {types.map((type) => (
                  <>
                    <tr key={`hdr-${type}`} className="bg-surface-muted/60">
                      <td colSpan={5} className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-ink-tertiary capitalize">
                        {t(`accounting.type_${type}`)}
                      </td>
                    </tr>
                    {grouped[type].map((line) => (
                      <tr key={line.account_code} className="border-b border-border-subtle last:border-0 hover:bg-surface-muted/50">
                        <td className="px-4 py-2.5 font-mono text-xs text-ink-primary">{line.account_code}</td>
                        <td className="px-4 py-2.5 text-ink-primary">{line.account_name}</td>
                        <td className="px-4 py-2.5 text-ink-secondary capitalize">{line.account_type}</td>
                        <td className="px-4 py-2.5 text-end font-mono">{line.debit > 0 ? fmt(line.debit) : ''}</td>
                        <td className="px-4 py-2.5 text-end font-mono">{line.credit > 0 ? fmt(line.credit) : ''}</td>
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
              <tfoot>
                <tr className={`border-t-2 font-bold ${isBalanced ? 'border-green-300' : 'border-red-300'}`}>
                  <td colSpan={3} className="px-4 py-2.5 text-sm">{t('accounting.total')}</td>
                  <td className={`px-4 py-2.5 text-end font-mono ${isBalanced ? '' : 'text-red-500'}`}>
                    {fmt(data.total_debit)}
                  </td>
                  <td className={`px-4 py-2.5 text-end font-mono ${isBalanced ? '' : 'text-red-500'}`}>
                    {fmt(data.total_credit)}
                  </td>
                </tr>
                {!isBalanced && (
                  <tr>
                    <td colSpan={5} className="px-4 py-1.5 text-xs text-red-500">
                      ⚠ {t('reports.tb_unbalanced')}
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
