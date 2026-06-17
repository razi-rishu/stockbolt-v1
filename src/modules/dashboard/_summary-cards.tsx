/**
 * Dashboard summary cards — Phase 13.03.
 *
 * Four cards rendered below the KPI tiles on the owner dashboard:
 *
 *   1. Income vs Expense (12-mo diverging bar chart)
 *   2. Top Expenses (donut + legend, fiscal year)
 *   3. Bank & Cash Accounts (account list with type stripe + balance)
 *   4. Watchlist (auto-populated: overdrawn accounts)
 *
 * Design choices that differ from the Zoho reference:
 *   - Diverging bars (income above zero, expense below) instead of
 *     paired side-by-side bars — easier to read net profit visually.
 *   - Indigo / violet brand gradient for the donut largest slice
 *     instead of green; remaining slices use a warm palette so the
 *     "you're spending here" energy comes through.
 *   - Each bank row gets a coloured left stripe (indigo for bank,
 *     amber for cash) — turns the list into a scannable identity
 *     strip instead of plain text.
 *   - Watchlist is data-driven (overdrawn accounts only) instead of
 *     a manually-starred list. Fewer clicks, more useful by default.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  XAxis, YAxis, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Tooltip, ReferenceLine, BarChart, Bar,
} from 'recharts';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { theme } from '@/ui/theme';
import type { DashboardCards } from '@/data/adapter';

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
function monthLabel(yyyymm: string) {
  // YYYY-MM → "Jan" / "Dec '25"
  const [y, m] = yyyymm.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString('en-US', { month: 'short' });
}

// ── Card shell ───────────────────────────────────────────────────────────
function Card({ title, hint, children, right }: {
  title: string; hint?: string; children: React.ReactNode; right?: React.ReactNode;
}) {
  return (
    <div style={{
      background: theme.card,
      border: `1px solid ${theme.border}`,
      borderRadius: '12px',
      boxShadow: theme.shadowSm,
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        padding: '14px 18px',
        borderBottom: `1px solid ${theme.border}`,
        display: 'flex', alignItems: 'center', gap: '8px',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{
            margin: 0,
            fontSize: '11px', fontWeight: 700,
            color: theme.inkMuted,
            textTransform: 'uppercase', letterSpacing: '.06em',
          }}>{title}</h3>
          {hint && (
            <p style={{ margin: '4px 0 0', fontSize: '11px', color: theme.inkFaint }}>{hint}</p>
          )}
        </div>
        {right}
      </div>
      <div style={{ padding: '16px 18px', flex: 1 }}>{children}</div>
    </div>
  );
}

// ── 1. Income vs Expense (12-mo diverging bars) ─────────────────────────
function IncomeExpenseCard({ data }: { data: DashboardCards }) {
  const totalIncome  = data.monthly_pl.reduce((s, r) => s + r.income,  0);
  const totalExpense = data.monthly_pl.reduce((s, r) => s + r.expense, 0);
  const net = totalIncome - totalExpense;

  // Recharts data — expense is plotted as a NEGATIVE value so the bar
  // hangs below the zero baseline. Visually you see income above and
  // expense below; the gap between them at zero is the profit/loss.
  const chartData = data.monthly_pl.map(r => ({
    month: monthLabel(r.month),
    income: r.income,
    expense: -r.expense,
  }));

  return (
    <Card
      title="Income vs Expense"
      hint="Last 12 months · diverging bars · accrual basis"
      right={
        <div style={{ textAlign: 'end' }}>
          <div style={{ fontSize: '10px', color: theme.inkFaint, textTransform: 'uppercase', letterSpacing: '.05em' }}>Net</div>
          <div style={{
            fontFamily: theme.fontMono, fontSize: '14px', fontWeight: 700,
            color: net >= 0 ? theme.success : theme.danger,
          }}>
            {net >= 0 ? '+' : ''}{fmtCompact(net)}
          </div>
        </div>
      }
    >
      {/* Inline totals chip */}
      <div style={{ display: 'flex', gap: '20px', marginBottom: '8px', fontSize: '12px' }}>
        <span>
          <span style={{ display: 'inline-block', width: '10px', height: '10px', background: theme.brand, borderRadius: '2px', marginInlineEnd: '6px', verticalAlign: 'middle' }} />
          <span style={{ color: theme.inkMuted }}>Income </span>
          <span className="font-mono" style={{ color: theme.ink, fontWeight: 600 }}>{fmt(totalIncome)}</span>
        </span>
        <span>
          <span style={{ display: 'inline-block', width: '10px', height: '10px', background: '#94a3b8', borderRadius: '2px', marginInlineEnd: '6px', verticalAlign: 'middle' }} />
          <span style={{ color: theme.inkMuted }}>Expense </span>
          <span className="font-mono" style={{ color: theme.ink, fontWeight: 600 }}>{fmt(totalExpense)}</span>
        </span>
      </div>
      <ResponsiveContainer width="100%" height={196} minWidth={0}>
        <BarChart data={chartData} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="month" axisLine={false} tickLine={false}
            tick={{ fontSize: 10, fill: theme.inkFaint }}
          />
          <YAxis
            tickFormatter={(v) => fmtCompact(Math.abs(Number(v)))}
            tick={{ fontSize: 10, fill: theme.inkFaint }}
            axisLine={false} tickLine={false} width={36}
          />
          <ReferenceLine y={0} stroke="#1e293b" strokeWidth={1} />
          <Tooltip
            contentStyle={{ borderRadius: 8, border: `1px solid ${theme.border}`, fontSize: 12 }}
            formatter={(v, name) => [fmt2(Math.abs(Number(v ?? 0))), name === 'income' ? 'Income' : 'Expense']}
            labelFormatter={(l) => `${l}`}
          />
          <Bar dataKey="income"  fill={theme.brand}  radius={[3, 3, 0, 0]} />
          <Bar dataKey="expense" fill="#94a3b8" radius={[0, 0, 3, 3]} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

