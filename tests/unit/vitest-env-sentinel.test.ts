/**
 * INFRA-1 — the Vitest environment never carries a real Supabase target.
 *
 * vitest.config.ts loads no .env files and sets the app's two required values
 * to a dead loopback port and a fake key. If someone removes that, or a new
 * .env file starts loading again, these fail. Static: no network, no database.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import config, { VITEST_SENTINEL_KEY, VITEST_SENTINEL_URL } from '../../vitest.config';
import { env } from '@/lib/env';

const meta = import.meta.env as Record<string, string | undefined>;
const CLOUD = /supabase\.(co|com)|pooler\.supabase/i;

describe('Vitest environment sentinel', () => {
  it('import.meta.env holds the sentinel, not a real project', () => {
    expect(meta.VITE_SUPABASE_URL).toBe(VITEST_SENTINEL_URL);
    expect(meta.VITE_SUPABASE_PUBLISHABLE_KEY).toBe(VITEST_SENTINEL_KEY);
  });

  it('process.env holds the sentinel too', () => {
    expect(process.env.VITE_SUPABASE_URL).toBe(VITEST_SENTINEL_URL);
    expect(process.env.VITE_SUPABASE_PUBLISHABLE_KEY).toBe(VITEST_SENTINEL_KEY);
  });

  it("the app's own env module resolves to the sentinel", () => {
    expect(env.supabase_url).toBe(VITEST_SENTINEL_URL);
    expect(env.supabase_publishable_key).toBe(VITEST_SENTINEL_KEY);
  });

  it('no Supabase cloud URL or secret key reaches the test environment', () => {
    for (const [k, v] of Object.entries({ ...meta, ...process.env })) {
      if (typeof v !== 'string') continue;
      expect(CLOUD.test(v), `${k} points at a Supabase cloud project`).toBe(false);
    }
    expect(process.env.SUPABASE_SECRET_KEY).toBeUndefined();
    expect(meta.SUPABASE_SECRET_KEY).toBeUndefined();
  });

  it('the sentinel URL is a dead loopback port', () => {
    const u = new URL(VITEST_SENTINEL_URL);
    expect(u.hostname).toBe('127.0.0.1');
    expect(u.port).toBe('9');
  });

  it('envDir points at a folder that holds no .env files', () => {
    const dir = config.envDir as string;
    expect(dir).toBe(resolve(__dirname, '../.vitest-no-env'));
    const envFiles = existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith('.env')) : [];
    expect(envFiles).toEqual([]);
  });
});
