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
import type { GoodsReceiptRow, ContactRow } from '@/data/adapter';

export default function GoodsReceiptsPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  // Phase 47c — period filter (default All time = show every GRN).
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.list.goods-receipts.period', 'all_time');
  const { hideVoided, setHideVoided } = useHideVoided('stockbolt.list.goods-receipts.voided');

  const { data: allGrns = [], isLoading } = useQuery<GoodsReceiptRow[]>({
    queryKey: ['goods_receipts', company_id],
    queryFn: () => getAdapter().goodsReceipts.list(company_id!),
    enabled: !!company_id,
  });
  const grnsInPeriod = allGrns.filter(grn => {
    if (from && (grn.date as string) < from) return false;
    if (to && (grn.date as string) > to) return false;
    return true;
  });
  // Z4 — the count is what THIS period is holding back, not all
  // history, so "Show 2 voided" always reveals exactly two.
  const grnsVoidedCount = grnsInPeriod.filter(r => r.status === 'void').length;
  const grns = grnsInPeriod.filter(r => showsInList(r, hideVoided));
  const { data: suppliers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'supplier'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'supplier'),
    enabled: !!company_id,
  });
  const supplierName = (id: string) => suppliers.find(s => s.id === id)?.name ?? `${id.slice(0, 8)}…`;

  const columns: Column<GoodsReceiptRow>[] = [
    { key: 'no', header: t('purchasing.grn_number'), render: (g) => <bdi dir="ltr" className="sb-inv-no">{g.grn_number}</bdi> },
    { key: 'sup', header: t('purchasing.supplier'), render: (g) => <span style={{ fontWeight: 600 }}>{supplierName(g.supplier_id)}</span> },
    { key: 'date', header: t('purchasing.date'), render: (g) => <bdi dir="ltr">{formatDate(g.date as string)}</bdi> },
    { key: 'status', header: '', render: (g) => <StatusBadge status={g.status} /> },
  ];

  // Ocean Teal (UI v1.1): look only — same receipts, period and voided toggle.
  return (
    <OceanPage
      testid="goods-receipts-ocean"
      title={t('purchasing.grn_title')}
      subtitle={t('purchOcean.grns_count', { count: grns.length })}
      actions={<>
        <PeriodPicker mode="range" allowAllTime preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <VoidedToggle hideVoided={hideVoided} onChange={setHideVoided} count={grnsVoidedCount} />
        <button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => navigate('/purchasing/grns/new')}><Plus size={18} aria-hidden="true" />{t('purchasing.new_grn')}</button>
      </>}
    >
      {isLoading
        ? <div className="sb-card sb-empty">{t('common.loading')}</div>
        : <OceanTable columns={columns} rows={grns} keyFn={(g) => g.id} cardTitleKey="sup"
            onRowClick={(g) => navigate(`/purchasing/grns/${g.id}`)} rowMuted={(g) => g.status === 'void'} emptyMessage={t('purchasing.no_grns')} />}
    </OceanPage>
  );
}
