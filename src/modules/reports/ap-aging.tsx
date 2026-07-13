import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { DocLink } from '@/ui/doc-link';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function APAgingPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.ap-aging.period', 'this_month');
  const asOf = to;

  const { data, isFetching } = useQuery({
    queryKey: ['ap_aging', company_id, asOf],
    queryFn: () => getAdapter().reports.getAPAgingReport(company_id!, asOf),
    enabled: !!company_id,
  });

  const exportRows: Record<string, unknown>[] = (data?.buckets ?? []).map(b => ({
    Supplier: b.contact_name,
    Current: b.current.toFixed(2),
    '31-60': b.days_31_60.toFixed(2),
    '61-90': b.days_61_90.toFixed(2),
    '>90': b.over_90.toFixed(2),
    Total: b.total.toFixed(2),
  }));
  const exportHeaders = ['Supplier', 'Current', '31-60', '61-90', '>90', 'Total'];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink-primary">{t('reports.ap_aging')}</h1>
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          <PeriodPicker mode="asOf" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
          <ReportActions rows={exportRows} headers={exportHeaders} filename={`ap-aging-${asOf}`} disabled={!data} />
        </div>
      </div>

      {isFetching && !data && <div className="text-sm text-ink-tertiary">{t('common.loading')}</div>}
      {data && (
        <div className="rounded-card border border-border-subtle bg-surface-card overflow-x-auto">
          <div className="border-b border-border-subtle px-5 py-3 text-sm text-ink-secondary">
            {t('reports.as_of_date')}: {asOf}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-ink-tertiary text-xs">
                <th className="px-4 py-3 text-start font-medium">{t('reports.supplier')}</th>
                <th className="px-4 py-3 text-end font-medium">{t('reports.current')}</th>
                <th className="px-4 py-3 text-end font-medium">31–60</th>
                <th className="px-4 py-3 text-end font-medium">61–90</th>
                <th className="px-4 py-3 text-end font-medium">{t('reports.over_90')}</th>
                <th className="px-4 py-3 text-end font-medium">{t('reports.total')}</th>
              </tr>
            </thead>
            <tbody>
              {data.buckets.map(b => (
                <tr key={b.contact_id} className="border-b border-border-subtle last:border-0">
                  <td className="px-4 py-3"><DocLink type="supplier" id={b.contact_id} label={b.contact_name} className="font-medium text-brand-600 hover:underline" /></td>
                  <td className="px-4 py-3 text-end font-mono">{b.current > 0 ? fmt(b.current) : '—'}</td>
                  <td className="px-4 py-3 text-end font-mono text-yellow-600">{b.days_31_60 > 0 ? fmt(b.days_31_60) : '—'}</td>
                  <td className="px-4 py-3 text-end font-mono text-orange-600">{b.days_61_90 > 0 ? fmt(b.days_61_90) : '—'}</td>
                  <td className="px-4 py-3 text-end font-mono text-red-600">{b.over_90 > 0 ? fmt(b.over_90) : '—'}</td>
                  <td className="px-4 py-3 text-end font-mono font-semibold">{fmt(b.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border-subtle bg-surface-muted font-semibold text-xs">
                <td className="px-4 py-3">{t('reports.total')}</td>
                <td className="px-4 py-3 text-end font-mono">{fmt(data.total_current)}</td>
                <td className="px-4 py-3 text-end font-mono text-yellow-600">{fmt(data.total_31_60)}</td>
                <td className="px-4 py-3 text-end font-mono text-orange-600">{fmt(data.total_61_90)}</td>
                <td className="px-4 py-3 text-end font-mono text-red-600">{fmt(data.total_over_90)}</td>
                <td className="px-4 py-3 text-end font-mono">{fmt(data.grand_total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
