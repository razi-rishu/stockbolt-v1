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
 *
 * Restyled in Phase 12.31 to match the inventory-wizard sample look:
 *  - cards: 1px slate-200 border, 12px radius, soft shadow
 *  - KPI tiles: gradient icon chips, uppercase slate-500 labels, big slate-900
 *    values, indigo/red delta pills with arrow glyphs
 *  - Sales Trend / Recent Inventory / Low Stock rendered in shared <Panel>
 *  - "Manage Stock" + FAB use the indigo→violet gradient
 */
import { useEffect, useState, useRef, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { useCompanyCurrency } from '@/hooks/use-company-currency';
import { formatCurrency } from '@/lib/locale';
import type { OwnerDashboard } from '@/data/adapter';
import { Panel } from '@/ui/primitives';
import DashboardSummaryCards from './_summary-cards';
import { theme } from '@/ui/theme';

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

/** Time-aware greeting for the hero band. */
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

// ── Inline icons (Lucide-style, hand-rolled to avoid a dep) ─────────────────
function TrendingUpIcon()  { return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></svg>; }
function CartIcon()        { return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" /></svg>; }
function WalletIcon()      { return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></svg>; }
function StoreIcon()       { return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" /><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" /><path d="M2 7h20" /></svg>; }
function CoinIcon()        { return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 6v12" /><path d="M16 10a2 2 0 0 0-2-2h-3a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9.5" /></svg>; }
function HandCoinIcon()    { return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="16" cy="9" r="2.5" /><path d="M11.5 9h-7M3 13l2 2.5L7 14M14 22l-3-3 1.5-2 4.5 1c2.2.5 4-1.4 4-3.6l-1-5" /></svg>; }
function AlertTriangleIcon(){ return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>; }
function PlusIcon()        { return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>; }
function ArrowUpRightIcon(){ return <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7" /><path d="M7 7h10v10" /></svg>; }
function ArrowUpIcon()     { return <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>; }
function ArrowDownIcon()   { return <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg>; }

// ── Card primitive (light slate-200 border, soft shadow) ────────────────────
const cardStyle: CSSProperties = {
  background: theme.card,
  border: `1px solid ${theme.border}`,
  borderRadius: theme.radiusLg,
  boxShadow: theme.shadowSm,
};

// ── KPI tile ─────────────────────────────────────────────────────────────────
type Tone = 'emerald' | 'violet' | 'slate' | 'orange' | 'sky';

const tonePalette: Record<Tone, { bg: string; fg: string }> = {
  emerald: { bg: 'linear-gradient(135deg, #ecfdf5, #d1fae5)', fg: '#059669' },
  violet:  { bg: 'linear-gradient(135deg, #f5f3ff, #ede9fe)', fg: '#7c3aed' },
  slate:   { bg: 'linear-gradient(135deg, #f8fafc, #f1f5f9)', fg: '#475569' },
  orange:  { bg: 'linear-gradient(135deg, #fff7ed, #ffedd5)', fg: '#ea580c' },
  sky:     { bg: 'linear-gradient(135deg, #eff6ff, #dbeafe)', fg: '#2563eb' },
};

function KpiTile({
  label, value, sub, delta, icon, tone, href,
}: {
  label: string;
  value: string;
  sub: string;
  delta: number | null;
  icon: React.ReactNode;
  tone: Tone;
  href?: string;
}) {
  const hasDelta = delta !== null;
  const positive = (delta ?? 0) >= 0;
  const pal = tonePalette[tone];
  const inner = (
    <div
      style={{ ...cardStyle, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = theme.shadowMd; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = theme.shadowSm; }}
    >
      <div style={{
        height: '42px', width: '42px', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '12px', background: pal.bg, color: pal.fg,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '10px', fontWeight: 700, color: theme.inkMuted,
          textTransform: 'uppercase', letterSpacing: '.06em',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{label}</div>
        <div style={{ marginTop: '2px', fontSize: '19px', fontWeight: 700, color: theme.ink, letterSpacing: '-.01em', whiteSpace: 'nowrap' }}>{value}</div>
        <div style={{ marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ flex: 1, fontSize: '11px', color: theme.inkFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>
          {hasDelta && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '3px',
              flexShrink: 0,
              padding: '1px 6px', borderRadius: '999px',
              fontSize: '10px', fontWeight: 700,
              background: positive ? '#ecfdf5' : '#fef2f2',
              color: positive ? '#059669' : '#dc2626',
              border: `1px solid ${positive ? '#a7f3d0' : '#fecaca'}`,
            }}>
              {positive ? <ArrowUpIcon /> : <ArrowDownIcon />}
              {Math.abs(delta!).toFixed(0)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
  return href ? <Link to={href} style={{ textDecoration: 'none', color: 'inherit' }}>{inner}</Link> : inner;
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
    <div ref={containerRef} style={{ position: 'fixed', bottom: '24px', insetInlineEnd: '24px', zIndex: 40 }}>
      {open && (
        <div style={{
          marginBottom: '12px',
          width: '224px',
          background: theme.card,
          border: `1px solid ${theme.border}`,
          borderRadius: theme.radiusLg,
          boxShadow: theme.shadowLg,
          overflow: 'hidden',
        }}>
          <div style={{
            background: theme.panelHead,
            borderBottom: `1px solid ${theme.border}`,
            padding: '8px 16px',
            fontSize: theme.fontXs, fontWeight: 700, color: theme.inkMuted,
            textTransform: 'uppercase', letterSpacing: '.06em',
          }}>Quick actions</div>
          <ul style={{ listStyle: 'none', margin: 0, padding: '4px 0' }}>
            {actions.map((a) => (
              <li key={a.href}>
                <button
                  type="button"
                  onClick={() => { setOpen(false); navigate(a.href); }}
                  style={{
                    display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 16px', background: 'transparent', border: 'none',
                    fontSize: theme.fontBase, color: theme.ink, cursor: 'pointer',
                    textAlign: 'start',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.muted; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <span>{a.label}</span>
                  <span style={{ color: theme.inkFaint }}><ArrowUpRightIcon /></span>
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
        style={{
          height: '56px', width: '56px', border: 'none',
          borderRadius: '999px',
          background: theme.brandGradient,
          color: '#fff', cursor: 'pointer',
          boxShadow: '0 10px 25px rgba(124,58,237,.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'transform .15s, box-shadow .15s',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.boxShadow = '0 12px 30px rgba(124,58,237,.45)';
          (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.boxShadow = '0 10px 25px rgba(124,58,237,.35)';
          (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
        }}
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
    return <p style={{ padding: '40px 0', textAlign: 'center', fontSize: theme.fontBase, color: theme.inkFaint }}>No transactions in the last 7 days.</p>;
  }

  return (
    <div style={{ width: '100%' }}>
      <ResponsiveContainer width="100%" height={256} minWidth={0}>
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gradSales" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#7c3aed" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradPurchases" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.border} vertical={false} />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: theme.inkMuted }} />
          <YAxis hide />
          <Tooltip
            contentStyle={{ borderRadius: 8, border: `1px solid ${theme.border}`, fontSize: 12 }}
            formatter={(v, name) => [fmt(Number(v ?? 0)), name === 'sales' ? 'Sales' : 'Purchases']}
            labelFormatter={(l) => `Day: ${l}`}
          />
          <Area type="monotone" dataKey="sales"     stroke="#7c3aed" strokeWidth={2.5} fill="url(#gradSales)" />
          <Area type="monotone" dataKey="purchases" stroke="#10b981" strokeWidth={2.5} fill="url(#gradPurchases)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Small "see more" link chip in panel headers ─────────────────────────────
function LinkChip({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        padding: '4px 10px',
        background: theme.muted,
        color: theme.inkMuted,
        borderRadius: '999px',
        fontSize: theme.fontXs, fontWeight: 600,
        textDecoration: 'none',
      }}
    >
      {children} <ArrowUpRightIcon />
    </Link>
  );
}

// ── Main component ──────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { t } = useTranslation();
  const adapter = getAdapter();
  const company_id = useAuthStore(s => s.company_id);
  const currency = useCompanyCurrency();   // Issue 1 — localize all money to the tenant's currency

  // Greet with the company name (e.g. "Good afternoon, Al Noor") — reads
  // better than an email prefix and matches what the operator thinks of
  // as "their" StockBolt.
  const { data: company } = useQuery({
    queryKey: ['company', company_id],
    queryFn: () => adapter.companies.getById(company_id!),
    enabled: !!company_id,
  });
  const greetName = company?.name ?? '';

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
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '96px 0' }}>
      <div style={{
        height: '24px', width: '24px',
        borderRadius: '999px',
        border: `2px solid ${theme.brand}`,
        borderTopColor: 'transparent',
        animation: 'spin 1s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (!data) return (
    <div style={{ padding: '96px 0', textAlign: 'center', color: theme.inkMuted }}>{t('common.no_data')}</div>
  );

  // Pre-compute deltas
  const dSales      = deltaPct(data.today_sales_amount,    data.today_sales_amount_prev);
  const dPurchases  = deltaPct(data.today_purchases_amount, data.today_purchases_amount_prev);
  const dInventory  = deltaPct(data.inventory_value,        data.inventory_value_prev);
  const dSku        = deltaPct(data.sku_count,              data.sku_count_prev);
  const dAR         = deltaPct(data.outstanding_ar,         data.outstanding_ar_prev);
  const dAP         = deltaPct(data.outstanding_ap,         data.outstanding_ap_prev);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '96px' }}>
      {/* ── Hero band — greeting + quick actions ───────────────────────── */}
      <div style={{
        background: 'linear-gradient(135deg, #2e1065 0%, #5b21b6 55%, #7c3aed 100%)',
        borderRadius: '16px',
        padding: '26px 28px',
        color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '16px', flexWrap: 'wrap',
        boxShadow: '0 8px 24px rgba(124,58,237,.22)',
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, letterSpacing: '-.02em' }}>
            {greeting()}{greetName ? `, ${greetName}` : ''}
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'rgba(255,255,255,.75)', fontWeight: 500 }}>
            {fmtToday()}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <Link to="/sales/invoices/new" style={{
            padding: '9px 18px', borderRadius: '999px',
            background: '#fff', color: '#5b21b6',
            fontSize: '13px', fontWeight: 700, textDecoration: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,.15)',
            whiteSpace: 'nowrap',
          }}>+ New Invoice</Link>
          <Link to="/sales/payments/new" style={{
            padding: '9px 18px', borderRadius: '999px',
            background: 'rgba(255,255,255,.12)', color: '#fff',
            border: '1px solid rgba(255,255,255,.3)',
            fontSize: '13px', fontWeight: 600, textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}>Receive Payment</Link>
          <Link to="/purchasing/bills/new" style={{
            padding: '9px 18px', borderRadius: '999px',
            background: 'rgba(255,255,255,.12)', color: '#fff',
            border: '1px solid rgba(255,255,255,.3)',
            fontSize: '13px', fontWeight: 600, textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}>New Bill</Link>
        </div>
      </div>

      {/* ── 6 KPI tiles (3×2 on desktop, horizontal compact layout) ────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
        gap: '14px',
      }}>
        <KpiTile label="Today Sales"      value={formatCurrency(data.today_sales_amount, currency)}      sub="Revenue (excl. VAT)" delta={dSales}     icon={<TrendingUpIcon />} tone="emerald" href="/sales/invoices" />
        <KpiTile label="Today Purchases"  value={formatCurrency(data.today_purchases_amount, currency)}  sub="Inventory Received"  delta={dPurchases} icon={<CartIcon />}       tone="violet"  href="/purchasing/bills" />
        <KpiTile label="Inventory Value"  value={formatCurrency(data.inventory_value, currency)}         sub="Asset Value"         delta={dInventory} icon={<WalletIcon />}     tone="slate"   href="/reports/stock-valuation" />
        <KpiTile label="SKU Count"        value={fmtInt(data.sku_count)}                     sub="Unique Parts"        delta={dSku}       icon={<StoreIcon />}      tone="sky"     href="/products" />
        <KpiTile label="Receivables"      value={formatCurrency(data.outstanding_ar, currency)}          sub="Outstanding"         delta={dAR}        icon={<CoinIcon />}       tone="orange"  href="/reports/ar-aging" />
        <KpiTile label="Payables"         value={formatCurrency(data.outstanding_ap, currency)}          sub="Outstanding"         delta={dAP}        icon={<HandCoinIcon />}   tone="violet"  href="/reports/ap-aging" />
      </div>

      {/* ── Sales Trend + Recent Inventory — stack below lg ───────────── */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        {/* Sales Trend (2/3) */}
        <Panel
          icon="📈"
          title="Sales Trend — last 7 days"
          right={<LinkChip to="/reports/profit-loss">P&amp;L</LinkChip>}
        >
          <SalesTrendChart data={data.trend_7d} />
        </Panel>

        {/* Recent Inventory (1/3) */}
        <Panel
          icon="📦"
          title="Recent Inventory"
          right={<LinkChip to="/products">Stock</LinkChip>}
        >
          {data.recent_inventory.length === 0 ? (
            <p style={{ padding: '24px 0', textAlign: 'center', fontSize: theme.fontBase, color: theme.inkFaint }}>No items yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {data.recent_inventory.map((it, idx) => (
                <li
                  key={it.product_id}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 0',
                    borderTop: idx === 0 ? 'none' : `1px solid ${theme.border}`,
                  }}
                >
                  <Link
                    to={`/products/${it.product_id}`}
                    style={{ flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}
                  >
                    <div style={{
                      fontSize: theme.fontBase, fontWeight: 500, color: theme.ink,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{it.name}</div>
                    {it.oe_number && (
                      <div style={{ marginTop: '2px', fontSize: theme.fontXs, color: theme.inkFaint }}>OE: {it.oe_number}</div>
                    )}
                  </Link>
                  <span style={{
                    marginInlineStart: '12px', flexShrink: 0,
                    fontSize: theme.fontBase, fontWeight: 600, color: theme.ink,
                  }}>
                    {fmtInt(it.quantity)} {it.unit_code}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* ── Phase 13.03 — Summary cards row (Income/Expense, Top Expenses,
            Bank balances, Watchlist). Single RPC fetch via the cards
            component. */}
      <DashboardSummaryCards />

      {/* ── Low Stock Alerts bar ───────────────────────────────────────── */}
      <div style={{ ...cardStyle, padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{
            height: '48px', width: '48px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: '999px',
            background: theme.dangerSoft, color: theme.danger,
            border: `1px solid ${theme.dangerBorder}`,
          }}>
            <AlertTriangleIcon />
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: theme.fontMd, fontWeight: 700, color: theme.ink }}>Low Stock Alerts</h3>
            <p style={{ margin: '2px 0 0', fontSize: theme.fontBase, color: theme.inkMuted }}>
              {data.low_stock_count === 0
                ? 'Excellent! All items are well stocked.'
                : `${data.low_stock_count} item${data.low_stock_count === 1 ? '' : 's'} below the minimum stock level.`}
            </p>
          </div>
          <Link
            to="/reports/reorder"
            style={{
              padding: '10px 20px',
              borderRadius: '999px',
              background: theme.brandGradient,
              color: '#fff',
              fontSize: theme.fontBase, fontWeight: 600,
              textDecoration: 'none',
              boxShadow: '0 4px 12px rgba(124,58,237,.25)',
              whiteSpace: 'nowrap',
            }}
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
