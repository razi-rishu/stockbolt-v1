/**
 * Dashboard — owner 360 view.
 *
 * Layout (top-down):
 *  1. Welcome header with the owner's first name + today's full date
 *  2. 6 KPI tiles (Today Sales / Today Purchases / Inventory Value / SKU Count
 *     / Receivables / Payables) each with a period-over-period delta
 *  3. Two cards side-by-side: Sales Trend (Recharts smooth-line chart) and
 *     Recent Inventory (latest products added with current stock)
 *  4. Low Stock Alerts bar (red icon, dynamic state, link to reorder report)
 *  5. Floating Action Button (bottom-right) — opens a quick-action menu
 */
import { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import type { OwnerDashboard } from '@/data/adapter';

// ── Formatters ───────────────────────────────────────────────────────────────
function fmt(n: number, dp = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function fmtInt(n: number) {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** Period-over-period delta as a signed percentage. Null if prev is 0/missing. */
function deltaPct(current: number, prev: number): number | null {
  if (!prev || Math.abs(prev) < 0.005) return null;
  return ((current - prev) / Math.abs(prev)) * 100;
}

/** Format today as "Friday, April 25, 2026" — adjusts for the user's locale automatically. */
function fmtToday() {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

// ── Inline icons (Lucide-style, hand-rolled to avoid a dep) ─────────────────
function TrendingUpIcon()  { return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></svg>; }
function CartIcon()        { return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" /></svg>; }
function WalletIcon()      { return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></svg>; }
function StoreIcon()       { return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" /><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" /><path d="M2 7h20" /></svg>; }
function CoinIcon()        { return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 6v12" /><path d="M16 10a2 2 0 0 0-2-2h-3a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9.5" /></svg>; }
function HandCoinIcon()    { return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="16" cy="9" r="2.5" /><path d="M11.5 9h-7M3 13l2 2.5L7 14M14 22l-3-3 1.5-2 4.5 1c2.2.5 4-1.4 4-3.6l-1-5" /></svg>; }
function AlertTriangleIcon(){ return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>; }
function PlusIcon()        { return <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>; }
function ArrowUpRightIcon(){ return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7" /><path d="M7 7h10v10" /></svg>; }

// ── KPI tile ─────────────────────────────────────────────────────────────────
function KpiTile({
  label,
  value,
  sub,
  delta,
  icon,
  iconBg,
  iconColor,
  href,
}: {
  label: string;
  value: string;
  sub: string;
  delta: number | null;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  href?: string;
}) {
  const hasDelta = delta !== null;
  const positive = (delta ?? 0) >= 0;
  const inner = (
    <div className="rounded-2xl border border-border-subtle bg-surface-card p-5 hover:shadow-sm transition-shadow">
      <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-full ${iconBg} ${iconColor}`}>
        {icon}
      </div>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-tertiary">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink-primary">{value}</p>
      <div className="mt-2 flex items-center gap-2">
        <p className="flex-1 truncate text-xs text-ink-tertiary">{sub}</p>
        {hasDelta && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            positive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
          }`}>
            {positive ? '+' : ''}{delta!.toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  );
  return href ? <Link to={href} className="block">{inner}</Link> : inner;
}

// ── Floating Action Button with quick-action popover ────────────────────────
function FloatingActionButton() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const actions = [
    { label: 'New Invoice',         href: '/sales/invoices/new' },
    { label: 'New Quote',           href: '/sales/quotes/new' },
    { label: 'Receive Payment',     href: '/sales/payments/new' },
    { label: 'New Vendor Bill',     href: '/purchasing/bills/new' },
    { label: 'New Goods Receipt',   href: '/purchasing/grns/new' },
    { label: 'New Product',         href: '/products/new' },
  ];

  return (
    <div ref={containerRef} className="fixed bottom-6 end-6 z-40">
      {open && (
        <div className="mb-3 w-56 overflow-hidden rounded-card border border-border-subtle bg-surface-card shadow-xl">
          <p className="border-b border-border-subtle bg-surface-muted px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
            Quick actions
          </p>
          <ul className="py-1">
            {actions.map((a) => (
              <li key={a.href}>
                <button
                  type="button"
                  onClick={() => { setOpen(false); navigate(a.href); }}
                  className="flex w-full items-center justify-between px-4 py-2 text-start text-sm text-ink-primary hover:bg-surface-muted"
                >
                  <span>{a.label}</span>
                  <span className="text-ink-tertiary"><ArrowUpRightIcon /></span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Quick actions"
        className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg transition-all hover:bg-brand-700 hover:shadow-xl"
      >
        <PlusIcon />
      </button>
    </div>
  );
}

// ── Sales Trend chart ───────────────────────────────────────────────────────
function SalesTrendChart({ data }: { data: { date: string; sales: number; purchases: number }[] }) {
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const chartData = data.map((d) => ({
    ...d,
    label: dayLabels[new Date(d.date).getDay()],
  }));
  const hasData = data.some((d) => d.sales > 0 || d.purchases > 0);

  if (!hasData) {
    return <p className="py-10 text-center text-sm text-ink-tertiary">No transactions in the last 7 days.</p>;
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gradSales" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradPurchases" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} />
          <YAxis hide />
          <Tooltip
            contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
            formatter={(v, name) => [fmt(Number(v ?? 0)), name === 'sales' ? 'Sales' : 'Purchases']}
            labelFormatter={(l) => `Day: ${l}`}
          />
          <Area type="monotone" dataKey="sales"     stroke="#6366f1" strokeWidth={2.5} fill="url(#gradSales)" />
          <Area type="monotone" dataKey="purchases" stroke="#10b981" strokeWidth={2.5} fill="url(#gradPurchases)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { t } = useTranslation();
  const adapter = getAdapter();
  const company_id = useAuthStore(s => s.company_id);

  // User's first name for "Welcome, X" — best-effort; falls back to email prefix.
  const { data: profile } = useQuery({
    queryKey: ['profile_current'],
    queryFn: () => adapter.profiles.getCurrent(),
  });
  const email = useAuthStore(s => s.email);
  const fullName = profile?.full_name ?? '';
  const firstName = fullName.split(/\s+/)[0] || (email ? email.split('@')[0] : '');

  const [data, setData] = useState<OwnerDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!company_id) return;
    adapter.reports.getOwnerDashboard(company_id)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company_id]);

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
    </div>
  );

  if (!data) return (
    <div className="py-24 text-center text-ink-secondary">{t('common.no_data')}</div>
  );

  // Pre-compute deltas
  const dSales      = deltaPct(data.today_sales_amount,    data.today_sales_amount_prev);
  const dPurchases  = deltaPct(data.today_purchases_amount, data.today_purchases_amount_prev);
  const dInventory  = deltaPct(data.inventory_value,        data.inventory_value_prev);
  const dSku        = deltaPct(data.sku_count,              data.sku_count_prev);
  const dAR         = deltaPct(data.outstanding_ar,         data.outstanding_ar_prev);
  const dAP         = deltaPct(data.outstanding_ap,         data.outstanding_ap_prev);

  return (
    <div className="space-y-6 pb-24">
      {/* ── Welcome header ─────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold text-ink-primary">
          Welcome StockBolt{firstName ? `, ${firstName}` : ''}
        </h1>
        <p className="mt-1 text-sm font-medium text-ink-secondary">{fmtToday()}</p>
      </div>

      {/* ── 6 KPI tiles ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <KpiTile
          label="Today Sales"
          value={`AED ${fmt(data.today_sales_amount)}`}
          sub="Revenue (excl. VAT)"
          delta={dSales}
          icon={<TrendingUpIcon />}
          iconBg="bg-emerald-50"
          iconColor="text-emerald-600"
          href="/sales/invoices"
        />
        <KpiTile
          label="Today Purchases"
          value={`AED ${fmt(data.today_purchases_amount)}`}
          sub="Inventory Received"
          delta={dPurchases}
          icon={<CartIcon />}
          iconBg="bg-violet-50"
          iconColor="text-violet-600"
          href="/purchasing/bills"
        />
        <KpiTile
          label="Inventory Value"
          value={`AED ${fmt(data.inventory_value)}`}
          sub="Asset Value"
          delta={dInventory}
          icon={<WalletIcon />}
          iconBg="bg-slate-100"
          iconColor="text-slate-600"
          href="/reports/stock-valuation"
        />
        <KpiTile
          label="SKU Count"
          value={fmtInt(data.sku_count)}
          sub="Unique Parts"
          delta={dSku}
          icon={<StoreIcon />}
          iconBg="bg-violet-50"
          iconColor="text-violet-600"
          href="/products"
        />
        <KpiTile
          label="Receivables"
          value={`AED ${fmt(data.outstanding_ar)}`}
          sub="Outstanding"
          delta={dAR}
          icon={<CoinIcon />}
          iconBg="bg-orange-50"
          iconColor="text-orange-600"
          href="/reports/ar-aging"
        />
        <KpiTile
          label="Payables"
          value={`AED ${fmt(data.outstanding_ap)}`}
          sub="Outstanding"
          delta={dAP}
          icon={<HandCoinIcon />}
          iconBg="bg-violet-50"
          iconColor="text-violet-600"
          href="/reports/ap-aging"
        />
      </div>

      {/* ── Sales Trend + Recent Inventory side-by-side ───────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Sales Trend (2/3) */}
        <div className="rounded-2xl border border-border-subtle bg-surface-card p-5 lg:col-span-2">
          <div className="mb-2 flex items-start justify-between">
            <div>
              <h2 className="font-semibold text-ink-primary">Sales Trend</h2>
              <p className="mt-0.5 text-xs text-ink-tertiary">Last 7 Days</p>
            </div>
            <Link to="/reports/profit-loss" className="flex items-center gap-1 rounded-full bg-surface-muted px-3 py-1 text-xs font-medium text-ink-secondary hover:bg-surface-page">
              P&amp;L <ArrowUpRightIcon />
            </Link>
          </div>
          <SalesTrendChart data={data.trend_7d} />
        </div>

        {/* Recent Inventory (1/3) */}
        <div className="rounded-2xl border border-border-subtle bg-surface-card p-5">
          <div className="mb-3 flex items-start justify-between">
            <div>
              <h2 className="font-semibold text-ink-primary">Recent Inventory</h2>
              <p className="mt-0.5 text-xs text-ink-tertiary">Latest Items Added</p>
            </div>
            <Link to="/products" className="flex items-center gap-1 rounded-full bg-surface-muted px-3 py-1 text-xs font-medium text-ink-secondary hover:bg-surface-page">
              Stock <ArrowUpRightIcon />
            </Link>
          </div>
          {data.recent_inventory.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-tertiary">No items yet.</p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {data.recent_inventory.map((it) => (
                <li key={it.product_id} className="flex items-center justify-between py-2.5">
                  <Link to={`/products/${it.product_id}`} className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-primary">{it.name}</p>
                    {it.oe_number && (
                      <p className="mt-0.5 text-xs text-ink-tertiary">OE: {it.oe_number}</p>
                    )}
                  </Link>
                  <span className="ms-3 shrink-0 text-sm font-semibold text-ink-primary">
                    {fmtInt(it.quantity)} {it.unit_code}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── Low Stock Alerts bar ───────────────────────────────────────── */}
      <div className="rounded-2xl border border-border-subtle bg-surface-card p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-500">
            <AlertTriangleIcon />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-ink-primary">Low Stock Alerts</h3>
            <p className="mt-0.5 text-sm text-ink-secondary">
              {data.low_stock_count === 0
                ? 'Excellent! All items are well stocked.'
                : `${data.low_stock_count} item${data.low_stock_count === 1 ? '' : 's'} below the minimum stock level.`}
            </p>
          </div>
          <Link
            to="/reports/reorder"
            className="rounded-full bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Manage Stock
          </Link>
        </div>
      </div>

      {/* ── Floating quick-action button ───────────────────────────────── */}
      <FloatingActionButton />
    </div>
  );
}
