import type { DataAdapter } from './adapter';

/**
 * Self-hosted mode adapter — stub for v1.
 *
 * Per Doc 1 + AGENTS.md §16: self-hosted mode runs against vanilla
 * Postgres + a small Express layer that mimics Supabase Auth + REST.
 * The implementation is deferred to Phase 12 (or v1.1).
 *
 * Existence of this stub forces UI code to go through the adapter
 * abstraction even when only cloud mode is implemented — preventing
 * direct `@supabase/supabase-js` imports outside `src/data/`.
 */
export function createSelfHostedAdapter(): DataAdapter {
  const notImplemented = (method: string): never => {
    throw new Error(
      `Self-hosted adapter not implemented in v1 (called: ${method}). ` +
        `Set VITE_DEPLOYMENT_MODE=cloud in .env.local.`,
    );
  };

  return {
    auth: {
      signUp: () => notImplemented('auth.signUp'),
      signIn: () => notImplemented('auth.signIn'),
      signOut: () => notImplemented('auth.signOut'),
      getCurrentUserId: () => notImplemented('auth.getCurrentUserId'),
    },
    companies: {
      list: () => notImplemented('companies.list'),
      getById: () => notImplemented('companies.getById'),
    },
    profiles: {
      getCurrent: () => notImplemented('profiles.getCurrent'),
    },
  };
}
