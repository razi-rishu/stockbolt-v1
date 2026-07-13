import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Select } from '@/ui/select';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import type { ProductRow, WarehouseRow } from '@/data/adapter';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TYPE_LABELS: Record<string, string> = {
  purchase: 'Purchase', sale: 'Sale',
  transfer_in: 'Transfer In', transfer_out: 'Transfer Out',
  adjustment_in: 'Adjustment In', adjustment_out: 'Adjustment Out',
  opening: 'Opening',
};

export default function StockMovementReportPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.stock-movement.period', 'this_month');

  const [productId, setProductId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');

  const { data: products = [] } = useQuery<ProductRow[]>({
    queryKey: ['products', company_id],
    queryFn: () => getAdapter().products.list(company_id!),
    enabled: !!company_id,
  });

  const { data: warehouses = [] } = useQuery<WarehouseRow[]>({
    queryKey: ['warehouses', company_id],
    queryFn: () => getAdapter().warehouses.list(company_id!),
    enabled: !!company_id,
  });

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['report_stock_movement', company_id, productId, warehouseId, from, to],
    queryFn: () => getAdapter().reports.getStockMovement(company_id!, {
      product_id: productId || undefined,
      warehouse_id: warehouseId || undefined,
      date_from: from,
      date_to: to,
    }),
    enabled: !!company_id,
  });

  const productOpts = [
    { value: '', label: t('inventory.all_products') },
    ...products.map(p => ({ value: p.id, label: `${p.sku} — ${p.name}` })),
  ];
  const warehouseOpts = [
    { value: '', label: t('inventory.all_warehouses') },
    ...warehouses.map(w => ({ value: w.id, label: w.name })),
  ];

  const totalIn  = rows.filter(r => r.direction === 1).reduce((s, r) => s + r.quantity, 0);
  const totalOut = rows.filter(r => r.direction === -1).reduce((s, r) => s + r.quantity, 0);

  const exportRows: Record<string, unknown>[] = rows.map(r => ({
    Date: r.date as string,
    Product: r.product_name,
    SKU: r.sku ?? '',
    Warehouse: r.warehouse_name,
    Type: TYPE_LABELS[r.movement_type] ?? r.movement_type,
    'Qty In': r.direction === 1 ? r.quantity : 0,
    'Qty Out': r.direction === -1 ? r.quantity : 0,
    'Running Qty': r.running_qty,
    'Unit Cost': r.unit_cost != null ? r.unit_cost.toFixed(2) : '',
  }));
  const exportHeaders = ['Date', 'Product', 'SKU', 'Warehouse', 'Type', 'Qty In', 'Qty Out', 'Running Qty', 'Unit Cost'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink-primary">{t('reports.stock_movement')}</h1>
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
          <ReportActions rows={exportRows} headers={exportHeaders} filename={`stock-movement-${from}_${to}`} disabled={rows.length === 0} />
        </div>
      </div>

      <div data-print-hide className="flex flex-wrap items-center gap-2">
        <div className="w-64"><Select options={productOpts} value={productId} onChange={e => setProductId(e.target.value)} /></div>
        <div className="w-48"><Select options={warehouseOpts} value={warehouseId} onChange={e => setWarehouseId(e.target.value)} /></div>
      </div>

      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-card border border-border-subtle bg-surface-card p-4">
            <p className="text-xs text-ink-tertiary">{t('inventory.total_in')}</p>
            <p className="text-lg font-semibold text-green-600 mt-1">{fmt(totalIn)}</p>
          </div>
          <div className="rounded-card border border-border-subtle bg-surface-card p-4">
            <p className="text-xs text-ink-tertiary">{t('inventory.total_out')}</p>
            <p className="text-lg font-semibold text-red-600 mt-1">{fmt(totalOut)}</p>
          </div>
        </div>
      )}

      <div className="rounded-card border border-border-subtle bg-surface-card overflow-x-auto">
        {rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-ink-tertiary">{isFetching ? t('common.loading') : t('inventory.no_movements')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-ink-tertiary text-xs">
                <th className="px-4 py-3 text-start font-medium">{t('inventory.date')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('inventory.product')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('inventory.warehouse')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('inventory.type')}</th>
                <th className="px-4 py-3 text-end font-medium w-24">{t('inventory.qty_in')}</th>
                <th className="px-4 py-3 text-end font-medium w-24">{t('inventory.qty_out')}</th>
                <th className="px-4 py-3 text-end font-medium w-28">{t('inventory.running_qty')}</th>
                <th className="px-4 py-3 text-end font-medium w-28">{t('inventory.unit_cost')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const isIn = row.direction === 1;
                const isOut = row.direction === -1;
                return (
                  <tr key={i} className="border-b border-border-subtle last:border-0">
                    <td className="px-4 py-2 text-ink-secondary">{row.date as string}</td>
                    <td className="px-4 py-2 text-ink-primary">
                      <span className="font-medium text-sm">{row.product_name}</span>
                      {row.sku && <span className="ml-1.5 text-xs text-ink-tertiary">({row.sku})</span>}
                    </td>
                    <td className="px-4 py-2 text-ink-secondary text-sm">{row.warehouse_name}</td>
                    <td className="px-4 py-2 text-ink-secondary">{TYPE_LABELS[row.movement_type] ?? row.movement_type}</td>
                    <td className="px-4 py-2 text-end text-green-700 font-mono">{isIn ? fmt(row.quantity) : '—'}</td>
                    <td className="px-4 py-2 text-end text-red-700 font-mono">{isOut ? fmt(row.quantity) : '—'}</td>
                    <td className="px-4 py-2 text-end font-mono font-semibold">{fmt(row.running_qty)}</td>
                    <td className="px-4 py-2 text-end font-mono text-ink-secondary">
                      {row.unit_cost != null ? fmt(row.unit_cost) : '—'}
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
