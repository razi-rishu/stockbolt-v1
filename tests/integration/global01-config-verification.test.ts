/**
 * Global v1 — global01 company configuration, behaviour on LOCAL staging.
 * Loads its target through loadStagingEnv() (local stack only) and removes its
 * synthetic tenants with destroyTenant(). Requires the global01 migration
 * applied to staging.  npm run test:global01
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadStagingEnv } from './_env-guard';
import { destroyTenant } from './_tenant-cleanup';
import { createSupabaseAdapter } from '@/data/supabaseAdapter';
import { runOnboarding } from '@/core/onboarding';
import { buildConfiguration, effectiveConfiguration, toStoredConfiguration, MODULE_KEYS, TAXONOMY_VERSION } from '@/core/global-config';

const env = loadStagingEnv();
const opts = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY, opts);
const PREFIX = 'TAX Scratch global01 ';
type T = { client: SupabaseClient; userId: string; companyId: string; email: string };
const cleanup: { companyId: string; userIds: string[] }[] = [];
const extraUsers: string[] = [];
let seq = 0;

async function signIn() {
  const email = `g01-${Date.now()}-${seq++}@stockbolt.test`, password = 'Global01!pass';
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, opts);
  await client.auth.signInWithPassword({ email, password });
  return { client, userId: data.user!.id, email };
}
async function tenant(country: 'IN' | 'AE', name: string): Promise<T> {
  const u = await signIn();
  const { company_id } = await runOnboarding({ company_name: PREFIX + name, company_name_ar: '', address: '', full_name: 'G Owner',
    country_code: country, is_tax_registered: false, tax_id: '', currency: country === 'IN' ? 'INR' : 'AED',
    fiscal_year_start: country === 'IN' ? '2026-04-01' : '2026-01-01', warehouse_name: 'Main', warehouse_name_ar: 'رئيسي',
    warehouse_code: 'MAIN', load_sample_data: false }, createSupabaseAdapter(u.client as never));
  cleanup.push({ companyId: company_id, userIds: [u.userId] });
  return { ...u, companyId: company_id };
}

let A: T, B: T;
beforeAll(async () => { A = await tenant('IN', 'A'); B = await tenant('AE', 'B'); }, 120_000);
afterAll(async () => {
  for (const id of extraUsers) { await admin.from('profiles').delete().eq('id', id); await admin.auth.admin.deleteUser(id); }
  const left: string[] = [];
  for (const c of cleanup) left.push(...await destroyTenant(admin, { ...c, namePrefix: PREFIX }));
  if (left.length) throw new Error(left.join('\n'));
}, 120_000);

describe('global01 company configuration on local staging', () => {
  it('a company with no row reads as legacy: everything it has today stays on', async () => {
    const row = await createSupabaseAdapter(B.client as never).companyConfiguration.get(B.companyId);
    expect(row).toBeNull();
    const c = effectiveConfiguration(row, { country_code: 'AE', projects_enabled: true });
    expect(c.modules).toEqual([...MODULE_KEYS]);
  });

  it('admin saves an India configuration and reads back the same thing', async () => {
    const ad = createSupabaseAdapter(A.client as never);
    const built = buildConfiguration({ country_code: 'IN', activities: { activity_keys: ['event_management', 'catering'], primary_activity_key: 'event_management' }, modules: { enable: ['payroll'], disable: ['expenses'] } });
    await ad.companyConfiguration.save(toStoredConfiguration(built));
    const row = await ad.companyConfiguration.get(A.companyId);
        expect(row).toMatchObject({ company_id: A.companyId, taxonomy_version: TAXONOMY_VERSION, activity_keys: ['event_management', 'catering'], primary_activity_key: 'event_management', configured_by: A.userId });
    expect([...row!.enabled_modules].sort()).toEqual([...built.modules].sort());
    const back = effectiveConfiguration(row, { country_code: 'IN' });
    expect([...back.modules].sort()).toEqual([...built.modules].sort());
    expect(back.modules).toContain('tds');
    expect(back.modules).not.toContain('expenses');
  });

  it('saving again updates the same row', async () => {
    const ad = createSupabaseAdapter(A.client as never);
    const before = await ad.companyConfiguration.get(A.companyId);
    await ad.companyConfiguration.save(toStoredConfiguration(buildConfiguration({ country_code: 'IN', activities: { activity_keys: ['consulting'] } })));
    const after = await ad.companyConfiguration.get(A.companyId);
    const { count } = await admin.from('company_configurations' as never).select('company_id', { count: 'exact', head: true }).eq('company_id', A.companyId);
    expect(count).toBe(1);
    expect(after?.activity_keys).toEqual(['consulting']);
    expect(after!.updated_at >= before!.updated_at).toBe(true);
  });

  it('another company can neither read nor overwrite it', async () => {
    const adB = createSupabaseAdapter(B.client as never);
    expect(await adB.companyConfiguration.get(A.companyId)).toBeNull();
    await adB.companyConfiguration.save(toStoredConfiguration(buildConfiguration({ country_code: 'AE', activities: { activity_keys: ['retail_store'] } })));
    const a = (await admin.from('company_configurations' as never).select('activity_keys').eq('company_id', A.companyId).single()).data as unknown as { activity_keys: string[] };
    expect(a.activity_keys).toEqual(['consulting']);            // B's save went to B's own company
    const b = (await admin.from('company_configurations' as never).select('activity_keys').eq('company_id', B.companyId).single()).data as unknown as { activity_keys: string[] };
    expect(b.activity_keys).toEqual(['retail_store']);
  });

  it('a Viewer (no settings.write) is refused; they can still read', async () => {
    const v = await signIn(); extraUsers.push(v.userId);
    await admin.from('profiles').insert({ id: v.userId, company_id: A.companyId, full_name: 'Viewer', email: v.email, role: 'viewer', is_active: true } as never);
    const ad = createSupabaseAdapter(v.client as never);
    await expect(ad.companyConfiguration.save({ taxonomy_version: TAXONOMY_VERSION, activity_keys: ['pharmacy'], primary_activity_key: 'pharmacy', enabled_modules: ['accounting', 'contacts', 'banking'] }))
      .rejects.toThrow(/settings\.write|forbidden/i);
    expect((await ad.companyConfiguration.get(A.companyId))?.activity_keys).toEqual(['consulting']);
  });

  it('no direct table writes, no anon, and the database enforces the rules', async () => {
    // The table isn't in the generated types; the shape of this one call is spelled out instead.
    type DirectUpdate = { update: (v: object) => { eq: (c: string, v: string) => PromiseLike<{ error: { code?: string } | null }> } };
    const { error: ins } = await (A.client.from('company_configurations' as never) as unknown as DirectUpdate).update({ activity_keys: ['hack'] }).eq('company_id', A.companyId);
    expect(ins).not.toBeNull();
    const anonC = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, opts);
    const { error: anonErr } = await anonC.rpc('save_company_configuration' as never, { p_taxonomy_version: 'x', p_activity_keys: ['a'], p_primary_activity_key: 'a', p_enabled_modules: ['accounting'] } as never);
    expect(anonErr).not.toBeNull();
    const bad = await A.client.rpc('save_company_configuration' as never, { p_taxonomy_version: TAXONOMY_VERSION, p_activity_keys: ['consulting'], p_primary_activity_key: 'consulting', p_enabled_modules: ['accounting', 'contacts'] } as never);
    expect(bad.error?.message).toMatch(/essentials_ck|check constraint/i);
    const badPrimary = await A.client.rpc('save_company_configuration' as never, { p_taxonomy_version: TAXONOMY_VERSION, p_activity_keys: ['consulting'], p_primary_activity_key: 'pharmacy', p_enabled_modules: ['accounting', 'contacts', 'banking'] } as never);
    expect(badPrimary.error?.message).toMatch(/activities_ck|check constraint/i);
    const badKey = await A.client.rpc('save_company_configuration' as never, { p_taxonomy_version: TAXONOMY_VERSION, p_activity_keys: ['Drop Table'], p_primary_activity_key: 'Drop Table', p_enabled_modules: ['accounting', 'contacts', 'banking'] } as never);
    expect(badKey.error?.code).toBe('22023');
  });
});
