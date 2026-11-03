/**
 * Finding E — behavioural verification against STAGING ONLY.
 *
 * tests/unit/finding-e-definer-guards.test.ts proves the repo states the right
 * guards and grants. This suite proves the database actually enforces them, with
 * real signed-in users:
 *
 *   E1  the anon key cannot execute any of the affected functions
 *   E2  a signed-up user with NO company is refused for another company
 *   E3  a user of company B is refused for company A, and cannot delete A's
 *       bank reconciliation
 *   E4  the owner of company A keeps every legitimate operation: contact and
 *       product search, daily cash, bank recon read/save/delete, project
 *       profitability, stock revaluation of their own company
 *   E5  the service role keeps the maintenance path (recompute)
 *   E6  seed_default_tax_rates is trigger-only, and onboarding still seeds
 *       tax rates through the trigger
 *   E7  delete_bank_reconciliation (phase109c) needs accounting.write: a
 *       Viewer or Salesperson of the same company is refused, an Accountant is
 *       allowed, and the service_role key is refused
 *
 * WHERE IT RUNS
 * Only against a non-production Supabase project. It reads its connection from
 * .env.staging.local — never .env.local, which points at production — and the
 * H4 guard refuses the production ref even if that file is misconfigured. With
 * no staging file it fails loudly at load: it never skips and never falls back.
 *
 *     npm run test:finding-e
 *
 * It creates and deletes users and companies, so it is NOT in the pre-commit
 * hook or CI. Requires phase109, phase109b and phase109c applied to the staging
 * database.
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/types/database';
import { createSupabaseAdapter } from '../../src/data/supabaseAdapter';
import { runOnboarding, type WizardData } from '../../src/core/onboarding';
import { assertNotProductionTarget, loadStagingEnv } from './_env-guard';

// Reads .env.staging.local only, never .env.local, and refuses it unless every
// target is the local Supabase stack on this machine. The values stay in this
// object, not process.env, so nothing else in the run can pick them up.
const env = loadStagingEnv();

const SUPABASE_URL        = env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY   = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SECRET_KEY) {
  throw new Error('[Finding E] .env.staging.local needs VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY');
}
assertNotProductionTarget(SUPABASE_URL); // belt and braces: never the production ref

const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient<Database>(SUPABASE_URL, SUPABASE_SECRET_KEY, noSession);
const anon = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, noSession);

// The generated types do not list every RPC; the calls below are untyped on purpose.
type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
const rpcOf = (c: SupabaseClient<Database>): Rpc => (fn, args) => (c as unknown as { rpc: Rpc }).rpc(fn, args);

// ── Users and companies ─────────────────────────────────────────────────────
interface User { client: SupabaseClient<Database>; userId: string }
interface Tenant extends User { companyId: string; bankCoaId: string; bankAccountId: string }
let seq = 0;

async function signUp(label: string): Promise<User> {
  const tag = `${Date.now()}-${seq++}`;
  const email = `finding-e-${label}-${tag}@stockbolt.test`;
  const password = `FindingE!${tag}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const client = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!, noSession);
  const { error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn: ${sErr.message}`);
  return { client, userId: data.user.id };
}

async function createTenant(label: string): Promise<Tenant> {
  const user = await signUp(label);
  const wizard: WizardData = {
    full_name: `Finding E ${label}`,
    company_name: `Finding E ${label} ${seq}`,
    company_name_ar: 'اختبار',
    address: 'Dubai',
    country_code: 'AE',
    is_tax_registered: false,
    tax_id: '',
    currency: 'AED',
    fiscal_year_start: '2026-01-01',
    warehouse_name: 'Main',
    warehouse_name_ar: 'رئيسي',
    warehouse_code: 'MAIN',
    load_sample_data: false,
  };
  const { company_id } = await runOnboarding(wizard, createSupabaseAdapter(user.client));

  const { data: coa, error: coaErr } = await admin
    .from('chart_of_accounts').select('id').eq('company_id', company_id).eq('code', '1110').single();
  if (coaErr || !coa) throw new Error(`bank COA 1110 missing: ${coaErr?.message}`);
  const { data: bank, error: bErr } = await admin
    .from('bank_accounts')
    .insert({ company_id, name: `Finding E bank ${label}`, account_type: 'bank', currency: 'AED', coa_account_id: coa.id } as never)
    .select('id').single();
  if (bErr || !bank) throw new Error(`bank account: ${bErr?.message}`);
  return { ...user, companyId: company_id, bankCoaId: coa.id, bankAccountId: (bank as { id: string }).id };
}

/** A user who belongs to `t`'s company with the given role. */
async function addMember(t: Tenant, role: 'accountant' | 'sales' | 'viewer'): Promise<User> {
  const user = await signUp(role);
  const { error } = await admin.from('profiles').insert({
    id: user.userId, company_id: t.companyId, full_name: `Finding E ${role}`,
    email: `${user.userId}@stockbolt.test`, role, is_active: true,
  } as never);
  if (error) throw new Error(`add ${role}: ${error.message}`);
  return user;
}

