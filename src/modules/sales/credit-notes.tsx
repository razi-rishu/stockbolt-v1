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
import type { CreditNoteRow, ContactRow, SalesReturnRow } from '@/data/adapter';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CreditNotesPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  // Phase 47c — period filter (default All time = show every credit note).
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.list.credit-notes.period', 'all_time');
  const { hideVoided, setHideVoided } = useHideVoided('stockbolt.list.credit-notes.voided');

  const { data: allNotes = [], isLoading } = useQuery<CreditNoteRow[]>({
    queryKey: ['credit_notes', company_id],
    queryFn:  () => getAdapter().creditNotes.list(company_id!),
    enabled:  !!company_id,
  });
  const notesInPeriod = allNotes.filter(cn => {
    if (from && (cn.date as string) < from) return false;
    if (to && (cn.date as string) > to) return false;
    return true;
  });
  // Z4 — the count is what THIS period is holding back, not all
  // history, so "Show 2 voided" always reveals exactly two.
  const notesVoidedCount = notesInPeriod.filter(r => r.status === 'void').length;
  const notes = notesInPeriod.filter(r => showsInList(r, hideVoided));

  // Z5b — one query for the whole page rather than one per row.
  const { data: refunded = [] } = useQuery<string[]>({
    queryKey: ['refunded_doc_ids', company_id, 'credit_note'],
    queryFn: () => getAdapter().payments.listRefundedDocIds(company_id!, 'credit_note'),
    enabled: !!company_id,
  });
  const refundedIds = new Set(refunded);

  const { data: customers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'customer'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'customer'),
    enabled: !!company_id,
  });
  const customerMap = Object.fromEntries(customers.map(c => [c.id, c.name]));

  // Z3 — history only. A company that never raised a sales return sees
  // no trace of them, which is the point of retiring the menu entry.
  const { data: legacyReturns = [] } = useQuery<SalesReturnRow[]>({
    queryKey: ['sales_returns', company_id],
    queryFn: () => getAdapter().salesReturns.list(company_id!),
    enabled: !!company_id,
  });

  const columns: Column<CreditNoteRow>[] = [
    { key: 'no', header: t('returns.cn_number'), render: (cn) => <bdi dir="ltr" className="sb-inv-no">{cn.credit_note_number}</bdi> },
    { key: 'cust', header: t('sales.customer'), render: (cn) => <span style={{ fontWeight: 600 }}>{customerMap[cn.contact_id] ?? '—'}</span> },
    { key: 'date', header: t('common.date'), render: (cn) => <bdi dir="ltr">{formatDate(cn.date)}</bdi> },
    { key: 'reason', header: t('returns.reason'), render: (cn) => cn.reason ? t(`returns.reason_${cn.reason}`, { defaultValue: cn.reason }) : '—' },
    { key: 'restock', header: t('returns.restock'), render: (cn) => cn.restock ? <span className="sb-pill sb-pill-good" style={{ marginTop: 0 }}>{t('returns.yes')}</span> : <span className="sb-fx-name">{t('returns.no')}</span> },
    { key: 'amt', header: t('returns.total_amount'), align: 'end', render: (cn) => <bdi dir="ltr" className="sb-dash-num">{fmt(cn.total_amount)}</bdi> },
    {
      key: 'status', header: '',
      // Z5b — a credit note can be confirmed AND already refunded: two pills.
      render: (cn) => (
        <span className="sb-wh-badges">
          <StatusBadge status={cn.status} />
          {refundedIds.has(cn.id) && <span className="sb-pill sb-pill-good" style={{ marginTop: 0 }} title={t('refund.refunded_pill_hint')}>{t('refund.refunded_pill')}</span>}
        </span>
      ),
    },
  ];

  // Ocean Teal (UI v1.1): look only — same notes, period, voided toggle,
  // refunded pill and legacy-returns link as before.
  return (
    <OceanPage
      testid="credit-notes-ocean"
      title={t('returns.credit_notes_title')}
      subtitle={t('returns.credit_notes_desc')}
      actions={<>
        <PeriodPicker mode="range" allowAllTime preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <VoidedToggle hideVoided={hideVoided} onChange={setHideVoided} count={notesVoidedCount} />
        <button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => navigate('/sales/credit-notes/new')}><Plus size={18} aria-hidden="true" />{t('returns.new_credit_note')}</button>
      </>}
      below={legacyReturns.length > 0 ? (
        // Z3 — the only way back to returns raised before the credit note
        // became the document; hidden for a company that never raised one.
        <Link to="/sales/returns" className="sb-row-link text-brand-600" style={{ paddingInline: 0, marginTop: 8 }}>
          {t('returns.legacy_returns_link', { count: legacyReturns.length })}
        </Link>
      ) : undefined}
    >
      {isLoading
        ? <div className="sb-card sb-empty">{t('common.loading')}</div>
        : <OceanTable columns={columns} rows={notes} keyFn={(cn) => cn.id} cardTitleKey="cust"
            onRowClick={(cn) => navigate(`/sales/credit-notes/${cn.id}`)} rowMuted={(cn) => cn.status === 'void'} emptyMessage={t('returns.no_credit_notes')} />}
    </OceanPage>
  );
}
