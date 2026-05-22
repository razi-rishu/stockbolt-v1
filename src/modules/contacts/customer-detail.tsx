/**
 * Customer detail page — the "customer 360" view.
 *
 * Sections (top-down):
 *   1. Header: back link, customer name, Edit button, quick-action buttons
 *   2. Contact info card (phone, email, tax ID, currency, terms, address)
 *   3. KPI tiles: Outstanding, Overdue, 12-month Sales, Invoice Count
 *   4. Aging bar: Current / 31-60 / 61-90 / 90+
 *   5. Open Invoices (with outstanding column, click to open invoice)
 *   6. All Invoices (last 20, all statuses, with status badges)
 *   7. Quotes (last 20)
 *   8. Payments Received (last 20)
 *   9. Credit Notes (last 20)
 *  10. Account Statement (date range, debit/credit/running balance)
 */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Tabs } from '@/ui/tabs';
import { theme } from '@/ui/theme';
// Phase 14.07 — Signature Statement experience.
import {
  StatementShell, RelationshipHeader, HealthRow, BalanceStrip,
  PeriodFilter, TransactionSpine, ActionShelf, ShelfButton, InsightStrip,
  stmt as stmtTokens,
  type PeriodPreset, type SpineLine,
} from './statement/components';
import type {
  ContactRow, InvoiceRow, OpenInvoice, PaymentRow,
  SalesQuoteRow, CreditNoteRow, SalesReturnRow,
} from '@/data/adapter';

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function todayIso() { return new Date().toISOString().slice(0, 10); }
function monthsAgoIso(n: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(from: string, to: string): number {
  return Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000);
}

// ── Status badge for invoices / quotes / credit notes / payments ─────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string; border: string }> = {
    draft:              { bg: theme.muted,    text: theme.inkMuted, border: theme.border },
    sent:               { bg: '#eff6ff',      text: '#1d4ed8',      border: '#bfdbfe' },
    confirmed:          { bg: '#f0fdf4',      text: '#15803d',      border: '#bbf7d0' },
    accepted:           { bg: '#f0fdf4',      text: '#15803d',      border: '#bbf7d0' },
    rejected:           { bg: '#fef2f2',      text: '#dc2626',      border: '#fecaca' },
    expired:            { bg: '#fff7ed',      text: '#c2410c',      border: '#fed7aa' },
    partially_invoiced: { bg: theme.purpleSoft, text: theme.purple, border: theme.purpleBorder },
    fully_invoiced:     { bg: '#f0fdfa',      text: '#0f766e',      border: '#99f6e4' },
    void:               { bg: '#fef2f2',      text: '#ef4444',      border: '#fecaca' },
    received:           { bg: '#f0fdf4',      text: '#15803d',      border: '#bbf7d0' },
  };
  const p = map[status] ?? { bg: theme.muted, text: theme.inkMuted, border: theme.border };
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '999px',
      fontSize: '10px', fontWeight: 600,
      textTransform: 'capitalize',
      background: p.bg, color: p.text,
      border: `1px solid ${p.border}`,
    }}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ── KPI tile ─────────────────────────────────────────────────────────────────
