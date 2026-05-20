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
import type { InvoiceRow } from '@/data/adapter';

const PAGE_SIZE = 50;

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Status pill matched to the sample look ────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const palette: Record<string, { bg: string; text: string; border: string }> = {
    draft:     { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
    confirmed: { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' },
    void:      { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' },
  };
  const p = palette[status] ?? { bg: theme.muted, text: theme.inkMuted, border: theme.border };
  return (
    <span style={{
      display: 'inline-block',
      padding: '3px 9px',
      borderRadius: '999px',
      fontSize: '11px', fontWeight: 600,
      textTransform: 'capitalize',
      background: p.bg, color: p.text,
      border: `1px solid ${p.border}`,
    }}>{status}</span>
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

  const { data: allInvoices = [], isLoading } = useQuery({
    queryKey: ['invoices', company_id],
    queryFn: () => getAdapter().invoices.list(company_id!),
    enabled: !!company_id,
  });

  const filtered = statusFilter
    ? (allInvoices as InvoiceRow[]).filter(inv => inv.status === statusFilter)
    : (allInvoices as InvoiceRow[]);

  const paged = paginate(filtered, page, PAGE_SIZE);

  function handleStatusChange(s: string) {
    setStatusFilter(s);
    setPage(1);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title={t('sales.invoices_title')}
        subtitle={`${filtered.length} ${filtered.length === 1 ? 'invoice' : 'invoices'}`}
        actions={
          <Button size="sm" onClick={() => navigate('/sales/invoices/new')}>
            + {t('sales.new_invoice')}
          </Button>
        }
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
                  <td className="px-4 py-3" style={{ color: theme.inkMuted, fontSize: '13px' }}>{inv.date}</td>
                  <td className="px-4 py-3" style={{ color: theme.inkMuted, fontSize: '13px' }}>{inv.due_date ?? '—'}</td>
                  <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '13px' }}>
                    {inv.currency} {fmt(Number(inv.total_amount))}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={inv.status} /></td>
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
