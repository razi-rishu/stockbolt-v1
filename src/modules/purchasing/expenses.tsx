/**
 * Expenses — Phase 21b: bento-grid overview + full list.
 *
 * Lives under /purchasing/expenses (Zoho parity — expenses sit in the
 * purchasing module, not banking, since they're vendor-side transactions).
 *
 * Layout:
 *   - Bento grid of summary tiles (this-month spend with a 6-month spark,
 *     total/draft/input-VAT stats, top categories, recent expenses, and a
 *     New-expense action tile). All values are derived from the expense list
 *     plus a category breakdown — no new migration needed.
 *   - The existing filter pills + full table stay below, untouched, so nothing
 *     is lost.
 */
import { useMemo, useState } from 'react';
import { formatDate, formatCurrency } from '@/lib/locale';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useCompanyCurrency } from '@/hooks/use-company-currency';
import { Button } from '@/ui/button';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import { StatusBadge } from '@/ui/status-badge';
import type { ExpenseRow, CoaRow } from '@/data/adapter';

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function monthKey(d: Date) { return d.toISOString().slice(0, 7); }
function addMonths(d: Date, n: number) { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 14px',
        borderRadius: '999px',
        fontSize: '12px', fontWeight: 600,
        border: active ? `1px solid ${theme.brand}` : `1px solid ${theme.border}`,
        background: active ? theme.brand : '#fff',
        color: active ? '#fff' : theme.inkMuted,
        cursor: 'pointer',
        transition: 'background-color .12s, color .12s',
      }}
    >{label}</button>
  );
}

/** Shared bento tile shell. */
function Tile({ span = 1, rows = 1, style, children }: { span?: number; rows?: number; style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <div style={{
      gridColumn: `span ${span}`, gridRow: `span ${rows}`,
      background: '#fff', border: `1px solid ${theme.border}`,
      borderRadius: theme.radiusLg, padding: '14px 16px',
      boxShadow: theme.shadowSm, display: 'flex', flexDirection: 'column',
      minWidth: 0, ...style,
    }}>{children}</div>
  );
}

function TileLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: '12px', fontWeight: 600, color: theme.inkMuted, display: 'flex', alignItems: 'center', gap: '6px' }}>{children}</div>;
}

type Filter = 'all' | 'draft' | 'confirmed' | 'void' | 'this_month';

