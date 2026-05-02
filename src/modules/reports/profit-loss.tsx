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
function firstOfMonthIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function ProfitLossPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const [from, setFrom] = useState(firstOfMonthIso);
  const [to, setTo]     = useState(todayIso);
  const [trigger, setTrigger] = useState(0);

  const { data: pl, isLoading, error } = useQuery({
    queryKey: ['pl', company_id, from, to, trigger],
    queryFn: () => getAdapter().reports.getProfitAndLoss(company_id!, from, to),
    enabled: !!company_id && trigger > 0,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-ink-primary">{t('reports.pl_title')}</h1>

      <div className="flex items-center gap-3 rounded-card border border-border-subtle bg-surface-card px-5 py-3">
        <Input type="date" label={t('reports.from')} value={from} onChange={e => setFrom(e.target.value)} />
        <Input type="date" label={t('reports.to')} value={to} onChange={e => setTo(e.target.value)} />
        <div className="mt-5">
          <Button size="sm" onClick={() => setTrigger(n => n + 1)}>
            {t('reports.run')}
          </Button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-ink-secondary">{t('common.loading')}</p>}
      {error && <p className="text-sm text-red-600">{String(error)}</p>}

      {pl && (
        <div className="rounded-card border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-5 py-3 text-sm text-ink-secondary">
            {t('reports.period')}: {from} — {to}
          </div>
          <table className="w-full text-sm">
            <tbody>
              {/* Revenue section */}
              <tr className="bg-surface-muted">
                <td colSpan={2} className="px-5 py-2 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
                  {t('reports.revenue')}
                </td>
              </tr>
              {pl.lines.filter(l => l.account_type === 'revenue').map(l => (
                <tr key={l.account_code} className="border-b border-border-subtle">
                  <td className="px-5 py-2 text-ink-primary">{l.account_code} {l.account_name}</td>
                  <td className="px-5 py-2 text-end font-mono text-ink-primary">{fmt(l.amount)}</td>
                </tr>
              ))}
              <tr className="border-b border-border-subtle bg-surface-muted font-semibold">
                <td className="px-5 py-2 text-ink-primary">{t('reports.total_revenue')}</td>
                <td className="px-5 py-2 text-end font-mono text-ink-primary">{fmt(pl.revenue)}</td>
              </tr>

              {/* COGS */}
              <tr className="bg-surface-muted">
                <td colSpan={2} className="px-5 py-2 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
                  {t('reports.cogs')}
                </td>
              </tr>
              <tr className="border-b border-border-subtle">
                <td className="px-5 py-2 text-ink-primary">{t('reports.cogs')}</td>
                <td className="px-5 py-2 text-end font-mono text-ink-primary">({fmt(pl.cogs)})</td>
              </tr>
              <tr className="border-b-2 border-border-subtle font-semibold">
                <td className="px-5 py-2 text-ink-primary">{t('reports.gross_profit')}</td>
                <td className={`px-5 py-2 text-end font-mono ${pl.gross_profit < 0 ? 'text-red-600' : 'text-ink-primary'}`}>
                  {fmt(pl.gross_profit)}
                </td>
              </tr>

              {/* Operating expenses */}
              <tr className="bg-surface-muted">
                <td colSpan={2} className="px-5 py-2 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
                  {t('reports.expenses')}
                </td>
              </tr>
              {pl.lines.filter(l => l.account_type === 'expense' && l.account_code !== '5100').map(l => (
                <tr key={l.account_code} className="border-b border-border-subtle">
                  <td className="px-5 py-2 text-ink-primary">{l.account_code} {l.account_name}</td>
                  <td className="px-5 py-2 text-end font-mono text-ink-primary">({fmt(l.amount)})</td>
                </tr>
              ))}

              {/* Net profit */}
              <tr className="border-t-2 border-border-subtle bg-surface-muted font-bold">
                <td className="px-5 py-3 text-ink-primary">{t('reports.net_profit')}</td>
                <td className={`px-5 py-3 text-end font-mono text-base ${pl.net_profit < 0 ? 'text-red-600' : 'text-green-700'}`}>
                  {fmt(pl.net_profit)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
