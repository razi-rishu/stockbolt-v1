import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';

function fmt(n: number) { return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }

export default function SalesBySalespersonPage() {
  const { t } = useTranslation();
  const company_id = useAuthStore(s => s.company_id);
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.sales-by-salesperson.period', 'this_month');

  const { data, isFetching } = useQuery({
    queryKey: ['sales_by_salesperson', company_id, from, to],
    queryFn: () => getAdapter().reports.getSalesBySalesperson(company_id!, from, to),
    enabled: !!company_id,
  });
  const rows = data ?? [];

  const exportRows: Record<string, unknown>[] = rows.map(r => ({
    Salesperson: r.salesperson_name,
    'Invoice Count': r.invoice_count,
    Returns: r.returns_total.toFixed(2),
    'Net Sales': r.net_sales.toFixed(2),
    'Gross Profit': r.gross_profit.toFixed(2),
    'GP %': r.gp_pct.toFixed(1),
    'Avg Invoice': r.avg_invoice_value.toFixed(2),
    'Commission %': r.commission_pct != null ? r.commission_pct.toFixed(1) : '',
    Commission: r.commission_pct != null ? r.commission.toFixed(2) : '',
  }));
  const exportHeaders = ['Salesperson', 'Invoice Count', 'Returns', 'Net Sales', 'Gross Profit', 'GP %', 'Avg Invoice', 'Commission %', 'Commission'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink-primary">{t('reports.sales_by_salesperson')}</h1>
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
          <ReportActions rows={exportRows} headers={exportHeaders} filename={`sales-by-salesperson-${from}_${to}`} disabled={rows.length === 0} />
        </div>
      </div>

      {isFetching && rows.length === 0 && <p className="text-sm text-ink-secondary">{t('common.loading')}</p>}
      {!isFetching && rows.length === 0 && <p className="text-sm text-ink-tertiary">{t('reports.no_data')}</p>}

      {rows.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-surface-subtle">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('reports.salesperson')}</th>
                  <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.invoice_count')}</th>
                  <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.returns')}</th>
                  <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.net_sales')}</th>
                  <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.gross_profit')}</th>
                  <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.gp_pct')}</th>
                  <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.avg_invoice')}</th>
                  <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.commission_pct')}</th>
                  <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.commission')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map(r => (
                  <tr key={r.salesperson_id ?? 'unassigned'} className="hover:bg-surface-subtle/50">
                    <td className="px-4 py-2 text-ink-primary font-medium">{r.salesperson_name}</td>
                    <td className="px-4 py-2 text-right text-ink-secondary">{r.invoice_count}</td>
                    <td className="px-4 py-2 text-right text-danger-600">{r.returns_total > 0 ? `−${fmt(r.returns_total)}` : '—'}</td>
                    <td className="px-4 py-2 text-right text-ink-primary font-medium">{fmt(r.net_sales)}</td>
                    <td className="px-4 py-2 text-right text-emerald-700 font-medium">{fmt(r.gross_profit)}</td>
                    <td className="px-4 py-2 text-right text-ink-secondary">{r.gp_pct.toFixed(1)}%</td>
                    <td className="px-4 py-2 text-right text-ink-secondary">{fmt(r.avg_invoice_value)}</td>
                    <td className="px-4 py-2 text-right text-ink-secondary">{r.commission_pct != null ? `${r.commission_pct.toFixed(1)}%` : '—'}</td>
                    <td className="px-4 py-2 text-right font-semibold text-brand-600">{r.commission_pct != null ? fmt(r.commission) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border bg-surface-subtle">
                <tr>
                  <td className="px-4 py-2 font-semibold text-ink-primary">{t('common.total')}</td>
                  <td className="px-4 py-2 text-right font-semibold text-ink-primary">{rows.reduce((s, r) => s + r.invoice_count, 0)}</td>
                  <td className="px-4 py-2 text-right font-semibold text-danger-600">{fmt(rows.reduce((s, r) => s + r.returns_total, 0))}</td>
                  <td className="px-4 py-2 text-right font-semibold text-ink-primary">{fmt(rows.reduce((s, r) => s + r.net_sales, 0))}</td>
                  <td className="px-4 py-2 text-right font-semibold text-emerald-700">{fmt(rows.reduce((s, r) => s + r.gross_profit, 0))}</td>
                  <td className="px-4 py-2" />
                  <td className="px-4 py-2" />
                  <td className="px-4 py-2" />
                  <td className="px-4 py-2 text-right font-semibold text-brand-600">{fmt(rows.reduce((s, r) => s + r.commission, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs text-ink-tertiary">{t('reports.commission_note')}</p>
        </>
      )}
    </div>
  );
}
