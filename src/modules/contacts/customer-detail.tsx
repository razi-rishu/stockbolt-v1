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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useCompanyCurrency } from '@/hooks/use-company-currency';
import { Button } from '@/ui/button';
import { BackButton } from '@/ui/back-button';
import { CustomerOverviewOcean } from './customer-overview-ocean';
import { CustomerDocumentsOcean } from './customer-documents-ocean';
import { Tabs } from '@/ui/tabs';
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

// ── Main component ──────────────────────────────────────────────────────────
export default function CustomerDetailPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const { id } = useParams<{ id: string }>();
  const companyCurrency = useCompanyCurrency();   // Issue 1 — localize money to tenant currency
  const navigate = useNavigate();

  const [stmtFrom, setStmtFrom] = useState(monthsAgoIso(3));
  const [stmtTo, setStmtTo]     = useState(todayIso);
  const [tab, setTab] = useState<'overview' | 'docs' | 'stmt'>('overview');
  // S4 — refund an advance back to the customer (no invoice, no sales return).
  const [refundOpen, setRefundOpen] = useState(false);
  // R5a — the other pot: a credit balance on 1200, not an advance on 2400.
  const qc = useQueryClient();
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
  // Overview: Ocean Teal design (UI v1.1). Same figures, same actions — the
  // component only presents what is computed above. Documents and Statement
  // keep the layout below, unchanged.
  if (tab === 'overview') {
    return (
      <div className="pb-16">
        <CustomerOverviewOcean
          id={id!}
          company_id={company_id}
          contact={contact}
          currency={contact?.currency ?? companyCurrency}
          openInvoices={openInvoices}
          paymentsForCustomer={paymentsForCustomer}
          outstandingTotal={outstandingTotal}
          overdueTotal={overdueTotal}
          advanceCredit={advanceCredit}
          sales12mo={sales12mo}
          confirmedInvoiceCount={confirmedInvoiceCount}
          aging={aging}
          docsCount={invoicesForCustomer.length + quotesForCustomer.length + paymentsForCustomer.length + allCreditNotes.length + salesReturnsForCustomer.length}
          refundOpen={refundOpen}
          setRefundOpen={setRefundOpen}
          onRefundDone={() => {
            void qc.invalidateQueries({ queryKey: ['advance_balance'] });
            void qc.invalidateQueries({ queryKey: ['payments'] });
          }}
          onTab={setTab}
          fmt={fmt}
        />
      </div>
    );
  }

  // Documents: Ocean Teal too — same lists, same routes; only the look changes.
  if (tab === 'docs') {
    return (
      <div className="pb-16">
        <CustomerDocumentsOcean
          id={id!}
          contact={contact}
          openCount={openInvoices.length}
          invoices={invoicesForCustomer}
          quotes={quotesForCustomer}
          receipts={paymentsForCustomer}
          creditNotes={allCreditNotes}
          salesReturns={salesReturnsForCustomer}
          invoiceById={invoiceById}
          onTab={setTab}
          fmt={fmt}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-16">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <BackButton to="/contacts/customers" label={t('nav.customers')} />
        <span className="text-ink-tertiary">/</span>
        <h1 className="text-xl font-semibold text-ink-primary">{contact?.name ?? '…'}</h1>
        {contact?.name_ar && <span dir="rtl" className="text-sm text-ink-secondary">({contact.name_ar})</span>}
        <div className="ms-auto flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/contacts/customers?edit=${id}`)}>
            ✎ Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate(`/sales/quotes/new?contact=${id}`)}>
            + Quote
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate(`/sales/payments/new?contact=${id}`)}>
            + Record Receipt
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate(`/sales/credit-notes/new?contact=${id}`)}>
            + Credit Note
          </Button>
          <Button size="sm" onClick={() => navigate(`/sales/invoices/new?contact=${id}`)}>
            + Invoice
          </Button>
        </div>
      </div>


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

      {tab === 'stmt' && (() => {
        // Phase 12.52 / 12.54 — friendly doc label derived from source_type
        // + account_code (account_code disambiguates payments that hit both
        // AR (1200) and Customer Advances (2400) in the same JE).
        const sourceLabel = (src?: string, fallback?: string, account_code?: string): string => {
          // Phase 14.08c — relabel the apply-advance entry as "Credit applied"
          // BEFORE the 2400 → "Customer advance" fallback fires. Otherwise
          // the AR-side of the apply JE renders as "invoice" (via the
          // related_doc_type fallback) and the 2400-side renders as
          // "Customer advance", making the pair look like an unrelated
          // duplicate when in fact it's one allocation event.
          if (src === 'advance_application') return 'Credit applied';
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
        // Phase 14.08e — apply-advance JEs are internal bookkeeping.
        //
        // The apply RPC posts Dr 2400 + Cr 1200 with equal amounts so the
        // customer's net position is unchanged (the 87.50 was already
        // counted as a credit at receipt time — applying it later just
        // moves the credit from Advances to AR).
        //
        // On a customer-facing Statement of Account (what the operator
        // emails to the customer), showing "Credit applied — Dr 87.50 /
        // Cr 87.50 / balance unchanged" reads like an accounting glitch.
        // The customer doesn't care about the apply event. The closing
        // balance already reflects the truth.
        //
        // So in default mode (Hide Reversed ON = the customer-facing
        // view) we hide both legs of every advance_application JE
        // entirely. In full-audit mode (Hide Reversed OFF) both legs
        // remain so the accountant can verify the textbook double entry.
        if (stmtHideReversed) {
          visibleLines = visibleLines.filter(l => l.source_type !== 'advance_application');
        }
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
            ref_type:   l.doc_type,
            doc_id:     l.doc_id ?? null,
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
              currency={contact?.currency ?? companyCurrency}
              side="customer"
              statusLabel={contact?.is_active === false ? 'Inactive' : 'Active'}
            />

            <HealthRow tiles={[
              {
                label: 'Available credit',
                value: contact?.credit_limit
                  ? `${contact?.currency ?? companyCurrency} ${fmt(Math.max(0, Number(contact.credit_limit) - outstandingTotal))}`
                  : '—',
                sublabel: contact?.credit_limit ? `of ${fmt(Number(contact.credit_limit))} limit` : 'no limit set',
                tone: 'brand',
              },
              {
                label: 'Overdue',
                value: `${contact?.currency ?? companyCurrency} ${fmt(overdueTotal)}`,
                sublabel: overdueTotal > 0 ? 'past due date' : 'all current',
                tone: overdueTotal > 0 ? 'danger' : 'good',
              },
              {
                label: '12-mo sales',
                value: `${contact?.currency ?? companyCurrency} ${fmt(sales12mo)}`,
                sublabel: `${confirmedInvoiceCount} invoices`,
              },
              {
                label: 'Last payment',
                value: paymentsForCustomer[0]
                  ? `${daysBetween(paymentsForCustomer[0].date as unknown as string, today)}d ago`
                  : '—',
                sublabel: paymentsForCustomer[0]
                  ? `${contact?.currency ?? companyCurrency} ${fmt(Number(paymentsForCustomer[0].amount))}`
                  : 'no payments yet',
              },
              {
                label: 'Risk',
                value: '●'.repeat(riskScore.dots) + '○'.repeat(3 - riskScore.dots) + ' ' + riskScore.label,
                tone: riskScore.dots >= 3 ? 'danger' : riskScore.dots === 2 ? 'warn' : 'good',
              },
            ]} />

            <BalanceStrip
              currency={contact?.currency ?? companyCurrency}
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
                currency={contact?.currency ?? companyCurrency}
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
                value: `${closing >= openingBalance ? '+' : ''}${companyCurrency} ${fmt(closing - openingBalance)}`,
                hint: closing > openingBalance ? 'balance grew' : closing < openingBalance ? 'balance reduced' : 'unchanged',
              },
            ]} />
          </StatementShell>
        );
      })()}
    </div>
  );
}
