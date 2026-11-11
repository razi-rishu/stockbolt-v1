/**
 * Account statement, Ocean Teal design (UI v1.1) — shared by the customer
 * and supplier detail pages.
 *
 * Layout (compared with Zoho Books, QuickBooks, Xero, Odoo, Tally):
 *   toolbar      period chips + custom dates, Print, PDF
 *   view switch  Transactions (balance-forward ledger) | Outstanding (open items)
 *   summary      Opening · Invoiced/Billed · Payments and credits · Balance due,
 *                with Overdue / Not yet due / Credit on file underneath
 *   ledger       date, transaction (opens the document), amount, payments,
 *                running balance; opening and closing rows
 *
 * Presentation only. The page computes the statement lines and their running
 * balance exactly as before (same reversed / advance-application rules) and
 * passes them in un-searched; search here only hides rows, so the summary and
 * every running balance stay true. Totals are sums of those same lines:
 * opening + amount − payments = balance due, always.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Printer, Download, Search, CalendarDays, TriangleAlert, MoreHorizontal } from 'lucide-react';
import { formatDate } from '@/lib/locale';
import { DocLink } from '@/ui/doc-link';
import type { PeriodPreset, SpineLine } from './components';
import '@/styles/stockbolt-ocean-teal.css';

export interface OutstandingDoc {
  id: string;
  number: string;
  date: string;
  due_date: string | null;
  total: number;
  outstanding: number;
  to: string;
}

export interface StatementOceanProps {
  side: 'customer' | 'supplier';
  currency: string;
  loading: boolean;
  preset: PeriodPreset;
  onPreset: (p: PeriodPreset) => void;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  hideReversed: boolean;
  onHideReversed: (v: boolean) => void;
  search: string;
  onSearch: (v: string) => void;
  openingBalance: number;
  /** All lines for the period (hide-reversed already applied, NOT searched),
   *  each with its running balance. */
  lines: SpineLine[];
  closingBalance: number;
  outstanding: OutstandingDoc[];
  overdue: number;
  creditOnFile: number;
  onPrint: () => void;
  pdfUrl: string;
  fmt: (n: number) => string;
}

const today = () => new Date().toISOString().slice(0, 10);
const daysPast = (due: string | null) => (due ? Math.floor((Date.parse(today()) - Date.parse(due)) / 86_400_000) : 0);

