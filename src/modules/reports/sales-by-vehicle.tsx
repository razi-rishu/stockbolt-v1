import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';

function fmt(n: number) { return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }

export default function SalesByVehiclePage() {
  const { t } = useTranslation();
  const company_id = useAuthStore(s => s.company_id);
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.sales-by-vehicle.period', 'this_month');

  const { data, isFetching } = useQuery({
    queryKey: ['sales_by_vehicle', company_id, from, to],
    queryFn: () => getAdapter().reports.getSalesByVehicle(company_id!, from, to),
    enabled: !!company_id,
  });
  const rows = data ?? [];

  const exportRows: Record<string, unknown>[] = rows.map(r => ({
    Make: r.make_name,
    Model: r.model_name ?? 'All',
    'Qty Sold': r.qty,
    Revenue: r.revenue.toFixed(2),
    'Gross Profit': r.gross_profit.toFixed(2),
  }));
  const exportHeaders = ['Make', 'Model', 'Qty Sold', 'Revenue', 'Gross Profit'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink-primary">{t('reports.sales_by_vehicle')}</h1>
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
          <ReportActions rows={exportRows} headers={exportHeaders} filename={`sales-by-vehicle-${from}_${to}`} disabled={rows.length === 0} />
        </div>
      </div>
      <p className="text-xs text-ink-tertiary">{t('reports.sales_by_vehicle_note')}</p>

      {isFetching && rows.length === 0 && <p className="text-sm text-ink-secondary">{t('common.loading')}</p>}
      {!isFetching && rows.length === 0 && <p className="text-sm text-ink-tertiary">{t('reports.no_data')}</p>}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-surface-subtle">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('products.vehicle_make')}</th>
                <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('products.vehicle_model')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.qty_sold')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.revenue')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.gross_profit')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-surface-subtle/50">
                  <td className="px-4 py-2 text-ink-primary font-medium">{r.make_name}</td>
                  <td className="px-4 py-2 text-ink-secondary">{r.model_name ?? t('common.all')}</td>
                  <td className="px-4 py-2 text-right text-ink-secondary">{r.qty}</td>
                  <td className="px-4 py-2 text-right text-ink-primary font-medium">{fmt(r.revenue)}</td>
                  <td className="px-4 py-2 text-right text-emerald-700 font-medium">{fmt(r.gross_profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
