import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import type { PurchaseOrderRow } from '@/data/adapter';

const statusColor: Record<string, string> = {
  draft: 'muted', sent: 'brand', partially_received: 'warning',
  received: 'success', closed: 'muted', void: 'danger',
};

export default function PurchaseOrdersPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();

  const { data: orders = [], isLoading } = useQuery<PurchaseOrderRow[]>({
    queryKey: ['purchase_orders', company_id],
    queryFn: () => getAdapter().purchaseOrders.list(company_id!),
    enabled: !!company_id,
  });

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
        <div className="rounded-card border border-border-subtle bg-surface-card">
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
              {orders.map(po => (
                <tr key={po.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-muted cursor-pointer"
                  onClick={() => navigate(`/purchasing/orders/${po.id}`)}>
                  <td className="px-4 py-3 font-mono text-xs text-brand-700">{po.po_number}</td>
                  <td className="px-4 py-3 text-ink-primary">{po.supplier_id}</td>
                  <td className="px-4 py-3 text-ink-secondary">{po.date as string}</td>
                  <td className="px-4 py-3 text-end font-mono">{Number(po.total_amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant={statusColor[po.status] as 'muted' | 'brand' | 'warning' | 'success' | 'danger'}>{po.status}</Badge>
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
