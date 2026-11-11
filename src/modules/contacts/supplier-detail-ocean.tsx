/**
 * Supplier Details, Ocean Teal design (UI v1.1) — header, Overview and
 * Documents. Mirrors the customer page; the Statement tab uses the shared
 * StatementOcean.
 *
 * Presentation only. Every figure is computed by supplier-detail.tsx exactly
 * as before (outstanding, overdue, vendor advance on 1400, 12-month
 * purchases, net position, ageing); every action keeps its route: Edit, Bill,
 * Purchase order, Pay supplier, Debit note, Apply credit, Refund, document
 * drill-downs and the tabs.
 */
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, Pencil, CalendarDays, Link2, User, Mail, Layers, MapPin, Phone, Hash, Coins,
  Wallet, FileText, Plus, ShoppingCart, Banknote, FileMinus, TriangleAlert, StickyNote, Truck,
} from 'lucide-react';
import { formatDate } from '@/lib/locale';
import { RefundAdvanceModal } from './refund-advance-modal';
import { RefundDueBanner } from '@/components/refund-due-banner';
import { CustomerTabsOcean, type Tab } from './customer-overview-ocean';
import { DocSection, type DocRow } from './customer-documents-ocean';
import type { ContactRow, OpenVendorBill, PaymentRow, VendorBillRow, PurchaseOrderRow, DebitNoteRow } from '@/data/adapter';
import '@/styles/stockbolt-ocean-teal.css';

type Aging = { current: number; d31_60: number; d61_90: number; d90_plus: number };
const ICON = 20;

/** Supplier header: back pill, name, since / payment terms, actions. */
export function SupplierHeroOcean({ id, contact }: { id: string; contact: ContactRow | null | undefined }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const terms = contact ? (contact.payment_terms_days > 0 ? `Net ${contact.payment_terms_days}` : t('contacts.cod')) : '—';
  return (
    <div className="sb-hero">
      <button type="button" className="sb-back-pill" onClick={() => navigate('/contacts/suppliers')}>
        <ChevronLeft size={18} className="sb-flip" aria-hidden="true" />{t('nav.suppliers')}
      </button>
      <h1 className="sb-title">{contact?.name ?? '…'}</h1>
      {contact?.name_ar && <div className="sb-title-ar"><bdi>{contact.name_ar}</bdi></div>}
      <div className="sb-meta">
        {contact?.created_at && (
          <span className="sb-meta-item">
            <CalendarDays size={ICON} className="sb-icon" aria-hidden="true" />
            {t('customer360.since')}: <strong><bdi dir="ltr">{formatDate(contact.created_at)}</bdi></strong>
          </span>
        )}
        <span className="sb-meta-item">
          <Link2 size={ICON} className="sb-icon" aria-hidden="true" />
          {t('contacts.payment_terms')}: <strong>{terms}</strong>
        </span>
      </div>
      <div className="sb-actions">
        <button type="button" className="sb-primary-btn" onClick={() => navigate(`/contacts/suppliers?edit=${id}`)}>
          <Pencil size={18} aria-hidden="true" />{t('common.edit')}
        </button>
        <button type="button" className="sb-secondary-btn" onClick={() => navigate(`/purchasing/bills/new?contact=${id}`)}>
          <Plus size={18} aria-hidden="true" />{t('supplier360.action_bill')}
        </button>
        <button type="button" className="sb-secondary-btn" onClick={() => navigate(`/purchasing/orders/new?contact=${id}`)}>
          <ShoppingCart size={18} aria-hidden="true" />{t('supplier360.action_po')}
        </button>
        <button type="button" className="sb-secondary-btn" onClick={() => navigate(`/purchasing/payments/new?contact=${id}`)}>
          <Banknote size={18} aria-hidden="true" />{t('supplier360.action_pay')}
        </button>
        <button type="button" className="sb-secondary-btn" onClick={() => navigate(`/purchasing/debit-notes/new?contact=${id}`)}>
          <FileMinus size={18} aria-hidden="true" />{t('supplier360.action_debit_note')}
        </button>
      </div>
    </div>
  );
}

