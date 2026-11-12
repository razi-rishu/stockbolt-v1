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
import type { PaymentRow, ContactRow } from '@/data/adapter';

// Type extension until Supabase types regenerate with the new
// payments.allocation_status column (Phase 12.11).
type AllocStatus = 'unallocated' | 'partial' | 'full' | null;
type PaymentWithAlloc = PaymentRow & { allocation_status?: AllocStatus };

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2 });

// Allocation pills — same meaning and labels as the Receipts list.
const ALLOC: Record<string, { key: string; tone: string }> = {
  unallocated: { key: 'alloc_advance', tone: '' },
  partial:     { key: 'alloc_partial', tone: 'sb-pill-warn' },
  full:        { key: 'alloc_full',    tone: 'sb-pill-good' },
};

export default function VendorPaymentsPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  // Phase 47c — period filter (default All time = show every vendor payment).
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.list.vendor-payments.period', 'all_time');
  const { hideVoided, setHideVoided } = useHideVoided('stockbolt.list.vendor-payments.voided');

  const { data: allPayments = [], isLoading } = useQuery<PaymentWithAlloc[]>({
    queryKey: ['vendor_payments', company_id],
    queryFn: () => getAdapter().vendorPayments.list(company_id!) as Promise<PaymentWithAlloc[]>,
    enabled: !!company_id,
  });
  const paymentsInPeriod = allPayments.filter(pmt => {
    if (from && (pmt.date as string) < from) return false;
    if (to && (pmt.date as string) > to) return false;
    return true;
  });
  // Z4 — the count is what THIS period is holding back, not all
  // history, so "Show 2 voided" always reveals exactly two.
  const paymentsVoidedCount = paymentsInPeriod.filter(r => r.status === 'void').length;
  const payments = paymentsInPeriod.filter(r => showsInList(r, hideVoided));

  const { data: suppliers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'supplier'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'supplier'),
    enabled: !!company_id,
  });
  const supplierName = (id: string) => suppliers.find(s => s.id === id)?.name ?? `${id.slice(0, 8)}…`;

  // Reconciled-payment IDs (Batch C).
  const { data: reconciledIds = [] } = useQuery({
    queryKey: ['reconciled_payment_ids', company_id],
    queryFn: () => getAdapter().bankReconciliations.listReconciledPaymentIds(company_id!),
    enabled: !!company_id,
  });
  const reconciledSet = new Set(reconciledIds);

  const columns: Column<PaymentWithAlloc>[] = [
    { key: 'no', header: t('purchasing.vp_number'), render: (p) => <bdi dir="ltr" className="sb-inv-no">{p.payment_number}</bdi> },
    { key: 'sup', header: t('purchasing.supplier'), render: (p) => <span style={{ fontWeight: 600 }}>{supplierName(p.contact_id)}</span> },
    { key: 'date', header: t('purchasing.date'), render: (p) => <bdi dir="ltr">{formatDate(p.date as string)}</bdi> },
    { key: 'amt', header: t('purchasing.amount'), align: 'end', render: (p) => <bdi dir="ltr" className="sb-dash-num">{fmt(Number(p.amount))}</bdi> },
    { key: 'type', header: t('purchasing.type'), render: (p) => t(`purchasing.${p.classification}`, { defaultValue: p.classification.replace('_', ' ') }) },
    {
      key: 'status', header: '',
      render: (p) => {
        const alloc = p.status === 'confirmed' && p.allocation_status ? ALLOC[p.allocation_status] : null;
        return (
          <span className="sb-wh-badges">
            <StatusBadge status={p.status} />
            {alloc && <span className={`sb-pill ${alloc.tone}`} style={{ marginTop: 0 }}>{t(`salesOcean.${alloc.key}`)}</span>}
            {p.status === 'confirmed' && reconciledSet.has(p.id) && <span className="sb-pill sb-pill-good" style={{ marginTop: 0 }}>{t('salesOcean.reconciled')}</span>}
          </span>
        );
      },
    },
  ];

  // Ocean Teal (UI v1.1): look only — same payments, period, voided toggle
  // and pills as before.
  return (
    <OceanPage
      testid="vendor-payments-ocean"
      title={t('purchasing.vp_title')}
      subtitle={t('purchOcean.payments_count', { count: payments.length })}
      actions={<>
        <PeriodPicker mode="range" allowAllTime preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <VoidedToggle hideVoided={hideVoided} onChange={setHideVoided} count={paymentsVoidedCount} />
        <button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => navigate('/purchasing/payments/new')}><Plus size={18} aria-hidden="true" />{t('purchasing.new_vp')}</button>
      </>}
    >
      {isLoading
        ? <div className="sb-card sb-empty">{t('common.loading')}</div>
        : <OceanTable columns={columns} rows={payments} keyFn={(p) => p.id} cardTitleKey="sup"
            onRowClick={(p) => navigate(`/purchasing/payments/${p.id}`)} rowMuted={(p) => p.status === 'void'} emptyMessage={t('purchasing.no_vps')} />}
    </OceanPage>
  );
}
