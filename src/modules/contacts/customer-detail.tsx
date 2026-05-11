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
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import type {
  ContactRow, InvoiceRow, OpenInvoice, PaymentRow,
  SalesQuoteRow, CreditNoteRow,
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
  const map: Record<string, string> = {
    draft:              'bg-gray-100 text-gray-700',
    sent:               'bg-blue-50 text-blue-700',
    confirmed:          'bg-green-50 text-green-700',
    accepted:           'bg-green-50 text-green-700',
    rejected:           'bg-red-50 text-red-700',
    expired:            'bg-orange-50 text-orange-700',
    partially_invoiced: 'bg-purple-50 text-purple-700',
    fully_invoiced:     'bg-teal-50 text-teal-700',
    void:               'bg-red-50 text-red-500',
    received:           'bg-green-50 text-green-700',
  };
  return (
    <span className={`rounded-pill px-2 py-0.5 text-[10px] font-medium capitalize ${map[status] ?? 'bg-gray-100 text-gray-700'}`}>
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
  const accentClass = {
    default: 'text-ink-primary',
    warn:    'text-amber-600',
    danger:  'text-red-600',
    good:    'text-green-700',
  }[accent];
  return (
    <div className="rounded-card border border-border-subtle bg-surface-card px-5 py-4">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-tertiary">{label}</div>
      <div className={`mt-1 font-mono text-xl font-semibold ${accentClass}`}>{value}</div>
      {sublabel && <div className="mt-0.5 text-xs text-ink-tertiary">{sublabel}</div>}
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
      <div className="rounded-card border border-border-subtle bg-surface-card px-5 py-4 text-sm text-ink-tertiary">
        No outstanding balance.
      </div>
    );
  }
  const segs = [
    { label: 'Current', value: buckets.current,  color: 'bg-green-500' },
    { label: '31-60',   value: buckets.d31_60,   color: 'bg-yellow-500' },
    { label: '61-90',   value: buckets.d61_90,   color: 'bg-orange-500' },
    { label: '90+',     value: buckets.d90_plus, color: 'bg-red-500' },
  ];
  return (
    <div className="rounded-card border border-border-subtle bg-surface-card px-5 py-4">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium uppercase tracking-wide text-ink-tertiary">Aging</span>
        <span className="font-mono text-ink-secondary">Total {fmt(total)}</span>
      </div>
      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-muted">
        {segs.map((s) => {
          const pct = (s.value / total) * 100;
          return pct > 0 ? <div key={s.label} className={s.color} style={{ width: `${pct}%` }} title={`${s.label}: ${fmt(s.value)}`} /> : null;
        })}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
        {segs.map((s) => (
          <div key={s.label} className="flex flex-col">
            <span className="text-ink-tertiary">{s.label}</span>
            <span className="font-mono text-ink-primary">{fmt(s.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Generic data section with optional "See all" link ────────────────────────
function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-border-subtle bg-surface-card">
      <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3">
        <h2 className="text-sm font-semibold text-ink-primary">{title}</h2>
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

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Outstanding"    value={fmt(outstandingTotal)} accent={outstandingTotal > 0 ? 'warn' : 'default'} sublabel={`${openInvoices.length} open invoice${openInvoices.length === 1 ? '' : 's'}`} />
        <KpiTile label="Overdue"        value={fmt(overdueTotal)}     accent={overdueTotal > 0 ? 'danger' : 'good'}      sublabel="past due date" />
        <KpiTile label="Sales (12 mo)"  value={fmt(sales12mo)}        sublabel={`${confirmedInvoiceCount} confirmed invoice${confirmedInvoiceCount === 1 ? '' : 's'}`} />
        <KpiTile label="Invoice count"  value={String(confirmedInvoiceCount)} sublabel="confirmed only" />
      </div>

      {/* Aging breakdown */}
      <AgingBar buckets={aging} total={outstandingTotal} />

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

      {/* ── Account Statement ────────────────────────────────────────── */}
      <div className="rounded-card border border-border-subtle bg-surface-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-5 py-3">
          <h2 className="text-sm font-semibold text-ink-primary">{t('reports.customer_statement')}</h2>
          <div className="ms-auto flex items-center gap-2">
            <Input type="date" value={stmtFrom} onChange={(e) => setStmtFrom(e.target.value)} className="h-8 text-xs" />
            <span className="text-ink-tertiary">–</span>
            <Input type="date" value={stmtTo}   onChange={(e) => setStmtTo(e.target.value)}   className="h-8 text-xs" />
          </div>
        </div>
        {stmtLoading ? (
          <p className="px-5 py-4 text-sm text-ink-secondary">{t('common.loading')}</p>
        ) : !statement || statement.lines.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-tertiary">{t('reports.no_transactions')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                <th className="px-4 py-2 text-start font-medium">Date</th>
                <th className="px-4 py-2 text-start font-medium">Document</th>
                <th className="px-4 py-2 text-start font-medium">Number</th>
                <th className="px-4 py-2 text-end font-medium">Debit</th>
                <th className="px-4 py-2 text-end font-medium">Credit</th>
                <th className="px-4 py-2 text-end font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {statement.lines.map((line, i) => (
                <tr key={i} className="border-b border-border-subtle last:border-0">
                  <td className="px-4 py-2 text-ink-secondary">{line.date}</td>
                  <td className="px-4 py-2 text-ink-secondary capitalize">{line.doc_type.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-2 font-mono text-xs text-brand-600">{line.doc_number}</td>
                  <td className="px-4 py-2 text-end font-mono text-ink-primary">{line.debit > 0 ? fmt(line.debit) : '—'}</td>
                  <td className="px-4 py-2 text-end font-mono text-ink-primary">{line.credit > 0 ? fmt(line.credit) : '—'}</td>
                  <td className={`px-4 py-2 text-end font-mono font-medium ${line.balance < 0 ? 'text-red-600' : 'text-ink-primary'}`}>
                    {fmt(Math.abs(line.balance))}{line.balance < 0 ? ' CR' : line.balance > 0 ? ' DR' : ''}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-border-subtle bg-surface-muted font-semibold">
                <td colSpan={5} className="px-4 py-2 text-ink-primary">Closing balance</td>
                <td className={`px-4 py-2 text-end font-mono ${statement.closing_balance < 0 ? 'text-red-600' : 'text-ink-primary'}`}>
                  {fmt(Math.abs(statement.closing_balance))}{statement.closing_balance < 0 ? ' CR' : statement.closing_balance > 0 ? ' DR' : ''}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
