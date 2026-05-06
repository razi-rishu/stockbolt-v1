import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import type { OutstandingPOLine } from '@/data/adapter';

function fmt(n: number) { return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }

export default function OutstandingPOsPage() {
  const { t } = useTranslation();
  const adapter = getAdapter();
  const company_id = useAuthStore(s => s.company_id);
  const [rows, setRows]     = useState<OutstandingPOLine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!company_id) return;
    adapter.reports.getOutstandingPOs(company_id).then(setRows).catch(console.error).finally(() => setLoading(false));
  }, [company_id]);

  const totPending = rows.reduce((s, r) => s + r.pending_value, 0);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-ink-primary">{t('reports.outstanding_pos')}</h1>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
        </div>
      ) : rows.length === 0 ? (
        <div className="py-20 text-center text-ink-secondary">{t('common.no_data')}</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-surface-subtle">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('purchasing.po_number')}</th>
                <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('contacts.supplier')}</th>
                <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('common.date')}</th>
                <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('purchasing.expected_delivery')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('common.total')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.received')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.pending')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(r => (
                <tr key={r.po_id} className="hover:bg-surface-subtle/50">
                  <td className="px-4 py-2">
                    <Link to={`/purchasing/orders/${r.po_id}`} className="font-medium text-brand-600 hover:underline">{r.po_number}</Link>
                  </td>
                  <td className="px-4 py-2 text-ink-primary">{r.supplier_name}</td>
                  <td className="px-4 py-2 text-ink-secondary">{r.date}</td>
                  <td className="px-4 py-2 text-ink-secondary">{r.expected_delivery ?? '—'}</td>
                  <td className="px-4 py-2 text-right text-ink-secondary">{fmt(r.total)}</td>
                  <td className="px-4 py-2 text-right text-emerald-700">{fmt(r.received_value)}</td>
                  <td className="px-4 py-2 text-right text-amber-700 font-medium">{fmt(r.pending_value)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-border bg-surface-subtle font-semibold">
              <tr>
                <td colSpan={6} className="px-4 py-2 text-ink-primary">{t('reports.total_pending')}</td>
                <td className="px-4 py-2 text-right text-amber-700">{fmt(totPending)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
