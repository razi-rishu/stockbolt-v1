/**
 * Vercel functions (api/) run as native Node ESM because package.json has
 * "type": "module". Node ESM does not guess file extensions, so a relative
 * import without ".js" crashes the function before its handler runs
 * (FUNCTION_INVOCATION_FAILED, HTTP 500). That is how every Razorpay and
 * PayPal endpoint failed on prod until 2026-11-22.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsFiles(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

describe('api/ relative imports carry a .js extension', () => {
  for (const file of tsFiles('api')) {
    it(file, () => {
      const src = readFileSync(file, 'utf8');
      const bad = [...src.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)]
        .map((m) => m[1])
        .filter((spec) => !spec.endsWith('.js'));
      expect(bad).toEqual([]);
    });
  }
});
