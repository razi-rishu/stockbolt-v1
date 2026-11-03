/**
 * Global v1 — the company_configurations migration (global01) keeps the
 * security rules that have bitten before: no client-supplied company id, no
 * direct table writes, permission first, anon revoked, fixed search_path,
 * and no change to existing companies. Static: reads the migration file.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(resolve(__dirname, '../../supabase/migrations/20261104000001_global01_company_configuration.sql'), 'utf8');
const code = sql.replace(/--[^\n]*/g, '');
const fn = /CREATE OR REPLACE FUNCTION public\.save_company_configuration\(([\s\S]*?)\)[\s\S]*?AS \$function\$([\s\S]*?)\$function\$/.exec(code)!;

describe('global01 company_configurations', () => {
  it('is one transaction, with a rollback block', () => {
    expect(code.trim()).toMatch(/^BEGIN;[\s\S]*COMMIT;$/);
    expect(sql).toMatch(/-- DROP TABLE IF EXISTS public\.company_configurations;/);
  });

  it('touches no existing row: no backfill, no UPDATE/DELETE of other tables', () => {
    expect(code).not.toMatch(/\bUPDATE\s+public\.(?!company_configurations)/i);
    expect(code).not.toMatch(/\bDELETE\s+FROM/i);
    expect(code).not.toMatch(/INSERT\s+INTO\s+public\.company_configurations[\s\S]*?SELECT[\s\S]*?FROM\s+public\.companies/i);
  });

  it('RLS on; clients may only read their own company', () => {
    expect(code).toMatch(/ALTER TABLE public\.company_configurations ENABLE ROW LEVEL SECURITY;/);
    expect(code).toMatch(/FOR SELECT TO authenticated\s+USING \(company_id = public\.current_user_company_id\(\)\)/);
    expect(code).toMatch(/REVOKE ALL ON public\.company_configurations FROM PUBLIC, anon, authenticated;/);
    expect(code).toMatch(/GRANT SELECT ON public\.company_configurations TO authenticated;/);
    expect(code).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*company_configurations TO authenticated/i);
  });

  it('the save function takes no company id and writes only the caller\'s company', () => {
    expect(fn).not.toBeNull();
    expect(fn[1]).not.toMatch(/company/i);
    expect(fn[2]).toMatch(/v_company := public\.current_user_company_id\(\);/);
    expect(fn[2]).toMatch(/VALUES \(v_company,/);
  });

  it('is SECURITY DEFINER with a fixed search_path, and checks the permission before any write', () => {
    expect(code).toMatch(/SECURITY DEFINER\s+SET search_path TO 'public', 'pg_temp'/);
    const perm = fn[2].indexOf("auth_require('settings.write')");
    expect(perm).toBeGreaterThan(0);
    expect(perm).toBeLessThan(fn[2].indexOf('INSERT INTO'));
    expect(fn[2].indexOf('auth.uid() IS NULL')).toBeLessThan(perm);
  });

  it('EXECUTE for authenticated only (anon and PUBLIC revoked)', () => {
    expect(code).toMatch(/REVOKE ALL ON FUNCTION public\.save_company_configuration\(text, text\[\], text, text\[\]\) FROM PUBLIC, anon, service_role;/);
    expect(code).toMatch(/GRANT EXECUTE ON FUNCTION public\.save_company_configuration\(text, text\[\], text, text\[\]\) TO authenticated;/);
  });

  it('the database enforces the essentials and the activity rules too', () => {
    expect(code).toMatch(/enabled_modules @> ARRAY\['accounting', 'contacts', 'banking'\]/);
    expect(code).toMatch(/cardinality\(activity_keys\) BETWEEN 1 AND 10 AND primary_activity_key = ANY \(activity_keys\)/);
  });
});
