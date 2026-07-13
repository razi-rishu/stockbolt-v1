import { useQuery } from '@tanstack/react-query';
import { formatDate } from '@/lib/locale';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import type { StockTransferRow, WarehouseRow } from '@/data/adapter';

const statusColor: Record<string, string> = {
  draft: 'muted', confirmed: 'success', void: 'danger',
};

export default function StockTransfersPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  // Phase 47c — period filter (default All time = show every transfer).
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.list.stock-transfers.period', 'all_time');

  const { data: allTransfers = [], isLoading } = useQuery<StockTransferRow[]>({
    queryKey: ['stock_transfers', company_id],
    queryFn: () => getAdapter().stockTransfers.list(company_id!),
    enabled: !!company_id,
  });
  const transfers = allTransfers.filter(tr => {
    if (from && (tr.date as string) < from) return false;
    if (to && (tr.date as string) > to) return false;
    return true;
  });

  const { data: warehouses = [] } = useQuery<WarehouseRow[]>({
    queryKey: ['warehouses', company_id],
    queryFn: () => getAdapter().warehouses.list(company_id!),
    enabled: !!company_id,
  });
  const warehouseMap = Object.fromEntries(warehouses.map(w => [w.id, w.name]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink-primary">{t('inventory.transfers_title')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodPicker mode="range" allowAllTime preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
          <Button size="sm" onClick={() => navigate('/inventory/transfers/new')}>{t('inventory.new_transfer')}</Button>
        </div>
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
                  <td className="px-4 py-3 text-ink-secondary text-sm">{warehouseMap[tr.from_warehouse_id] ?? tr.from_warehouse_id}</td>
                  <td className="px-4 py-3 text-ink-secondary text-sm">{warehouseMap[tr.to_warehouse_id] ?? tr.to_warehouse_id}</td>
                  <td className="px-4 py-3 text-ink-secondary">{formatDate(tr.date as string)}</td>
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
