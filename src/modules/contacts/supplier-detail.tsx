/**
 * Supplier detail page — the "supplier 360" view.
 * Mirror of customer-detail.tsx but for the AP side.
 *
 * Sections:
 *   1. Header: back link, name, Edit + quick actions
 *   2. Contact info card
 *   3. KPI tiles: Outstanding (AP), Overdue, 12-mo Purchases, Bill Count
 *   4. Aging bar
 *   5. Open Vendor Bills (with outstanding)
 *   6. All Vendor Bills (last 20, with status badges)
 *   7. Purchase Orders (last 20)
 *   8. Vendor Payments (last 20)
 *   9. Debit Notes (last 20)
 *  10. Supplier Statement (date range)
 */
import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useCompanyCurrency } from '@/hooks/use-company-currency';
import { SupplierOverviewOcean, SupplierDocumentsOcean, SupplierHeroOcean } from './supplier-detail-ocean';
import { CustomerTabsOcean } from './customer-overview-ocean';
import { StatementOcean } from './statement/statement-ocean';
import type { PeriodPreset, SpineLine } from './statement/components';
import type {
  ContactRow, VendorBillRow, OpenVendorBill, PaymentRow,
  DebitNoteRow, PurchaseOrderRow,
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

export default function SupplierDetailPage() {
  const { company_id } = useAuthStore();
  const { id } = useParams<{ id: string }>();
  const companyCurrency = useCompanyCurrency();   // Issue 1 — localize money to tenant currency

  const [stmtFrom, setStmtFrom] = useState(monthsAgoIso(3));
  const [stmtTo, setStmtTo]     = useState(todayIso);
  const [tab, setTab] = useState<'overview' | 'docs' | 'stmt'>('overview');
  // S4 — record money the supplier sends back against an advance we paid.
  const [refundOpen, setRefundOpen] = useState(false);
  // P4 — the other pot: a debit balance on 2100, not an advance on 1400.
  const qc = useQueryClient();
  // Phase 14.07 — statement period preset, search, audit-trail toggle.
  const [stmtPreset, setStmtPreset] = useState<PeriodPreset>('last_90');
  const [stmtSearch, setStmtSearch] = useState('');
  const [stmtHideReversed, setStmtHideReversed] = useState(true);
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

  const { data: contact } = useQuery<ContactRow | null>({
    queryKey: ['contact', id],
    queryFn: () => getAdapter().contacts.getById(id!),
    enabled: !!id,
  });

  const { data: openBills = [] } = useQuery<OpenVendorBill[]>({
    queryKey: ['open_bills', company_id, id],
    queryFn: () => getAdapter().vendorBills.listOpenForSupplier(company_id!, id!),
    enabled: !!company_id && !!id,
  });

  // Phase 12.50 — Vendor Advance balance (1400). Positive means we paid
  // the supplier upfront / overpaid an earlier bill — i.e. they owe us
  // that credit which we can apply to a future bill. Without this query
  // the supplier balance ignored overpayments entirely.
  // P4 — money this supplier owes US, sitting as a DEBIT balance on 2100.
  // A debit note against an already-paid bill puts it there, and 1400 never
  // sees it. Read NET, so a supplier we still owe more to nets to zero or
  // below and offers no refund — which is correct: offset it against the
  // open bill instead.
  const { data: vendorAdvance = 0 } = useQuery<number>({
    queryKey: ['advance_balance', company_id, id, '1400'],
    queryFn: () => getAdapter().contacts.getAdvanceBalance(company_id!, id!, '1400'),
    enabled: !!company_id && !!id,
  });

  const { data: allBills = [] } = useQuery<VendorBillRow[]>({
    queryKey: ['vendor_bills', company_id],
    queryFn: () => getAdapter().vendorBills.list(company_id!),
    enabled: !!company_id,
  });

  const { data: allPayments = [] } = useQuery<PaymentRow[]>({
    queryKey: ['vendor_payments', company_id],
    queryFn: () => getAdapter().vendorPayments.list(company_id!),
    enabled: !!company_id,
  });

  const { data: allPOs = [] } = useQuery<PurchaseOrderRow[]>({
    queryKey: ['purchase_orders', company_id],
    queryFn: () => getAdapter().purchaseOrders.list(company_id!),
    enabled: !!company_id,
  });

  const { data: allDebitNotes = [] } = useQuery<DebitNoteRow[]>({
    queryKey: ['debit_notes', company_id, id],
    queryFn: () => getAdapter().debitNotes.list(company_id!, { supplier_id: id }),
    enabled: !!company_id && !!id,
  });

  const { data: statement, isLoading: stmtLoading } = useQuery({
    queryKey: ['supplier_statement', company_id, id, stmtFrom, stmtTo],
    queryFn: () => getAdapter().reports.getSupplierStatement(company_id!, id!, stmtFrom, stmtTo),
    enabled: !!company_id && !!id,
  });

  // Derived
  const billsForSupplier = useMemo(
    () => allBills.filter(b => b.supplier_id === id).slice(0, 20),
    [allBills, id],
  );
  const paymentsForSupplier = useMemo(
    () => allPayments.filter(p => p.contact_id === id).slice(0, 20),
    [allPayments, id],
  );
  const posForSupplier = useMemo(
    () => allPOs.filter(p => p.supplier_id === id).slice(0, 20),
    [allPOs, id],
  );

  // KPIs
  const outstandingTotal = useMemo(
    () => openBills.reduce((s, b) => s + b.outstanding, 0),
    [openBills],
  );
  const today = todayIso();
  const overdueTotal = useMemo(
    () => openBills
      .filter(b => b.due_date && (b.due_date as unknown as string) < today)
      .reduce((s, b) => s + b.outstanding, 0),
    [openBills, today],
  );
  const year_ago = monthsAgoIso(12);
  const purchases12mo = useMemo(() => {
    return allBills
      .filter(b => b.supplier_id === id && b.status === 'confirmed' && (b.date as unknown as string) >= year_ago)
      .reduce((s, b) => s + Number(b.total_amount), 0);
  }, [allBills, id, year_ago]);
  const confirmedBillCount = useMemo(
    () => allBills.filter(b => b.supplier_id === id && b.status === 'confirmed').length,
    [allBills, id],
  );

  // Aging buckets
  const aging = useMemo(() => {
    const b = { current: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
    for (const bill of openBills) {
      const ref = (bill.due_date as unknown as string | null) ?? (bill.date as unknown as string);
      const days = daysBetween(ref, today);
      if (days <= 30) b.current += bill.outstanding;
      else if (days <= 60) b.d31_60 += bill.outstanding;
      else if (days <= 90) b.d61_90 += bill.outstanding;
      else b.d90_plus += bill.outstanding;
    }
    return b;
  }, [openBills, today]);

  const docsCount = billsForSupplier.length + posForSupplier.length + paymentsForSupplier.length + allDebitNotes.length;

  // Overview and Documents: Ocean Teal (UI v1.1). Same figures, same actions.
  if (tab === 'overview') {
    return (
      <div className="pb-16">
        <SupplierOverviewOcean
          id={id!}
          contact={contact}
          currency={contact?.currency ?? companyCurrency}
          openBills={openBills}
          paymentsForSupplier={paymentsForSupplier}
          outstandingTotal={outstandingTotal}
          overdueTotal={overdueTotal}
          vendorAdvance={vendorAdvance}
          purchases12mo={purchases12mo}
          confirmedBillCount={confirmedBillCount}
          aging={aging}
          docsCount={docsCount}
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
  if (tab === 'docs') {
    return (
      <div className="pb-16">
        <SupplierDocumentsOcean
          id={id!}
          contact={contact}
          openCount={openBills.length}
          bills={billsForSupplier}
          pos={posForSupplier}
          payments={paymentsForSupplier}
          debitNotes={allDebitNotes}
          onTab={setTab}
          fmt={fmt}
        />
      </div>
    );
  }

  // Statement: same lines, labels and running balance as before (reversed and
  // advance-application rules unchanged), shown in the shared StatementOcean.
  // Doc label mapping mirrors the AP-side journal source types.
  const sourceLabel = (src?: string, fallback?: string, account_code?: string): string => {
    // Phase 14.08c — apply-advance pair on the supplier side is
    // Dr 2100 AP + Cr 1400 Vendor Advances. Relabel as "Credit
    // applied" before the 1400 fallback fires; same reasoning as
    // the customer side.
    if (src === 'advance_application') return 'Credit applied';
    if (account_code === '1400') return 'Vendor advance';
    switch (src) {
      case 'vendor_bill':       return 'Bill';
      case 'vendor_bill_void':  return 'Bill (void)';
      case 'vendor_bill_edit':  return 'Bill (edit)';
      case 'vendor_payment':    return 'Payment';
      case 'vendor_advance':    return 'Vendor advance';
      case 'debit_note':        return 'Debit note';
      case 'manual':            return 'Manual JE';
      case 'reversal':          return 'Reversal';
      case 'opening_balance':   return 'Opening balance';
      default: {
        const s0 = (fallback ?? src ?? 'JE').replace(/_/g, ' ');
        return s0.charAt(0).toUpperCase() + s0.slice(1);
      }
    }
  };

  const allLines = statement?.lines ?? [];
  // SupplierStatementLine carries is_reversed / is_reversal too —
  // mirrors Phase 12.52 customer side. Use safe access so this still
  // works if the adapter hasn't been updated yet.
  type AnyLine = typeof allLines[number] & {
    is_reversed?: boolean; is_reversal?: boolean;
    source_type?: string;  account_code?: string;
  };
  const lines0 = allLines as AnyLine[];
  let visibleLines = stmtHideReversed
    ? lines0.filter(l => !l.is_reversed && !l.is_reversal)
    : lines0;
  // Phase 14.08e — hide apply-advance entirely in default mode so
  // the SOA reads cleanly when sent to the supplier. Full-audit
  // mode (Hide Reversed OFF) keeps both legs visible for the
  // accountant.
  if (stmtHideReversed) {
    visibleLines = visibleLines.filter(l => l.source_type !== 'advance_application');
  }
  // Search is applied by StatementOcean to the displayed rows only.
  const openingBalance = statement?.opening_balance ?? 0;
  // Supplier statement convention: positive balance = we owe supplier
  // (i.e. credit side accumulates). Spine math follows the same rule.
  let runBal = openingBalance;
  // Show the document's own number (bill, payment, debit note) from the lists
  // this page already loads; the journal number stays as the reference.
  const docNumberById: Record<string, string> = {};
  for (const x of allBills) docNumberById[x.id] = x.bill_number;
  for (const x of allPayments) docNumberById[x.id] = x.payment_number;
  for (const x of allDebitNotes) docNumberById[x.id] = x.debit_note_number;
  const spineLines: SpineLine[] = visibleLines.map(l => {
    runBal += l.credit - l.debit;
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
    <div className="pb-16">
    <div className="sb-ocean sb-page" data-testid="supplier-statement-ocean">
      <div data-print-hide><SupplierHeroOcean id={id!} contact={contact} /></div>
      <div className="sb-body">
        <div data-print-hide>
          <CustomerTabsOcean active="stmt" openCount={openBills.length} docsCount={docsCount} onTab={setTab} />
        </div>
        <StatementOcean
          side="supplier"
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
          outstanding={openBills.map(bl => ({
            id: bl.id, number: bl.bill_number, date: bl.date as unknown as string,
            due_date: (bl.due_date as unknown as string | null) ?? null,
            total: Number(bl.total_amount), outstanding: bl.outstanding, to: `/purchasing/bills/${bl.id}`,
          }))}
          overdue={overdueTotal}
          creditOnFile={Number(vendorAdvance ?? 0)}
          onPrint={() => window.print()}
          pdfUrl={`/print/supplier-statement/${id}?from=${stmtFrom}&to=${stmtTo}`}
          fmt={fmt}
        />
      </div>
    </div>
    </div>
  );
}
