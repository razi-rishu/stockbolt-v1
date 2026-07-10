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
import { formatCurrency, fiscalYearLabel } from '@/lib/locale';
import type { OwnerDashboard } from '@/data/adapter';
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
function CalendarIcon()    { return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>; }
function BoxThumbIcon()    { return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5V8z" /><path d="M3 8l9 5 9-5M12 13v8" /></svg>; }

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
      style={{ ...cardStyle, padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px', height: '100%' }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = theme.shadowMd; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = theme.shadowSm; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{
          height: '40px', width: '40px', flexShrink: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: '12px', background: pal.bg, color: pal.fg,
        }}>
          {icon}
        </div>
        <div style={{ fontSize: '12px', fontWeight: 600, color: theme.inkMuted, lineHeight: 1.3 }}>{label}</div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '19px', fontWeight: 800, color: theme.ink, letterSpacing: '-.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        <div style={{ marginTop: '2px', fontSize: '12px', color: theme.inkFaint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
      </div>
      <div>
        {hasDelta ? (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '4px',
            padding: '2px 8px', borderRadius: '999px',
            fontSize: '11px', fontWeight: 700,
            background: positive ? '#ecfdf5' : '#fef2f2',
            color: positive ? '#059669' : '#dc2626',
          }}>
            {positive ? <ArrowUpIcon /> : <ArrowDownIcon />}
            {Math.abs(delta!).toFixed(1)}%
          </span>
        ) : (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '4px',
            padding: '2px 10px', borderRadius: '999px',
            fontSize: '11px', fontWeight: 700,
            background: theme.muted, color: theme.inkFaint,
          }}>
            —
          </span>
        )}
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

