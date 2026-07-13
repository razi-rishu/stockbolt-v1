import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import type { WarehouseRow } from '@/data/adapter';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function InventoryAdjustmentReportPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.inventory-adjustment.period', 'this_month');

  const { data: warehouses = [] } = useQuery<WarehouseRow[]>({
    queryKey: ['warehouses', company_id],
    queryFn: () => getAdapter().warehouses.list(company_id!),
    enabled: !!company_id,
  });
  const warehouseMap = Object.fromEntries(warehouses.map(w => [w.id, w.name]));

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['report_inv_adjustment', company_id, from, to],
    queryFn: () => getAdapter().reports.getInventoryAdjustmentReport(company_id!, {
      date_from: from,
      date_to: to,
    }),
    enabled: !!company_id,
  });

  const totalGain = rows.reduce((s, r) => s + (r.total_gain ?? 0), 0);
  const totalLoss = rows.reduce((s, r) => s + (r.total_loss ?? 0), 0);
  const net = totalGain - totalLoss;

  const exportRows: Record<string, unknown>[] = rows.map(r => ({
    Date: r.date as string,
    'Adjustment #': r.adjustment_number,
    Warehouse: warehouseMap[r.warehouse_id] ?? r.warehouse_id,
    Reason: r.reason,
    'Total Gain': (r.total_gain ?? 0).toFixed(2),
    'Total Loss': (r.total_loss ?? 0).toFixed(2),
    'Net Change': ((r.total_gain ?? 0) - (r.total_loss ?? 0)).toFixed(2),
  }));
  const exportHeaders = ['Date', 'Adjustment #', 'Warehouse', 'Reason', 'Total Gain', 'Total Loss', 'Net Change'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink-primary">{t('reports.inventory_adjustment_report')}</h1>
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
          <ReportActions rows={exportRows} headers={exportHeaders} filename={`inventory-adjustments-${from}_${to}`} disabled={rows.length === 0} />
        </div>
      </div>

      {rows.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-card border border-border-subtle bg-surface-card p-4">
            <p className="text-xs text-ink-tertiary">{t('inventory.total_gain')}</p>
            <p className="text-lg font-semibold text-green-600 mt-1">{fmt(totalGain)}</p>
          </div>
          <div className="rounded-card border border-border-subtle bg-surface-card p-4">
            <p className="text-xs text-ink-tertiary">{t('inventory.total_loss')}</p>
            <p className="text-lg font-semibold text-red-600 mt-1">{fmt(totalLoss)}</p>
          </div>
          <div className="rounded-card border border-border-subtle bg-surface-card p-4">
            <p className="text-xs text-ink-tertiary">{t('inventory.net_change')}</p>
            <p className={`text-lg font-semibold mt-1 ${net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {net > 0 ? '+' : ''}{fmt(net)}
            </p>
          </div>
        </div>
      )}

      <div className="rounded-card border border-border-subtle bg-surface-card overflow-x-auto">
        {rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-ink-tertiary">{isFetching ? t('common.loading') : t('reports.no_adjustments')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-ink-tertiary text-xs">
                <th className="px-4 py-3 text-start font-medium">{t('inventory.date')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('inventory.adjustment_number')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('inventory.warehouse')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('inventory.reason')}</th>
                <th className="px-4 py-3 text-end font-medium w-28">{t('inventory.total_gain')}</th>
                <th className="px-4 py-3 text-end font-medium w-28">{t('inventory.total_loss')}</th>
                <th className="px-4 py-3 text-end font-medium w-28">{t('inventory.net_change')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const rowNet = (row.total_gain ?? 0) - (row.total_loss ?? 0);
                return (
                  <tr key={i} className="border-b border-border-subtle last:border-0">
                    <td className="px-4 py-3 text-ink-secondary">{row.date as string}</td>
                    <td className="px-4 py-3 font-mono text-xs text-brand-700">{row.adjustment_number}</td>
                    <td className="px-4 py-3 text-ink-secondary text-sm">{warehouseMap[row.warehouse_id] ?? row.warehouse_id}</td>
                    <td className="px-4 py-3 text-ink-secondary capitalize">{row.reason}</td>
                    <td className="px-4 py-3 text-end font-mono text-green-700">{fmt(row.total_gain ?? 0)}</td>
                    <td className="px-4 py-3 text-end font-mono text-red-700">{fmt(row.total_loss ?? 0)}</td>
                    <td className={`px-4 py-3 text-end font-mono font-semibold ${rowNet >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {rowNet > 0 ? '+' : ''}{fmt(rowNet)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
