/**
 * A manual journal sent for approval (phase150). It is not in the books: it
 * lives in its approval request and posts — once per date, reversing the
 * journal it corrects first — only when approved. This page shows it to the
 * approver (Approve / Reject / Forward via the approval panel) and to the
 * sender, who can edit and resubmit it after a rejection.
 */
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';
import { getAdapter } from '@/data/index';
import type { PendingJournal } from '@/data/adapter';
import { BackButton } from '@/ui/back-button';
import { Button } from '@/ui/button';
import { StatusBadge } from '@/ui/status-badge';
import { formatDate } from '@/lib/locale';
import { moneyLabel } from '@/lib/currency-display';
import { useCompanyCurrency } from '@/hooks/use-company-currency';
import { useInvalidateBooks } from '@/hooks/use-invalidate-books';
import { ApprovalPanel } from '@/components/approvals/approval-panel';
import { DocumentActivity } from '@/components/document-activity';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PendingJournalPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const invalidateBooks = useInvalidateBooks();
  const base = useCompanyCurrency();
  const { docId = '' } = useParams<{ docId: string }>();
  const q = useQuery<PendingJournal | null>({
    queryKey: ['pending_journal', docId],
    queryFn: () => getAdapter().approvals.pendingJournal(docId),
    enabled: !!docId,
  });
  const pj = q.data;

  const back = <BackButton to="/accounting/journal-entries" label={t('accounting.je_title')} />;
  if (q.isLoading) return <div className="sb-ocean sb-docx"><div className="sb-card sb-empty">{t('common.loading')}</div></div>;
  if (q.isError || !pj) {
    return (
      <div className="sb-ocean sb-docx">
        <div className="sb-card sb-doc-bar"><div className="sb-doc-bar-id">{back}</div></div>
        <p className="sb-alert sb-alert-danger" role="alert">{q.isError ? (q.error as Error).message : t('apprOcean.je_not_found')}</p>
      </div>
    );
  }

  const lines = pj.data?.lines ?? [];
  const totalDr = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCr = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const approved = pj.status === 'approved';
  const canResubmit = (pj.status === 'rejected' || pj.status === 'cancelled') && pj.submitted_by_me;
  const confirmArgs = { data: pj.data, dates: pj.dates, ...(pj.reverse_je_id ? { reverse_je_id: pj.reverse_je_id } : {}) };

  const resubmit = () => navigate('/accounting/journal-entries/new', {
    state: {
      cloneFrom: { description: pj.data?.description, date: pj.dates?.[0], lines },
      resubmitId: pj.doc_id,
      ...(pj.reverse_je_id ? { editOf: { id: pj.reverse_je_id, entry_number: pj.reverse_entry_number ?? '' } } : {}),
    },
  });

  return (
    <div className="sb-ocean sb-docx" data-testid="pending-journal">
      <div className="sb-card sb-doc-bar">
        <div className="sb-doc-bar-id">
          {back}
          <h1 className="sb-doc-bar-no">{approved ? t('apprOcean.je_decided_posted') : t('apprOcean.je_pending_title')}</h1>
          <StatusBadge status={pj.status} />
        </div>
        <div className="sb-doc-bar-actions">
          {canResubmit && (
            <Button size="sm" onClick={resubmit} data-testid="je-resubmit">
              <Pencil size={15} aria-hidden="true" /> {t('apprOcean.je_edit_resubmit')}
            </Button>
          )}
        </div>
      </div>

      <ApprovalPanel docType="journal_entry" docId={docId} isDraft={!approved} confirmArgs={confirmArgs}
        onChanged={() => { void invalidateBooks(); qc.invalidateQueries({ queryKey: ['pending_journal', docId] }); qc.invalidateQueries({ queryKey: ['journal_entries'] }); }} />

      <section className="sb-card sb-form sb-doc-card">
        {!approved && <p className="sb-team-muted">{t('apprOcean.je_pending_sub')}</p>}
        <p className="sb-appr-title" style={{ margin: '6px 0' }}>{pj.data?.description || '—'}</p>
        <p className="sb-team-muted">
          {t('apprOcean.je_dates')}: <bdi dir="ltr">{(pj.dates ?? []).map((d) => formatDate(d)).join(', ')}</bdi>
          {' · '}{t('apprOcean.je_total')}: <bdi dir="ltr">{moneyLabel(pj.amount_base, base)}</bdi>
        </p>
        {pj.reverse_entry_number && <p className="sb-alert sb-alert-warn" style={{ fontWeight: 400 }}>{t('apprOcean.je_corrects', { no: pj.reverse_entry_number })}</p>}
        {approved && pj.posted.length > 0 && (
          <p className="sb-team-muted">
            {pj.posted.map((p, i) => (
              <span key={p.id}>{i > 0 ? ', ' : ''}
                <button type="button" className="sb-row-link text-brand-600" onClick={() => navigate(`/accounting/journal-entries/${p.id}`)}>
                  <bdi dir="ltr">{p.entry_number}</bdi>
                </button> <bdi dir="ltr">({formatDate(p.date)})</bdi>
              </span>
            ))}
          </p>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table className="sb-je-table w-full text-sm" data-testid="pending-journal-lines">
            <thead>
              <tr>
                <th className="text-start">{t('apprOcean.je_account')}</th>
                <th className="text-start">{t('apprOcean.je_desc')}</th>
                <th className="text-start">{t('apprOcean.je_party')}</th>
                <th className="text-end">{t('apprOcean.je_debit')}</th>
                <th className="text-end">{t('apprOcean.je_credit')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td><bdi dir="ltr" className="sb-acct-code">{l.account_code}</bdi> {pj.accounts?.[l.account_code] ?? ''}</td>
                  <td>{l.description ?? ''}</td>
                  <td>{l.contact_id ? (pj.contacts?.[l.contact_id] ?? '') : ''}</td>
                  <td className="text-end"><bdi dir="ltr">{Number(l.debit) ? fmt(Number(l.debit)) : ''}</bdi></td>
                  <td className="text-end"><bdi dir="ltr">{Number(l.credit) ? fmt(Number(l.credit)) : ''}</bdi></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="text-end" style={{ fontWeight: 700 }}>{t('apprOcean.je_total')}</td>
                <td className="text-end" style={{ fontWeight: 700 }}><bdi dir="ltr">{fmt(totalDr)}</bdi></td>
                <td className="text-end" style={{ fontWeight: 700 }}><bdi dir="ltr">{fmt(totalCr)}</bdi></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
      <DocumentActivity kind="journal_entry" id={docId} />
    </div>
  );
}
