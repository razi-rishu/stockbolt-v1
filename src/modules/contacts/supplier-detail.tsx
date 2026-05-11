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
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import { Tabs } from '@/ui/tabs';
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

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft:                 'bg-gray-100 text-gray-700',
    sent:                  'bg-blue-50 text-blue-700',
    confirmed:             'bg-green-50 text-green-700',
    received:              'bg-green-50 text-green-700',
    partially_received:    'bg-purple-50 text-purple-700',
    billed:                'bg-teal-50 text-teal-700',
    closed:                'bg-gray-100 text-gray-500',
    void:                  'bg-red-50 text-red-500',
  };
  return (
    <span className={`rounded-pill px-2 py-0.5 text-[10px] font-medium capitalize ${map[status] ?? 'bg-gray-100 text-gray-700'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

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

export default function SupplierDetailPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [stmtFrom, setStmtFrom] = useState(monthsAgoIso(3));
  const [stmtTo, setStmtTo]     = useState(todayIso);
  const [tab, setTab] = useState<'overview' | 'docs' | 'stmt'>('overview');

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

  return (
    <div className="space-y-6 pb-16">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => navigate('/contacts/suppliers')} className="text-sm text-ink-secondary hover:text-ink-primary">
          ← {t('nav.suppliers')}
        </button>
        <span className="text-ink-tertiary">/</span>
        <h1 className="text-xl font-semibold text-ink-primary">{contact?.name ?? '…'}</h1>
        {contact?.name_ar && <span dir="rtl" className="text-sm text-ink-secondary">({contact.name_ar})</span>}
        <div className="ms-auto flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/contacts/suppliers?edit=${id}`)}>
            ✎ Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate('/purchasing/orders/new')}>
            + Purchase Order
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate('/purchasing/payments/new')}>
            + Pay Supplier
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate('/purchasing/debit-notes/new')}>
            + Debit Note
          </Button>
          <Button size="sm" onClick={() => navigate('/purchasing/bills/new')}>
            + Bill
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
            <div className="col-span-2"><p className="text-xs text-ink-tertiary">{t('contacts.address')}</p><p className="text-ink-primary">{[contact.address_street, contact.address_city, contact.address_country].filter(Boolean).join(', ') || '—'}</p></div>
          </div>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Outstanding"      value={fmt(outstandingTotal)} accent={outstandingTotal > 0 ? 'warn' : 'default'} sublabel={`${openBills.length} open bill${openBills.length === 1 ? '' : 's'}`} />
        <KpiTile label="Overdue"          value={fmt(overdueTotal)}     accent={overdueTotal > 0 ? 'danger' : 'good'}      sublabel="past due date" />
        <KpiTile label="Purchases (12 mo)" value={fmt(purchases12mo)}   sublabel={`${confirmedBillCount} confirmed bill${confirmedBillCount === 1 ? '' : 's'}`} />
        <KpiTile label="Bill count"       value={String(confirmedBillCount)} sublabel="confirmed only" />
      </div>

      {/* Aging */}
      <AgingBar buckets={aging} total={outstandingTotal} />

      {/* ── Tabs ──────────────────────────────────────────────────────── */}
      <Tabs
        value={tab}
        onChange={(v) => setTab(v as typeof tab)}
        items={[
          { value: 'overview', label: 'Overview', badge: openBills.length || undefined },
          { value: 'docs',     label: 'Documents', badge: (billsForSupplier.length + posForSupplier.length + paymentsForSupplier.length + allDebitNotes.length) || undefined },
          { value: 'stmt',     label: 'Statement' },
        ]}
      />

      {tab === 'overview' && (
      <>

      {/* Open Bills */}
      <Section title={`Open Bills (${openBills.length})`}>
        {openBills.length === 0 ? (
          <div className="px-5 py-6 text-sm text-ink-tertiary">No outstanding bills.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                <th className="px-4 py-2 text-start font-medium">Bill #</th>
                <th className="px-4 py-2 text-start font-medium">Date</th>
                <th className="px-4 py-2 text-start font-medium">Due date</th>
                <th className="px-4 py-2 text-end font-medium">Total</th>
                <th className="px-4 py-2 text-end font-medium">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {openBills.map(b => (
                <tr key={b.id}
                  onClick={() => navigate(`/purchasing/bills/${b.id}`)}
                  className="cursor-pointer border-b border-border-subtle last:border-0 hover:bg-surface-muted/50">
                  <td className="px-4 py-2 font-mono text-xs text-brand-600">{b.bill_number}</td>
                  <td className="px-4 py-2 text-ink-secondary">{b.date as unknown as string}</td>
                  <td className="px-4 py-2 text-ink-secondary">{(b.due_date as unknown as string | null) ?? '—'}</td>
                  <td className="px-4 py-2 text-end font-mono text-ink-secondary">{fmt(Number(b.total_amount))}</td>
                  <td className="px-4 py-2 text-end font-mono font-medium text-ink-primary">{fmt(b.outstanding)}</td>
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

      {/* All Bills */}
      <Section title={`All Bills (last ${billsForSupplier.length})`}>
        {billsForSupplier.length === 0 ? (
          <div className="px-5 py-6 text-sm text-ink-tertiary">No bills yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                <th className="px-4 py-2 text-start font-medium">Bill #</th>
                <th className="px-4 py-2 text-start font-medium">Date</th>
                <th className="px-4 py-2 text-start font-medium">Status</th>
                <th className="px-4 py-2 text-end font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {billsForSupplier.map(b => (
                <tr key={b.id}
                  onClick={() => navigate(`/purchasing/bills/${b.id}`)}
                  className="cursor-pointer border-b border-border-subtle last:border-0 hover:bg-surface-muted/50">
                  <td className="px-4 py-2 font-mono text-xs text-brand-600">{b.bill_number}</td>
                  <td className="px-4 py-2 text-ink-secondary">{b.date as unknown as string}</td>
                  <td className="px-4 py-2"><StatusBadge status={b.status} /></td>
                  <td className="px-4 py-2 text-end font-mono text-ink-primary">{b.currency} {fmt(Number(b.total_amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Purchase Orders */}
      <Section title={`Purchase Orders (${posForSupplier.length})`}>
        {posForSupplier.length === 0 ? (
          <div className="px-5 py-6 text-sm text-ink-tertiary">No purchase orders yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                <th className="px-4 py-2 text-start font-medium">PO #</th>
                <th className="px-4 py-2 text-start font-medium">Date</th>
                <th className="px-4 py-2 text-start font-medium">Status</th>
                <th className="px-4 py-2 text-end font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {posForSupplier.map(p => (
                <tr key={p.id}
                  onClick={() => navigate(`/purchasing/orders/${p.id}`)}
                  className="cursor-pointer border-b border-border-subtle last:border-0 hover:bg-surface-muted/50">
                  <td className="px-4 py-2 font-mono text-xs text-brand-600">{p.po_number}</td>
                  <td className="px-4 py-2 text-ink-secondary">{p.date as unknown as string}</td>
                  <td className="px-4 py-2"><StatusBadge status={p.status} /></td>
                  <td className="px-4 py-2 text-end font-mono text-ink-primary">{p.currency} {fmt(Number(p.total_amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Vendor Payments */}
      <Section title={`Payments (${paymentsForSupplier.length})`}>
        {paymentsForSupplier.length === 0 ? (
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
              {paymentsForSupplier.map(p => (
                <tr key={p.id}
                  onClick={() => navigate(`/purchasing/payments/${p.id}`)}
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

      {/* Debit Notes */}
      <Section title={`Debit Notes (${allDebitNotes.length})`}>
        {allDebitNotes.length === 0 ? (
          <div className="px-5 py-6 text-sm text-ink-tertiary">No debit notes yet.</div>
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
              {allDebitNotes.slice(0, 20).map(dn => (
                <tr key={dn.id}
                  onClick={() => navigate(`/purchasing/debit-notes/${dn.id}`)}
                  className="cursor-pointer border-b border-border-subtle last:border-0 hover:bg-surface-muted/50">
                  <td className="px-4 py-2 font-mono text-xs text-brand-600">{dn.debit_note_number}</td>
                  <td className="px-4 py-2 text-ink-secondary">{dn.date as unknown as string}</td>
                  <td className="px-4 py-2"><StatusBadge status={dn.status} /></td>
                  <td className="px-4 py-2 text-end font-mono text-ink-primary">{dn.currency} {fmt(Number(dn.total_amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      </>
      )}

      {tab === 'stmt' && (
      <>

      {/* Statement */}
      <div className="rounded-card border border-border-subtle bg-surface-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-5 py-3">
          <h2 className="text-sm font-semibold text-ink-primary">{t('purchasing.supplier_statement')}</h2>
          <div className="ms-auto flex items-center gap-2">
            <Input type="date" value={stmtFrom} onChange={(e) => setStmtFrom(e.target.value)} className="h-8 text-xs" />
            <span className="text-ink-tertiary">–</span>
            <Input type="date" value={stmtTo}   onChange={(e) => setStmtTo(e.target.value)}   className="h-8 text-xs" />
            <Button
              variant="ghost"
              size="sm"
              disabled={!id}
              onClick={() => window.open(`/print/supplier-statement/${id}?from=${stmtFrom}&to=${stmtTo}`, '_blank')}
              title="Open a print-ready statement in a new tab (use the browser's Print → Save as PDF)"
            >
              🖨 Print / PDF
            </Button>
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
                  <td className="px-4 py-2 text-end font-mono font-medium text-ink-primary">{fmt(line.balance)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-border-subtle bg-surface-muted font-semibold">
                <td colSpan={5} className="px-4 py-2 text-ink-primary">Closing balance</td>
                <td className="px-4 py-2 text-end font-mono text-ink-primary">{fmt(statement.closing_balance)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      </>
      )}
    </div>
  );
}
