/**
 * phase135 — Terms enforcement, behavioural verification against LOCAL STAGING ONLY.
 *
 * Turns enforcement ON on the local staging database for the length of the
 * run (and always back OFF in afterAll), publishes the two draft documents
 * there with the fingerprints this build computes, and proves with real
 * signed-in users:
 *
 *   L1  legal_status reports what is owed
 *   L2  an unaccepted user is refused every write path: a direct table write
 *       (PostgREST + RLS), a SECURITY DEFINER RPC (auth_require), and a
 *       posting RPC that inserts journal_entries (posting guard)
 *   L3  the exceptions stay open: reading, Help & Support, legal pages
 *   L4  accept_legal refuses a stale fingerprint and a non-admin "on behalf
 *       of the company"; with the right fingerprint the same writes succeed
 *   L5  a decline is recorded and changes nothing else; legal_events cannot
 *       be edited or deleted by the user
 *   L6  enforcement OFF → the unaccepted user can write again
 *
 *   X1  export privacy: a second member of the same company, and a user of
 *       another company, see none of the owner's support tickets, messages,
 *       activity or legal events — and no row of another company in ANY
 *       table of the data-export manifest
 *   X2  support_operators and unpublished legal documents are invisible
 *
 * Needs phase133, phase134 and phase135 on the local staging database.
 * Creates and deletes users and companies, so it is not in pre-commit or CI.
 *
 *     npx vitest run tests/integration/legal-enforcement-verification.test.ts --no-file-parallelism
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/types/database';
import { createSupabaseAdapter } from '../../src/data/supabaseAdapter';
import { runOnboarding, type WizardData } from '../../src/core/onboarding';
import { legalFingerprints } from '../../src/legal/texts';
import { BACKUP_TABLES, BACKUP_UNSCOPED } from '../../src/lib/backup-manifest';
import { assertNotProductionTarget, loadStagingEnv } from './_env-guard';
import { destroyTenant } from './_tenant-cleanup';

const env = loadStagingEnv(); // refuses anything that is not the local stack
const URL_ = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SECRET = env.SUPABASE_SECRET_KEY;
if (!URL_ || !ANON || !SECRET) throw new Error('[legal] .env.staging.local is incomplete');
assertNotProductionTarget(URL_);

const DB_CONTAINER = 'supabase_db_stockbolt_local';
/** Runs SQL as postgres inside the LOCAL staging container. */
function psql(sql: string): string {
  return execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }).trim();
}

const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient<Database>(URL_, SECRET, noSession);
type Res = { data: unknown; error: { code?: string; message: string } | null };
type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<Res>;
const rpc = (c: SupabaseClient<Database>): Rpc => (fn, args = {}) => (c as unknown as { rpc: Rpc }).rpc(fn, args);
const from = (c: SupabaseClient<Database>, t: string) => (c as unknown as { from: (t: string) => ReturnType<SupabaseClient['from']> }).from(t);

interface User { client: SupabaseClient<Database>; userId: string }
interface Tenant extends User { companyId: string; bankAccountId: string }
let seq = 0;
const users: string[] = [];
const companies: string[] = [];

async function signUp(label: string): Promise<User> {
  const tag = `${Date.now()}-${seq++}`;
  const email = `legal-${label}-${tag}@stockbolt.test`;
  const password = `Legal!${tag}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  users.push(data.user.id);
  const client = createClient<Database>(URL_!, ANON!, noSession);
  const { error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn: ${sErr.message}`);
  return { client, userId: data.user.id };
}

async function createTenant(label: string): Promise<Tenant> {
  const user = await signUp(label);
  const wizard: WizardData = {
    full_name: `Legal ${label}`, company_name: `Legal ${label} ${seq}`, company_name_ar: 'اختبار',
    address: 'Dubai', country_code: 'AE', is_tax_registered: false, tax_id: '', currency: 'AED',
    fiscal_year_start: '2026-01-01', warehouse_name: 'Main', warehouse_name_ar: 'رئيسي',
    warehouse_code: 'MAIN', load_sample_data: false,
  };
  const { company_id } = await runOnboarding(wizard, createSupabaseAdapter(user.client));
  companies.push(company_id);
  const { data: coa } = await admin.from('chart_of_accounts').select('id').eq('company_id', company_id).eq('code', '1110').single();
  const { data: bank, error } = await admin.from('bank_accounts')
    .insert({ company_id, name: `Legal bank ${label}`, account_type: 'bank', currency: 'AED', coa_account_id: coa!.id } as never)
    .select('id').single();
  if (error || !bank) throw new Error(`bank: ${error?.message}`);
  return { ...user, companyId: company_id, bankAccountId: (bank as { id: string }).id };
}

