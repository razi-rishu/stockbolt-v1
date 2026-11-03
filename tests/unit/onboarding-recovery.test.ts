/**
 * phase111 — complete_onboarding never inserts a NULL name, refuses a session
 * whose Auth user is gone, resumes instead of creating a second company, and
 * only corrects the country before the company is set up. Static: reads the
 * repo. The behaviour itself was tested on local staging (7 scenarios).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const sql = readFileSync(resolve(ROOT, 'supabase/migrations/20261103000002_phase111_onboarding_recovery.sql'), 'utf8')
  .replace(/--[^\n]*/g, '');
const body = /AS \$function\$([\s\S]*?)\$function\$/.exec(sql)![1];
const onboarding = readFileSync(resolve(ROOT, 'src/core/onboarding.ts'), 'utf8');

describe('phase111 complete_onboarding', () => {
  it('refuses a session whose Auth user no longer exists, before writing anything', () => {
    const guard = body.indexOf("'complete_onboarding: account_not_found");
    expect(guard).toBeGreaterThan(0);
    expect(body).toMatch(/IF NOT FOUND THEN\s+RAISE EXCEPTION 'complete_onboarding: account_not_found[\s\S]*?USING ERRCODE = '28000'/);
    expect(guard).toBeLessThan(body.indexOf('INSERT INTO'));
  });

  it('never inserts a NULL name: resolves it, or raises full_name_required', () => {
    expect(body).toMatch(/v_name := COALESCE\(/);
    expect(body).toMatch(/v_meta ->> 'full_name'/);
    expect(body).toMatch(/IF v_name IS NULL THEN\s+RAISE EXCEPTION 'complete_onboarding: full_name_required/);
    expect(body).toMatch(/INSERT INTO public\.profiles \(id, company_id, full_name, email, role\)\s+VALUES \(v_user_id, v_company_id, v_name,/);
  });

  it('a second call resumes the same company instead of creating another', () => {
    const resume = body.indexOf("'resumed', true");
    expect(resume).toBeGreaterThan(0);
    expect(resume).toBeLessThan(body.indexOf('INSERT INTO public.companies'));
    expect(body).toMatch(/v_role IS DISTINCT FROM 'admin' THEN\s+RAISE EXCEPTION 'complete_onboarding: user already onboarded'/);
  });

  it('changes the country only while the company has no COA, JEs, invoices or stock', () => {
    for (const t of ['chart_of_accounts', 'journal_entries', 'invoices', 'stock_ledger']) {
      expect(body).toMatch(new RegExp(`EXISTS \\(SELECT 1 FROM public\\.${t}\\s+WHERE company_id = v_company_id\\)`));
    }
    expect(body).toMatch(/IF NOT v_set_up AND[\s\S]*?UPDATE public\.companies SET/);
  });

  it('keeps definer hygiene: fixed search_path, anon revoked', () => {
    expect(sql).toMatch(/SECURITY DEFINER\s+SET search_path TO 'public', 'pg_temp'/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.complete_onboarding\(jsonb\) FROM PUBLIC, anon;/);
  });

  it('the app resumes setup instead of seeding twice', () => {
    expect(onboarding).toMatch(/const \{ company_id, resumed \} = await adapter\.onboarding\.createCompanyAndProfile/);
    expect(onboarding).toMatch(/state\.coa\.length > 0/);
    expect(onboarding).toMatch(/if \(state\.warehouses === 0\)/);
  });
});
