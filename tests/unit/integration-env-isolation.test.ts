/**
 * INFRA-1 Plan A — integration suites must never pick up production credentials.
 *
 * Static: reads repo files only. Every integration suite that talks to Supabase
 * must load its target through loadStagingEnv() (local stack only). The one
 * exception is the read-only regression monitor, which is listed by name and
 * must stay out of the pre-commit hook and CI.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const DIR = join(ROOT, 'tests/integration');
/** Reads production on purpose (read-only, service-role). On demand only. */
const PRODUCTION_READERS = new Set(['regressions.test.ts']);

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const suites = readdirSync(DIR)
  .filter((f) => f.endsWith('.test.ts'))
  .map((f) => ({ name: f, code: strip(readFileSync(join(DIR, f), 'utf8')) }));
const talksToSupabase = (code: string) => /createClient\s*[<(]|createSupabaseAdapter\s*\(/.test(code);

describe('integration suites resolve to local staging only', () => {
  it('found the suites', () => expect(suites.length).toBeGreaterThan(15));

  const dbSuites = suites.filter((s) => talksToSupabase(s.code) && !PRODUCTION_READERS.has(s.name));

  it('the nine mutating suites plus Finding E, Finding C, Global01 and company currency are covered', () => {
    expect(dbSuites.map((s) => s.name).sort()).toEqual([
      'amortization-verification.test.ts', 'company-currency-verification.test.ts', 'deferred-cogs-verification.test.ts', 'finding-c-verification.test.ts',
      'finding-e-verification.test.ts',
      'fixed-assets-verification.test.ts', 'global-wizard-verification.test.ts', 'global01-config-verification.test.ts', 'phase0-rls.test.ts', 'phase1-verification.test.ts',
      'phase2-verification.test.ts', 'tax-return-verification.test.ts', 'tds-verification.test.ts',
      'year-end-close-verification.test.ts',
    ]);
  });

  for (const s of dbSuites) {
    it(`${s.name} loads its target through loadStagingEnv()`, () => {
      expect(s.code).toMatch(/=\s*loadStagingEnv\(\s*\)/);
    });
    it(`${s.name} never loads .env.local or reads Supabase settings from process.env`, () => {
      expect(s.code).not.toMatch(/['"`]\.env\.local['"`]/);
      expect(s.code).not.toMatch(/dotenv\.config\s*\(/);
      expect(s.code).not.toMatch(/process\.env\.(VITE_SUPABASE_|SUPABASE_)/);
    });
  }

  for (const s of suites) {
    it(`${s.name} has no hard-coded Supabase cloud URL`, () => {
      expect(s.code).not.toMatch(/https?:\/\/[a-z0-9]+\.supabase\.(co|com)/i);
    });
    // getSupabaseClient() and an argument-less createSupabaseAdapter() build the
    // app's own client from import.meta.env, which Vitest fills from .env.local.
    it(`${s.name} never uses the app's own Supabase client`, () => {
      expect(s.code).not.toMatch(/getSupabaseClient\s*\(/);
      expect(s.code).not.toMatch(/createSupabaseAdapter\s*\(\s*\)/);
    });
  }
});

describe('the production reader stays on demand', () => {
  const hook = readFileSync(join(ROOT, '.husky/pre-commit'), 'utf8');
  const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  // Commands only: comments and echo'd notes may name the suite without running it.
  const commands = (text: string) =>
    text.split('\n').filter((l) => !/^\s*(#|echo\b)/.test(l)).join('\n');

  it('the pre-commit hook runs only the static suite', () => {
    const cmd = commands(hook);
    expect(cmd).toMatch(/npm run test:security-static/);
    expect(cmd).not.toMatch(/test:regressions|regressions\.test|npm (run )?test(\s|$)|vitest run\s*$/m);
  });

  it('CI runs only the static suite', () => {
    const cmd = commands(ci);
    expect(cmd).not.toMatch(/test:regressions|regressions\.test|npm (run )?test(\s|$)/m);
  });
});
