/**
 * INFRA-1 — the staging reference-data seed matches the migrations, touches
 * only global reference rows, can only reach the local container, and never
 * runs by itself.
 *
 * Static: reads repo files. The one process it starts is the wrapper with an
 * argument, which must refuse before it touches Docker.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const MIG = (f: string) => read(`supabase/migrations/${f}`);
const SEED_PATH = 'supabase/seeds/staging_reference_data.sql';
const seed = read(SEED_PATH);
const wrapper = read('scripts/staging-seed.mjs');
const code = seed.replace(/--.*$/gm, '');
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

// ── What the migrations define ──────────────────────────────────────────────
const p22 = MIG('20260619000013_phase22_user_roles_foundation.sql');
const perms = [.../INSERT INTO public\.role_permissions \(role, permission\) VALUES([\s\S]*?);/.exec(p22)![1]
  .matchAll(/\('([a-z_]+)','([a-z_.]+)'\)/g)].map((m) => [m[1], m[2]]);
const p23 = MIG('20260619000016_phase23_custom_roles.sql');
const roles = [.../INSERT INTO public\.roles \(company_id, key, name, is_system\) VALUES([\s\S]*?)ON CONFLICT/.exec(p23)![1]
  .matchAll(/\(NULL, '([a-z_]+)',\s*'([^']+)',\s*TRUE\)/g)].map((m) => [m[1], m[2]]);
const p32 = MIG('20260625000003_phase32_automotive_catalog_c1.sql');
const makes = [.../INSERT INTO public\.vehicle_makes \(company_id, name, country\)[\s\S]*?FROM \(VALUES([\s\S]*?)\) AS s/.exec(p32)![1]
  .matchAll(/\('([^']+)','([^']+)'\)/g)].map((m) => [m[1], m[2]]);
const p31 = MIG('20260625000002_phase31_saas_foundation.sql');
const p35 = MIG('20260705000001_phase35_saas_m3_paypal.sql');
const p49 = MIG('20260714000001_phase49_api_keys_foundation.sql');

describe('the seed reproduces the migration values exactly', () => {
  it('the migrations still define 5 roles, 37 permissions and 34 makes', () => {
    expect([roles.length, perms.length, makes.length]).toEqual([5, 37, 34]);
  });

  it('inserts and asserts every system role with its name', () => {
    for (const [k, n] of roles) {
      expect(code).toContain(`(NULL, '${k}', '${n.replace(/'/g, "''")}', TRUE)`);
      expect(code).toContain(`('${k}', '${n.replace(/'/g, "''")}')`);
    }
  });

  it('inserts and asserts every phase22 permission, and nothing else', () => {
    for (const [r, p] of perms) {
      expect(code).toContain(`(NULL, '${r}', '${p}')`);
      expect(code).toContain(`('${r}', '${p}')`);
    }
    const inserted = [...code.matchAll(/\(NULL, '([a-z_]+)', '([a-z_.]+)'\)/g)].length;
    expect(inserted).toBe(perms.length);
  });

  it('inserts and asserts all 34 shared vehicle makes with their country', () => {
    for (const [n, c] of makes) {
      expect(code).toContain(`  ('${n}', '${c}')`);
      expect(code).toContain(`('${n}', '${c}')`);
    }
  });

  it('the professional plan carries phase31 + phase35 + phase49 values', () => {
    // phase31 defines the row; phase35 sets the prices and trial; phase49 adds api_access.
    expect(norm(p31)).toContain("VALUES ('professional', 'StockBolt Professional', 'Unlimited modules', 10.00, 100.00, 30, '{\"modules\":\"unlimited\"}'::jsonb, 1)");
    expect(norm(p35)).toMatch(/SET monthly_price = 21\.00, half_yearly_price = 105\.00, yearly_price = 200\.00, trial_days = 365,/);
    expect(norm(p49)).toContain(`SET features = features || '{"api_access": true}'::jsonb WHERE code = 'professional'`);
    expect(norm(code)).toContain("VALUES ('professional', 'StockBolt Professional', 'Unlimited modules', 21.00, 105.00, 200.00, 365, '{\"modules\":\"unlimited\",\"api_access\":true}'::jsonb, 1)");
    expect(norm(code)).toMatch(/monthly_price = 21\.00 AND half_yearly_price = 105\.00 AND yearly_price = 200\.00 AND trial_days = 365/);
  });

  it('tax profiles and the PayPal config match phase31', () => {
    expect(norm(p31)).toContain("('AE', 'VAT', 5.000, '{}'::jsonb), ('IN', 'GST', 18.000, '{\"intra\":[\"CGST\",\"SGST\"],\"inter\":[\"IGST\"]}'::jsonb)");
    expect(norm(code)).toContain("('AE', 'VAT', 5.000, '{}'::jsonb), ('IN', 'GST', 18.000, '{\"intra\":[\"CGST\",\"SGST\"],\"inter\":[\"IGST\"]}'::jsonb)");
    expect(norm(p31)).toContain("VALUES ('paypal', false, 'sandbox', '{}'::jsonb)");
    expect(norm(code)).toContain("VALUES ('paypal', false, 'sandbox', '{}'::jsonb)");
  });
});

describe('the seed is safe by construction', () => {
  it('is a single transaction that refuses any non-socket session first', () => {
    const stmts = code.trim();
    expect(stmts).toMatch(/^\\set ON_ERROR_STOP on\s+BEGIN;/);
    expect(stmts).toMatch(/COMMIT;$/);
    const guard = /DO \$\$\s+BEGIN\s+IF inet_server_addr\(\) IS NOT NULL THEN\s+RAISE EXCEPTION 'staging seed refused[^']*';\s+END IF;\s+END \$\$;/;
    const g = guard.exec(code);
    expect(g, 'the TCP-session guard block').not.toBeNull();
    expect(g!.index).toBeLessThan(code.indexOf('INSERT INTO'));
    expect(code.match(/\bBEGIN;/g)).toHaveLength(1);
    expect(code.match(/\bCOMMIT;/g)).toHaveLength(1);
  });

  it('only inserts, only into the six reference tables, never updates or deletes', () => {
    const targets = [...code.matchAll(/INSERT INTO public\.([a-z_]+)/g)].map((m) => m[1]);
    expect(new Set(targets)).toEqual(new Set(['roles', 'role_permissions', 'subscription_plans', 'tax_profiles', 'payment_provider_configs', 'vehicle_makes']));
    expect(code).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COPY)\b\s/i);
    for (const block of code.split(/INSERT INTO/).slice(1)) expect(block).toMatch(/ON CONFLICT|WHERE NOT EXISTS/);
  });

  it('every row is global: no company id, no uuid except the COALESCE sentinel', () => {
    const uuids = [...code.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)].map((m) => m[0]);
    expect(new Set(uuids)).toEqual(new Set(['00000000-0000-0000-0000-000000000000']));
    for (const m of code.matchAll(/INSERT INTO public\.(roles|role_permissions|vehicle_makes) \(company_id/g)) expect(m).toBeTruthy();
    expect(code).not.toMatch(/company_id\s*=\s*'/);
  });

  it('carries no secret, credential, email or URL', () => {
    expect(seed).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}|sb_(secret|publishable)_|https?:\/\/|@[a-z0-9-]+\.[a-z]{2,}|password|client_secret/i);
  });
});

describe('the wrapper can only reach the local container', () => {
  it('names one container and one project label, and reads no environment', () => {
    expect(wrapper).toContain("const CONTAINER = 'supabase_db_stockbolt_local';");
    expect(wrapper).toContain("const PROJECT_LABEL = 'stockbolt_local';");
    expect(wrapper).not.toMatch(/process\.env/);
    expect(wrapper).not.toMatch(/shell\s*:\s*true|execSync|\bexec\(/);
    expect(wrapper).not.toMatch(/supabase\.co|postgres(ql)?:\/\/|['"]-h['"]|--host|PGHOST|DATABASE_URL/);
  });

  it('runs psql only through docker exec into that container', () => {
    const spawns = [...wrapper.matchAll(/spawnSync\('([^']+)', \[([^\]]*)\]/g)].map((m) => [m[1], m[2]]);
    expect(spawns.map((s) => s[0])).toEqual(['docker', 'docker']);
    expect(spawns[0][1]).toMatch(/^'inspect', '--type', 'container', CONTAINER/);
    expect(spawns[1][1]).toMatch(/^'exec', '-i', CONTAINER, 'psql'/);
  });

  it('refuses any argument before touching Docker', () => {
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts/staging-seed.mjs'), 'postgresql://evil.example:5432/postgres'], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/REFUSED: this command takes no arguments/);
  });
});

describe('nothing runs the seed automatically', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  // The wrapper, the SQL file or the npm script — not this test file's name.
  const RUNS_SEED = /scripts\/staging-seed\.mjs|staging_reference_data|staging:seed/;
  it('only the staging:seed script refers to it', () => {
    for (const [name, cmd] of Object.entries(pkg.scripts)) {
      if (name === 'staging:seed') { expect(cmd).toBe('node scripts/staging-seed.mjs'); continue; }
      expect(cmd, name).not.toMatch(RUNS_SEED);
    }
  });
  it.each(['.husky/pre-commit', '.github/workflows/ci.yml', 'vercel.json'])('%s never mentions it', (f) => {
    expect(read(f)).not.toMatch(RUNS_SEED);
  });
  it('supabase db reset seeds only ./seed.sql, never the staging file or a glob', () => {
    const active = read('supabase/config.toml').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(active).toMatch(/^sql_paths = \["\.\/seed\.sql"\]$/m);
    expect(active).not.toMatch(/staging_reference_data|seeds\/\*/);
  });
});
