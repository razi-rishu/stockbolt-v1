/**
 * H4 · Phase P0 — production-target safety guard for MUTATING test suites.
 *
 * The phase0–2 verification suites CREATE and DELETE real auth users and
 * companies. Until a dedicated staging Supabase project exists (roadmap P1+),
 * the only configured target is production. This guard makes those suites
 * REFUSE to run against the production project rather than write to a live
 * customer database.
 *
 * Read-only suites (regressions.test.ts — the prod integrity monitor) do NOT
 * call this guard; they are allowed to READ production.
 *
 * When a staging target lands (roadmap P3), the harness will point at a non-prod
 * URL and this guard passes automatically — no change needed here (unless the
 * prod ref itself ever changes).
 */

/** The live production Supabase project ref (host of VITE_SUPABASE_URL). */
export const PROD_PROJECT_REF = 'gzpkuaioibqrdppjdbwz';

/** Extract `<ref>` from a `https://<ref>.supabase.co` URL, or null if unparsable. */
export function projectRefFromUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  const m = url.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Throw if `url` targets the production project. Call this FIRST inside a
 * mutating suite's `beforeAll`, before any createUser / onboarding / insert, so
 * the suite aborts before it can write anything to production.
 */
export function assertNotProductionTarget(url: string | undefined | null): void {
  const ref = projectRefFromUrl(url);
  if (ref === PROD_PROJECT_REF) {
    throw new Error(
      '\n[H4 P0 guard] Refusing to run a MUTATING test suite against the ' +
        `PRODUCTION Supabase project (${PROD_PROJECT_REF}).\n` +
        'These suites create and delete real users and companies. Point the ' +
        'test harness at a staging project (roadmap P1/P3) before running ' +
        'phase0–2.\n' +
        'Read-only checks (npm run test:regressions) are unaffected.\n',
    );
  }
}