function KpiTile({ label, value, sublabel, accent = 'default' }: {
  label: string;
  value: string;
  sublabel?: string;
  accent?: 'default' | 'warn' | 'danger' | 'good';
}) {
  const valueColor = {
    default: theme.ink,
    warn:    '#b45309',
    danger:  '#dc2626',
    good:    '#15803d',
  }[accent];
  return (
    <div style={{
      background: theme.card,
      border: `1px solid ${theme.border}`,
      borderRadius: '12px',
      boxShadow: theme.shadowSm,
      padding: '14px 18px',
    }}>
      <div style={{ fontSize: '11px', fontWeight: 700, color: theme.inkMuted, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
      <div className="font-mono" style={{ marginTop: '4px', fontSize: '20px', fontWeight: 700, color: valueColor }}>{value}</div>
      {sublabel && <div style={{ marginTop: '2px', fontSize: '11px', color: theme.inkFaint }}>{sublabel}</div>}
    </div>
  );
}

// ── Aging breakdown bar ──────────────────────────────────────────────────────
function AgingBar({ buckets, total }: {
  buckets: { current: number; d31_60: number; d61_90: number; d90_plus: number };
  total: number;
}) {
  if (total <= 0.005) {
    return (
      <div style={{
        background: theme.card,
        border: `1px solid ${theme.border}`,
        borderRadius: '12px',
        boxShadow: theme.shadowSm,
        padding: '14px 18px',
        fontSize: '13px', color: theme.inkFaint,
      }}>
        No outstanding balance.
      </div>
    );
  }
  const segs = [
    { label: 'Current', value: buckets.current,  color: '#22c55e' },
    { label: '31-60',   value: buckets.d31_60,   color: '#eab308' },
    { label: '61-90',   value: buckets.d61_90,   color: '#f97316' },
    { label: '90+',     value: buckets.d90_plus, color: '#ef4444' },
  ];
  return (
    <div style={{
      background: theme.card,
      border: `1px solid ${theme.border}`,
      borderRadius: '12px',
      boxShadow: theme.shadowSm,
      padding: '14px 18px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px' }}>
        <span style={{ fontWeight: 700, color: theme.inkMuted, textTransform: 'uppercase', letterSpacing: '.06em' }}>Aging</span>
        <span className="font-mono" style={{ color: theme.inkMuted }}>Total {fmt(total)}</span>
      </div>
      <div style={{
        marginTop: '8px', display: 'flex', height: '8px',
        overflow: 'hidden', borderRadius: '999px', background: theme.muted,
      }}>
        {segs.map((s) => {
          const pct = (s.value / total) * 100;
          return pct > 0 ? <div key={s.label} style={{ background: s.color, width: `${pct}%` }} title={`${s.label}: ${fmt(s.value)}`} /> : null;
        })}
      </div>
      <div style={{ marginTop: '8px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
        {segs.map((s) => (
          <div key={s.label} style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '11px', color: theme.inkFaint }}>{s.label}</span>
            <span className="font-mono" style={{ fontSize: '12px', color: theme.ink, fontWeight: 500 }}>{fmt(s.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Generic data section with optional "See all" link ────────────────────────
function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{
      background: theme.card,
      border: `1px solid ${theme.border}`,
      borderRadius: '12px',
      boxShadow: theme.shadowSm,
      overflow: 'hidden',
    }}>
      <div style={{
        background: theme.panelHead,
        borderBottom: `1px solid ${theme.border}`,
        padding: '10px 18px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <h2 style={{
          margin: 0,
          fontSize: '11px', fontWeight: 700, color: theme.inkMuted,
          textTransform: 'uppercase', letterSpacing: '.06em',
        }}>{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────
export default function CustomerDetailPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [stmtFrom, setStmtFrom] = useState(monthsAgoIso(3));
  const [stmtTo, setStmtTo]     = useState(todayIso);
  const [tab, setTab] = useState<'overview' | 'docs' | 'stmt'>('overview');
  // Phase 12.52 — default ON: shows only entries that affect the
  // current balance. Toggle OFF to see the full audit trail with
  // voided invoices + their reversal counter-entries.
  const [stmtHideReversed, setStmtHideReversed] = useState(true);
  // Phase 14.07 — statement period preset + search.
  const [stmtPreset, setStmtPreset] = useState<PeriodPreset>('last_90');
  const [stmtSearch, setStmtSearch] = useState('');
  const setPresetRange = (p: PeriodPreset) => {
    setStmtPreset(p);
    const today = todayIso();
    const y = new Date(today).getFullYear();
    switch (p) {
      case 'last_30':   setStmtFrom(monthsAgoIso(1));  setStmtTo(today); break;
      case 'last_90':   setStmtFrom(monthsAgoIso(3));  setStmtTo(today); break;
      case 'this_year': setStmtFrom(`${y}-01-01`);     setStmtTo(today); break;
      case 'last_year': setStmtFrom(`${y - 1}-01-01`); setStmtTo(`${y - 1}-12-31`); break;
      case 'all':       setStmtFrom('1970-01-01');     setStmtTo(today); break;
      case 'custom':    break;
    }
  };

  // ── Data fetches ───────────────────────────────────────────────────────────
  const { data: contact } = useQuery<ContactRow | null>({
    queryKey: ['contact', id],
    queryFn: () => getAdapter().contacts.getById(id!),
    enabled: !!id,
  });

  const { data: openInvoices = [] } = useQuery<OpenInvoice[]>({
    queryKey: ['open_invoices', company_id, id],
    queryFn: () => getAdapter().invoices.listOpenForContact(company_id!, id!),
    enabled: !!company_id && !!id,
  });

  // Phase 12.24 — unallocated advance balance from 2400 Customer Advances.
  // Positive = customer has paid in advance / overpaid (we owe them).
  // Surfaces an overpayment that otherwise stays invisible on this page.
  const { data: advanceCredit = 0 } = useQuery<number>({
    queryKey: ['advance_balance', company_id, id, '2400'],
    queryFn: () => getAdapter().contacts.getAdvanceBalance(company_id!, id!, '2400'),
    enabled: !!company_id && !!id,
  });

  const { data: allInvoices = [] } = useQuery<InvoiceRow[]>({
    queryKey: ['invoices', company_id],
    queryFn: () => getAdapter().invoices.list(company_id!),
    enabled: !!company_id,
  });

  const { data: allPayments = [] } = useQuery<PaymentRow[]>({
    queryKey: ['payments', company_id, 'inbound'],
    queryFn: () => getAdapter().payments.list(company_id!, 'inbound'),
    enabled: !!company_id,
  });

  const { data: allQuotes = [] } = useQuery<SalesQuoteRow[]>({
    queryKey: ['sales_quotes', company_id],
    queryFn: () => getAdapter().salesQuotes.list(company_id!),
    enabled: !!company_id,
  });

  const { data: allCreditNotes = [] } = useQuery<CreditNoteRow[]>({
    queryKey: ['credit_notes', company_id, id],
    queryFn: () => getAdapter().creditNotes.list(company_id!, { contact_id: id }),
    enabled: !!company_id && !!id,
  });

  // Sales returns don't have contact_id directly — they link to an invoice.
  // Fetch all and filter by the customer's invoice IDs.
  const { data: allSalesReturns = [] } = useQuery<SalesReturnRow[]>({
    queryKey: ['sales_returns', company_id],
    queryFn: () => getAdapter().salesReturns.list(company_id!),
    enabled: !!company_id,
  });

  const { data: statement, isLoading: stmtLoading } = useQuery({
    queryKey: ['customer_statement', company_id, id, stmtFrom, stmtTo],
    queryFn: () => getAdapter().reports.getCustomerStatement(company_id!, id!, stmtFrom, stmtTo),
    enabled: !!company_id && !!id,
  });

  // ── Derived data ───────────────────────────────────────────────────────────
  const invoicesForCustomer = useMemo(
    () => allInvoices.filter(inv => inv.contact_id === id).slice(0, 20),
    [allInvoices, id],
  );
  const paymentsForCustomer = useMemo(
    () => allPayments.filter(p => p.contact_id === id).slice(0, 20),
    [allPayments, id],
  );
  const quotesForCustomer = useMemo(
    () => allQuotes.filter(q => q.contact_id === id).slice(0, 20),
    [allQuotes, id],
  );

  // Build an invoice_id -> invoice_number lookup once, used by both the
  // Sales Returns table (to show "linked to INV-1001") and the count.
  const invoiceById = useMemo(() => {
    const m: Record<string, InvoiceRow> = {};
    for (const inv of allInvoices) if (inv.contact_id === id) m[inv.id] = inv;
    return m;
  }, [allInvoices, id]);

  const salesReturnsForCustomer = useMemo(
    () => allSalesReturns.filter(sr => invoiceById[sr.invoice_id] !== undefined).slice(0, 20),
    [allSalesReturns, invoiceById],
  );

  // KPIs
  const outstandingTotal = useMemo(
    () => openInvoices.reduce((s, inv) => s + inv.outstanding, 0),
    [openInvoices],
  );
  const today = todayIso();
  const overdueTotal = useMemo(
    () => openInvoices
      .filter(inv => inv.due_date && (inv.due_date as unknown as string) < today)
      .reduce((s, inv) => s + inv.outstanding, 0),
    [openInvoices, today],
  );
  const year_ago = monthsAgoIso(12);
  const sales12mo = useMemo(() => {
    return allInvoices
      .filter(inv => inv.contact_id === id && inv.status === 'confirmed' && (inv.date as unknown as string) >= year_ago)
      .reduce((s, inv) => s + Number(inv.total_amount), 0);
  }, [allInvoices, id, year_ago]);
  const confirmedInvoiceCount = useMemo(
    () => allInvoices.filter(inv => inv.contact_id === id && inv.status === 'confirmed').length,
    [allInvoices, id],
  );

  // Aging buckets (based on due_date vs today; falls back to invoice date if no due_date)
  const aging = useMemo(() => {
    const b = { current: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
    for (const inv of openInvoices) {
      const ref = (inv.due_date as unknown as string | null) ?? (inv.date as unknown as string);
      const days = daysBetween(ref, today);
      if (days <= 30) b.current += inv.outstanding;
      else if (days <= 60) b.d31_60 += inv.outstanding;
      else if (days <= 90) b.d61_90 += inv.outstanding;
      else b.d90_plus += inv.outstanding;
    }
    return b;
  }, [openInvoices, today]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 pb-16">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => navigate('/contacts/customers')} className="text-sm text-ink-secondary hover:text-ink-primary">
          ← {t('nav.customers')}
        </button>
        <span className="text-ink-tertiary">/</span>
        <h1 className="text-xl font-semibold text-ink-primary">{contact?.name ?? '…'}</h1>
        {contact?.name_ar && <span dir="rtl" className="text-sm text-ink-secondary">({contact.name_ar})</span>}
        <div className="ms-auto flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/contacts/customers?edit=${id}`)}>
            ✎ Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate('/sales/quotes/new')}>
            + Quote
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate('/sales/payments/new')}>
            + Receive Payment
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate('/sales/credit-notes/new')}>
            + Credit Note
          </Button>
          <Button size="sm" onClick={() => navigate('/sales/invoices/new')}>
            + Invoice
          </Button>
        </div>
      </div>

      {/* Contact info */}
      {contact && (
        <div className="rounded-card border border-border-subtle bg-surface-card p-5">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3 lg:grid-cols-4">
            <div><p className="text-xs text-ink-tertiary">{t('contacts.phone')}</p><p className="text-ink-primary">{contact.phone ?? contact.mobile ?? '—'}</p></div>
            <div><p className="text-xs text-ink-tertiary">{t('contacts.email')}</p><p className="text-ink-primary">{contact.email ?? '—'}</p></div>
            <div><p className="text-xs text-ink-tertiary">{t('contacts.tax_id')}</p><p className="text-ink-primary">{contact.tax_id ?? '—'}</p></div>
            <div><p className="text-xs text-ink-tertiary">{t('contacts.currency')}</p><p className="text-ink-primary">{contact.currency}</p></div>
            <div><p className="text-xs text-ink-tertiary">{t('contacts.payment_terms')}</p><p className="text-ink-primary">{contact.payment_terms_days > 0 ? `Net ${contact.payment_terms_days}` : 'COD'}</p></div>
            <div><p className="text-xs text-ink-tertiary">Credit limit</p><p className="font-mono text-ink-primary">{contact.credit_limit > 0 ? fmt(contact.credit_limit) : '—'}</p></div>
            <div className="col-span-2"><p className="text-xs text-ink-tertiary">{t('contacts.address')}</p><p className="text-ink-primary">{[contact.address_street, contact.address_city, contact.address_country].filter(Boolean).join(', ') || '—'}</p></div>
          </div>
        </div>
      )}

      {/* Phase 12.24 — surface the customer's NET position. If they have
           credit on file (advanceCredit > 0), it sits invisibly in
           2400 GL otherwise. Standard ERP practice is to net it against
           outstanding for the customer-facing view, even though the GL
           keeps them separate. */}
      {advanceCredit > 0.005 && (
        <div className="rounded-card border border-emerald-200 bg-emerald-50 px-5 py-3 flex items-center gap-4">
          <span className="rounded-pill bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
            CREDIT ON FILE
          </span>
          <p className="text-sm text-emerald-900">
            This customer has{' '}
            <span className="font-mono font-semibold">{contact?.currency ?? 'AED'} {fmt(advanceCredit)}</span>{' '}
            available to apply to a future invoice. Hits 2400 Customer Advances on the GL.
          </p>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          label="Outstanding"
          value={fmt(outstandingTotal)}
          accent={outstandingTotal > 0 ? 'warn' : 'default'}
          sublabel={`${openInvoices.length} open invoice${openInvoices.length === 1 ? '' : 's'}`}
        />
        {/* Phase 12.24 — Credit Available replaces the "Overdue" tile when
             the customer is in credit (no overdue invoices possible in
             that case) so the user always sees the most material number. */}
        {advanceCredit > 0.005 ? (
          <KpiTile
            label="Credit Available"
            value={fmt(advanceCredit)}
            accent="good"
            sublabel="advance / overpayment"
          />
        ) : (
          <KpiTile
            label="Overdue"
            value={fmt(overdueTotal)}
            accent={overdueTotal > 0 ? 'danger' : 'good'}
            sublabel="past due date"
          />
        )}
        <KpiTile label="Sales (12 mo)"  value={fmt(sales12mo)}        sublabel={`${confirmedInvoiceCount} confirmed invoice${confirmedInvoiceCount === 1 ? '' : 's'}`} />
        <KpiTile
          label="Net Position"
          value={fmt(Math.abs(outstandingTotal - advanceCredit))}
          // Negative net position = customer has more credit than they owe.
          accent={
            outstandingTotal - advanceCredit > 0.005 ? 'warn'
            : outstandingTotal - advanceCredit < -0.005 ? 'good'
            : 'default'
          }
          sublabel={
            outstandingTotal - advanceCredit > 0.005 ? 'customer owes us'
            : outstandingTotal - advanceCredit < -0.005 ? 'we owe customer'
            : 'settled'
          }
        />
      </div>

      {/* Aging breakdown */}
      <AgingBar buckets={aging} total={outstandingTotal} />

      {/* ── Tabs ──────────────────────────────────────────────────────── */}
      <Tabs
        value={tab}
        onChange={(v) => setTab(v as typeof tab)}
        items={[
          { value: 'overview', label: 'Overview', badge: openInvoices.length || undefined },
          { value: 'docs',     label: 'Documents', badge: (invoicesForCustomer.length + quotesForCustomer.length + paymentsForCustomer.length + allCreditNotes.length + salesReturnsForCustomer.length) || undefined },
          { value: 'stmt',     label: 'Statement' },
        ]}
      />

      {tab === 'overview' && (
      <>

      {/* ── Open Invoices ──────────────────────────────────────────────── */}
      <Section
        title={`Open Invoices (${openInvoices.length})`}
        action={openInvoices.length > 0 && (
          <button onClick={() => navigate('/sales/invoices')} className="text-xs text-brand-600 hover:underline">See all →</button>
        )}
      >
        {openInvoices.length === 0 ? (
          <div className="px-5 py-6 text-sm text-ink-tertiary">No outstanding invoices.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                <th className="px-4 py-2 text-start font-medium">Invoice #</th>
                <th className="px-4 py-2 text-start font-medium">Date</th>
                <th className="px-4 py-2 text-start font-medium">Due date</th>
                <th className="px-4 py-2 text-end font-medium">Total</th>
                <th className="px-4 py-2 text-end font-medium">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {openInvoices.map(inv => (
                <tr key={inv.id}
                  onClick={() => navigate(`/sales/invoices/${inv.id}`)}
                  className="cursor-pointer border-b border-border-subtle last:border-0 hover:bg-surface-muted/50">
                  <td className="px-4 py-2 font-mono text-xs text-brand-600">{inv.invoice_number}</td>
                  <td className="px-4 py-2 text-ink-secondary">{inv.date as unknown as string}</td>
                  <td className="px-4 py-2 text-ink-secondary">{(inv.due_date as unknown as string | null) ?? '—'}</td>
                  <td className="px-4 py-2 text-end font-mono text-ink-secondary">{fmt(Number(inv.total_amount))}</td>
                  <td className="px-4 py-2 text-end font-mono font-medium text-ink-primary">{fmt(inv.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      </>
      )}

      {tab === 'docs' && (
      <>

      {/* ── All Invoices ───────────────────────────────────────────────── */}
      <Section title={`All Invoices (last ${invoicesForCustomer.length})`}>
        {invoicesForCustomer.length === 0 ? (
          <div className="px-5 py-6 text-sm text-ink-tertiary">No invoices yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                <th className="px-4 py-2 text-start font-medium">Invoice #</th>
                <th className="px-4 py-2 text-start font-medium">Date</th>
                <th className="px-4 py-2 text-start font-medium">Status</th>
                <th className="px-4 py-2 text-end font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoicesForCustomer.map(inv => (
                <tr key={inv.id}
                  onClick={() => navigate(`/sales/invoices/${inv.id}`)}
                  className="cursor-pointer border-b border-border-subtle last:border-0 hover:bg-surface-muted/50">
                  <td className="px-4 py-2 font-mono text-xs text-brand-600">{inv.invoice_number}</td>
                  <td className="px-4 py-2 text-ink-secondary">{inv.date as unknown as string}</td>
                  <td className="px-4 py-2"><StatusBadge status={inv.status} /></td>
                  <td className="px-4 py-2 text-end font-mono text-ink-primary">{inv.currency} {fmt(Number(inv.total_amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ── Quotes ─────────────────────────────────────────────────────── */}
      <Section title={`Quotes (${quotesForCustomer.length})`}>
        {quotesForCustomer.length === 0 ? (
          <div className="px-5 py-6 text-sm text-ink-tertiary">No quotes yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                <th className="px-4 py-2 text-start font-medium">Quote #</th>
                <th className="px-4 py-2 text-start font-medium">Date</th>
                <th className="px-4 py-2 text-start font-medium">Status</th>
                <th className="px-4 py-2 text-end font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {quotesForCustomer.map(q => (
                <tr key={q.id}
                  onClick={() => navigate(`/sales/quotes/${q.id}`)}
                  className="cursor-pointer border-b border-border-subtle last:border-0 hover:bg-surface-muted/50">
                  <td className="px-4 py-2 font-mono text-xs text-brand-600">{q.quote_number}</td>
                  <td className="px-4 py-2 text-ink-secondary">{q.date as unknown as string}</td>
                  <td className="px-4 py-2"><StatusBadge status={q.status} /></td>
                  <td className="px-4 py-2 text-end font-mono text-ink-primary">{q.currency} {fmt(Number(q.total_amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ── Payments Received ─────────────────────────────────────────── */}
      <Section title={`Payments Received (${paymentsForCustomer.length})`}>
        {paymentsForCustomer.length === 0 ? (
          <div className="px-5 py-6 text-sm text-ink-tertiary">No payments yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                <th className="px-4 py-2 text-start font-medium">Payment #</th>
                <th className="px-4 py-2 text-start font-medium">Date</th>
                <th className="px-4 py-2 text-start font-medium">Status</th>
                <th className="px-4 py-2 text-end font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {paymentsForCustomer.map(p => (
                <tr key={p.id}
                  onClick={() => navigate(`/sales/payments/${p.id}`)}
                  className="cursor-pointer border-b border-border-subtle last:border-0 hover:bg-surface-muted/50">
                  <td className="px-4 py-2 font-mono text-xs text-brand-600">{p.payment_number}</td>
                  <td className="px-4 py-2 text-ink-secondary">{p.date as unknown as string}</td>
                  <td className="px-4 py-2"><StatusBadge status={p.status} /></td>
                  <td className="px-4 py-2 text-end font-mono text-ink-primary">{p.currency} {fmt(Number(p.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ── Credit Notes ──────────────────────────────────────────────── */}
      <Section title={`Credit Notes (${allCreditNotes.length})`}>
        {allCreditNotes.length === 0 ? (
          <div className="px-5 py-6 text-sm text-ink-tertiary">No credit notes yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                <th className="px-4 py-2 text-start font-medium">Note #</th>
                <th className="px-4 py-2 text-start font-medium">Date</th>
                <th className="px-4 py-2 text-start font-medium">Status</th>
                <th className="px-4 py-2 text-end font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {allCreditNotes.slice(0, 20).map(cn => (
                <tr key={cn.id}
                  onClick={() => navigate(`/sales/credit-notes/${cn.id}`)}
                  className="cursor-pointer border-b border-border-subtle last:border-0 hover:bg-surface-muted/50">
                  <td className="px-4 py-2 font-mono text-xs text-brand-600">{cn.credit_note_number}</td>
                  <td className="px-4 py-2 text-ink-secondary">{cn.date as unknown as string}</td>
                  <td className="px-4 py-2"><StatusBadge status={cn.status} /></td>
                  <td className="px-4 py-2 text-end font-mono text-ink-primary">{cn.currency} {fmt(Number(cn.total_amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ── Sales Returns ────────────────────────────────────────────────
          Sales returns are tracking documents (the financial impact is on the
          linked Credit Note). Shown here so the user can see the physical-return
          history alongside the financial documents. */}
      <Section title={`Sales Returns (${salesReturnsForCustomer.length})`}>
        {salesReturnsForCustomer.length === 0 ? (
          <div className="px-5 py-6 text-sm text-ink-tertiary">No sales returns yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                <th className="px-4 py-2 text-start font-medium">Return #</th>
                <th className="px-4 py-2 text-start font-medium">Date</th>
                <th className="px-4 py-2 text-start font-medium">Status</th>
                <th className="px-4 py-2 text-start font-medium">Linked invoice</th>
                <th className="px-4 py-2 text-start font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {salesReturnsForCustomer.map((sr) => {
                const inv = invoiceById[sr.invoice_id];
                return (
                  <tr key={sr.id}
                    onClick={() => navigate(`/sales/returns/${sr.id}`)}
                    className="cursor-pointer border-b border-border-subtle last:border-0 hover:bg-surface-muted/50">
                    <td className="px-4 py-2 font-mono text-xs text-brand-600">{sr.return_number}</td>
                    <td className="px-4 py-2 text-ink-secondary">{sr.date as unknown as string}</td>
                    <td className="px-4 py-2"><StatusBadge status={sr.status} /></td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-secondary">{inv?.invoice_number ?? '—'}</td>
                    <td className="px-4 py-2 text-ink-secondary capitalize">{(sr.reason ?? '').replace(/_/g, ' ') || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>

      </>
      )}

      {tab === 'stmt' && (() => {
        // Phase 12.52 / 12.54 — friendly doc label derived from source_type
        // + account_code (account_code disambiguates payments that hit both
        // AR (1200) and Customer Advances (2400) in the same JE).
        const sourceLabel = (src?: string, fallback?: string, account_code?: string): string => {
          if (account_code === '2400') return 'Customer advance';
          switch (src) {
            case 'sales_invoice':       return 'Invoice';
            case 'sales_invoice_void':  return 'Invoice (void)';
            case 'sales_invoice_edit':  return 'Invoice (edit)';
            case 'sales_payment':       return 'Payment';
            case 'customer_advance':    return 'Customer advance';
            case 'pos_sale':            return 'POS sale';
            case 'credit_note':         return 'Credit note';
            case 'manual':              return 'Manual JE';
            case 'reversal':            return 'Reversal';
            case 'opening_balance':     return 'Opening balance';
            default:                    return (fallback ?? src ?? 'JE').replace(/_/g, ' ');
          }
        };

        // Apply the hide-reversed filter + recompute the running balance so
        // the user sees a consistent statement without the audit pairs.
        const allLines = statement?.lines ?? [];
        let visibleLines = stmtHideReversed
          ? allLines.filter(l => !l.is_reversed && !l.is_reversal)
          : allLines;
        // Phase 14.07 — search filter (voucher # or reference token match).
        if (stmtSearch.trim()) {
          const q = stmtSearch.trim().toLowerCase();
          visibleLines = visibleLines.filter(l =>
            (l.doc_number ?? '').toLowerCase().includes(q) ||
            (l.doc_type   ?? '').toLowerCase().includes(q)
          );
        }
        const openingBalance = statement?.opening_balance ?? 0;
        let runBal = openingBalance;
        const spineLines: SpineLine[] = visibleLines.map(l => {
          runBal += l.debit - l.credit;
          return {
            date:       l.date,
            doc_type:   sourceLabel(l.source_type, l.doc_type, l.account_code),
            doc_number: l.doc_number,
            reference:  null,
            debit:      l.debit,
            credit:     l.credit,
            balance:    runBal,
            dimmed:     !stmtHideReversed && (l.is_reversed || l.is_reversal),
          };
        });
        const closing = stmtHideReversed ? runBal : (statement?.closing_balance ?? runBal);

        // Effective receivable balance — Phase 12.54 logic: AR (1200)
        // outstanding minus customer advances. Surfaces overpayments as a
        // negative ("credit") balance the operator can offset next sale.
        const netBalance = outstandingTotal - Number(advanceCredit ?? 0);

        // 12-month average payment days — approximate, computed off the
        // statement lines: difference between invoice and matching payment.
        const avgPayDays = (() => {
          const invs = allInvoices.filter(i => i.contact_id === id && i.status === 'confirmed');
          if (invs.length === 0) return null;
          const pays = paymentsForCustomer.filter(p => p.status === 'confirmed');
          if (pays.length === 0) return null;
          const days = pays.map(p => {
            // Match each payment to the oldest open invoice that preceded it.
            const candidate = invs.find(i => (i.date as unknown as string) <= (p.date as unknown as string));
            if (!candidate) return null;
            return daysBetween(candidate.date as unknown as string, p.date as unknown as string);
          }).filter((d): d is number => d !== null && d >= 0);
          if (days.length === 0) return null;
          return Math.round(days.reduce((s, x) => s + x, 0) / days.length);
        })();

        const riskScore = (() => {
          if (overdueTotal === 0) return { dots: 1, label: 'Low' };
          const pct = outstandingTotal > 0 ? overdueTotal / outstandingTotal : 0;
          if (pct < 0.15) return { dots: 2, label: 'Moderate' };
          return { dots: 3, label: 'High' };
        })();

        return (
          <StatementShell>
            {/* Header row — title + action shelf */}
            <div style={{
              display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
              gap: '16px', marginBottom: '20px',
            }}>
              <div>
                <div style={{
                  fontSize: '10.5px', fontWeight: 600, color: stmtTokens.inkMuted,
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                }}>Account Statement</div>
                <div style={{ marginTop: '4px', fontSize: '12.5px', color: stmtTokens.inkSoft }}>
                  Period {stmtFrom} — {stmtTo}
                </div>
              </div>
              <ActionShelf>
                <ShelfButton
                  onClick={() => window.print()}
                  title="Print or save as PDF using the browser dialog"
                >🖨 Print</ShelfButton>
                <ShelfButton
                  variant="primary"
                  onClick={() => window.open(`/print/statement/${id}?from=${stmtFrom}&to=${stmtTo}`, '_blank')}
                  disabled={!id}
                  title="Open the printable statement in a new tab"
                >Download PDF</ShelfButton>
              </ActionShelf>
            </div>

            <RelationshipHeader
              party={{
                name:    contact?.name ?? '—',
                code:    null,
                trn:     contact?.tax_id ?? null,
                address: contact?.address_street ?? null,
                phone:   contact?.phone ?? contact?.mobile ?? null,
                email:   contact?.email ?? null,
                terms:   contact?.payment_terms_days ? `Net ${contact.payment_terms_days}` : null,
                credit_limit: contact?.credit_limit ?? null,
                since:   null,
              }}
              balance={netBalance}
              currency="AED"
              side="customer"
              statusLabel={contact?.is_active === false ? 'Inactive' : 'Active'}
            />

            <HealthRow tiles={[
              {
                label: 'Available credit',
                value: contact?.credit_limit
                  ? `AED ${fmt(Math.max(0, Number(contact.credit_limit) - outstandingTotal))}`
                  : '—',
                sublabel: contact?.credit_limit ? `of ${fmt(Number(contact.credit_limit))} limit` : 'no limit set',
                tone: 'brand',
              },
              {
                label: 'Overdue',
                value: `AED ${fmt(overdueTotal)}`,
                sublabel: overdueTotal > 0 ? 'past due date' : 'all current',
                tone: overdueTotal > 0 ? 'danger' : 'good',
              },
              {
                label: '12-mo sales',
                value: `AED ${fmt(sales12mo)}`,
                sublabel: `${confirmedInvoiceCount} invoices`,
              },
              {
                label: 'Last payment',
                value: paymentsForCustomer[0]
                  ? `${daysBetween(paymentsForCustomer[0].date as unknown as string, today)}d ago`
                  : '—',
                sublabel: paymentsForCustomer[0]
                  ? `AED ${fmt(Number(paymentsForCustomer[0].amount))}`
                  : 'no payments yet',
              },
              {
                label: 'Risk',
                value: '●'.repeat(riskScore.dots) + '○'.repeat(3 - riskScore.dots) + ' ' + riskScore.label,
                tone: riskScore.dots >= 3 ? 'danger' : riskScore.dots === 2 ? 'warn' : 'good',
              },
            ]} />

            <BalanceStrip
              currency="AED"
              total={outstandingTotal}
              buckets={[
                { label: 'Current', value: aging.current,  color: stmtTokens.band.current },
                { label: '31–60',   value: aging.d31_60,   color: stmtTokens.band.d60 },
                { label: '61–90',   value: aging.d61_90,   color: stmtTokens.band.d90 },
                { label: '90+',     value: aging.d90_plus, color: stmtTokens.band.over },
              ]}
            />

            <PeriodFilter
              preset={stmtPreset}
              onPresetChange={setPresetRange}
              from={stmtFrom}
              to={stmtTo}
              onFromChange={setStmtFrom}
              onToChange={setStmtTo}
              hideReversed={stmtHideReversed}
              onHideReversedChange={setStmtHideReversed}
              search={stmtSearch}
              onSearchChange={setStmtSearch}
            />

            {stmtLoading ? (
              <div style={{
                marginTop: '20px',
                padding: '24px',
                border: `1px solid ${stmtTokens.hairline}`,
                borderRadius: '12px',
                textAlign: 'center',
                color: stmtTokens.inkMuted,
                fontSize: '13px',
              }}>{t('common.loading')}</div>
            ) : (
              <TransactionSpine
                openingBalance={openingBalance}
                lines={spineLines}
                closingBalance={closing}
                currency="AED"
              />
            )}

            <InsightStrip items={[
              {
                label: 'Avg payment',
                value: avgPayDays !== null ? `${avgPayDays} days` : '—',
                hint: avgPayDays !== null && contact?.payment_terms_days
                  ? (avgPayDays <= Number(contact.payment_terms_days)
                      ? 'within terms'
                      : `${avgPayDays - Number(contact.payment_terms_days)}d over terms`)
                  : undefined,
              },
              {
                label: 'Invoices in period',
                value: String(spineLines.filter(l => l.doc_type === 'Invoice').length),
              },
              {
                label: 'Payments in period',
                value: String(spineLines.filter(l => l.doc_type === 'Payment').length),
              },
              {
                label: 'Net activity',
                value: `${closing >= openingBalance ? '+' : ''}AED ${fmt(closing - openingBalance)}`,
                hint: closing > openingBalance ? 'balance grew' : closing < openingBalance ? 'balance reduced' : 'unchanged',
              },
            ]} />
          </StatementShell>
        );
      })()}
    </div>
  );
}