export interface SupplierOverviewOceanProps {
  id: string;
  contact: ContactRow | null | undefined;
  currency: string;
  openBills: OpenVendorBill[];
  paymentsForSupplier: PaymentRow[];
  outstandingTotal: number;
  overdueTotal: number;
  vendorAdvance: number;
  purchases12mo: number;
  confirmedBillCount: number;
  aging: Aging;
  docsCount: number;
  refundOpen: boolean;
  setRefundOpen: (open: boolean) => void;
  onRefundDone: () => void;
  onTab: (tab: Tab) => void;
  fmt: (n: number) => string;
}

function Money({ ccy, value, tone }: { ccy: string; value: string; tone?: string }) {
  return <div className={`sb-stat-value ${tone ?? ''}`}><span className="sb-ccy">{ccy}</span><bdi dir="ltr">{value}</bdi></div>;
}
function InfoRow({ icon, label, children, wide }: { icon: React.ReactNode; label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`sb-info-row ${wide ? 'sb-info-wide' : ''}`}>
      <span className="sb-icon" aria-hidden="true">{icon}</span>
      <div style={{ minWidth: 0 }}><div className="sb-info-label">{label}</div>{children}</div>
    </div>
  );
}

export function SupplierOverviewOcean(p: SupplierOverviewOceanProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { contact, fmt, currency: ccy } = p;
  const notProvided = <div className="sb-info-value sb-muted">{t('customer360.not_provided')}</div>;
  const val = (v: string | null | undefined) => (v && v.trim() ? <div className="sb-info-value">{v}</div> : notProvided);
  const terms = contact ? (contact.payment_terms_days > 0 ? `Net ${contact.payment_terms_days}` : t('contacts.cod')) : '—';
  const address = contact ? [contact.address_street, contact.address_city, contact.address_country].filter(Boolean).join(', ') : '';

  // Same rule as before: the latest confirmed vendor payment that is still
  // unallocated or partly allocated is where the credit came from.
  type AllocStatus = 'unallocated' | 'partial' | 'full' | null | undefined;
  const applyTarget = p.paymentsForSupplier
    .filter(x => x.status === 'confirmed')
    .filter(x => {
      const alloc = (x as PaymentRow & { allocation_status?: AllocStatus }).allocation_status;
      return alloc === 'unallocated' || alloc === 'partial';
    })
    .sort((a, b) => (b.date as unknown as string).localeCompare(a.date as unknown as string))[0];
  const hasOpenBill = p.openBills.length > 0;
  const net = p.outstandingTotal - p.vendorAdvance;

  const agingSegs = [
    { key: 'current', label: t('customer360.aging_current'), value: p.aging.current,  color: '#15803D' },
    { key: '31-60',   label: '31–60',                         value: p.aging.d31_60,   color: '#EAB308' },
    { key: '61-90',   label: '61–90',                         value: p.aging.d61_90,   color: '#F97316' },
    { key: '90+',     label: '90+',                           value: p.aging.d90_plus, color: '#DC2626' },
  ];

  return (
    <div className="sb-ocean sb-page" data-testid="supplier-overview-ocean">
      <SupplierHeroOcean id={p.id} contact={contact} />
      <div className="sb-body">
        {contact && (
          <section className="sb-card" aria-label={t('customer360.contact_info')}>
            <div className="sb-info-grid">
              <InfoRow icon={<User size={ICON} />} label={t('customer360.contact')}>{val(contact.contact_person_name)}</InfoRow>
              <InfoRow icon={<Phone size={ICON} />} label={t('contacts.phone')}>
                {contact.phone || contact.mobile ? <div className="sb-info-value"><bdi dir="ltr">{contact.phone ?? contact.mobile}</bdi></div> : notProvided}
              </InfoRow>
              <InfoRow icon={<Mail size={ICON} />} label={t('contacts.email')}>{val(contact.email)}</InfoRow>
              <InfoRow icon={<Hash size={ICON} />} label={t('contacts.tax_id')}>{val(contact.tax_id)}</InfoRow>
              <InfoRow icon={<Layers size={ICON} />} label={t('contacts.payment_terms')}><span className="sb-pill">{terms}</span></InfoRow>
              <InfoRow icon={<Coins size={ICON} />} label={t('contacts.currency')}>{val(contact.currency)}</InfoRow>
              <InfoRow icon={<MapPin size={ICON} />} label={t('contacts.address')} wide>{val(address)}</InfoRow>
            </div>
          </section>
        )}

        {/* Credit with supplier — vendor advance on 1400. */}
        {p.vendorAdvance > 0.005 && (
          <section className="sb-credit-card" aria-label={t('supplier360.credit_title')}>
            <span className="sb-credit-icon" aria-hidden="true"><Truck size={26} /></span>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <div className="sb-credit-title">{t('supplier360.credit_title')}</div>
              <div className="sb-credit-text">
                {t('supplier360.credit_text', { amount: `${ccy} ${fmt(p.vendorAdvance)}` })}{' '}
                <span style={{ color: 'var(--sb-text-secondary)' }}>{t('supplier360.credit_gl_note')}</span>
              </div>
              {applyTarget && !hasOpenBill && (
                <div className="sb-credit-text" style={{ color: 'var(--sb-text-secondary)', marginTop: 4 }}>{t('supplier360.credit_next_bill')}</div>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {applyTarget && hasOpenBill && (
                <button type="button" className="sb-primary-btn" style={{ background: 'var(--sb-success)' }}
                  onClick={() => navigate(`/purchasing/payments/${applyTarget.id}?apply=1`)}
                  title={`${t('customer360.apply_credit')} — ${applyTarget.payment_number}`}>
                  {t('customer360.apply_credit')}
                </button>
              )}
              <button type="button" className="sb-secondary-btn" onClick={() => p.setRefundOpen(true)} title={t('refund.title_vendor')}>
                {t('refund.refund_cta')}
              </button>
            </div>
            <RefundAdvanceModal
              open={p.refundOpen}
              onClose={() => p.setRefundOpen(false)}
              onDone={p.onRefundDone}
              side="vendor"
              contactId={p.id}
              contactName={contact?.name ?? ''}
              available={p.vendorAdvance}
              currency={ccy}
            />
          </section>
        )}

        {/* Debit balance on 2100 (debit note against a paid bill) — shared banner, unchanged. */}
        <RefundDueBanner side="vendor" contactId={p.id} contactName={contact?.name ?? ''} currency={ccy} />

        {/* The same four tiles and calculations as before. */}
        <div className="sb-stat-grid sb-stat-grid-4">
          <div className="sb-card sb-stat">
            <Wallet size={26} className="sb-icon" aria-hidden="true" />
            <div style={{ minWidth: 0 }}>
              <div className="sb-stat-label">{t('customer360.kpi_outstanding')}</div>
              <Money ccy={ccy} value={fmt(p.outstandingTotal)} tone={p.outstandingTotal > 0 ? 'sb-tone-warn' : undefined} />
              <div className="sb-stat-sub">{t('supplier360.kpi_open_bills', { count: p.openBills.length })}</div>
            </div>
          </div>
          {p.vendorAdvance > 0.005 ? (
            <div className="sb-card sb-stat">
              <Truck size={26} className="sb-icon" aria-hidden="true" />
              <div style={{ minWidth: 0 }}>
                <div className="sb-stat-label">{t('supplier360.kpi_advance')}</div>
                <Money ccy={ccy} value={fmt(p.vendorAdvance)} tone="sb-tone-good" />
                <div className="sb-stat-sub">{t('supplier360.kpi_advance_sub')}</div>
              </div>
            </div>
          ) : (
            <div className="sb-card sb-stat">
              <TriangleAlert size={26} className="sb-icon" aria-hidden="true" />
              <div style={{ minWidth: 0 }}>
                <div className="sb-stat-label">{t('customer360.kpi_overdue')}</div>
                <Money ccy={ccy} value={fmt(p.overdueTotal)} tone={p.overdueTotal > 0 ? 'sb-tone-danger' : 'sb-tone-good'} />
                <div className="sb-stat-sub">{t('customer360.kpi_overdue_sub')}</div>
              </div>
            </div>
          )}
          <div className="sb-card sb-stat">
            <FileText size={26} className="sb-icon" aria-hidden="true" />
            <div style={{ minWidth: 0 }}>
              <div className="sb-stat-label">{t('supplier360.kpi_purchases_12mo')}</div>
              <Money ccy={ccy} value={fmt(p.purchases12mo)} />
              <div className="sb-stat-sub">{t('supplier360.kpi_confirmed_bills', { count: p.confirmedBillCount })}</div>
            </div>
          </div>
          <div className="sb-card sb-stat">
            <Coins size={26} className="sb-icon" aria-hidden="true" />
            <div style={{ minWidth: 0 }}>
              <div className="sb-stat-label">{t('customer360.kpi_net')}</div>
              <Money ccy={ccy} value={fmt(Math.abs(net))} tone={net > 0.005 ? 'sb-tone-warn' : net < -0.005 ? 'sb-tone-good' : undefined} />
              <div className="sb-stat-sub">
                {net > 0.005 ? t('supplier360.net_we_owe') : net < -0.005 ? t('supplier360.net_owes_us') : t('customer360.net_settled')}
              </div>
            </div>
          </div>
        </div>

        <section className="sb-card" aria-label={t('customer360.aging_title')}>
          <div className="sb-section-head">
            <span>{t('customer360.aging_title')}</span>
            {p.outstandingTotal > 0.005 && <small>{t('customer360.aging_total')} <bdi dir="ltr">{ccy} {fmt(p.outstandingTotal)}</bdi></small>}
          </div>
          {p.outstandingTotal <= 0.005 ? (
            <div className="sb-note-empty" style={{ marginTop: 8 }}>{t('customer360.aging_none')}</div>
          ) : (
            <>
              <div className="sb-aging-track" role="img" aria-label={agingSegs.map(s => `${s.label} ${fmt(s.value)}`).join(', ')}>
                {agingSegs.map(s => {
                  const pct = (s.value / p.outstandingTotal) * 100;
                  return pct > 0 ? <div key={s.key} style={{ background: s.color, width: `${pct}%` }} title={`${s.label}: ${fmt(s.value)}`} /> : null;
                })}
              </div>
              <div className="sb-aging-legend">
                {agingSegs.map(s => (
                  <div key={s.key} className="sb-aging-item">
                    <span className="sb-aging-key"><span className="sb-aging-dot" style={{ background: s.color }} />{s.label}</span>
                    <span className="sb-aging-amt"><bdi dir="ltr">{fmt(s.value)}</bdi></span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="sb-card sb-note" aria-label={t('customer360.notes_title')}>
          <StickyNote size={22} className="sb-icon" aria-hidden="true" />
          {contact?.notes?.trim()
            ? <div className="sb-note-text">{contact.notes}</div>
            : <div className="sb-note-empty">{t('supplier360.notes_empty')}</div>}
        </section>

        <CustomerTabsOcean active="overview" openCount={p.openBills.length} docsCount={p.docsCount} onTab={p.onTab} />

        <section className="sb-card sb-list" aria-label={t('supplier360.open_bills')}>
          <div className="sb-list-head sb-section-head">
            <span>{t('supplier360.open_bills')} ({p.openBills.length})</span>
            {p.openBills.length > 0 && (
              <button type="button" className="sb-link" onClick={() => navigate('/purchasing/bills')}>{t('customer360.see_all')}</button>
            )}
          </div>
          {p.openBills.length === 0 ? (
            <div className="sb-empty">{t('supplier360.no_outstanding')}</div>
          ) : p.openBills.map(b => (
            <div key={b.id} className="sb-row" role="link" tabIndex={0}
              onClick={() => navigate(`/purchasing/bills/${b.id}`)}
              onKeyDown={e => { if (e.key === 'Enter') navigate(`/purchasing/bills/${b.id}`); }}>
              <div style={{ minWidth: 0 }}>
                <div className="sb-row-no"><bdi dir="ltr">{b.bill_number}</bdi></div>
                <div className="sb-row-meta">
                  {formatDate(b.date as unknown as string)}
                  {' · '}{t('customer360.due')} {(b.due_date as unknown as string | null) ? formatDate(b.due_date as unknown as string) : '—'}
                </div>
              </div>
              <div>
                <div className="sb-row-amt"><bdi dir="ltr">{fmt(b.outstanding)}</bdi></div>
                <div className="sb-row-sub">{t('customer360.of_total')} <bdi dir="ltr">{fmt(Number(b.total_amount))}</bdi></div>
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

export function SupplierDocumentsOcean(p: {
  id: string;
  contact: ContactRow | null | undefined;
  openCount: number;
  bills: VendorBillRow[];
  pos: PurchaseOrderRow[];
  payments: PaymentRow[];
  debitNotes: DebitNoteRow[];
  onTab: (tab: Tab) => void;
  fmt: (n: number) => string;
}) {
  const { t } = useTranslation();
  const money = (ccy: string | null | undefined, n: number) => `${ccy ?? ''} ${p.fmt(n)}`.trim();
  const d = (v: unknown) => v as unknown as string;
  const docsCount = p.bills.length + p.pos.length + p.payments.length + p.debitNotes.length;

  const bills: DocRow[] = p.bills.map(b => ({
    key: b.id, to: `/purchasing/bills/${b.id}`, number: b.bill_number, date: d(b.date), status: b.status, amount: money(b.currency, Number(b.total_amount)),
  }));
  const pos: DocRow[] = p.pos.map(o => ({
    key: o.id, to: `/purchasing/orders/${o.id}`, number: o.po_number, date: d(o.date), status: o.status, amount: money(o.currency, Number(o.total_amount)),
  }));
  const payments: DocRow[] = p.payments.map(x => ({
    key: x.id, to: `/purchasing/payments/${x.id}`, number: x.payment_number, date: d(x.date), status: x.status, amount: money(x.currency, Number(x.amount)),
  }));
  // Same 20-row cap the old table applied to debit notes.
  const debitNotes: DocRow[] = p.debitNotes.slice(0, 20).map(dn => ({
    key: dn.id, to: `/purchasing/debit-notes/${dn.id}`, number: dn.debit_note_number, date: d(dn.date), status: dn.status, amount: money(dn.currency, Number(dn.total_amount)),
  }));

  return (
    <div className="sb-ocean sb-page" data-testid="supplier-documents-ocean">
      <SupplierHeroOcean id={p.id} contact={p.contact} />
      <div className="sb-body">
        <CustomerTabsOcean active="docs" openCount={p.openCount} docsCount={docsCount} onTab={p.onTab} />
        <DocSection icon={<FileText size={20} />} title={t('supplier360.docs_bills')} rows={bills} empty={t('supplier360.docs_none_bills')} />
        <DocSection icon={<ShoppingCart size={20} />} title={t('supplier360.docs_pos')} rows={pos} empty={t('supplier360.docs_none_pos')} />
        <DocSection icon={<Banknote size={20} />} title={t('supplier360.docs_payments')} rows={payments} empty={t('supplier360.docs_none_payments')} />
        <DocSection icon={<FileMinus size={20} />} title={t('supplier360.docs_debit_notes')} rows={debitNotes} empty={t('supplier360.docs_none_debit_notes')} />
      </div>
    </div>
  );
}
