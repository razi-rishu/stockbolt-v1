import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';

function fmt(n: number) { return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }

export default function PurchasesBySupplierPage() {
  const { t } = useTranslation();
  const company_id = useAuthStore(s => s.company_id);
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.purchases-by-supplier.period', 'this_month');

  const { data, isFetching } = useQuery({
    queryKey: ['purchases_by_supplier', company_id, from, to],
    queryFn: () => getAdapter().reports.getPurchasesBySupplier(company_id!, from, to),
    enabled: !!company_id,
  });
  const rows = data ?? [];

  const totNet = rows.reduce((s, r) => s + r.net_purchases, 0);

  const exportRows: Record<string, unknown>[] = rows.map(r => ({
    Supplier: r.contact_name,
    'Bill Count': r.bill_count,
    'Gross Purchases': r.gross_purchases.toFixed(2),
    'Net Purchases': r.net_purchases.toFixed(2),
    '% of Total': r.pct_of_total.toFixed(1),
  }));
  const exportHeaders = ['Supplier', 'Bill Count', 'Gross Purchases', 'Net Purchases', '% of Total'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink-primary">{t('reports.purchases_by_supplier')}</h1>
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
          <ReportActions rows={exportRows} headers={exportHeaders} filename={`purchases-by-supplier-${from}_${to}`} disabled={rows.length === 0} />
        </div>
      </div>

      {isFetching && rows.length === 0 && <p className="text-sm text-ink-secondary">{t('common.loading')}</p>}
      {!isFetching && rows.length === 0 && <p className="text-sm text-ink-tertiary">{t('reports.no_data')}</p>}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-surface-subtle">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('contacts.supplier')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.bill_count')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.gross_purchases')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.net_purchases')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.pct_of_total')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(r => (
                <tr key={r.contact_id} className="hover:bg-surface-subtle/50">
                  <td className="px-4 py-2 text-ink-primary font-medium">{r.contact_name}</td>
                  <td className="px-4 py-2 text-right text-ink-secondary">{r.bill_count}</td>
                  <td className="px-4 py-2 text-right text-ink-secondary">{fmt(r.gross_purchases)}</td>
                  <td className="px-4 py-2 text-right text-ink-primary font-medium">{fmt(r.net_purchases)}</td>
                  <td className="px-4 py-2 text-right text-ink-secondary">{r.pct_of_total.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-border bg-surface-subtle font-semibold">
              <tr>
                <td colSpan={3} className="px-4 py-2 text-ink-primary">{t('common.total')}</td>
                <td className="px-4 py-2 text-right text-ink-primary">{fmt(totNet)}</td>
                <td className="px-4 py-2 text-right text-ink-secondary">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
