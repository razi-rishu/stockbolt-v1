/**
 * Global v1 — the one switch for the Global business-configuration UI: the
 * activity and module steps in new-company onboarding, and the Settings entry
 * that reopens the wizard. Off by default and in production until global01 is
 * applied there. Module gating does not depend on it: it follows saved
 * configurations, and a company without one is a legacy company.
 */
export const GLOBAL_ONBOARDING = import.meta.env.VITE_GLOBAL_ONBOARDING === 'true';
