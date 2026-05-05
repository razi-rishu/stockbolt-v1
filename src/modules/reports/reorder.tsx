import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ReorderReportPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['report_reorder', company_id],
    queryFn: () => getAdapter().reports.getReorderReport(company_id!),
    enabled: !!company_id,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-ink-primary">{t('reports.reorder')}</h1>
      <p className="text-sm text-ink-tertiary">{t('reports.reorder_desc')}</p>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-ink-tertiary">{t('common.loading')}</div>
      ) : rows.length === 0 ? (
        <div className="py-12 text-center text-sm text-ink-tertiary">{t('reports.no_reorder_needed')}</div>
      ) : (
        <div className="rounded-card border border-border-subtle bg-surface-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-ink-tertiary text-xs">
                <th className="px-4 py-3 text-start font-medium">{t('inventory.product')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('inventory.warehouse')}</th>
                <th className="px-4 py-3 text-end font-medium w-28">{t('inventory.qty_on_hand')}</th>
                <th className="px-4 py-3 text-end font-medium w-28">{t('reports.min_stock_level')}</th>
                <th className="px-4 py-3 text-end font-medium w-28">{t('reports.shortage')}</th>
                <th className="px-4 py-3 text-end font-medium w-28">{t('inventory.unit_cost')}</th>
                <th className="px-4 py-3 text-end font-medium w-28">{t('reports.reorder_value')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const shortage = Math.max(0, row.min_stock_level - row.qty_on_hand);
                const reorderValue = shortage * (row.unit_cost ?? 0);
                return (
                  <tr key={i} className="border-b border-border-subtle last:border-0">
                    <td className="px-4 py-3 text-ink-primary text-xs font-medium">{row.product_id}</td>
                    <td className="px-4 py-3 text-ink-secondary text-xs">{row.warehouse_id}</td>
                    <td className="px-4 py-3 text-end font-mono text-red-600 font-semibold">{fmt(row.qty_on_hand)}</td>
                    <td className="px-4 py-3 text-end font-mono text-ink-secondary">{fmt(row.min_stock_level)}</td>
                    <td className="px-4 py-3 text-end font-mono text-orange-600 font-semibold">{fmt(shortage)}</td>
                    <td className="px-4 py-3 text-end font-mono text-ink-secondary">
                      {row.unit_cost != null ? fmt(row.unit_cost) : '—'}
                    </td>
                    <td className="px-4 py-3 text-end font-mono font-semibold text-ink-primary">
                      {fmt(reorderValue)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
