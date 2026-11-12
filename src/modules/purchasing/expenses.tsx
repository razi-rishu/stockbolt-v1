/**
 * Expenses — Phase 21b overview + full list.
 *
 * Lives under /purchasing/expenses (Zoho parity — expenses sit in the
 * purchasing module, not banking, since they're vendor-side transactions).
 *
 * Layout:
 *   - Summary tiles (this-month spend with a 6-month spark, total, drafts,
 *     input tax), top categories and recent expenses. All values are derived
 *     from the expense list plus a category breakdown — no new migration.
 *   - Filter chips + the full list below.
 *
 * Ocean Teal (UI v1.1): look only — same figures, filters and rows as before.
 */
import { useMemo, useState } from 'react';
import { formatDate, formatCurrency } from '@/lib/locale';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useCompanyCurrency, useTaxName } from '@/hooks/use-company-currency';
import type { Column } from '@/ui/table';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import { Plus, Wallet, ReceiptText, Hourglass, Calculator } from 'lucide-react';
import { StatusBadge } from '@/ui/status-badge';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { VoidedToggle } from '@/ui/voided-toggle';
import { useHideVoided } from '@/hooks/use-hide-voided';
import type { ExpenseRow, CoaRow } from '@/data/adapter';

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function monthKey(d: Date) { return d.toISOString().slice(0, 7); }
function addMonths(d: Date, n: number) { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }

type Filter = 'all' | 'draft' | 'confirmed' | 'void' | 'this_month';

