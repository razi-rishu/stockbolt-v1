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
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { ROLE_LABELS, ROLE_DESCRIPTIONS, type AppRole } from '@/lib/permissions';
import { theme } from '@/ui/theme';
import { Button } from '@/ui/button';
import { LanguageToggle } from '@/components/language-toggle';
import type { PendingInvite } from '@/data/adapter';

export default function AcceptInvitePage() {
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
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load your invite.');
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [storeInvite, set_pending_invite]);

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
      setError(e instanceof Error ? e.message : 'Failed to accept the invite.');
      setBusy(false);
    }
  }

  async function signOut() {
    await getAdapter().auth.signOut();
    useAuthStore.getState().clear();
    navigate('/login', { replace: true });
  }

  return (
    <div style={{ minHeight: '100vh', background: theme.page, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ position: 'absolute', top: '16px', insetInlineEnd: '16px' }}><LanguageToggle /></div>
      <div style={{ width: '100%', maxWidth: '440px', background: '#fff', border: `1px solid ${theme.border}`, borderRadius: theme.radiusXl, boxShadow: theme.shadowLg, padding: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
          <div style={{ width: '34px', height: '34px', borderRadius: '9px', background: theme.brand, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800 }}>⚡</div>
          <span style={{ fontSize: '17px', fontWeight: 800, color: theme.ink }}>StockBolt</span>
        </div>

        {checking ? (
          <p style={{ color: theme.inkMuted, fontSize: '14px' }}>Checking your invitation…</p>
        ) : invite ? (
          <>
            <h1 style={{ fontSize: '20px', fontWeight: 800, color: theme.ink, margin: '0 0 6px' }}>You've been invited 🎉</h1>
            <p style={{ fontSize: '14px', color: theme.inkMuted, lineHeight: 1.6, margin: '0 0 18px' }}>
              Join <strong style={{ color: theme.ink }}>{invite.company_name}</strong> on StockBolt as{' '}
              <strong style={{ color: theme.brandSoftText }}>{ROLE_LABELS[invite.role as AppRole] ?? invite.role}</strong>.
            </p>
            <div style={{ background: theme.brandSoft, border: `1px solid ${theme.purpleBorder}`, borderRadius: theme.radiusLg, padding: '12px 14px', marginBottom: '20px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: theme.brandSoftText }}>{ROLE_LABELS[invite.role as AppRole] ?? invite.role}</div>
              <div style={{ fontSize: '12.5px', color: theme.inkMuted, marginTop: '3px' }}>{ROLE_DESCRIPTIONS[invite.role as AppRole] ?? ''}</div>
            </div>
            {error && <p style={{ color: theme.danger, fontSize: '13px', marginBottom: '12px' }}>{error}</p>}
            <Button onClick={accept} disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Joining…' : `Join ${invite.company_name}`}
            </Button>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: '20px', fontWeight: 800, color: theme.ink, margin: '0 0 6px' }}>No pending invite</h1>
            <p style={{ fontSize: '14px', color: theme.inkMuted, lineHeight: 1.6, margin: '0 0 18px' }}>
              We couldn't find an invitation for your email. If you're setting up a new business, create your company instead.
            </p>
            {error && <p style={{ color: theme.danger, fontSize: '13px', marginBottom: '12px' }}>{error}</p>}
            <Button onClick={() => navigate('/setup', { replace: true })} style={{ width: '100%' }}>Create a new company</Button>
          </>
        )}

        <button onClick={signOut} style={{ marginTop: '16px', width: '100%', background: 'none', border: 'none', color: theme.inkFaint, fontSize: '12.5px', cursor: 'pointer' }}>
          Sign out
        </button>
      </div>
    </div>
  );
}
