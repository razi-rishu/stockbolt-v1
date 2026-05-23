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
      // Phase 14.12b — read the previously-persisted auth state so we
      // know whether to trust the local snapshot when the network /
      // profiles fetch is slow or fails. The store has already been
      // rehydrated by the persist middleware before this hook runs.
      const persisted = useAuthStore.getState();
      const wasOnboardedLocally = persisted.is_onboarded;

      try {
        const session = await adapter.auth.getSession();
        if (cancelled) return;
        if (!session) {
          // No live session — wipe any stale local state and let
          // RequireAuth send the operator to /login.
          clear();
          setLoading(false);
          return;
        }

        set_session({ user_id: session.user_id, email: session.email });

        let profile: Awaited<ReturnType<typeof adapter.profiles.getCurrent>> = null;
        try {
          profile = await adapter.profiles.getCurrent();
        } catch (e) {
          // Phase 14.12b — surface the real error so refresh-into-/setup
          // bugs are diagnosable. Previously the outer catch swallowed
          // this silently and left is_onboarded=false.
          console.error('[useAuthInit] profiles.getCurrent threw:', e);
        }

        if (cancelled) return;

        if (profile) {
          set_profile({ company_id: profile.company_id, role: profile.role });
          set_onboarded(true);
        } else if (wasOnboardedLocally && persisted.company_id) {
          // Profile fetch failed but the persisted store says this user
          // was onboarded last session. Trust the local snapshot rather
          // than bouncing them to /setup. If the session is actually
          // invalid, the next API call will surface a clear error.
          console.warn(
            '[useAuthInit] profile fetch returned null; ' +
            'falling back to persisted is_onboarded=true. ' +
            'Check the network tab for the GET /rest/v1/profiles call.'
          );
          set_onboarded(true);
        }
        setLoading(false);
      } catch (e) {
        // Network / RLS error during bootstrap. Same fallback path:
        // if local state says onboarded, trust it; otherwise let
        // RequireAuth/RequireOnboarded handle it.
        console.error('[useAuthInit] bootstrap threw:', e);
        if (!cancelled) {
          if (wasOnboardedLocally) set_onboarded(true);
          setLoading(false);
        }
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
