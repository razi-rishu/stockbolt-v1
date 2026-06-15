import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Pagination, paginate } from '@/ui/pagination';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import { StatusBadge } from '@/ui/status-badge';
import { ListFilters } from '@/ui/list-filters';
import type { InvoiceRow, ContactRow } from '@/data/adapter';

const PAGE_SIZE = 50;

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Payment-status badge (Zoho-style: the question is "am I paid?") ───────
function PayBadge({ status, total, applied, dueDate, today }: {
  status: string; total: number; applied: number; dueDate: string | null; today: string;
}) {
  // Draft / void keep the document badge.
  if (status !== 'confirmed') return <StatusBadge status={status} />;
  const outstanding = total - applied;
  const cfg =
    outstanding <= 0.005
      ? { label: 'Paid',      bg: '#ecfdf5', text: '#047857', border: '#a7f3d0' }
      : dueDate && dueDate < today
      ? { label: 'Overdue',   bg: '#fef2f2', text: '#dc2626', border: '#fecaca' }
      : applied > 0.005
      ? { label: 'Partially paid', bg: '#fffbeb', text: '#b45309', border: '#fde68a' }
      : { label: 'Unpaid',    bg: '#f5f3ff', text: '#6d28d9', border: '#ddd6fe' };
  return (
    <span style={{
      display: 'inline-block', padding: '3px 9px', borderRadius: '999px',
      fontSize: '11px', fontWeight: 600,
      background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}`,
    }}>{cfg.label}</span>
  );
}

// ── Filter pill (used for status filter row) ──────────────────────────────
function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 14px',
        borderRadius: '999px',
        fontSize: '12px', fontWeight: 600,
        border: active ? `1px solid ${theme.brand}` : `1px solid ${theme.border}`,
        background: active ? theme.brand : '#fff',
        color: active ? '#fff' : theme.inkMuted,
        cursor: 'pointer',
        transition: 'background-color .12s, color .12s, border-color .12s',
      }}
    >{label}</button>
  );
}

export default function InvoicesPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
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

  // Payments applied per invoice — drives the Paid / Partial / Unpaid /
  // Overdue badge and the real Outstanding stat.
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

  const paged = paginate(filtered, page, PAGE_SIZE);

  function handleStatusChange(s: string) {
    setStatusFilter(s);
    setPage(1);
  }

  // ── Stat totals computed from full list (not filtered) ──────────────────
  const allRows = allInvoices as InvoiceRow[];
  const today = new Date().toISOString().slice(0, 10);
  // Outstanding = total minus payments applied (was previously gross total).
  const outstandingOf = (i: InvoiceRow) => Math.max(0, Number(i.total_amount ?? 0) - (appliedMap[i.id] ?? 0));
  const totalOutstanding = allRows.filter(i => i.status === 'confirmed').reduce((s, i) => s + outstandingOf(i), 0);
  const totalOverdue    = allRows.filter(i => i.status === 'confirmed' && i.due_date && i.due_date < today).reduce((s, i) => s + outstandingOf(i), 0);
  const totalDraft      = allRows.filter(i => i.status === 'draft').reduce((s, i) => s + Number(i.total_amount ?? 0), 0);
  const totalInvoiced   = allRows.filter(i => i.status !== 'void').reduce((s, i) => s + Number(i.total_amount ?? 0), 0);
  const countConfirmed  = allRows.filter(i => i.status === 'confirmed').length;
  const countOverdue    = allRows.filter(i => i.status === 'confirmed' && i.due_date && i.due_date < today).length;
  const countDraft      = allRows.filter(i => i.status === 'draft').length;

  const currency = allRows[0]?.currency ?? 'AED';
  const statCard = (label: string, value: string, valueColor: string, sub: string, dotColor: string) => (
    <div style={{ background: '#fff', border: '1px solid #e4e4e7', borderRadius: '12px', padding: '14px 18px', flex: 1, boxShadow: '0 1px 2px rgba(9,9,11,.05)' }}>
      <div style={{ fontSize: '10px', fontWeight: 700, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '6px' }}>{label}</div>
      <div style={{ fontSize: '20px', fontWeight: 800, color: valueColor, letterSpacing: '-.5px', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: '11px', color: '#a1a1aa', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '5px' }}>
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

      {/* ── Stat cards row ─────────────────────────────────────────────── */}
      {!isLoading && allRows.length > 0 && (
        <div style={{ display: 'flex', gap: '10px' }}>
          {statCard('Total Outstanding', `${currency} ${fmt(totalOutstanding)}`, '#09090b', `${countConfirmed} confirmed`, '#7c3aed')}
          {statCard('Overdue', `${currency} ${fmt(totalOverdue)}`, '#dc2626', `${countOverdue} past due`, '#dc2626')}
          {statCard('Total Invoiced', `${currency} ${fmt(totalInvoiced)}`, '#16a34a', `${allRows.length} invoices`, '#16a34a')}
          {statCard('Draft', `${currency} ${fmt(totalDraft)}`, '#d97706', `${countDraft} pending`, '#d97706')}
        </div>
      )}

      {/* Search + date-range filter */}
      <ListFilters
        search={search}
        onSearch={(v) => { setSearch(v); setPage(1); }}
        searchPlaceholder={t('sales.search_invoices') || 'Search invoice # or customer…'}
        dateFrom={dateFrom}
        onDateFrom={(v) => { setDateFrom(v); setPage(1); }}
        dateTo={dateTo}
        onDateTo={(v) => { setDateTo(v); setPage(1); }}
      />

      {/* Status filter row */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {['', 'draft', 'confirmed', 'void'].map(s => (
          <FilterPill
            key={s}
            label={s === '' ? t('common.all') : s.charAt(0).toUpperCase() + s.slice(1)}
            active={statusFilter === s}
            onClick={() => handleStatusChange(s)}
          />
        ))}
      </div>

      {isLoading ? (
        <p style={{ fontSize: '13px', color: theme.inkFaint, padding: '24px 0', textAlign: 'center' }}>{t('common.loading')}</p>
      ) : filtered.length === 0 ? (
        <p style={{ fontSize: '13px', color: theme.inkFaint, padding: '48px 0', textAlign: 'center' }}>{t('sales.invoices_empty')}</p>
      ) : (
        <div
          className="overflow-x-auto bg-white"
          style={{ border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: theme.shadowSm }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}` }}>
                {[
                  { l: t('sales.invoice_number'), a: 'start' as const },
                  { l: t('sales.customer'),       a: 'start' as const },
                  { l: t('sales.date'),           a: 'start' as const },
                  { l: t('sales.due_date'),       a: 'start' as const },
                  { l: t('sales.total_amount'),   a: 'end'   as const },
                  { l: t('sales.status'),         a: 'start' as const },
                ].map(c => (
                  <th
                    key={c.l}
                    className="px-4 py-3"
                    style={{
                      fontSize: '11px', fontWeight: 600, color: theme.inkMuted,
                      textTransform: 'uppercase', letterSpacing: '.06em',
                      textAlign: c.a, whiteSpace: 'nowrap',
                    }}
                  >{c.l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map((inv, idx) => (
                <tr
                  key={inv.id}
                  onClick={() => navigate(`/sales/invoices/${inv.id}`)}
                  className="cursor-pointer"
                  style={{
                    borderTop: idx === 0 ? 'none' : '1px solid #f1f5f9',
                    transition: 'background-color .12s',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.panelHead; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                >
                  <td className="px-4 py-3 font-mono" style={{ fontSize: '12px', color: theme.brandSoftText, fontWeight: 600 }}>{inv.invoice_number}</td>
                  <td className="px-4 py-3" style={{ color: theme.ink, fontSize: '13px', fontWeight: 500 }}>{customerMap[inv.contact_id] ?? '—'}</td>
                  <td className="px-4 py-3" style={{ color: theme.inkMuted, fontSize: '13px' }}>{inv.date}</td>
                  <td className="px-4 py-3" style={{ color: theme.inkMuted, fontSize: '13px' }}>{inv.due_date ?? '—'}</td>
                  <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '13px' }}>
                    {inv.currency} {fmt(Number(inv.total_amount))}
                  </td>
                  <td className="px-4 py-3">
                    <PayBadge
                      status={inv.status}
                      total={Number(inv.total_amount ?? 0)}
                      applied={appliedMap[inv.id] ?? 0}
                      dueDate={inv.due_date}
                      today={today}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={filtered.length}
            onChange={setPage}
            className="border-t"
          />
        </div>
      )}
    </div>
  );
}
