import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';

function fmt(n: number) { return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }

export default function SalesByProductPage() {
  const { t } = useTranslation();
  const company_id = useAuthStore(s => s.company_id);
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.sales-by-product.period', 'this_month');

  const { data, isFetching } = useQuery({
    queryKey: ['sales_by_product', company_id, from, to],
    queryFn: () => getAdapter().reports.getSalesByProduct(company_id!, from, to),
    enabled: !!company_id,
  });
  const rows = data ?? [];

  const exportRows: Record<string, unknown>[] = rows.map(r => ({
    SKU: r.sku,
    Product: r.product_name,
    Brand: r.brand_name || '',
    'Qty Sold': r.qty_sold,
    'Net Sales': r.net_sales.toFixed(2),
    'Gross Profit': r.gross_profit.toFixed(2),
    'GP %': r.gp_pct.toFixed(1),
  }));
  const exportHeaders = ['SKU', 'Product', 'Brand', 'Qty Sold', 'Net Sales', 'Gross Profit', 'GP %'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink-primary">{t('reports.sales_by_product')}</h1>
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
          <ReportActions rows={exportRows} headers={exportHeaders} filename={`sales-by-product-${from}_${to}`} disabled={rows.length === 0} />
        </div>
      </div>

      {isFetching && rows.length === 0 && <p className="text-sm text-ink-secondary">{t('common.loading')}</p>}
      {!isFetching && rows.length === 0 && <p className="text-sm text-ink-tertiary">{t('reports.no_data')}</p>}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-surface-subtle">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('products.sku')}</th>
                <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('products.name')}</th>
                <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('products.brand')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.qty_sold')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.net_sales')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.gross_profit')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.gp_pct')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(r => (
                <tr key={r.product_id} className="hover:bg-surface-subtle/50">
                  <td className="px-4 py-2 text-ink-secondary font-mono text-xs">{r.sku}</td>
                  <td className="px-4 py-2 text-ink-primary font-medium">{r.product_name}</td>
                  <td className="px-4 py-2 text-ink-secondary">{r.brand_name || '—'}</td>
                  <td className="px-4 py-2 text-right text-ink-secondary">{r.qty_sold}</td>
                  <td className="px-4 py-2 text-right text-ink-primary font-medium">{fmt(r.net_sales)}</td>
                  <td className="px-4 py-2 text-right text-emerald-700 font-medium">{fmt(r.gross_profit)}</td>
                  <td className="px-4 py-2 text-right text-ink-secondary">{r.gp_pct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
