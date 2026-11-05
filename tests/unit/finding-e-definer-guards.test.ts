import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Finding E — cross-tenant access through SECURITY DEFINER functions.
 *
 * phase65 gave every SECURITY DEFINER function that takes a company id this
 * guard:
 *
 *     IF auth.uid() IS NOT NULL AND current_user_company_id() IS NOT NULL
 *        AND p_company_id IS DISTINCT FROM current_user_company_id() THEN RAISE
 *
 * It skipped the check entirely for the public anon key (no user) and for any
 * signed-up user who had not created a company yet. Company ids are public (the
 * logos bucket path), so either could read customers, products, cash and bank
 * data — or rewrite reconciliations and stock costs — of any tenant. Confirmed
 * on production 2026-11-02; fixed by phase109 (guards) and phase109b (anon
 * grants). See docs/STOCKBOLT_SECURITY_INVESTIGATION_2026-11-01.md.
 *
 * WHY STATIC, AND WHY NOTHING HERE SKIPS
 * These checks read the migration files and the adapter — never a database —
 * so they run in CI and pre-commit with no credentials. The repo is what a
 * staging or disaster-recovery database is rebuilt from, so a guard that is
 * missing here is missing there. The live behaviour (real users, real
 * companies) is proven by tests/integration/finding-e-verification.test.ts,
 * which runs only against staging.
 *
 * Every check asserts. There is no "not applied yet, warn and pass" branch:
 * the V-RLS1 tripwire had one, and it switched itself off on the very
 * regression it existed to catch.
 */

const MIGRATIONS = resolve(process.cwd(), 'supabase/migrations');
const FILES = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();

/** A position in the migration history: file order first, then offset. */
type Pos = [fileIndex: number, offset: number];
const after = (a: Pos, b: Pos) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);

interface Definition { file: string; pos: Pos; text: string; params: string[]; definer: boolean }

/** Blanks `--` comments with spaces of the same length, so offsets still line up with the raw file. */
const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, (c) => ' '.repeat(c.length));

/** Parameter names from a signature such as `(p_a uuid, p_b text DEFAULT NULL::text)`. */
function paramNames(signature: string): string[] {
  return signature
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0])
    .filter((name) => /^[a-z_][a-z0-9_]*$/i.test(name ?? ''))
    .map((name) => name.toLowerCase());
}

const sources = FILES.map((f) => readFileSync(resolve(MIGRATIONS, f), 'utf8'));

/** The latest definition of every public function, by migration order. */
const latest = new Map<string, Definition>();
const header = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z_0-9]+)\s*\(/gi;
sources.forEach((src, fi) => {
  for (const m of src.matchAll(header)) {
    const name = m[1].toLowerCase();
    const start = m.index!;
    // The parameter list ends at the parenthesis that balances the opening one.
    let depth = 1;
    let i = start + m[0].length;
    while (depth > 0 && i < src.length) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
      i++;
    }
    const signature = src.slice(start + m[0].length, i - 1);
    const tag = /AS\s+(\$[a-z_]*\$)/i.exec(src.slice(i));
    if (!tag) continue; // a COMMENT ON FUNCTION or similar, not a definition
    const bodyStart = i + tag.index! + tag[0].length;
    const bodyEnd = src.indexOf(tag[1], bodyStart);
    const text = src.slice(start, bodyEnd === -1 ? src.length : bodyEnd + tag[1].length);
    latest.set(name, {
      file: FILES[fi],
      pos: [fi, start],
      text,
      params: paramNames(signature),
      definer: /SECURITY\s+DEFINER/i.test(text.slice(0, text.search(/AS\s+\$/i) + 1) || text),
    });
  }
});

function def(name: string): Definition {
  const d = latest.get(name);
  if (!d) throw new Error(`no definition of public.${name} found in supabase/migrations`);
  return d;
}

