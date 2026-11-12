import { useState } from 'react';
import { formatDate } from '@/lib/locale';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Pagination, paginate } from '@/ui/pagination';
import type { Column } from '@/ui/table';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import { Plus } from 'lucide-react';
import { StatusBadge } from '@/ui/status-badge';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { VoidedToggle } from '@/ui/voided-toggle';
import { useHideVoided, showsInList } from '@/hooks/use-hide-voided';
import type { PaymentRow, ContactRow } from '@/data/adapter';

const PAGE_SIZE = 50;

// Type extension until Supabase generated types pick up payments.allocation_status (Phase 12.11).
type AllocStatus = 'unallocated' | 'partial' | 'full' | null;
type PaymentWithAlloc = PaymentRow & { allocation_status?: AllocStatus };

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Allocation / reconciliation pills — keys translate via salesOcean.*.
const ALLOC: Record<string, { key: string; tone: string }> = {
  unallocated: { key: 'alloc_advance', tone: '' },
  partial:     { key: 'alloc_partial', tone: 'sb-pill-warn' },
  full:        { key: 'alloc_full',    tone: 'sb-pill-good' },
};

export default function PaymentsPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  // Phase 47c — period filter (default All time = show every receipt).
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.list.receipts.period', 'all_time');
  const { hideVoided, setHideVoided } = useHideVoided('stockbolt.list.receipts.voided');

  const { data: allPaymentsRaw = [], isLoading } = useQuery({
    queryKey: ['payments', company_id],
    queryFn: () => getAdapter().payments.list(company_id!, 'inbound'),
    enabled: !!company_id,
  });
  const paymentsInPeriod = (allPaymentsRaw as PaymentWithAlloc[]).filter(p => {
    if (from && (p.date as string) < from) return false;
    if (to && (p.date as string) > to) return false;
    return true;
  });
  // Z4 — voided documents are hidden by default; the count is what
  // THIS period is holding back, not all history.
  const paymentsVoidedCount = paymentsInPeriod.filter(r => r.status === 'void').length;
  const allPayments = paymentsInPeriod.filter(r => showsInList(r, hideVoided));

  const { data: reconciledIds = [] } = useQuery({
    queryKey: ['reconciled_payment_ids', company_id],
    queryFn: () => getAdapter().bankReconciliations.listReconciledPaymentIds(company_id!),
    enabled: !!company_id,
  });
  const reconciledSet = new Set(reconciledIds);

  const { data: customers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'customer'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'customer'),
    enabled: !!company_id,
  });
  const customerMap = Object.fromEntries(customers.map(c => [c.id, c.name]));

  const paged = paginate(allPayments as PaymentWithAlloc[], page, PAGE_SIZE);

  const columns: Column<PaymentWithAlloc>[] = [
    { key: 'no', header: t('payments.payment_number'), render: (p) => <bdi dir="ltr" className="sb-inv-no">{p.payment_number}</bdi> },
    { key: 'cust', header: t('sales.customer'), render: (p) => <span style={{ fontWeight: 600 }}>{customerMap[p.contact_id] ?? '—'}</span> },
    { key: 'date', header: t('payments.date'), render: (p) => <bdi dir="ltr">{formatDate(p.date)}</bdi> },
    { key: 'class', header: t('payments.classification'), render: (p) => t(`salesOcean.class_${p.classification}`, { defaultValue: p.classification.replace('_', ' ') }) },
    { key: 'amt', header: t('payments.amount'), align: 'end', render: (p) => <bdi dir="ltr" className="sb-dash-num">{p.currency} {fmt(Number(p.amount))}</bdi> },
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

  // Ocean Teal (UI v1.1): look only — same receipts, period, voided toggle,
  // pills and pagination as before.
  return (
    <OceanPage
      testid="receipts-ocean"
      title={t('payments.title')}
      subtitle={t('salesOcean.receipts_count', { count: allPayments.length })}
      actions={<>
        <PeriodPicker
          mode="range" allowAllTime preset={preset} from={from} to={to}
          onPresetChange={(p) => { setPreset(p); setPage(1); }}
          onCustomRange={(f, tt) => { setCustomRange(f, tt); setPage(1); }}
        />
        <VoidedToggle hideVoided={hideVoided} onChange={(v) => { setHideVoided(v); setPage(1); }} count={paymentsVoidedCount} />
        <button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => navigate('/sales/payments/new')}><Plus size={18} aria-hidden="true" />{t('payments.new_payment')}</button>
      </>}
    >
      {isLoading ? (
        <div className="sb-card sb-empty">{t('common.loading')}</div>
      ) : (
        <>
          <OceanTable columns={columns} rows={paged} keyFn={(p) => p.id} cardTitleKey="cust"
            onRowClick={(p) => navigate(`/sales/payments/${p.id}`)} rowMuted={(p) => p.status === 'void'} emptyMessage={t('payments.empty')} />
          {allPayments.length > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={allPayments.length} onChange={setPage} />}
        </>
      )}
    </OceanPage>
  );
}
