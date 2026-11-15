/**
 * phase133 — the operator side of a ticket: who raised it, status, priority,
 * assignment and the full history. Every change goes through
 * support_operator_update(), which refuses anyone not in support_operators
 * and writes the append-only support_activity row.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import type { SupportActivityRow, SupportPriority, SupportStatus, SupportTicketContext, SupportTicketRow } from '@/data/adapter';
import { PRIORITIES, STATUSES, fmtDateTime, supportErrorText } from './labels';

export function SupportOperatorPanel({ ticket }: { ticket: SupportTicketRow }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const ctxQ = useQuery<SupportTicketContext>({ queryKey: ['support', 'ctx', ticket.id], queryFn: () => getAdapter().support.ticketContext(ticket.id) });
  const actQ = useQuery<SupportActivityRow[]>({ queryKey: ['support', 'activity', ticket.id], queryFn: () => getAdapter().support.listActivity(ticket.id) });
  const [status, setStatus] = useState<SupportStatus>(ticket.status);
  const [priority, setPriority] = useState<SupportPriority>(ticket.priority);
  const [assignee, setAssignee] = useState<string>(ticket.assigned_to ?? '');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setStatus(ticket.status); setPriority(ticket.priority); setAssignee(ticket.assigned_to ?? ''); }, [ticket]);

  const save = useMutation({
    mutationFn: () => getAdapter().support.operatorUpdate(ticket.id, {
      status, priority, assign: assignee !== (ticket.assigned_to ?? ''), assigned_to: assignee || null,
    }),
    onSuccess: () => { setError(null); qc.invalidateQueries({ queryKey: ['support'] }); },
    onError: (e) => setError(supportErrorText(t, e)),
  });

  const ctx = ctxQ.data;
  const opName = (uid: string | null) => ctx?.operators.find((o) => o.user_id === uid)?.name ?? uid ?? '—';
  const changed = status !== ticket.status || priority !== ticket.priority || assignee !== (ticket.assigned_to ?? '');

  return (
    <aside className="space-y-3" style={{ minWidth: 0 }}>
      <div className="sb-card sb-doc-card space-y-2">
        <h2 className="sb-doc-card-title" style={{ margin: 0 }}>{t('support.requester')}</h2>
        <p style={{ margin: 0 }}><strong>{ctx?.requester_name ?? '—'}</strong></p>
        <p style={{ margin: 0 }}><bdi dir="ltr">{ctx?.requester_email ?? ''}</bdi></p>
        <p style={{ margin: 0 }} className="sb-form-hint">{ctx?.company_name} {ctx?.country_code ? `· ${ctx.country_code}` : ''}</p>
        <p style={{ margin: 0 }} className="sb-form-hint">{t('support.contact_pref')}: {t(`support.contact_${ticket.contact_preference}`)}</p>
      </div>

      <div className="sb-card sb-doc-card space-y-3">
        <label className="sb-flabel" htmlFor="op-status">{t('support.col_status')}</label>
        <select id="op-status" className="sb-pc-select" style={{ width: '100%' }} value={status} onChange={(e) => setStatus(e.target.value as SupportStatus)}>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`support.status_${s}`)}</option>)}
        </select>
        <label className="sb-flabel" htmlFor="op-priority">{t('support.col_priority')}</label>
        <select id="op-priority" className="sb-pc-select" style={{ width: '100%' }} value={priority} onChange={(e) => setPriority(e.target.value as SupportPriority)}>
          {PRIORITIES.map((p) => <option key={p} value={p}>{t(`support.priority_${p}`)}</option>)}
        </select>
        <label className="sb-flabel" htmlFor="op-assign">{t('support.assigned_to')}</label>
        <select id="op-assign" className="sb-pc-select" style={{ width: '100%' }} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">{t('support.unassigned')}</option>
          {(ctx?.operators ?? []).map((o) => <option key={o.user_id} value={o.user_id}>{o.name}</option>)}
        </select>
        {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}
        <button type="button" className="sb-primary-btn" style={{ width: '100%' }} disabled={!changed || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </button>
      </div>

      <div className="sb-card sb-doc-card">
        <h2 className="sb-doc-card-title" style={{ marginTop: 0 }}>{t('support.history')}</h2>
        <ol className="sb-support-history">
          {(actQ.data ?? []).map((a) => (
            <li key={a.id}>
              <span>{t(`support.act_${a.action}`)}{a.action === 'assigned'
                ? `: ${a.new_value ? opName(a.new_value) : t('support.unassigned')}`
                : a.new_value && a.action !== 'attachment_added'
                  ? `: ${t(`support.${a.action === 'priority_changed' ? 'priority' : 'status'}_${a.new_value}`, { defaultValue: a.new_value })}`
                  : a.new_value ? `: ${a.new_value}` : ''}</span>
              <bdi dir="ltr" className="sb-form-hint">{fmtDateTime(a.created_at, i18n.language)} · {t(`support.actor_${a.actor_type}`)}</bdi>
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}
