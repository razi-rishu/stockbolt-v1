/**
 * phase110 — every audit action a function writes must be accepted by
 * audit_logs_action_check. Functions wrap their audit insert in
 * EXCEPTION WHEN OTHERS THEN NULL, so a rejected action never shows up as an
 * error: the audit entry just disappears. This makes it a test failure instead.
 *
 * Static: reads supabase/migrations only. For each function it checks the LAST
 * definition in migration order, which is the one that runs.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR = resolve(__dirname, '../../supabase/migrations');
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const strip = (s: string) => s.replace(/--[^\n]*/g, '');

/** The action list of the last migration that (re)defines audit_logs_action_check. */
function allowedActions(): { file: string; actions: Set<string> } {
  let found: { file: string; actions: Set<string> } | null = null;
  for (const f of files) {
    const sql = strip(readFileSync(join(DIR, f), 'utf8'));
    const add = /ADD\s+CONSTRAINT\s+audit_logs_action_check\s+CHECK\s*\(\s*action\s*=\s*ANY\s*\(\s*ARRAY\s*\[([\s\S]*?)\]/i.exec(sql);
    const inline = /audit_logs\s*\([\s\S]*?\baction\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*action\s+IN\s*\(([^)]*)\)/i.exec(sql);
    const list = add?.[1] ?? inline?.[1];
    if (list) found = { file: f, actions: new Set([...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])) };
  }
  if (!found) throw new Error('audit_logs_action_check not found in any migration');
  return found;
}

/** name -> { file, body } for the last definition of every function. */
function latestFunctions(): Map<string, { file: string; body: string }> {
  const out = new Map<string, { file: string; body: string }>();
  for (const f of files) {
    const sql = strip(readFileSync(join(DIR, f), 'utf8'));
    const head = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([a-z_0-9]+)"?\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = head.exec(sql))) {
      const as = /AS\s+\$([A-Za-z_]*)\$/gi;
      as.lastIndex = m.index;
      const a = as.exec(sql);
      if (!a) continue;
      const end = sql.indexOf(`$${a[1]}$`, a.index + a[0].length);
      out.set(m[1], { file: f, body: sql.slice(a.index + a[0].length, end) });
    }
  }
  return out;
}

/** Every (function, action expression) audit insert in the latest definitions. */
function auditInserts(): { fn: string; file: string; action: string }[] {
  const rows: { fn: string; file: string; action: string }[] = [];
  for (const [fn, { file, body }] of latestFunctions()) {
    for (const m of body.matchAll(/INSERT\s+INTO\s+(?:public\.)?audit_logs\s*\(([^)]*)\)\s*VALUES\s*\(([\s\S]*?)\)\s*;/gi)) {
      const cols = m[1].split(',').map((c) => c.trim());
      const vals = m[2].split(/,(?![^(]*\))/).map((v) => v.trim());
      rows.push({ fn, file, action: vals[cols.indexOf('action')] ?? '<no action column>' });
    }
  }
  return rows;
}

describe('audit_logs action CHECK covers every action the functions write', () => {
  const { file, actions } = allowedActions();
  const inserts = auditInserts();

  it('the current CHECK is phase110 and keeps the 9 phase0 actions', () => {
    expect(file).toBe('20261103000001_phase110_audit_action_check.sql');
    for (const a of ['create', 'update', 'delete', 'post_gl', 'reverse_gl', 'login', 'void', 'confirm', 'setup_completed']) {
      expect(actions, a).toContain(a);
    }
  });

  it('found the audit-writing functions', () => {
    expect(new Set(inserts.map((i) => i.fn)).size).toBeGreaterThan(80);
  });

  it('every action is a literal, so it can be checked', () => {
    const dynamic = inserts.filter((i) => !/^'[a-z_]+'$/.test(i.action));
    expect(dynamic, 'audit inserts with a non-literal action').toEqual([]);
  });

  it('every action written is accepted by the CHECK', () => {
    const rejected = inserts
      .filter((i) => /^'[a-z_]+'$/.test(i.action) && !actions.has(i.action.slice(1, -1)))
      .map((i) => `${i.fn} (${i.file}): ${i.action}`);
    expect(rejected, 'these audit entries would be silently dropped').toEqual([]);
  });

  it('the CHECK lists nothing the code does not use, apart from the phase0 originals', () => {
    const used = new Set(inserts.map((i) => i.action.slice(1, -1)));
    const unused = [...actions].filter((a) => !used.has(a) && !['login', 'setup_completed'].includes(a));
    expect(unused).toEqual([]);
  });
});