export default function ExpensesPage() {
  const taxName = useTaxName();   // GST for India, VAT for the GCC
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  const currency = useCompanyCurrency();
  const [filter, setFilter] = useState<Filter>('all');
  const { hideVoided, setHideVoided } = useHideVoided('stockbolt.list.expenses.voided');
  // Phase 47c — period filter (default All time = show every expense).
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.list.expenses.period', 'all_time');

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

  // ── Overview metrics, all derived from the loaded data ───────────────────
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
    let rows = expenses;
    if (from) rows = rows.filter(e => (e.date as unknown as string) >= from);
    if (to)   rows = rows.filter(e => (e.date as unknown as string) <= to);
    if (filter === 'this_month') {
      const month = new Date().toISOString().slice(0, 7);
      rows = rows.filter(e => (e.date as unknown as string).startsWith(month));
    } else if (filter !== 'all') {
      rows = rows.filter(e => e.status === filter);
    }
    // Z4 — hidden on the All and This-month views. Picking the Void chip
    // is already an explicit request to see them.
    if (hideVoided && filter !== 'void') rows = rows.filter(e => e.status !== 'void');
    return rows;
  }, [expenses, filter, from, to, hideVoided]);
  const voidedCount = expenses.filter(e => e.status === 'void').length;

  const catShades = ['var(--sb-primary)', '#26A69A', '#4DB6AC', '#80CBC4'];

  const columns: Column<ExpenseRow>[] = [
    { key: 'no', header: t('purchOcean.exp_number'), render: (e) => <bdi dir="ltr" className="sb-inv-no">{e.expense_number}</bdi> },
    { key: 'date', header: t('common.date'), render: (e) => <bdi dir="ltr">{formatDate(e.date)}</bdi> },
    { key: 'desc', header: t('common.description'), render: (e) => <span className="sb-dash-ellipsis" style={{ fontWeight: 600, display: 'block', maxWidth: 320 }}>{e.description || '—'}</span> },
    { key: 'amt', header: t('purchasing.amount'), align: 'end', render: (e) => <bdi dir="ltr">{fmt(Number(e.amount))}</bdi> },
    { key: 'tax', header: t('common.tax'), align: 'end', render: (e) => <bdi dir="ltr">{fmt(Number(e.tax_amount))}</bdi> },
    { key: 'total', header: t('common.total'), align: 'end', render: (e) => <bdi dir="ltr" className="sb-dash-num">{fmt(Number(e.total_amount))}</bdi> },
    { key: 'status', header: '', render: (e) => <StatusBadge status={e.status} /> },
  ];

  const emptyMessage = filter === 'all'
    ? t('purchOcean.exp_empty')
    : filter === 'this_month'
    ? t('purchOcean.exp_empty_month')
    : t('purchOcean.exp_empty_status', { status: t(`docStatus.${filter}`) });

  return (
    <OceanPage
      testid="expenses-ocean"
      title={t('banking.expenses_title')}
      subtitle={t('purchOcean.expenses_count', { count: expenses.length })}
      actions={<>
        <PeriodPicker mode="range" allowAllTime preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => navigate('/purchasing/expenses/new')}><Plus size={18} aria-hidden="true" />{t('purchOcean.new_expense')}</button>
      </>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* ── Overview ─────────────────────────────────────────────────── */}
        {!isLoading && expenses.length > 0 && (
          <>
            {/* Compact summary chips — same four figures as before. */}
            <div className="sb-exp-kpis" data-testid="expenses-kpis">
              <div className="sb-exp-kpi is-hero">
                <span className="sb-exp-kpi-ico" aria-hidden="true"><Wallet size={17} /></span>
                <div className="sb-exp-kpi-txt">
                  <span className="sb-exp-kpi-label">{t('purchOcean.spend_month')}</span>
                  <span className="sb-exp-kpi-val">
                    <bdi dir="ltr">{money(m.thisMonthSpend)}</bdi>
                    {m.delta !== null && (
                      <span className="sb-exp-delta" title={t('purchOcean.vs_last_month')}><bdi dir="ltr">{m.delta > 0 ? '▲' : '▼'} {Math.abs(m.delta)}%</bdi></span>
                    )}
                  </span>
                  <span className="sb-exp-kpi-sub" style={{ color: '#D7F4F1' }}>{t('purchOcean.expenses_count', { count: m.thisMonthCount })}</span>
                </div>
                <span className="sb-exp-spark" dir="ltr" aria-hidden="true">
                  {m.spark.map((v, i) => <i key={i} title={fmt(v)} style={{ height: `${Math.max(15, (v / m.sparkMax) * 100)}%` }} />)}
                </span>
              </div>
              <div className="sb-exp-kpi">
                <span className="sb-exp-kpi-ico" aria-hidden="true"><ReceiptText size={17} /></span>
                <div className="sb-exp-kpi-txt">
                  <span className="sb-exp-kpi-label">{t('purchOcean.total_expenses')}</span>
                  <span className="sb-exp-kpi-val">{m.totalCount}</span>
                  <span className="sb-exp-kpi-sub">{t('purchOcean.lifetime', { amount: money(m.lifetimeSpend) })}</span>
                </div>
              </div>
              <div className="sb-exp-kpi">
                <span className={`sb-exp-kpi-ico ${m.draftCount > 0 ? 'is-warn' : ''}`} aria-hidden="true"><Hourglass size={17} /></span>
                <div className="sb-exp-kpi-txt">
                  <span className="sb-exp-kpi-label">{t('purchOcean.drafts')}</span>
                  <span className={`sb-exp-kpi-val ${m.draftCount > 0 ? 'is-warn' : ''}`}>{m.draftCount}</span>
                  <bdi dir="ltr" className="sb-exp-kpi-sub" style={{ textAlign: 'start' }}>{money(m.draftValue)}</bdi>
                </div>
              </div>
              <div className="sb-exp-kpi">
                <span className="sb-exp-kpi-ico" aria-hidden="true"><Calculator size={17} /></span>
                <div className="sb-exp-kpi-txt">
                  <span className="sb-exp-kpi-label">{t('common.input_tax', { tax: taxName })}</span>
                  <bdi dir="ltr" className="sb-exp-kpi-val">{money(m.inputVat)}</bdi>
                  <span className="sb-exp-kpi-sub">{t('purchOcean.this_month')}</span>
                </div>
              </div>
            </div>

            <div className="sb-dash-row">
              <div className="sb-card sb-dash-card">
                <div className="sb-dash-card-head"><h2 className="sb-dash-card-title">{t('purchOcean.top_categories')}</h2></div>
                <div className="sb-dash-card-body">
                  {categories.top.length === 0 ? (
                    <div className="sb-dash-empty">{t('purchOcean.no_spend')}</div>
                  ) : (
                    <ul className="sb-dash-low">
                      {categories.top.map((c, i) => (
                        <li key={i}>
                          <div className="sb-dash-low-row" style={{ justifyContent: 'space-between' }}>
                            <span className="sb-dash-ellipsis" style={{ fontSize: 13 }}>{c.name}</span>
                            <bdi dir="ltr" className="sb-fx-name" style={{ fontSize: 12 }}>{c.pct}%</bdi>
                          </div>
                          <span className="sb-dash-bar" style={{ background: 'var(--sb-primary-soft)' }}>
                            <i style={{ width: `${c.pct}%`, background: catShades[i] ?? 'var(--sb-primary)' }} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="sb-card sb-dash-card">
                <div className="sb-dash-card-head"><h2 className="sb-dash-card-title">{t('purchOcean.recent')}</h2></div>
                <div className="sb-dash-card-body" style={{ gap: 0 }}>
                  {m.recent.map((e, i) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => navigate(`/purchasing/expenses/${e.id}`)}
                      className="sb-inv-row"
                      style={{ borderBottom: i < m.recent.length - 1 ? '1px solid var(--sb-border)' : 'none', borderRadius: 0, paddingInline: 0 }}
                    >
                      <span className="sb-inv-row-top">
                        <bdi dir="ltr" className="sb-inv-no">{e.expense_number}</bdi>
                        <StatusBadge status={e.status} />
                      </span>
                      <span className="sb-inv-row-mid">
                        <span className="sb-dash-ellipsis sb-fx-name">{e.description || '—'}</span>
                        <bdi dir="ltr" className="sb-inv-amt">{fmt(Number(e.total_amount))}</bdi>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── Filter chips ─────────────────────────────────────────────── */}
        <div className="sb-chips" style={{ marginTop: 0 }} role="group" aria-label={t('common.status')}>
          {(['all', 'draft', 'confirmed', 'void', 'this_month'] as Filter[]).map(f => (
            <button key={f} type="button" aria-pressed={filter === f} className={`sb-chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? t('common.all') : f === 'this_month' ? t('purchOcean.this_month_chip') : t(`docStatus.${f}`)}
            </button>
          ))}
          {filter !== 'void' && (
            <VoidedToggle hideVoided={hideVoided} onChange={setHideVoided} count={voidedCount} />
          )}
        </div>

        {isLoading
          ? <div className="sb-card sb-empty">{t('common.loading')}</div>
          : <OceanTable columns={columns} rows={filtered} keyFn={(e) => e.id} cardTitleKey="desc"
              onRowClick={(e) => navigate(`/purchasing/expenses/${e.id}`)} rowMuted={(e) => e.status === 'void'} emptyMessage={emptyMessage} />}
      </div>
    </OceanPage>
  );
}
