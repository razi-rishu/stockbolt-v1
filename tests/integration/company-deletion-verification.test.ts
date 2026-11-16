/**
 * phase136 — guarded company / member deletion, against LOCAL STAGING ONLY.
 *
 *   D1  no API role can run the procedure: anon, a signed-in owner, service_role
 *   D2  preview is read-only and lists members, rows and no blockers
 *   D3  a wrong confirm_name deletes nothing
 *   D4  a team member who never touched anything → login deleted
 *   D5  a team member referenced by the books → pseudonymised + cannot sign in;
 *       the company's records keep pointing at the anonymous profile
 *   D6  the company's only admin cannot be "closed" as a member
 *   D7  company deletion removes every company_id row and every member login,
 *       leaves another company untouched, keeps legal_events, writes one log row
 *
 *     npx vitest run tests/integration/company-deletion-verification.test.ts --no-file-parallelism
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/types/database';
import { createSupabaseAdapter } from '../../src/data/supabaseAdapter';
import { runOnboarding, type WizardData } from '../../src/core/onboarding';
import { assertNotProductionTarget, loadStagingEnv } from './_env-guard';
import { destroyTenant } from './_tenant-cleanup';

const env = loadStagingEnv();
const URL_ = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SECRET = env.SUPABASE_SECRET_KEY;
if (!URL_ || !ANON || !SECRET) throw new Error('[deletion] .env.staging.local is incomplete');
assertNotProductionTarget(URL_);

function psql(sql: string): string {
  return execFileSync('docker', ['exec', '-i', 'supabase_db_stockbolt_local', 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }).trim();
}
const psqlErr = (sql: string): string => { try { psql(sql); return ''; } catch (e) { return (e as Error).message; } };

const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient<Database>(URL_, SECRET, noSession);
const anonClient = createClient<Database>(URL_, ANON, noSession);
type Res = { data: unknown; error: { code?: string; message: string } | null };
type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<Res>;
const rpc = (c: SupabaseClient<Database>): Rpc => (fn, args = {}) => (c as unknown as { rpc: Rpc }).rpc(fn, args);

interface User { client: SupabaseClient<Database>; userId: string; email: string; password: string }
interface Tenant extends User { companyId: string; name: string; bankAccountId: string }
let seq = 0;
const allUsers: string[] = [];

async function signUp(label: string): Promise<User> {
  const tag = `${Date.now()}-${seq++}`;
  const email = `deletion-${label}-${tag}@stockbolt.test`;
  const password = `Deletion!${tag}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  allUsers.push(data.user.id);
  const client = createClient<Database>(URL_!, ANON!, noSession);
  const { error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn: ${sErr.message}`);
  return { client, userId: data.user.id, email, password };
}

async function createTenant(label: string): Promise<Tenant> {
  const user = await signUp(label);
  const name = `Deletion ${label} ${seq}`;
  const wizard: WizardData = {
    full_name: `Deletion ${label}`, company_name: name, company_name_ar: 'اختبار', address: 'Dubai',
    country_code: 'AE', is_tax_registered: false, tax_id: '', currency: 'AED', fiscal_year_start: '2026-01-01',
    warehouse_name: 'Main', warehouse_name_ar: 'رئيسي', warehouse_code: 'MAIN', load_sample_data: false,
  };
  const { company_id } = await runOnboarding(wizard, createSupabaseAdapter(user.client));
  const { data: coa } = await admin.from('chart_of_accounts').select('id').eq('company_id', company_id).eq('code', '1110').single();
  const { data: bank, error } = await admin.from('bank_accounts')
    .insert({ company_id, name: `Deletion bank ${label}`, account_type: 'bank', currency: 'AED', coa_account_id: coa!.id } as never)
    .select('id').single();
  if (error || !bank) throw new Error(`bank: ${error?.message}`);
  // Books: a posted opening balance (journal_entries.created_by → owner) and a contact.
  const ob = await rpc(user.client)('post_bank_opening_balance', { p_bank_account_id: (bank as { id: string }).id, p_direction: 'debit', p_amount: 100, p_date: '2026-01-01', p_notes: 'deletion probe' });
  if (ob.error) throw new Error(`opening balance: ${ob.error.message}`);
  return { ...user, companyId: company_id, name, bankAccountId: (bank as { id: string }).id };
}

async function addMember(t: Tenant, role: 'viewer' | 'accountant'): Promise<User> {
  const u = await signUp(role);
  const { error } = await admin.from('profiles').insert({
    id: u.userId, company_id: t.companyId, full_name: `Deletion ${role}`, email: u.email, role, is_active: true,
  } as never);
  if (error) throw new Error(`member: ${error.message}`);
  return u;
}

/** Rows per company_id table for one company, as the procedure itself sees them. */
function rowCounts(companyId: string): Record<string, number> {
  const out = psql(`SELECT table_name FROM public._platform_company_tables();`).split('\n').filter(Boolean);
  const counts: Record<string, number> = {};
  const sql = out.map((t) => `SELECT '${t}', count(*) FROM public.${t} WHERE company_id = '${companyId}'`).join(' UNION ALL ') + ';';
  for (const line of psql(sql).split('\n').filter(Boolean)) {
    const [t, n] = line.split('|');
    if (Number(n) > 0) counts[t] = Number(n);
  }
  return counts;
}

