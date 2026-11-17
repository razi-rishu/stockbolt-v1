/**
 * Accept-invite screen (Phase 22).
 *
 * Where an invited teammate lands after signing up: instead of the
 * create-company wizard, they see "You've been invited to join <Company> as
 * <Role>" and one button to accept. accept_invite() attaches their profile to
 * the inviting company with the invited role, then they drop into the app.
 *
 * Reached via the guards (RequireOnboarded / RequireNotOnboarded) when a
 * signed-in user has no profile yet but a pending invite exists.
 */
import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MailCheck, MailQuestionMark } from 'lucide-react';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { LanguageToggle } from '@/components/language-toggle';
import { BrandLogo } from '@/components/brand-logo';
import type { PendingInvite } from '@/data/adapter';

// Role names and descriptions, translated (lib/permissions holds English only).
// Literal keys so the i18n key test can see every one.
const ROLE_NAME_KEY: Record<string, string> = {
  admin: 'global_config.branches.role.admin',
  accountant: 'global_config.branches.role.accountant',
  sales: 'global_config.branches.role.sales',
  counter: 'global_config.branches.role.counter',
  viewer: 'global_config.branches.role.viewer',
};
const ROLE_DESC_KEY: Record<string, string> = {
  admin: 'inviteOcean.desc_admin',
  accountant: 'inviteOcean.desc_accountant',
  sales: 'inviteOcean.desc_sales',
  counter: 'inviteOcean.desc_counter',
  viewer: 'inviteOcean.desc_viewer',
};

export default function AcceptInvitePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const storeInvite = useAuthStore((s) => s.pending_invite);
  const is_onboarded = useAuthStore((s) => s.is_onboarded);
  const { set_profile, set_onboarded, set_permissions, set_pending_invite } = useAuthStore.getState();

  const [invite, setInvite] = useState<PendingInvite | null>(storeInvite);
  const [checking, setChecking] = useState(!storeInvite);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If we arrived without the store flag (e.g. direct navigation), look it up.
  useEffect(() => {
    if (storeInvite) { setInvite(storeInvite); setChecking(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const found = await getAdapter().users.myPendingInvite();
        if (!cancelled) { setInvite(found); set_pending_invite(found); }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t('inviteOcean.err_load'));
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [storeInvite, set_pending_invite, t]);

  if (is_onboarded) return <Navigate to="/dashboard" replace />;

  async function accept() {
    setBusy(true); setError(null);
    try {
      const res = await getAdapter().users.acceptInvite();
      set_profile({ company_id: res.company_id, role: res.role });
      set_onboarded(true);
      set_pending_invite(null);
      try { set_permissions(await getAdapter().users.myPermissions()); } catch { /* gating falls back to matrix */ }
      navigate('/dashboard', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('inviteOcean.err_accept'));
      setBusy(false);
    }
  }

  async function signOut() {
    await getAdapter().auth.signOut();
    useAuthStore.getState().clear();
    navigate('/login', { replace: true });
  }

  const roleName = (r: string) => (ROLE_NAME_KEY[r] ? t(ROLE_NAME_KEY[r]) : r);
  const roleDesc = (r: string) => (ROLE_DESC_KEY[r] ? t(ROLE_DESC_KEY[r]) : '');

  // Ocean Teal (UI v1.1): look only — same lookup, same accept_invite() call.
  return (
    <div className="sb-ocean sb-notice-wrap is-full sb-invite" data-testid="accept-invite">
      <div className="sb-invite-lang"><LanguageToggle /></div>
      <div className="sb-card sb-notice sb-invite-card">
        <div className="sb-invite-logo"><BrandLogo mark={32} text={15} /></div>

        {checking ? (
          <p className="sb-notice-loading">{t('inviteOcean.checking')}</p>
        ) : invite ? (
          <>
            <span className="sb-notice-ico is-brand" aria-hidden="true"><MailCheck size={24} /></span>
            <h1 className="sb-notice-title">{t('inviteOcean.title')}</h1>
            <div className="sb-notice-body">
              <p style={{ margin: 0 }}>
                {t('inviteOcean.join_pre')} <strong className="sb-invite-strong">{invite.company_name}</strong>{' '}
                {t('inviteOcean.join_mid')} <strong className="sb-invite-role">{roleName(invite.role)}</strong>{t('inviteOcean.join_post')}
              </p>
            </div>
            <div className="sb-invite-rolebox">
              <span className="sb-invite-rolebox-name">{roleName(invite.role)}</span>
              {roleDesc(invite.role) && <span className="sb-invite-rolebox-desc">{roleDesc(invite.role)}</span>}
            </div>
            {error && <p className="sb-alert sb-alert-danger sb-invite-err" role="alert">{error}</p>}
            <button type="button" className="sb-primary-btn sb-invite-cta" onClick={accept} disabled={busy} data-testid="accept-invite-btn">
              {busy ? t('inviteOcean.joining') : t('inviteOcean.join_cta', { company: invite.company_name })}
            </button>
          </>
        ) : (
          <>
            <span className="sb-notice-ico is-warn" aria-hidden="true"><MailQuestionMark size={24} /></span>
            <h1 className="sb-notice-title">{t('inviteOcean.none_title')}</h1>
            <div className="sb-notice-body"><p style={{ margin: 0 }}>{t('inviteOcean.none_body')}</p></div>
            {error && <p className="sb-alert sb-alert-danger sb-invite-err" role="alert">{error}</p>}
            <button type="button" className="sb-primary-btn sb-invite-cta" onClick={() => navigate('/setup', { replace: true })}>
              {t('inviteOcean.create_company')}
            </button>
          </>
        )}

        <button type="button" onClick={signOut} className="sb-invite-signout">{t('inviteOcean.sign_out')}</button>
      </div>
    </div>
  );
}
