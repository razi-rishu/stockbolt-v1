import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import { StatusBadge } from '@/ui/status-badge';

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function POSSessionReportPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();

  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 7) + '-01';

  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo]     = useState(today);
  const [status, setStatus]     = useState<'all' | 'open' | 'closed'>('all');
  const [submitted, setSubmitted] = useState(false);

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['pos-session-report', company_id, dateFrom, dateTo, status, submitted],
    enabled: !!company_id && submitted,
    queryFn: () =>
      getAdapter().pos.getPOSSessionReport(company_id!, {
        date_from: dateFrom,
        date_to: dateTo,
        ...(status !== 'all' ? { status } : {}),
      }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
  }

  const totalSales    = rows.reduce((s, r) => s + (r.total_sales_amount ?? 0), 0);
  const totalInvoices = rows.reduce((s, r) => s + (r.total_sales_count ?? 0), 0);
  const totalVariance = rows.reduce((s, r) => s + (r.cash_variance ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink-primary">{t('reports.pos_session_report')}</h1>
        <p className="text-sm text-ink-tertiary mt-1">{t('reports.pos_session_report_desc')}</p>
      </div>

      {/* Filters */}
      <form onSubmit={handleSubmit} className="bg-white border border-border-subtle rounded-lg p-4 flex flex-wrap gap-4 items-end">
        <div className="flex flex-col gap-1 min-w-[140px]">
          <label className="text-xs font-medium text-ink-secondary">{t('common.date_from')}</label>
          <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setSubmitted(false); }} />
        </div>
        <div className="flex flex-col gap-1 min-w-[140px]">
          <label className="text-xs font-medium text-ink-secondary">{t('common.date_to')}</label>
          <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setSubmitted(false); }} />
        </div>
        <div className="flex flex-col gap-1 min-w-[120px]">
          <label className="text-xs font-medium text-ink-secondary">{t('common.status')}</label>
          <select
            value={status}
            onChange={e => { setStatus(e.target.value as 'all' | 'open' | 'closed'); setSubmitted(false); }}
            className="h-9 rounded-md border border-border-strong px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">{t('common.all')}</option>
            <option value="open">{t('pos.session_open')}</option>
            <option value="closed">{t('pos.session_closed')}</option>
          </select>
        </div>
        <Button type="submit" disabled={isFetching}>
          {isFetching ? t('common.loading') : t('common.run')}
        </Button>
      </form>

      {/* Summary Cards */}
      {submitted && rows.length > 0 && (
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
      {submitted && (
        <div className="bg-white border border-border-subtle rounded-lg overflow-hidden">
          {rows.length === 0 && !isFetching ? (
            <p className="p-8 text-center text-ink-tertiary">{t('pos.no_sessions')}</p>
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
      )}
    </div>
  );
}
