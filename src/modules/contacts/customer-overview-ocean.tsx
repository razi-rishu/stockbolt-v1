/**
 * Customer Details → Overview, Ocean Teal design (UI Design System v1.1).
 *
 * Presentation only. Every figure arrives as a prop, computed by
 * customer-detail.tsx exactly as before (outstanding, overdue, credit on
 * file, 12-month sales, net position, ageing); nothing is recalculated here
 * except the apply-credit target, which is the same rule moved verbatim.
 * All actions keep their routes: Edit, Quote, Record Receipt, Credit Note,
 * Invoice, Apply credit, Refund, open-invoice drill-down and the tabs.
 *
 * Scoped by the `.sb-ocean` wrapper (src/styles/stockbolt-ocean-teal.css), so
 * no other screen — including this page's Documents and Statement tabs — is
 * affected.
 */
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronLeft, Pencil, CalendarDays, Link2, User, Mail, Layers, MapPin, Phone, CreditCard,
  Wallet, FileText, Coins, Scale, StickyNote, Hash, Plus, Receipt, FileMinus, TriangleAlert,
} from 'lucide-react';
import { getAdapter } from '@/data/index';
import { formatDate } from '@/lib/locale';
import { RefundAdvanceModal } from './refund-advance-modal';
import { RefundDueBanner } from '@/components/refund-due-banner';
import type { ContactRow, OpenInvoice, PaymentRow, PriceLevelRow } from '@/data/adapter';
import '@/styles/stockbolt-ocean-teal.css';

type Tab = 'overview' | 'docs' | 'stmt';
type Aging = { current: number; d31_60: number; d61_90: number; d90_plus: number };

export interface CustomerOverviewOceanProps {
  id: string;
  company_id: string | null;
  contact: ContactRow | null | undefined;
  currency: string;
  openInvoices: OpenInvoice[];
  paymentsForCustomer: PaymentRow[];
  outstandingTotal: number;
  overdueTotal: number;
  advanceCredit: number;
  sales12mo: number;
  confirmedInvoiceCount: number;
  aging: Aging;
  docsCount: number;
  refundOpen: boolean;
  setRefundOpen: (open: boolean) => void;
  onRefundDone: () => void;
  onTab: (tab: Tab) => void;
  fmt: (n: number) => string;
}

const ICON = 20;

function Money({ ccy, value, tone }: { ccy: string; value: string; tone?: string }) {
  return (
    // The block follows the page direction (so it lines up with its label in
    // Arabic); <bdi dir="ltr"> keeps the digits themselves left-to-right.
    <div className={`sb-stat-value ${tone ?? ''}`}>
      <span className="sb-ccy">{ccy}</span><bdi dir="ltr">{value}</bdi>
    </div>
  );
}

function InfoRow({ icon, label, children, wide }: { icon: React.ReactNode; label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`sb-info-row ${wide ? 'sb-info-wide' : ''}`}>
      <span className="sb-icon" aria-hidden="true">{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div className="sb-info-label">{label}</div>
        {children}
      </div>
    </div>
  );
}

