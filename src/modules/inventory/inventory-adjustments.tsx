import { useQuery } from '@tanstack/react-query';
import { formatDate } from '@/lib/locale';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import type { InventoryAdjustmentRow, WarehouseRow } from '@/data/adapter';

const statusColor: Record<string, string> = {
  draft: 'muted', confirmed: 'success', void: 'danger',
};

export default function InventoryAdjustmentsPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();

  const { data: adjustments = [], isLoading } = useQuery<InventoryAdjustmentRow[]>({
    queryKey: ['inventory_adjustments', company_id],
    queryFn: () => getAdapter().inventoryAdjustments.list(company_id!),
    enabled: !!company_id,
  });

  const { data: warehouses = [] } = useQuery<WarehouseRow[]>({
    queryKey: ['warehouses', company_id],
    queryFn: () => getAdapter().warehouses.list(company_id!),
    enabled: !!company_id,
  });
  const warehouseMap = Object.fromEntries(warehouses.map(w => [w.id, w.name]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink-primary">{t('inventory.adjustments_title')}</h1>
        <Button size="sm" onClick={() => navigate('/inventory/adjustments/new')}>{t('inventory.new_adjustment')}</Button>
      </div>
      {isLoading ? (
        <div className="py-12 text-center text-sm text-ink-tertiary">{t('common.loading')}</div>
      ) : adjustments.length === 0 ? (
        <div className="py-12 text-center text-sm text-ink-tertiary">{t('inventory.no_adjustments')}</div>
      ) : (
        <div className="rounded-card border border-border-subtle bg-surface-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-ink-tertiary text-xs">
                <th className="px-4 py-3 text-start font-medium">{t('inventory.adjustment_number')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('inventory.warehouse')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('inventory.reason')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('inventory.date')}</th>
                <th className="px-4 py-3 text-center font-medium">{t('inventory.status')}</th>
              </tr>
            </thead>
            <tbody>
              {adjustments.map(adj => (
                <tr key={adj.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-muted cursor-pointer"
                  onClick={() => navigate(`/inventory/adjustments/${adj.id}`)}>
                  <td className="px-4 py-3 font-mono text-xs text-brand-700">{adj.adjustment_number}</td>
                  <td className="px-4 py-3 text-ink-secondary text-sm">{warehouseMap[adj.warehouse_id] ?? adj.warehouse_id}</td>
                  <td className="px-4 py-3 text-ink-secondary capitalize">{adj.reason}</td>
                  <td className="px-4 py-3 text-ink-secondary">{formatDate(adj.date as string)}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant={statusColor[adj.status] as 'muted' | 'success' | 'danger'}>{adj.status}</Badge>
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
