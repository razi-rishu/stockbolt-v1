import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function GRNReconciliationPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.grn-reconciliation.period', 'this_month');
  const asOf = to;

  const { data, isFetching } = useQuery({
    queryKey: ['grn_reconciliation', company_id, asOf],
    queryFn: () => getAdapter().reports.getGRNReconciliation(company_id!, asOf),
    enabled: !!company_id,
  });

  const exportRows: Record<string, unknown>[] = (data?.lines ?? []).map(line => ({
    GRN: line.grn_number,
    Supplier: line.supplier_name,
    Date: line.date,
    'Total Cost': line.total_cost.toFixed(2),
    Billed: line.billed_amount.toFixed(2),
    Unbilled: line.unbilled_amount.toFixed(2),
  }));
  const exportHeaders = ['GRN', 'Supplier', 'Date', 'Total Cost', 'Billed', 'Unbilled'];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink-primary">{t('reports.grn_reconciliation')}</h1>
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          <PeriodPicker mode="asOf" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
          <ReportActions rows={exportRows} headers={exportHeaders} filename={`grn-reconciliation-${asOf}`} disabled={!data} />
        </div>
      </div>
      <p className="text-sm text-ink-secondary">{t('reports.grn_reconciliation_desc')}</p>

      {isFetching && !data && <div className="text-sm text-ink-tertiary">{t('common.loading')}</div>}
      {data && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-card border border-border-subtle bg-surface-card p-4">
              <p className="text-xs text-ink-tertiary">{t('reports.total_accrual')}</p>
              <p className="text-xl font-semibold text-ink-primary mt-1">{fmt(data.total_accrual)}</p>
            </div>
            <div className="rounded-card border border-border-subtle bg-surface-card p-4">
              <p className="text-xs text-ink-tertiary">{t('reports.total_billed')}</p>
              <p className="text-xl font-semibold text-green-600 mt-1">{fmt(data.total_billed)}</p>
            </div>
            <div className="rounded-card border border-border-subtle bg-surface-card p-4">
              <p className="text-xs text-ink-tertiary">{t('reports.total_unbilled')}</p>
              <p className="text-xl font-semibold text-orange-600 mt-1">{fmt(data.total_unbilled)}</p>
            </div>
          </div>

          <div className="rounded-card border border-border-subtle bg-surface-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle bg-surface-muted text-ink-tertiary text-xs">
                  <th className="px-4 py-3 text-start font-medium">{t('purchasing.grn_number')}</th>
                  <th className="px-4 py-3 text-start font-medium">{t('purchasing.supplier')}</th>
                  <th className="px-4 py-3 text-start font-medium">{t('purchasing.date')}</th>
                  <th className="px-4 py-3 text-end font-medium">{t('reports.total_cost')}</th>
                  <th className="px-4 py-3 text-end font-medium">{t('reports.billed')}</th>
                  <th className="px-4 py-3 text-end font-medium">{t('reports.unbilled')}</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map(line => (
                  <tr key={line.grn_id} className="border-b border-border-subtle last:border-0">
                    <td className="px-4 py-3 font-mono text-xs text-brand-700">{line.grn_number}</td>
                    <td className="px-4 py-3 text-ink-primary">{line.supplier_name}</td>
                    <td className="px-4 py-3 text-ink-secondary">{line.date}</td>
                    <td className="px-4 py-3 text-end font-mono">{fmt(line.total_cost)}</td>
                    <td className="px-4 py-3 text-end font-mono text-green-600">{fmt(line.billed_amount)}</td>
                    <td className="px-4 py-3 text-end font-mono text-orange-600">{fmt(line.unbilled_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
