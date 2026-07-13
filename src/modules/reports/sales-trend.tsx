import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';

function fmt(n: number) { return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }

export default function SalesTrendPage() {
  const { t } = useTranslation();
  const company_id = useAuthStore(s => s.company_id);
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.sales-trend.period', 'this_month');
  const [bucket, setBucket] = useState<'day' | 'week' | 'month'>('day');

  const { data, isFetching } = useQuery({
    queryKey: ['sales_trend', company_id, from, to, bucket],
    queryFn: () => getAdapter().reports.getSalesTrend(company_id!, from, to, bucket),
    enabled: !!company_id,
  });
  const rows = data ?? [];

  const maxAmt = Math.max(...rows.map(r => r.net_sales), 1);

  const exportRows: Record<string, unknown>[] = rows.map(r => ({
    Period: r.bucket,
    'Invoice Count': r.invoice_count,
    'Gross Sales': r.gross_sales.toFixed(2),
    Returns: r.returns.toFixed(2),
    'Net Sales': r.net_sales.toFixed(2),
    'Gross Profit': r.gross_profit.toFixed(2),
  }));
  const exportHeaders = ['Period', 'Invoice Count', 'Gross Sales', 'Returns', 'Net Sales', 'Gross Profit'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink-primary">{t('reports.sales_trend')}</h1>
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          <select
            value={bucket}
            onChange={e => setBucket(e.target.value as 'day' | 'week' | 'month')}
            className="h-[30px] rounded-lg border border-border-subtle bg-white px-2.5 text-xs font-semibold text-ink-secondary outline-none focus:border-brand-400"
            title={t('reports.bucket')}
          >
            <option value="day">{t('reports.bucket_day')}</option>
            <option value="week">{t('reports.bucket_week')}</option>
            <option value="month">{t('reports.bucket_month')}</option>
          </select>
          <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
          <ReportActions rows={exportRows} headers={exportHeaders} filename={`sales-trend-${from}_${to}`} disabled={rows.length === 0} />
        </div>
      </div>

      {isFetching && rows.length === 0 && <p className="text-sm text-ink-secondary">{t('common.loading')}</p>}
      {!isFetching && rows.length === 0 && <p className="text-sm text-ink-tertiary">{t('reports.no_data')}</p>}

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
