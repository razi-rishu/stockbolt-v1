/**
 * Approvals inbox (phase145) — Waiting for me, My requests, History. Opening a
 * row goes to the document, where Approve / Reject / Forward happen with the
 * document in front of you. Admins can also see everything that is waiting.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import type { ApprovalRequestRow } from '@/data/adapter';
import { OceanPage } from '@/components/ocean-list';
import { useHasPermission } from '@/hooks/use-permissions';
import { formatDate } from '@/lib/locale';
import { moneyLabel } from '@/lib/currency-display';
import { useCompanyCurrency } from '@/hooks/use-company-currency';
import { approvalError, approvalKeys, docRoute, docTypeLabel } from '@/components/approvals/approval-lists';

type Scope = 'waiting' | 'mine' | 'history';

export default function ApprovalsInboxPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isAdmin = useHasPermission('users.manage');
  const base = useCompanyCurrency();
  const [scope, setScope] = useState<Scope>('waiting');
  const [all, setAll] = useState(false);
  const q = useQuery<ApprovalRequestRow[]>({
    queryKey: [...approvalKeys.inbox, scope, all],
    queryFn: () => getAdapter().approvals.list(scope, all),
    refetchInterval: 60_000,
  });
  const rows = q.data ?? [];
  const statusLabel = (s: ApprovalRequestRow['status']) =>
    s === 'pending' ? t('apprOcean.st_pending') : s === 'approved' ? t('apprOcean.st_approved')
      : s === 'rejected' ? t('apprOcean.st_rejected') : t('apprOcean.st_cancelled');
  const tab = (s: Scope, label: string) => (
    <button type="button" role="tab" aria-selected={scope === s} className={`sb-adm-chip ${scope === s ? 'is-on' : ''}`}
      onClick={() => setScope(s)} data-testid={`inbox-tab-${s}`}>{label}</button>
  );

  return (
    <OceanPage testid="approvals-inbox" title={t('apprOcean.inbox_title')} subtitle={t('apprOcean.inbox_sub')}
      below={
        <div className="sb-team-tools" style={{ marginTop: 12 }}>
          <div className="sb-adm-chips" role="tablist">
            {tab('waiting', t('apprOcean.tab_waiting'))}
            {tab('mine', t('apprOcean.tab_mine'))}
            {tab('history', t('apprOcean.tab_history'))}
          </div>
          {isAdmin && scope === 'waiting' && (
            <label className="sb-team-check">
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} data-testid="inbox-all" />
              {t('apprOcean.show_all')}
            </label>
          )}
        </div>
      }>
      <section className="sb-card sb-team-tree">
        {q.isLoading ? <p className="sb-team-muted">{t('common.loading')}</p>
          : q.isError ? <p className="sb-alert sb-alert-danger" role="alert">{approvalError(q.error)}</p>
          : rows.length === 0 ? <p className="sb-team-muted">{scope === 'waiting' ? t('apprOcean.empty_waiting') : t('apprOcean.empty')}</p>
          : (
            <ul className="sb-team-list" data-testid="inbox-list">
              {rows.map((r) => (
                <li key={r.id}>
                  <button type="button" className="sb-team-row sb-appr-row" onClick={() => navigate(docRoute(r.doc_type, r.doc_id))}>
                    <span className="sb-team-row-main">
                      <span className="sb-team-row-name">{docTypeLabel(t, r.doc_type)} <bdi dir="ltr">{r.doc_number ?? ''}</bdi></span>
                      <span className="sb-team-muted">
                        {t('apprOcean.row_meta', { who: r.submitted_by ?? '—', to: r.assignee ?? '—', date: formatDate(r.created_at) })}
                      </span>
                      {r.note && <span className="sb-team-muted">“{r.note}”</span>}
                    </span>
                    <span className="sb-appr-row-end">
                      <bdi dir="ltr" className="sb-appr-amount">{moneyLabel(r.amount_base, base)}</bdi>
                      <span className={`sb-team-tag is-${r.status}`}>{r.can_act && r.status === 'pending' ? t('apprOcean.your_turn') : statusLabel(r.status)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
      </section>
    </OceanPage>
  );
}
