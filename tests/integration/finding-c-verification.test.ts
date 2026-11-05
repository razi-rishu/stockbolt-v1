/**
 * Finding C — clients cannot write the ledgers directly (phase119), behaviour
 * against STAGING ONLY.
 *
 *   C1  a signed-in owner's direct INSERT into general_ledger, journal_entries,
 *       stock_ledger and deferred_cogs_queue is refused
 *   C2  an existing ledger row cannot be UPDATEd or DELETEd directly; it is
 *       unchanged afterwards
 *   C3  posting through the functions still works: a manual journal entry
 *       posts balanced and reads back, and its reversal posts
 *   C4  RLS still applies inside a posting: a Viewer (no accounting.write)
 *       is refused by post_journal_entry, and a user of company B cannot
 *       reverse company A's entry
 *   C5  the anon key cannot execute a posting function
 *
 * The role itself (ledger_writer: no login, no RLS bypass, no members but
 * postgres, owner of exactly the posting functions) is checked by the static
 * suite (tests/unit/finding-c-ledger-writer.test.ts) and the phase119
 * read-only verification query; PostgREST cannot see role attributes.
 *
 * Reads .env.staging.local only (loadStagingEnv); refuses any non-local target.
 * It creates and deletes users and companies, so it is not in the pre-commit
 * hook.   npm run test:finding-c
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
const anon = createClient<Database>(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, noSession);
const PREFIX = 'TAX Scratch finding-c ';

// The generated types don't list every RPC or every write shape used here.
type Res = { data: unknown; error: { code?: string; message: string } | null };
type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<Res>;
const rpcOf = (c: SupabaseClient<Database>): Rpc => (fn, args) => (c as unknown as { rpc: Rpc }).rpc(fn, args);
type Loose = {
  from: (t: string) => {
    insert: (v: object) => { select: () => PromiseLike<Res> };
    update: (v: object) => { eq: (c: string, v: string) => { select: () => PromiseLike<Res> } };
    delete: () => { eq: (c: string, v: string) => { select: () => PromiseLike<Res> } };
  };
};
const loose = (c: SupabaseClient<Database>) => c as unknown as Loose;

interface T { client: SupabaseClient<Database>; userId: string; companyId: string; email: string }
const cleanup: { companyId: string; userIds: string[] }[] = [];
const extraUsers: string[] = [];
let seq = 0;

async function signIn() {
  const email = `fc-${Date.now()}-${seq++}@stockbolt.test`, password = 'FindingC!pass';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const client = createClient<Database>(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, noSession);
  const { error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn: ${sErr.message}`);
  return { client, userId: data.user.id, email };
}
async function tenant(name: string): Promise<T> {
  const u = await signIn();
  const { company_id } = await runOnboarding({ company_name: PREFIX + name, company_name_ar: '', address: '', full_name: 'FC Owner',
    country_code: 'AE', is_tax_registered: false, tax_id: '', currency: 'AED', fiscal_year_start: '2026-01-01',
    warehouse_name: 'Main', warehouse_name_ar: 'رئيسي', warehouse_code: 'MAIN', load_sample_data: false },
  createSupabaseAdapter(u.client));
  cleanup.push({ companyId: company_id, userIds: [u.userId] });
  return { ...u, companyId: company_id };
}

/** A balanced manual journal entry through the posting function. */
async function postManual(c: SupabaseClient<Database>, amount: number): Promise<Res> {
  return rpcOf(c)('post_journal_entry', { p_data: {
    source_type: 'manual', date: '2026-03-01', description: 'Finding C test',
    lines: [
      { account_code: '1100', debit: amount, credit: 0 },
      { account_code: '3200', debit: 0, credit: amount },
    ],
  } });
}
const DENIED = /permission denied|42501|row-level security/i;

let A: T, B: T, jeId = '';
beforeAll(async () => {
  A = await tenant('A');
  B = await tenant('B');
  const res = await postManual(A.client, 250);
  if (res.error) throw new Error(`post_journal_entry as owner: ${res.error.message}`);
  jeId = (res.data as { journal_entry_id: string }).journal_entry_id;
}, 120_000);
afterAll(async () => {
  for (const id of extraUsers) { await admin.from('profiles').delete().eq('id', id); await admin.auth.admin.deleteUser(id); }
  const left: string[] = [];
  for (const c of cleanup) left.push(...await destroyTenant(admin, { ...c, namePrefix: PREFIX }));
  if (left.length) throw new Error(left.join('\n'));
}, 120_000);