/** Every position where a statement matching `re` mentions `fn` (by name or in a proname IN list). */
function statementsFor(fn: string, re: RegExp): Pos[] {
  const out: Pos[] = [];
  sources.forEach((raw, fi) => {
    const src = stripComments(raw);
    for (const m of src.matchAll(re)) {
      const stmt = m[0];
      const inList = /proname\s+IN\s*\(([^)]*)\)/i.exec(stmt)?.[1] ?? '';
      if (new RegExp(`\\b${fn}\\b`, 'i').test(stmt.replace(inList, '')) || inList.includes(`'${fn}'`)) {
        out.push([fi, m.index!]);
      }
    }
  });
  return out;
}

const REVOKE_ANON = /(?:REVOKE[^;]*?ON\s+FUNCTION[^;]*?FROM[^;]*?\banon\b[^;]*;)|(?:DO\s+\$\$[\s\S]*?proname\s+IN\s*\([^)]*\)[\s\S]*?REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+%s\s+FROM\s+anon[\s\S]*?END\s+\$\$)/gi;
const REVOKE_AUTH = /REVOKE[^;]*?ON\s+FUNCTION[^;]*?FROM[^;]*?\bauthenticated\b[^;]*;/gi;
const GRANT_ANON = /GRANT[^;]*?ON\s+FUNCTION[^;]*?TO[^;]*?\b(?:anon|PUBLIC)\b[^;]*;/gi;
const DROP_FN = /DROP\s+FUNCTION[^;]*;/gi;

const lastOf = (ps: Pos[]): Pos | null => ps.reduce<Pos | null>((m, p) => (m === null || after(p, m) ? p : m), null);

/** True when the repo leaves `fn` revoked from anon: a revoke after any DROP, and no re-grant after it. */
function anonRevoked(fn: string): boolean {
  const revoke = lastOf(statementsFor(fn, REVOKE_ANON));
  if (!revoke) return false;
  const drop = lastOf(statementsFor(fn, DROP_FN));
  if (drop && after(drop, revoke)) return false;
  const regrant = lastOf(statementsFor(fn, GRANT_ANON));
  return !(regrant && after(regrant, revoke));
}

// ── The classification ──────────────────────────────────────────────────────
// Every SECURITY DEFINER function taking p_company_id must be listed here, so a
// new one cannot ship without someone deciding how it is guarded.

/** Callable by signed-in users; must carry the phase109 guard. */
const PHASE109_GUARDED = [
  'get_bank_recon', 'get_daily_cash_report', 'get_project_profitability', 'recompute_stock_valuation',
  'save_bank_reconciliation', 'search_contacts', 'search_products',
] as const;
/** Called only by the Edge Function with the service role key. */
const SERVICE_ROLE_ONLY = ['api_current_stock', 'company_has_api_access'] as const;
/** Called only by the companies INSERT trigger; clients hold no EXECUTE. */
const TRIGGER_ONLY = ['seed_default_tax_rates', 'seed_default_tds_sections', 'ensure_default_branch'] as const; // phase113: TDS sections for India companies; global03: Head Office
/** Guarded by its own admin-of-this-company check. */
const OWN_ADMIN_CHECK = ['reset_company_data'] as const;

const CLASSIFIED = new Set<string>([...PHASE109_GUARDED, ...SERVICE_ROLE_ONLY, ...TRIGGER_ONLY, ...OWN_ADMIN_CHECK]);

const OLD_CARVE_OUT = /auth\.uid\(\)\s+IS\s+NOT\s+NULL\s+AND\s+public\.current_user_company_id\(\)\s+IS\s+NOT\s+NULL/i;

describe('Finding E — every SECURITY DEFINER function taking a company id is classified', () => {
  it('found the migration history', () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(latest.size).toBeGreaterThan(100);
  });

  it('no unclassified SECURITY DEFINER function takes p_company_id', () => {
    const unclassified = [...latest.entries()]
      .filter(([, d]) => d.definer && d.params.includes('p_company_id'))
      .map(([name]) => name)
      .filter((name) => !CLASSIFIED.has(name));
    expect(
      unclassified,
      'new SECURITY DEFINER function(s) take p_company_id: give them the phase109 guard, ' +
        'revoke EXECUTE from anon, and add them to the classification in this test',
    ).toEqual([]);
  });

  it('every classified function still exists and is SECURITY DEFINER', () => {
    for (const name of CLASSIFIED) expect(def(name).definer, `${name} is SECURITY DEFINER`).toBe(true);
  });
});

