import { formatDate } from '@/lib/locale';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useMatch, Outlet } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useCompanyCurrency } from '@/hooks/use-company-currency';
import { VoidedToggle } from '@/ui/voided-toggle';
import { useHideVoided } from '@/hooks/use-hide-voided';
import { StatusBadge } from '@/ui/status-badge';
import { Plus } from 'lucide-react';
import '@/styles/stockbolt-ocean-teal.css';
import { ListFilters } from '@/ui/list-filters';
import { useState } from 'react';
import type { InvoiceRow, ContactRow } from '@/data/adapter';

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Payment-status badge (Zoho-style: the question is "am I paid?") ───────
// `dueDate` and `today` are both ISO yyyy-mm-dd, so the string comparison is
// a date comparison. (It used to receive the formatted dd/mm/yyyy date, which
// made "Overdue" depend on the day of the month.)
function PayBadge({ status, total, applied, dueDate, today }: {
  status: string; total: number; applied: number; dueDate: string | null; today: string;
}) {
  const { t } = useTranslation();
  if (status !== 'confirmed') return <StatusBadge status={status} />;
  const outstanding = total - applied;
  const cfg =
    outstanding <= 0.005
      ? { key: 'paid',    tone: 'sb-pill-good' }
      : dueDate && dueDate < today
      ? { key: 'overdue', tone: 'sb-pill-bad' }
      : applied > 0.005
      ? { key: 'partial', tone: 'sb-pill-warn' }
      : { key: 'unpaid',  tone: '' };
  return <span className={`sb-pill ${cfg.tone}`} style={{ marginTop: 0, fontSize: 12, padding: '2px 10px' }}>{t(`docStatus.${cfg.key}`)}</span>;
}

/**
 * Invoices workspace — master-detail (list + preview pane).
 *
 * Left: a compact, searchable/filterable invoice list. Right: an <Outlet/> that
 * renders the existing view-first invoice editor for the selected id (or the
 * /new editor). Selecting a row navigates to /sales/invoices/:id, swapping the
 * right pane while the list stays put. No posting logic is touched here — the
 * detail/editor component is reused as-is.
 */
