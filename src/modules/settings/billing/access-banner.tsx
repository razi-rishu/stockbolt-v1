/**
 * phase151 — the subscription banner above every signed-in screen.
 *
 *   ends soon (≤ warn_days, no card saved)  → dismissible notice
 *   ended, in grace (switch on)             → countdown to read-only
 *   read-only (switch on)                   → persistent notice
 *   ended (switch off)                      → notice that the period ended
 *
 * Google Play: inside the Android app the wording names no price, no link and
 * no other way to pay — it only says the company administrator can renew.
 * On the website, admins get a link to Billing & Subscription; others are
 * told their administrator can renew.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Clock, Lock, X } from 'lucide-react';
import { getAdapter } from '@/data/index';
import type { CompanyAccess } from '@/data/adapter';
import { useAuthStore } from '@/store/auth';
import { isAppShell } from '@/lib/platform';
import { setCompanyReadOnly } from '@/lib/company-access';

export function useCompanyAccess() {
  const user_id = useAuthStore((s) => s.user_id);
  const company_id = useAuthStore((s) => s.company_id);
  const q = useQuery<CompanyAccess | null>({
    queryKey: ['company_access', user_id, company_id],
    queryFn: () => getAdapter().billing.getAccess(),
    enabled: !!user_id && !!company_id,
    staleTime: 10 * 60_000,
    retry: 1,
  });
  const enforcedReadOnly = !!q.data?.enforcement && q.data.state === 'read_only';
  useEffect(() => { setCompanyReadOnly(enforcedReadOnly); }, [enforcedReadOnly]);
  return q;
}

/** One line describing the access state — Billing page and /admin. */
export function accessLabel(a: CompanyAccess, t: (k: string, o?: Record<string, unknown>) => string, fmt: (d: string | null) => string): string {
  if (a.exempt) return t('billingAccess.state_exempt');
  if (a.state === 'grace') return t('billingAccess.state_grace', { date: fmt(a.read_only_from) });
  if (a.state === 'read_only') return t('billingAccess.state_read_only', { date: fmt(a.read_only_from) });
  return t('billingAccess.state_full');
}

type Kind = 'ending' | 'grace' | 'read_only' | 'ended';

function kindOf(a: CompanyAccess): Kind | null {
  if (a.exempt) return null;
  if (a.state === 'full') return a.warn ? 'ending' : null;
  if (!a.enforcement) return 'ended';
  return a.state === 'grace' ? 'grace' : 'read_only';
}

export function AccessBanner() {
  const { t, i18n } = useTranslation();
  const { data } = useCompanyAccess();
  const role = useAuthStore((s) => s.role);
  const [dismissed, setDismissed] = useState(false);
  const kind = data ? kindOf(data) : null;
  if (!data || !kind || (dismissed && kind === 'ending')) return null;

  const fmt = (d: string | null) => (d
    ? new Intl.DateTimeFormat(i18n.language === 'ar' ? 'ar-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        .format(new Date(`${d}T00:00:00`))
    : '');
  const vars = { date: fmt(kind === 'grace' ? data.read_only_from : data.ends_on), count: Math.max(0, data.days_left ?? 0) };
  const free = data.reason === 'free_period' || (data.reason === 'ended' && data.status === 'trialing');
  const failed = data.reason === 'payment_failed';

  let text: string;
  if (kind === 'ending') text = free ? t('billingAccess.ending_free', vars) : t('billingAccess.ending_paid', vars);
  else if (kind === 'grace') text = failed ? t('billingAccess.grace_failed', vars) : t('billingAccess.grace', vars);
  else if (kind === 'read_only') text = t('billingAccess.read_only');
  else text = free ? t('billingAccess.ended_free') : t('billingAccess.ended_paid');

  // Play-safe: the app never links to payment; only admins on the web do.
  const canRenewHere = !isAppShell() && role === 'admin';
  const tone = kind === 'read_only' ? 'sb-alert-danger' : 'sb-alert-warn';
  const Icon = kind === 'read_only' ? Lock : Clock;

  return (
    <div role="status" className="sb-ocean" style={{ position: 'sticky', top: 0, zIndex: 39 }} data-testid={`access-banner-${kind}`}>
      <div className={`sb-alert ${tone}`} style={{ margin: 0, borderRadius: 0, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Icon size={18} aria-hidden="true" />
        <span style={{ flex: 1, minWidth: 200 }}>
          {text}{' '}
          {!canRenewHere && <span>{t('billingAccess.ask_admin')}</span>}
        </span>
        {canRenewHere && (
          <Link to="/settings/billing" className="sb-primary-btn sb-btn-inline">{t('billingAccess.renew')}</Link>
        )}
        {kind === 'ending' && (
          <button type="button" className="sb-icon-btn" aria-label={t('billingAccess.dismiss')} onClick={() => setDismissed(true)}>
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
