import { useQuery } from '@tanstack/react-query';
import { formatDate } from '@/lib/locale';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Plus } from 'lucide-react';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { StatusBadge } from '@/ui/status-badge';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { VoidedToggle } from '@/ui/voided-toggle';
import { useHideVoided, showsInList } from '@/hooks/use-hide-voided';
import type { Column } from '@/ui/table';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import type { BankTransferRow, BankAccountRow } from '@/data/adapter';

/**
 * Bank transfers list. Ocean Teal layout (2026-11): look only — same period
 * filter, voided toggle, list and drill-through to the editor.
 */

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BankTransfersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { company_id } = useAuthStore();
  // Phase 47c — period filter (default All time = show every transfer).
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.list.bank-transfers.period', 'all_time');
  const { hideVoided, setHideVoided } = useHideVoided('stockbolt.list.bank-transfers.voided');

  const { data: allTransfers = [], isLoading } = useQuery<BankTransferRow[]>({
    queryKey: ['bank_transfers', company_id],
    queryFn:  () => getAdapter().bankTransfers.list(company_id!),
    enabled:  !!company_id,
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

  const { data: bankAccounts = [] } = useQuery<BankAccountRow[]>({
    queryKey: ['bank_accounts', company_id],
    queryFn:  () => getAdapter().bankAccounts.list(company_id!),
    enabled:  !!company_id,
  });
  const accountMap = Object.fromEntries(bankAccounts.map(a => [a.id, a.name]));

  const columns: Column<BankTransferRow>[] = [
    {
      key: 'number', header: t('banking.transfer_number'),
      render: (r) => <bdi dir="ltr" className="sb-inv-no">{r.transfer_number}</bdi>,
    },
    { key: 'date', header: t('common.date'), render: (r) => <bdi dir="ltr">{formatDate(r.date)}</bdi> },
    {
      key: 'route', header: `${t('banking.from_account')} → ${t('banking.to_account')}`,
      render: (r) => (
        <span className="sb-bt-route">
          <span>{accountMap[r.from_account_id] ?? r.from_account_id}</span>
          <ArrowRight size={14} className="sb-rtl-flip" aria-hidden="true" />
          <span>{accountMap[r.to_account_id] ?? r.to_account_id}</span>
        </span>
      ),
    },
    {
      key: 'amount', header: t('banking.amount'), align: 'end',
      render: (r) => <bdi dir="ltr" className="sb-dash-num">{fmt(r.amount)}</bdi>,
    },
    { key: 'status', header: '', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <OceanPage
      testid="bank-transfers-ocean"
      title={t('banking.transfers_title')}
      subtitle={t('banking.transfers_desc')}
      actions={<>
        <PeriodPicker mode="range" allowAllTime preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <VoidedToggle hideVoided={hideVoided} onChange={setHideVoided} count={transfersVoidedCount} />
        <button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => navigate('/banking/transfers/new')}>
          <Plus size={18} aria-hidden="true" />{t('banking.new_transfer')}
        </button>
      </>}
    >
      {isLoading ? (
        <p className="sb-empty" style={{ margin: 0, textAlign: 'center' }}>{t('common.loading')}</p>
      ) : (
        <OceanTable
          columns={columns}
          rows={transfers}
          keyFn={(r) => r.id}
          cardTitleKey="number"
          onRowClick={(r) => navigate(`/banking/transfers/${r.id}`)}
          rowMuted={(r) => r.status === 'void'}
          emptyMessage={t('banking.no_transfers')}
        />
      )}
    </OceanPage>
  );
}
