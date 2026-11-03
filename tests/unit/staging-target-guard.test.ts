/**
 * INFRA-1 Step 6 — the local staging allow-list in tests/integration/_env-guard.ts.
 *
 * Static: no network, no database, no real env file. Every case builds its own
 * env object (or a temp directory), so this runs in the pre-commit hook.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LOCAL_STAGING_MARKER,
  PROD_PROJECT_REF,
  StagingTargetError,
  assertLocalStagingEnv,
  assertLocalUrl,
  loadStagingEnv,
} from '../integration/_env-guard';

// Placeholders only — never real keys.
const good = (): Record<string, string> => ({
  STOCKBOLT_TARGET: LOCAL_STAGING_MARKER,
  VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'local-publishable-placeholder',
  SUPABASE_SECRET_KEY: 'local-secret-placeholder-value',
  SUPABASE_DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
});
const refuses = (env: Record<string, string>, prod: Record<string, string> = {}) =>
  expect(() => assertLocalStagingEnv(env, prod)).toThrow(StagingTargetError);

describe('assertLocalUrl', () => {
  it.each(['http://127.0.0.1:54321', 'http://localhost:54321', 'http://[::1]:54321', 'http://127.0.0.1:54321/'])(
    'accepts %s',
    (url) => expect(() => assertLocalUrl(url, '54321', 'VITE_SUPABASE_URL')).not.toThrow(),
  );

  it.each([
    [`https://${PROD_PROJECT_REF}.supabase.co`, 'production'],
    ['https://abcdefghijklmnopqrst.supabase.co', 'another cloud project'],
    ['https://staging.stockbolt.online', 'a hosted domain'],
    ['http://192.168.1.20:54321', 'a LAN address'],
    ['http://127.0.0.1.nip.io:54321', 'a DNS name that resolves to loopback'],
    ['http://127.0.0.1:443', 'the wrong port'],
    ['http://127.0.0.1', 'no port'],
    ['http://user:pw@127.0.0.1:54321', 'embedded credentials'],
    ['ftp://127.0.0.1:54321', 'a non-http scheme'],
    ['not a url', 'garbage'],
    ['', 'empty'],
  ])('refuses %s (%s)', (url) => {
    expect(() => assertLocalUrl(url, '54321', 'VITE_SUPABASE_URL')).toThrow(StagingTargetError);
  });

  it('refuses a cloud pooler as the DB URL', () => {
    expect(() =>
      assertLocalUrl('postgresql://postgres.x:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres', '54322', 'SUPABASE_DB_URL'),
    ).toThrow(StagingTargetError);
  });
});

describe('assertLocalStagingEnv', () => {
  it('accepts the local stack', () => expect(() => assertLocalStagingEnv(good())).not.toThrow());

  it('requires the STOCKBOLT_TARGET marker', () => {
    const env = good();
    delete env.STOCKBOLT_TARGET;
    refuses(env);
    refuses({ ...good(), STOCKBOLT_TARGET: 'production' });
  });

  it('refuses the production project URL', () => refuses({ ...good(), VITE_SUPABASE_URL: `https://${PROD_PROJECT_REF}.supabase.co` }));
  it('refuses a non-local DB URL', () => refuses({ ...good(), SUPABASE_DB_URL: 'postgresql://postgres:pw@db.example.com:5432/postgres' }));
  it('refuses the local API port on the DB URL', () => refuses({ ...good(), SUPABASE_DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54321/postgres' }));
  it('refuses missing keys', () => {
    refuses({ ...good(), SUPABASE_SECRET_KEY: '' });
    refuses({ ...good(), VITE_SUPABASE_PUBLISHABLE_KEY: '' });
  });
  it('refuses any value naming a cloud project', () => refuses({ ...good(), EXTRA_URL: 'https://foo.supabase.co' }));

  it('refuses a key copied from .env.local, without echoing it', () => {
    const prod = { SUPABASE_SECRET_KEY: 'prod-secret-placeholder-1234567890' };
    const env = { ...good(), SUPABASE_SECRET_KEY: prod.SUPABASE_SECRET_KEY };
    let message = '';
    try {
      assertLocalStagingEnv(env, prod);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/SUPABASE_SECRET_KEY has the same value/);
    expect(message).not.toContain(prod.SUPABASE_SECRET_KEY);
  });
});

describe('loadStagingEnv', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });
  const write = (name: string, env: Record<string, string>) =>
    writeFileSync(join(dir, name), Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n'));

  it('loads a valid file without touching process.env', () => {
    dir = mkdtempSync(join(tmpdir(), 'sb-staging-'));
    write('.env.staging.local', good());
    const before = process.env.SUPABASE_SECRET_KEY;
    expect(loadStagingEnv(dir).VITE_SUPABASE_URL).toBe('http://127.0.0.1:54321');
    expect(process.env.SUPABASE_SECRET_KEY).toBe(before);
  });

  it('refuses when the file is missing', () => {
    dir = mkdtempSync(join(tmpdir(), 'sb-staging-'));
    expect(() => loadStagingEnv(dir)).toThrow(StagingTargetError);
  });

  it('refuses a staging file that reuses a production value from .env.local', () => {
    dir = mkdtempSync(join(tmpdir(), 'sb-staging-'));
    const shared = 'shared-value-placeholder-abcdefghij';
    write('.env.local', { VITE_SUPABASE_PUBLISHABLE_KEY: shared });
    write('.env.staging.local', { ...good(), VITE_SUPABASE_PUBLISHABLE_KEY: shared });
    expect(() => loadStagingEnv(dir)).toThrow(/same value as an entry in .env.local/);
  });

  it('refuses a copy of the production env file', () => {
    dir = mkdtempSync(join(tmpdir(), 'sb-staging-'));
    write('.env.staging.local', { VITE_SUPABASE_URL: `https://${PROD_PROJECT_REF}.supabase.co`, SUPABASE_SECRET_KEY: 'x'.repeat(20) });
    expect(() => loadStagingEnv(dir)).toThrow(StagingTargetError);
  });
});
