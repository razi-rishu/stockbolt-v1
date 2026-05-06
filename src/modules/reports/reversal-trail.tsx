import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import type { ReversalTrailLine } from '@/data/adapter';

function fmt(n: number) { return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }

export default function ReversalTrailPage() {
  const { t } = useTranslation();
  const adapter = getAdapter();
  const company_id = useAuthStore(s => s.company_id);

  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom]   = useState(today.slice(0, 4) + '-01-01');
  const [to, setTo]       = useState(today);
  const [rows, setRows]   = useState<ReversalTrailLine[]>([]);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!company_id) return;
    setLoading(true);
    try { setRows(await adapter.reports.getReversalTrail(company_id, from, to)); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-ink-primary">{t('reports.reversal_trail')}</h1>

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