// ── 2. Top Expenses (donut) ─────────────────────────────────────────────
// Distinct hues so each expense category is easy to tell apart at a glance
// (violet · sky · amber · emerald · red · pink · teal · purple). "Others"
// always gets a muted slate so it reads as the catch-all.
const DONUT_PALETTE = ['#7c3aed', '#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#ec4899', '#14b8a6', '#a855f7'];
const OTHERS_COLOR = '#94a3b8';

function TopExpensesCard({ data }: { data: DashboardCards }) {
  const slices = [
    ...data.top_expenses.map((e, i) => ({
      name: e.account_name, code: e.account_code, value: e.amount, color: DONUT_PALETTE[i % DONUT_PALETTE.length],
    })),
    ...(data.top_expenses_others > 0.005 ? [{
      name: 'Others', code: '', value: data.top_expenses_others, color: OTHERS_COLOR,
    }] : []),
  ];
  const total = data.top_expenses_total;

  if (slices.length === 0) {
    return (
      <Card title="Top Expenses" hint="This fiscal year">
        <div style={{ padding: '40px 0', textAlign: 'center', fontSize: '12px', color: theme.inkFaint }}>
          No expense activity yet this fiscal year.
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="Top Expenses"
      hint="Fiscal year to date"
      right={
        <div style={{ textAlign: 'end' }}>
          <div style={{ fontSize: '10px', color: theme.inkFaint, textTransform: 'uppercase', letterSpacing: '.05em' }}>Total</div>
          <div style={{ fontFamily: theme.fontMono, fontSize: '14px', fontWeight: 700, color: theme.ink }}>
            {fmtCompact(total)}
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {/* Donut on the left */}
        <div style={{ position: 'relative', width: '156px', height: '156px', flexShrink: 0 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                innerRadius={48}
                outerRadius={72}
                paddingAngle={2}
                stroke="none"
              >
                {slices.map((s, i) => <Cell key={i} fill={s.color} />)}
              </Pie>
              <Tooltip
                contentStyle={{ borderRadius: 8, border: `1px solid ${theme.border}`, fontSize: 12 }}
                formatter={(v) => fmt2(Number(v ?? 0))}
              />
            </PieChart>
          </ResponsiveContainer>
          {/* Center label */}
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
          }}>
            <div style={{ fontSize: '10px', color: theme.inkFaint, textTransform: 'uppercase', letterSpacing: '.06em' }}>All</div>
            <div className="font-mono" style={{ fontSize: '14px', fontWeight: 700, color: theme.ink }}>
              {fmtCompact(total)}
            </div>
          </div>
        </div>

        {/* Legend */}
        <ul style={{ flex: 1, margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {slices.map((s, i) => {
            const pct = total > 0 ? (s.value / total) * 100 : 0;
            return (
              <li key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                <span style={{ display: 'inline-block', width: '10px', height: '10px', background: s.color, borderRadius: '999px', flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: theme.ink }}>
                  {s.name}
                </span>
                <span className="font-mono" style={{ color: theme.inkMuted, fontSize: '11px' }}>{pct.toFixed(0)}%</span>
                <span className="font-mono" style={{ color: theme.ink, fontWeight: 500, minWidth: '60px', textAlign: 'end' }}>
                  {fmtCompact(s.value)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}

// ── 3. Bank & Cash Accounts ─────────────────────────────────────────────
function BankAccountsCard({ data }: { data: DashboardCards }) {
  if (data.bank_balances.length === 0) {
    return (
      <Card title="Bank & Cash">
        <div style={{ padding: '40px 0', textAlign: 'center', fontSize: '12px', color: theme.inkFaint }}>
          No bank accounts configured.{' '}
          <Link to="/settings/bank-accounts" style={{ color: theme.brand, fontWeight: 600 }}>Add one →</Link>
        </div>
      </Card>
    );
  }
  return (
    <Card
      title="Bank & Cash Accounts"
      hint={`${data.bank_balances.length} account${data.bank_balances.length === 1 ? '' : 's'}`}
      right={
        <Link to="/settings/bank-accounts" style={{ fontSize: '11px', color: theme.brand, fontWeight: 600, textDecoration: 'none' }}>
          Manage →
        </Link>
      }
    >
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {data.bank_balances.map((b) => {
          const isBank = b.account_type === 'bank';
          const stripeColor = isBank ? theme.brand : theme.warn;
          return (
            <li key={b.id} style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '8px 10px',
              background: theme.page,
              border: `1px solid ${theme.border}`,
              borderRadius: '8px',
              borderInlineStartWidth: '4px',
              borderInlineStartColor: stripeColor,
              borderInlineStartStyle: 'solid',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: theme.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.name}
                </div>
                <div style={{ fontSize: '11px', color: theme.inkFaint, textTransform: 'capitalize' }}>
                  {b.account_type} · {b.currency}
                </div>
              </div>
              <div className="font-mono" style={{
                fontSize: '13px', fontWeight: 700,
                color: b.balance < 0 ? theme.danger : theme.ink,
                whiteSpace: 'nowrap',
              }}>
                {b.currency} {fmt2(b.balance)}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ── 4. Watchlist ────────────────────────────────────────────────────────
function WatchlistCard({ data }: { data: DashboardCards }) {
  if (data.watchlist.length === 0) {
    return (
      <Card title="Watchlist" hint="Auto-populated · overdrawn accounts">
        <div style={{ padding: '32px 0', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ fontSize: '24px' }}>✅</div>
          <div style={{ fontSize: '12px', color: theme.success, fontWeight: 600 }}>All clear</div>
          <div style={{ fontSize: '11px', color: theme.inkFaint }}>No accounts are overdrawn.</div>
        </div>
      </Card>
    );
  }
  return (
    <Card
      title="Watchlist"
      hint={`${data.watchlist.length} overdrawn account${data.watchlist.length === 1 ? '' : 's'}`}
    >
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {data.watchlist.map((w) => (
          <li key={w.id} style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '8px 10px',
            background: theme.dangerSoft,
            border: `1px solid ${theme.dangerBorder}`,
            borderRadius: '8px',
          }}>
            <span style={{
              fontSize: '11px', fontWeight: 700,
              color: theme.danger, background: '#fff',
              border: `1px solid ${theme.dangerBorder}`,
              padding: '2px 7px', borderRadius: '999px',
              textTransform: 'uppercase', letterSpacing: '.04em',
              whiteSpace: 'nowrap',
            }}>Overdrawn</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: theme.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {w.name}
              </div>
            </div>
            <div className="font-mono" style={{ fontSize: '13px', fontWeight: 700, color: theme.danger, whiteSpace: 'nowrap' }}>
              {fmt2(w.balance)}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ── Public block — 2x2 grid ─────────────────────────────────────────────
export default function DashboardSummaryCards() {
  const company_id = useAuthStore(s => s.company_id);
  const { data, isLoading, isError, error, refetch } = useQuery<DashboardCards>({
    queryKey: ['dashboard_cards', company_id],
    queryFn:  () => getAdapter().reports.getDashboardCards(company_id!),
    enabled:  !!company_id,
  });

  // Loading state — actually loading (no data + no error yet).
  if (isLoading) {
    return (
      <div style={{ padding: '24px 0', fontSize: '13px', color: theme.inkFaint, textAlign: 'center' }}>
        Loading dashboard cards…
      </div>
    );
  }

  // Error state — surface what went wrong so the user / I can debug.
  // Previously this branch fell through to the loading message and the
  // section appeared to hang forever.
  if (isError || !data) {
    const msg = error instanceof Error ? error.message : 'No data returned.';
    return (
      <div style={{
        background: theme.dangerSoft, border: `1px solid ${theme.dangerBorder}`,
        borderRadius: '12px', padding: '14px 18px',
        display: 'flex', alignItems: 'center', gap: '12px',
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: theme.danger, textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Dashboard cards failed to load
          </div>
          <div style={{ marginTop: '2px', fontSize: '12px', color: theme.danger, opacity: .85 }}>{msg}</div>
        </div>
        <button
          onClick={() => refetch()}
          style={{
            background: '#fff', border: `1px solid ${theme.dangerBorder}`,
            color: theme.danger, fontSize: '12px', fontWeight: 600,
            padding: '6px 12px', borderRadius: '6px', cursor: 'pointer',
          }}
        >Retry</button>
      </div>
    );
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 330px), 1fr))',
      gap: '16px',
    }}>
      <IncomeExpenseCard data={data} />
      <TopExpensesCard data={data} />
      <BankAccountsCard data={data} />
      <WatchlistCard data={data} />
    </div>
  );
}

