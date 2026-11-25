/**
 * Document Activity (phase138) — who did what to this document, and when,
 * oldest first, in plain words.
 *
 * Read-only. It shows:
 *   • when the document was created (and by whom, for documents made after
 *     phase138 — older ones never recorded it, so no name is guessed);
 *   • its history from audit_logs (confirmed, reopened, voided, status changes…);
 *   • the documents that followed from it (payments applied, the invoice made
 *     from a quote, goods received against an order, …), each one a link.
 *
 * Screen only: never printed (data-print-hide). The full company-wide trail
 * stays at Reports → Audit log.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { ccy as ccyLabel } from '@/lib/currency-display';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Ban, CircleCheck, CirclePlus, FilePlus2, History, Pencil, RefreshCcw, Undo2, Wallet, ArrowRightLeft,
} from 'lucide-react';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { DocLink } from '@/ui/doc-link';
import { StatusBadge } from '@/ui/status-badge';
import type { ActivityDocKind, ActivityFollowOn, ApprovalStepRow, AuditLogLine, DocumentActivity as Activity } from '@/data/adapter';
import { stepLabel } from '@/components/approvals/approval-lists';
import { BadgeCheck, Package, Send, XCircle } from 'lucide-react';

type Tone = 'brand' | 'success' | 'warn' | 'danger' | 'muted';

interface ActivityEvent {
  key: string;
  at: string;
  user_id: string | null;
  tone: Tone;
  icon: ReactNode;
  what: string;
  status?: { from: string | null; to: string };
  link?: { type: string; id: string; number: string; isVoid: boolean };
  amount?: { value: number; currency: string | null };
  note?: string | null;
  /** phase145 — a name the step already carries (approval steps). */
  whoName?: string | null;
}

const VISIBLE = 6;
const ICON = { size: 15, 'aria-hidden': true } as const;

// Literal keys so the i18n key test can see every one.
const ACTION_KEY: Record<string, { key: string; tone: Tone; icon: ReactNode }> = {
  create:                    { key: 'actOcean.a_created',     tone: 'brand',   icon: <CirclePlus {...ICON} /> },
  confirm:                   { key: 'actOcean.a_confirmed',   tone: 'success', icon: <CircleCheck {...ICON} /> },
  post_gl:                   { key: 'actOcean.a_posted',      tone: 'success', icon: <CircleCheck {...ICON} /> },
  post_opening_balance:      { key: 'actOcean.a_posted',      tone: 'success', icon: <CircleCheck {...ICON} /> },
  post_gl_opening_balance:   { key: 'actOcean.a_posted',      tone: 'success', icon: <CircleCheck {...ICON} /> },
  post_bank_opening_balance: { key: 'actOcean.a_posted',      tone: 'success', icon: <CircleCheck {...ICON} /> },
  edit:                      { key: 'actOcean.a_reopened',    tone: 'warn',    icon: <Pencil {...ICON} /> },
  edit_reopen:               { key: 'actOcean.a_reopened',    tone: 'warn',    icon: <Pencil {...ICON} /> },
  reopen:                    { key: 'actOcean.a_reopened',    tone: 'warn',    icon: <Pencil {...ICON} /> },
  void:                      { key: 'actOcean.a_voided',      tone: 'danger',  icon: <Ban {...ICON} /> },
  void_opening_balance:      { key: 'actOcean.a_voided',      tone: 'danger',  icon: <Ban {...ICON} /> },
  reverse_gl:                { key: 'actOcean.a_reversed',    tone: 'danger',  icon: <Undo2 {...ICON} /> },
  delete:                    { key: 'actOcean.a_deleted',     tone: 'danger',  icon: <Ban {...ICON} /> },
  apply_advance:             { key: 'actOcean.a_advance',     tone: 'brand',   icon: <Wallet {...ICON} /> },
  restocking_fee:            { key: 'actOcean.a_fee',         tone: 'brand',   icon: <Wallet {...ICON} /> },
  restocking_fee_reversal:   { key: 'actOcean.a_fee_rev',     tone: 'warn',    icon: <Undo2 {...ICON} /> },
  writeoff:                  { key: 'actOcean.a_writeoff',    tone: 'brand',   icon: <FilePlus2 {...ICON} /> },
  writeoff_reversal:         { key: 'actOcean.a_writeoff_rev', tone: 'warn',   icon: <Undo2 {...ICON} /> },
  repair:                    { key: 'actOcean.a_repaired',    tone: 'muted',   icon: <RefreshCcw {...ICON} /> },
};

