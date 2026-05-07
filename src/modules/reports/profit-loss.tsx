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

      {pl && (() => {
        // NULL sub_type defaults to 'direct' (matches adapter) so legacy
        // accounts still appear above Gross Profit rather than disappearing.
        const isDirect = (l: typeof pl.lines[number]) => l.sub_type !== 'indirect';
        const directIncome   = pl.lines.filter(l => l.account_type === 'income'  &&  isDirect(l));
        const directExpense  = pl.lines.filter(l => l.account_type === 'expense' &&  isDirect(l));
        const otherIncome    = pl.lines.filter(l => l.account_type === 'income'  && !isDirect(l));
        const operatingExp   = pl.lines.filter(l => l.account_type === 'expense' && !isDirect(l));

        return (
        <div className="rounded-card border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-5 py-3 text-sm text-ink-secondary">
            {t('reports.period')}: {from} — {to}
          </div>
          <table className="w-full text-sm">
            <tbody>
              {/* ── Direct income (Sales) ─────────────────────────── */}
              <tr className="bg-surface-muted">
                <td colSpan={2} className="px-5 py-2 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
                  Revenue (Direct Income)
                </td>
              </tr>
              {directIncome.map(l => (
                <tr key={l.account_code} className="border-b border-border-subtle">
                  <td className="px-5 py-2 text-ink-primary">{l.account_code} {l.account_name}</td>
                  <td className="px-5 py-2 text-end font-mono text-ink-primary">{fmt(l.amount)}</td>
                </tr>
              ))}
              <tr className="border-b border-border-subtle bg-surface-muted font-semibold">
                <td className="px-5 py-2 text-ink-primary">{t('reports.total_revenue')}</td>
                <td className="px-5 py-2 text-end font-mono text-ink-primary">{fmt(pl.revenue)}</td>
              </tr>

              {/* ── Direct expense (COGS) ─────────────────────────── */}
              <tr className="bg-surface-muted">
                <td colSpan={2} className="px-5 py-2 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
                  Cost of Goods Sold (Direct Expense)
                </td>
              </tr>
              {directExpense.length === 0 ? (
                <tr className="border-b border-border-subtle">
                  <td className="px-5 py-2 text-ink-tertiary">No direct expenses</td>
                  <td className="px-5 py-2 text-end font-mono text-ink-tertiary">—</td>
                </tr>
              ) : directExpense.map(l => (
                <tr key={l.account_code} className="border-b border-border-subtle">
                  <td className="px-5 py-2 text-ink-primary">{l.account_code} {l.account_name}</td>
                  <td className="px-5 py-2 text-end font-mono text-ink-primary">({fmt(l.amount)})</td>
                </tr>
              ))}

              {/* ── Gross Profit ──────────────────────────────────── */}
              <tr className="border-b-2 border-border-subtle bg-brand-50 font-semibold">
                <td className="px-5 py-2 text-ink-primary">{t('reports.gross_profit')}</td>
                <td className={`px-5 py-2 text-end font-mono ${pl.gross_profit < 0 ? 'text-red-600' : 'text-brand-700'}`}>
                  {fmt(pl.gross_profit)}
                </td>
              </tr>

              {/* ── Indirect income (Other Income) ────────────────── */}
              {otherIncome.length > 0 && (
                <>
                  <tr className="bg-surface-muted">
                    <td colSpan={2} className="px-5 py-2 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
                      Other Income (Indirect)
                    </td>
                  </tr>
                  {otherIncome.map(l => (
                    <tr key={l.account_code} className="border-b border-border-subtle">
                      <td className="px-5 py-2 text-ink-primary">{l.account_code} {l.account_name}</td>
                      <td className="px-5 py-2 text-end font-mono text-ink-primary">{fmt(l.amount)}</td>
                    </tr>
                  ))}
                  <tr className="border-b border-border-subtle bg-surface-muted font-semibold">
                    <td className="px-5 py-2 text-ink-primary">Total Other Income</td>
                    <td className="px-5 py-2 text-end font-mono text-ink-primary">{fmt(pl.other_income)}</td>
                  </tr>
                </>
              )}

              {/* ── Operating expenses (Indirect) ─────────────────── */}
              <tr className="bg-surface-muted">
                <td colSpan={2} className="px-5 py-2 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
                  Operating Expenses (Indirect)
                </td>
              </tr>
              {operatingExp.length === 0 ? (
                <tr className="border-b border-border-subtle">
                  <td className="px-5 py-2 text-ink-tertiary">No operating expenses</td>
                  <td className="px-5 py-2 text-end font-mono text-ink-tertiary">—</td>
                </tr>
              ) : operatingExp.map(l => (
                <tr key={l.account_code} className="border-b border-border-subtle">
                  <td className="px-5 py-2 text-ink-primary">{l.account_code} {l.account_name}</td>
                  <td className="px-5 py-2 text-end font-mono text-ink-primary">({fmt(l.amount)})</td>
                </tr>
              ))}
              {operatingExp.length > 0 && (
                <tr className="border-b border-border-subtle bg-surface-muted font-semibold">
                  <td className="px-5 py-2 text-ink-primary">Total Operating Expenses</td>
                  <td className="px-5 py-2 text-end font-mono text-ink-primary">({fmt(pl.operating_expenses)})</td>
                </tr>
              )}

              {/* ── Net Profit ────────────────────────────────────── */}
              <tr className="border-t-2 border-border-subtle bg-surface-muted font-bold">
                <td className="px-5 py-3 text-ink-primary">{t('reports.net_profit')}</td>
                <td className={`px-5 py-3 text-end font-mono text-base ${pl.net_profit < 0 ? 'text-red-600' : 'text-green-700'}`}>
                  {fmt(pl.net_profit)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        );
      })()}
    </div>
  );
}
