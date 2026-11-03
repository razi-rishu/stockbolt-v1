import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * INFRA-1 — Vitest must never see the production project.
 *
 * Vite loads `.env.local` (production) into import.meta.env AND process.env of
 * every test worker, so app code under test (getSupabaseClient(), or
 * createSupabaseAdapter() with no client) would talk to production. envDir
 * points at a folder with no .env files, and the app's two required values are
 * a dead loopback port and a key that is not a key. Suites that need a real
 * target load it themselves: loadStagingEnv() for staging, dotenv.parse() for
 * the on-demand production reader. tests/unit/vitest-env-sentinel.test.ts
 * fails if this ever changes. vite.config.ts (web + Android builds) is untouched.
 */
export const VITEST_SENTINEL_URL = 'http://127.0.0.1:9';
export const VITEST_SENTINEL_KEY = 'vitest-sentinel-not-a-key';

export default defineConfig({
  envDir: path.resolve(__dirname, 'tests/.vitest-no-env'),
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    globals: false,
    env: {
      VITE_SUPABASE_URL: VITEST_SENTINEL_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: VITEST_SENTINEL_KEY,
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@core': path.resolve(__dirname, './src/core'),
      '@data': path.resolve(__dirname, './src/data'),
      '@modules': path.resolve(__dirname, './src/modules'),
      '@components': path.resolve(__dirname, './src/components'),
      '@ui': path.resolve(__dirname, './src/ui'),
      '@lib': path.resolve(__dirname, './src/lib'),
      '@i18n': path.resolve(__dirname, './src/i18n'),
      '@store': path.resolve(__dirname, './src/store'),
      '@types': path.resolve(__dirname, './src/types'),
    },
  },
});
