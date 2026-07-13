import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';

function fmt(n: number) { return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }

export default function SalesByCustomerPage() {
  const { t } = useTranslation();
  const company_id = useAuthStore(s => s.company_id);
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.sales-by-customer.period', 'this_month');

  const { data, isFetching } = useQuery({
    queryKey: ['sales_by_customer', company_id, from, to],
    queryFn: () => getAdapter().reports.getSalesByCustomer(company_id!, from, to),
    enabled: !!company_id,
  });
  const rows = data ?? [];

  const totNet = rows.reduce((s, r) => s + r.net_sales, 0);
  const totGP  = rows.reduce((s, r) => s + r.gross_profit, 0);

  const exportRows: Record<string, unknown>[] = rows.map(r => ({
    Customer: r.contact_name,
    'Invoice Count': r.invoice_count,
    'Gross Sales': r.gross_sales.toFixed(2),
    Returns: r.returns.toFixed(2),
    'Net Sales': r.net_sales.toFixed(2),
    'Gross Profit': r.gross_profit.toFixed(2),
    'GP %': r.gp_pct.toFixed(1),
  }));
  const exportHeaders = ['Customer', 'Invoice Count', 'Gross Sales', 'Returns', 'Net Sales', 'Gross Profit', 'GP %'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink-primary">{t('reports.sales_by_customer')}</h1>
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
          <ReportActions rows={exportRows} headers={exportHeaders} filename={`sales-by-customer-${from}_${to}`} disabled={rows.length === 0} />
        </div>
      </div>

      {isFetching && rows.length === 0 && <p className="text-sm text-ink-secondary">{t('common.loading')}</p>}
      {!isFetching && rows.length === 0 && <p className="text-sm text-ink-tertiary">{t('reports.no_data')}</p>}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-surface-subtle">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('contacts.customer')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.invoice_count')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.gross_sales')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.returns')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.net_sales')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.gross_profit')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.gp_pct')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(r => (
                <tr key={r.contact_id} className="hover:bg-surface-subtle/50">
                  <td className="px-4 py-2 text-ink-primary font-medium">{r.contact_name}</td>
                  <td className="px-4 py-2 text-right text-ink-secondary">{r.invoice_count}</td>
                  <td className="px-4 py-2 text-right text-ink-secondary">{fmt(r.gross_sales)}</td>
                  <td className="px-4 py-2 text-right text-red-600">{r.returns > 0 ? `(${fmt(r.returns)})` : '—'}</td>
                  <td className="px-4 py-2 text-right text-ink-primary font-medium">{fmt(r.net_sales)}</td>
                  <td className="px-4 py-2 text-right text-emerald-700 font-medium">{fmt(r.gross_profit)}</td>
                  <td className="px-4 py-2 text-right text-ink-secondary">{r.gp_pct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-border bg-surface-subtle font-semibold">
              <tr>
                <td colSpan={4} className="px-4 py-2 text-ink-primary">{t('common.total')}</td>
                <td className="px-4 py-2 text-right text-ink-primary">{fmt(totNet)}</td>
                <td className="px-4 py-2 text-right text-emerald-700">{fmt(totGP)}</td>
                <td className="px-4 py-2 text-right text-ink-secondary">{totNet > 0 ? (totGP / totNet * 100).toFixed(1) : 0}%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
