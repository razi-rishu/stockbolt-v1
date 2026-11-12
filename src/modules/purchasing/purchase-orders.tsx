import { useState } from 'react';
import { formatDate } from '@/lib/locale';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Pagination, paginate } from '@/ui/pagination';
import type { Column } from '@/ui/table';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import { Plus, ArrowRightLeft } from 'lucide-react';
import { StatusBadge } from '@/ui/status-badge';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { VoidedToggle } from '@/ui/voided-toggle';
import { useHideVoided, showsInList } from '@/hooks/use-hide-voided';
import type { PurchaseOrderRow, ContactRow } from '@/data/adapter';

const PAGE_SIZE = 50;

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2 });

export default function PurchaseOrdersPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [converting, setConverting] = useState<string | null>(null);
  // Phase 47c — period filter (default All time = show every PO).
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.list.purchase-orders.period', 'all_time');
  const { hideVoided, setHideVoided } = useHideVoided('stockbolt.list.purchase-orders.voided');

  const { data: allOrders = [], isLoading } = useQuery<PurchaseOrderRow[]>({
    queryKey: ['purchase_orders', company_id],
    queryFn: () => getAdapter().purchaseOrders.list(company_id!),
    enabled: !!company_id,
  });
  const ordersInPeriod = allOrders.filter(po => {
    if (from && (po.date as string) < from) return false;
    if (to && (po.date as string) > to) return false;
    return true;
  });
  // Z4 — voided documents are hidden by default; the count is what
  // THIS period is holding back, not all history.
  const ordersVoidedCount = ordersInPeriod.filter(r => r.status === 'void').length;
  const orders = ordersInPeriod.filter(r => showsInList(r, hideVoided));
  const { data: suppliers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'supplier'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'supplier'),
    enabled: !!company_id,
  });
  const supplierName = (id: string) => suppliers.find(s => s.id === id)?.name ?? `${id.slice(0, 8)}…`;

  // Phase 12.47 — quick convert from the row, no need to open the PO first.
  const convertMutation = useMutation({
    mutationFn: (po_id: string) => getAdapter().purchaseOrders.convertToBill(po_id),
    onSuccess: (bill) => {
      qc.invalidateQueries({ queryKey: ['vendor_bills',    company_id] });
      qc.invalidateQueries({ queryKey: ['purchase_orders', company_id] });
      navigate(`/purchasing/bills/${bill.id}`);
    },
    onSettled: () => setConverting(null),
  });

  const paged = paginate(orders, page, PAGE_SIZE);

  const columns: Column<PurchaseOrderRow>[] = [
    { key: 'no', header: t('purchasing.po_number'), render: (po) => <bdi dir="ltr" className="sb-inv-no">{po.po_number}</bdi> },
    { key: 'sup', header: t('purchasing.supplier'), render: (po) => <span style={{ fontWeight: 600 }}>{supplierName(po.supplier_id)}</span> },
    { key: 'date', header: t('purchasing.date'), render: (po) => <bdi dir="ltr">{formatDate(po.date as string)}</bdi> },
    { key: 'amt', header: t('purchasing.total_amount'), align: 'end', render: (po) => <bdi dir="ltr" className="sb-dash-num">{fmt(Number(po.total_amount))}</bdi> },
    { key: 'status', header: '', render: (po) => <StatusBadge status={po.status} /> },
    {
      key: 'convert', header: '', align: 'end',
      render: (po) => {
        // Phase 12.48 — POs stay in 'draft' for the whole flow (no UI "Send"
        // step) so converting from draft is fine. Only block terminal states.
        if (['closed', 'void'].includes(po.status)) return null;
        const busy = converting === po.id && convertMutation.isPending;
        return (
          <button type="button" className="sb-row-link text-brand-600" disabled={busy}
            onClick={(e) => { e.stopPropagation(); setConverting(po.id); convertMutation.mutate(po.id); }}>
            <ArrowRightLeft size={15} aria-hidden="true" />{busy ? t('purchOcean.converting') : t('purchOcean.convert_to_bill')}
          </button>
        );
      },
    },
  ];

  // Ocean Teal (UI v1.1): look only — same orders, period, voided toggle,
  // convert-to-bill and pagination as before.
  return (
    <OceanPage
      testid="purchase-orders-ocean"
      title={t('purchasing.po_title')}
      subtitle={t('purchOcean.orders_count', { count: orders.length })}
      actions={<>
        <PeriodPicker
          mode="range" allowAllTime preset={preset} from={from} to={to}
          onPresetChange={(p) => { setPreset(p); setPage(1); }}
          onCustomRange={(f, tt) => { setCustomRange(f, tt); setPage(1); }}
        />
        <VoidedToggle hideVoided={hideVoided} onChange={(v) => { setHideVoided(v); setPage(1); }} count={ordersVoidedCount} />
        <button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => navigate('/purchasing/orders/new')}><Plus size={18} aria-hidden="true" />{t('purchasing.new_po')}</button>
      </>}
    >
      {isLoading ? (
        <div className="sb-card sb-empty">{t('common.loading')}</div>
      ) : (
        <>
          <OceanTable columns={columns} rows={paged} keyFn={(po) => po.id} cardTitleKey="sup"
            onRowClick={(po) => navigate(`/purchasing/orders/${po.id}`)} rowMuted={(po) => po.status === 'void'} emptyMessage={t('purchasing.no_pos')} />
          {orders.length > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={orders.length} onChange={setPage} />}
        </>
      )}
    </OceanPage>
  );
}
