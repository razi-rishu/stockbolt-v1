import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Pagination, paginate } from '@/ui/pagination';
import type { VendorBillRow } from '@/data/adapter';

const PAGE_SIZE = 50;

const statusColor: Record<string, string> = {
  draft: 'muted', confirmed: 'success', void: 'danger',
};

export default function VendorBillsPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const { data: bills = [], isLoading } = useQuery<VendorBillRow[]>({
    queryKey: ['vendor_bills', company_id],
    queryFn: () => getAdapter().vendorBills.list(company_id!),
    enabled: !!company_id,
  });

  const paged = paginate(bills, page, PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink-primary">{t('purchasing.bills_title')}</h1>
        <Button size="sm" onClick={() => navigate('/purchasing/bills/new')}>{t('purchasing.new_bill')}</Button>
      </div>
      {isLoading ? (
        <div className="py-12 text-center text-sm text-ink-tertiary">{t('common.loading')}</div>
      ) : bills.length === 0 ? (
        <div className="py-12 text-center text-sm text-ink-tertiary">{t('purchasing.no_bills')}</div>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border-subtle bg-surface-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-ink-tertiary text-xs">
                <th className="px-4 py-3 text-start font-medium">{t('purchasing.bill_number')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('purchasing.supplier')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('purchasing.date')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('purchasing.due_date')}</th>
                <th className="px-4 py-3 text-end font-medium">{t('purchasing.total_amount')}</th>
                <th className="px-4 py-3 text-center font-medium">{t('purchasing.status')}</th>
              </tr>
            </thead>
            <tbody>
              {paged.map(bill => (
                <tr key={bill.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-muted cursor-pointer"
                  onClick={() => navigate(`/purchasing/bills/${bill.id}`)}>
                  <td className="px-4 py-3 font-mono text-xs text-brand-700">{bill.bill_number}</td>
                  <td className="px-4 py-3 text-ink-primary">{bill.supplier_id}</td>
                  <td className="px-4 py-3 text-ink-secondary">{bill.date as string}</td>
                  <td className="px-4 py-3 text-ink-secondary">{(bill.due_date as string | null) ?? '—'}</td>
                  <td className="px-4 py-3 text-end font-mono">{Number(bill.total_amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant={statusColor[bill.status] as 'muted' | 'success' | 'danger'}>{bill.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={bills.length}
            onChange={setPage}
            className="border-t border-border-subtle"
          />
        </div>
      )}
    </div>
  );
}
