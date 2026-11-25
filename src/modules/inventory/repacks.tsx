/** Repack list (phase157) — one product made from others. */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { formatDate } from '@/lib/locale';
import { getAdapter } from '@/data/index';
import type { StockRepackRow } from '@/data/adapter';
import { useAuthStore } from '@/store/auth';
import { useHasPermission } from '@/hooks/use-permissions';
import { useInventorySettings } from '@/hooks/use-inventory-settings';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { useHideVoided, showsInList } from '@/hooks/use-hide-voided';
import type { Column } from '@/ui/table';
import { StatusBadge } from '@/ui/status-badge';
import { PeriodPicker } from '@/ui/period-picker';
import { VoidedToggle } from '@/ui/voided-toggle';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import { fmtQty } from '@/lib/packs';

export default function RepacksPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  const canEdit = useHasPermission('inventory.write');
  const { repack_enabled } = useInventorySettings();
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.list.repacks.period', 'all_time');
  const { hideVoided, setHideVoided } = useHideVoided('stockbolt.list.repacks.voided');

  const { data: all = [], isLoading } = useQuery<StockRepackRow[]>({
    queryKey: ['stock_repacks', company_id],
    queryFn: () => getAdapter().stockRepacks.list(company_id!),
    enabled: !!company_id,
  });
  const { data: products = [] } = useQuery({
    queryKey: ['products', company_id],
    queryFn: () => getAdapter().products.list(company_id!),
    enabled: !!company_id,
  });
  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses', company_id],
    queryFn: () => getAdapter().warehouses.list(company_id!),
    enabled: !!company_id,
  });
  const inPeriod = all.filter((r) => (!from || r.date >= from) && (!to || r.date <= to));
  const rows = inPeriod.filter((r) => showsInList(r, hideVoided));
  const product = new Map(products.map((p) => [p.id, p]));
  const warehouse = new Map(warehouses.map((w) => [w.id, w.name]));

  const columns: Column<StockRepackRow>[] = [
    { key: 'no', header: t('repack.number'), render: (r) => <bdi dir="ltr" className="sb-inv-no">{r.repack_number}</bdi> },
    {
      key: 'made', header: t('repack.made'),
      render: (r) => <span style={{ fontWeight: 600 }}><bdi dir="ltr">{fmtQty(Number(r.output_quantity))} ×</bdi> {product.get(r.output_product_id)?.name ?? '—'}</span>,
    },
    { key: 'wh', header: t('inventory.warehouse'), render: (r) => warehouse.get(r.warehouse_id) ?? '—' },
    { key: 'date', header: t('inventory.date'), render: (r) => <bdi dir="ltr">{formatDate(r.date)}</bdi> },
    { key: 'status', header: '', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <OceanPage
      testid="repacks"
      title={t('repack.title')}
      subtitle={t('repack.subtitle')}
      actions={<>
        <PeriodPicker mode="range" allowAllTime preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <VoidedToggle hideVoided={hideVoided} onChange={setHideVoided} count={inPeriod.filter((r) => r.status === 'void').length} />
        {canEdit && repack_enabled && (
          <button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => navigate('/inventory/repack/new')}><Plus size={18} aria-hidden="true" />{t('repack.new')}</button>
        )}
      </>}
    >
      {isLoading
        ? <div className="sb-card sb-empty">{t('common.loading')}</div>
        : <OceanTable columns={columns} rows={rows} keyFn={(r) => r.id} cardTitleKey="made"
            onRowClick={(r) => navigate(`/inventory/repack/${r.id}`)} rowMuted={(r) => r.status === 'void'} emptyMessage={t('repack.empty')} />}
    </OceanPage>
  );
}