// ── Hero "more actions" (⋯) menu ────────────────────────────────────────────
function HeroMoreMenu() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const actions = [
    { label: 'New Quote',          href: '/sales/quotes/new' },
    { label: 'New Purchase Order', href: '/purchasing/orders/new' },
    { label: 'New Expense',        href: '/purchasing/expenses/new' },
    { label: 'New Product',        href: '/products/new' },
  ];

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label="More actions"
        onClick={() => setOpen((o) => !o)}
        style={{
          height: '37px', width: '37px', borderRadius: '999px',
          background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.3)',
          color: '#fff', cursor: 'pointer', fontSize: '17px', lineHeight: 1, fontWeight: 700,
        }}
      >⋯</button>
      {open && (
        <div style={{
          position: 'absolute', insetInlineEnd: 0, top: 'calc(100% + 8px)', width: '196px',
          background: '#fff', borderRadius: '12px', border: `1px solid ${theme.border}`,
          boxShadow: theme.shadowLg, padding: '4px 0', zIndex: 30,
        }}>
          {actions.map((a) => (
            <button
              key={a.href}
              type="button"
              onClick={() => { setOpen(false); navigate(a.href); }}
              style={{
                display: 'block', width: '100%', textAlign: 'start',
                padding: '8px 14px', fontSize: '13px', color: theme.ink,
                background: 'transparent', border: 'none', cursor: 'pointer',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.muted; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sales Trend chart ───────────────────────────────────────────────────────
type TrendMode = 'week' | 'month' | 'year';

function SalesTrendChart({ data, mode = 'week' }: { data: { date: string; sales: number; purchases: number }[]; mode?: TrendMode }) {
  const dayLabels   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const chartData = data.map((d) => ({
    ...d,
    label: mode === 'week'  ? dayLabels[new Date(d.date).getDay()]
         : mode === 'month' ? String(Number(d.date.slice(8, 10)))          // day of month
         :                    monthLabels[Number(d.date.slice(5, 7)) - 1], // month of year
  }));
  const hasData = data.some((d) => d.sales > 0 || d.purchases > 0);

  if (!hasData) {
    const emptyMsg = mode === 'week'  ? 'No transactions in the last 7 days.'
                   : mode === 'month' ? 'No transactions this month yet.'
                   :                    'No transactions this year yet.';
    return <p style={{ padding: '40px 0', textAlign: 'center', fontSize: theme.fontBase, color: theme.inkFaint }}>{emptyMsg}</p>;
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
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: theme.inkMuted }}
            interval={mode === 'week' ? 0 : 'preserveStartEnd'} />
          <YAxis hide />
          <Tooltip
            contentStyle={{ borderRadius: 8, border: `1px solid ${theme.border}`, fontSize: 12 }}
            formatter={(v, name) => [fmt(Number(v ?? 0)), name === 'sales' ? 'Sales' : 'Purchases']}
            labelFormatter={(l) => (mode === 'week' ? `Day: ${l}` : mode === 'month' ? `Day ${l}` : String(l))}
          />
          <Area type="monotone" dataKey="sales"     stroke="#7c3aed" strokeWidth={2.5} fill="url(#gradSales)" />
          <Area type="monotone" dataKey="purchases" stroke="#10b981" strokeWidth={2.5} fill="url(#gradPurchases)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Phase 40 — Today / This Month / This Year KPI period toggle ─────────────
type KpiPeriod = 'today' | 'month' | 'year';
const KPI_PERIOD_KEY = 'stockbolt.dashboard.period';

function PeriodToggle({ value, onChange }: { value: KpiPeriod; onChange: (p: KpiPeriod) => void }) {
  const opts: { key: KpiPeriod; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'month', label: 'This Month' },
    { key: 'year',  label: 'This Year' },
  ];
  return (
    <div style={{ display: 'inline-flex', gap: '6px' }}>
      {opts.map(o => (
        <button key={o.key} onClick={() => onChange(o.key)} style={{
          padding: '7px 16px', borderRadius: '999px', cursor: 'pointer',
          fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap',
          background: value === o.key ? '#fff' : 'transparent',
          color: value === o.key ? '#6d28d9' : theme.inkMuted,
          border: value === o.key ? `1px solid ${theme.border}` : '1px solid transparent',
          boxShadow: value === o.key ? '0 1px 3px rgba(15,23,42,.08)' : 'none',
        }}>{o.label}</button>
      ))}
    </div>
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

  // Phase 40 — KPI period (Today / This Month / This Year), remembered per device.
  const [period, setPeriodState] = useState<KpiPeriod>(() => {
    const saved = localStorage.getItem(KPI_PERIOD_KEY);
    return saved === 'month' || saved === 'year' ? saved : 'today';
  });
  const setPeriod = (p: KpiPeriod) => {
    setPeriodState(p);
    try { localStorage.setItem(KPI_PERIOD_KEY, p); } catch { /* private mode */ }
  };

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

  // Phase 40 — flow KPIs follow the selected period (fall back to the legacy
  // today fields if period_stats is missing, e.g. a stale cached payload).
  const ps = data.period_stats?.[period] ?? {
    sales: data.today_sales_amount, sales_prev: data.today_sales_amount_prev,
    purchases: data.today_purchases_amount, purchases_prev: data.today_purchases_amount_prev,
  };
  const periodWord   = period === 'today' ? 'Today' : period === 'month' ? 'This Month' : 'This Year';
  const monthTitle   = new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const trendTitle   = period === 'today' ? 'Sales Trend — last 7 days'
                     : period === 'month' ? `Sales Trend — ${monthTitle}`
                     :                      `Sales Trend — ${new Date().getFullYear()}`;
  const trendData    = period === 'today' ? data.trend_7d
                     : period === 'month' ? (data.trend_month ?? data.trend_7d)
                     :                      (data.trend_year ?? data.trend_7d);

  // Pre-compute deltas
  const dSales      = deltaPct(ps.sales,     ps.sales_prev);
  const dPurchases  = deltaPct(ps.purchases, ps.purchases_prev);
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', minWidth: 0 }}>
          {/* Phase 28 — company logo (if uploaded); no initials fallback in the hero. */}
          {company?.logo_url && (
            <div style={{
              width: '56px', height: '56px', borderRadius: '12px', background: '#fff',
              flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', boxShadow: '0 2px 10px rgba(0,0,0,.20)',
            }}>
              <img src={company.logo_url} alt={greetName || 'Company logo'}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800, letterSpacing: '-.01em' }}>
              {greetName || 'StockBolt'}
            </h1>
            <p style={{ margin: '5px 0 0', fontSize: '12.5px', color: 'rgba(255,255,255,.78)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <CalendarIcon /> {fmtToday()}
            </p>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '8px', fontSize: '12px', color: 'rgba(255,255,255,.9)' }}>
              <span><span style={{ opacity: .7 }}>Currency:</span> <strong>{currency}</strong></span>
              <span><span style={{ opacity: .7 }}>Fiscal Year:</span> <strong>{fiscalYearLabel(company?.fiscal_year_start)}</strong></span>
            </div>
          </div>
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
          }}>+ Record Receipt</Link>
          <Link to="/purchasing/bills/new" style={{
            padding: '9px 18px', borderRadius: '999px',
            background: 'rgba(255,255,255,.12)', color: '#fff',
            border: '1px solid rgba(255,255,255,.3)',
            fontSize: '13px', fontWeight: 600, textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}>+ New Bill</Link>
          <HeroMoreMenu />
        </div>
      </div>

      {/* ── Phase 40 — KPI period toggle (drives Sales/Purchases + trend) ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '-12px' }}>
        <PeriodToggle value={period} onChange={setPeriod} />
      </div>

      {/* ── 6 KPI tiles (3×2 on desktop, horizontal compact layout) ────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
        gap: '14px',
      }}>
        <KpiTile label={`${periodWord} Sales`}     value={formatCurrency(ps.sales, currency)}     sub="Revenue (excl. VAT)" delta={dSales}     icon={<TrendingUpIcon />} tone="emerald" href="/sales/invoices" />
        <KpiTile label={`${periodWord} Purchases`} value={formatCurrency(ps.purchases, currency)} sub="Bills (excl. VAT)"   delta={dPurchases} icon={<CartIcon />}       tone="violet"  href="/purchasing/bills" />
        <KpiTile label="Inventory Value"  value={formatCurrency(data.inventory_value, currency)}         sub="Asset Value"         delta={dInventory} icon={<WalletIcon />}     tone="slate"   href="/reports/stock-valuation" />
        <KpiTile label="SKU Count"        value={fmtInt(data.sku_count)}                     sub="Unique Parts"        delta={dSku}       icon={<StoreIcon />}      tone="sky"     href="/products" />
        <KpiTile label="Receivables"      value={formatCurrency(data.outstanding_ar, currency)}          sub="Outstanding"         delta={dAR}        icon={<CoinIcon />}       tone="orange"  href="/reports/ar-aging" />
        <KpiTile label="Payables"         value={formatCurrency(data.outstanding_ap, currency)}          sub="Outstanding"         delta={dAP}        icon={<HandCoinIcon />}   tone="violet"  href="/reports/ap-aging" />
      </div>

      {/* ── Sales Trend + Recent Inventory — stack below lg ───────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        {/* Sales Trend (2/3) */}
        <div style={{ ...cardStyle, padding: '20px 22px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
              <div style={{
                height: '34px', width: '34px', flexShrink: 0, borderRadius: '10px',
                background: '#f5f3ff', color: '#7c3aed',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <TrendingUpIcon />
              </div>
              <h3 style={{ margin: 0, fontSize: '15.5px', fontWeight: 700, color: theme.ink }}>{trendTitle}</h3>
            </div>
            <Link to="/reports/profit-loss" style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              padding: '6px 14px', borderRadius: '999px',
              border: `1px solid ${theme.border}`, background: '#fff',
              color: theme.ink, fontSize: '12.5px', fontWeight: 600, textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}>P&amp;L <ArrowUpRightIcon /></Link>
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: '18px', margin: '12px 0 2px', fontSize: '12px', color: theme.inkMuted }}>
            <span><span style={{ color: '#7c3aed' }}>◆</span> Sales ({currency})</span>
            <span><span style={{ color: '#10b981' }}>◆</span> Purchases ({currency})</span>
          </div>

          <SalesTrendChart data={trendData} mode={period === 'today' ? 'week' : period} />
        </div>

        {/* Recent Inventory (1/3) */}
        <div style={{ ...cardStyle, padding: '20px 22px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <h3 style={{ margin: 0, fontSize: '15.5px', fontWeight: 700, color: theme.ink }}>Recent Inventory</h3>
            <Link to="/inventory/stock-ledger" style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              padding: '6px 14px', borderRadius: '999px',
              border: `1px solid ${theme.border}`, background: '#fff',
              color: theme.ink, fontSize: '12.5px', fontWeight: 600, textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}>Stock <ArrowUpRightIcon /></Link>
          </div>

          {data.recent_inventory.length === 0 ? (
            <p style={{ padding: '24px 0', textAlign: 'center', fontSize: theme.fontBase, color: theme.inkFaint }}>No items yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, flex: 1 }}>
              {data.recent_inventory.map((it, idx) => (
                <li
                  key={it.product_id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '11px 0',
                    borderTop: idx === 0 ? 'none' : `1px solid ${theme.border}`,
                  }}
                >
                  <div style={{
                    height: '40px', width: '40px', flexShrink: 0, borderRadius: '10px',
                    background: '#f1f5f9', color: '#64748b',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <BoxThumbIcon />
                  </div>
                  <Link
                    to={`/products/${it.product_id}`}
                    style={{ flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}
                  >
                    <div style={{
                      fontSize: '13px', fontWeight: 600, color: theme.ink,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{it.name}</div>
                    {it.oe_number && (
                      <div style={{ marginTop: '2px', fontSize: theme.fontXs, color: theme.inkFaint }}>OE: {it.oe_number}</div>
                    )}
                  </Link>
                  <span style={{
                    flexShrink: 0,
                    fontSize: '13px', fontWeight: 700, color: theme.ink, fontVariantNumeric: 'tabular-nums',
                  }}>
                    {fmtInt(it.quantity)} {(it.unit_code || 'PCS').toUpperCase()}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <Link to="/products" style={{
            marginTop: 'auto', paddingTop: '12px',
            fontSize: '13px', fontWeight: 600, color: '#6d28d9', textDecoration: 'none',
          }}>
            View all inventory
          </Link>
        </div>
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
