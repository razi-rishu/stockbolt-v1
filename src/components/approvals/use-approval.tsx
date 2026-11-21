/**
 * Approvals (phase145) — the two hooks a document screen uses.
 *
 *   useApprovalGate(type)   Does this amount need approval? If so, after saving
 *                           the draft, open "Send to" instead of confirming.
 *                           Render `gate.modal` once in the screen.
 *   useDocApproval(type,id) The document's approval state: waiting, approved
 *                           (then void / edit are admin-only), rejected.
 *
 * The database decides in the end (it refuses a direct confirm when a rule
 * applies); these hooks only keep the screen in step with it.
 */
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import type { ApprovalConfig, ApprovalDocType, DocApprovalState } from '@/data/adapter';
import { ApproverPickerModal } from './approver-picker-modal';
import { approvalError, approvalKeys, docTypeLabel } from './approval-lists';

export function useApprovalConfig() {
  const company_id = useAuthStore((s) => s.company_id);
  return useQuery<ApprovalConfig>({
    queryKey: approvalKeys.config(company_id),
    queryFn: () => getAdapter().approvals.config(),
    enabled: !!company_id,
    staleTime: 30_000,
  });
}

interface GateTarget {
  docId: string;
  confirmArgs?: Record<string, unknown>;
  /** After the request is sent. */
  onSent?: () => void;
  /** The box was closed without sending (the draft stays saved). */
  onClosed?: () => void;
}

export function useApprovalGate(docType: ApprovalDocType): {
  needs: (amountBase: number) => boolean;
  minAmount: number | null;
  open: (target: GateTarget) => void;
  modal: ReactNode;
} {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const cfg = useApprovalConfig();
  const rule = cfg.data?.rules.find((r) => r.doc_type === docType && r.enabled) ?? null;
  const [target, setTarget] = useState<GateTarget | null>(null);
  const submit = useMutation({
    mutationFn: (v: { assignee: string; note: string }) =>
      getAdapter().approvals.submit(docType, target!.docId, v.assignee, v.note || null, target!.confirmArgs),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: approvalKeys.doc(docType, target!.docId) });
      void qc.invalidateQueries({ queryKey: approvalKeys.inbox });
      const done = target?.onSent;
      setTarget(null);
      done?.();
    },
  });
  const close = () => { const c = target?.onClosed; setTarget(null); submit.reset(); c?.(); };

  return {
    needs: (amountBase) => !!rule && (Number(amountBase) || 0) >= Number(rule.min_amount),
    minAmount: rule ? Number(rule.min_amount) : null,
    open: (tg) => { submit.reset(); setTarget(tg); },
    modal: (
      <ApproverPickerModal
        open={!!target}
        docType={docType}
        title={t('apprOcean.send_title', { doc: docTypeLabel(t, docType) })}
        intro={t('apprOcean.send_intro')}
        confirmLabel={t('apprOcean.send')}
        pending={submit.isPending}
        error={submit.isError ? approvalError(submit.error) : null}
        onConfirm={(assignee, note) => submit.mutate({ assignee, note })}
        onClose={close}
      />
    ),
  };
}

export function useDocApproval(docType: ApprovalDocType, docId: string | null | undefined) {
  const company_id = useAuthStore((s) => s.company_id);
  const q = useQuery<DocApprovalState>({
    queryKey: approvalKeys.doc(docType, docId ?? null),
    queryFn: () => getAdapter().approvals.docState(docType, docId ?? null),
    enabled: !!company_id && !!docId,
  });
  const req = q.data?.request ?? null;
  return {
    state: q.data ?? null,
    request: req,
    isAdmin: !!q.data?.is_admin,
    /** Waiting for someone to approve: the document is frozen. */
    pending: req?.status === 'pending',
    /** Its latest request was approved: void / reopen are admin-only. */
    approved: req?.status === 'approved',
    refetch: q.refetch,
  };
}
