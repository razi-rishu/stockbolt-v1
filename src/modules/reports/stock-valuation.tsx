import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { DocLink } from '@/ui/doc-link';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function StockValuationPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.stock-valuation.period', 'this_month');
  const asOf = to;

  const { data: sv, isFetching, error } = useQuery({
    queryKey: ['stock_valuation', company_id, asOf],
    queryFn: () => getAdapter().reports.getStockValuation(company_id!, asOf),
    enabled: !!company_id,
  });

  const exportRows: Record<string, unknown>[] = (sv?.lines ?? []).map(l => ({
    Code: l.product_code,
    Product: l.product_name,
    Warehouse: l.warehouse_name,
    Qty: l.quantity,
    'Unit Cost': l.unit_cost.toFixed(2),
    'Total Value': l.total_value.toFixed(2),
  }));
  const exportHeaders = ['Code', 'Product', 'Warehouse', 'Qty', 'Unit Cost', 'Total Value'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink-primary">{t('reports.stock_valuation_title')}</h1>
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          <PeriodPicker mode="asOf" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
          <ReportActions rows={exportRows} headers={exportHeaders} filename={`stock-valuation-${asOf}`} disabled={!sv || sv.lines.length === 0} />
        </div>
      </div>

      {isFetching && !sv && <p className="text-sm text-ink-secondary">{t('common.loading')}</p>}
      {error && <p className="text-sm text-red-600">{String(error)}</p>}

      {sv && sv.lines.length === 0 && (
        <p className="text-sm text-ink-tertiary">{t('reports.no_stock')}</p>
      )}

      {sv && sv.lines.length > 0 && (
        <div className="rounded-card border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-5 py-3 text-sm text-ink-secondary">
            {t('reports.as_of_date')}: {asOf}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                <th className="px-4 py-2.5 text-start font-medium">{t('products.code')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('products.name')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('reports.warehouse')}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t('reports.qty')}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t('reports.unit_cost')}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t('reports.total_value')}</th>
              </tr>
            </thead>
            <tbody>
              {sv.lines.map((l, i) => (
                <tr key={i} className="border-b border-border-subtle last:border-0">
                  <td className="px-4 py-2.5 font-mono text-xs text-ink-primary">{l.product_code}</td>
                  <td className="px-4 py-2.5"><DocLink type="product" id={l.product_id} label={l.product_name} className="font-medium text-brand-600 hover:underline" /></td>
                  <td className="px-4 py-2.5 text-ink-secondary">{l.warehouse_name}</td>
                  <td className="px-4 py-2.5 text-end font-mono text-ink-primary">{l.quantity.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-end font-mono text-ink-primary">{fmt(l.unit_cost)}</td>
                  <td className="px-4 py-2.5 text-end font-mono font-semibold text-ink-primary">{fmt(l.total_value)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-border-subtle bg-surface-muted font-bold">
                <td colSpan={5} className="px-4 py-2.5 text-ink-primary">{t('reports.total_stock_value')}</td>
                <td className="px-4 py-2.5 text-end font-mono text-ink-primary">{fmt(sv.total_value)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
