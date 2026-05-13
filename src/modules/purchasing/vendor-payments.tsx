import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import type { PaymentRow } from '@/data/adapter';

const statusColor: Record<string, string> = { draft: 'muted', confirmed: 'success', void: 'danger' };

// Type extension until Supabase types regenerate with the new
// payments.allocation_status column (Phase 12.11).
type AllocStatus = 'unallocated' | 'partial' | 'full' | null;
type PaymentWithAlloc = PaymentRow & { allocation_status?: AllocStatus };

function AllocationBadge({ status, alloc }: { status: string; alloc: AllocStatus }) {
  if (status !== 'confirmed' || !alloc) return null;
  const map: Record<string, { label: string; cls: string }> = {
    unallocated: { label: 'Advance',       cls: 'bg-purple-50 text-purple-700' },
    partial:     { label: 'Partial',       cls: 'bg-amber-50 text-amber-700'   },
    full:        { label: 'Fully applied', cls: 'bg-sky-50 text-sky-700'       },
  };
  const cfg = map[alloc];
  if (!cfg) return null;
  return (
    <span className={`ms-1 rounded-pill px-2 py-0.5 text-xs font-medium ${cfg.cls}`}>{cfg.label}</span>
  );
}

export default function VendorPaymentsPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();

  const { data: payments = [], isLoading } = useQuery<PaymentWithAlloc[]>({
    queryKey: ['vendor_payments', company_id],
    queryFn: () => getAdapter().vendorPayments.list(company_id!) as Promise<PaymentWithAlloc[]>,
    enabled: !!company_id,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink-primary">{t('purchasing.vp_title')}</h1>
        <Button size="sm" onClick={() => navigate('/purchasing/payments/new')}>{t('purchasing.new_vp')}</Button>
      </div>
      {isLoading ? (
        <div className="py-12 text-center text-sm text-ink-tertiary">{t('common.loading')}</div>
      ) : payments.length === 0 ? (
        <div className="py-12 text-center text-sm text-ink-tertiary">{t('purchasing.no_vps')}</div>
      ) : (
        <div className="rounded-card border border-border-subtle bg-surface-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-ink-tertiary text-xs">
                <th className="px-4 py-3 text-start font-medium">{t('purchasing.vp_number')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('purchasing.supplier')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('purchasing.date')}</th>
                <th className="px-4 py-3 text-end font-medium">{t('purchasing.amount')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('purchasing.type')}</th>
                <th className="px-4 py-3 text-center font-medium">{t('purchasing.status')}</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(pmt => (
                <tr key={pmt.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-muted cursor-pointer"
                  onClick={() => navigate(`/purchasing/payments/${pmt.id}`)}>
                  <td className="px-4 py-3 font-mono text-xs text-brand-700">{pmt.payment_number}</td>
                  <td className="px-4 py-3 text-ink-primary">{pmt.contact_id}</td>
                  <td className="px-4 py-3 text-ink-secondary">{pmt.date as string}</td>
                  <td className="px-4 py-3 text-end font-mono">{Number(pmt.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-ink-secondary capitalize">{pmt.classification}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant={statusColor[pmt.status] as 'muted' | 'success' | 'danger'}>{pmt.status}</Badge>
                    <AllocationBadge status={pmt.status} alloc={pmt.allocation_status ?? null} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