const FOLLOW_KEY: Record<ActivityFollowOn['kind'], string> = {
  invoice:       'actOcean.f_invoice',
  payment:       'actOcean.f_payment',
  credit_note:   'actOcean.f_credit_note',
  goods_receipt: 'actOcean.f_goods_receipt',
  vendor_bill:   'actOcean.f_vendor_bill',
  debit_note:    'actOcean.f_debit_note',
  refund:        'actOcean.f_refund',
};

function auditEvent(r: AuditLogLine): Omit<ActivityEvent, 'what'> & { whatKey: string } {
  const base = { key: r.id, at: r.created_at, user_id: r.user_id };
  const reason = (r.new_values?.reason ?? r.new_values?.void_reason ?? null) as string | null;
  // A status change logged by phase138 (quotes, purchase orders).
  const to = r.new_values?.status;
  if (r.action === 'update' && typeof to === 'string') {
    const from = r.old_values?.status;
    return { ...base, tone: 'brand', icon: <ArrowRightLeft {...ICON} />, whatKey: 'actOcean.a_status',
             status: { from: typeof from === 'string' ? from : null, to } };
  }
  // phase156 — the pack quantities were shown and accepted before saving.
  const packs = r.new_values?.packs_accepted;
  if (r.action === 'update' && Array.isArray(packs)) {
    return { ...base, tone: 'brand', icon: <Package {...ICON} />, whatKey: 'packs.accepted', note: packs.map(String).join(' · ') };
  }
  // reopen_expense logs itself as an 'update' on 'expenses'.
  if (r.action === 'update' && r.entity_type === 'expenses') {
    return { ...base, tone: 'warn', icon: <Pencil {...ICON} />, whatKey: 'actOcean.a_reopened' };
  }
  const m = ACTION_KEY[r.action];
  return m
    ? { ...base, tone: m.tone, icon: m.icon, whatKey: m.key, note: r.action.startsWith('void') ? reason : null }
    : { ...base, tone: 'muted', icon: <History {...ICON} />, whatKey: 'actOcean.a_updated' };
}

