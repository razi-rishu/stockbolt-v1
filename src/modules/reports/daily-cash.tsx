import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import type { DailyCashLine } from '@/data/adapter';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function DailyCashPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const today = new Date().toISOString().slice(0, 10);
  const [reportDate, setReportDate] = useState(today);

  const { data: lines = [], isLoading, isFetching } = useQuery<DailyCashLine[]>({
    queryKey: ['report_daily_cash', company_id, reportDate],
    queryFn:  () => getAdapter().reports.dailyCash(company_id!, reportDate),
    enabled:  !!company_id,
  });

  const totalIn  = lines.reduce((s, l) => s + l.total_in, 0);
  const totalOut = lines.reduce((s, l) => s + l.total_out, 0);
  const netFlow  = totalIn - totalOut;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink-primary">{t('reports.daily_cash_title')}</h1>
          <p className="text-sm text-ink-tertiary mt-1">{t('reports.daily_cash_desc')}</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={reportDate}
            onChange={e => setReportDate(e.target.value)}
            className="h-9 rounded-md border border-border-strong px-3 text-sm"
          />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-border-subtle rounded-lg p-4">
          <p className="text-xs font-medium text-ink-tertiary uppercase tracking-wide">{t('reports.total_in')}</p>
          <p className="text-2xl font-bold text-green-600 mt-1">{fmt(totalIn)}</p>
        </div>
        <div className="bg-white border border-border-subtle rounded-lg p-4">
          <p className="text-xs font-medium text-ink-tertiary uppercase tracking-wide">{t('reports.total_out')}</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{fmt(totalOut)}</p>
        </div>
        <div className="bg-white border border-border-subtle rounded-lg p-4">
          <p className="text-xs font-medium text-ink-tertiary uppercase tracking-wide">{t('reports.net_flow')}</p>
          <p className={`text-2xl font-bold mt-1 ${netFlow >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmt(netFlow)}</p>
        </div>
      </div>

      <div className="bg-white border border-border-subtle rounded-lg overflow-hidden">
        {isLoading || isFetching ? (
          <p className="p-8 text-center text-sm text-ink-tertiary">{t('common.loading')}</p>
        ) : lines.length === 0 ? (
          <p className="p-8 text-center text-ink-tertiary">{t('reports.no_data')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted border-b border-border-subtle">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-ink-secondary">{t('reports.account_code')}</th>
                  <th className="px-4 py-3 text-left font-medium text-ink-secondary">{t('reports.account_name')}</th>
                  <th className="px-4 py-3 text-right font-medium text-ink-secondary">{t('reports.opening_balance')}</th>
                  <th className="px-4 py-3 text-right font-medium text-ink-secondary">{t('reports.total_in')}</th>
                  <th className="px-4 py-3 text-right font-medium text-ink-secondary">{t('reports.total_out')}</th>
                  <th className="px-4 py-3 text-right font-medium text-ink-secondary">{t('reports.closing_balance')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {lines.map(line => (
                  <tr key={line.account_id} className="hover:bg-surface-muted transition-colors">
                    <td className="px-4 py-3 font-mono text-ink-secondary">{line.account_code}</td>
                    <td className="px-4 py-3 text-ink-secondary font-medium">{line.account_name}</td>
                    <td className="px-4 py-3 text-right text-ink-secondary">{fmt(line.opening_balance)}</td>
                    <td className="px-4 py-3 text-right text-green-600 font-semibold">{fmt(line.total_in)}</td>
                    <td className="px-4 py-3 text-right text-red-600 font-semibold">{fmt(line.total_out)}</td>
                    <td className="px-4 py-3 text-right font-bold text-ink-primary">{fmt(line.closing_balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-surface-muted border-t-2 border-border-subtle">
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-sm font-semibold text-ink-secondary">{t('common.total')}</td>
                  <td className="px-4 py-3 text-right font-bold text-green-600">{fmt(totalIn)}</td>
                  <td className="px-4 py-3 text-right font-bold text-red-600">{fmt(totalOut)}</td>
                  <td className="px-4 py-3 text-right font-bold text-ink-primary">{fmt(netFlow)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
