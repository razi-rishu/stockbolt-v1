import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { DocLink } from '@/ui/doc-link';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { OceanPage } from '@/components/ocean-list';

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
    if (action.includes('create') || action.includes('insert')) return 'sb-pill-good';
    if (action.includes('update')) return '';
    if (action.includes('delete') || action.includes('void')) return 'sb-pill-bad';
    return 'sb-pill-muted';
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
    // Ocean Teal (UI v1.1): look only — same period filter, export / print,
    // rows, drill-down links and change diff.
    <OceanPage
      testid="audit-log-ocean"
      title={t('reports.audit_log')}
      subtitle={t('settingsNav.items.audit_log.desc')}
      actions={
        <div data-print-hide className="sb-audit-tools">
          <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
          <ReportActions rows={exportRows} headers={exportHeaders} filename={`audit-log-${from}_${to}`} disabled={rows.length === 0} />
        </div>
      }
    >
      {isFetching && rows.length === 0 && <div className="sb-card sb-empty">{t('common.loading')}</div>}
      {!isFetching && rows.length === 0 && <div className="sb-card sb-empty">{t('reports.no_data')}</div>}

      {rows.length > 0 && (
        <div className="sb-card sb-dtable-wrap">
          <table className="sb-dtable">
            <thead>
              <tr>
                <th>{t('reports.timestamp')}</th>
                <th>{t('reports.user')}</th>
                <th>{t('reports.action')}</th>
                <th>{t('reports.entity')}</th>
                <th>{t('reports.entity_id')}</th>
                <th>{t('reports.changes')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <Fragment key={r.id}>
                  <tr>
                    <td style={{ whiteSpace: 'nowrap' }}><bdi dir="ltr">{new Date(r.created_at).toLocaleString()}</bdi></td>
                    <td className="truncate max-w-[180px]"><bdi dir="ltr">{r.user_email}</bdi></td>
                    <td>
                      <span className={`sb-pill ${actionColor(r.action)}`} style={{ marginTop: 0 }}><bdi dir="ltr">{r.action}</bdi></span>
                    </td>
                    <td><bdi dir="ltr">{r.entity_type}</bdi></td>
                    <td className="sb-mono truncate max-w-[140px]"><DocLink type={r.entity_type} id={r.entity_id} label={r.entity_id} className="text-brand-600 hover:underline" /></td>
                    <td>
                      {(r.old_values || r.new_values) && (
                        <button type="button" onClick={() => setExpanded(expanded === r.id ? null : r.id)} className="sb-row-link text-brand-600">
                          {expanded === r.id ? t('common.hide') : t('common.show')}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr>
                      <td colSpan={6} className="sb-audit-diff">
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
          <p className="sb-form-hint" style={{ padding: '10px 16px', margin: 0 }}>{t('reports.showing_n_rows', { n: rows.length })}</p>
        </div>
      )}
    </OceanPage>
  );
}
