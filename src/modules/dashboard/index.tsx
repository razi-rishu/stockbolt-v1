import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import type { OwnerDashboard } from '@/data/adapter';

function KPICard({ label, value, sub, href }: { label: string; value: string; sub?: string; href?: string }) {
  const inner = (
    <div className="rounded-lg border border-border bg-surface-card p-5 shadow-sm">
      <p className="text-sm text-ink-secondary">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink-primary">{value}</p>
      {sub && <p className="mt-1 text-xs text-ink-tertiary">{sub}</p>}
    </div>
  );
  return href ? <Link to={href} className="block hover:opacity-90 transition-opacity">{inner}</Link> : inner;
}

function fmt(n: number) {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const adapter = getAdapter();
  const company_id = useAuthStore(s => s.company_id);
  const [data, setData]    = useState<OwnerDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!company_id) return;
    adapter.reports.getOwnerDashboard(company_id)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [company_id]);

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
    </div>
  );

  if (!data) return (
    <div className="py-24 text-center text-ink-secondary">{t('common.no_data')}</div>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-ink-primary">{t('dashboard.title')}</h1>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KPICard
          label={t('dashboard.today_sales')}
          value={fmt(data.today_sales_amount)}
          sub={`${data.today_sales_count} ${t('dashboard.invoices')}`}
          href="/sales/invoices"
        />
        <KPICard
          label={t('dashboard.outstanding_ar')}
          value={fmt(data.outstanding_ar)}
          href="/reports/ar-aging"
        />
        <KPICard
          label={t('dashboard.outstanding_ap')}
          value={fmt(data.outstanding_ap)}
          href="/reports/ap-aging"
        />
        <KPICard
          label={t('dashboard.cash_and_bank')}
          value={fmt(data.cash_and_bank)}
        />
      </div>

      {/* Middle row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Top 5 products */}
        <div className="col-span-1 md:col-span-2 rounded-lg border border-border bg-surface-card p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-medium text-ink-primary">{t('dashboard.top_products')}</h2>
            <Link to="/reports/sales-by-product" className="text-xs text-brand-600 hover:underline">{t('common.view_all')}</Link>
          </div>
          {data.top_products.length === 0 ? (
            <p className="text-sm text-ink-tertiary">{t('common.no_data')}</p>
          ) : (
            <div className="space-y-2">
              {data.top_products.map(p => (
                <div key={p.product_id} className="flex items-center justify-between text-sm">
                  <span className="text-ink-primary truncate max-w-[60%]">{p.name}</span>
                  <span className="text-ink-secondary font-medium">{fmt(p.revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Alerts */}
        <div className="col-span-1 md:col-span-2 rounded-lg border border-border bg-surface-card p-5 shadow-sm">
          <h2 className="mb-3 font-medium text-ink-primary">{t('dashboard.alerts')}</h2>
          <div className="space-y-3">
            <Link to="/reports/reorder" className="flex items-center justify-between rounded-md bg-amber-50 px-3 py-2 hover:bg-amber-100">
              <span className="text-sm text-amber-800">{t('dashboard.low_stock_alert')}</span>
              <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-900">{data.low_stock_count}</span>
            </Link>
            <Link to="/reports/ar-aging" className="flex items-center justify-between rounded-md bg-red-50 px-3 py-2 hover:bg-red-100">
              <span className="text-sm text-red-800">{t('dashboard.overdue_invoices')}</span>
              <span className="rounded-full bg-red-200 px-2 py-0.5 text-xs font-semibold text-red-900">{data.overdue_invoices_count}</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Sales trend chart (bar chart via CSS) */}
      <div className="rounded-lg border border-border bg-surface-card p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium text-ink-primary">{t('dashboard.sales_trend')}</h2>
          <Link to="/reports/sales-trend" className="text-xs text-brand-600 hover:underline">{t('common.view_all')}</Link>
        </div>
        {data.sales_trend.length === 0 ? (
          <p className="text-sm text-ink-tertiary">{t('common.no_data')}</p>
        ) : (
          <div className="flex h-28 items-end gap-0.5 overflow-x-auto">
            {(() => {
              const maxAmt = Math.max(...data.sales_trend.map(d => d.amount), 1);
              return data.sales_trend.map(d => (
                <div
                  key={d.date}
                  className="group relative flex-1 min-w-[6px] bg-brand-400 rounded-t hover:bg-brand-500 transition-colors cursor-pointer"
                  style={{ height: `${Math.max(4, (d.amount / maxAmt) * 100)}%` }}
                  title={`${d.date}: ${fmt(d.amount)}`}
                />
              ));
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
