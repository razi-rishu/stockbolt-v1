import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import type { StockTransferRow } from '@/data/adapter';

const statusColor: Record<string, string> = {
  draft: 'muted', confirmed: 'success', void: 'danger',
};

export default function StockTransfersPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();

  const { data: transfers = [], isLoading } = useQuery<StockTransferRow[]>({
    queryKey: ['stock_transfers', company_id],
    queryFn: () => getAdapter().stockTransfers.list(company_id!),
    enabled: !!company_id,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink-primary">{t('inventory.transfers_title')}</h1>
        <Button size="sm" onClick={() => navigate('/inventory/transfers/new')}>{t('inventory.new_transfer')}</Button>
      </div>
      {isLoading ? (
        <div className="py-12 text-center text-sm text-ink-tertiary">{t('common.loading')}</div>
      ) : transfers.length === 0 ? (
        <div className="py-12 text-center text-sm text-ink-tertiary">{t('inventory.no_transfers')}</div>
      ) : (
        <div className="rounded-card border border-border-subtle bg-surface-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-ink-tertiary text-xs">
                <th className="px-4 py-3 text-start font-medium">{t('inventory.transfer_number')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('inventory.from_warehouse')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('inventory.to_warehouse')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('inventory.date')}</th>
                <th className="px-4 py-3 text-center font-medium">{t('inventory.status')}</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map(tr => (
                <tr key={tr.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-muted cursor-pointer"
                  onClick={() => navigate(`/inventory/transfers/${tr.id}`)}>
                  <td className="px-4 py-3 font-mono text-xs text-brand-700">{tr.transfer_number}</td>
                  <td className="px-4 py-3 text-ink-secondary font-mono text-xs">{tr.from_warehouse_id}</td>
                  <td className="px-4 py-3 text-ink-secondary font-mono text-xs">{tr.to_warehouse_id}</td>
                  <td className="px-4 py-3 text-ink-secondary">{tr.date as string}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant={statusColor[tr.status] as 'muted' | 'success' | 'danger'}>{tr.status}</Badge>
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
