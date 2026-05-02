import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayIso() { return new Date().toISOString().slice(0, 10); }

export default function StockValuationPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const [asOf, setAsOf] = useState(todayIso);
  const [trigger, setTrigger] = useState(0);

  const { data: sv, isLoading, error } = useQuery({
    queryKey: ['stock_valuation', company_id, asOf, trigger],
    queryFn: () => getAdapter().reports.getStockValuation(company_id!, asOf),
    enabled: !!company_id && trigger > 0,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-ink-primary">{t('reports.stock_valuation_title')}</h1>

      <div className="flex items-center gap-3 rounded-card border border-border-subtle bg-surface-card px-5 py-3">
        <Input type="date" label={t('reports.as_of_date')} value={asOf} onChange={e => setAsOf(e.target.value)} />
        <div className="mt-5">
          <Button size="sm" onClick={() => setTrigger(n => n + 1)}>{t('reports.run')}</Button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-ink-secondary">{t('common.loading')}</p>}
      {error && <p className="text-sm text-red-600">{String(error)}</p>}

      {sv && sv.lines.length === 0 && (
        <p className="text-sm text-ink-tertiary">{t('reports.no_stock')}</p>
      )}

      {sv && sv.lines.length > 0 && (
        <div className="rounded-card border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-5 py-3 text-sm text-ink-secondary">
            {t('reports.as_of_date')}: {asOf}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                <th className="px-4 py-2.5 text-start font-medium">{t('products.code')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('products.name')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('reports.warehouse')}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t('reports.qty')}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t('reports.unit_cost')}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t('reports.total_value')}</th>
              </tr>
            </thead>
            <tbody>
              {sv.lines.map((l, i) => (
                <tr key={i} className="border-b border-border-subtle last:border-0">
                  <td className="px-4 py-2.5 font-mono text-xs text-ink-primary">{l.product_code}</td>
                  <td className="px-4 py-2.5 text-ink-primary">{l.product_name}</td>
                  <td className="px-4 py-2.5 text-ink-secondary">{l.warehouse_name}</td>
                  <td className="px-4 py-2.5 text-end font-mono text-ink-primary">{l.quantity.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-end font-mono text-ink-primary">{fmt(l.unit_cost)}</td>
                  <td className="px-4 py-2.5 text-end font-mono font-semibold text-ink-primary">{fmt(l.total_value)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-border-subtle bg-surface-muted font-bold">
                <td colSpan={5} className="px-4 py-2.5 text-ink-primary">{t('reports.total_stock_value')}</td>
                <td className="px-4 py-2.5 text-end font-mono text-ink-primary">{fmt(sv.total_value)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
