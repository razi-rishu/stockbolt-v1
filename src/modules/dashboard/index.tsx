/**
 * Dashboard — owner 360 view, Ocean Teal (UI v1.1).
 *
 * Layout (top-down):
 *  1. Teal greeting band: logo (or initials), time-of-day greeting, company,
 *     date · currency · fiscal year, and "Sales vs purchases" for the period
 *     (sales minus purchases as shown on the two KPI cards — deliberately not
 *     called profit: it ignores cost of goods and expenses)
 *  2. Period pills (Today / This week / This month / This year) next to the
 *     shared PeriodPicker for every other range, custom and All time
 *  3. 6 KPI cards (Sales / Purchases / Inventory value / SKU count /
 *     Receivables / Payables) with period-over-period deltas; Sales and
 *     Purchases carry a sparkline from the same trend series as the chart
 *  4. Sales trend (toggle Sales / Purchases) + Cash position
 *  5. Quick actions (replaces the hero buttons, ⋯ menu and floating button)
 *  6. Low stock (count + the worst lines from the reorder report) + Recent
 *     inventory
 *  7. Income vs expense, Top expenses, Watchlist
 *
 * Every figure comes from the same fetches as before (getOwnerDashboard,
 * get_dashboard_cards); the low-stock lines reuse getReorderReport and are
 * read only when the dashboard's own low-stock count is above zero.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PeriodPicker } from '@/ui/period-picker';
import { usePeriodPicker, PERIOD_PRESETS, type PeriodPreset } from '@/hooks/use-period-picker';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import {
  TrendingUp, ShoppingCart, Wallet, Barcode, ArrowDownLeft, ArrowUpRight, CalendarDays,
  FileText, Banknote, Receipt, FileSignature, Truck, Package, ClipboardList, CreditCard,
  AlertTriangle, Box, ChevronRight, Loader2,
} from 'lucide-react';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { useCompanyCurrency, useTaxName } from '@/hooks/use-company-currency';
import { formatCurrency, fiscalYearLabel } from '@/lib/locale';
import type { OwnerDashboard } from '@/data/adapter';
import {
  IncomeExpenseCard, TopExpensesCard, CashPositionCard, WatchlistCard, SummaryCardsState,
} from './_summary-cards';
import { useDashboardCards } from './_use-dashboard-cards';
import '@/styles/stockbolt-ocean-teal.css';

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

const TEAL = '#008F87';
const AMBER = '#E08A00';

// ── Sparkline (tiny trend line inside a KPI card) ───────────────────────────
function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2 || values.every(v => v === 0)) return null;
  const mx = Math.max(...values), mn = Math.min(...values);
  const span = mx - mn || 1;
  const pts = values.map((v, i) => `${((i * 60) / (values.length - 1)).toFixed(1)},${(20 - ((v - mn) / span) * 16 - 2).toFixed(1)}`).join(' ');
  return (
    <svg viewBox="0 0 60 20" width="64" height="22" aria-hidden="true" className="sb-dash-spark">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── KPI card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, delta, icon, href, spark }: {
  label: string; value: string; sub: string; delta: number | null;
  icon: React.ReactNode; href: string; spark?: React.ReactNode;
}) {
  const positive = (delta ?? 0) >= 0;
  return (
    <Link to={href} className="sb-card sb-dash-kpi">
      <span className="sb-dash-kpi-top">
        <span className="sb-dash-ico" aria-hidden="true">{icon}</span>
        {spark}
      </span>
      <span className="sb-dash-kpi-label">{label}</span>
      <bdi dir="ltr" className="sb-dash-kpi-value">{value}</bdi>
      <span className="sb-dash-kpi-foot">
        {delta === null
          ? <span className="sb-pill sb-pill-muted sb-dash-delta">—</span>
          : <span className={`sb-pill ${positive ? 'sb-pill-good' : 'sb-pill-bad'} sb-dash-delta`}><bdi dir="ltr">{positive ? '↑' : '↓'} {Math.abs(delta).toFixed(1)}%</bdi></span>}
        <span className="sb-dash-kpi-sub">{sub}</span>
      </span>
    </Link>
  );
}

// ── Sales trend chart ───────────────────────────────────────────────────────
type TrendMode = 'week' | 'month' | 'year' | 'range';

function SalesTrendChart({ data, mode = 'week', show }: {
  data: { date: string; sales: number; purchases: number }[]; mode?: TrendMode;
  show: { sales: boolean; purchases: boolean };
}) {
  const { t, i18n } = useTranslation();
  const loc = i18n.language === 'ar' ? 'ar' : 'en-US';
  const day = (d: string) => new Date(d).toLocaleDateString(loc, { weekday: 'short' });
  const mon = (d: string) => new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, 1).toLocaleDateString(loc, { month: 'short' });
  const chartData = data.map((d) => ({
    ...d,
    label: mode === 'week'  ? day(d.date)
         : mode === 'month' ? String(Number(d.date.slice(8, 10)))          // day of month
         : mode === 'year'  ? mon(d.date)                                   // month of year
         // A range spanning more than a year repeats every month label, so
         // the year has to be on the axis or Jan 2025 and Jan 2026 look like
         // the same bar.
         :                    `${mon(d.date)} ${d.date.slice(2, 4)}`,
  }));
  const hasData = data.some((d) => d.sales > 0 || d.purchases > 0);
  if (!hasData) return <div className="sb-dash-empty">{t('dashboardOcean.no_txns')}</div>;

  return (
    <div dir="ltr" style={{ width: '100%' }}>
      <ResponsiveContainer width="100%" height={240} minWidth={0}>
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="sbGradSales" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={TEAL} stopOpacity={0.28} />
              <stop offset="100%" stopColor={TEAL} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="sbGradPurch" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={AMBER} stopOpacity={0.22} />
              <stop offset="100%" stopColor={AMBER} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 4" stroke="#E1E9ED" vertical={false} />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#607185' }}
            interval={mode === 'week' ? 0 : 'preserveStartEnd'} />
          <YAxis hide />
          <Tooltip
            cursor={{ stroke: TEAL, strokeWidth: 1, strokeDasharray: '3 3' }}
            contentStyle={{ borderRadius: 12, border: 'none', background: '#0D1935', color: '#fff', fontSize: 12, boxShadow: '0 8px 20px rgba(13,25,53,.25)' }}
            itemStyle={{ color: '#fff' }}
            labelStyle={{ color: '#D7F4F1', fontWeight: 600 }}
            formatter={(v, name) => [fmt(Number(v ?? 0)), name === 'sales' ? t('dashboardOcean.sales') : t('dashboardOcean.purchases')]}
          />
          {show.purchases && <Area type="monotone" dataKey="purchases" stroke={AMBER} strokeWidth={2.5} fill="url(#sbGradPurch)" activeDot={{ r: 5, fill: '#fff', stroke: AMBER, strokeWidth: 2.5 }} />}
          {show.sales && <Area type="monotone" dataKey="sales" stroke={TEAL} strokeWidth={2.5} fill="url(#sbGradSales)" activeDot={{ r: 5, fill: '#fff', stroke: TEAL, strokeWidth: 2.5 }} />}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Phase 97 — the KPI period is the SHARED picker ──────────────────────────
// Phase 40 shipped three pinned buttons (Today / This Month / This Year).
// Meanwhile every one of the 30 reports grew a dropdown with ten ranges,
// including All time and a custom range. Two controls for one idea, and the
// dashboard had the weaker one. This is the reports' picker, not a new one.
const KPI_PERIOD_KEY = 'stockbolt.dashboard.period';

// The KPI cards say "This Month Sales"; the label has to track whatever the
// dropdown resolved to, or the number and its caption disagree.
const PERIOD_LABELS: Record<string, string> = {
  ...Object.fromEntries(PERIOD_PRESETS.map((x: { key: string; label: string }) => [x.key, x.label])),
  all_time: 'All time',
  custom:   'Selected range',
};

/**
 * Phase 40 stored 'today' | 'month' | 'year'. The shared hook stores a JSON
 * blob keyed by different preset names, so an operator who had picked This
 * Year would silently be reset. Translate the old value once, on read.
 */
