import { useQuery } from '@tanstack/react-query';
import { formatDate } from '@/lib/locale';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Z3 — the only way back to returns raised before the credit note
          became the document. Hidden entirely for a company that never
          raised one, so a new tenant never learns the word. */}
      {legacyReturns.length > 0 && (
        <div style={{ fontSize: '12px', color: theme.inkFaint }}>
          <Link to="/sales/returns" style={{ color: theme.brand, textDecoration: 'none' }}>
            {t('returns.legacy_returns_link', { count: legacyReturns.length })}
          </Link>
        </div>
      )}

      <PageHeader
        title={t('returns.credit_notes_title')}
        subtitle={t('returns.credit_notes_desc')}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <PeriodPicker mode="range" allowAllTime preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
            <VoidedToggle hideVoided={hideVoided} onChange={setHideVoided}
              count={notesVoidedCount} />
            <Link to="/sales/credit-notes/new"><Button>+ {t('returns.new_credit_note')}</Button></Link>
          </div>
        }
      />

      {isLoading ? (
        <p style={{ padding: '48px 0', textAlign: 'center', fontSize: '13px', color: theme.inkFaint }}>{t('common.loading')}</p>
      ) : notes.length === 0 ? (
        <p style={{ padding: '48px 0', textAlign: 'center', fontSize: '13px', color: theme.inkFaint }}>{t('returns.no_credit_notes')}</p>
      ) : (
        <div
          className="overflow-x-auto bg-white"
          style={{ border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: theme.shadowSm }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}` }}>
                {[
                  { l: t('returns.cn_number'),     a: 'start' as const },
                  { l: t('sales.customer'),        a: 'start' as const },
                  { l: t('common.date'),           a: 'start' as const },
                  { l: t('returns.reason'),        a: 'start' as const },
                  { l: t('returns.restock'),       a: 'start' as const },
                  { l: t('returns.total_amount'),  a: 'end'   as const },
                  { l: t('common.status'),         a: 'start' as const },
                  { l: '',                         a: 'end'   as const },
                ].map((c, i) => (
                  <th key={i} className="px-4 py-3" style={{
                    fontSize: '11px', fontWeight: 600, color: theme.inkMuted,
                    textTransform: 'uppercase', letterSpacing: '.06em',
                    textAlign: c.a, whiteSpace: 'nowrap',
                  }}>{c.l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {notes.map((cn, idx) => (
                <tr
                  key={cn.id}
                  onClick={() => navigate(`/sales/credit-notes/${cn.id}`)}
                  className="cursor-pointer"
                  style={{
                    borderTop: idx === 0 ? 'none' : '1px solid #f1f5f9',
                    transition: 'background-color .12s',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.panelHead; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                >
                  <td className="px-4 py-3 font-mono" style={{ fontSize: '12px', color: theme.brandSoftText, fontWeight: 600 }}>{cn.credit_note_number}</td>
                  <td className="px-4 py-3" style={{ color: theme.ink, fontSize: '13px', fontWeight: 500 }}>{customerMap[cn.contact_id] ?? '—'}</td>
                  <td className="px-4 py-3" style={{ color: theme.inkMuted, fontSize: '13px' }}>{formatDate(cn.date)}</td>
                  <td className="px-4 py-3" style={{ color: theme.inkMuted, fontSize: '13px', textTransform: 'capitalize' }}>{cn.reason ?? '—'}</td>
                  <td className="px-4 py-3">
                    {cn.restock
                      ? <span style={{ fontSize: '11px', fontWeight: 600, color: theme.success }}>{t('returns.yes')}</span>
                      : <span style={{ fontSize: '11px', color: theme.inkFaint }}>{t('returns.no')}</span>}
                  </td>
                  <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', fontSize: '13px', fontWeight: 600, color: theme.ink }}>{fmt(cn.total_amount)}</td>
                  {/* Z5b — a credit note can be confirmed AND already refunded;
                      those are two different facts, so two pills. */}
                  <td className="px-4 py-3">
                    <StatusBadge status={cn.status} />
                    {refundedIds.has(cn.id) && (
                      <span title={t('refund.refunded_pill_hint')} style={{
                        display: 'inline-block', marginInlineStart: '6px',
                        padding: '2px 8px', borderRadius: '999px', fontSize: '10px',
                        fontWeight: 700, letterSpacing: '.02em',
                        background: '#d1fae5', color: '#065f46',
                      }}>{t('refund.refunded_pill')}</span>
                    )}
                  </td>
                  <td className="px-4 py-3" style={{ textAlign: 'end' }}>
                    <Link to={`/sales/credit-notes/${cn.id}`} style={{ fontSize: '11px', color: theme.brand, fontWeight: 600, textDecoration: 'none' }}>
                      {t('common.view')} →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
