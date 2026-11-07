/**
 * Global v1 Phase 2 — legal structure (global05), behaviour against STAGING ONLY.
 *
 *   L1  an Indian owner saves a private limited company with a valid CIN
 *   L2  the database refuses a malformed CIN, and an LLP without LLPIN format
 *   L3  a UAE company's trade-licence number is free text
 *   L4  a legal form outside the list is refused
 *   L5  a user of another company cannot change these fields
 *   L6  existing companies are untouched: a fresh company starts with NULLs
 *
 * Reads .env.staging.local only; refuses any non-local target. Creates and
 * deletes users and companies: not in the pre-commit hook.
 *     npm run test:global05
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/types/database';
import { createSupabaseAdapter } from '../../src/data/supabaseAdapter';
import { runOnboarding } from '../../src/core/onboarding';
import { assertNotProductionTarget, loadStagingEnv } from './_env-guard';
import { destroyTenant } from './_tenant-cleanup';

const env = loadStagingEnv();
assertNotProductionTarget(env.VITE_SUPABASE_URL);
const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient<Database>(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY, noSession);
const PREFIX = 'TAX Scratch global05 ';

interface T { client: SupabaseClient<Database>; companyId: string }
const cleanup: { companyId: string; userIds: string[] }[] = [];
let seq = 0;

async function tenant(name: string, country: 'IN' | 'AE'): Promise<T> {
  const email = `g5-${Date.now()}-${seq++}@stockbolt.test`, password = 'Global05!pass';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const client = createClient<Database>(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, noSession);
  const { error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn: ${sErr.message}`);
  const { company_id } = await runOnboarding({
    company_name: PREFIX + name, company_name_ar: '', address: '', full_name: 'G5 Owner', country_code: country,
    is_tax_registered: false, tax_id: '', currency: country === 'IN' ? 'INR' : 'AED',
    fiscal_year_start: '2026-01-01', warehouse_name: 'Main', warehouse_name_ar: 'رئيسي', warehouse_code: 'MAIN',
    load_sample_data: false,
  }, createSupabaseAdapter(client));
  cleanup.push({ companyId: company_id, userIds: [data.user.id] });
  return { client, companyId: company_id };
}

type Patch = Record<string, string | null>;
const save = (t: T, companyId: string, patch: Patch) =>
  (t.client.from('companies') as any).update(patch).eq('id', companyId).select('id') as PromiseLike<{ data: { id: string }[] | null; error: { message: string } | null }>;
const read = async (companyId: string) =>
  ((await (admin.from('companies') as any).select('legal_form, legal_name, registration_number, registration_authority, incorporation_date')
    .eq('id', companyId).single()).data) as Patch;

let india: T, uae: T;
beforeAll(async () => { india = await tenant('IN', 'IN'); uae = await tenant('AE', 'AE'); }, 180_000);
afterAll(async () => {
  const left: string[] = [];
  for (const c of cleanup) left.push(...await destroyTenant(admin, { ...c, namePrefix: PREFIX }));
  if (left.length) throw new Error(left.join('\n'));
}, 180_000);

describe('global05 legal structure', () => {
  it('L6 a new company starts with every legal field empty', async () => {
    expect(await read(india.companyId)).toEqual({ legal_form: null, legal_name: null, registration_number: null,
      registration_authority: null, incorporation_date: null });
  });

  it('L1 an Indian private limited company saves a valid CIN', async () => {
    const r = await save(india, india.companyId, { legal_form: 'private_limited', legal_name: 'Scratch India Private Limited',
      registration_number: 'U72900KL2019PTC012345', registration_authority: 'Registrar of Companies, Kerala', incorporation_date: '2019-04-01' });
    expect(r.error).toBeNull();
    expect((await read(india.companyId)).registration_number).toBe('U72900KL2019PTC012345');
  });

  it('L2 a malformed CIN, or an LLP number in the wrong format, is refused', async () => {
    const bad = await save(india, india.companyId, { legal_form: 'private_limited', registration_number: '12345' });
    expect(bad.error?.message ?? '').toMatch(/companies_india_registration_format/);
    const llp = await save(india, india.companyId, { legal_form: 'llp', registration_number: 'AAB1234' });
    expect(llp.error?.message ?? '').toMatch(/companies_india_registration_format/);
    const ok = await save(india, india.companyId, { legal_form: 'llp', registration_number: 'AAB-1234' });
    expect(ok.error).toBeNull();
  });

  it('L3 a UAE trade-licence number is free text', async () => {
    const r = await save(uae, uae.companyId, { legal_form: 'free_zone_entity', registration_number: 'DMCC-123456', registration_authority: 'DMCC' });
    expect(r.error).toBeNull();
  });

  it('L4 a legal form outside the list is refused', async () => {
    const r = await save(uae, uae.companyId, { legal_form: 'pirate_ship' });
    expect(r.error?.message ?? '').toMatch(/companies_legal_form_check/);
  });

  it('L5 a user of another company cannot change these fields', async () => {
    const r = await save(uae, india.companyId, { legal_name: 'Hijacked' });
    expect(r.data ?? []).toEqual([]);   // RLS: no row visible to update
    expect((await read(india.companyId)).legal_name).not.toBe('Hijacked');
  });
});
