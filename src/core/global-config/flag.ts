/**
 * Global v1 — the one switch for the Global business-configuration UI: the
 * activity and module steps in new-company onboarding, and the Settings entry
 * that reopens the wizard. Off by default and in production until global01 is
 * applied there. Module gating does not depend on it: it follows saved
 * configurations, and a company without one is a legacy company.
 */
export const GLOBAL_ONBOARDING = import.meta.env.VITE_GLOBAL_ONBOARDING === 'true';

/**
 * Global v1 Phase 6 — shows the branch-access controls (per-user access state
 * and the company enforcement switch). Off by default and in production until
 * global06 is applied and its activation is approved. Enforcement itself lives
 * in the database and stays inert while a company's switch is off.
 */
export const BRANCH_RESTRICTION_UI = import.meta.env.VITE_BRANCH_RESTRICTION === 'true';
