import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Pagination, paginate } from '@/ui/pagination';
import type { InvoiceRow } from '@/data/adapter';

const PAGE_SIZE = 50;

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft:     'bg-yellow-50 text-yellow-700',
    confirmed: 'bg-green-50 text-green-700',
    void:      'bg-red-50 text-red-600',
  };
  return (
    <span className={`rounded-pill px-2 py-0.5 text-xs font-medium capitalize ${map[status] ?? 'bg-gray-50 text-gray-600'}`}>
      {status}
    </span>
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

  // Client-side filter + pagination
  const filtered = statusFilter
    ? (allInvoices as InvoiceRow[]).filter(inv => inv.status === statusFilter)
    : (allInvoices as InvoiceRow[]);

  const paged = paginate(filtered, page, PAGE_SIZE);

  function handleStatusChange(s: string) {
    setStatusFilter(s);
    setPage(1);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-ink-primary">{t('sales.invoices_title')}</h1>
        {/* Status filter pills */}
        <div className="flex gap-1 ms-auto">
          {['', 'draft', 'confirmed', 'void'].map(s => (
            <button
              key={s}
              onClick={() => handleStatusChange(s)}
              className={`rounded-pill px-3 py-1 text-xs font-medium transition-colors
                ${statusFilter === s
                  ? 'bg-brand-600 text-white'
                  : 'bg-surface-muted text-ink-secondary hover:bg-surface-card border border-border-subtle'
                }`}
            >
              {s === '' ? t('common.all') : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => navigate('/sales/invoices/new')}>
          {t('sales.new_invoice')}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-ink-secondary">{t('common.loading')}</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-ink-tertiary">{t('sales.invoices_empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border-subtle bg-surface-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                <th className="px-4 py-2.5 text-start font-medium">{t('sales.invoice_number')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('sales.date')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('sales.due_date')}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t('sales.total_amount')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('sales.status')}</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((inv) => (
                <tr
                  key={inv.id}
                  className="cursor-pointer border-b border-border-subtle last:border-0 hover:bg-surface-muted/50"
                  onClick={() => navigate(`/sales/invoices/${inv.id}`)}
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-brand-600">{inv.invoice_number}</td>
                  <td className="px-4 py-2.5 text-ink-secondary">{inv.date}</td>
                  <td className="px-4 py-2.5 text-ink-secondary">{inv.due_date ?? '—'}</td>
                  <td className="px-4 py-2.5 text-end font-mono text-ink-primary">
                    {inv.currency} {fmt(Number(inv.total_amount))}
                  </td>
                  <td className="px-4 py-2.5"><StatusBadge status={inv.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={filtered.length}
            onChange={setPage}
            className="border-t border-border-subtle"
          />
        </div>
      )}
    </div>
  );
}
