/**
 * Global v1 Phases 3, 6 and 7 — behaviour on LOCAL staging (global02-04).
 *
 *   W1  a new company gets exactly one Head Office; its onboarding warehouse is in it
 *   W2  the owner adds a branch, moves a warehouse to it, assigns a user to two branches
 *   W3  company isolation: another company sees none of it and cannot write into it
 *   W4  permissions: a Viewer cannot create branches or change assignments
 *   W5  the default branch cannot be deactivated or deleted
 *   W6  financial settings: the financial year changes before the first
 *       transaction; after it, currency / financial year are refused
 *   W7  drafts: own draft saved, read, removed; another user cannot read it or
 *       point a draft at a company that is not theirs
 *   W8  an interrupted activation re-run resumes: one company, one Head Office
 *
 * loadStagingEnv() (local stack only); destroyTenant() cleanup.  npm run test:global-wizard
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadStagingEnv } from './_env-guard';
import { destroyTenant } from './_tenant-cleanup';
import { createSupabaseAdapter } from '@/data/supabaseAdapter';
import { runOnboarding, type WizardData } from '@/core/onboarding';

const env = loadStagingEnv();
const opts = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY, opts);
const PREFIX = 'TAX Scratch wizard ';
type T = { client: SupabaseClient; userId: string; companyId: string; email: string };
const cleanup: { companyId: string; userIds: string[] }[] = [];
const extraUsers: string[] = [];
let seq = 0;

async function signIn() {
  const email = `gw-${Date.now()}-${seq++}@stockbolt.test`, password = 'GlobalWizard!pass';
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, opts);
  await client.auth.signInWithPassword({ email, password });
  return { client, userId: data.user!.id, email };
}
const wizard = (name: string): WizardData => ({ company_name: PREFIX + name, company_name_ar: '', address: '', full_name: 'W Owner',
  country_code: 'AE', is_tax_registered: false, tax_id: '', currency: 'AED', fiscal_year_start: '2026-01-01',
  warehouse_name: 'Main', warehouse_name_ar: 'رئيسي', warehouse_code: 'MAIN', load_sample_data: false });
async function tenant(name: string): Promise<T> {
  const u = await signIn();
  const { company_id } = await runOnboarding(wizard(name), createSupabaseAdapter(u.client as never));
  cleanup.push({ companyId: company_id, userIds: [u.userId] });
  return { ...u, companyId: company_id };
}
async function viewerOf(companyId: string) {
  const v = await signIn(); extraUsers.push(v.userId);
  await admin.from('profiles').insert({ id: v.userId, company_id: companyId, full_name: 'W Viewer', email: v.email, role: 'viewer', is_active: true } as never);
  return v;
}

let A: T, B: T;
beforeAll(async () => { A = await tenant('A'); B = await tenant('B'); }, 120_000);
afterAll(async () => {
  for (const id of extraUsers) { await admin.from('profiles').delete().eq('id', id); await admin.auth.admin.deleteUser(id); }
  const left: string[] = [];
  for (const c of cleanup) left.push(...await destroyTenant(admin, { ...c, namePrefix: PREFIX }));
  if (left.length) throw new Error(left.join('\n'));
}, 120_000);

describe('Global wizard on local staging (global02-04)', () => {
  it('W1: a new company gets one Head Office and its warehouse is in it', async () => {
    const ad = createSupabaseAdapter(A.client as never);
    const branches = await ad.branches.list(A.companyId);
    expect(branches).toHaveLength(1);
    expect(branches[0]).toMatchObject({ code: 'HQ', is_default: true, is_active: true });
    const { data: wh } = await admin.from('warehouses').select('branch_id').eq('company_id', A.companyId);
    expect(wh!.map((w) => (w as { branch_id: string }).branch_id)).toEqual([branches[0].id]);
  });

  it('W2: the owner adds a branch, moves a warehouse, assigns a user to two branches', async () => {
    const ad = createSupabaseAdapter(A.client as never);
    const dxb = await ad.branches.create({ company_id: A.companyId, code: 'DXB', name: 'Dubai' });
    const { data: wh } = await admin.from('warehouses').select('id').eq('company_id', A.companyId).single();
    await ad.branches.assignWarehouse(wh!.id, dxb.id);
    const { data: moved } = await admin.from('warehouses').select('branch_id').eq('id', wh!.id).single();
    expect((moved as { branch_id: string }).branch_id).toBe(dxb.id);

    const hq = (await ad.branches.list(A.companyId)).find((b) => b.is_default)!;
    await ad.branches.setAssignments(A.companyId, A.userId, [hq.id, dxb.id]);
    expect((await ad.branches.listAssignments(A.companyId)).map((a) => a.branch_id).sort()).toEqual([hq.id, dxb.id].sort());
    await ad.branches.setAssignments(A.companyId, A.userId, [dxb.id]);
    expect((await ad.branches.listAssignments(A.companyId)).map((a) => a.branch_id)).toEqual([dxb.id]);
  });

  it('W3: another company can neither see nor write into these branches', async () => {
    const adB = createSupabaseAdapter(B.client as never);
    expect((await adB.branches.list(A.companyId))).toHaveLength(0);
    expect(await adB.branches.listAssignments(A.companyId)).toHaveLength(0);
    await expect(adB.branches.create({ company_id: A.companyId, code: 'HACK', name: 'Hack' })).rejects.toThrow();
    const aHq = (await createSupabaseAdapter(A.client as never).branches.list(A.companyId)).find((b) => b.is_default)!;
    const { data: bWh } = await admin.from('warehouses').select('id, branch_id').eq('company_id', B.companyId).single();
    // B can't point its own warehouse at A's branch (same-company foreign key)…
    await expect(adB.branches.assignWarehouse(bWh!.id, aHq.id)).rejects.toThrow();
    // …nor rename A's branch (RLS: no row matches, nothing changes).
    await adB.branches.update(aHq.id, { name: 'Taken over' });
    const { data: still } = await admin.from('branches').select('name').eq('id', aHq.id).single();
    expect((still as { name: string }).name).toBe('Head Office');
  });

  it('W4: a Viewer cannot create branches or change assignments', async () => {
    const v = await viewerOf(A.companyId);
    const adV = createSupabaseAdapter(v.client as never);
    expect((await adV.branches.list(A.companyId)).length).toBeGreaterThan(0); // can read
    await expect(adV.branches.create({ company_id: A.companyId, code: 'VW', name: 'Viewer branch' })).rejects.toThrow();
    const hq = (await adV.branches.list(A.companyId)).find((b) => b.is_default)!;
    await expect(adV.branches.setAssignments(A.companyId, v.userId, [hq.id])).rejects.toThrow();
  });

  it('W5: the default branch cannot be deactivated or deleted', async () => {
    const ad = createSupabaseAdapter(A.client as never);
    const hq = (await ad.branches.list(A.companyId)).find((b) => b.is_default)!;
    await expect(ad.branches.update(hq.id, { is_active: false })).rejects.toThrow(/default_branch_required/);
    const { error } = await (A.client as unknown as { from: (t: string) => { delete: () => { eq: (c: string, v: string) => PromiseLike<{ error: { message: string } | null }> } } })
      .from('branches').delete().eq('id', hq.id);
    expect(error?.message ?? '').toMatch(/default_branch_required/);
  });

  it('W6: financial settings change before the first transaction, and are locked after it', async () => {
    const ad = createSupabaseAdapter(B.client as never);
    expect(await ad.companyConfiguration.hasTransactions(B.companyId)).toBe(false);
    await ad.companies.update(B.companyId, { fiscal_year_start: '2026-04-01' });
    const { data: c1 } = await admin.from('companies').select('fiscal_year_start').eq('id', B.companyId).single();
    expect(c1!.fiscal_year_start).toBe('2026-04-01');

    await ad.accounting.postJE({ source_type: 'manual', date: '2026-05-01', description: 'first', lines: [
      { account_code: '1100', debit: 10, credit: 0 }, { account_code: '3200', debit: 0, credit: 10 }] });
    expect(await ad.companyConfiguration.hasTransactions(B.companyId)).toBe(true);
    await expect(ad.companies.update(B.companyId, { fiscal_year_start: '2026-01-01' })).rejects.toThrow(/financial_settings_locked/);
    await expect(ad.companies.update(B.companyId, { currency: 'USD' })).rejects.toThrow(/financial_settings_locked/);
    // Other company settings stay editable.
    await ad.companies.update(B.companyId, { phone: '+971 4 000 0000' });
  });

  it('W7: drafts are private to their user and can only point at the user\'s own company', async () => {
    const adA = createSupabaseAdapter(A.client as never);
    const adB = createSupabaseAdapter(B.client as never);
    await adA.setupDrafts.save('configuration', 'module_configuration', { choices: { activity_keys: ['consulting'] } }, A.companyId);
    const mine = await adA.setupDrafts.get('configuration');
    expect(mine).toMatchObject({ step: 'module_configuration', company_id: A.companyId });
    expect(await adB.setupDrafts.get('configuration')).toBeNull();
    await expect(adB.setupDrafts.save('configuration', 'review_activation', { x: 1 }, A.companyId)).rejects.toThrow();
    await adA.setupDrafts.remove('configuration');
    expect(await adA.setupDrafts.get('configuration')).toBeNull();
  });

  it('W8: re-running an interrupted activation resumes - one company, one Head Office', async () => {
    const u = await signIn(); extraUsers.push(u.userId);
    const ad = createSupabaseAdapter(u.client as never);
    const first = await runOnboarding(wizard('W8'), ad);
    const again = await runOnboarding(wizard('W8'), ad);
    cleanup.push({ companyId: first.company_id, userIds: [] });
    expect(again.company_id).toBe(first.company_id);
    const { count } = await admin.from('companies').select('id', { count: 'exact', head: true }).eq('name', PREFIX + 'W8');
    expect(count).toBe(1);
    expect((await ad.branches.list(first.company_id)).filter((b) => b.is_default)).toHaveLength(1);
    const { data: wh } = await admin.from('warehouses').select('id').eq('company_id', first.company_id);
    expect(wh).toHaveLength(1);
  });
});
