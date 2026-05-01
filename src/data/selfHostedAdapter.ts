import type { DataAdapter } from './adapter';

/**
 * Self-hosted mode adapter — stub for v1.
 *
 * Per Doc 1 + AGENTS.md §16: self-hosted mode runs against vanilla
 * Postgres + a small Express layer that mimics Supabase Auth + REST.
 * The implementation is deferred to Phase 12 (or v1.1).
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
      getSession: () => notImplemented('auth.getSession'),
      onAuthStateChange: () => notImplemented('auth.onAuthStateChange'),
      sendPasswordResetEmail: () => notImplemented('auth.sendPasswordResetEmail'),
      updatePassword: () => notImplemented('auth.updatePassword'),
    },
    companies: {
      list: () => notImplemented('companies.list'),
      getById: () => notImplemented('companies.getById'),
      update: () => notImplemented('companies.update'),
      uploadLogo: () => notImplemented('companies.uploadLogo'),
    },
    profiles: {
      getCurrent: () => notImplemented('profiles.getCurrent'),
    },
    onboarding: {
      createCompanyAndProfile: () => notImplemented('onboarding.createCompanyAndProfile'),
      insertCoaBatch: () => notImplemented('onboarding.insertCoaBatch'),
      insertTaxRate: () => notImplemented('onboarding.insertTaxRate'),
      insertPaymentMethod: () => notImplemented('onboarding.insertPaymentMethod'),
      insertUnit: () => notImplemented('onboarding.insertUnit'),
      insertWarehouse: () => notImplemented('onboarding.insertWarehouse'),
      insertBankAccount: () => notImplemented('onboarding.insertBankAccount'),
      getCoaByCodes: () => notImplemented('onboarding.getCoaByCodes'),
    },
  };
}
