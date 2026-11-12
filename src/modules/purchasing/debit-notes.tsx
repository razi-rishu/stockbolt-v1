import { useQuery } from '@tanstack/react-query';
import { formatDate } from '@/lib/locale';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
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
import type { DebitNoteRow, ContactRow, PurchaseReturnRow } from '@/data/adapter';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function DebitNotesPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  // Phase 47c — period filter (default All time = show every debit note).
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.list.debit-notes.period', 'all_time');
  const { hideVoided, setHideVoided } = useHideVoided('stockbolt.list.debit-notes.voided');
  // Z6 — history only; a company that never raised one sees nothing.
  const { data: legacyReturns = [] } = useQuery<PurchaseReturnRow[]>({
    queryKey: ['purchase_returns', company_id],
    queryFn: () => getAdapter().purchaseReturns.list(company_id!),
    enabled: !!company_id,
  });

  const { data: allNotes = [], isLoading } = useQuery<DebitNoteRow[]>({
    queryKey: ['debit_notes', company_id],
    queryFn:  () => getAdapter().debitNotes.list(company_id!),
    enabled:  !!company_id,
  });
  const notesInPeriod = allNotes.filter(dn => {
    if (from && (dn.date as string) < from) return false;
    if (to && (dn.date as string) > to) return false;
    return true;
  });
  // Z4 — the count is what THIS period is holding back, not all
  // history, so "Show 2 voided" always reveals exactly two.
  const notesVoidedCount = notesInPeriod.filter(r => r.status === 'void').length;
  const notes = notesInPeriod.filter(r => showsInList(r, hideVoided));
  // Z5b — one query for the whole page rather than one per row.
  const { data: refunded = [] } = useQuery<string[]>({
    queryKey: ['refunded_doc_ids', company_id, 'debit_note'],
    queryFn: () => getAdapter().payments.listRefundedDocIds(company_id!, 'debit_note'),
    enabled: !!company_id,
  });
  const refundedIds = new Set(refunded);
  const { data: suppliers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'supplier'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'supplier'),
    enabled: !!company_id,
  });
  const supplierName = (id: string) => suppliers.find(s => s.id === id)?.name ?? `${id.slice(0, 8)}…`;

  const columns: Column<DebitNoteRow>[] = [
    { key: 'no', header: t('returns.dn_number'), render: (dn) => <bdi dir="ltr" className="sb-inv-no">{dn.debit_note_number}</bdi> },
    { key: 'date', header: t('common.date'), render: (dn) => <bdi dir="ltr">{formatDate(dn.date)}</bdi> },
    { key: 'sup', header: t('common.supplier'), render: (dn) => <span style={{ fontWeight: 600 }}>{supplierName(dn.supplier_id)}</span> },
    { key: 'reason', header: t('returns.reason'), render: (dn) => dn.reason ? t(`returns.reason_${dn.reason}`, { defaultValue: dn.reason }) : '—' },
    { key: 'amt', header: t('returns.total_amount'), align: 'end', render: (dn) => <bdi dir="ltr" className="sb-dash-num">{fmt(dn.total_amount)}</bdi> },
    {
      key: 'status', header: '',
      // Z5b — a debit note can be confirmed AND already refunded: two pills.
      render: (dn) => (
        <span className="sb-wh-badges">
          <StatusBadge status={dn.status} />
          {refundedIds.has(dn.id) && <span className="sb-pill sb-pill-good" style={{ marginTop: 0 }} title={t('refund.refunded_pill_hint')}>{t('refund.refunded_pill')}</span>}
        </span>
      ),
    },
  ];

  // Ocean Teal (UI v1.1): look only — same notes, period, voided toggle,
  // refunded pill and legacy-returns link as before.
  return (
    <OceanPage
      testid="debit-notes-ocean"
      title={t('returns.debit_notes_title')}
      subtitle={t('returns.debit_notes_desc')}
      actions={<>
        <PeriodPicker mode="range" allowAllTime preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <VoidedToggle hideVoided={hideVoided} onChange={setHideVoided} count={notesVoidedCount} />
        <button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => navigate('/purchasing/debit-notes/new')}><Plus size={18} aria-hidden="true" />{t('returns.new_debit_note')}</button>
      </>}
      below={legacyReturns.length > 0 ? (
        // Z6 — the only way back to purchase returns raised before the debit
        // note became the document. Hidden for a company that never raised one.
        <div style={{ marginTop: 10, fontSize: 13 }}>
          <Link to="/purchasing/returns" className="text-brand-600" style={{ fontWeight: 600, textDecoration: 'none' }}>
            {t('returns.legacy_purchase_returns_link', { count: legacyReturns.length })}
          </Link>
        </div>
      ) : undefined}
    >
      {isLoading
        ? <div className="sb-card sb-empty">{t('common.loading')}</div>
        : <OceanTable columns={columns} rows={notes} keyFn={(dn) => dn.id} cardTitleKey="sup"
            onRowClick={(dn) => navigate(`/purchasing/debit-notes/${dn.id}`)} rowMuted={(dn) => dn.status === 'void'} emptyMessage={t('returns.no_debit_notes')} />}
    </OceanPage>
  );
}