function migrateLegacyPeriod(): void {
  try {
    const raw = localStorage.getItem(KPI_PERIOD_KEY);
    if (!raw || raw.startsWith('{')) return;   // absent, or already migrated
    const preset = raw === 'month' ? 'this_month'
                 : raw === 'year'  ? 'this_year'
                 : 'today';
    localStorage.setItem(KPI_PERIOD_KEY, JSON.stringify({ preset, from: '', to: '' }));
  } catch { /* private mode */ }
}
migrateLegacyPeriod();

const QUICK_PRESETS: PeriodPreset[] = ['today', 'this_week', 'this_month', 'this_year'];

// ── Main component ──────────────────────────────────────────────────────────
export default function DashboardPage() {
  const taxName = useTaxName();   // GST for India, VAT for the GCC
  const { t, i18n } = useTranslation();
  const adapter = getAdapter();
  const company_id = useAuthStore(s => s.company_id);
  const currency = useCompanyCurrency();   // Issue 1 — localize all money to the tenant's currency

  const { data: company } = useQuery({
    queryKey: ['company', company_id],
    queryFn: () => adapter.companies.getById(company_id!),
    enabled: !!company_id,
  });
  const greetName = company?.name ?? '';

  const [data, setData] = useState<OwnerDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState({ sales: true, purchases: true });

  // Phase 97 — the shared period picker, remembered per device by the hook.
  const { preset, from, to, setPreset, setCustomRange } =
    usePeriodPicker(KPI_PERIOD_KEY, 'today');

  // Refetch whenever the window moves: the totals are summed from rows the
  // adapter fetches, so a wider range needs a wider fetch.
  useEffect(() => {
    if (!company_id) return;
    setLoading(true);
    adapter.reports.getOwnerDashboard(company_id, { from, to })
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company_id, from, to]);

  const cardsQ = useDashboardCards(from, to);

  // Low-stock lines: the reorder report, read only when there is something
  // to show. Same rule as the dashboard count (a minimum is set and stock is
  // at or below it), worst shortage first.
  const lowCount = data?.low_stock_count ?? 0;
  const reorderQ = useQuery({
    queryKey: ['reorder_report', company_id],
    queryFn: () => adapter.reports.getReorderReport(company_id!),
    enabled: !!company_id && lowCount > 0,
    staleTime: 5 * 60 * 1000,
  });
  const lowLines = (reorderQ.data ?? []).filter(l => l.min_stock_level > 0).slice(0, 4);

  if (loading) return (
    <div className="sb-ocean sb-page sb-dash" style={{ display: 'flex', justifyContent: 'center', padding: '96px 0' }}>
      <Loader2 size={26} className="sb-spin sb-icon" aria-label={t('common.loading')} />
    </div>
  );

  if (!data) return (
    <div className="sb-ocean sb-page sb-dash"><div className="sb-card sb-empty" style={{ margin: 16 }}>{t('common.no_data')}</div></div>
  );

  // Phase 40/97 — flow KPIs follow the selected period (legacy today fields
  // only if a cached payload predates Phase 97).
  const ps = data.period_stats?.selected ?? data.period_stats?.today ?? {
    sales: data.today_sales_amount, sales_prev: data.today_sales_amount_prev,
    purchases: data.today_purchases_amount, purchases_prev: data.today_purchases_amount_prev,
  };
  const periodWord   = t(`dashboardOcean.period.${preset}`, { defaultValue: PERIOD_LABELS[preset] ?? 'Selected' });
  const trendData    = data.trend_selected ?? data.trend_7d;
  const trendMode    = data.trend_selected_mode ?? 'week';
  // All time has no earlier period, so there is no honest delta to draw.
  const showDelta    = data.selected_meta?.has_prev ?? true;

  const dSales      = showDelta ? deltaPct(ps.sales,     ps.sales_prev)     : null;
  const dPurchases  = showDelta ? deltaPct(ps.purchases, ps.purchases_prev) : null;
  const dInventory  = deltaPct(data.inventory_value,        data.inventory_value_prev);
  const dSku        = deltaPct(data.sku_count,              data.sku_count_prev);
  const dAR         = deltaPct(data.outstanding_ar,         data.outstanding_ar_prev);
  const dAP         = deltaPct(data.outstanding_ap,         data.outstanding_ap_prev);

  // Sales vs purchases for the period: exactly the two KPI figures, subtracted.
  const salesVsPurchases = ps.sales - ps.purchases;

  const hour = new Date().getHours();
  const greet = hour < 12 ? t('dashboardOcean.greet_morning') : hour < 17 ? t('dashboardOcean.greet_afternoon') : t('dashboardOcean.greet_evening');
  const today = new Date().toLocaleDateString(i18n.language === 'ar' ? 'ar' : undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  // Fiscal-year span in the UI language (same months as fiscalYearLabel).
  const fyStart = (() => { const m = /^\d{4}-(\d{2})/.exec(company?.fiscal_year_start ?? ''); const i = m ? parseInt(m[1], 10) - 1 : 0; return i >= 0 && i < 12 ? i : 0; })();
  const monthName = (i: number) => new Date(2000, i, 1).toLocaleDateString(i18n.language === 'ar' ? 'ar' : 'en-US', { month: 'short' });
  const fyText = i18n.language === 'ar' ? `${monthName(fyStart)}–${monthName((fyStart + 11) % 12)}` : fiscalYearLabel(company?.fiscal_year_start);
  const initials = (greetName || 'StockBolt').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

  const toggle = (k: 'sales' | 'purchases') => setShow(s => {
    const next = { ...s, [k]: !s[k] };
    return next.sales || next.purchases ? next : s;   // keep at least one series on
  });

  const QUICK = [
    { to: '/sales/invoices/new',      icon: <FileText size={20} />,      label: t('dashboardOcean.qa_invoice') },
    { to: '/sales/payments/new',      icon: <Banknote size={20} />,      label: t('dashboardOcean.qa_receipt') },
    { to: '/purchasing/bills/new',    icon: <Receipt size={20} />,       label: t('dashboardOcean.qa_bill') },
    { to: '/sales/quotes/new',        icon: <FileSignature size={20} />, label: t('dashboardOcean.qa_quote') },
    { to: '/purchasing/grns/new',     icon: <Truck size={20} />,         label: t('dashboardOcean.qa_grn') },
    { to: '/purchasing/orders/new',   icon: <ClipboardList size={20} />, label: t('dashboardOcean.qa_po') },
    { to: '/purchasing/expenses/new', icon: <CreditCard size={20} />,    label: t('dashboardOcean.qa_expense') },
    { to: '/products/new',            icon: <Package size={20} />,       label: t('dashboardOcean.qa_product') },
  ];

  return (
    <div className="sb-ocean sb-page sb-dash" data-testid="dashboard-ocean">
      {/* ── 1. Greeting band ─────────────────────────────────────────────── */}
      <section className="sb-dash-hero">
        <div className="sb-dash-hero-id">
          <span className="sb-dash-logo">
            {company?.logo_url
              ? <img src={company.logo_url} alt={greetName || t('dashboardOcean.logo_alt')} />
              : <span aria-hidden="true">{initials}</span>}
          </span>
          <span style={{ minWidth: 0 }}>
            <span className="sb-dash-greet">{greet}</span>
            <h1 className="sb-dash-company">{greetName || 'StockBolt'}</h1>
            <span className="sb-dash-meta">
              <CalendarDays size={14} aria-hidden="true" /> {today}
              <span aria-hidden="true">·</span> <bdi dir="ltr">{currency}</bdi>
              <span aria-hidden="true">·</span> {t('dashboardOcean.fy')} <bdi>{fyText}</bdi>
            </span>
          </span>
        </div>
        <div className="sb-dash-hero-fig">
          <span className="sb-dash-greet">{t('dashboardOcean.sales_vs_purchases')}</span>
          <bdi dir="ltr" className="sb-dash-hero-num">{formatCurrency(salesVsPurchases, currency)}</bdi>
          <span className="sb-dash-greet">{periodWord}</span>
        </div>
      </section>

      <div className="sb-body sb-dash-body">
        {/* ── 2. Period ──────────────────────────────────────────────────── */}
        <div className="sb-dash-periodbar">
          <div className="sb-dash-seg" role="group" aria-label={t('dashboardOcean.period_label')}>
            {QUICK_PRESETS.map(p => (
              <button key={p} type="button" aria-pressed={preset === p} className={preset === p ? 'on' : ''} onClick={() => setPreset(p)}>
                {t(`dashboardOcean.period.${p}`, { defaultValue: PERIOD_LABELS[p] })}
              </button>
            ))}
          </div>
          <div className="sb-dash-picker">
            <PeriodPicker preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} allowAllTime />
          </div>
        </div>

        {/* ── 3. KPI cards (2 up on a phone, 3 on a tablet, 6 on wide) ───── */}
        <div className="sb-dash-kpis">
          <KpiCard label={t('dashboardOcean.kpi_sales', { period: periodWord })} value={formatCurrency(ps.sales, currency)} sub={t('dashboard.revenue_excl_tax', { tax: taxName })} delta={dSales} icon={<TrendingUp size={18} />} href="/sales/invoices"
            spark={<Sparkline values={trendData.map(d => d.sales)} color={TEAL} />} />
          <KpiCard label={t('dashboardOcean.kpi_purchases', { period: periodWord })} value={formatCurrency(ps.purchases, currency)} sub={t('dashboard.bills_excl_tax', { tax: taxName })} delta={dPurchases} icon={<ShoppingCart size={18} />} href="/purchasing/bills"
            spark={<Sparkline values={trendData.map(d => d.purchases)} color={AMBER} />} />
          <KpiCard label={t('dashboardOcean.inventory_value')} value={formatCurrency(data.inventory_value, currency)} sub={t('dashboardOcean.asset_value')} delta={dInventory} icon={<Wallet size={18} />} href="/reports/stock-valuation" />
          <KpiCard label={t('dashboardOcean.sku_count')} value={fmtInt(data.sku_count)} sub={t('dashboardOcean.unique_parts')} delta={dSku} icon={<Barcode size={18} />} href="/products" />
          <KpiCard label={t('dashboardOcean.receivables')} value={formatCurrency(data.outstanding_ar, currency)} sub={t('dashboardOcean.outstanding')} delta={dAR} icon={<ArrowDownLeft size={18} />} href="/reports/ar-aging" />
          <KpiCard label={t('dashboardOcean.payables')} value={formatCurrency(data.outstanding_ap, currency)} sub={t('dashboardOcean.outstanding')} delta={dAP} icon={<ArrowUpRight size={18} />} href="/reports/ap-aging" />
        </div>

        {/* ── 4. Sales trend + Cash position ─────────────────────────────── */}
        <div className="sb-dash-row sb-dash-row-trend">
          <section className="sb-card sb-dash-card">
            <div className="sb-dash-card-head">
              <span className="sb-dash-ico" aria-hidden="true"><TrendingUp size={18} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 className="sb-dash-card-title">{t('dashboardOcean.sales_trend')}</h3>
                <p className="sb-dash-card-hint">{periodWord} · <bdi dir="ltr">{currency}</bdi></p>
              </div>
              <div className="sb-dash-toggles" role="group" aria-label={t('dashboardOcean.sales_trend')}>
                <button type="button" aria-pressed={show.sales} className={show.sales ? 'on' : ''} onClick={() => toggle('sales')}><i style={{ background: TEAL }} />{t('dashboardOcean.sales')}</button>
                <button type="button" aria-pressed={show.purchases} className={show.purchases ? 'on' : ''} onClick={() => toggle('purchases')}><i style={{ background: AMBER }} />{t('dashboardOcean.purchases')}</button>
              </div>
            </div>
            <div className="sb-dash-card-body">
              <SalesTrendChart data={trendData} mode={trendMode} show={show} />
              <Link to="/reports/profit-loss" className="sb-row-link text-brand-600" style={{ paddingInline: 0 }}>{t('dashboardOcean.view_pl')} <ChevronRight size={16} className="sb-flip" aria-hidden="true" /></Link>
            </div>
          </section>
          {cardsQ.data ? <CashPositionCard data={cardsQ.data} currency={currency} /> : <SummaryCardsState q={cardsQ} />}
        </div>

        {/* ── 5. Quick actions ───────────────────────────────────────────── */}
        <section className="sb-card sb-dash-card">
          <div className="sb-dash-card-head"><h3 className="sb-dash-card-title" style={{ flex: 1 }}>{t('dashboardOcean.quick_actions')}</h3></div>
          <div className="sb-dash-quick">
            {QUICK.map(q => (
              <Link key={q.to} to={q.to} className="sb-dash-qa">
                <span className="sb-dash-qa-ico" aria-hidden="true">{q.icon}</span>
                <span>{q.label}</span>
              </Link>
            ))}
          </div>
        </section>

        {/* ── 6. Low stock + Recent inventory ────────────────────────────── */}
        <div className="sb-dash-row">
          <section className="sb-card sb-dash-card">
            <div className="sb-dash-card-head">
              <span className={`sb-dash-ico ${lowCount > 0 ? 'is-bad' : ''}`} aria-hidden="true"><AlertTriangle size={18} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 className="sb-dash-card-title">{t('dashboardOcean.low_stock')}</h3>
                <p className="sb-dash-card-hint">{lowCount === 0 ? t('dashboardOcean.low_none') : t('dashboardOcean.low_count', { count: lowCount })}</p>
              </div>
              {lowCount > 0 && <span className="sb-pill sb-pill-bad" style={{ marginTop: 0 }}><bdi dir="ltr">{lowCount}</bdi></span>}
            </div>
            <div className="sb-dash-card-body">
              {lowCount > 0 && reorderQ.isLoading && <div className="sb-dash-empty">{t('common.loading')}</div>}
              {lowLines.length > 0 && (
                <ul className="sb-dash-low">
                  {lowLines.map(l => {
                    const pct = Math.max(0, Math.min(100, (l.qty_on_hand / l.min_stock_level) * 100));
                    const critical = pct < 50;
                    return (
                      <li key={`${l.product_id}-${l.warehouse_id}`}>
                        <span className="sb-dash-low-row">
                          <Link to={`/products/${l.product_id}`} className="sb-dash-ellipsis" style={{ flex: 1, fontWeight: 600, color: 'var(--sb-text)', textDecoration: 'none' }}>{l.product_name}</Link>
                          <bdi dir="ltr" className="sb-fx-name">{fmtInt(l.qty_on_hand)} / {fmtInt(l.min_stock_level)}</bdi>
                        </span>
                        {l.warehouse_name && <span className="sb-fx-name" style={{ fontSize: 12 }}>{l.warehouse_name}</span>}
                        <span className={`sb-dash-bar ${critical ? 'is-bad' : 'is-warn'}`}><i style={{ width: `${pct}%` }} /></span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {lowCount === 0 && <div className="sb-dash-allclear"><Box size={26} aria-hidden="true" /><span className="sb-fx-name">{t('dashboardOcean.low_all_good')}</span></div>}
              <Link to="/reports/reorder" className={lowCount > 0 ? 'sb-primary-btn sb-btn-inline sb-dash-cta' : 'sb-row-link text-brand-600'} style={lowCount > 0 ? undefined : { paddingInline: 0 }}>
                {t('dashboardOcean.manage_stock')} <ChevronRight size={16} className="sb-flip" aria-hidden="true" />
              </Link>
            </div>
          </section>

          <section className="sb-card sb-dash-card">
            <div className="sb-dash-card-head">
              <span className="sb-dash-ico" aria-hidden="true"><Package size={18} /></span>
              <h3 className="sb-dash-card-title" style={{ flex: 1 }}>{t('dashboardOcean.recent_inventory')}</h3>
              <Link to="/inventory/stock-ledger" className="sb-row-link text-brand-600">{t('dashboardOcean.stock')}</Link>
            </div>
            <div className="sb-dash-card-body">
              {data.recent_inventory.length === 0 ? (
                <div className="sb-dash-empty">{t('dashboardOcean.no_items')}</div>
              ) : (
                <ul className="sb-dash-recent">
                  {data.recent_inventory.map((it) => (
                    <li key={it.product_id}>
                      <span className="sb-dash-thumb" aria-hidden="true"><Box size={18} /></span>
                      <Link to={`/products/${it.product_id}`} style={{ flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}>
                        <span className="sb-dash-ellipsis" style={{ display: 'block', fontWeight: 600 }}>{it.name}</span>
                        {it.oe_number && <span className="sb-fx-name" style={{ fontSize: 12 }}>OE <bdi dir="ltr">{it.oe_number}</bdi></span>}
                      </Link>
                      <bdi dir="ltr" className="sb-dash-num">{fmtInt(it.quantity)} {(it.unit_code || 'PCS').toUpperCase()}</bdi>
                    </li>
                  ))}
                </ul>
              )}
              <Link to="/products" className="sb-row-link text-brand-600" style={{ paddingInline: 0 }}>{t('dashboardOcean.view_all_inventory')} <ChevronRight size={16} className="sb-flip" aria-hidden="true" /></Link>
            </div>
          </section>
        </div>

        {/* ── 7. Income vs expense, Top expenses, Watchlist ──────────────── */}
        {cardsQ.data ? (
          <div className="sb-dash-row3">
            <IncomeExpenseCard data={cardsQ.data} periodLabel={periodWord} />
            <TopExpensesCard data={cardsQ.data} periodLabel={periodWord} />
            <WatchlistCard data={cardsQ.data} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
