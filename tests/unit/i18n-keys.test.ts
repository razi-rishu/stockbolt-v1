import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import en from '../../src/i18n/en.json';
import ar from '../../src/i18n/ar.json';

/**
 * R1 — every translation key a component asks for must exist, in both locales.
 *
 * This shipped broken: the New Return screen rendered "— common.select —",
 * "common.notes" and "common.description" to the operator, because the editors
 * called keys nobody had defined. i18next falls back to printing the key, so
 * the failure is invisible in code review and obvious to the customer.
 *
 * A static check is the right tool — no database, no rendering, and it catches
 * the mistake at commit time rather than in production.
 */

const SRC = join(__dirname, '..', '..', 'src');

/**
 * Matches t('a.b') but not insert('x') / select('x') / .at('x') — those all end
 * in "t" and a naive /t\('...'/ reads them as translation calls. A sweep using
 * that looser pattern reported ~100 phantom keys ("sku", "id", "created_at").
 * Requires at least one dot, since every real key is namespaced.
 */
const KEY_CALL = /(?<![A-Za-z0-9_$])t\(\s*'([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)'/g;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

function lookup(bundle: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object'
      ? (node as Record<string, unknown>)[part]
      : undefined),
    bundle,
  );
}

interface Usage { key: string; file: string }

function collectUsages(): Usage[] {
  const out: Usage[] = [];
  for (const file of walk(SRC).filter(f => /\.tsx?$/.test(f))) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(KEY_CALL)) {
      out.push({ key: m[1]!, file: relative(SRC, file) });
    }
  }
  return out;
}

describe('i18n key coverage', () => {
  const usages = collectUsages();

  it('finds translation calls to check (guards against the regex silently breaking)', () => {
    // If a refactor changed how t() is called, this test could pass by
    // checking nothing at all. Assert it still sees a realistic number.
    expect(usages.length).toBeGreaterThan(500);
  });

  it('every key used in src/ exists in en.json', () => {
    const missing = new Map<string, Set<string>>();
    for (const { key, file } of usages) {
      if (lookup(en, key) === undefined) {
        if (!missing.has(key)) missing.set(key, new Set());
        missing.get(key)!.add(file);
      }
    }
    const report = [...missing].map(([k, f]) => `${k}  ← ${[...f].join(', ')}`);
    expect(report, `keys with no English string (they render raw to the user):\n${report.join('\n')}`)
      .toHaveLength(0);
  });

  it('every key used in src/ exists in ar.json', () => {
    // The app ships an Arabic toggle, so a key missing here is just as visible
    // to an Arabic-speaking operator as a missing English one is.
    const missing = new Map<string, Set<string>>();
    for (const { key, file } of usages) {
      if (lookup(ar, key) === undefined) {
        if (!missing.has(key)) missing.set(key, new Set());
        missing.get(key)!.add(file);
      }
    }
    const report = [...missing].map(([k, f]) => `${k}  ← ${[...f].join(', ')}`);
    expect(report, `keys with no Arabic string:\n${report.join('\n')}`).toHaveLength(0);
  });

  it('en and ar expose the same key set', () => {
    // Drift either way is a problem: an en-only key renders raw in Arabic, and
    // an ar-only key is dead weight that hides a rename.
    const flatten = (o: unknown, prefix = ''): string[] =>
      o && typeof o === 'object'
        ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
            v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`])
        : [];
    const enKeys = new Set(flatten(en));
    const arKeys = new Set(flatten(ar));
    const enOnly = [...enKeys].filter(k => !arKeys.has(k));
    const arOnly = [...arKeys].filter(k => !enKeys.has(k));
    expect(enOnly, `in en.json but not ar.json:\n${enOnly.join('\n')}`).toHaveLength(0);
    expect(arOnly, `in ar.json but not en.json:\n${arOnly.join('\n')}`).toHaveLength(0);
  });
});
