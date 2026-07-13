import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { StatusBadge } from '@/ui/status-badge';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function POSSessionReportPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.pos-session.period', 'this_month');
  const [status, setStatus] = useState<'all' | 'open' | 'closed'>('all');

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['pos-session-report', company_id, from, to, status],
    enabled: !!company_id,
    queryFn: () =>
      getAdapter().pos.getPOSSessionReport(company_id!, {
        date_from: from,
        date_to: to,
        ...(status !== 'all' ? { status } : {}),
      }),
  });

  const totalSales    = rows.reduce((s, r) => s + (r.total_sales_amount ?? 0), 0);
  const totalInvoices = rows.reduce((s, r) => s + (r.total_sales_count ?? 0), 0);
  const totalVariance = rows.reduce((s, r) => s + (r.cash_variance ?? 0), 0);

  const exportRows: Record<string, unknown>[] = rows.map(r => ({
    Session: r.session_number,
    Warehouse: r.warehouse_name,
    Status: r.status,
    'Opened At': r.opened_at ? new Date(r.opened_at).toLocaleString() : '',
    'Closed At': r.closed_at ? new Date(r.closed_at).toLocaleString() : '',
    'Opening Cash': (r.opening_cash ?? 0).toFixed(2),
    Invoices: r.total_sales_count ?? 0,
    'Total Sales': (r.total_sales_amount ?? 0).toFixed(2),
    'Counted Cash': r.closing_cash_counted != null ? r.closing_cash_counted.toFixed(2) : '',
    'Cash Variance': r.cash_variance != null ? r.cash_variance.toFixed(2) : '',
  }));
  const exportHeaders = ['Session', 'Warehouse', 'Status', 'Opened At', 'Closed At', 'Opening Cash', 'Invoices', 'Total Sales', 'Counted Cash', 'Cash Variance'];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-primary">{t('reports.pos_session_report')}</h1>
          <p className="text-sm text-ink-tertiary mt-1">{t('reports.pos_session_report_desc')}</p>
        </div>
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          <select
            value={status}
            onChange={e => setStatus(e.target.value as 'all' | 'open' | 'closed')}
            className="h-[30px] rounded-lg border border-border-subtle bg-white px-2.5 text-xs font-semibold text-ink-secondary outline-none focus:border-brand-400"
            title={t('common.status')}
          >
            <option value="all">{t('common.all')}</option>
            <option value="open">{t('pos.session_open')}</option>
            <option value="closed">{t('pos.session_closed')}</option>
          </select>
          <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
          <ReportActions rows={exportRows} headers={exportHeaders} filename={`pos-sessions-${from}_${to}`} disabled={rows.length === 0} />
        </div>
      </div>

      {/* Summary Cards */}
      {rows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white border border-border-subtle rounded-lg p-4">
            <p className="text-xs text-ink-tertiary">{t('reports.total_sessions')}</p>
            <p className="text-2xl font-bold text-ink-primary mt-1">{rows.length}</p>
          </div>
          <div className="bg-white border border-border-subtle rounded-lg p-4">
            <p className="text-xs text-ink-tertiary">{t('reports.total_invoices')}</p>
            <p className="text-2xl font-bold text-ink-primary mt-1">{totalInvoices}</p>
          </div>
          <div className="bg-white border border-border-subtle rounded-lg p-4">
            <p className="text-xs text-ink-tertiary">{t('reports.total_sales')}</p>
            <p className="text-2xl font-bold text-brand-600 mt-1">{fmt(totalSales)}</p>
          </div>
          <div className="bg-white border border-border-subtle rounded-lg p-4">
            <p className="text-xs text-ink-tertiary">{t('pos.cash_variance')}</p>
            <p className={`text-2xl font-bold mt-1 ${Math.abs(totalVariance) < 0.01 ? 'text-green-600' : 'text-red-600'}`}>
              {fmt(totalVariance)}
            </p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-border-subtle rounded-lg overflow-hidden">
        {rows.length === 0 ? (
          <p className="p-8 text-center text-ink-tertiary">{isFetching ? t('common.loading') : t('pos.no_sessions')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted border-b border-border-subtle">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-ink-secondary">{t('pos.session_number')}</th>
                  <th className="px-4 py-3 text-left font-medium text-ink-secondary">{t('pos.warehouse')}</th>
                  <th className="px-4 py-3 text-left font-medium text-ink-secondary">{t('common.status')}</th>
                  <th className="px-4 py-3 text-left font-medium text-ink-secondary">{t('pos.opened_at')}</th>
                  <th className="px-4 py-3 text-left font-medium text-ink-secondary">{t('pos.closed_at')}</th>
                  <th className="px-4 py-3 text-right font-medium text-ink-secondary">{t('pos.opening_cash')}</th>
                  <th className="px-4 py-3 text-right font-medium text-ink-secondary">{t('pos.invoices')}</th>
                  <th className="px-4 py-3 text-right font-medium text-ink-secondary">{t('pos.total_sales')}</th>
                  <th className="px-4 py-3 text-right font-medium text-ink-secondary">{t('pos.counted_cash')}</th>
                  <th className="px-4 py-3 text-right font-medium text-ink-secondary">{t('pos.cash_variance')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {rows.map(row => (
                  <tr key={row.session_id} className="hover:bg-surface-muted transition-colors">
                    <td className="px-4 py-3 font-mono text-brand-600">{row.session_number}</td>
                    <td className="px-4 py-3 text-ink-secondary">{row.warehouse_name}</td>
                    <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                    <td className="px-4 py-3 text-ink-secondary">
                      {row.opened_at ? new Date(row.opened_at).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-ink-secondary">
                      {row.closed_at ? new Date(row.closed_at).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-ink-secondary">{fmt(row.opening_cash ?? 0)}</td>
                    <td className="px-4 py-3 text-right text-ink-secondary">{row.total_sales_count ?? 0}</td>
                    <td className="px-4 py-3 text-right font-semibold text-ink-primary">{fmt(row.total_sales_amount ?? 0)}</td>
                    <td className="px-4 py-3 text-right text-ink-secondary">
                      {row.closing_cash_counted != null ? fmt(row.closing_cash_counted) : '—'}
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold ${
                      row.cash_variance == null ? 'text-ink-tertiary'
                      : Math.abs(row.cash_variance) < 0.01 ? 'text-green-600'
                      : 'text-red-600'
                    }`}>
                      {row.cash_variance != null ? fmt(row.cash_variance) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