async function addMember(t: Tenant, role: 'viewer' | 'sales'): Promise<User> {
  const u = await signUp(role);
  const { error } = await admin.from('profiles').insert({
    id: u.userId, company_id: t.companyId, full_name: `Legal ${role}`,
    email: `${u.userId}@stockbolt.test`, role, is_active: true,
  } as never);
  if (error) throw new Error(`member: ${error.message}`);
  return u;
}

const contactWrite = (u: Tenant | User, companyId: string) =>
  from(u.client, 'contacts').insert({ company_id: companyId, name: `Legal probe ${seq++}`, type: 'customer', currency: 'AED' } as never).select('id');
const postingWrite = (t: Tenant) =>
  rpc(t.client)('post_bank_opening_balance', { p_bank_account_id: t.bankAccountId, p_direction: 'debit', p_amount: 10, p_date: '2026-01-01', p_notes: 'legal probe' });
const settingsWrite = (t: Tenant) =>
  rpc(t.client)('save_bank_reconciliation', {
    p_company_id: t.companyId, p_bank_account_id: t.bankAccountId, p_statement_end_date: '2026-01-31',
    p_statement_closing_balance: 0, p_gl_line_ids: [], p_notes: 'legal probe', p_lock: false,
  });

let A: Tenant; let B: Tenant; let viewer: User;
let fp: { terms: string; privacy: string };
let ticketA = '';
let priorEnforcement = 'f';
const DOC_VERSION = 'test-enf';

beforeAll(async () => {
  const pre = psql(`SELECT enforcement::text || '|' || (SELECT count(*) FROM legal_documents) FROM legal_settings WHERE id = 1;`);
  const [enf, docs] = pre.split('|');
  priorEnforcement = enf === 'true' ? 't' : 'f';
  if (docs !== '0') throw new Error(`[legal] staging already has ${docs} legal_documents rows — refusing to disturb them`);
  fp = await legalFingerprints();
  A = await createTenant('a');
  B = await createTenant('b');
  viewer = await addMember(A, 'viewer');
  psql(`INSERT INTO legal_documents (doc_type, version, effective_at, sha256, requires_acceptance, change_summary_en, change_summary_ar, published) VALUES
          ('terms',   '${DOC_VERSION}', now() - interval '1 minute', '${fp.terms}',   true, 'test', 'test', true),
          ('privacy', '${DOC_VERSION}', now() - interval '1 minute', '${fp.privacy}', true, 'test', 'test', true);
        UPDATE legal_settings SET enforcement = true, updated_at = now() WHERE id = 1;`);
}, 180_000);

afterAll(async () => {
  const failed: string[] = [];
  try {
    psql(`UPDATE legal_settings SET enforcement = ${priorEnforcement === 't'}, updated_at = now() WHERE id = 1;
          DELETE FROM legal_documents WHERE version = '${DOC_VERSION}';`);
  } catch (e) { failed.push(`legal reset: ${(e as Error).message}`); }
  try {
    const ids = users.map((u) => `'${u}'`).join(',') || 'NULL';
    const cos = companies.map((c) => `'${c}'`).join(',') || 'NULL';
    psql(`BEGIN; SET LOCAL stockbolt.legal_maintenance = 'on';
          DELETE FROM legal_events WHERE user_id IN (${ids});
          COMMIT;
          DELETE FROM support_activity  WHERE ticket_id IN (SELECT id FROM support_tickets WHERE company_id IN (${cos}));
          DELETE FROM support_messages  WHERE ticket_id IN (SELECT id FROM support_tickets WHERE company_id IN (${cos}));
          DELETE FROM support_tickets   WHERE company_id IN (${cos});`);
  } catch (e) { failed.push(`legal/support rows: ${(e as Error).message}`); }
  const owners = new Map<string, string[]>([[A?.companyId ?? '', [A?.userId ?? '', viewer?.userId ?? '']], [B?.companyId ?? '', [B?.userId ?? '']]]);
  for (const c of companies) {
    failed.push(...(await destroyTenant(admin, { companyId: c, userIds: (owners.get(c) ?? []).filter(Boolean), namePrefix: 'Legal ' })));
  }
  for (const u of users) {
    const { error } = await admin.auth.admin.deleteUser(u);
    if (error && !/not found/i.test(error.message)) failed.push(`user ${u}: ${error.message}`);
  }
  const enf = psql(`SELECT enforcement FROM legal_settings WHERE id = 1;`);
  if (enf !== priorEnforcement) failed.push(`ENFORCEMENT NOT RESTORED (is ${enf})`);
  if (failed.length) throw new Error(`[legal] cleanup problems:\n  ${failed.join('\n  ')}`);
}, 120_000);