export default function ExpensesPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  const currency = useCompanyCurrency();
  const [filter, setFilter] = useState<Filter>('all');

  const { data: expenses = [], isLoading } = useQuery<ExpenseRow[]>({
    queryKey: ['expenses', company_id],
    queryFn:  () => getAdapter().expenses.list(company_id!),
    enabled:  !!company_id,
  });
  const { data: categoryRows = [] } = useQuery({
    queryKey: ['expense_category_breakdown', company_id],
    queryFn:  () => getAdapter().expenses.categoryBreakdown(company_id!),
    enabled:  !!company_id,
  });
  const { data: coa = [] } = useQuery<CoaRow[]>({
    queryKey: ['coa', company_id],
    queryFn:  () => getAdapter().coa.list(company_id!),
    enabled:  !!company_id,
  });

  const money = (n: number) => formatCurrency(n, currency);

  // ── Bento metrics, all derived from the loaded data ──────────────────────
  const m = useMemo(() => {
    const now = new Date();
    const thisM = monthKey(now);
    const lastM = monthKey(addMonths(now, -1));
    const confirmed = expenses.filter(e => e.status === 'confirmed');
    const dateStr = (e: ExpenseRow) => String(e.date);

    const thisMonth = confirmed.filter(e => dateStr(e).startsWith(thisM));
    const lastMonth = confirmed.filter(e => dateStr(e).startsWith(lastM));
    const sum = (rows: ExpenseRow[], k: 'total_amount' | 'tax_amount') => rows.reduce((s, e) => s + Number(e[k] ?? 0), 0);

    const thisMonthSpend = sum(thisMonth, 'total_amount');
    const lastMonthSpend = sum(lastMonth, 'total_amount');
    const delta = lastMonthSpend > 0 ? Math.round(((thisMonthSpend - lastMonthSpend) / lastMonthSpend) * 100) : null;

    const drafts = expenses.filter(e => e.status === 'draft');

    // 6-month spend spark (oldest → newest)
    const spark = [...Array(6)].map((_, i) => {
      const key = monthKey(addMonths(now, -(5 - i)));
      return confirmed.filter(e => dateStr(e).startsWith(key)).reduce((s, e) => s + Number(e.total_amount ?? 0), 0);
    });

    return {
      thisMonthSpend, thisMonthCount: thisMonth.length, delta,
      totalCount: expenses.length, lifetimeSpend: sum(confirmed, 'total_amount'),
      draftCount: drafts.length, draftValue: drafts.reduce((s, e) => s + Number(e.total_amount ?? 0), 0),
      inputVat: sum(thisMonth, 'tax_amount'),
      spark, sparkMax: Math.max(1, ...spark),
      recent: expenses.slice(0, 4),
    };
  }, [expenses]);

  // Top categories — join the account-id breakdown to CoA names.
  const categories = useMemo(() => {
    const nameOf = new Map(coa.map(c => [c.id, c.name]));
    const total = categoryRows.reduce((s, r) => s + r.amount, 0);
    return {
      total,
      top: categoryRows.slice(0, 4).map(r => ({
        name: nameOf.get(r.account_id) ?? '—',
        amount: r.amount,
        pct: total > 0 ? Math.round((r.amount / total) * 100) : 0,
      })),
    };
  }, [categoryRows, coa]);

  const filtered = useMemo(() => {
    if (filter === 'all') return expenses;
    if (filter === 'this_month') {
      const month = new Date().toISOString().slice(0, 7);
      return expenses.filter(e => (e.date as unknown as string).startsWith(month));
    }
    return expenses.filter(e => e.status === filter);
  }, [expenses, filter]);

  const catShades = [theme.brand, '#8b5cf6', '#a78bfa', '#c4b5fd'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title={t('banking.expenses_title')}
        subtitle={`${expenses.length} ${expenses.length === 1 ? 'expense' : 'expenses'}`}
        actions={
          <Link to="/purchasing/expenses/new">
            <Button>+ New expense</Button>
          </Link>
        }
      />

      {/* ── Bento grid overview ─────────────────────────────────────────── */}
      {!isLoading && expenses.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gridAutoRows: 'minmax(92px, auto)', gap: '12px' }}>

          {/* Hero — spend this month + 6-month spark */}
          <Tile span={2} rows={2} style={{ background: theme.brandSoft, border: `1px solid ${theme.purpleBorder}` }}>
            <TileLabel><span>💸</span> <span style={{ color: theme.brandSoftText }}>Spend this month</span></TileLabel>
            <div style={{ fontSize: '30px', fontWeight: 700, color: theme.purple, marginTop: '8px', letterSpacing: '-.01em' }}>{money(m.thisMonthSpend)}</div>
            <div style={{ fontSize: '12px', color: theme.brandSoftText, marginTop: '2px' }}>
              {m.thisMonthCount} {m.thisMonthCount === 1 ? 'expense' : 'expenses'}
              {m.delta !== null && (
                <span style={{ color: m.delta > 0 ? theme.danger : theme.success, fontWeight: 600 }}>
                  {'  '}{m.delta > 0 ? '▲' : '▼'} {Math.abs(m.delta)}% vs last month
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '5px', marginTop: 'auto', height: '40px' }}>
              {m.spark.map((v, i) => (
                <div key={i} title={fmt(v)} style={{
                  flex: 1, height: `${Math.max(6, (v / m.sparkMax) * 100)}%`,
                  background: i === m.spark.length - 1 ? theme.brand : theme.purpleBorder,
                  borderRadius: '3px', transition: 'height .2s',
                }} />
              ))}
            </div>
          </Tile>

          {/* Total expenses */}
          <Tile span={2} style={{ justifyContent: 'center' }}>
            <TileLabel>🧾 Total expenses</TileLabel>
            <div style={{ fontSize: '22px', fontWeight: 700, color: theme.ink, marginTop: '6px' }}>
              {m.totalCount}
              <span style={{ fontSize: '13px', fontWeight: 400, color: theme.inkFaint }}>{'  '}· {money(m.lifetimeSpend)} lifetime</span>
            </div>
          </Tile>

          {/* Drafts pending */}
          <Tile span={1} style={{ background: theme.warnSoft, border: `1px solid ${theme.warnBorder}`, justifyContent: 'center' }}>
            <TileLabel><span style={{ color: theme.warn }}>⏳ Drafts</span></TileLabel>
            <div style={{ fontSize: '22px', fontWeight: 700, color: theme.warn, marginTop: '4px' }}>{m.draftCount}</div>
            <div style={{ fontSize: '11px', color: theme.warn }}>{money(m.draftValue)}</div>
          </Tile>

          {/* Input VAT */}
          <Tile span={1} style={{ justifyContent: 'center' }}>
            <TileLabel>🧮 Input VAT</TileLabel>
            <div style={{ fontSize: '20px', fontWeight: 700, color: theme.ink, marginTop: '4px' }}>{money(m.inputVat)}</div>
            <div style={{ fontSize: '11px', color: theme.inkFaint }}>this month</div>
          </Tile>

          {/* Top categories */}
          <Tile span={2} rows={2}>
            <TileLabel>📊 Top categories</TileLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', marginTop: '10px' }}>
              {categories.top.length === 0 ? (
                <div style={{ fontSize: '12px', color: theme.inkFaint }}>No confirmed spend yet.</div>
              ) : categories.top.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                  <span style={{ width: '90px', color: theme.inkMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                  <div style={{ flex: 1, height: '7px', background: theme.muted, borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: `${c.pct}%`, height: '7px', background: catShades[i] ?? theme.brand, borderRadius: '4px' }} />
                  </div>
                  <span style={{ width: '34px', textAlign: 'end', color: theme.inkFaint }}>{c.pct}%</span>
                </div>
              ))}
            </div>
          </Tile>

          {/* Recent expenses */}
          <Tile span={2} rows={2}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <TileLabel>🕘 Recent expenses</TileLabel>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {m.recent.map((e, i) => (
                <div
                  key={e.id}
                  onClick={() => navigate(`/purchasing/expenses/${e.id}`)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 0', cursor: 'pointer',
                    borderBottom: i < m.recent.length - 1 ? `1px solid ${theme.muted}` : 'none',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '12px', fontFamily: theme.fontMono, color: theme.brandSoftText, fontWeight: 600 }}>{e.expense_number}</div>
                    <div style={{ fontSize: '12px', color: theme.inkMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '170px' }}>{e.description}</div>
                  </div>
                  <div style={{ textAlign: 'end', flexShrink: 0, marginInlineStart: '8px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: theme.ink }}>{fmt(Number(e.total_amount))}</div>
                    <StatusBadge status={e.status} />
                  </div>
                </div>
              ))}
            </div>
          </Tile>

          {/* (Removed the duplicate "New expense" CTA tile — the header
              "+ New expense" button is the single, standard affordance.) */}

        </div>
      )}

      {/* ── Filter pills ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        <FilterPill label="All"        active={filter === 'all'}        onClick={() => setFilter('all')} />
        <FilterPill label="Draft"      active={filter === 'draft'}      onClick={() => setFilter('draft')} />
        <FilterPill label="Confirmed"  active={filter === 'confirmed'}  onClick={() => setFilter('confirmed')} />
        <FilterPill label="Void"       active={filter === 'void'}       onClick={() => setFilter('void')} />
        <FilterPill label="This month" active={filter === 'this_month'} onClick={() => setFilter('this_month')} />
      </div>

      {isLoading ? (
        <p style={{ padding: '48px 0', textAlign: 'center', fontSize: '13px', color: theme.inkFaint }}>
          {t('common.loading')}
        </p>
      ) : filtered.length === 0 ? (
        <p style={{ padding: '48px 0', textAlign: 'center', fontSize: '13px', color: theme.inkFaint }}>
          {filter === 'all'
            ? 'No expenses yet. Click + New to create one.'
            : `No ${filter === 'this_month' ? 'expenses this month' : `${filter} expenses`}.`}
        </p>
      ) : (
        <div
          className="overflow-x-auto bg-white"
          style={{ border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: theme.shadowSm }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}` }}>
                {[
                  { l: 'Number',   a: 'start' as const },
                  { l: 'Date',     a: 'start' as const },
                  { l: 'Description', a: 'start' as const },
                  { l: 'Amount',   a: 'end'   as const },
                  { l: 'Tax',      a: 'end'   as const },
                  { l: 'Total',    a: 'end'   as const },
                  { l: 'Status',   a: 'start' as const },
                  { l: '',         a: 'end'   as const },
                ].map((c, i) => (
                  <th key={i} className="px-4 py-3" style={{
                    fontSize: '11px', fontWeight: 600, color: theme.inkMuted,
                    textTransform: 'uppercase', letterSpacing: '.06em',
                    textAlign: c.a, whiteSpace: 'nowrap',
                  }}>{c.l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((exp, idx) => (
                <tr
                  key={exp.id}
                  onClick={() => navigate(`/purchasing/expenses/${exp.id}`)}
                  className="cursor-pointer"
                  style={{
                    borderTop: idx === 0 ? 'none' : '1px solid #f1f5f9',
                    transition: 'background-color .12s',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.panelHead; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                >
                  <td className="px-4 py-3 font-mono" style={{ fontSize: '12px', color: theme.brandSoftText, fontWeight: 600 }}>
                    {exp.expense_number}
                  </td>
                  <td className="px-4 py-3" style={{ color: theme.inkMuted, fontSize: '13px' }}>{formatDate(exp.date)}</td>
                  <td className="px-4 py-3" style={{ color: theme.ink, fontSize: '13px', maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {exp.description}
                  </td>
                  <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '13px' }}>{fmt(Number(exp.amount))}</td>
                  <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', color: theme.inkMuted, fontSize: '13px' }}>{fmt(Number(exp.tax_amount))}</td>
                  <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '13px', fontWeight: 600 }}>{fmt(Number(exp.total_amount))}</td>
                  <td className="px-4 py-3"><StatusBadge status={exp.status} /></td>
                  <td className="px-4 py-3" style={{ textAlign: 'end' }}>
                    <Link
                      to={`/purchasing/expenses/${exp.id}`}
                      style={{ fontSize: '11px', color: theme.brand, fontWeight: 600, textDecoration: 'none' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t('common.view')} →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
