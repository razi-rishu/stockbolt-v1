/**
 * phase124 — custom roles must be able to store their permissions.
 *
 * phase22 created role_permissions.role with an inline CHECK that only allowed
 * the 5 system role keys. phase23 added custom roles (key = a uuid) and dropped
 * the same fixed-role CHECK on profiles and company_invites, but not the one on
 * role_permissions — so create_role / update_role always failed. phase124
 * drops it.
 *
 * Static: reads supabase/migrations only. Fails if, in migration order, the
 * last word on role_permissions_role_check (the phase22 inline CHECK or a later
 * ADD CONSTRAINT) is not followed by a DROP.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR = resolve(__dirname, '../../supabase/migrations');
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const strip = (s: string) => s.replace(/--[^\n]*/g, '');

/** Every event that sets or removes a fixed-role CHECK on <table>.role, in migration order. */
function checkEvents(table: string): { file: string; kind: 'add' | 'drop' }[] {
  const events: { file: string; kind: 'add' | 'drop'; at: number }[] = [];
  for (const f of files) {
    const sql = strip(readFileSync(join(DIR, f), 'utf8'));
    const found: { kind: 'add' | 'drop'; at: number }[] = [];
    // Inline: CREATE TABLE ... public.<table> ( ... role TEXT NOT NULL CHECK (role IN (...))
    const create = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?${table}\\s*\\(([\\s\\S]*?)\\);`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = create.exec(sql))) {
      if (/\brole\s+TEXT[^,]*CHECK\s*\(\s*role\s+IN/i.test(m[1])) found.push({ kind: 'add', at: m.index });
    }
    const add = new RegExp(`ADD\\s+CONSTRAINT\\s+${table}_role_check\\b`, 'gi');
    while ((m = add.exec(sql))) found.push({ kind: 'add', at: m.index });
    const drop = new RegExp(`DROP\\s+CONSTRAINT\\s+(?:IF\\s+EXISTS\\s+)?${table}_role_check\\b`, 'gi');
    while ((m = drop.exec(sql))) found.push({ kind: 'drop', at: m.index });
    found.sort((a, b) => a.at - b.at).forEach((e) => events.push({ file: f, ...e }));
  }
  return events.map(({ file, kind }) => ({ file, kind }));
}

describe('custom roles — no fixed-role CHECK left on role-keyed tables', () => {
  for (const table of ['role_permissions', 'profiles', 'company_invites']) {
    it(`${table}.role accepts custom (uuid) role keys`, () => {
      const events = checkEvents(table);
      expect(events.length, `no CHECK history found for ${table}`).toBeGreaterThan(0);
      expect(events[events.length - 1], `last change to ${table}_role_check must be a DROP`).toMatchObject({ kind: 'drop' });
    });
  }
});