describe('L1 — status', () => {
  it('reports enforcement on and both documents owed', async () => {
    const { data, error } = await rpc(A.client)('legal_status');
    expect(error).toBeNull();
    const s = data as { enforcement: boolean; documents: { doc_type: string; accepted: boolean }[] };
    expect(s.enforcement).toBe(true);
    expect(s.documents.filter((d) => !d.accepted).map((d) => d.doc_type).sort()).toEqual(['privacy', 'terms']);
  });
});

describe('L2 — an unaccepted user cannot write', () => {
  it('direct table write (PostgREST + RLS) is refused', async () => {
    const r = await contactWrite(A, A.companyId);
    expect(r.error, 'contact insert must fail').not.toBeNull();
  });
  it('SECURITY DEFINER RPC guarded by auth_require is refused', async () => {
    const r = await settingsWrite(A);
    expect(r.error).not.toBeNull();
  });
  it('posting RPC (journal_entries) is refused by the posting guard', async () => {
    const r = await postingWrite(A);
    expect(r.error).not.toBeNull();
    // has_perm() refuses first (row-level security on the RPC's own writes).
    expect(r.error!.message).toMatch(/legal_acceptance_required|permission|denied|row-level security/i);
  });
  it('the posting guard alone stops a journal insert that bypasses RLS', () => {
    // As postgres (bypasses RLS) but carrying A's identity, like a definer
    // function would: only tg_legal_posting_guard stands in the way.
    let msg = '';
    try {
      psql(`BEGIN;
            SELECT set_config('request.jwt.claims', '{"sub":"${A.userId}","role":"authenticated"}', true);
            INSERT INTO journal_entries (company_id) VALUES ('${A.companyId}');
            ROLLBACK;`);
    } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/legal_acceptance_required/);
  });
});

describe('L3 — exceptions stay open', () => {
  it('reading company data works', async () => {
    const r = await from(A.client, 'chart_of_accounts').select('id').limit(1);
    expect(r.error).toBeNull();
    expect((r.data as unknown[]).length).toBe(1);
  });
  it('Help & Support: a ticket can be opened', async () => {
    const r = await rpc(A.client)('support_create_ticket', {
      p_category: 'assistance', p_subject: 'Legal probe ticket', p_description: 'private to the owner',
      p_module: null, p_contact_preference: 'in_app', p_client_request_id: crypto.randomUUID(),
    });
    expect(r.error, r.error?.message).toBeNull();
    ticketA = typeof r.data === 'string' ? r.data : (r.data as { id?: string; ticket_id?: string }).id ?? (r.data as { ticket_id?: string }).ticket_id ?? '';
    expect(ticketA).not.toBe('');
  });
  it('published legal documents are readable', async () => {
    const r = await from(A.client, 'legal_documents').select('doc_type').eq('version', DOC_VERSION);
    expect((r.data as unknown[]).length).toBe(2);
  });
});

describe('L4 — accepting', () => {
  it('a stale fingerprint is refused', async () => {
    const r = await rpc(A.client)('accept_legal', {
      p_items: [{ doc_type: 'terms', version: DOC_VERSION, sha256: '0'.repeat(64) }],
      p_on_behalf_of_company: false, p_platform: 'web', p_app_version: null,
    });
    expect(r.error?.message).toMatch(/stale_document/);
  });
  it('a non-admin cannot accept on behalf of the company', async () => {
    const r = await rpc(viewer.client)('accept_legal', {
      p_items: [{ doc_type: 'terms', version: DOC_VERSION, sha256: fp.terms }, { doc_type: 'privacy', version: DOC_VERSION, sha256: fp.privacy }],
      p_on_behalf_of_company: true, p_platform: 'web', p_app_version: null,
    });
    expect(r.error?.message).toMatch(/not_company_admin/);
  });
  it('the owner accepts for the company and every write path opens', async () => {
    const r = await rpc(A.client)('accept_legal', {
      p_items: [{ doc_type: 'terms', version: DOC_VERSION, sha256: fp.terms }, { doc_type: 'privacy', version: DOC_VERSION, sha256: fp.privacy }],
      p_on_behalf_of_company: true, p_platform: 'web', p_app_version: null,
    });
    expect(r.error, r.error?.message).toBeNull();
    expect((await contactWrite(A, A.companyId)).error).toBeNull();
    expect((await settingsWrite(A)).error).toBeNull();
    const p = await postingWrite(A);
    expect(p.error, p.error?.message).toBeNull();
  });
  it('acceptance is per user: the viewer of the same company still owes it', async () => {
    const { data } = await rpc(viewer.client)('legal_status');
    expect((data as { documents: { accepted: boolean }[] }).documents.some((d) => !d.accepted)).toBe(true);
  });
});

