/**
 * phase133 — one support request: the original description, the
 * conversation, files, and reply. The same page serves the customer and a
 * support operator; the operator also gets SupportOperatorPanel. What each
 * may see and do is decided by the server (RLS + support_* functions).
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Paperclip, Send, X, RotateCcw, Lock } from 'lucide-react';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { OceanPage } from '@/components/ocean-list';
import { BackButton } from '@/ui/back-button';
import { checkSupportFile, SUPPORT_MAX_FILES, type CheckedFile } from '@/lib/support-files';
import type { SupportAttachmentRow, SupportMessageRow, SupportTicketRow } from '@/data/adapter';
import { StatusPill, fmtDateTime, supportErrorText } from './labels';
import { SupportOperatorPanel } from './support-operator-panel';
import '@/styles/stockbolt-ocean-teal.css';

export default function SupportTicketPage() {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const { user_id } = useAuthStore();
  const qc = useQueryClient();
  const location = useLocation();
  const created = (location.state as { created?: string; uploadFailed?: boolean } | null) ?? null;

  const ticketQ = useQuery<SupportTicketRow | null>({ queryKey: ['support', 'ticket', id], queryFn: () => getAdapter().support.getTicket(id!) });
  const msgsQ = useQuery<SupportMessageRow[]>({ queryKey: ['support', 'messages', id], queryFn: () => getAdapter().support.listMessages(id!) });
  const filesQ = useQuery<SupportAttachmentRow[]>({ queryKey: ['support', 'files', id], queryFn: () => getAdapter().support.listAttachments(id!) });
  const countsQ = useQuery({ queryKey: ['support', 'unread'], queryFn: () => getAdapter().support.unreadCounts() });
  const ticket = ticketQ.data;
  const isOperatorView = !!countsQ.data?.is_operator && !!ticket && ticket.created_by !== user_id;

  // Viewing clears the unread mark (for whichever side is looking).
  const msgCount = msgsQ.data?.length ?? 0;
  useEffect(() => {
    if (!ticket) return;
    getAdapter().support.markRead(ticket.id)
      .then(() => qc.invalidateQueries({ queryKey: ['support', 'unread'] }))
      .catch(() => undefined);
  }, [ticket?.id, msgCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => qc.invalidateQueries({ queryKey: ['support'] });
  const [reply, setReply] = useState('');
  const [files, setFiles] = useState<CheckedFile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: async () => {
      const m = await getAdapter().support.addMessage(id!, reply.trim());
      for (const f of files) await getAdapter().support.uploadAttachment(id!, m.id, f.file, f.mime);
    },
    onSuccess: () => { setReply(''); setFiles([]); setError(null); refresh(); },
    onError: (e) => { setError(supportErrorText(t, e)); refresh(); },
  });
  const userStatus = useMutation({
    mutationFn: (action: 'close' | 'reopen') => getAdapter().support.userSetStatus(id!, action),
    onSuccess: refresh,
    onError: (e) => setError(supportErrorText(t, e)),
  });

  async function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (next.length >= SUPPORT_MAX_FILES) { setError(t('support.err_too_many_files')); break; }
      const r = await checkSupportFile(f);
      if (typeof r === 'string') { setError(t(`support.file_${r}`, { name: f.name })); continue; }
      next.push(r);
    }
    setFiles(next);
  }

  if (ticketQ.isLoading) return <div className="sb-ocean sb-page"><div className="sb-card sb-empty">{t('common.loading')}</div></div>;
  if (!ticket) return <div className="sb-ocean sb-page"><div className="sb-card sb-empty">{t('support.err_not_found')}</div></div>;

  const filesFor = (messageId: string | null) => (filesQ.data ?? []).filter((f) => f.message_id === messageId);
  const closed = ticket.status === 'closed';

  return (
    <OceanPage
      testid="support-ticket"
      title={ticket.subject}
      subtitle={<span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <bdi dir="ltr" className="sb-acct-code">{ticket.ticket_number}</bdi>
        <StatusPill status={ticket.status} />
        <span>{t(`support.cat_${ticket.category}`)}{ticket.module ? ` · ${t(`support.mod_${ticket.module}`, { defaultValue: ticket.module })}` : ''}</span>
      </span>}
      back={<BackButton to={isOperatorView ? '/support/inbox' : '/support'} label={isOperatorView ? t('support.inbox_title') : t('support.title')} />}
      actions={!isOperatorView ? (
        ticket.status === 'resolved'
          ? <button type="button" className="sb-secondary-btn sb-btn-inline" onClick={() => userStatus.mutate('reopen')}><RotateCcw size={16} aria-hidden="true" /> {t('support.reopen')}</button>
          : !closed && <button type="button" className="sb-secondary-btn sb-btn-inline" onClick={() => { if (window.confirm(t('support.confirm_close'))) userStatus.mutate('close'); }}><Lock size={16} aria-hidden="true" /> {t('support.close_request')}</button>
      ) : undefined}
    >
      <div className="sb-support-layout">
        <div className="space-y-3" style={{ minWidth: 0 }}>
          {created?.created && (
            <p className="sb-alert sb-alert-good" role="status" style={{ display: 'flex', gap: 8, margin: 0 }}>
              <CheckCircle2 size={18} aria-hidden="true" /> {t('support.created_ok', { no: created.created })}
            </p>
          )}
          {created?.uploadFailed && <p className="sb-alert sb-alert-warn" role="alert" style={{ margin: 0 }}>{t('support.upload_failed')}</p>}

          <Bubble who="user" label={t('support.you_wrote')} at={ticket.created_at} lang={i18n.language} text={ticket.description}
            files={filesFor(null)} />
          {(msgsQ.data ?? []).map((m) => (
            <Bubble key={m.id} who={m.sender_type}
              label={m.sender_type === 'operator' ? t('support.from_support') : (isOperatorView ? t('support.from_customer') : t('support.you_wrote'))}
              at={m.created_at} lang={i18n.language} text={m.message} files={filesFor(m.id)} />
          ))}

          {closed ? (
            <p className="sb-info-note" style={{ margin: 0 }}>{t('support.closed_note')}</p>
          ) : (
            <form className="sb-card sb-form" style={{ padding: 14 }} onSubmit={(e) => { e.preventDefault(); if (reply.trim()) send.mutate(); }}>
              <label className="sr-only" htmlFor="sp-reply">{t('support.reply')}</label>
              <textarea id="sp-reply" rows={4} maxLength={10000} className="sb-pc-select" style={{ width: '100%' }}
                placeholder={t('support.reply_ph')} value={reply} onChange={(e) => setReply(e.target.value)} />
              {files.length > 0 && (
                <ul className="sb-support-files">
                  {files.map((f, i) => <li key={i}><span>{f.file.name}</span>
                    <button type="button" aria-label={t('support.remove_file', { name: f.file.name })} onClick={() => setFiles(files.filter((_, k) => k !== i))}><X size={14} aria-hidden="true" /></button></li>)}
                </ul>
              )}
              {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}
              <div className="flex flex-wrap items-center justify-between gap-2" style={{ marginTop: 8 }}>
                <label className="sb-secondary-btn sb-btn-inline" style={{ cursor: 'pointer' }}>
                  <Paperclip size={16} aria-hidden="true" /> {t('support.add_files')}
                  <input type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" className="sr-only"
                    onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
                </label>
                <button type="submit" className="sb-primary-btn sb-btn-inline" disabled={send.isPending || !reply.trim()}>
                  <Send size={16} aria-hidden="true" /> {send.isPending ? t('support.sending') : t('support.send_reply')}
                </button>
              </div>
            </form>
          )}
        </div>

        {isOperatorView && <SupportOperatorPanel ticket={ticket} />}
      </div>
    </OceanPage>
  );
}

function Bubble({ who, label, at, lang, text, files }: {
  who: 'user' | 'operator'; label: string; at: string; lang: string; text: string; files: SupportAttachmentRow[];
}) {
  return (
    <div className={`sb-card sb-support-msg ${who === 'operator' ? 'is-operator' : ''}`}>
      <p className="sb-support-msg-head"><strong>{label}</strong> · <bdi dir="ltr">{fmtDateTime(at, lang)}</bdi></p>
      <p className="sb-support-msg-body">{text}</p>
      {files.length > 0 && <FileLinks files={files} />}
    </div>
  );
}

/** Files open through a short-lived signed URL, issued only after the server's access check. */
function FileLinks({ files }: { files: SupportAttachmentRow[] }) {
  const { t } = useTranslation();
  const [err, setErr] = useState(false);
  async function open(f: SupportAttachmentRow) {
    setErr(false);
    try { window.open(await getAdapter().support.attachmentUrl(f.storage_path), '_blank', 'noopener,noreferrer'); }
    catch { setErr(true); }
  }
  return (
    <div className="sb-support-files" style={{ marginTop: 8 }}>
      {files.map((f) => (
        <button key={f.id} type="button" className="sb-chip" onClick={() => void open(f)}>
          <Paperclip size={13} aria-hidden="true" /> {f.original_filename}
        </button>
      ))}
      {err && <span className="sb-wiz-err">{t('support.file_open_failed')}</span>}
    </div>
  );
}
