import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function DailySalesReportPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.daily-sales.period', 'this_month');

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['daily-sales-summary', company_id, from, to],
    enabled: !!company_id,
    queryFn: () =>
      getAdapter().pos.getDailySalesSummary(company_id!, { date_from: from, date_to: to }),
  });

  const totalCash    = rows.reduce((s, r) => s + r.cash_total,   0);
  const totalCard    = rows.reduce((s, r) => s + r.card_total,   0);
  const totalCredit  = rows.reduce((s, r) => s + r.credit_total, 0);
  const grandTotal   = rows.reduce((s, r) => s + r.grand_total,  0);
  const totalInv     = rows.reduce((s, r) => s + r.invoice_count, 0);

  const exportRows: Record<string, unknown>[] = rows.map(r => ({
    Date: r.date,
    Cash: r.cash_total.toFixed(2),
    Card: r.card_total.toFixed(2),
    Credit: r.credit_total.toFixed(2),
    Invoices: r.invoice_count,
    'Grand Total': r.grand_total.toFixed(2),
  }));
  const exportHeaders = ['Date', 'Cash', 'Card', 'Credit', 'Invoices', 'Grand Total'];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-primary">{t('reports.daily_sales_summary')}</h1>
          <p className="text-sm text-ink-tertiary mt-1">{t('reports.daily_sales_summary_desc')}</p>
        </div>
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
          <ReportActions rows={exportRows} headers={exportHeaders} filename={`daily-sales-${from}_${to}`} disabled={rows.length === 0} />
        </div>
      </div>

      {/* Summary Cards */}
      {rows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <div className="bg-white border border-border-subtle rounded-lg p-4">
            <p className="text-xs text-ink-tertiary">{t('pos.payment_cash')}</p>
            <p className="text-xl font-bold text-ink-primary mt-1">{fmt(totalCash)}</p>
          </div>
          <div className="bg-white border border-border-subtle rounded-lg p-4">
            <p className="text-xs text-ink-tertiary">{t('pos.payment_card')}</p>
            <p className="text-xl font-bold text-ink-primary mt-1">{fmt(totalCard)}</p>
          </div>
          <div className="bg-white border border-border-subtle rounded-lg p-4">
            <p className="text-xs text-ink-tertiary">{t('pos.payment_credit')}</p>
            <p className="text-xl font-bold text-ink-primary mt-1">{fmt(totalCredit)}</p>
          </div>
          <div className="bg-white border border-border-subtle rounded-lg p-4">
            <p className="text-xs text-ink-tertiary">{t('reports.total_invoices')}</p>
            <p className="text-xl font-bold text-ink-primary mt-1">{totalInv}</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-xs text-brand-600">{t('reports.grand_total')}</p>
            <p className="text-xl font-bold text-blue-700 mt-1">{fmt(grandTotal)}</p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-border-subtle rounded-lg overflow-hidden">
        {rows.length === 0 ? (
          <p className="p-8 text-center text-ink-tertiary">{isFetching ? t('common.loading') : t('pos.no_sales')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted border-b border-border-subtle">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-ink-secondary">{t('common.date')}</th>
                  <th className="px-4 py-3 text-right font-medium text-ink-secondary">{t('pos.payment_cash')}</th>
                  <th className="px-4 py-3 text-right font-medium text-ink-secondary">{t('pos.payment_card')}</th>
                  <th className="px-4 py-3 text-right font-medium text-ink-secondary">{t('pos.payment_credit')}</th>
                  <th className="px-4 py-3 text-right font-medium text-ink-secondary">{t('reports.invoices')}</th>
                  <th className="px-4 py-3 text-right font-medium text-ink-secondary">{t('reports.grand_total')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {rows.map(row => (
                  <tr key={row.date} className="hover:bg-surface-muted transition-colors">
                    <td className="px-4 py-3 font-medium text-ink-primary">{row.date}</td>
                    <td className="px-4 py-3 text-right text-ink-secondary">{fmt(row.cash_total)}</td>
                    <td className="px-4 py-3 text-right text-ink-secondary">{fmt(row.card_total)}</td>
                    <td className="px-4 py-3 text-right text-ink-secondary">{fmt(row.credit_total)}</td>
                    <td className="px-4 py-3 text-right text-ink-secondary">{row.invoice_count}</td>
                    <td className="px-4 py-3 text-right font-bold text-ink-primary">{fmt(row.grand_total)}</td>
                  </tr>
                ))}
              </tbody>
              {rows.length > 1 && (
                <tfoot className="bg-surface-muted border-t-2 border-border-strong">
                  <tr>
                    <td className="px-4 py-3 font-semibold text-ink-secondary">{t('common.total')}</td>
                    <td className="px-4 py-3 text-right font-semibold text-ink-primary">{fmt(totalCash)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-ink-primary">{fmt(totalCard)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-ink-primary">{fmt(totalCredit)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-ink-primary">{totalInv}</td>
                    <td className="px-4 py-3 text-right font-bold text-blue-700">{fmt(grandTotal)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
