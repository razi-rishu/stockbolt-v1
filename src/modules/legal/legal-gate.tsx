/**
 * phase135 — sits in front of every signed-in screen (setup wizard included).
 *
 * - Nothing published, or everything accepted → the app, untouched.
 * - Something owed, enforcement OFF → the app, with a banner inviting review.
 * - Something owed, enforcement ON  → the agreement screen, except on the
 *   paths a user must always reach: Help & Support, Download my data, and
 *   the agreement page itself. (/terms, /privacy and /delete-account are
 *   public routes outside this gate.)
 *
 * The server is the real enforcement (has_perm + posting guard). If the status
 * cannot be read — offline, or before the migration exists — the gate lets the
 * user through rather than trap them; the server still refuses what it must.
 */
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileText, X } from 'lucide-react';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import type { LegalStatus } from '@/data/adapter';
import { AgreementScreen } from './agreement-screen';

const ALWAYS_OPEN = ['/legal/accept', '/support', '/settings/import-export'];

export function useLegalStatus() {
  const user_id = useAuthStore((s) => s.user_id);
  return useQuery<LegalStatus>({
    queryKey: ['legal', 'status', user_id],
    queryFn: () => getAdapter().legal.status(),
    enabled: !!user_id,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export function LegalGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { data } = useLegalStatus();
  const [dismissed, setDismissed] = useState(false);

  const owed = (data?.documents ?? []).filter((d) => d.requires_acceptance && !d.accepted);
  if (!data || owed.length === 0) return <>{children}</>;

  const open = ALWAYS_OPEN.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (data.enforcement && !open) return <AgreementScreen />;
  if (pathname === '/legal/accept') return <>{children}</>;

  return (
    <>
      {!dismissed && (
        <div role="status" className="sb-ocean" style={{ position: 'sticky', top: 0, zIndex: 40 }}>
          <div className="sb-alert sb-alert-warn" style={{ margin: 0, borderRadius: 0, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <FileText size={18} aria-hidden="true" />
            <span style={{ flex: 1, minWidth: 200 }}>
              {data.enforcement ? t('legal.banner_required') : t('legal.banner_review')}
            </span>
            <Link to="/legal/accept" className="sb-primary-btn sb-btn-inline">{t('legal.review')}</Link>
            {!data.enforcement && (
              <button type="button" className="sb-icon-btn" aria-label={t('legal.dismiss')} onClick={() => setDismissed(true)}>
                <X size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      )}
      {children}
    </>
  );
}
