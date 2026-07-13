import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { DocLink } from '@/ui/doc-link';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';

export default function AuditLogPage() {
  const { t } = useTranslation();
  const company_id = useAuthStore(s => s.company_id);
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.audit-log.period', 'this_month');
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['audit_log', company_id, from, to],
    queryFn: () => getAdapter().reports.getAuditLog(company_id!, { from, to, limit: 500 }),
    enabled: !!company_id,
  });

  const actionColor = (action: string) => {
    if (action.includes('create') || action.includes('insert')) return 'bg-emerald-100 text-emerald-800';
    if (action.includes('update')) return 'bg-blue-100 text-blue-800';
    if (action.includes('delete') || action.includes('void')) return 'bg-red-100 text-red-800';
    return 'bg-surface-subtle text-ink-secondary';
  };

  const exportRows: Record<string, unknown>[] = rows.map(r => ({
    Timestamp: new Date(r.created_at).toLocaleString(),
    User: r.user_email,
    Action: r.action,
    Entity: r.entity_type,
    'Entity ID': r.entity_id,
  }));
  const exportHeaders = ['Timestamp', 'User', 'Action', 'Entity', 'Entity ID'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink-primary">{t('reports.audit_log')}</h1>
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
          <ReportActions rows={exportRows} headers={exportHeaders} filename={`audit-log-${from}_${to}`} disabled={rows.length === 0} />
        </div>
      </div>

      {isFetching && rows.length === 0 && <p className="text-sm text-ink-secondary">{t('common.loading')}</p>}
      {!isFetching && rows.length === 0 && <p className="text-sm text-ink-tertiary">{t('reports.no_data')}</p>}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-surface-subtle">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('reports.timestamp')}</th>
                <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('reports.user')}</th>
                <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('reports.action')}</th>
                <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('reports.entity')}</th>
                <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('reports.entity_id')}</th>
                <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('reports.changes')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(r => (
                <Fragment key={r.id}>
                  <tr className="hover:bg-surface-subtle/50">
                    <td className="px-4 py-2 text-ink-secondary text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="px-4 py-2 text-ink-secondary text-xs truncate max-w-[160px]">{r.user_email}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${actionColor(r.action)}`}>{r.action}</span>
                    </td>
                    <td className="px-4 py-2 text-ink-secondary text-xs">{r.entity_type}</td>
                    <td className="px-4 py-2 text-xs font-mono truncate max-w-[120px]"><DocLink type={r.entity_type} id={r.entity_id} label={r.entity_id} className="text-brand-600 hover:underline" /></td>
                    <td className="px-4 py-2">
                      {(r.old_values || r.new_values) && (
                        <button onClick={() => setExpanded(expanded === r.id ? null : r.id)} className="text-xs text-brand-600 hover:underline">
                          {expanded === r.id ? t('common.hide') : t('common.show')}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr>
                      <td colSpan={6} className="px-4 py-2 bg-surface-subtle">
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          {r.old_values && (
                            <div>
                              <p className="font-medium text-ink-secondary mb-1">{t('reports.old_values')}</p>
                              <pre className="rounded bg-red-50 p-2 text-red-800 overflow-auto max-h-40">{JSON.stringify(r.old_values, null, 2)}</pre>
                            </div>
                          )}
                          {r.new_values && (
                            <div>
                              <p className="font-medium text-ink-secondary mb-1">{t('reports.new_values')}</p>
                              <pre className="rounded bg-emerald-50 p-2 text-emerald-800 overflow-auto max-h-40">{JSON.stringify(r.new_values, null, 2)}</pre>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2 text-xs text-ink-tertiary">{t('reports.showing_n_rows', { n: rows.length })}</p>
        </div>
      )}
    </div>
  );
}
