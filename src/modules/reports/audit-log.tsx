import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import type { AuditLogLine } from '@/data/adapter';

export default function AuditLogPage() {
  const { t } = useTranslation();
  const adapter = getAdapter();
  const company_id = useAuthStore(s => s.company_id);

  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom]   = useState(today.slice(0, 7) + '-01');
  const [to, setTo]       = useState(today);
  const [rows, setRows]   = useState<AuditLogLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const run = async () => {
    if (!company_id) return;
    setLoading(true);
    try { setRows(await adapter.reports.getAuditLog(company_id, { from, to, limit: 500 })); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const actionColor = (action: string) => {
    if (action.includes('create') || action.includes('insert')) return 'bg-emerald-100 text-emerald-800';
    if (action.includes('update')) return 'bg-blue-100 text-blue-800';
    if (action.includes('delete') || action.includes('void')) return 'bg-red-100 text-red-800';
    return 'bg-surface-subtle text-ink-secondary';
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-ink-primary">{t('reports.audit_log')}</h1>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface-card p-4">
        <div>
          <label className="block text-xs text-ink-secondary mb-1">{t('common.date_from')}</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input-field h-9 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-ink-secondary mb-1">{t('common.date_to')}</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="input-field h-9 text-sm" />
        </div>
        <button onClick={run} disabled={loading} className="btn-primary h-9 px-4 text-sm">
          {loading ? t('common.loading') : t('common.run')}
        </button>
      </div>

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
                <>
                  <tr key={r.id} className="hover:bg-surface-subtle/50">
                    <td className="px-4 py-2 text-ink-secondary text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="px-4 py-2 text-ink-secondary text-xs truncate max-w-[160px]">{r.user_email}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${actionColor(r.action)}`}>{r.action}</span>
                    </td>
                    <td className="px-4 py-2 text-ink-secondary text-xs">{r.entity_type}</td>
                    <td className="px-4 py-2 text-ink-secondary text-xs font-mono truncate max-w-[120px]">{r.entity_id}</td>
                    <td className="px-4 py-2">
                      {(r.old_values || r.new_values) && (
                        <button onClick={() => setExpanded(expanded === r.id ? null : r.id)} className="text-xs text-brand-600 hover:underline">
                          {expanded === r.id ? t('common.hide') : t('common.show')}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr key={r.id + '-detail'}>
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
                </>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2 text-xs text-ink-tertiary">{t('reports.showing_n_rows', { n: rows.length })}</p>
        </div>
      )}
    </div>
  );
}
