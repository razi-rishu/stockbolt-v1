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

function Section({ title, lines, total, totalLabel }: { title: string; lines: { account_code: string; account_name: string; balance: number }[]; total: number; totalLabel: string }) {
  return (
    <>
      <tr className="bg-surface-muted">
        <td colSpan={2} className="px-5 py-2 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">{title}</td>
      </tr>
      {lines.map(l => (
        <tr key={l.account_code} className="border-b border-border-subtle">
          <td className="px-5 py-2 text-ink-primary">{l.account_code} {l.account_name}</td>
          <td className="px-5 py-2 text-end font-mono text-ink-primary">{fmt(l.balance)}</td>
        </tr>
      ))}
      <tr className="border-b-2 border-border-subtle bg-surface-muted font-semibold">
        <td className="px-5 py-2 text-ink-primary">{totalLabel}</td>
        <td className="px-5 py-2 text-end font-mono text-ink-primary">{fmt(total)}</td>
      </tr>
    </>
  );
}

export default function BalanceSheetPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const [asOf, setAsOf] = useState(todayIso);
  const [trigger, setTrigger] = useState(0);

  const { data: bs, isLoading, error } = useQuery({
    queryKey: ['balance_sheet', company_id, asOf, trigger],
    queryFn: () => getAdapter().reports.getBalanceSheet(company_id!, asOf),
    enabled: !!company_id && trigger > 0,
  });

  const balanced = bs ? Math.abs(bs.total_assets - bs.total_liabilities - bs.total_equity) < 0.02 : true;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-ink-primary">{t('reports.bs_title')}</h1>

      <div className="flex items-center gap-3 rounded-card border border-border-subtle bg-surface-card px-5 py-3">
        <Input type="date" label={t('reports.as_of_date')} value={asOf} onChange={e => setAsOf(e.target.value)} />
        <div className="mt-5">
          <Button size="sm" onClick={() => setTrigger(n => n + 1)}>{t('reports.run')}</Button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-ink-secondary">{t('common.loading')}</p>}
      {error && <p className="text-sm text-red-600">{String(error)}</p>}

      {bs && (
        <>
          {!balanced && (
            <div className="rounded-input bg-red-50 px-4 py-2 text-sm text-red-700">
              {t('reports.unbalanced_warning')}
            </div>
          )}
          <div className="rounded-card border border-border-subtle bg-surface-card">
            <div className="border-b border-border-subtle px-5 py-3 text-sm text-ink-secondary">
              {t('reports.as_of_date')}: {asOf}
            </div>
            <table className="w-full text-sm">
              <tbody>
                <Section
                  title={t('reports.assets')}
                  lines={bs.lines.filter(l => l.account_type === 'asset')}
                  total={bs.total_assets}
                  totalLabel={t('reports.total_assets')}
                />
                <Section
                  title={t('reports.liabilities')}
                  lines={bs.lines.filter(l => l.account_type === 'liability')}
                  total={bs.total_liabilities}
                  totalLabel={t('reports.total_liabilities')}
                />
                <Section
                  title={t('reports.equity')}
                  lines={bs.lines.filter(l => l.account_type === 'equity')}
                  total={bs.total_equity}
                  totalLabel={t('reports.total_equity')}
                />
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
