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
import { useParams } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useCompanyCurrency } from '@/hooks/use-company-currency';
import { CustomerOverviewOcean, CustomerHeroOcean, CustomerTabsOcean } from './customer-overview-ocean';
import { CustomerDocumentsOcean } from './customer-documents-ocean';
import { StatementOcean } from './statement/statement-ocean';
import type { PeriodPreset, SpineLine } from './statement/components';
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
  const { company_id } = useAuthStore();
  const { id } = useParams<{ id: string }>();
  const companyCurrency = useCompanyCurrency();   // Issue 1 — localize money to tenant currency

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

  // Statement: the existing statement document, inside the Ocean Teal header
  // and tabs. Its colours follow the Ocean tokens through --stmt-brand (set
  // under .sb-ocean); figures, filters, search, print and PDF are unchanged.
  return (
    <div className="pb-16">
    <div className="sb-ocean sb-page" data-testid="customer-statement-ocean">
      <div data-print-hide><CustomerHeroOcean id={id!} contact={contact} /></div>
      <div className="sb-body">
      <div data-print-hide>
        <CustomerTabsOcean active="stmt" openCount={openInvoices.length}
          docsCount={invoicesForCustomer.length + quotesForCustomer.length + paymentsForCustomer.length + allCreditNotes.length + salesReturnsForCustomer.length}
          onTab={setTab} />
      </div>

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
            case 'customer_receipt':    return 'Payment';
            case 'customer_advance':    return 'Customer advance';
            case 'pos_sale':            return 'POS sale';
            case 'credit_note':         return 'Credit note';
            case 'manual':              return 'Manual JE';
            case 'reversal':            return 'Reversal';
            case 'opening_balance':     return 'Opening balance';
            default: {
              const s0 = (fallback ?? src ?? 'JE').replace(/_/g, ' ');
              return s0.charAt(0).toUpperCase() + s0.slice(1);
            }
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
        // Search is applied by StatementOcean to the displayed rows only.
        const openingBalance = statement?.opening_balance ?? 0;
        let runBal = openingBalance;
        // Show the document's own number (INV-…, REC-…, CN-…) from the lists
        // this page already loads; the journal number stays as the reference.
        const docNumberById: Record<string, string> = {};
        for (const x of allInvoices) docNumberById[x.id] = x.invoice_number;
        for (const x of allPayments) docNumberById[x.id] = x.payment_number;
        for (const x of allCreditNotes) docNumberById[x.id] = x.credit_note_number;
        const spineLines: SpineLine[] = visibleLines.map(l => {
          runBal += l.debit - l.credit;
          return {
            date:       l.date,
            doc_type:   sourceLabel(l.source_type, l.doc_type, l.account_code),
            doc_number: (l.doc_id && docNumberById[l.doc_id]) || l.doc_number,
            ref_type:   l.doc_type,
            doc_id:     l.doc_id ?? null,
            reference:  l.doc_id && docNumberById[l.doc_id] ? l.doc_number : null,
            debit:      l.debit,
            credit:     l.credit,
            balance:    runBal,
            dimmed:     !stmtHideReversed && (l.is_reversed || l.is_reversal),
          };
        });
        const closing = stmtHideReversed ? runBal : (statement?.closing_balance ?? runBal);

        return (
          <StatementOcean
            side="customer"
            currency={contact?.currency ?? companyCurrency}
            loading={stmtLoading}
            preset={stmtPreset}
            onPreset={setPresetRange}
            from={stmtFrom}
            to={stmtTo}
            onFrom={(v) => { setStmtPreset('custom'); setStmtFrom(v); }}
            onTo={(v) => { setStmtPreset('custom'); setStmtTo(v); }}
            hideReversed={stmtHideReversed}
            onHideReversed={setStmtHideReversed}
            search={stmtSearch}
            onSearch={setStmtSearch}
            openingBalance={openingBalance}
            lines={spineLines}
            closingBalance={closing}
            outstanding={openInvoices.map(inv => ({
              id: inv.id, number: inv.invoice_number, date: inv.date as unknown as string,
              due_date: (inv.due_date as unknown as string | null) ?? null,
              total: Number(inv.total_amount), outstanding: inv.outstanding, to: `/sales/invoices/${inv.id}`,
            }))}
            overdue={overdueTotal}
            creditOnFile={Number(advanceCredit ?? 0)}
            onPrint={() => window.print()}
            pdfUrl={`/print/statement/${id}?from=${stmtFrom}&to=${stmtTo}`}
            fmt={fmt}
          />
        );
      })()}
      </div>
    </div>
    </div>
  );
}
