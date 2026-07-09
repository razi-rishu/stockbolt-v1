import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Card } from '@/ui/card';

/**
 * Landing route for OAuth redirects (Google). The Supabase client parses the
 * tokens from the URL (detectSessionInUrl) and fires SIGNED_IN, which
 * useAuthInit turns into a populated auth store. This page just waits for
 * that, then routes exactly like the email/password login: profile exists →
 * /dashboard, no profile yet (fresh Google sign-up) → /setup (the guards
 * divert invited users to /accept-invite from there).
 */
export default function OAuthCallbackPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user_id = useAuthStore((s) => s.user_id);
  const [error, setError] = useState('');
  const handled = useRef(false);

  // Supabase reports OAuth failures via error_description in the URL
  // (query string or hash fragment, depending on the failure point).
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const desc =
      search.get('error_description') ??
      hash.get('error_description') ??
      search.get('error') ??
      hash.get('error');
    if (desc) setError(desc.replace(/\+/g, ' '));
  }, []);

  useEffect(() => {
    if (!user_id || handled.current) return;
    handled.current = true;
    (async () => {
      try {
        const profile = await getAdapter().profiles.getCurrent();
        navigate(profile ? '/dashboard' : '/setup', { replace: true });
      } catch {
        // Profile read hiccup — let the app-shell guards sort it out.
        navigate('/dashboard', { replace: true });
      }
    })();
  }, [user_id, navigate]);

  // No session materialised (direct visit, or a silent auth failure).
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (!useAuthStore.getState().user_id) setError((e) => e || t('auth.callback.timeout'));
    }, 12000);
    return () => window.clearTimeout(id);
  }, [t]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#ECEEF9] p-4">
      <Card className="w-full max-w-sm text-center" padding="lg">
        {error ? (
          <>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-danger-50">
              <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8 text-danger-500" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z" />
              </svg>
            </div>
            <h2 className="mb-2 text-xl font-semibold text-ink-primary">{t('auth.callback.error_title')}</h2>
            <p className="text-sm text-ink-secondary">{error}</p>
            <Button variant="secondary" className="mt-6 w-full" onClick={() => navigate('/login')}>
              {t('auth.callback.back')}
            </Button>
          </>
        ) : (
          <>
            <svg className="mx-auto mb-4 h-9 w-9 animate-spin text-brand-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <p className="text-sm font-medium text-ink-primary">{t('auth.callback.signing_in')}</p>
          </>
        )}
      </Card>
    </div>
  );
}