let A: Tenant; let B: Tenant; let idle: User; let accountant: User;
const REF = 'test-phase136';

beforeAll(async () => {
  A = await createTenant('a');
  B = await createTenant('b');
  idle = await addMember(A, 'viewer');
  accountant = await addMember(A, 'accountant');
  // The accountant posts something, so the books reference them.
  const { data: cash } = await admin.from('chart_of_accounts').select('id').eq('company_id', A.companyId).eq('code', '1100').single();
  const ob = await rpc(accountant.client)('post_gl_opening_balance', { p_account_id: cash!.id, p_direction: 'debit', p_amount: 5, p_date: '2026-01-02', p_notes: 'by accountant' });
  if (ob.error) throw new Error(`accountant posting: ${ob.error.message}`);
  const t = await rpc(A.client)('support_create_ticket', {
    p_category: 'assistance', p_subject: 'Deletion probe', p_description: 'to be deleted',
    p_module: null, p_contact_preference: 'in_app', p_client_request_id: crypto.randomUUID(),
  });
  if (t.error) throw new Error(`ticket: ${t.error.message}`);
  psql(`INSERT INTO legal_events (user_id, doc_type, version, sha256, event, platform)
        VALUES ('${A.userId}', 'terms', 'test-del', '${'b'.repeat(64)}', 'accepted', 'web');`);
}, 180_000);

afterAll(async () => {
  const failed: string[] = [];
  for (const t of [B, A]) {
    if (!t) continue;
    psql(`DELETE FROM support_activity WHERE ticket_id IN (SELECT id FROM support_tickets WHERE company_id = '${t.companyId}');
          DELETE FROM support_messages WHERE ticket_id IN (SELECT id FROM support_tickets WHERE company_id = '${t.companyId}');
          DELETE FROM support_tickets WHERE company_id = '${t.companyId}';`);
    failed.push(...(await destroyTenant(admin, { companyId: t.companyId, userIds: [], namePrefix: 'Deletion ' })));
  }
  for (const u of allUsers) {
    const { error } = await admin.auth.admin.deleteUser(u);
    if (error && !/not found/i.test(error.message)) failed.push(`user ${u}: ${error.message}`);
  }
  psql(`BEGIN; SET LOCAL stockbolt.legal_maintenance = 'on';
        DELETE FROM legal_events WHERE version = 'test-del'; COMMIT;
        DELETE FROM platform_deletion_log WHERE request_ref = '${REF}';`);
  if (failed.length) throw new Error(`[deletion] cleanup problems:\n  ${failed.join('\n  ')}`);
}, 120_000);

describe('D1 — no API role can run it', () => {
  const calls: Array<[string, () => Record<string, unknown>]> = [
    ['platform_company_deletion_preview', () => ({ p_company_id: A.companyId })],
    ['platform_delete_company', () => ({ p_company_id: A.companyId, p_confirm_name: A.name, p_request_ref: REF })],
    ['platform_close_member_account', () => ({ p_user_id: idle.userId, p_request_ref: REF })],
  ];
  it('anon, a signed-in owner and service_role are all refused, and nothing changes', async () => {
    const before = rowCounts(A.companyId);
    for (const [fn, args] of calls) {
      for (const [who, c] of [['anon', anonClient], ['owner', A.client], ['service_role', admin]] as const) {
        const r = await rpc(c as SupabaseClient<Database>)(fn, args());
        expect(r.error, `${who} → ${fn} must be refused`).not.toBeNull();
      }
    }
    expect(rowCounts(A.companyId)).toEqual(before);
  });
});

