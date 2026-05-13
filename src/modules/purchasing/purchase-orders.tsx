import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Pagination, paginate } from '@/ui/pagination';
import type { PurchaseOrderRow, ContactRow } from '@/data/adapter';

const PAGE_SIZE = 50;

const statusColor: Record<string, string> = {
  draft: 'muted', sent: 'brand', partially_received: 'warning',
  received: 'success', closed: 'muted', void: 'danger',
};

export default function PurchaseOrdersPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const { data: orders = [], isLoading } = useQuery<PurchaseOrderRow[]>({
    queryKey: ['purchase_orders', company_id],
    queryFn: () => getAdapter().purchaseOrders.list(company_id!),
    enabled: !!company_id,
  });
  const { data: suppliers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'supplier'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'supplier'),
    enabled: !!company_id,
  });
  const supplierName = (id: string) => suppliers.find(s => s.id === id)?.name ?? `${id.slice(0, 8)}…`;

  const paged = paginate(orders, page, PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink-primary">{t('purchasing.po_title')}</h1>
        <Button size="sm" onClick={() => navigate('/purchasing/orders/new')}>{t('purchasing.new_po')}</Button>
      </div>
      {isLoading ? (
        <div className="py-12 text-center text-sm text-ink-tertiary">{t('common.loading')}</div>
      ) : orders.length === 0 ? (
        <div className="py-12 text-center text-sm text-ink-tertiary">{t('purchasing.no_pos')}</div>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border-subtle bg-surface-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-ink-tertiary text-xs">
                <th className="px-4 py-3 text-start font-medium">{t('purchasing.po_number')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('purchasing.supplier')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('purchasing.date')}</th>
                <th className="px-4 py-3 text-end font-medium">{t('purchasing.total_amount')}</th>
                <th className="px-4 py-3 text-center font-medium">{t('purchasing.status')}</th>
              </tr>
            </thead>
            <tbody>
              {paged.map(po => (
                <tr key={po.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-muted cursor-pointer"
                  onClick={() => navigate(`/purchasing/orders/${po.id}`)}>
                  <td className="px-4 py-3 font-mono text-xs text-brand-700">{po.po_number}</td>
                  <td className="px-4 py-3 text-ink-primary">{supplierName(po.supplier_id)}</td>
                  <td className="px-4 py-3 text-ink-secondary">{po.date as string}</td>
                  <td className="px-4 py-3 text-end font-mono">{Number(po.total_amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant={statusColor[po.status] as 'muted' | 'brand' | 'warning' | 'success' | 'danger'}>{po.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={orders.length}
            onChange={setPage}
            className="border-t border-border-subtle"
          />
        </div>
      )}
    </div>
  );
}
