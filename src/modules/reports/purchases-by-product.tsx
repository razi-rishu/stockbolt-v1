import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDataAdapter } from '@/hooks/use-data-adapter';
import { useAuthStore } from '@/stores/authStore';
import type { PurchasesByProductLine } from '@/data/adapter';

function fmt(n: number) { return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }

export default function PurchasesByProductPage() {
  const { t } = useTranslation();
  const adapter = useDataAdapter();
  const company = useAuthStore(s => s.company);

  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom]     = useState(today.slice(0, 7) + '-01');
  const [to, setTo]         = useState(today);
  const [rows, setRows]     = useState<PurchasesByProductLine[]>([]);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!company?.id) return;
    setLoading(true);
    try { setRows(await adapter.reports.getPurchasesByProduct(company.id, from, to)); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-ink-primary">{t('reports.purchases_by_product')}</h1>

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
                <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('products.sku')}</th>
                <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('products.name')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.qty_purchased')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.total_cost')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.avg_unit_cost')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(r => (
                <tr key={r.product_id} className="hover:bg-surface-subtle/50">
                  <td className="px-4 py-2 text-ink-secondary font-mono text-xs">{r.sku}</td>
                  <td className="px-4 py-2 text-ink-primary font-medium">{r.product_name}</td>
                  <td className="px-4 py-2 text-right text-ink-secondary">{r.qty_purchased}</td>
                  <td className="px-4 py-2 text-right text-ink-primary font-medium">{fmt(r.total_cost)}</td>
                  <td className="px-4 py-2 text-right text-ink-secondary">{fmt(r.avg_unit_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
