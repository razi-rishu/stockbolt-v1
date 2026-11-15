/** phase133 — shared labels and badges for the Help & Support screens. */
import { useTranslation } from 'react-i18next';
import { LifeBuoy, Bug, Lightbulb, MessageSquare } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SupportCategory, SupportStatus, SupportPriority } from '@/data/adapter';

export const CATEGORIES: { key: SupportCategory; icon: ReactNode }[] = [
  { key: 'assistance', icon: <LifeBuoy size={22} aria-hidden="true" /> },
  { key: 'bug',        icon: <Bug size={22} aria-hidden="true" /> },
  { key: 'feature',    icon: <Lightbulb size={22} aria-hidden="true" /> },
  { key: 'feedback',   icon: <MessageSquare size={22} aria-hidden="true" /> },
];
export const STATUSES: SupportStatus[] = ['submitted', 'in_progress', 'waiting_for_user', 'resolved', 'closed'];
export const PRIORITIES: SupportPriority[] = ['low', 'normal', 'high', 'urgent'];
/** Modules a user can point to (optional, free of company data). */
export const MODULES = ['sales', 'purchasing', 'inventory', 'accounting', 'banking', 'payroll', 'reports', 'settings', 'other'] as const;

const STATUS_PILL: Record<SupportStatus, string> = {
  submitted: 'sb-pill-muted', in_progress: 'sb-pill-good', waiting_for_user: 'sb-pill-warn',
  resolved: 'sb-pill-good', closed: 'sb-pill-muted',
};

export function StatusPill({ status }: { status: SupportStatus }) {
  const { t } = useTranslation();
  return <span className={`sb-pill ${STATUS_PILL[status]}`}>{t(`support.status_${status}`)}</span>;
}

export function UnreadDot({ label }: { label: string }) {
  return <span className="sb-support-dot" role="img" aria-label={label} title={label} />;
}

/** Map a server error ('support: rate_limited', …) to a translated message. */
export function supportErrorText(t: (k: string) => string, e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  const m = /support: ([a-z_]+)/.exec(msg);
  const known = ['rate_limited', 'ticket_closed', 'invalid_input', 'file_type', 'file_size', 'too_many_files',
    'file_missing', 'file_mismatch', 'status_not_allowed', 'operators_only'];
  if (m && known.includes(m[1])) return t(`support.err_${m[1]}`);
  if (/operators only/.test(msg)) return t('support.err_operators_only');
  if (/not found/.test(msg)) return t('support.err_not_found');
  return t('support.err_generic');
}

export const fmtDateTime = (iso: string, lang: string) =>
  new Date(iso).toLocaleString(lang === 'ar' ? 'ar' : undefined, { dateStyle: 'medium', timeStyle: 'short' });