export default function InvoicesPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const companyCurrency = useCompanyCurrency();
  const navigate = useNavigate();
  const selMatch = useMatch('/sales/invoices/:id');
  const selectedId = selMatch?.params.id;

  const [statusFilter, setStatusFilter] = useState('');

  const { hideVoided, setHideVoided } = useHideVoided('stockbolt.list.invoices.voided');

  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data: allInvoices = [], isLoading } = useQuery({
    queryKey: ['invoices', company_id],
    queryFn: () => getAdapter().invoices.list(company_id!),
    enabled: !!company_id,
  });
  const { data: customers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'customer'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'customer'),
    enabled: !!company_id,
  });
  const customerMap = Object.fromEntries(customers.map(c => [c.id, c.name]));

  const { data: appliedMap = {} } = useQuery<Record<string, number>>({
    queryKey: ['invoice_applied_map', company_id],
    queryFn: () => getAdapter().payments.getAppliedMap(company_id!, 'invoice'),
    enabled: !!company_id,
  });

  const q = search.trim().toLowerCase();
  // Z4 — how many the default view is holding back right now.
  const voidedCount = (allInvoices as InvoiceRow[]).filter(r => r.status === 'void').length;
  const filtered = (allInvoices as InvoiceRow[]).filter(inv => {
    if (statusFilter && inv.status !== statusFilter) return false;
    // Z4 — hidden unless the user has explicitly asked for the void
    // status, in which case showing them is the whole point.
    if (!statusFilter && hideVoided && inv.status === 'void') return false;
    if (dateFrom && (inv.date as string) < dateFrom) return false;
    if (dateTo && (inv.date as string) > dateTo) return false;
    if (q) {
      const name = (customerMap[inv.contact_id] ?? '').toLowerCase();
      if (!inv.invoice_number.toLowerCase().includes(q) && !name.includes(q)) return false;
    }
    return true;
  });

  const allRows = allInvoices as InvoiceRow[];
  const today = new Date().toISOString().slice(0, 10);
  const outstandingOf = (i: InvoiceRow) => Math.max(0, Number(i.total_amount ?? 0) - (appliedMap[i.id] ?? 0));
  const totalOutstanding = allRows.filter(i => i.status === 'confirmed').reduce((s, i) => s + outstandingOf(i), 0);
  const totalOverdue = allRows.filter(i => i.status === 'confirmed' && i.due_date && i.due_date < today).reduce((s, i) => s + outstandingOf(i), 0);
  const countConfirmed = allRows.filter(i => i.status === 'confirmed').length;
  const countOverdue = allRows.filter(i => i.status === 'confirmed' && i.due_date && i.due_date < today).length;
  // With no invoices yet there is no row to read; the company's own currency
  // is the honest label, not a fixed 'AED'.
  const currency = allRows[0]?.currency ?? companyCurrency;

  // A single-line stat segment inside the slim strip below — label, value
  // and sub-count share one row instead of stacking across three.

  // Ocean Teal (UI v1.1): look only — same list, search, period, status
  // filter, voided toggle, totals and preview pane as before.
  return (
    <div className="sb-ocean sb-page sb-inv" data-testid="invoices-ocean">
      <div className="sb-hero">
        <div className="sb-clist-head">
          <div style={{ minWidth: 0 }}>
            <h1 className="sb-title" style={{ marginTop: 0 }}>{t('sales.invoices_title')}</h1>
            <div className="sb-clist-count">{t('salesOcean.invoices_count', { count: filtered.length })}</div>
          </div>
          <div className="sb-actions" style={{ marginTop: 0 }}>
            <button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => navigate('/sales/invoices/new')}>
              <Plus size={18} aria-hidden="true" />{t('sales.new_invoice')}
            </button>
          </div>
        </div>
        {!isLoading && allRows.length > 0 && (
          <div className="sb-inv-stats">
            <div className="sb-card sb-inv-stat">
              <span className="sb-info-label">{t('salesOcean.outstanding')}</span>
              <bdi dir="ltr" className="sb-inv-stat-val">{currency} {fmt(totalOutstanding)}</bdi>
              <span className="sb-fx-name">{t('salesOcean.confirmed_count', { count: countConfirmed })}</span>
            </div>
            <div className="sb-card sb-inv-stat">
              <span className="sb-info-label">{t('salesOcean.overdue')}</span>
              <bdi dir="ltr" className="sb-inv-stat-val is-bad">{currency} {fmt(totalOverdue)}</bdi>
              <span className="sb-fx-name">{t('salesOcean.past_due_count', { count: countOverdue })}</span>
            </div>
          </div>
        )}
      </div>

      <div className="sb-body">
        {/* ── list (full-width until an invoice is opened, then side-by-side) ── */}
        <div className={selectedId ? 'flex flex-col lg:flex-row' : ''} style={{ gap: '16px' }}>
          {/* Below lg the opened invoice replaces the list; Back returns to it. */}
          <aside className={`flex-col ${selectedId ? 'hidden lg:flex lg:w-[340px] lg:shrink-0' : 'flex w-full'}`} style={{ gap: '10px' }}>
            <div className="sb-inv-filters">
              <ListFilters
                search={search}
                onSearch={setSearch}
                searchPlaceholder={t('sales.search_invoices') || 'Search invoice # or customer…'}
                storageKey="stockbolt.list.invoices.period"
                onDateFrom={setDateFrom}
                onDateTo={setDateTo}
              />
            </div>
            <div className="sb-chips" style={{ marginTop: 0 }} role="group" aria-label={t('sales.status')}>
              {['', 'draft', 'confirmed', 'void'].map(s => (
                <button key={s} type="button" aria-pressed={statusFilter === s} className={`sb-chip ${statusFilter === s ? 'active' : ''}`} onClick={() => setStatusFilter(s)}>
                  {s === '' ? t('common.all') : t(`docStatus.${s}`)}
                </button>
              ))}
              {/* Z4 — only meaningful on the All view. */}
              {!statusFilter && (
                <VoidedToggle hideVoided={hideVoided} onChange={setHideVoided} count={voidedCount} />
              )}
            </div>
            <div className={`sb-card sb-inv-list ${selectedId ? 'is-narrow' : ''}`}>
              {isLoading ? (
                <div className="sb-empty">{t('common.loading')}</div>
              ) : filtered.length === 0 ? (
                <div className="sb-empty" style={{ textAlign: 'center' }}>{t('sales.invoices_empty')}</div>
              ) : (
                filtered.map((inv) => {
                  const active = inv.id === selectedId;
                  return (
                    <button
                      key={inv.id}
                      type="button"
                      onClick={() => navigate(`/sales/invoices/${inv.id}`)}
                      aria-current={active ? 'true' : undefined}
                      className={`sb-inv-row ${active ? 'active' : ''}`}
                    >
                      <span className="sb-inv-row-top">
                        <bdi dir="ltr" className="sb-inv-no">{inv.invoice_number}</bdi>
                        <PayBadge status={inv.status} total={Number(inv.total_amount ?? 0)} applied={appliedMap[inv.id] ?? 0} dueDate={inv.due_date ?? null} today={today} />
                      </span>
                      <span className="sb-inv-row-mid">
                        <span className="sb-dash-ellipsis" style={{ fontWeight: 600 }}>{customerMap[inv.contact_id] ?? '—'}</span>
                        <bdi dir="ltr" className="sb-inv-amt">{inv.currency} {fmt(Number(inv.total_amount))}</bdi>
                      </span>
                      <bdi dir="ltr" className="sb-fx-name" style={{ fontSize: 12 }}>{formatDate(inv.date)}</bdi>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          {/* RIGHT — the opened invoice, in its own scroll box. */}
          {selectedId && (
            <div className="min-w-0 flex-1 lg:max-h-[82vh] lg:overflow-y-auto" style={{ overscrollBehavior: 'contain' }}>
              <Outlet />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