export function CustomerOverviewOcean(p: CustomerOverviewOceanProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { contact, fmt, currency: ccy } = p;

  // Name of the customer's default price level, read with the same query the
  // Settings screen uses (shared cache). Only fetched when one is set.
  const priceLevelId = contact?.default_price_level_id ?? null;
  const { data: priceLevels = [] } = useQuery<PriceLevelRow[]>({
    queryKey: ['priceLevels', p.company_id],
    queryFn: () => getAdapter().priceLevels.list(p.company_id!),
    enabled: !!p.company_id && !!priceLevelId,
  });
  const priceLevelName = priceLevelId ? priceLevels.find(l => l.id === priceLevelId)?.name ?? null : null;

  const notProvided = <div className="sb-info-value sb-muted">{t('customer360.not_provided')}</div>;
  const val = (v: string | null | undefined) => (v && v.trim() ? <div className="sb-info-value">{v}</div> : notProvided);
  const terms = contact ? (contact.payment_terms_days > 0 ? `Net ${contact.payment_terms_days}` : t('contacts.cod')) : '—';
  const address = contact ? [contact.address_street, contact.address_city, contact.address_country].filter(Boolean).join(', ') : '';

  // Same rule as before: the most recent confirmed receipt that is still
  // unallocated or partly allocated is where the credit came from.
  type AllocStatus = 'unallocated' | 'partial' | 'full' | null | undefined;
  const applyTarget = p.paymentsForCustomer
    .filter(x => x.status === 'confirmed')
    .filter(x => {
      const alloc = (x as PaymentRow & { allocation_status?: AllocStatus }).allocation_status;
      return alloc === 'unallocated' || alloc === 'partial';
    })
    .sort((a, b) => (b.date as unknown as string).localeCompare(a.date as unknown as string))[0];
  const hasOpenInvoice = p.openInvoices.length > 0;
  const net = p.outstandingTotal - p.advanceCredit;

  const agingSegs = [
    { key: 'current', label: t('customer360.aging_current'), value: p.aging.current,  color: '#15803D' },
    { key: '31-60',   label: '31–60',                         value: p.aging.d31_60,   color: '#EAB308' },
    { key: '61-90',   label: '61–90',                         value: p.aging.d61_90,   color: '#F97316' },
    { key: '90+',     label: '90+',                           value: p.aging.d90_plus, color: '#DC2626' },
  ];

  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: 'overview', label: t('customer360.tab_overview'), count: p.openInvoices.length || undefined },
    { value: 'docs',     label: t('customer360.tab_documents'), count: p.docsCount || undefined },
    { value: 'stmt',     label: t('customer360.tab_statement') },
  ];

  return (
    <div className="sb-ocean sb-page" data-testid="customer-overview-ocean">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="sb-hero">
        <button type="button" className="sb-back-pill" onClick={() => navigate('/contacts/customers')}>
          <ChevronLeft size={18} className="sb-flip" aria-hidden="true" />{t('nav.customers')}
        </button>
        <h1 className="sb-title">{contact?.name ?? '…'}</h1>
        {/* <bdi> keeps the Arabic name's own direction while it lines up with the page. */}
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
            {t('customer360.credit_terms')}: <strong>{terms}</strong>
          </span>
        </div>

        <div className="sb-actions">
          <button type="button" className="sb-primary-btn" onClick={() => navigate(`/contacts/customers?edit=${p.id}`)}>
            <Pencil size={18} aria-hidden="true" />{t('common.edit')}
          </button>
          <button type="button" className="sb-secondary-btn" onClick={() => navigate(`/sales/invoices/new?contact=${p.id}`)}>
            <Plus size={18} aria-hidden="true" />{t('customer360.action_invoice')}
          </button>
          <button type="button" className="sb-secondary-btn" onClick={() => navigate(`/sales/quotes/new?contact=${p.id}`)}>
            <FileText size={18} aria-hidden="true" />{t('customer360.action_quote')}
          </button>
          <button type="button" className="sb-secondary-btn" onClick={() => navigate(`/sales/payments/new?contact=${p.id}`)}>
            <Receipt size={18} aria-hidden="true" />{t('customer360.action_receipt')}
          </button>
          <button type="button" className="sb-secondary-btn" onClick={() => navigate(`/sales/credit-notes/new?contact=${p.id}`)}>
            <FileMinus size={18} aria-hidden="true" />{t('customer360.action_credit_note')}
          </button>
        </div>
      </div>

      <div className="sb-body">
        {/* ── Contact information ────────────────────────────────────────── */}
        {contact && (
          <section className="sb-card" aria-label={t('customer360.contact_info')}>
            <div className="sb-info-grid">
              <InfoRow icon={<User size={ICON} />} label={t('customer360.contact')}>{val(contact.contact_person_name)}</InfoRow>
              <InfoRow icon={<Phone size={ICON} />} label={t('contacts.phone')}>
                {contact.phone || contact.mobile ? <div className="sb-info-value"><bdi dir="ltr">{contact.phone ?? contact.mobile}</bdi></div> : notProvided}
              </InfoRow>
              <InfoRow icon={<Mail size={ICON} />} label={t('contacts.email')}>{val(contact.email)}</InfoRow>
              <InfoRow icon={<Hash size={ICON} />} label={t('contacts.tax_id')}>{val(contact.tax_id)}</InfoRow>
              <InfoRow icon={<Layers size={ICON} />} label={t('contacts.payment_terms')}>
                <span className="sb-pill">{terms}</span>
              </InfoRow>
              <InfoRow icon={<CreditCard size={ICON} />} label={t('customer360.price_group')}>{val(priceLevelName)}</InfoRow>
              {/* Credit LIMIT — the cap on what the customer may owe. Never mixed
                  with credit AVAILABLE (money we hold for them), shown below. */}
              <InfoRow icon={<Scale size={ICON} />} label={t('customer360.credit_limit')}>
                {contact.credit_limit > 0
                  ? <div className="sb-info-value"><bdi dir="ltr">{contact.currency} {fmt(contact.credit_limit)}</bdi></div>
                  : <div className="sb-info-value sb-muted">{t('customer360.no_credit_limit')}</div>}
              </InfoRow>
              <InfoRow icon={<Coins size={ICON} />} label={t('contacts.currency')}>{val(contact.currency)}</InfoRow>
              <InfoRow icon={<MapPin size={ICON} />} label={t('contacts.address')} wide>{val(address)}</InfoRow>
            </div>
          </section>
        )}

        {/* ── Credit available (customer advance on 2400) ─────────────────── */}
        {p.advanceCredit > 0.005 && (
          <section className="sb-credit-card" aria-label={t('customer360.credit_title')}>
            <span className="sb-credit-icon" aria-hidden="true"><Layers size={26} /></span>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <div className="sb-credit-title">{t('customer360.credit_title')}</div>
              <div className="sb-credit-text">
                {t(hasOpenInvoice ? 'customer360.credit_text_open' : 'customer360.credit_text_future', {
                  amount: `${ccy} ${fmt(p.advanceCredit)}`,
                })}{' '}
                <span style={{ color: 'var(--sb-text-secondary)' }}>{t('customer360.credit_gl_note')}</span>
              </div>
              {applyTarget && !hasOpenInvoice && (
                <div className="sb-credit-text" style={{ color: 'var(--sb-text-secondary)', marginTop: 4 }}>
                  {t('customer360.credit_next_invoice')}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {applyTarget && hasOpenInvoice && (
                <button type="button" className="sb-primary-btn" style={{ background: 'var(--sb-success)' }}
                  onClick={() => navigate(`/sales/payments/${applyTarget.id}?apply=1`)}
                  title={`${t('customer360.apply_credit')} — ${applyTarget.payment_number}`}>
                  {t('customer360.apply_credit')}
                </button>
              )}
              <button type="button" className="sb-secondary-btn" onClick={() => p.setRefundOpen(true)} title={t('refund.title_customer')}>
                {t('refund.refund_cta')}
              </button>
            </div>
            <RefundAdvanceModal
              open={p.refundOpen}
              onClose={() => p.setRefundOpen(false)}
              onDone={p.onRefundDone}
              side="customer"
              contactId={p.id}
              contactName={contact?.name ?? ''}
              available={p.advanceCredit}
              currency={ccy}
            />
          </section>
        )}

        {/* Credit sitting on 1200 from credit notes — the shared banner, unchanged. */}
        <RefundDueBanner side="customer" contactId={p.id} contactName={contact?.name ?? ''} currency={ccy} />

        {/* ── KPI tiles — the same four, same calculations ───────────────── */}
        <div className="sb-stat-grid sb-stat-grid-4">
          <div className="sb-card sb-stat">
            <Wallet size={26} className="sb-icon" aria-hidden="true" />
            <div style={{ minWidth: 0 }}>
              <div className="sb-stat-label">{t('customer360.kpi_outstanding')}</div>
              <Money ccy={ccy} value={fmt(p.outstandingTotal)} tone={p.outstandingTotal > 0 ? 'sb-tone-warn' : undefined} />
              <div className="sb-stat-sub">{t('customer360.kpi_open_invoices', { count: p.openInvoices.length })}</div>
            </div>
          </div>
          {p.advanceCredit > 0.005 ? (
            <div className="sb-card sb-stat">
              <CreditCard size={26} className="sb-icon" aria-hidden="true" />
              <div style={{ minWidth: 0 }}>
                <div className="sb-stat-label">{t('customer360.kpi_credit_available')}</div>
                <Money ccy={ccy} value={fmt(p.advanceCredit)} tone="sb-tone-good" />
                <div className="sb-stat-sub">{t('customer360.kpi_credit_sub')}</div>
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
              <div className="sb-stat-label">{t('customer360.kpi_sales_12mo')}</div>
              <Money ccy={ccy} value={fmt(p.sales12mo)} />
              <div className="sb-stat-sub">{t('customer360.kpi_confirmed', { count: p.confirmedInvoiceCount })}</div>
            </div>
          </div>
          <div className="sb-card sb-stat">
            <Coins size={26} className="sb-icon" aria-hidden="true" />
            <div style={{ minWidth: 0 }}>
              <div className="sb-stat-label">{t('customer360.kpi_net')}</div>
              <Money ccy={ccy} value={fmt(Math.abs(net))}
                tone={net > 0.005 ? 'sb-tone-warn' : net < -0.005 ? 'sb-tone-good' : undefined} />
              <div className="sb-stat-sub">
                {net > 0.005 ? t('customer360.net_owes_us') : net < -0.005 ? t('customer360.net_we_owe') : t('customer360.net_settled')}
              </div>
            </div>
          </div>
        </div>

        {/* ── Ageing ─────────────────────────────────────────────────────── */}
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

        {/* ── Notes (read-only; edited in the Edit form) ─────────────────── */}
        <section className="sb-card sb-note" aria-label={t('customer360.notes_title')}>
          <StickyNote size={22} className="sb-icon" aria-hidden="true" />
          {contact?.notes?.trim()
            ? <div className="sb-note-text">{contact.notes}</div>
            : <div className="sb-note-empty">{t('customer360.notes_empty')}</div>}
        </section>

        {/* ── Tabs ───────────────────────────────────────────────────────── */}
        <div className="sb-tabs" role="tablist">
          {tabs.map(tb => (
            <button key={tb.value} type="button" role="tab" aria-selected={tb.value === 'overview'}
              className={`sb-tab ${tb.value === 'overview' ? 'active' : ''}`} onClick={() => p.onTab(tb.value)}>
              {tb.label}{tb.count !== undefined && <span className="sb-tab-count">{tb.count}</span>}
            </button>
          ))}
        </div>

        {/* ── Open invoices ──────────────────────────────────────────────── */}
        <section className="sb-card sb-list" aria-label={t('customer360.open_invoices')}>
          <div className="sb-list-head sb-section-head">
            <span>{t('customer360.open_invoices')} ({p.openInvoices.length})</span>
            {p.openInvoices.length > 0 && (
              <button type="button" className="sb-link" onClick={() => navigate('/sales/invoices')}>{t('customer360.see_all')}</button>
            )}
          </div>
          {p.openInvoices.length === 0 ? (
            <div className="sb-empty">{t('customer360.no_outstanding')}</div>
          ) : p.openInvoices.map(inv => (
            <div key={inv.id} className="sb-row" role="link" tabIndex={0}
              onClick={() => navigate(`/sales/invoices/${inv.id}`)}
              onKeyDown={e => { if (e.key === 'Enter') navigate(`/sales/invoices/${inv.id}`); }}>
              <div style={{ minWidth: 0 }}>
                <div className="sb-row-no"><bdi dir="ltr">{inv.invoice_number}</bdi></div>
                <div className="sb-row-meta">
                  {formatDate(inv.date as unknown as string)}
                  {' · '}{t('customer360.due')} {(inv.due_date as unknown as string | null) ? formatDate(inv.due_date as unknown as string) : '—'}
                </div>
              </div>
              <div>
                <div className="sb-row-amt"><bdi dir="ltr">{fmt(inv.outstanding)}</bdi></div>
                <div className="sb-row-sub">{t('customer360.of_total')} <bdi dir="ltr">{fmt(Number(inv.total_amount))}</bdi></div>
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
