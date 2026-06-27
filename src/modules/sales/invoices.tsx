import { formatDate } from '@/lib/locale';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useMatch, Outlet } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import { StatusBadge } from '@/ui/status-badge';
import { ListFilters } from '@/ui/list-filters';
import { useState } from 'react';
import type { InvoiceRow, ContactRow } from '@/data/adapter';

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Payment-status badge (Zoho-style: the question is "am I paid?") ───────
function PayBadge({ status, total, applied, dueDate, today }: {
  status: string; total: number; applied: number; dueDate: string | null; today: string;
}) {
  if (status !== 'confirmed') return <StatusBadge status={status} />;
  const outstanding = total - applied;
  const cfg =
    outstanding <= 0.005
      ? { label: 'Paid',      bg: '#ecfdf5', text: '#047857', border: '#a7f3d0' }
      : dueDate && dueDate < today
      ? { label: 'Overdue',   bg: '#fef2f2', text: '#dc2626', border: '#fecaca' }
      : applied > 0.005
      ? { label: 'Partial',   bg: '#fffbeb', text: '#b45309', border: '#fde68a' }
      : { label: 'Unpaid',    bg: '#f5f3ff', text: '#6d28d9', border: '#ddd6fe' };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: '999px',
      fontSize: '10px', fontWeight: 600, whiteSpace: 'nowrap',
      background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}`,
    }}>{cfg.label}</span>
  );
}

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '5px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 600,
        border: active ? `1px solid ${theme.brand}` : `1px solid ${theme.border}`,
        background: active ? theme.brand : '#fff',
        color: active ? '#fff' : theme.inkMuted,
        cursor: 'pointer', transition: 'background-color .12s, color .12s, border-color .12s',
      }}
    >{label}</button>
  );
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
  const navigate = useNavigate();
  const selMatch = useMatch('/sales/invoices/:id');
  const selectedId = selMatch?.params.id;

  const [statusFilter, setStatusFilter] = useState('');
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
  const filtered = (allInvoices as InvoiceRow[]).filter(inv => {
    if (statusFilter && inv.status !== statusFilter) return false;
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
  const currency = allRows[0]?.currency ?? 'AED';

  const statCard = (label: string, value: string, valueColor: string, sub: string, dotColor: string) => (
    <div style={{ background: '#fff', border: '1px solid #e4e4e7', borderRadius: '12px', padding: '12px 16px', flex: 1, boxShadow: '0 1px 2px rgba(9,9,11,.05)' }}>
      <div style={{ fontSize: '10px', fontWeight: 700, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '5px' }}>{label}</div>
      <div style={{ fontSize: '18px', fontWeight: 800, color: valueColor, letterSpacing: '-.5px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      <div style={{ fontSize: '11px', color: '#a1a1aa', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '5px' }}>
        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
        {sub}
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <PageHeader
        title={t('sales.invoices_title')}
        subtitle={`${filtered.length} ${filtered.length === 1 ? 'invoice' : 'invoices'}`}
        actions={
          <Button size="sm" onClick={() => navigate('/sales/invoices/new')}>
            + {t('sales.new_invoice')}
          </Button>
        }
      />

      {!isLoading && allRows.length > 0 && (
        <div style={{ display: 'flex', gap: '10px' }}>
          {statCard('Outstanding', `${currency} ${fmt(totalOutstanding)}`, '#09090b', `${countConfirmed} confirmed`, '#7c3aed')}
          {statCard('Overdue', `${currency} ${fmt(totalOverdue)}`, '#dc2626', `${countOverdue} past due`, '#dc2626')}
        </div>
      )}

      {/* ── master-detail split ─────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row" style={{ gap: '16px' }}>
        {/* LEFT — list */}
        <aside className="flex flex-col lg:w-[340px] lg:shrink-0" style={{ gap: '10px' }}>
          <ListFilters
            search={search}
            onSearch={setSearch}
            searchPlaceholder={t('sales.search_invoices') || 'Search invoice # or customer…'}
            dateFrom={dateFrom}
            onDateFrom={setDateFrom}
            dateTo={dateTo}
            onDateTo={setDateTo}
          />
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {['', 'draft', 'confirmed', 'void'].map(s => (
              <FilterPill key={s} label={s === '' ? t('common.all') : s.charAt(0).toUpperCase() + s.slice(1)} active={statusFilter === s} onClick={() => setStatusFilter(s)} />
            ))}
          </div>
          <div className="bg-white" style={{ border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: theme.shadowSm, maxHeight: '68vh', overflowY: 'auto' }}>
            {isLoading ? (
              <p style={{ fontSize: '13px', color: theme.inkFaint, padding: '24px 0', textAlign: 'center' }}>{t('common.loading')}</p>
            ) : filtered.length === 0 ? (
              <p style={{ fontSize: '13px', color: theme.inkFaint, padding: '36px 12px', textAlign: 'center' }}>{t('sales.invoices_empty')}</p>
            ) : (
              filtered.map((inv, idx) => {
                const active = inv.id === selectedId;
                return (
                  <button
                    key={inv.id}
                    onClick={() => navigate(`/sales/invoices/${inv.id}`)}
                    className="w-full text-start"
                    style={{
                      display: 'block', padding: '10px 12px', cursor: 'pointer',
                      borderTop: idx === 0 ? 'none' : '1px solid #f1f5f9',
                      borderLeft: active ? `3px solid ${theme.brand}` : '3px solid transparent',
                      background: active ? '#f5f3ff' : 'transparent',
                      transition: 'background-color .12s',
                    }}
                    onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = theme.panelHead; }}
                    onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <span className="font-mono" style={{ fontSize: '12px', fontWeight: 600, color: theme.brandSoftText }}>{inv.invoice_number}</span>
                      <PayBadge status={inv.status} total={Number(inv.total_amount ?? 0)} applied={appliedMap[inv.id] ?? 0} dueDate={formatDate(inv.due_date)} today={today} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginTop: '3px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 500, color: theme.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{customerMap[inv.contact_id] ?? '—'}</span>
                      <span className="font-mono" style={{ fontSize: '12px', color: theme.inkMuted, whiteSpace: 'nowrap' }}>{inv.currency} {fmt(Number(inv.total_amount))}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: theme.inkFaint, marginTop: '2px' }}>{formatDate(inv.date)}</div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* RIGHT — detail / editor */}
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
