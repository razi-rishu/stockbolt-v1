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
import type { PurchaseReturnRow, VendorBillRow, ContactRow } from '@/data/adapter';

/**
 * R3b — Purchase Returns list. Mirror of the sales returns list.
 *
 * Like sales_returns, purchase_returns has no supplier FK of its own: the
 * supplier comes via the linked vendor bill, so the bill is resolved here to
 * show who the goods went back to.
 */
export default function PurchaseReturnsPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  const { preset, from, to, setPreset, setCustomRange } =
    usePeriodPicker('stockbolt.list.purchase-returns.period', 'all_time');
  const { hideVoided, setHideVoided } = useHideVoided('stockbolt.list.purchase-returns.voided');

  const { data: allReturns = [], isLoading } = useQuery<PurchaseReturnRow[]>({
    queryKey: ['purchase_returns', company_id],
    queryFn:  () => getAdapter().purchaseReturns.list(company_id!),
    enabled:  !!company_id,
  });
  const returnsInPeriod = allReturns.filter(pr => {
    if (from && (pr.date as string) < from) return false;
    if (to   && (pr.date as string) > to)   return false;
    return true;
  });
  // Z4 — voided documents are hidden by default; the count is what
  // THIS period is holding back, not all history.
  const returnsVoidedCount = returnsInPeriod.filter(r => r.status === 'void').length;
  const returns = returnsInPeriod.filter(r => showsInList(r, hideVoided));

  const { data: bills = [] } = useQuery<VendorBillRow[]>({
    queryKey: ['vendor_bills', company_id],
    queryFn: () => getAdapter().vendorBills.list(company_id!),
    enabled: !!company_id,
  });
  const { data: suppliers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'supplier'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'supplier'),
    enabled: !!company_id,
  });
  const billMap     = Object.fromEntries(bills.map(b => [b.id, b]));
  const supplierMap = Object.fromEntries(suppliers.map(s => [s.id, s]));

  const columns: Column<PurchaseReturnRow>[] = [
    { key: 'no', header: t('returns.return_number'), render: (pr) => <bdi dir="ltr" className="sb-inv-no">{pr.return_number}</bdi> },
    { key: 'date', header: t('common.date'), render: (pr) => <bdi dir="ltr">{formatDate(pr.date)}</bdi> },
    {
      key: 'sup', header: t('common.supplier'),
      render: (pr) => {
        const bill = billMap[pr.bill_id];
        return <span style={{ fontWeight: 600 }}>{(bill ? supplierMap[bill.supplier_id]?.name : undefined) ?? '—'}</span>;
      },
    },
    { key: 'bill', header: t('purchasing.bill'), render: (pr) => billMap[pr.bill_id]?.bill_number ? <bdi dir="ltr">{billMap[pr.bill_id].bill_number}</bdi> : '—' },
    { key: 'reason', header: t('returns.reason'), render: (pr) => pr.reason ? t(`returns.${pr.reason}`) : '—' },
    { key: 'status', header: '', render: (pr) => <StatusBadge status={pr.status} /> },
  ];

  // Ocean Teal (UI v1.1): look only — same legacy returns, period and voided
  // toggle. Z6 — no New Purchase Return: raising one here would create the
  // second document all over again. Everything already raised stays
  // readable, printable and voidable at its own URL.
  return (
    <OceanPage
      testid="purchase-returns-ocean"
      title={t('returns.purchase_returns_title')}
      subtitle={t('returns.purchase_returns_legacy_desc')}
      actions={<>
        <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <VoidedToggle hideVoided={hideVoided} onChange={setHideVoided} count={returnsVoidedCount} />
        <button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => navigate('/purchasing/debit-notes/new')}><Plus size={18} aria-hidden="true" />{t('returns.new_debit_note')}</button>
      </>}
    >
      {isLoading
        ? <div className="sb-card sb-empty">{t('common.loading')}</div>
        : <OceanTable columns={columns} rows={returns} keyFn={(pr) => pr.id} cardTitleKey="sup"
            onRowClick={(pr) => navigate(`/purchasing/returns/${pr.id}`)} rowMuted={(pr) => pr.status === 'void'} emptyMessage={t('returns.no_purchase_returns')} />}
    </OceanPage>
  );
}