const members: User[] = [];

async function destroy(t: Tenant | null): Promise<void> {
  if (!t) return;
  // Users first: deleting an auth user cascades to its profile, and profiles
  // hold the company with ON DELETE RESTRICT.
  await admin.auth.admin.deleteUser(t.userId).catch(() => undefined);
  await admin.from('bank_reconciliations' as never).delete().eq('company_id', t.companyId);
  await admin.from('bank_accounts').delete().eq('company_id', t.companyId);
  await admin.from('companies').delete().eq('id', t.companyId);
}

// ── The calls under test, each aimed at one company ─────────────────────────
const today = new Date().toISOString().slice(0, 10);
const reads = (co: Tenant): Array<[string, Record<string, unknown>]> => [
  ['search_contacts', { p_company_id: co.companyId, p_q: null, p_type: null, p_limit: 5 }],
  ['search_products', { p_company_id: co.companyId, p_q: null, p_limit: 5 }],
  ['get_daily_cash_report', { p_company_id: co.companyId, p_date: today }],
  ['get_bank_recon', { p_company_id: co.companyId, p_account_id: co.bankCoaId, p_date_from: '2026-01-01', p_date_to: today }],
  ['get_project_profitability', { p_company_id: co.companyId }],
];
const writes = (co: Tenant): Array<[string, Record<string, unknown>]> => [
  ['recompute_stock_valuation', { p_company_id: co.companyId }],
  ['save_bank_reconciliation', {
    p_company_id: co.companyId, p_bank_account_id: co.bankAccountId, p_statement_end_date: today,
    p_statement_closing_balance: 0, p_gl_line_ids: [], p_notes: 'finding-e probe', p_lock: false,
  }],
  ['seed_default_tax_rates', { p_company_id: co.companyId, p_country: 'AE' }],
];

/** Refused: SQLSTATE 42501, whether by a missing grant or by the guard. */
function expectRefused(res: { error: { code?: string; message: string } | null }, what: string) {
  expect(res.error, `${what} must be refused`).not.toBeNull();
  expect(res.error!.code, `${what}: ${res.error!.message}`).toBe('42501');
}

let A: Tenant | null = null;
let B: Tenant | null = null;
let C: User | null = null; // signed up, never created a company
let reconA = '';

beforeAll(async () => {
  A = await createTenant('a');
  B = await createTenant('b');
  C = await signUp('nocompany');
  // A legitimately reconciles its own account, so there is something to steal.
  const { data, error } = await rpcOf(A.client)('save_bank_reconciliation', writes(A)[1][1]);
  if (error) throw new Error(`owner save_bank_reconciliation: ${error.message}`);
  reconA = (data as { id: string }).id;
}, 120_000);

afterAll(async () => {
  for (const m of members) await admin.auth.admin.deleteUser(m.userId).catch(() => undefined);
  await destroy(A);
  await destroy(B);
  if (C) await admin.auth.admin.deleteUser(C.userId).catch(() => undefined);
}, 60_000);

describe('E1 — the anon key cannot execute any affected function', () => {
  it('every read, write and delete is refused', async () => {
    for (const [fn, args] of [...reads(A!), ...writes(A!), ['delete_bank_reconciliation', { p_id: reconA }] as [string, Record<string, unknown>]]) {
      expectRefused(await rpcOf(anon)(fn, args), `anon ${fn}`);
    }
  });
});

describe('E2 — a signed-up user without a company is refused', () => {
  it('cannot read or write company A', async () => {
    for (const [fn, args] of [...reads(A!), ...writes(A!)]) {
      expectRefused(await rpcOf(C!.client)(fn, args), `no-company user ${fn}`);
    }
  });

  it("cannot delete company A's reconciliation", async () => {
    // No company means no profile, so the accounting.write check refuses first.
    expectRefused(await rpcOf(C!.client)('delete_bank_reconciliation', { p_id: reconA }), 'no-company delete');
    const { count } = await admin.from('bank_reconciliations' as never).select('id', { count: 'exact', head: true }).eq('id', reconA);
    expect(count, 'A reconciliation still exists').toBe(1);
  });
});