describe('Finding E — the phase109 guard is present and runs first', () => {
  for (const name of PHASE109_GUARDED) {
    it(`${name} refuses missing users unless trusted, and any other company`, () => {
      const body = stripComments(def(name).text);
      const noUser =
        /IF\s+auth\.uid\(\)\s+IS\s+NULL\s+THEN\s+IF\s+session_user\s*=\s*'authenticator'\s+AND\s+coalesce\(auth\.role\(\),\s*''\)\s*<>\s*'service_role'\s+THEN\s+RAISE\s+EXCEPTION[^;]*ERRCODE\s*=\s*'42501'\s*;\s*END\s+IF\s*;/i;
      const otherCompany =
        /ELSIF\s+p_company_id\s+IS\s+DISTINCT\s+FROM\s+public\.current_user_company_id\(\)\s+THEN\s+RAISE\s+EXCEPTION[^;]*ERRCODE\s*=\s*'42501'\s*;\s*END\s+IF\s*;/i;
      expect(noUser.test(body), `${name}: no-user branch`).toBe(true);
      expect(otherCompany.test(body), `${name}: other-company branch`).toBe(true);
      expect(OLD_CARVE_OUT.test(body), `${name}: old phase65 carve-out is gone`).toBe(false);

      // The guard must run before the function touches any table.
      const begin = body.search(/\bBEGIN\b/i);
      const guard = body.search(/IF\s+auth\.uid\(\)\s+IS\s+NULL\s+THEN/i);
      const firstTable = body.slice(begin).search(/\b(?:FROM|UPDATE|INSERT\s+INTO|DELETE\s+FROM|JOIN)\s+public\.(?!current_user_company_id)/i);
      expect(guard, `${name}: guard found`).toBeGreaterThan(begin);
      expect(firstTable === -1 || begin + firstTable > guard, `${name}: guard precedes the first table access`).toBe(true);
    });
  }
});

describe('Finding E — the old carve-out survives only where no client can call it', () => {
  it('no client-callable function keeps the phase65 carve-out', () => {
    const offenders = [...latest.entries()]
      .filter(([, d]) => OLD_CARVE_OUT.test(stripComments(d.text)))
      .map(([name]) => name)
      .filter((name) => !(TRIGGER_ONLY as readonly string[]).includes(name));
    expect(offenders, 'functions still skipping the company check for anon / company-less callers').toEqual([]);
  });

  for (const name of TRIGGER_ONLY) {
    it(`${name} is not executable by authenticated or anon`, () => {
      const revokeAuth = lastOf(statementsFor(name, REVOKE_AUTH));
      expect(revokeAuth, `${name}: REVOKE ... FROM authenticated`).not.toBeNull();
      expect(after(revokeAuth!, def(name).pos), `${name}: revoke after last definition`).toBe(true);
      expect(anonRevoked(name), `${name}: revoked from anon`).toBe(true);
    });
  }
});

// ── delete_bank_reconciliation (phase103 intent, restored by phase109c) ─────
// phase103 meant this function to require accounting.write. It never reached
// production, and its production regression tests only ran if the live body
// said "Phase 103", so they skipped silently for as long as the fix was
// missing. These checks replace them. They read the repo, run unconditionally,
// and parse the function's own authorisation branches rather than searching
// the whole body for the first table access: in phase109c the operator-only
// branch legitimately reads the table before the signed-in branch's check.

/** Any statement that touches a table (not the auth helper calls). */
const TABLE_ACCESS = /\b(?:FROM|UPDATE|INSERT\s+INTO|DELETE\s+FROM|JOIN)\s+public\.(?!current_user_company_id\b|auth_require\b)/i;

interface AuthBranches { preamble: string; noUser: string; user: string; after: string; elseKeyword: string }

/**
 * Splits a body's top-level `IF auth.uid() IS NULL THEN ... ELSE ... END IF;`
 * into the code before it, the no-user branch, the signed-in branch and the
 * code after it. Nested IF ... END IF blocks are matched by depth. Returns null
 * when the structure is not there, which every caller treats as a failure.
 */
