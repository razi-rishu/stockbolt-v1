/**
 * Dashboard summary cards — Phase 13.03, Ocean Teal (UI v1.1).
 *
 * The cards below the trend chart on the owner dashboard. All figures come
 * from the single get_dashboard_cards fetch (useDashboardCards), unchanged:
 *
 *   1. Income vs Expense (diverging bars — income above zero, expense below)
 *   2. Top Expenses (donut + legend)
 *   3. Cash position (bank and cash balances today, with a ring of the
 *      base-currency accounts) — replaces the old Bank & Cash list
 *   4. Watchlist (auto-populated: overdrawn accounts)
 *
 * Bank balances are positions, not flows: they are deliberately NOT windowed
 * by the period filter, and the card says "balance today".
 *
 * The Cash position total adds only accounts in the company's base currency.
 * Accounts in other currencies are listed with their own currency and never
 * summed into it — adding AED to USD would be a meaningless number.
 */
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  XAxis, YAxis, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Tooltip, ReferenceLine, BarChart, Bar,
} from 'recharts';
import { BarChart3, PieChart as PieIcon, Landmark, ShieldAlert, ShieldCheck, ChevronRight } from 'lucide-react';
import type { DashboardCards } from '@/data/adapter';
import type { useDashboardCards } from './_use-dashboard-cards';

