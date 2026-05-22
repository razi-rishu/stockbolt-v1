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
import { Button } from '@/ui/button';
import { Tabs } from '@/ui/tabs';
import { theme } from '@/ui/theme';
// Phase 14.07 — Signature Statement experience (shared with customer side).
import {
  StatementShell, RelationshipHeader, HealthRow, BalanceStrip,
  PeriodFilter, TransactionSpine, ActionShelf, ShelfButton, InsightStrip,
  stmt as stmtTokens,
  type PeriodPreset, type SpineLine,
} from './statement/components';
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
  const map: Record<string, { bg: string; text: string; border: string }> = {
    draft:              { bg: theme.muted,     text: theme.inkMuted, border: theme.border },
    sent:               { bg: '#eff6ff',       text: '#1d4ed8',      border: '#bfdbfe' },
    confirmed:          { bg: '#f0fdf4',       text: '#15803d',      border: '#bbf7d0' },
    received:           { bg: '#f0fdf4',       text: '#15803d',      border: '#bbf7d0' },
    partially_received: { bg: theme.purpleSoft,text: theme.purple,   border: theme.purpleBorder },
    billed:             { bg: '#f0fdfa',       text: '#0f766e',      border: '#99f6e4' },
    closed:             { bg: theme.muted,     text: theme.inkFaint, border: theme.border },
    void:               { bg: '#fef2f2',       text: '#ef4444',      border: '#fecaca' },
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

export default function SupplierDetailPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [stmtFrom, setStmtFrom] = useState(monthsAgoIso(3));
  const [stmtTo, setStmtTo]     = useState(todayIso);
  const [tab, setTab] = useState<'overview' | 'docs' | 'stmt'>('overview');
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

      {/* Phase 12.50 — Vendor Advance / overpayment banner. When we've
           paid the supplier more than they've billed us, the excess sits
           in 1400 Vendor Advances. Surface it explicitly so the operator
           knows there's a credit to apply against the next bill — mirror
           of the customer-side "Credit on file" banner. */}
      {vendorAdvance > 0.005 && (() => {
        // Phase 14.08 — find the most-recent unallocated/partial confirmed
        // vendor payment so the "Apply credit" CTA can deep-link to the
        // apply-advance modal. Mirror of the customer-side banner.
        type AllocStatus = 'unallocated' | 'partial' | 'full' | null | undefined;
        const candidates = paymentsForSupplier
          .filter(p => p.status === 'confirmed')
          .filter(p => {
            const alloc = (p as PaymentRow & { allocation_status?: AllocStatus }).allocation_status;
            return alloc === 'unallocated' || alloc === 'partial';
          })
          .sort((a, b) => (b.date as unknown as string).localeCompare(a.date as unknown as string));
        const applyTarget = candidates[0];
        const hasOpenBill = openBills.length > 0;

        return (
          <div className="rounded-card border border-emerald-200 bg-emerald-50 px-5 py-3 flex flex-wrap items-center gap-4">
            <span className="rounded-pill bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
              CREDIT WITH SUPPLIER
            </span>
            <p className="flex-1 min-w-[260px] text-sm text-emerald-900">
              We have{' '}
              <span className="font-mono font-semibold">{contact?.currency ?? 'AED'} {fmt(vendorAdvance)}</span>{' '}
              paid in advance / overpaid to this supplier.{' '}
              <span className="text-emerald-700/80">Hits 1400 Vendor Advances on the GL.</span>
            </p>
            {applyTarget && hasOpenBill && (
              <Button
                size="sm"
                onClick={() => navigate(`/purchasing/payments/${applyTarget.id}?apply=1`)}
                title={`Apply credit from ${applyTarget.payment_number} against an open bill`}
              >
                Apply credit →
              </Button>
            )}
            {applyTarget && !hasOpenBill && (
              <span className="text-xs text-emerald-700/80">
                No open bills — credit will apply to the next one received.
              </span>
            )}
          </div>
        );
      })()}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Outstanding"      value={fmt(outstandingTotal)} accent={outstandingTotal > 0 ? 'warn' : 'default'} sublabel={`${openBills.length} open bill${openBills.length === 1 ? '' : 's'}`} />
        {/* Phase 12.50 — replace Overdue with Advance Paid when supplier
             is in credit (no overdue bills possible when nothing is open
             AND we have a credit balance). Always shows the most material
             number first. */}
        {vendorAdvance > 0.005 ? (
          <KpiTile
            label="Advance Paid"
            value={fmt(vendorAdvance)}
            accent="good"
            sublabel="credit with supplier"
          />
        ) : (
          <KpiTile label="Overdue" value={fmt(overdueTotal)} accent={overdueTotal > 0 ? 'danger' : 'good'} sublabel="past due date" />
        )}
        <KpiTile label="Purchases (12 mo)" value={fmt(purchases12mo)}   sublabel={`${confirmedBillCount} confirmed bill${confirmedBillCount === 1 ? '' : 's'}`} />
        {/* Phase 12.50 — Net Position replaces raw "Bill count" so the
             user sees one consolidated number. Negative means we have
             more credit than we owe (typical for prepaid vendors). */}
        <KpiTile
          label="Net Position"
          value={fmt(Math.abs(outstandingTotal - vendorAdvance))}
          accent={
            outstandingTotal - vendorAdvance > 0.005 ? 'warn'
            : outstandingTotal - vendorAdvance < -0.005 ? 'good'
            : 'default'
          }
          sublabel={
            outstandingTotal - vendorAdvance > 0.005 ? 'we owe supplier'
            : outstandingTotal - vendorAdvance < -0.005 ? 'supplier owes us'
            : 'settled'
          }
        />
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

      {tab === 'stmt' && (() => {
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
            default:                  return (fallback ?? src ?? 'JE').replace(/_/g, ' ');
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
        if (stmtSearch.trim()) {
          const q = stmtSearch.trim().toLowerCase();
          visibleLines = visibleLines.filter(l =>
            (l.doc_number ?? '').toLowerCase().includes(q) ||
            (l.doc_type   ?? '').toLowerCase().includes(q)
          );
        }
        const openingBalance = statement?.opening_balance ?? 0;
        // Supplier statement convention: positive balance = we owe supplier
        // (i.e. credit side accumulates). Spine math follows the same rule.
        let runBal = openingBalance;
        const spineLines: SpineLine[] = visibleLines.map(l => {
          runBal += l.credit - l.debit;
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

        const netPayable = outstandingTotal - Number(vendorAdvance ?? 0);

        const avgPayDays = (() => {
          const bills = allBills.filter(b => b.supplier_id === id && b.status === 'confirmed');
          if (bills.length === 0) return null;
          const pays = paymentsForSupplier.filter(p => p.status === 'confirmed');
          if (pays.length === 0) return null;
          const days = pays.map(p => {
            const candidate = bills.find(b => (b.date as unknown as string) <= (p.date as unknown as string));
            if (!candidate) return null;
            return daysBetween(candidate.date as unknown as string, p.date as unknown as string);
          }).filter((d): d is number => d !== null && d >= 0);
          if (days.length === 0) return null;
          return Math.round(days.reduce((s, x) => s + x, 0) / days.length);
        })();

        const supplierDependency = (() => {
          if (purchases12mo <= 0) return null;
          // Simple share: this supplier's 12M / sum of all confirmed 12M.
          const yearAgo = monthsAgoIso(12);
          const totalConfirmed = allBills
            .filter(b => b.status === 'confirmed' && (b.date as unknown as string) >= yearAgo)
            .reduce((s, b) => s + Number(b.total_amount), 0);
          if (totalConfirmed <= 0) return null;
          return Math.round((purchases12mo / totalConfirmed) * 100);
        })();

        return (
          <StatementShell>
            <div style={{
              display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
              gap: '16px', marginBottom: '20px',
            }}>
              <div>
                <div style={{
                  fontSize: '10.5px', fontWeight: 600, color: stmtTokens.inkMuted,
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                }}>Supplier Statement</div>
                <div style={{ marginTop: '4px', fontSize: '12.5px', color: stmtTokens.inkSoft }}>
                  Period {stmtFrom} — {stmtTo}
                </div>
              </div>
              <ActionShelf>
                <ShelfButton onClick={() => window.print()}>🖨 Print</ShelfButton>
                <ShelfButton
                  variant="primary"
                  onClick={() => window.open(`/print/supplier-statement/${id}?from=${stmtFrom}&to=${stmtTo}`, '_blank')}
                  disabled={!id}
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
                credit_limit: null,                       // not relevant on AP side
                since:   null,
              }}
              balance={netPayable}
              currency="AED"
              side="vendor"
              statusLabel={contact?.is_active === false ? 'Inactive' : 'Active'}
            />

            <HealthRow tiles={[
              {
                label: 'Open bills',
                value: `AED ${fmt(outstandingTotal)}`,
                sublabel: `${openBills.length} bill${openBills.length === 1 ? '' : 's'} open`,
                tone: 'brand',
              },
              {
                label: 'Overdue payable',
                value: `AED ${fmt(overdueTotal)}`,
                sublabel: overdueTotal > 0 ? 'past due date' : 'all current',
                tone: overdueTotal > 0 ? 'danger' : 'good',
              },
              {
                label: '12-mo purchases',
                value: `AED ${fmt(purchases12mo)}`,
                sublabel: `${confirmedBillCount} bills`,
              },
              {
                label: 'Last payment',
                value: paymentsForSupplier[0]
                  ? `${daysBetween(paymentsForSupplier[0].date as unknown as string, today)}d ago`
                  : '—',
                sublabel: paymentsForSupplier[0]
                  ? `AED ${fmt(Number(paymentsForSupplier[0].amount))}`
                  : 'no payments yet',
              },
              {
                label: 'Dependency',
                value: supplierDependency !== null ? `${supplierDependency}%` : '—',
                sublabel: supplierDependency !== null ? 'of total purchasing' : undefined,
                tone: supplierDependency !== null && supplierDependency > 40 ? 'warn' : 'default',
              },
            ]} />

            <BalanceStrip
              currency="AED"
              total={outstandingTotal}
              title="Payable aging"
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
                label: 'Bills in period',
                value: String(spineLines.filter(l => l.doc_type === 'Bill').length),
              },
              {
                label: 'Payments in period',
                value: String(spineLines.filter(l => l.doc_type === 'Payment').length),
              },
              {
                label: 'Net activity',
                value: `${closing >= openingBalance ? '+' : ''}AED ${fmt(closing - openingBalance)}`,
                hint: closing > openingBalance ? 'payable grew' : closing < openingBalance ? 'payable reduced' : 'unchanged',
              },
            ]} />
          </StatementShell>
        );
      })()}
    </div>
  );
}
