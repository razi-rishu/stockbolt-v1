import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { ReportActions } from '@/ui/report-actions';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BUCKET_LABELS: Record<string, string> = {
  '0_30': '0–30 days', '31_60': '31–60 days', '61_90': '61–90 days', 'over_90': '90+ days',
};
const BUCKET_COLORS: Record<string, string> = {
  '0_30': 'bg-green-50 text-green-700',
  '31_60': 'bg-yellow-50 text-yellow-700',
  '61_90': 'bg-orange-50 text-orange-700',
  'over_90': 'bg-red-50 text-red-700',
};

export default function StockAgingReportPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['report_stock_aging', company_id],
    queryFn: () => getAdapter().reports.getStockAging(company_id!),
    enabled: !!company_id,
  });

  // Group by bucket for summary
  const summary = rows.reduce((acc, row) => {
    const b = row.aging_bucket;
    acc[b] = (acc[b] ?? 0) + (row.stock_value ?? 0);
    return acc;
  }, {} as Record<string, number>);

  const exportRows: Record<string, unknown>[] = rows.map(r => ({
    Product: r.product_name,
    SKU: r.sku ?? '',
    Warehouse: r.warehouse_name,
    'Qty On Hand': r.qty_on_hand,
    'Unit Cost': r.unit_cost != null ? r.unit_cost.toFixed(2) : '',
    'Stock Value': r.stock_value != null ? r.stock_value.toFixed(2) : '',
    'Last Movement': r.last_movement_date ? (r.last_movement_date as string) : '',
    'Days Idle': r.days_idle,
    'Aging Bucket': BUCKET_LABELS[r.aging_bucket] ?? r.aging_bucket,
  }));
  const exportHeaders = ['Product', 'SKU', 'Warehouse', 'Qty On Hand', 'Unit Cost', 'Stock Value', 'Last Movement', 'Days Idle', 'Aging Bucket'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink-primary">{t('reports.stock_aging')}</h1>
        <ReportActions rows={exportRows} headers={exportHeaders} filename="stock-aging" disabled={rows.length === 0} />
      </div>

      {/* Bucket summary cards */}
      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {(['0_30', '31_60', '61_90', 'over_90'] as const).map(b => (
            <div key={b} className="rounded-card border border-border-subtle bg-surface-card p-4">
              <p className="text-xs text-ink-tertiary">{BUCKET_LABELS[b]}</p>
              <p className="text-lg font-semibold text-ink-primary mt-1">{fmt(summary[b] ?? 0)}</p>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-sm text-ink-tertiary">{t('common.loading')}</div>
      ) : rows.length === 0 ? (
        <div className="py-12 text-center text-sm text-ink-tertiary">{t('reports.no_stock_aging')}</div>
      ) : (
        <div className="rounded-card border border-border-subtle bg-surface-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-ink-tertiary text-xs">
                <th className="px-4 py-3 text-start font-medium">{t('inventory.product')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('inventory.warehouse')}</th>
                <th className="px-4 py-3 text-end font-medium w-28">{t('inventory.qty_on_hand')}</th>
                <th className="px-4 py-3 text-end font-medium w-28">{t('inventory.unit_cost')}</th>
                <th className="px-4 py-3 text-end font-medium w-28">{t('inventory.stock_value')}</th>
                <th className="px-4 py-3 text-start font-medium w-28">{t('reports.last_movement')}</th>
                <th className="px-4 py-3 text-end font-medium w-24">{t('reports.days_idle')}</th>
                <th className="px-4 py-3 text-start font-medium w-28">{t('reports.aging_bucket')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-border-subtle last:border-0">
                  <td className="px-4 py-3 text-ink-primary">
                    <span className="font-medium text-sm">{row.product_name}</span>
                    {row.sku && <span className="ml-1.5 text-xs text-ink-tertiary">({row.sku})</span>}
                  </td>
                  <td className="px-4 py-3 text-ink-secondary text-sm">{row.warehouse_name}</td>
                  <td className="px-4 py-3 text-end font-mono">{fmt(row.qty_on_hand)}</td>
                  <td className="px-4 py-3 text-end font-mono text-ink-secondary">
                    {row.unit_cost != null ? fmt(row.unit_cost) : '—'}
                  </td>
                  <td className="px-4 py-3 text-end font-mono font-semibold text-ink-primary">
                    {row.stock_value != null ? fmt(row.stock_value) : '—'}
                  </td>
                  <td className="px-4 py-3 text-ink-secondary text-xs">
                    {row.last_movement_date ? (row.last_movement_date as string) : '—'}
                  </td>
                  <td className="px-4 py-3 text-end font-mono">{row.days_idle}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${BUCKET_COLORS[row.aging_bucket] ?? 'bg-surface-muted text-ink-secondary'}`}>
                      {BUCKET_LABELS[row.aging_bucket] ?? row.aging_bucket}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
