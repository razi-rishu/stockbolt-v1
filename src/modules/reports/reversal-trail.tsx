import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';

function fmt(n: number) { return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }

export default function ReversalTrailPage() {
  const { t } = useTranslation();
  const company_id = useAuthStore(s => s.company_id);
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.reversal-trail.period', 'this_year');

  const { data, isFetching } = useQuery({
    queryKey: ['reversal_trail', company_id, from, to],
    queryFn: () => getAdapter().reports.getReversalTrail(company_id!, from, to),
    enabled: !!company_id,
  });
  const rows = data ?? [];

  const exportRows: Record<string, unknown>[] = rows.map(r => ({
    'Original Entry': r.original_entry_number,
    Date: r.original_date,
    'Reversal Entry': r.reversal_entry_number,
    'Reversal Date': r.reversal_date,
    Amount: r.amount.toFixed(2),
    'Source Type': r.source_type,
    'Reversed By': r.reversed_by || '',
  }));
  const exportHeaders = ['Original Entry', 'Date', 'Reversal Entry', 'Reversal Date', 'Amount', 'Source Type', 'Reversed By'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink-primary">{t('reports.reversal_trail')}</h1>
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
          <ReportActions rows={exportRows} headers={exportHeaders} filename={`reversal-trail-${from}_${to}`} disabled={rows.length === 0} />
        </div>
      </div>

      {isFetching && rows.length === 0 && <p className="text-sm text-ink-secondary">{t('common.loading')}</p>}
      {!isFetching && rows.length === 0 && <p className="text-sm text-ink-tertiary">{t('reports.no_data')}</p>}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-surface-subtle">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('reports.original_entry')}</th>
                <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('common.date')}</th>
                <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('reports.reversal_entry')}</th>
                <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('reports.reversal_date')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('common.amount')}</th>
                <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('reports.source_type')}</th>
                <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('reports.reversed_by')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-surface-subtle/50">
                  <td className="px-4 py-2">
                    <Link to="/accounting/journal-entries" className="font-medium text-brand-600 hover:underline font-mono text-xs">{r.original_entry_number}</Link>
                  </td>
                  <td className="px-4 py-2 text-ink-secondary">{r.original_date}</td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-secondary">{r.reversal_entry_number}</td>
                  <td className="px-4 py-2 text-ink-secondary">{r.reversal_date}</td>
                  <td className="px-4 py-2 text-right text-ink-primary font-medium">{fmt(r.amount)}</td>
                  <td className="px-4 py-2 text-ink-secondary text-xs">{r.source_type}</td>
                  <td className="px-4 py-2 text-ink-secondary text-xs">{r.reversed_by || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
