import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDataAdapter } from '@/hooks/use-data-adapter';
import { useAuthStore } from '@/stores/authStore';
import type { SalesByVehicleLine } from '@/data/adapter';

function fmt(n: number) { return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }

export default function SalesByVehiclePage() {
  const { t } = useTranslation();
  const adapter = useDataAdapter();
  const company = useAuthStore(s => s.company);

  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom]     = useState(today.slice(0, 7) + '-01');
  const [to, setTo]         = useState(today);
  const [rows, setRows]     = useState<SalesByVehicleLine[]>([]);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!company?.id) return;
    setLoading(true);
    try { setRows(await adapter.reports.getSalesByVehicle(company.id, from, to)); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-ink-primary">{t('reports.sales_by_vehicle')}</h1>
      <p className="text-xs text-ink-tertiary">{t('reports.sales_by_vehicle_note')}</p>

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
                <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('products.vehicle_make')}</th>
                <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('products.vehicle_model')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.qty_sold')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.revenue')}</th>
                <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('reports.gross_profit')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-surface-subtle/50">
                  <td className="px-4 py-2 text-ink-primary font-medium">{r.make_name}</td>
                  <td className="px-4 py-2 text-ink-secondary">{r.model_name ?? t('common.all')}</td>
                  <td className="px-4 py-2 text-right text-ink-secondary">{r.qty}</td>
                  <td className="px-4 py-2 text-right text-ink-primary font-medium">{fmt(r.revenue)}</td>
                  <td className="px-4 py-2 text-right text-emerald-700 font-medium">{fmt(r.gross_profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
