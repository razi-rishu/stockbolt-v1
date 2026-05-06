import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDataAdapter } from '@/hooks/use-data-adapter';
import { useAuthStore } from '@/stores/authStore';
import type { SalesTrendLine } from '@/data/adapter';

function fmt(n: number) { return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }

export default function SalesTrendPage() {
  const { t } = useTranslation();
  const adapter = useDataAdapter();
  const company = useAuthStore(s => s.company);

  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom]     = useState(today.slice(0, 7) + '-01');
  const [to, setTo]         = useState(today);
  const [bucket, setBucket] = useState<'day' | 'week' | 'month'>('day');
  const [rows, setRows]     = useState<SalesTrendLine[]>([]);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!company?.id) return;
    setLoading(true);
    try { setRows(await adapter.reports.getSalesTrend(company.id, from, to, bucket)); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const maxAmt = Math.max(...rows.map(r => r.net_sales), 1);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-ink-primary">{t('reports.sales_trend')}</h1>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface-card p-4">
        <div>
          <label className="block text-xs text-ink-secondary mb-1">{t('common.date_from')}</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input-field h-9 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-ink-secondary mb-1">{t('common.date_to')}</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="input-field h-9 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-ink-secondary mb-1">{t('reports.bucket')}</label>
          <select value={bucket} onChange={e => setBucket(e.target.value as 'day' | 'week' | 'month')} className="input-field h-9 text-sm">
            <option value="day">{t('reports.bucket_day')}</option>
            <option value="week">{t('reports.bucket_week')}</option>
            <option value="month">{t('reports.bucket_month')}</option>
          </select>
        </div>
        <button onClick={run} disabled={loading} className="btn-primary h-9 px-4 text-sm">
          {loading ? t('common.loading') : t('common.run')}
        </button>
      </div>

      {rows.length > 0 && (
        <>
          {/* Bar chart */}
          <div className="rounded-lg border border-border bg-surface-card p-5 shadow-sm">
            <div className="flex h-40 items-end gap-1 overflow-x-auto">
              {rows.map(r => (
                <div key={r.bucket} className="group relative flex flex-col items-center gap-1 flex-1 min-w-[20px]">
                  <div
                    className="w-full bg-brand-400 rounded-t hover:bg-brand-500 transition-colors"
                    style={{ height: `${Math.max(4, (r.net_sales / maxAmt) * 100)}%` }}
                    title={`${r.bucket}: ${fmt(r.net_sales)}`}
                  />
                  <span className="text-[9px] text-ink-tertiary truncate w-full text-center">{r.bucket.slice(-5)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-lg border border-border bg-surface-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-surface-subtle">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('reports.period')}</th>
                  <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.invoice_count')}</th>
                  <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.gross_sales')}</th>
                  <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.returns')}</th>
                  <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.net_sales')}</th>
                  <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.gross_profit')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map(r => (
                  <tr key={r.bucket} className="hover:bg-surface-subtle/50">
                    <td className="px-4 py-2 text-ink-primary font-medium">{r.bucket}</td>
                    <td className="px-4 py-2 text-right text-ink-secondary">{r.invoice_count}</td>
                    <td className="px-4 py-2 text-right text-ink-secondary">{fmt(r.gross_sales)}</td>
                    <td className="px-4 py-2 text-right text-red-600">{r.returns > 0 ? `(${fmt(r.returns)})` : '—'}</td>
                    <td className="px-4 py-2 text-right text-ink-primary font-medium">{fmt(r.net_sales)}</td>
                    <td className="px-4 py-2 text-right text-emerald-700 font-medium">{fmt(r.gross_profit)}</td>
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
