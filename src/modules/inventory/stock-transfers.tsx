import { useQuery } from '@tanstack/react-query';
import { formatDate } from '@/lib/locale';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import type { Column } from '@/ui/table';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import { Plus, ArrowRight } from 'lucide-react';
import { StatusBadge } from '@/ui/status-badge';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { VoidedToggle } from '@/ui/voided-toggle';
import { useHideVoided, showsInList } from '@/hooks/use-hide-voided';
import type { StockTransferRow, WarehouseRow } from '@/data/adapter';

export default function StockTransfersPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  // Phase 47c — period filter (default All time = show every transfer).
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.list.stock-transfers.period', 'all_time');
  const { hideVoided, setHideVoided } = useHideVoided('stockbolt.list.stock-transfers.voided');

  const { data: allTransfers = [], isLoading } = useQuery<StockTransferRow[]>({
    queryKey: ['stock_transfers', company_id],
    queryFn: () => getAdapter().stockTransfers.list(company_id!),
    enabled: !!company_id,
  });
  const transfersInPeriod = allTransfers.filter(tr => {
    if (from && (tr.date as string) < from) return false;
    if (to && (tr.date as string) > to) return false;
    return true;
  });
  // Z4 — the count is what THIS period is holding back, not all
  // history, so "Show 2 voided" always reveals exactly two.
  const transfersVoidedCount = transfersInPeriod.filter(r => r.status === 'void').length;
  const transfers = transfersInPeriod.filter(r => showsInList(r, hideVoided));

  const { data: warehouses = [] } = useQuery<WarehouseRow[]>({
    queryKey: ['warehouses', company_id],
    queryFn: () => getAdapter().warehouses.list(company_id!),
    enabled: !!company_id,
  });
  const warehouseMap = Object.fromEntries(warehouses.map(w => [w.id, w.name]));

  const columns: Column<StockTransferRow>[] = [
    { key: 'no', header: t('inventory.transfer_number'), render: (tr) => <bdi dir="ltr" className="sb-inv-no">{tr.transfer_number}</bdi> },
    {
      key: 'route', header: t('stockOcean.route'),
      render: (tr) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, flexWrap: 'wrap' }}>
          {warehouseMap[tr.from_warehouse_id] ?? tr.from_warehouse_id}
          <ArrowRight size={14} className="sb-pw-flip" aria-hidden="true" style={{ color: 'var(--sb-primary)' }} />
          {warehouseMap[tr.to_warehouse_id] ?? tr.to_warehouse_id}
        </span>
      ),
    },
    { key: 'date', header: t('inventory.date'), render: (tr) => <bdi dir="ltr">{formatDate(tr.date as string)}</bdi> },
    { key: 'status', header: '', render: (tr) => <StatusBadge status={tr.status} /> },
  ];

  // Ocean Teal (UI v1.1): look only — same transfers, period and voided toggle.
  return (
    <OceanPage
      testid="stock-transfers-ocean"
      title={t('inventory.transfers_title')}
      subtitle={t('stockOcean.transfers_count', { count: transfers.length })}
      actions={<>
        <PeriodPicker mode="range" allowAllTime preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <VoidedToggle hideVoided={hideVoided} onChange={setHideVoided} count={transfersVoidedCount} />
        <button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => navigate('/inventory/transfers/new')}><Plus size={18} aria-hidden="true" />{t('inventory.new_transfer')}</button>
      </>}
    >
      {isLoading
        ? <div className="sb-card sb-empty">{t('common.loading')}</div>
        : <OceanTable columns={columns} rows={transfers} keyFn={(tr) => tr.id} cardTitleKey="route"
            onRowClick={(tr) => navigate(`/inventory/transfers/${tr.id}`)} rowMuted={(tr) => tr.status === 'void'} emptyMessage={t('inventory.no_transfers')} />}
    </OceanPage>
  );
}