describe('L5 — declining', () => {
  it('a decline is recorded and nothing else changes', async () => {
    const r = await rpc(B.client)('decline_legal', { p_platform: 'web', p_app_version: null });
    expect(r.error, r.error?.message).toBeNull();
    const ev = await from(B.client, 'legal_events').select('event');
    expect((ev.data as { event: string }[]).map((e) => e.event)).toContain('declined');
    const read = await from(B.client, 'chart_of_accounts').select('id').limit(1);
    expect((read.data as unknown[]).length).toBe(1);
  });
  it('legal_events cannot be edited or deleted by the user', async () => {
    const u = await from(B.client, 'legal_events').update({ event: 'accepted' } as never).eq('user_id', B.userId).select('id');
    expect(u.error !== null || (u.data as unknown[]).length === 0).toBe(true);
    const d = await from(B.client, 'legal_events').delete().eq('user_id', B.userId).select('id');
    expect(d.error !== null || (d.data as unknown[]).length === 0).toBe(true);
    expect(psql(`SELECT count(*) FROM legal_events WHERE user_id = '${B.userId}' AND event = 'declined';`)).toBe('1');
  });
});

describe('X1 — export privacy', () => {
  it("another member of the same company sees none of the owner's support or legal rows", async () => {
    for (const t of ['support_tickets', 'support_messages', 'support_activity', 'support_attachments']) {
      const r = await from(viewer.client, t).select('*');
      expect(r.error, `${t}: ${r.error?.message}`).toBeNull();
      expect((r.data as unknown[]).length, `${t} visible to a colleague`).toBe(0);
    }
    const le = await from(viewer.client, 'legal_events').select('user_id');
    expect((le.data as { user_id: string }[]).every((e) => e.user_id === viewer.userId)).toBe(true);
  });
  it('the owner sees their own ticket (the export is not empty by accident)', async () => {
    const r = await from(A.client, 'support_tickets').select('id');
    expect((r.data as { id: string }[]).map((x) => x.id)).toContain(ticketA);
  });
  it('a user of another company gets no row of company A from ANY export table', async () => {
    const leaks: string[] = [];
    for (const t of BACKUP_TABLES) {
      const q = from(B.client, t).select('*').limit(1000);
      const r = await q;
      if (r.error) continue; // tables a role cannot read at all are not a leak
      const rows = r.data as Record<string, unknown>[];
      if (!BACKUP_UNSCOPED.has(t)) {
        if (rows.some((x) => x.company_id === A.companyId)) leaks.push(t);
      } else if (t === 'legal_events') {
        if (rows.some((x) => x.user_id !== B.userId)) leaks.push(t);
      } else if (rows.length > 0 && t.startsWith('support_')) {
        leaks.push(t);
      }
    }
    expect(leaks).toEqual([]);
  }, 120_000);
});

describe('X2 — platform tables', () => {
  it('support_operators is not readable', async () => {
    const r = await from(A.client, 'support_operators').select('*');
    expect(r.error !== null || (r.data as unknown[]).length === 0).toBe(true);
  });
  it('unpublished legal documents are invisible', async () => {
    psql(`INSERT INTO legal_documents (doc_type, version, effective_at, sha256, requires_acceptance, published)
          VALUES ('terms', '${DOC_VERSION}-draft', now(), '${'a'.repeat(64)}', true, false);`);
    const r = await from(A.client, 'legal_documents').select('version').eq('version', `${DOC_VERSION}-draft`);
    psql(`DELETE FROM legal_documents WHERE version = '${DOC_VERSION}-draft';`);
    expect((r.data as unknown[]).length).toBe(0);
  });
});

describe('L6 — enforcement off', () => {
  it('the unaccepted user can write again', async () => {
    psql(`UPDATE legal_settings SET enforcement = false, updated_at = now() WHERE id = 1;`);
    const r = await contactWrite(B, B.companyId);
    expect(r.error, r.error?.message).toBeNull();
  });
});
