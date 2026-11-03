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

import * as dotenv from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

// ── INFRA-1 Step 6 — local staging allow-list ───────────────────────────────
//
// assertNotProductionTarget() is a deny-list: it stops the one production ref
// and lets every other URL through, including the two other cloud projects on
// this account. Staging suites need the opposite: run ONLY against the Docker
// local Supabase stack on this machine, and refuse everything else.

/** Value STOCKBOLT_TARGET must hold in .env.staging.local. */
export const LOCAL_STAGING_MARKER = 'local-staging';
/** Ports of the local stack (stockbolt_local/supabase/config.toml). */
export const LOCAL_API_PORT = '54321';
export const LOCAL_DB_PORT = '54322';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Thrown when a staging target is not the local stack. */
export class StagingTargetError extends Error {
  constructor(message: string) {
    super(`\n[INFRA-1 staging guard] ${message}\nStaging suites run only against the local Supabase stack (127.0.0.1:${LOCAL_API_PORT}).\n`);
    this.name = 'StagingTargetError';
  }
}

/** Throw unless `url` is http(s) on a loopback host and exactly `port`. */
export function assertLocalUrl(url: string | undefined | null, port: string, label: string): void {
  if (!url) throw new StagingTargetError(`${label} is missing.`);
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new StagingTargetError(`${label} is not a valid URL.`);
  }
  const allowed = label === 'SUPABASE_DB_URL' ? ['postgres:', 'postgresql:'] : ['http:', 'https:'];
  if (!allowed.includes(u.protocol)) throw new StagingTargetError(`${label} must use ${allowed.join(' or ')}.`);
  if (!LOCAL_HOSTS.has(u.hostname.toLowerCase())) throw new StagingTargetError(`${label} host "${u.hostname}" is not this machine.`);
  if (u.port !== port) throw new StagingTargetError(`${label} must use port ${port}, not "${u.port || '(default)'}".`);
  // Only the DB URL may carry the local postgres login; an API URL never needs one.
  if (label !== 'SUPABASE_DB_URL' && (u.username || u.password)) throw new StagingTargetError(`${label} must not embed credentials.`);
}

/**
 * Validate a parsed staging env file. `prodEnv` is the parsed .env.local (the
 * production config), used only to refuse any value copied from it.
 * @example assertLocalStagingEnv(dotenv.parse(text), dotenv.parse(prodText));
 */
export function assertLocalStagingEnv(env: Record<string, string>, prodEnv: Record<string, string> = {}): void {
  if (env.STOCKBOLT_TARGET !== LOCAL_STAGING_MARKER) {
    throw new StagingTargetError(`STOCKBOLT_TARGET must be "${LOCAL_STAGING_MARKER}".`);
  }
  assertLocalUrl(env.VITE_SUPABASE_URL, LOCAL_API_PORT, 'VITE_SUPABASE_URL');
  if (env.SUPABASE_DB_URL !== undefined) assertLocalUrl(env.SUPABASE_DB_URL, LOCAL_DB_PORT, 'SUPABASE_DB_URL');
  for (const k of ['VITE_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY']) {
    if (!env[k]) throw new StagingTargetError(`${k} is missing.`);
  }
  for (const [k, v] of Object.entries(env)) {
    if (/supabase\.co/i.test(v) || v.toLowerCase().includes(PROD_PROJECT_REF)) {
      throw new StagingTargetError(`${k} points at a Supabase cloud project.`);
    }
  }
  const prodValues = new Set(Object.values(prodEnv).filter((v) => v.length >= 16));
  for (const [k, v] of Object.entries(env)) {
    // Names only in the message: the value may be a production secret.
    if (prodValues.has(v)) throw new StagingTargetError(`${k} has the same value as an entry in .env.local (production).`);
  }
}

/**
 * Read and validate `.env.staging.local` (or STAGING_ENV_FILE). Returns the
 * parsed values without touching process.env, so nothing else in the run can
 * pick them up. Throws before any client could be created.
 */
export function loadStagingEnv(cwd: string = process.cwd()): Record<string, string> {
  const file = resolve(cwd, process.env.STAGING_ENV_FILE ?? '.env.staging.local');
  if (!existsSync(file)) throw new StagingTargetError(`${file} not found.`);
  const env = dotenv.parse(readFileSync(file, 'utf8'));
  const prodFile = resolve(cwd, '.env.local');
  const prodEnv = existsSync(prodFile) ? dotenv.parse(readFileSync(prodFile, 'utf8')) : {};
  assertLocalStagingEnv(env, prodEnv);
  return env;
}