function money(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function DocumentActivity({ kind, id }: { kind: ActivityDocKind; id: string }) {
  const { t, i18n } = useTranslation();
  const company_id = useAuthStore((s) => s.company_id);
  const [all, setAll] = useState(false);

  const { data } = useQuery<Activity>({
    queryKey: ['document_activity', company_id, kind, id],
    queryFn: () => getAdapter().reports.getDocumentActivity(company_id!, kind, id),
    enabled: !!company_id && !!id,
  });
  // phase145 — approval steps (submitted / approved / rejected / admin void…).
  const { data: steps = [] } = useQuery<ApprovalStepRow[]>({
    queryKey: ['approval_steps', id],
    queryFn: () => getAdapter().approvals.docSteps(id),
    enabled: !!company_id && !!id,
  });
  const { data: users = [] } = useQuery({
    queryKey: ['company_users', company_id],
    queryFn: () => getAdapter().users.listUsers(company_id!),
    enabled: !!company_id,
  });

  const events = useMemo<ActivityEvent[]>(() => {
    const out: ActivityEvent[] = [];
    // A journal waiting for approval has no record yet — only its approval steps (phase150).
    if (data) {
    // The audit log may already hold a 'create' row; don't say it twice.
    if (data.created_at && !data.audit.some((r) => r.action === 'create')) {
      out.push({ key: 'created', at: data.created_at, user_id: data.created_by, tone: 'brand',
                 icon: <CirclePlus {...ICON} />, what: t('actOcean.a_created') });
    }
    for (const r of data.audit) {
      const { whatKey, ...e } = auditEvent(r);
      out.push({ ...e, what: t(whatKey) });
    }
    for (const f of data.follow_ons) {
      out.push({
        key: `${f.kind}-${f.doc_id}-${f.at}`, at: f.at, user_id: f.user_id,
        tone: f.is_void ? 'muted' : f.kind === 'payment' || f.kind === 'refund' ? 'success' : 'brand',
        icon: f.kind === 'payment' || f.kind === 'refund' ? <Wallet {...ICON} /> : <FilePlus2 {...ICON} />,
        what: t(FOLLOW_KEY[f.kind]),
        link: { type: f.doc_type, id: f.doc_id, number: f.number, isVoid: f.is_void },
        amount: f.amount != null && f.amount !== 0 ? { value: f.amount, currency: f.currency } : undefined,
      });
    }
    }
    for (const st of steps) {
      const tone: Tone = st.action === 'approved' || st.action === 'override' ? 'success'
        : st.action === 'rejected' || st.action === 'admin_void' ? 'danger'
        : st.action === 'cancelled' || st.action === 'admin_reopen' ? 'warn' : 'brand';
      const icon = st.action === 'approved' || st.action === 'override' ? <BadgeCheck {...ICON} />
        : st.action === 'rejected' || st.action === 'admin_void' ? <XCircle {...ICON} /> : <Send {...ICON} />;
      out.push({
        key: `appr-${st.created_at}-${st.action}`, at: st.created_at, user_id: st.by_user, tone, icon,
        what: st.to_name ? `${stepLabel(t, st.action)} → ${st.to_name}` : stepLabel(t, st.action),
        note: st.note, whoName: st.by_name,
      });
    }
    return out.sort((a, b) => a.at.localeCompare(b.at));
  }, [data, steps, t]);

  if ((!data && steps.length === 0) || events.length === 0) return null;

  const nameOf = (uid: string | null): string | null => {
    if (!uid) return null;
    const u = users.find((x) => x.id === uid);
    return u ? (u.full_name || u.email || t('actOcean.former_user')) : t('actOcean.former_user');
  };
  // Western digits in Arabic too (AGENTS §7.6).
  const when = new Intl.DateTimeFormat(i18n.language === 'ar' ? 'ar-u-nu-latn' : 'en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const shown = all || events.length <= VISIBLE ? events : events.slice(-VISIBLE);
  const hidden = events.length - shown.length;

  return (
    <section className="sb-ocean sb-card sb-act" data-print-hide data-testid="document-activity">
      <header className="sb-act-head">
        <History size={17} aria-hidden="true" />
        <h2 className="sb-act-title">{t('actOcean.title')}</h2>
        <span className="sb-act-count" dir="ltr">{events.length}</span>
      </header>
      {hidden > 0 && (
        <button type="button" className="sb-act-more" onClick={() => setAll(true)} data-testid="activity-show-all">
          {t('actOcean.show_earlier', { count: hidden })}
        </button>
      )}
      <ol className="sb-act-list">
        {shown.map((e) => {
          const who = e.whoName ?? nameOf(e.user_id);
          return (
            <li key={e.key} className={`sb-act-item is-${e.tone}`}>
              <span className="sb-act-dot">{e.icon}</span>
              <div className="sb-act-body">
                <p className="sb-act-what">
                  <span>{e.what}</span>
                  {e.status && (
                    <span className="sb-act-status">
                      {e.status.from && <><StatusBadge status={e.status.from} /><span aria-hidden="true">→</span></>}
                      <StatusBadge status={e.status.to} />
                    </span>
                  )}
                  {e.link && (
                    <bdi dir="ltr" className="sb-act-link">
                      <DocLink type={e.link.type} id={e.link.id} label={e.link.number} status={e.link.isVoid ? 'reversed' : 'active'} />
                    </bdi>
                  )}
                  {e.amount && (
                    <bdi dir="ltr" className="sb-act-amount">{e.amount.currency ? `${ccyLabel(e.amount.currency)} ` : ''}{money(e.amount.value)}</bdi>
                  )}
                </p>
                {e.note && <p className="sb-act-note">{e.note}</p>}
                <p className="sb-act-meta">
                  {who && <span className="sb-act-who">{who}</span>}
                  <time dateTime={e.at}>{when.format(new Date(e.at))}</time>
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