describe('D2/D3 — preview and the name check', () => {
  it('preview lists members and rows and changes nothing', () => {
    const before = rowCounts(A.companyId);
    const p = JSON.parse(psql(`SELECT public.platform_company_deletion_preview('${A.companyId}');`));
    expect(p.members.length).toBe(3);
    expect(p.blockers).toEqual([]);
    expect(p.rows.journal_entries).toBeGreaterThanOrEqual(2);
    expect(p.rows.support_tickets).toBe(1);
    // Storage: three company folders + one per support ticket (keyed by ticket id).
    const buckets = (p.storage as { bucket: string; prefix: string }[]).map((x) => x.bucket).sort();
    expect(buckets).toEqual(['attachments', 'logos', 'products', 'support-attachments']);
    expect(p.storage.filter((x: { prefix: string }) => x.prefix === `${A.companyId}/`).length).toBe(3);
    expect(rowCounts(A.companyId)).toEqual(before);
  });
  it('a wrong confirm_name deletes nothing', () => {
    const before = rowCounts(A.companyId);
    expect(psqlErr(`SELECT public.platform_delete_company('${A.companyId}', '${A.name} x', '${REF}');`)).toMatch(/does not match/);
    expect(rowCounts(A.companyId)).toEqual(before);
  });
});

describe('D4–D6 — closing a team member', () => {
  it('a member nothing references is deleted outright', () => {
    const r = JSON.parse(psql(`SELECT public.platform_close_member_account('${idle.userId}', '${REF}');`));
    expect(r.result).toBe('member_deleted');
    expect(psql(`SELECT count(*) FROM auth.users WHERE id = '${idle.userId}';`)).toBe('0');
    expect(psql(`SELECT count(*) FROM profiles WHERE id = '${idle.userId}';`)).toBe('0');
  });
  it('a member the books reference is pseudonymised and can no longer sign in', async () => {
    const r = JSON.parse(psql(`SELECT public.platform_close_member_account('${accountant.userId}', '${REF}');`));
    expect(r.result).toBe('member_pseudonymised');
    expect(r.references_kept).toBeGreaterThan(0);
    const p = psql(`SELECT full_name || '|' || email || '|' || is_active FROM profiles WHERE id = '${accountant.userId}';`);
    expect(p).toBe(`Deleted user|deleted-${accountant.userId}@deleted.invalid|false`);
    expect(psql(`SELECT count(*) FROM auth.users WHERE id = '${accountant.userId}' AND email = '${accountant.email}';`)).toBe('0');
    const c = createClient<Database>(URL_!, ANON!, noSession);
    const { error } = await c.auth.signInWithPassword({ email: accountant.email, password: accountant.password });
    expect(error).not.toBeNull();
    // The journal they posted still points at the (anonymous) profile.
    expect(Number(psql(`SELECT count(*) FROM journal_entries WHERE created_by = '${accountant.userId}';`))).toBeGreaterThan(0);
  });
  it("the company's only admin cannot be closed as a member", () => {
    expect(psqlErr(`SELECT public.platform_close_member_account('${A.userId}', '${REF}');`)).toMatch(/only admin/);
  });
});

describe('D7 — deleting the company', () => {
  it('removes company A completely and leaves B untouched', () => {
    const bBefore = rowCounts(B.companyId);
    const r = JSON.parse(psql(`SELECT public.platform_delete_company('${A.companyId}', '${A.name.replace(/'/g, "''")}', '${REF}');`));
    expect(r.users_removed).toBe(2); // owner + pseudonymised accountant
    expect(r.storage.length).toBe(4);
    expect(psql(`SELECT jsonb_array_length(storage) FROM platform_deletion_log WHERE kind = 'company' AND subject_id = '${A.companyId}';`)).toBe('4');
    expect(rowCounts(A.companyId)).toEqual({});
    expect(psql(`SELECT count(*) FROM companies WHERE id = '${A.companyId}';`)).toBe('0');
    expect(psql(`SELECT count(*) FROM auth.users WHERE id IN ('${A.userId}', '${accountant.userId}');`)).toBe('0');
    expect(rowCounts(B.companyId)).toEqual(bBefore);
    expect(psql(`SELECT count(*) FROM legal_events WHERE user_id = '${A.userId}';`)).toBe('1');
    expect(psql(`SELECT count(*) FROM platform_deletion_log WHERE request_ref = '${REF}' AND kind = 'company' AND subject_id = '${A.companyId}';`)).toBe('1');
  });
  it('B still works after A is gone', async () => {
    const { data: cash } = await admin.from('chart_of_accounts').select('id').eq('company_id', B.companyId).eq('code', '1100').single();
    const r = await rpc(B.client)('post_gl_opening_balance', { p_account_id: cash!.id, p_direction: 'debit', p_amount: 1, p_date: '2026-01-03', p_notes: 'after' });
    expect(r.error, r.error?.message).toBeNull();
  });
});
