import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Pagination, paginate } from '@/ui/pagination';
import type { PaymentRow } from '@/data/adapter';

const PAGE_SIZE = 50;

// Type extension until the Supabase generated types pick up the new
// payments.allocation_status column from Phase 12.11 migration.
type AllocStatus = 'unallocated' | 'partial' | 'full' | null;
type PaymentWithAlloc = PaymentRow & { allocation_status?: AllocStatus };

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

// Secondary badge: how much of a confirmed payment has actually been
// applied. Hidden for non-confirmed states (draft/void) where it isn't
// meaningful.
function AllocationBadge({ status, alloc }: { status: string; alloc: AllocStatus }) {
  if (status !== 'confirmed' || !alloc) return null;
  const map: Record<string, { label: string; cls: string }> = {
    unallocated: { label: 'Advance',    cls: 'bg-purple-50 text-purple-700' },
    partial:     { label: 'Partial',    cls: 'bg-amber-50 text-amber-700'   },
    full:        { label: 'Fully applied', cls: 'bg-sky-50 text-sky-700'    },
  };
  const cfg = map[alloc];
  if (!cfg) return null;
  return (
    <span className={`ml-1 rounded-pill px-2 py-0.5 text-xs font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

export default function PaymentsPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const { data: allPayments = [], isLoading } = useQuery({
    queryKey: ['payments', company_id],
    queryFn: () => getAdapter().payments.list(company_id!, 'inbound'),
    enabled: !!company_id,
  });

  const paged = paginate(allPayments as PaymentWithAlloc[], page, PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink-primary">{t('payments.title')}</h1>
        <Button size="sm" onClick={() => navigate('/sales/payments/new')}>
          {t('payments.new_payment')}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-ink-secondary">{t('common.loading')}</p>
      ) : allPayments.length === 0 ? (
        <p className="text-sm text-ink-tertiary">{t('payments.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border-subtle bg-surface-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                <th className="px-4 py-2.5 text-start font-medium">{t('payments.payment_number')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('payments.date')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('payments.classification')}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t('payments.amount')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('payments.status')}</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((pmt) => (
                <tr
                  key={pmt.id}
                  className="cursor-pointer border-b border-border-subtle last:border-0 hover:bg-surface-muted/50"
                  onClick={() => navigate(`/sales/payments/${pmt.id}`)}
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-brand-600">{pmt.payment_number}</td>
                  <td className="px-4 py-2.5 text-ink-secondary">{pmt.date}</td>
                  <td className="px-4 py-2.5 text-ink-secondary capitalize">{pmt.classification.replace('_', ' ')}</td>
                  <td className="px-4 py-2.5 text-end font-mono text-ink-primary">
                    {pmt.currency} {fmt(Number(pmt.amount))}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={pmt.status} />
                    <AllocationBadge status={pmt.status} alloc={pmt.allocation_status ?? null} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={allPayments.length}
            onChange={setPage}
            className="border-t border-border-subtle"
          />
        </div>
      )}
    </div>
  );
}