describe('E3 — a user of company B is refused for company A', () => {
  it('cannot read or write company A', async () => {
    for (const [fn, args] of [...reads(A!), ...writes(A!)]) {
      expectRefused(await rpcOf(B!.client)(fn, args), `company B user ${fn} on A`);
    }
  });

  it("cannot delete company A's reconciliation", async () => {
    const res = await rpcOf(B!.client)('delete_bank_reconciliation', { p_id: reconA });
    expect(res.error, 'delete must fail').not.toBeNull();
    expect(res.error!.code, res.error!.message).toBe('P0002'); // reads as not found
    const { count } = await admin.from('bank_reconciliations' as never).select('id', { count: 'exact', head: true }).eq('id', reconA);
    expect(count, 'A reconciliation still exists').toBe(1);
  });

  it('cannot recompute every company at once', async () => {
    expectRefused(await rpcOf(B!.client)('recompute_stock_valuation', { p_company_id: null }), 'recompute all companies');
  });
});

describe('E4 — the owner keeps every legitimate operation on their own company', () => {
  for (const i of [0, 1, 2, 3, 4]) {
    it(`reads: ${['search_contacts', 'search_products', 'get_daily_cash_report', 'get_bank_recon', 'get_project_profitability'][i]}`, async () => {
      const [fn, args] = reads(A!)[i];
      const res = await rpcOf(A!.client)(fn, args);
      expect(res.error, `${fn}: ${res.error?.message}`).toBeNull();
    });
  }

  it('recomputes its own stock valuation', async () => {
    const res = await rpcOf(A!.client)('recompute_stock_valuation', { p_company_id: A!.companyId });
    expect(res.error, res.error?.message).toBeNull();
  });

  it('saves and deletes its own bank reconciliation (company B, on itself)', async () => {
    const saved = await rpcOf(B!.client)('save_bank_reconciliation', writes(B!)[1][1]);
    expect(saved.error, saved.error?.message).toBeNull();
    const id = (saved.data as { id: string }).id;
    const del = await rpcOf(B!.client)('delete_bank_reconciliation', { p_id: id });
    expect(del.error, del.error?.message).toBeNull();
    const { count } = await admin.from('bank_reconciliations' as never).select('id', { count: 'exact', head: true }).eq('id', id);
    expect(count, 'own reconciliation deleted').toBe(0);
  });
});

describe('E5 — the service role keeps the maintenance path', () => {
  it('recomputes a company with no signed-in user', async () => {
    const res = await rpcOf(admin)('recompute_stock_valuation', { p_company_id: A!.companyId });
    expect(res.error, res.error?.message).toBeNull();
  });
});

describe('E6 — seed_default_tax_rates is trigger-only', () => {
  it('even the owner cannot call it directly', async () => {
    expectRefused(await rpcOf(A!.client)('seed_default_tax_rates', { p_company_id: A!.companyId, p_country: 'AE' }), 'owner seed');
  });

  it('onboarding still seeded tax rates through the trigger', async () => {
    const { count } = await admin.from('tax_rates').select('id', { count: 'exact', head: true }).eq('company_id', A!.companyId);
    expect(count ?? 0, 'tax rates seeded at onboarding').toBeGreaterThan(0);
  });
});

describe('E7 — deleting a reconciliation needs accounting.write (phase109c)', () => {
  const stillThere = async (id: string) => {
    const { count } = await admin.from('bank_reconciliations' as never).select('id', { count: 'exact', head: true }).eq('id', id);
    return count;
  };

  it('a Viewer of the same company is refused, and the reconciliation survives', async () => {
    const viewer = await addMember(A!, 'viewer');
    members.push(viewer);
    const res = await rpcOf(viewer.client)('delete_bank_reconciliation', { p_id: reconA });
    expectRefused(res, 'viewer delete');
    expect(res.error!.message).toMatch(/accounting\.write/);
    expect(await stillThere(reconA)).toBe(1);
  });

  it('a Salesperson of the same company is refused', async () => {
    const sales = await addMember(A!, 'sales');
    members.push(sales);
    expectRefused(await rpcOf(sales.client)('delete_bank_reconciliation', { p_id: reconA }), 'sales delete');
    expect(await stillThere(reconA)).toBe(1);
  });

  it('the service_role key is refused', async () => {
    expectRefused(await rpcOf(admin)('delete_bank_reconciliation', { p_id: reconA }), 'service_role delete');
    expect(await stillThere(reconA)).toBe(1);
  });

  it('an Accountant of the same company can delete it', async () => {
    const accountant = await addMember(A!, 'accountant');
    members.push(accountant);
    const res = await rpcOf(accountant.client)('delete_bank_reconciliation', { p_id: reconA });
    expect(res.error, res.error?.message).toBeNull();
    expect(await stillThere(reconA)).toBe(0);
  });
});