export function StatementOcean(p: StatementOceanProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [view, setView] = useState<'transactions' | 'outstanding'>('transactions');
  const [menuOpen, setMenuOpen] = useState(false);
  const { fmt, currency: ccy } = p;
  const supplier = p.side === 'supplier';

  // Which ledger column is the "amount" (invoice / bill) and which the payment.
  const amountOf  = (l: SpineLine) => (supplier ? l.credit : l.debit);
  const paymentOf = (l: SpineLine) => (supplier ? l.debit : l.credit);
  const live = p.lines.filter(l => !l.dimmed);
  const invoiced = live.reduce((s, l) => s + amountOf(l), 0);
  const paid     = live.reduce((s, l) => s + paymentOf(l), 0);
  const notYetDue = Math.max(p.outstanding.reduce((s, d) => s + d.outstanding, 0) - p.overdue, 0);

  const q = p.search.trim().toLowerCase();
  const shown = q
    ? p.lines.filter(l => `${l.doc_number ?? ''} ${l.doc_type ?? ''} ${l.reference ?? ''}`.toLowerCase().includes(q))
    : p.lines;
  const shownOutstanding = q
    ? p.outstanding.filter(d => d.number.toLowerCase().includes(q))
    : p.outstanding;

  const chips: { id: PeriodPreset; label: string }[] = [
    { id: 'last_30',   label: t('statementView.last_30') },
    { id: 'last_90',   label: t('statementView.last_90') },
    { id: 'this_year', label: t('statementView.this_year') },
    { id: 'last_year', label: t('statementView.last_year') },
    { id: 'all',       label: t('statementView.all_time') },
  ];
  const money = (n: number) => <bdi dir="ltr">{ccy} {fmt(n)}</bdi>;
  const num = (n: number) => <bdi dir="ltr">{fmt(n)}</bdi>;
  const amountLabel = supplier ? t('statementView.billed') : t('statementView.invoiced');

  return (
    <div className="sb-stmt" data-testid="statement-ocean">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="sb-stmt-bar" data-print-hide>
        <div className="sb-chips" role="group" aria-label={t('statementView.period')}>
          {chips.map(c => (
            <button key={c.id} type="button" aria-pressed={p.preset === c.id}
              className={`sb-chip ${p.preset === c.id ? 'active' : ''}`} onClick={() => p.onPreset(c.id)}>
              {c.label}
            </button>
          ))}
          <button type="button" aria-pressed={p.preset === 'custom'}
            className={`sb-chip ${p.preset === 'custom' ? 'active' : ''}`} onClick={() => p.onPreset('custom')}>
            <CalendarDays size={15} aria-hidden="true" />{t('statementView.custom')}
          </button>
        </div>
        <div className="sb-stmt-actions">
          <button type="button" className="sb-secondary-btn" onClick={p.onPrint}>
            <Printer size={17} aria-hidden="true" />{t('statementView.print')}
          </button>
          <button type="button" className="sb-primary-btn" onClick={() => window.open(p.pdfUrl, '_blank')}>
            <Download size={17} aria-hidden="true" />{t('statementView.pdf')}
          </button>
        </div>
      </div>

      {p.preset === 'custom' && (
        <div className="sb-stmt-dates" data-print-hide>
          <label>{t('statementView.from')}<input type="date" className="sb-field" value={p.from} onChange={e => p.onFrom(e.target.value)} /></label>
          <label>{t('statementView.to')}<input type="date" className="sb-field" value={p.to} onChange={e => p.onTo(e.target.value)} /></label>
        </div>
      )}

      <div className="sb-stmt-row" data-print-hide>
        <div className="sb-seg" role="tablist" aria-label={t('statementView.view')}>
          <button type="button" role="tab" aria-selected={view === 'transactions'}
            className={view === 'transactions' ? 'active' : ''} onClick={() => setView('transactions')}>
            {t('statementView.transactions')}
          </button>
          <button type="button" role="tab" aria-selected={view === 'outstanding'}
            className={view === 'outstanding' ? 'active' : ''} onClick={() => setView('outstanding')}>
            {t('statementView.outstanding')}
          </button>
        </div>
        <label className="sb-search" style={{ marginTop: 0, flex: 1, minWidth: 180 }}>
          <Search size={17} className="sb-icon" aria-hidden="true" />
          <span className="sr-only">{t('statementView.search')}</span>
          <input type="search" value={p.search} onChange={e => p.onSearch(e.target.value)} placeholder={t('statementView.search')} />
        </label>
        <div className="sb-menu-wrap">
          <button type="button" className="sb-icon-btn sb-menu-btn" aria-expanded={menuOpen}
            aria-label={t('statementView.more')} onClick={() => setMenuOpen(o => !o)}>
            <MoreHorizontal size={20} aria-hidden="true" />
          </button>
          {menuOpen && (
            <div className="sb-menu" role="menu">
              <label className="sb-menu-item">
                <input type="checkbox" checked={!p.hideReversed} onChange={e => p.onHideReversed(!e.target.checked)} />
                {t('statementView.show_reversed')}
              </label>
            </div>
          )}
        </div>
      </div>

      {/* ── Account summary ────────────────────────────────────────────── */}
      <section className="sb-card sb-stmt-summary" aria-label={t('statementView.summary')}>
        <div className="sb-stmt-period">
          {t('statementView.summary')} · <bdi dir="ltr">{formatDate(p.from)} – {formatDate(p.to)}</bdi>
        </div>
        <div className="sb-stmt-figs">
          <div><div className="sb-fig-label">{t('statementView.opening')}</div><div className="sb-fig">{money(p.openingBalance)}</div></div>
          <div><div className="sb-fig-label">{amountLabel}</div><div className="sb-fig">{money(invoiced)}</div></div>
          <div><div className="sb-fig-label">{t('statementView.payments_credits')}</div><div className="sb-fig sb-tone-good">{money(paid)}</div></div>
          <div className="sb-fig-due">
            <div className="sb-fig-label">{supplier ? t('statementView.balance_payable') : t('statementView.balance_due')}</div>
            <div className="sb-fig">{money(p.closingBalance)}</div>
          </div>
        </div>
        <div className="sb-stmt-split">
          <span className="sb-tone-danger"><TriangleAlert size={15} aria-hidden="true" />{t('statementView.overdue')} {money(p.overdue)}</span>
          <span>{t('statementView.not_yet_due')} {money(notYetDue)}</span>
          {p.creditOnFile > 0.005 && <span className="sb-tone-good">{t('statementView.credit_on_file')} {money(p.creditOnFile)}</span>}
        </div>
      </section>

      {/* ── Ledger / outstanding ───────────────────────────────────────── */}
      {p.loading ? (
        <div className="sb-card sb-empty">{t('common.loading')}</div>
      ) : view === 'transactions' ? (
        <section className="sb-card sb-ledger" aria-label={t('statementView.transactions')}>
          <table className="sb-ledger-table">
            <thead>
              <tr>
                <th>{t('statementView.date')}</th>
                <th>{t('statementView.transaction')}</th>
                <th className="sb-num">{supplier ? t('statementView.bills') : t('statementView.amount')}</th>
                <th className="sb-num">{t('statementView.payments')}</th>
                <th className="sb-num">{t('statementView.balance')}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="sb-ledger-open">
                <td colSpan={4}>{t('statementView.opening')}</td>
                <td className="sb-num">{num(p.openingBalance)}</td>
              </tr>
              {shown.length === 0 ? (
                <tr><td colSpan={5} className="sb-empty">{q ? t('statementView.no_match') : t('statementView.no_entries')}</td></tr>
              ) : shown.map((l, i) => (
                <tr key={`${l.doc_id ?? l.doc_number}-${i}`} className={l.dimmed ? 'sb-ledger-dim' : ''}>
                  <td className="sb-ledger-date"><bdi dir="ltr">{formatDate(l.date)}</bdi></td>
                  <td>
                    <span className="sb-ledger-type">{l.doc_type}</span>{' '}
                    <span className="sb-ledger-doc"><DocLink type={l.ref_type} id={l.doc_id ?? null} label={l.doc_number} /></span>
                    {l.reference && <span className="sb-ledger-ref"> · {l.reference}</span>}
                  </td>
                  <td className="sb-num">{amountOf(l) > 0 ? num(amountOf(l)) : <span className="sb-dash">—</span>}</td>
                  <td className="sb-num sb-tone-good">{paymentOf(l) > 0 ? num(paymentOf(l)) : <span className="sb-dash">—</span>}</td>
                  <td className="sb-num sb-ledger-bal">{num(l.balance)}</td>
                </tr>
              ))}
              <tr className="sb-ledger-close">
                <td colSpan={2}>{supplier ? t('statementView.balance_payable') : t('statementView.balance_due')}</td>
                <td className="sb-num">{num(invoiced)}</td>
                <td className="sb-num sb-tone-good">{num(paid)}</td>
                <td className="sb-num">{money(p.closingBalance)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      ) : (
        <section className="sb-card sb-list" aria-label={t('statementView.outstanding')}>
          <div className="sb-list-head sb-section-head">
            <span>{supplier ? t('statementView.open_bills') : t('statementView.open_invoices')}</span>
            <small>{t('statementView.total')} {money(p.outstanding.reduce((s, d) => s + d.outstanding, 0))}</small>
          </div>
          {shownOutstanding.length === 0 ? (
            <div className="sb-empty">{t('statementView.nothing_outstanding')}</div>
          ) : shownOutstanding.map(d => {
            const late = daysPast(d.due_date);
            return (
              <div key={d.id} className="sb-row" role="link" tabIndex={0}
                onClick={() => navigate(d.to)} onKeyDown={e => { if (e.key === 'Enter') navigate(d.to); }}>
                <div style={{ minWidth: 0 }}>
                  <div className="sb-row-no"><bdi dir="ltr">{d.number}</bdi></div>
                  <div className="sb-row-meta">
                    <bdi dir="ltr">{formatDate(d.date)}</bdi> · {t('statementView.due')} {d.due_date ? <bdi dir="ltr">{formatDate(d.due_date)}</bdi> : '—'}
                    {late > 0 && <span className="sb-tone-danger"> · {t('statementView.days_overdue', { count: late })}</span>}
                  </div>
                </div>
                <div>
                  <div className="sb-row-amt"><bdi dir="ltr">{fmt(d.outstanding)}</bdi></div>
                  <div className="sb-row-sub">{t('customer360.of_total')} <bdi dir="ltr">{fmt(d.total)}</bdi></div>
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
