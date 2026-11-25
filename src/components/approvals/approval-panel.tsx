/**
 * Approvals (phase145) — the strip on a document: who it is waiting for and
 * what you can do about it (Approve = Confirm, Reject with a reason, Forward,
 * Cancel), or that it was approved / rejected. Hidden when approvals have
 * nothing to say about the document. Screen only (never printed).
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, Clock, CornerUpRight, Send, ShieldAlert, XCircle } from 'lucide-react';
import { getAdapter } from '@/data/index';
import type { ApprovalDocType, PackDocType } from '@/data/adapter';
import { Modal } from '@/ui/modal';
import { formatDate } from '@/lib/locale';
import { moneyLabel } from '@/lib/currency-display';
import { useCompanyCurrency } from '@/hooks/use-company-currency';
import { ApproverPickerModal } from './approver-picker-modal';
import { useApprovalGate, useDocApproval } from './use-approval';
import { approvalError, approvalKeys } from './approval-lists';
import { recordPackAcceptance, usePackGate } from '@/components/packs/use-pack-gate';
import type { PackLineInput } from '@/lib/packs';

export function ApprovalPanel({ docType, docId, isDraft, onChanged, confirmArgs, amountBase, packLines }: {
  docType: ApprovalDocType;
  docId: string | null | undefined;
  /** The document is still a draft (Submit is possible). */
  isDraft: boolean;
  /** Re-read the document after it was approved (it is confirmed now). */
  onChanged?: () => void;
  confirmArgs?: Record<string, unknown>;
  /** The document's amount in base currency, when the screen knows it: below
   *  the rule's threshold the "needs approval" note stays hidden. */
  amountBase?: number;
  /** phase155 — approving posts the document, so its pack quantities are shown again. */
  packLines?: PackLineInput[];
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const base = useCompanyCurrency();
  const appr = useDocApproval(docType, docId);
  const gate = useApprovalGate(docType);
  const packGate = usePackGate({ continueLabel: t('apprOcean.approve') });
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [forwarding, setForwarding] = useState<'forward' | 'pass_on' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const req = appr.request;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: approvalKeys.doc(docType, docId ?? null) });
    void qc.invalidateQueries({ queryKey: approvalKeys.inbox });
    if (docId) void qc.invalidateQueries({ queryKey: approvalKeys.steps(docId) });
  };
  const act = useMutation({
    mutationFn: async (v: { kind: 'approve' | 'reject' | 'forward' | 'cancel'; to?: string; note?: string }) => {
      const api = getAdapter().approvals;
      if (v.kind === 'approve') {
        if (docId && packLines) await recordPackAcceptance(docType as PackDocType, docId, packLines);
        return api.approve(req!.id, v.to ?? null, v.note ?? null);
      }
      if (v.kind === 'reject') { await api.reject(req!.id, v.note ?? ''); return null; }
      if (v.kind === 'forward') { await api.forward(req!.id, v.to!, v.note ?? null); return null; }
      await api.cancel(req!.id); return null;
    },
    onSuccess: (res, v) => {
      setRejecting(false); setForwarding(null); setReason('');
      setNotice(v.kind === 'approve' && res?.status === 'pending' ? t('apprOcean.passed_on_notice') : null);
      refresh();
      if (v.kind === 'approve' && res?.status === 'approved') onChanged?.();
    },
  });

  if (!docId || !appr.state) return null;
  const err = act.isError ? approvalError(act.error) : null;

  // Draft with an enabled rule but no open request: offer Submit (the server checks the amount).
  if (!req || req.status === 'cancelled' || (req.status === 'rejected' && isDraft) || (req.status === 'approved' && isDraft)) {
    const rejected = req?.status === 'rejected';
    if (!isDraft || (!appr.state.rule_enabled && !rejected)) return null;
    // The server's answer for the saved document wins; the screen's amount is the fallback.
    if (!rejected && (appr.needs === false || (appr.needs === null && amountBase !== undefined && !gate.needs(amountBase)))) return null;
    return (
      <section className={`sb-card sb-appr-panel ${rejected ? 'is-danger' : 'is-info'}`} data-print-hide data-testid="approval-panel">
        <span className="sb-appr-icon" aria-hidden="true">{rejected ? <XCircle size={20} /> : <ShieldAlert size={20} />}</span>
        <div className="sb-appr-body">
          <p className="sb-appr-title">{rejected ? t('apprOcean.rejected_title', { who: req!.decided_by ?? '—' }) : t('apprOcean.needs_title')}</p>
          <p className="sb-team-muted">{rejected ? (req!.reason ?? '') : t('apprOcean.needs_body', { amount: moneyLabel(appr.state.min_amount, base) })}</p>
        </div>
        {appr.state.rule_enabled && (
          <button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => gate.open({ docId, confirmArgs, onSent: refresh })} data-testid="approval-submit">
            <Send size={16} aria-hidden="true" />{rejected ? t('apprOcean.submit_again') : t('apprOcean.submit')}
          </button>
        )}
        {gate.modal}
      </section>
    );
  }

  if (req.status === 'approved') {
    return (
      <section className="sb-card sb-appr-panel is-good" data-print-hide data-testid="approval-panel">
        <span className="sb-appr-icon" aria-hidden="true"><BadgeCheck size={20} /></span>
        <div className="sb-appr-body">
          <p className="sb-appr-title">{t('apprOcean.approved_title', { who: req.decided_by ?? '—', date: req.decided_at ? formatDate(req.decided_at) : '' })}</p>
          <p className="sb-team-muted">{appr.isAdmin ? t('apprOcean.approved_admin') : t('apprOcean.approved_locked')}</p>
        </div>
      </section>
    );
  }

  if (req.status !== 'pending') return null;
  return (
    <section className="sb-card sb-appr-panel is-warn" data-print-hide data-testid="approval-panel">
      <span className="sb-appr-icon" aria-hidden="true"><Clock size={20} /></span>
      <div className="sb-appr-body">
        <p className="sb-appr-title">{req.assigned_to_me ? t('apprOcean.waiting_you') : t('apprOcean.waiting_for', { who: req.assignee ?? '—' })}</p>
        <p className="sb-team-muted">
          {t('apprOcean.sent_by', { who: req.submitted_by ?? '—', date: formatDate(req.created_at), amount: moneyLabel(req.amount_base, base) })}
          {!req.assigned_to_me && req.can_act ? ` ${t('apprOcean.override_hint')}` : ''}
        </p>
        {notice && <p className="sb-gc-ok" role="status">{notice}</p>}
        {err && <p className="sb-gc-err" role="alert">{err}</p>}
      </div>
      <div className="sb-appr-actions">
        {req.can_act && <>
          <button type="button" className="sb-primary-btn sb-btn-inline" disabled={act.isPending}
            onClick={() => packGate.ask(packLines ?? [], () => act.mutate({ kind: 'approve' }))} data-testid="approval-approve">
            <BadgeCheck size={16} aria-hidden="true" />{act.isPending ? t('apprOcean.working') : t('apprOcean.approve')}
          </button>
          <button type="button" className="sb-secondary-btn sb-btn-inline" disabled={act.isPending} onClick={() => setRejecting(true)} data-testid="approval-reject">
            <XCircle size={16} aria-hidden="true" />{t('apprOcean.reject')}
          </button>
          <button type="button" className="sb-secondary-btn sb-btn-inline" disabled={act.isPending} onClick={() => setForwarding('forward')} data-testid="approval-forward">
            <CornerUpRight size={16} aria-hidden="true" />{t('apprOcean.forward')}
          </button>
        </>}
        {(req.submitted_by_me || appr.isAdmin) && (
          <button type="button" className="sb-secondary-btn sb-btn-inline" disabled={act.isPending}
            onClick={() => { if (window.confirm(t('apprOcean.cancel_confirm'))) act.mutate({ kind: 'cancel' }); }} data-testid="approval-cancel">
            {t('apprOcean.cancel_request')}
          </button>
        )}
      </div>

      {packGate.modal}
      <Modal open={rejecting} onClose={() => setRejecting(false)} title={t('apprOcean.reject_title')}>
        <div className="sb-ocean sb-appr-pick">
          <label className="sb-gc-field">
            <span className="sb-gc-label">{t('apprOcean.reason')} <span className="text-danger-500">*</span></span>
            <textarea className="sb-appr-note" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="approval-reason" />
          </label>
          {err && <p className="sb-alert sb-alert-danger" role="alert">{err}</p>}
          <div className="sb-gc-actions">
            <button type="button" className="sb-primary-btn" disabled={!reason.trim() || act.isPending}
              onClick={() => act.mutate({ kind: 'reject', note: reason.trim() })} data-testid="approval-reject-confirm">{t('apprOcean.reject')}</button>
            <button type="button" className="sb-secondary-btn" onClick={() => setRejecting(false)}>{t('apprOcean.cancel')}</button>
          </div>
        </div>
      </Modal>
      <ApproverPickerModal
        open={!!forwarding}
        docType={docType}
        title={t('apprOcean.forward_title')}
        confirmLabel={t('apprOcean.forward')}
        exclude={[req.assignee_employee_id]}
        pending={act.isPending}
        error={forwarding ? err : null}
        onConfirm={(to, note) => act.mutate({ kind: 'forward', to, note })}
        onClose={() => setForwarding(null)}
      />
    </section>
  );
}
