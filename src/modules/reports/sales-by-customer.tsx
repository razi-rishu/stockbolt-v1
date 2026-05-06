import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import type { SalesByCustomerLine } from '@/data/adapter';

function fmt(n: number) { return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }

export default function SalesByCustomerPage() {
  const { t } = useTranslation();
  const adapter = getAdapter();
  const company_id = useAuthStore(s => s.company_id);

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + '-01';

  const [from, setFrom]     = useState(monthStart);
  const [to, setTo]         = useState(today);
  const [rows, setRows]     = useState<SalesByCustomerLine[]>([]);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!company_id) return;
    setLoading(true);
    try { setRows(await adapter.reports.getSalesByCustomer(company_id, from, to)); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const totNet = rows.reduce((s, r) => s + r.net_sales, 0);
  const totGP  = rows.reduce((s, r) => s + r.gross_profit, 0);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-ink-primary">{t('reports.sales_by_customer')}</h1>

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
                <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('contacts.customer')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.invoice_count')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.gross_sales')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.returns')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.net_sales')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.gross_profit')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.gp_pct')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(r => (
                <tr key={r.contact_id} className="hover:bg-surface-subtle/50">
                  <td className="px-4 py-2 text-ink-primary font-medium">{r.contact_name}</td>
                  <td className="px-4 py-2 text-right text-ink-secondary">{r.invoice_count}</td>
                  <td className="px-4 py-2 text-right text-ink-secondary">{fmt(r.gross_sales)}</td>
                  <td className="px-4 py-2 text-right text-red-600">{r.returns > 0 ? `(${fmt(r.returns)})` : '—'}</td>
                  <td className="px-4 py-2 text-right text-ink-primary font-medium">{fmt(r.net_sales)}</td>
                  <td className="px-4 py-2 text-right text-emerald-700 font-medium">{fmt(r.gross_profit)}</td>
                  <td className="px-4 py-2 text-right text-ink-secondary">{r.gp_pct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-border bg-surface-subtle font-semibold">
              <tr>
                <td colSpan={4} className="px-4 py-2 text-ink-primary">{t('common.total')}</td>
                <td className="px-4 py-2 text-right text-ink-primary">{fmt(totNet)}</td>
                <td className="px-4 py-2 text-right text-emerald-700">{fmt(totGP)}</td>
                <td className="px-4 py-2 text-right text-ink-secondary">{totNet > 0 ? (totGP / totNet * 100).toFixed(1) : 0}%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
