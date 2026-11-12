import { useQuery } from '@tanstack/react-query';
import { formatDate } from '@/lib/locale';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import type { Column } from '@/ui/table';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import { Plus } from 'lucide-react';
import { StatusBadge } from '@/ui/status-badge';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { VoidedToggle } from '@/ui/voided-toggle';
import { useHideVoided, showsInList } from '@/hooks/use-hide-voided';
import type { InventoryAdjustmentRow, WarehouseRow } from '@/data/adapter';

export default function InventoryAdjustmentsPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  // Phase 47c — period filter (default All time = show every adjustment).
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.list.inventory-adjustments.period', 'all_time');
  const { hideVoided, setHideVoided } = useHideVoided('stockbolt.list.inventory-adjustments.voided');

  const { data: allAdjustments = [], isLoading } = useQuery<InventoryAdjustmentRow[]>({
    queryKey: ['inventory_adjustments', company_id],
    queryFn: () => getAdapter().inventoryAdjustments.list(company_id!),
    enabled: !!company_id,
  });
  const adjustmentsInPeriod = allAdjustments.filter(adj => {
    if (from && (adj.date as string) < from) return false;
    if (to && (adj.date as string) > to) return false;
    return true;
  });
  // Z4 — the count is what THIS period is holding back, not all
  // history, so "Show 2 voided" always reveals exactly two.
  const adjustmentsVoidedCount = adjustmentsInPeriod.filter(r => r.status === 'void').length;
  const adjustments = adjustmentsInPeriod.filter(r => showsInList(r, hideVoided));

  const { data: warehouses = [] } = useQuery<WarehouseRow[]>({
    queryKey: ['warehouses', company_id],
    queryFn: () => getAdapter().warehouses.list(company_id!),
    enabled: !!company_id,
  });
  const warehouseMap = Object.fromEntries(warehouses.map(w => [w.id, w.name]));

  const columns: Column<InventoryAdjustmentRow>[] = [
    { key: 'no', header: t('inventory.adjustment_number'), render: (a) => <bdi dir="ltr" className="sb-inv-no">{a.adjustment_number}</bdi> },
    { key: 'wh', header: t('inventory.warehouse'), render: (a) => <span style={{ fontWeight: 600 }}>{warehouseMap[a.warehouse_id] ?? a.warehouse_id}</span> },
    { key: 'reason', header: t('inventory.reason'), render: (a) => a.reason ? t(`inventory.reason_${a.reason}`, { defaultValue: a.reason }) : '—' },
    { key: 'date', header: t('inventory.date'), render: (a) => <bdi dir="ltr">{formatDate(a.date as string)}</bdi> },
    { key: 'status', header: '', render: (a) => <StatusBadge status={a.status} /> },
  ];

  // Ocean Teal (UI v1.1): look only — same adjustments, period and voided toggle.
  return (
    <OceanPage
      testid="inventory-adjustments-ocean"
      title={t('inventory.adjustments_title')}
      subtitle={t('stockOcean.adjustments_count', { count: adjustments.length })}
      actions={<>
        <PeriodPicker mode="range" allowAllTime preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <VoidedToggle hideVoided={hideVoided} onChange={setHideVoided} count={adjustmentsVoidedCount} />
        <button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => navigate('/inventory/adjustments/new')}><Plus size={18} aria-hidden="true" />{t('inventory.new_adjustment')}</button>
      </>}
    >
      {isLoading
        ? <div className="sb-card sb-empty">{t('common.loading')}</div>
        : <OceanTable columns={columns} rows={adjustments} keyFn={(a) => a.id} cardTitleKey="wh"
            onRowClick={(a) => navigate(`/inventory/adjustments/${a.id}`)} rowMuted={(a) => a.status === 'void'} emptyMessage={t('inventory.no_adjustments')} />}
    </OceanPage>
  );
}