describe('Finding C (phase119): the ledgers are written only by the posting functions', () => {
  it('C1: direct inserts into the four ledger tables are refused, even for the owner', async () => {
    const { data: acct } = await admin.from('chart_of_accounts').select('id').eq('company_id', A.companyId).eq('code', '1100').single();
    const attempts: [string, object][] = [
      ['general_ledger', { company_id: A.companyId, journal_entry_id: jeId, account_id: acct!.id, account_code: '1100', date: '2026-03-02', debit: 999, credit: 0, description: 'forged' }],
      ['journal_entries', { company_id: A.companyId, entry_number: 'JE-FORGED', date: '2026-03-02', description: 'forged', source_type: 'manual', currency: 'AED', exchange_rate: 1, total_debit: 1, total_credit: 1 }],
      ['stock_ledger', { company_id: A.companyId, date: '2026-03-02', type: 'adjustment', quantity: 1, direction: 1, unit_cost: 1, total_cost: 1 }],
      ['deferred_cogs_queue', { company_id: A.companyId, quantity: 1, status: 'pending' }],
    ];
    for (const [table, row] of attempts) {
      const { error } = await loose(A.client).from(table).insert(row).select();
      expect(error?.message ?? 'no error', `${table} insert`).toMatch(DENIED);
    }
  });

  it('C2: a posted ledger line cannot be edited or deleted directly', async () => {
    const before = await admin.from('general_ledger').select('id, debit, credit').eq('journal_entry_id', jeId);
    expect(before.data!.length).toBe(2);
    const line = before.data![0];
    const upd = await loose(A.client).from('general_ledger').update({ debit: 1 }).eq('id', line.id).select();
    expect(upd.error?.message ?? 'no error', 'update').toMatch(DENIED);
    const del = await loose(A.client).from('general_ledger').delete().eq('id', line.id).select();
    expect(del.error?.message ?? 'no error', 'delete').toMatch(DENIED);
    const jeDel = await loose(A.client).from('journal_entries').delete().eq('id', jeId).select();
    expect(jeDel.error?.message ?? 'no error', 'journal delete').toMatch(DENIED);
    const after = await admin.from('general_ledger').select('id, debit, credit').eq('journal_entry_id', jeId);
    expect(after.data).toEqual(before.data);
  });

  it('C3: posting through the functions still works, and reads are unchanged', async () => {
    const { data: lines } = await A.client.from('general_ledger').select('debit, credit').eq('journal_entry_id', jeId);
    expect(lines!.reduce((s, l) => s + Number(l.debit), 0)).toBeCloseTo(250, 2);
    expect(lines!.reduce((s, l) => s + Number(l.credit), 0)).toBeCloseTo(250, 2);
    const second = await postManual(A.client, 40);
    expect(second.error, second.error?.message).toBeNull();
    const rev = await rpcOf(A.client)('reverse_journal_entry', { p_je_id: (second.data as { journal_entry_id: string }).journal_entry_id });
    expect(rev.error, rev.error?.message).toBeNull();
    const { data: health } = await rpcOf(admin)('verify_invariants', { p_company_id: A.companyId, p_as_of_date: '2026-12-31' });
    const failed = (health as Array<{ invariant: string; pass: boolean }>).filter((c) => !c.pass && c.invariant !== 'G2');
    expect(failed, JSON.stringify(failed)).toHaveLength(0);
  });

  it('C4: RLS still applies inside a posting (permission and company isolation)', async () => {
    const v = await signIn(); extraUsers.push(v.userId);
    await admin.from('profiles').insert({ id: v.userId, company_id: A.companyId, full_name: 'FC Viewer', email: v.email, role: 'viewer', is_active: true } as never);
    const byViewer = await postManual(v.client, 10);
    expect(byViewer.error?.message ?? 'no error', 'viewer posting').toMatch(/permission|denied|not allowed|row-level security|42501/i);

    const byOtherCompany = await rpcOf(B.client)('reverse_journal_entry', { p_je_id: jeId });
    expect(byOtherCompany.error, 'company B reversing company A').not.toBeNull();
    const { data: aLines } = await admin.from('general_ledger').select('id').eq('company_id', A.companyId);
    const { count } = await admin.from('journal_entries').select('id', { count: 'exact', head: true }).eq('reversal_of_id', jeId);
    expect(count, 'A\'s entry was not reversed by B').toBe(0);
    expect(aLines!.length).toBeGreaterThan(0);
  });

  it('C5: the anon key cannot execute a posting function', async () => {
    const res = await postManual(anon, 1);
    expect(res.error).not.toBeNull();
  });
});