function authBranches(body: string): AuthBranches | null {
  const begin = body.search(/\bBEGIN\b/i);
  if (begin === -1) return null;
  const rel = body.slice(begin).search(/\bIF\s+auth\.uid\(\)\s+IS\s+NULL\s+THEN\b/i);
  if (rel === -1) return null;
  const start = begin + rel;
  const tokens = /\bEND\s+IF\b|\bELSIF\b|\bELSE\b|\bIF\b/gi;
  tokens.lastIndex = start;
  let depth = 0;
  let elseAt = -1;
  let elseKeyword = '';
  let endAt = -1;
  for (let m = tokens.exec(body); m; m = tokens.exec(body)) {
    const t = m[0].toUpperCase().replace(/\s+/g, ' ');
    if (t === 'IF') depth++;
    else if (t === 'END IF') {
      depth--;
      if (depth === 0) { endAt = m.index; break; }
    } else if (depth === 1 && elseAt === -1) { elseAt = m.index; elseKeyword = t; }
  }
  if (elseAt === -1 || endAt === -1) return null;
  return {
    preamble: body.slice(begin + 'BEGIN'.length, start),
    noUser: body.slice(start, elseAt),
    user: body.slice(elseAt, endAt),
    after: body.slice(endAt),
    elseKeyword,
  };
}