// ── Formatters ───────────────────────────────────────────────────────────
function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmt2(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// Compact format for axis labels: 12,345 → "12K"
function fmtCompact(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${Math.round(n / 1_000)}K`;
  return String(Math.round(n));
}
function monthLabel(yyyymm: string, locale: string) {
  const [y, m] = yyyymm.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString(locale === 'ar' ? 'ar' : 'en-US', { month: 'short' });
}

const TEAL = '#008F87';
const SLATE = '#94A3B8';
const TOOLTIP = { borderRadius: 12, border: '1px solid #E1E9ED', fontSize: 12, boxShadow: '0 6px 18px rgba(13,25,53,.08)' };

// ── Card shell ───────────────────────────────────────────────────────────
function Card({ icon, title, hint, children, right }: {
  icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode; right?: React.ReactNode;
}) {
  return (
    <section className="sb-card sb-dash-card">
      <div className="sb-dash-card-head">
        <span className="sb-dash-ico" aria-hidden="true">{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 className="sb-dash-card-title">{title}</h3>
          {hint && <p className="sb-dash-card-hint">{hint}</p>}
        </div>
        {right}
      </div>
      <div className="sb-dash-card-body">{children}</div>
    </section>
  );
}

// ── 1. Income vs Expense (diverging bars) ───────────────────────────────
export function IncomeExpenseCard({ data, periodLabel }: { data: DashboardCards; periodLabel?: string }) {
  const { t, i18n } = useTranslation();
  const totalIncome  = data.monthly_pl.reduce((s, r) => s + r.income,  0);
  const totalExpense = data.monthly_pl.reduce((s, r) => s + r.expense, 0);
  const net = totalIncome - totalExpense;

  // Expense is plotted as a NEGATIVE value so the bar hangs below zero.
  const chartData = data.monthly_pl.map(r => ({
    month: monthLabel(r.month, i18n.language),
    income: r.income,
    expense: -r.expense,
  }));

  return (
    <Card
      icon={<BarChart3 size={18} />}
      title={t('dashboardOcean.income_expense')}
      hint={`${data.period_explicit && periodLabel ? periodLabel : t('dashboardOcean.last_12')} · ${t('dashboardOcean.accrual')}`}
      right={
        <div style={{ textAlign: 'end' }}>
          <div className="sb-dash-mini-label">{t('dashboardOcean.net')}</div>
          <bdi dir="ltr" className={`sb-dash-mini-val ${net >= 0 ? 'is-good' : 'is-bad'}`}>
            {net >= 0 ? '+' : ''}{fmtCompact(net)}
          </bdi>
        </div>
      }
    >
      <div className="sb-dash-legend">
        <span><i style={{ background: TEAL }} />{t('dashboardOcean.income')} <bdi dir="ltr">{fmt(totalIncome)}</bdi></span>
        <span><i style={{ background: SLATE }} />{t('dashboardOcean.expense')} <bdi dir="ltr">{fmt(totalExpense)}</bdi></span>
      </div>
      <div dir="ltr">
        <ResponsiveContainer width="100%" height={196} minWidth={0}>
          <BarChart data={chartData} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 4" stroke="#E1E9ED" vertical={false} />
            <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#607185' }} />
            <YAxis
              tickFormatter={(v) => fmtCompact(Math.abs(Number(v)))}
              tick={{ fontSize: 10, fill: '#607185' }}
              axisLine={false} tickLine={false} width={36}
            />
            <ReferenceLine y={0} stroke="#0D1935" strokeWidth={1} />
            <Tooltip
              cursor={{ fill: 'rgba(0,143,135,.06)' }}
              contentStyle={TOOLTIP}
              formatter={(v, name) => [fmt2(Math.abs(Number(v ?? 0))), name === 'income' ? t('dashboardOcean.income') : t('dashboardOcean.expense')]}
              labelFormatter={(l) => `${l}`}
            />
            <Bar dataKey="income"  fill={TEAL}  radius={[4, 4, 0, 0]} />
            <Bar dataKey="expense" fill={SLATE} radius={[0, 0, 4, 4]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ── 2. Top Expenses (donut) ─────────────────────────────────────────────
// Teal first, then distinct hues so categories are easy to tell apart.
// "Others" always gets muted slate so it reads as the catch-all.
const DONUT_PALETTE = ['#008F87', '#E08A00', '#3B82F6', '#DC2626', '#8B5CF6', '#EC4899', '#14B8A6', '#B45309'];
const OTHERS_COLOR = SLATE;

export function TopExpensesCard({ data, periodLabel }: { data: DashboardCards; periodLabel?: string }) {
  const { t } = useTranslation();
  const slices = [
    ...data.top_expenses.map((e, i) => ({
      name: e.account_name, code: e.account_code, value: e.amount, color: DONUT_PALETTE[i % DONUT_PALETTE.length],
    })),
    ...(data.top_expenses_others > 0.005 ? [{
      name: t('dashboardOcean.others'), code: '', value: data.top_expenses_others, color: OTHERS_COLOR,
    }] : []),
  ];
  const total = data.top_expenses_total;
  const hint = data.period_explicit && periodLabel ? periodLabel : t('dashboardOcean.fy_to_date');

  if (slices.length === 0) {
    return (
      <Card icon={<PieIcon size={18} />} title={t('dashboardOcean.top_expenses')} hint={hint}>
        <div className="sb-dash-empty">{t('dashboardOcean.no_expenses')}</div>
      </Card>
    );
  }

  return (
    <Card
      icon={<PieIcon size={18} />}
      title={t('dashboardOcean.top_expenses')}
      hint={hint}
      right={
        <div style={{ textAlign: 'end' }}>
          <div className="sb-dash-mini-label">{t('dashboardOcean.total')}</div>
          <bdi dir="ltr" className="sb-dash-mini-val">{fmtCompact(total)}</bdi>
        </div>
      }
    >
      <div className="sb-dash-donut-row">
        <div style={{ position: 'relative', width: '148px', height: '148px', flexShrink: 0 }} dir="ltr">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={slices} dataKey="value" innerRadius={46} outerRadius={70} paddingAngle={2} stroke="none" cornerRadius={4}>
                {slices.map((s, i) => <Cell key={i} fill={s.color} />)}
              </Pie>
              <Tooltip contentStyle={TOOLTIP} formatter={(v) => fmt2(Number(v ?? 0))} />
            </PieChart>
          </ResponsiveContainer>
          <div className="sb-dash-donut-center">
            <span className="sb-dash-mini-label">{t('dashboardOcean.all')}</span>
            <bdi dir="ltr" className="sb-dash-mini-val">{fmtCompact(total)}</bdi>
          </div>
        </div>
        <ul className="sb-dash-donut-legend">
          {slices.map((s, i) => {
            const pct = total > 0 ? (s.value / total) * 100 : 0;
            return (
              <li key={i}>
                <i style={{ background: s.color }} />
                <span className="sb-dash-ellipsis" style={{ flex: 1 }}>{s.name}</span>
                <bdi dir="ltr" className="sb-fx-name">{pct.toFixed(0)}%</bdi>
                <bdi dir="ltr" className="sb-dash-num">{fmtCompact(s.value)}</bdi>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}

// ── 3. Cash position ────────────────────────────────────────────────────
const RING = ['#008F87', '#E08A00', '#3B82F6', '#8B5CF6', '#14B8A6', '#EC4899'];

export function CashPositionCard({ data, currency }: { data: DashboardCards; currency: string }) {
  const { t } = useTranslation();
  const accounts = data.bank_balances;
  if (accounts.length === 0) {
    return (
      <Card icon={<Landmark size={18} />} title={t('dashboardOcean.cash_position')}>
        <div className="sb-dash-empty">
          {t('dashboardOcean.no_banks')}{' '}
          <Link to="/banking/bank-accounts" className="sb-row-link text-brand-600" style={{ minHeight: 0, padding: 0 }}>{t('dashboardOcean.add_one')}</Link>
        </div>
      </Card>
    );
  }
  const base = accounts.filter(b => (b.currency || currency) === currency);
  const total = base.reduce((s, b) => s + Number(b.balance || 0), 0);
  // Ring shows each base-currency account's share of the positive balances.
  const positive = base.filter(b => b.balance > 0);
  const posSum = positive.reduce((s, b) => s + b.balance, 0);
  let offset = 25;
  const arcs = positive.map((b, i) => {
    const pct = posSum > 0 ? (b.balance / posSum) * 100 : 0;
    const arc = { key: b.id, pct, offset, color: RING[i % RING.length] };
    offset -= pct;
    return arc;
  });
  const colorOf = (id: string) => arcs.find(a => a.key === id)?.color ?? SLATE;

  return (
    <Card
      icon={<Landmark size={18} />}
      title={t('dashboardOcean.cash_position')}
      hint={t('dashboardOcean.balance_today', { count: accounts.length })}
      right={<Link to="/banking/bank-accounts" className="sb-row-link text-brand-600">{t('dashboardOcean.manage')}</Link>}
    >
      <div className="sb-dash-cash-top">
        <svg viewBox="0 0 42 42" width="84" height="84" aria-hidden="true" style={{ flex: 'none' }}>
          <circle cx="21" cy="21" r="15.9" fill="none" stroke="#E1E9ED" strokeWidth="5" />
          {arcs.map(a => (
            <circle key={a.key} cx="21" cy="21" r="15.9" fill="none" stroke={a.color} strokeWidth="5"
              strokeDasharray={`${a.pct} ${100 - a.pct}`} strokeDashoffset={a.offset} />
          ))}
        </svg>
        <div style={{ minWidth: 0 }}>
          <div className="sb-info-label">{t('dashboardOcean.bank_and_cash', { currency })}</div>
          <bdi dir="ltr" className={`sb-dash-cash-total ${total < 0 ? 'is-bad' : ''}`}>{currency} {fmt2(total)}</bdi>
        </div>
      </div>
      <ul className="sb-dash-cash-list">
        {accounts.map(b => {
          const other = (b.currency || currency) !== currency;
          return (
            <li key={b.id}>
              <i style={{ background: other ? SLATE : colorOf(b.id) }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="sb-dash-ellipsis" style={{ display: 'block', fontWeight: 600 }}>{b.name}</span>
                <span className="sb-fx-name">{b.account_type === 'bank' ? t('dashboardOcean.bank') : t('dashboardOcean.cash')}{other ? ` · ${t('dashboardOcean.not_in_total')}` : ''}</span>
              </span>
              <bdi dir="ltr" className={`sb-dash-num ${b.balance < 0 ? 'is-bad' : ''}`}>{b.currency} {fmt2(b.balance)}</bdi>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ── 4. Watchlist ────────────────────────────────────────────────────────
export function WatchlistCard({ data }: { data: DashboardCards }) {
  const { t } = useTranslation();
  if (data.watchlist.length === 0) {
    return (
      <Card icon={<ShieldCheck size={18} />} title={t('dashboardOcean.watchlist')} hint={t('dashboardOcean.watch_hint')}>
        <div className="sb-dash-allclear">
          <ShieldCheck size={28} aria-hidden="true" />
          <strong>{t('dashboardOcean.all_clear')}</strong>
          <span className="sb-fx-name">{t('dashboardOcean.none_overdrawn')}</span>
        </div>
      </Card>
    );
  }
  return (
    <Card icon={<ShieldAlert size={18} />} title={t('dashboardOcean.watchlist')} hint={t('dashboardOcean.overdrawn_count', { count: data.watchlist.length })}>
      <ul className="sb-dash-watch">
        {data.watchlist.map((w) => (
          <li key={w.id}>
            <span className="sb-pill sb-pill-bad" style={{ marginTop: 0 }}>{t('dashboardOcean.overdrawn')}</span>
            <span className="sb-dash-ellipsis" style={{ flex: 1, fontWeight: 600 }}>{w.name}</span>
            <bdi dir="ltr" className="sb-dash-num is-bad">{fmt2(w.balance)}</bdi>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ── Loading / error states for the whole block ───────────────────────────
export function SummaryCardsState({ q }: { q: ReturnType<typeof useDashboardCards> }) {
  const { t } = useTranslation();
  if (q.isLoading) return <div className="sb-card sb-empty">{t('dashboardOcean.cards_loading')}</div>;
  const msg = q.error instanceof Error ? q.error.message : t('dashboardOcean.no_data_returned');
  return (
    <div className="sb-alert sb-alert-danger" role="alert" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ flex: 1 }}>
        <strong style={{ display: 'block' }}>{t('dashboardOcean.cards_failed')}</strong>
        <span style={{ fontWeight: 400 }}>{msg}</span>
      </span>
      <button type="button" className="sb-secondary-btn" onClick={() => q.refetch()}>{t('dashboardOcean.retry')} <ChevronRight size={16} className="sb-flip" aria-hidden="true" /></button>
    </div>
  );
}
