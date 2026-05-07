import { useEffect, useState } from 'react';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import i18next from 'i18next';
import { applyDirection } from '@/i18n/config';

/**
 * Initialises auth state on app mount:
 * 1. Reads the current Supabase session.
 * 2. If session exists, fetches profile and populates the auth store.
 * 3. Subscribes to onAuthStateChange for future sign-in / sign-out events.
 *
 * Returns { loading } — consumers should render a spinner while loading.
 */
export function useAuthInit(): { loading: boolean } {
  const [loading, setLoading] = useState(true);
  const { set_session, set_profile, set_onboarded, set_language, clear, language } =
    useAuthStore.getState();

  // Apply stored language preference immediately (before async work)
  useEffect(() => {
    i18next.changeLanguage(language);
    applyDirection(language);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const adapter = getAdapter();
    let cancelled = false;

    async function bootstrap() {
      try {
        const session = await adapter.auth.getSession();
        if (!session || cancelled) {
          setLoading(false);
          return;
        }

        set_session({ user_id: session.user_id, email: session.email });

        const profile = await adapter.profiles.getCurrent();
        if (!cancelled) {
          if (profile) {
            set_profile({ company_id: profile.company_id, role: profile.role });
            set_onboarded(true);
          }
          setLoading(false);
        }
      } catch {
        // Network / RLS error during bootstrap — let the app render so the
        // user can at least see the login page or try again.
        if (!cancelled) setLoading(false);
      }
    }

    bootstrap();

    const unsubscribe = adapter.auth.onAuthStateChange(async (event, user_id) => {
      if (event === 'SIGNED_OUT') {
        clear();
        setLoading(false);
        return;
      }
      if (event === 'SIGNED_IN' && user_id) {
        const session = await adapter.auth.getSession();
        if (session) set_session({ user_id: session.user_id, email: session.email });

        const profile = await adapter.profiles.getCurrent();
        if (profile) {
          set_profile({ company_id: profile.company_id, role: profile.role });
          set_onboarded(true);
        } else {
          set_onboarded(false);
        }
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep language synced with store (for language toggle)
  const currentLanguage = useAuthStore((s) => s.language);
  useEffect(() => {
    i18next.changeLanguage(currentLanguage);
    applyDirection(currentLanguage);
    // Trigger re-render in case language changed while app was mounted
    set_language(currentLanguage);
  }, [currentLanguage, set_language]);

  return { loading };
}
