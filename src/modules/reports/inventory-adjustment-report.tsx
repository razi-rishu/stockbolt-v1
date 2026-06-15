import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import type { WarehouseRow } from '@/data/adapter';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function InventoryAdjustmentReportPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();

  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 7) + '-01';

  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(today);
  const [submitted, setSubmitted] = useState(false);

  const { data: warehouses = [] } = useQuery<WarehouseRow[]>({
    queryKey: ['warehouses', company_id],
    queryFn: () => getAdapter().warehouses.list(company_id!),
    enabled: !!company_id,
  });
  const warehouseMap = Object.fromEntries(warehouses.map(w => [w.id, w.name]));

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['report_inv_adjustment', company_id, dateFrom, dateTo, submitted],
    queryFn: () => getAdapter().reports.getInventoryAdjustmentReport(company_id!, {
      date_from: dateFrom,
      date_to: dateTo,
    }),
    enabled: !!company_id && submitted,
  });

  const totalGain = rows.reduce((s, r) => s + (r.total_gain ?? 0), 0);
  const totalLoss = rows.reduce((s, r) => s + (r.total_loss ?? 0), 0);
  const net = totalGain - totalLoss;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-ink-primary">{t('reports.inventory_adjustment_report')}</h1>

      <div className="rounded-card border border-border-subtle bg-surface-card p-5">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Input label={t('inventory.date_from')} type="date" value={dateFrom}
            onChange={e => { setDateFrom(e.target.value); setSubmitted(false); }} />
          <Input label={t('inventory.date_to')} type="date" value={dateTo}
            onChange={e => { setDateTo(e.target.value); setSubmitted(false); }} />
        </div>
        <div className="mt-4 flex justify-end">
          <Button size="sm" onClick={() => setSubmitted(true)} disabled={isFetching}>
            {isFetching ? t('common.loading') : t('common.run')}
          </Button>
        </div>
      </div>

      {submitted && rows.length > 0 && (
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

      {submitted && (
        <div className="rounded-card border border-border-subtle bg-surface-card overflow-x-auto">
          {rows.length === 0 && !isFetching ? (
            <p className="py-12 text-center text-sm text-ink-tertiary">{t('reports.no_adjustments')}</p>
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
      )}
    </div>
  );
}
