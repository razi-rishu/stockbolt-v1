import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import type { InvariantResult } from '@/data/adapter';

export default function SystemHealthPage() {
  const { t } = useTranslation();
  const adapter = getAdapter();
  const company_id = useAuthStore(s => s.company_id);

  const today = new Date().toISOString().slice(0, 10);
  const [asOf, setAsOf]     = useState(today);
  const [results, setResults] = useState<InvariantResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [ran, setRan]         = useState(false);

  const run = async () => {
    if (!company_id) return;
    setLoading(true);
    try {
      const data = await adapter.systemHealth.check(company_id, asOf);
      setResults(data);
      setRan(true);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const allPass = results.length > 0 && results.every(r => r.pass);
  const failCount = results.filter(r => !r.pass).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink-primary">{t('settings.system_health')}</h1>
        <p className="mt-1 text-sm text-ink-secondary">{t('settings.system_health_desc')}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface-card p-4">
        <div>
          <label className="block text-xs text-ink-secondary mb-1">{t('reports.as_of_date')}</label>
          <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className="input-field h-9 text-sm" />
        </div>
        <button onClick={run} disabled={loading} className="btn-primary h-9 px-5 text-sm font-semibold">
          {loading ? t('settings.running_checks') : t('settings.run_health_check')}
        </button>
      </div>

      {ran && (
        <>
          {/* Summary banner */}
          <div className={`flex items-center gap-3 rounded-lg px-5 py-4 text-sm font-semibold ${allPass ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
            <span className="text-2xl">{allPass ? '✅' : '❌'}</span>
            <span>
              {allPass
                ? t('settings.all_invariants_pass')
                : t('settings.invariants_failed', { n: failCount })}
            </span>
          </div>

          {/* Invariant table */}
          <div className="overflow-x-auto rounded-lg border border-border bg-surface-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-surface-subtle">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('settings.invariant')}</th>
                  <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('settings.check')}</th>
                  <th className="px-4 py-2 text-center font-medium text-ink-secondary">{t('common.status')}</th>
                  <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('settings.difference')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {results.map(r => (
                  <tr key={r.invariant as string} className={r.pass ? '' : 'bg-red-50'}>
                    <td className="px-4 py-2 font-mono text-xs text-ink-secondary">{r.invariant as string}</td>
                    <td className="px-4 py-2 text-ink-primary">{r.name as string}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${r.pass ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        {r.pass ? t('common.pass') : t('common.fail')}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right text-ink-secondary text-xs">
                      {typeof r.difference === 'number' ? r.difference.toFixed(2) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!allPass && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <p className="font-semibold">{t('settings.health_fail_action')}</p>
              <p className="mt-1 text-red-700">{t('settings.health_fail_desc')}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
