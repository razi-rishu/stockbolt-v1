/**
 * Invite link page (phase140) — /invite/:token, public.
 *
 * An admin shares this link (copy / WhatsApp / email) from Settings → Users.
 * It shows who invited the person and as what, then sends them to create an
 * account (or sign in) with the invited email already filled in. Joining
 * itself is unchanged: after sign-in, the guards route a user without a
 * company to /accept-invite, and accept_invite() checks the signed-in email.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MailCheck, MailQuestionMark } from 'lucide-react';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { LanguageToggle } from '@/components/language-toggle';
import { BrandLogo } from '@/components/brand-logo';

const ROLE_NAME_KEY: Record<string, string> = {
  admin: 'global_config.branches.role.admin',
  accountant: 'global_config.branches.role.accountant',
  sales: 'global_config.branches.role.sales',
  counter: 'global_config.branches.role.counter',
  viewer: 'global_config.branches.role.viewer',
};

export default function InviteLinkPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { token = '' } = useParams<{ token: string }>();
  const { user_id, email: signedInEmail, is_onboarded } = useAuthStore();
  const [signingOut, setSigningOut] = useState(false);

  const { data: invite, isLoading } = useQuery({
    queryKey: ['invite_preview', token],
    queryFn: () => getAdapter().users.getInvitePreview(token),
    enabled: !!token,
    retry: false,
  });

  const sameUser = !!invite && !!signedInEmail && signedInEmail.toLowerCase() === invite.email.toLowerCase();

  // Already signed in with the invited email and not in a company yet: straight to Join.
  useEffect(() => {
    if (sameUser && !is_onboarded) navigate('/accept-invite', { replace: true });
  }, [sameUser, is_onboarded, navigate]);

  const roleName = invite ? (ROLE_NAME_KEY[invite.role_key] ? t(ROLE_NAME_KEY[invite.role_key]) : invite.role_name) : '';
  const q = invite ? `?email=${encodeURIComponent(invite.email)}` : '';

  async function signOut() {
    setSigningOut(true);
    await getAdapter().auth.signOut().catch(() => undefined);
    useAuthStore.getState().clear();
    setSigningOut(false);
  }

  return (
    <div className="sb-ocean sb-notice-wrap is-full sb-invite" data-testid="invite-link-page">
      <div className="sb-invite-lang"><LanguageToggle /></div>
      <div className="sb-card sb-notice sb-invite-card">
        <div className="sb-invite-logo"><BrandLogo mark={32} text={15} /></div>

        {isLoading ? (
          <p className="sb-notice-loading">{t('inviteLink.checking')}</p>
        ) : !invite ? (
          <>
            <span className="sb-notice-ico is-warn" aria-hidden="true"><MailQuestionMark size={24} /></span>
            <h1 className="sb-notice-title">{t('inviteLink.invalid_title')}</h1>
            <div className="sb-notice-body"><p style={{ margin: 0 }}>{t('inviteLink.invalid_body')}</p></div>
            <Link to="/login" className="sb-primary-btn sb-invite-cta" style={{ textDecoration: 'none' }}>{t('inviteLink.signin')}</Link>
          </>
        ) : (
          <>
            <span className="sb-notice-ico is-brand" aria-hidden="true"><MailCheck size={24} /></span>
            <h1 className="sb-notice-title">{t('inviteOcean.title')}</h1>
            <div className="sb-notice-body">
              <p style={{ margin: 0 }}>
                {t('inviteOcean.join_pre')} <strong className="sb-invite-strong">{invite.company_name}</strong>{' '}
                {t('inviteOcean.join_mid')} <strong className="sb-invite-role">{roleName}</strong>{t('inviteOcean.join_post')}
              </p>
            </div>
            <div className="sb-invite-rolebox">
              <span className="sb-invite-rolebox-name">{t('inviteLink.for_email')}</span>
              <bdi dir="ltr" className="sb-invite-rolebox-desc" style={{ fontWeight: 700, color: 'var(--sb-text)' }} data-testid="invite-email">{invite.email}</bdi>
              <span className="sb-invite-rolebox-desc">{t('inviteLink.use_this_email')}</span>
            </div>

            {user_id && !sameUser ? (
              <>
                <p className="sb-alert sb-alert-warn sb-invite-err" role="status">
                  {t('inviteLink.other_user', { current: signedInEmail ?? '', email: invite.email })}
                </p>
                <button type="button" className="sb-primary-btn sb-invite-cta" disabled={signingOut} onClick={signOut}>
                  {t('inviteLink.sign_out_first')}
                </button>
              </>
            ) : sameUser && is_onboarded ? (
              <>
                <p className="sb-alert sb-alert-warn sb-invite-err" role="status">{t('inviteLink.already_member')}</p>
                <Link to="/dashboard" className="sb-primary-btn sb-invite-cta" style={{ textDecoration: 'none' }}>{t('inviteLink.open_app')}</Link>
              </>
            ) : (
              <>
                <Link to={`/register${q}`} className="sb-primary-btn sb-invite-cta" style={{ textDecoration: 'none' }} data-testid="invite-create-account">
                  {t('inviteLink.create')}
                </Link>
                <Link to={`/login${q}`} className="sb-invite-signout" style={{ textDecoration: 'none' }} data-testid="invite-sign-in">
                  {t('inviteLink.have_account')}
                </Link>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