describe('phase103/109c — delete_bank_reconciliation authorises before touching data', () => {
  const body = () => stripComments(def('delete_bank_reconciliation').text);
  const branches = () => {
    const b = authBranches(body());
    if (!b) throw new Error('delete_bank_reconciliation has no top-level IF auth.uid() IS NULL THEN ... ELSE ... END IF');
    return b;
  };

  it('opens with the authorisation split, before any table access', () => {
    const b = branches();
    expect(b.elseKeyword, 'the signed-in branch is a plain ELSE').toBe('ELSE');
    expect(TABLE_ACCESS.test(b.preamble), 'nothing reads a table before the split').toBe(false);
  });

  it('refuses every API caller without a user, before reading anything', () => {
    // First statement of the no-user branch; only a direct database session passes.
    expect(
      /^IF\s+auth\.uid\(\)\s+IS\s+NULL\s+THEN\s+IF\s+session_user\s*=\s*'authenticator'\s+THEN\s+RAISE\s+EXCEPTION[^;]*ERRCODE\s*=\s*'42501'\s*;\s*END\s+IF\s*;/i.test(branches().noUser),
      'IF session_user = authenticator THEN RAISE 42501 is the first statement',
    ).toBe(true);
  });

  it('does not exempt the service_role key', () => {
    expect(/service_role|auth\.role\(\)/i.test(body()), 'no service_role carve-out in this function').toBe(false);
  });

  it('requires accounting.write as the very first statement of the signed-in branch', () => {
    expect(
      /^ELSE\s+PERFORM\s+public\.auth_require\('accounting\.write'\)\s*;/i.test(branches().user),
      'ELSE PERFORM public.auth_require(accounting.write);',
    ).toBe(true);
  });

  it("limits the signed-in branch to a read of the caller's own company", () => {
    const u = branches().user;
    expect(/WHERE\s+id\s*=\s*p_id\s+AND\s+company_id\s*=\s*public\.current_user_company_id\(\)/i.test(u), 'company-scoped lookup').toBe(true);
    expect(/\b(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+public\./i.test(u), 'no write inside the branch').toBe(false);
  });

  it('deletes only the row it found, after the not-found and locked checks', () => {
    const a = branches().after;
    const del = a.search(/DELETE\s+FROM\s+public\.bank_reconciliations\s+WHERE\s+id\s*=\s*p_id\s+AND\s+company_id\s*=\s*v_company\s*;/i);
    expect(del, 'delete bound to the looked-up company').toBeGreaterThan(-1);
    expect(a.search(/IF\s+NOT\s+FOUND\s+THEN/i), 'not-found check precedes the delete').toBeLessThan(del);
    expect(a.search(/v_status\s*=\s*'locked'/i), 'locked check precedes the delete').toBeLessThan(del);
    expect(/DELETE\s+FROM\s+public\.bank_reconciliations\s+WHERE\s+id\s*=\s*p_id\s*;/i.test(body()), 'no unscoped delete anywhere').toBe(false);
  });

  it('is executable by signed-in users only (not PUBLIC, anon or service_role)', () => {
    const d = def('delete_bank_reconciliation');
    const revokeSr = lastOf(statementsFor('delete_bank_reconciliation', /REVOKE[^;]*?ON\s+FUNCTION[^;]*?FROM[^;]*?\bservice_role\b[^;]*;/gi));
    const grantSr = lastOf(statementsFor('delete_bank_reconciliation', /GRANT[^;]*?ON\s+FUNCTION[^;]*?TO[^;]*?\bservice_role\b[^;]*;/gi));
    expect(revokeSr, 'revoked from service_role').not.toBeNull();
    expect(after(revokeSr!, d.pos), 'service_role revoke follows the latest definition').toBe(true);
    expect(grantSr === null || after(revokeSr!, grantSr), 'service_role not re-granted').toBe(true);
    expect(anonRevoked('delete_bank_reconciliation'), 'anon and PUBLIC revoked').toBe(true);
  });

  it('is not among anon-callable SECURITY DEFINER functions that write without a caller check', () => {
    // Static port of the phase103 production tripwire: a SECURITY DEFINER
    // function bypasses RLS, so one that anon can call and that writes without
    // checking the caller is an unauthenticated write to any tenant. Other
    // members are reported (the class is not yet curated); this one must never
    // appear.
    const unguarded = [...latest.entries()]
      .filter(([, d]) => d.definer)
      .filter(([, d]) => /\b(?:DELETE\s+FROM|UPDATE)\s+/i.test(stripComments(d.text)))
      .filter(([, d]) => !/auth_require|auth\.uid\(\)|current_user_company_id/i.test(stripComments(d.text)))
      .map(([name]) => name)
      .filter((name) => !anonRevoked(name));
    if (unguarded.length) console.warn(`anon-callable SECURITY DEFINER writers without a caller check: ${unguarded.join(', ')}`);
    expect(unguarded).not.toContain('delete_bank_reconciliation');
  });
});

describe('Finding E — grants', () => {
  const clientFacing = [...PHASE109_GUARDED, 'delete_bank_reconciliation', ...TRIGGER_ONLY];
  for (const name of clientFacing) {
    it(`${name} is revoked from anon and not re-granted`, () => {
      expect(anonRevoked(name)).toBe(true);
    });
  }

  for (const name of [...PHASE109_GUARDED, 'delete_bank_reconciliation']) {
    it(`${name} stays executable by signed-in users`, () => {
      // CREATE OR REPLACE keeps grants; only an explicit revoke (or a DROP) removes them.
      const revoke = lastOf(statementsFor(name, REVOKE_AUTH));
      const grant = lastOf(statementsFor(name, /GRANT[^;]*?ON\s+FUNCTION[^;]*?TO[^;]*?\bauthenticated\b[^;]*;/gi));
      expect(revoke === null || (grant !== null && after(grant, revoke)), `${name}: not revoked from authenticated`).toBe(true);
    });
  }

  for (const name of SERVICE_ROLE_ONLY) {
    it(`${name} is executable by the service role only`, () => {
      expect(anonRevoked(name), `${name}: revoked from anon`).toBe(true);
      expect(statementsFor(name, REVOKE_AUTH).length, `${name}: revoked from authenticated`).toBeGreaterThan(0);
      expect(statementsFor(name, /GRANT[^;]*?ON\s+FUNCTION[^;]*?TO[^;]*?\bservice_role\b[^;]*;/gi).length, `${name}: granted to service_role`).toBeGreaterThan(0);
    });
  }

  it('reset_company_data keeps its own signed-in-admin-of-this-company check', () => {
    const body = stripComments(def('reset_company_data').text);
    expect(/RAISE\s+EXCEPTION\s+'reset_company_data:\s*not authenticated'/i.test(body)).toBe(true);
    expect(/RAISE\s+EXCEPTION\s+'reset_company_data:\s*caller not in company/i.test(body)).toBe(true);
    expect(/RAISE\s+EXCEPTION\s+'reset_company_data:\s*only admin can reset/i.test(body)).toBe(true);
  });
});

// ── Rollback files cannot run by accident ───────────────────────────────────
// phase109_e2_rollback.sql was run by mistake on 2026-11-02 and silently
// re-opened Finding E on production. A security rollback must refuse to run
// until someone deliberately removes its guard.
describe('Finding E — security rollbacks refuse to run by accident', () => {
  const MANUAL = resolve(process.cwd(), 'supabase/manual-apply');
  const rollbacks = readdirSync(MANUAL).filter((f) => /^phase109.*rollback\.sql$/.test(f));

  it('the phase109 rollbacks exist', () => {
    expect(rollbacks.sort()).toEqual(['phase109_e2_rollback.sql', 'phase109c_rollback.sql']);
  });

  for (const file of rollbacks) {
    it(`${file} raises before it changes anything`, () => {
      const src = stripComments(readFileSync(resolve(MANUAL, file), 'utf8'));
      const guard = src.search(/DO\s+\$\$\s*BEGIN\s+RAISE\s+EXCEPTION\s+'ROLLBACK GUARD:/i);
      const firstChange = src.search(/\b(?:CREATE|GRANT|REVOKE|ALTER|DROP)\b/i);
      expect(guard, `${file}: ROLLBACK GUARD block`).toBeGreaterThan(-1);
      expect(guard, `${file}: guard precedes the first change`).toBeLessThan(firstChange);
    });
  }
});

// ── Compatibility: the web app, Android 1.0.3 and the public API ────────────
// Android 1.0.3 (commit 22a96a8) is installed on phones and cannot be updated
// remotely, so the parameter names it sends are frozen here. A rename or a
// dropped parameter would break it silently.
const ANDROID_103: Record<string, string[]> = {
  delete_bank_reconciliation: ['p_id'],
  get_bank_recon: ['p_account_id', 'p_company_id', 'p_date_from', 'p_date_to'],
  get_daily_cash_report: ['p_company_id', 'p_date'],
  save_bank_reconciliation: ['p_bank_account_id', 'p_company_id', 'p_gl_line_ids', 'p_lock', 'p_notes', 'p_statement_closing_balance', 'p_statement_end_date'],
  search_contacts: ['p_company_id', 'p_limit', 'p_q', 'p_type'],
  search_products: ['p_brand_id', 'p_category_id', 'p_company_id', 'p_include_inactive', 'p_limit', 'p_q'],
};
/** The Edge Function (supabase/functions/api) calls these with p_company_id. */
const PUBLIC_API: Record<string, string[]> = {
  api_current_stock: ['p_company_id'],
  company_has_api_access: ['p_company_id'],
};

/** Parameter names the web adapter passes to `fn`, read from the source. */
function webParams(fn: string): string[] | null {
  const src = readFileSync(resolve(process.cwd(), 'src/data/supabaseAdapter.ts'), 'utf8');
  const at = src.indexOf(`'${fn}'`);
  if (at === -1) return null;
  const open = src.indexOf('{', at);
  if (open === -1 || open - at > 40) return null;
  let depth = 1;
  let i = open + 1;
  while (depth > 0 && i < src.length) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return [...new Set(src.slice(open, i).match(/\bp_[a-z_]+(?=\s*[:,}])/g) ?? [])].sort();
}

describe('Finding E — callers still match the function signatures', () => {
  for (const [fn, params] of Object.entries(ANDROID_103)) {
    it(`${fn} accepts every parameter Android 1.0.3 sends`, () => {
      expect(def(fn).params).toEqual(expect.arrayContaining(params));
    });
  }

  for (const fn of [...PHASE109_GUARDED, 'delete_bank_reconciliation']) {
    it(`${fn} accepts every parameter the web app sends`, () => {
      const sent = webParams(fn);
      if (sent === null) return expect(fn, `${fn} is not called by the web adapter`).toBeTruthy();
      expect(def(fn).params).toEqual(expect.arrayContaining(sent));
    });
  }

  for (const [fn, params] of Object.entries(PUBLIC_API)) {
    it(`${fn} keeps the parameters the public API sends`, () => {
      expect(def(fn).params).toEqual(expect.arrayContaining(params));
    });
  }
});
