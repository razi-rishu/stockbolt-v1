/**
 * AC-6A.2 — Amortization schedules: behavioural verification suite.
 *
 * The enforced regression suite (regressions.test.ts) is read-only/service-role
 * and CANNOT drive run_amortization / reverse_last_amortization — those RPCs
 * gate on auth.uid() + current_user_company_id(), which are NULL under the
 * service role. This suite proves the *numbers*: it creates a scratch tenant,
 * signs in as its owner, registers schedules of each kind, runs the real
 * authenticated RPCs, and asserts the exact GL legs (including DIRECTION per
 * kind), the remainder-absorbing final installment, idempotency, cancellation,
 * LIFO reversal, the period lock, and every verify_invariants identity (so the
 * Trial Balance is proven to still net to zero after every post).
 *
 * PRODUCTION SAFETY — this suite MUTATES (creates + deletes users, companies,
 * schedules and journal entries). It calls assertNotProductionTarget() first in
 * every scratch setup, so it REFUSES to run against the production project
 * (H4 P0 guard). It runs only when the harness points at a non-prod (staging)
 * Supabase project. It is NOT wired into the pre-commit hook. Run explicitly:
 *     npm run test:amortization      (only meaningful against staging)
 *
 * Requires phase61 (AC-6A) to be applied to the target database.
 *
 * Scenario coverage:
 *   A1  prepaid expense posts Dr expense / Cr 1410 and draws the asset down
 *   A2  catch-up posts every due period in one run
 *   A3  re-running the same period posts nothing (idempotent)
 *   A4  the FINAL installment absorbs the remainder — Σ posted == total exactly
 *   A5  deferred revenue reverses the direction (Dr 2500 / Cr revenue)
 *   A6  accrued expense builds the liability (Dr expense / Cr 2300)
 *   A7  a completed schedule stops posting and is marked completed
 *   A8  cancel stops future postings but keeps what is recognised
 *   A9  LIFO reversal rolls the last installment back and it can be re-posted
 *   A10 amortizing into a locked period is rejected; nothing posted
 */

import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'node:path';
import type { Database } from '../../src/types/database';
import { createSupabaseAdapter } from '../../src/data/supabaseAdapter';
import { runOnboarding, type WizardData } from '../../src/core/onboarding';
import { assertNotProductionTarget } from './_env-guard';
import type { AmortizationScheduleInsert } from '../../src/data/adapter';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const SUPABASE_URL        = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY   = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL)        throw new Error('Missing VITE_SUPABASE_URL in .env.local');
if (!SUPABASE_ANON_KEY)   throw new Error('Missing VITE_SUPABASE_PUBLISHABLE_KEY in .env.local');
if (!SUPABASE_SECRET_KEY) throw new Error('Missing SUPABASE_SECRET_KEY in .env.local');

const admin = createClient<Database>(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Scratch-tenant harness ──────────────────────────────────────────────────
type Adapter = ReturnType<typeof createSupabaseAdapter>;
interface Scratch {
  adapter: Adapter;
  userClient: SupabaseClient<Database>;
  companyId: string;
  userId: string;
}

let scratchSeq = 0;

async function createScratch(): Promise<Scratch> {
  assertNotProductionTarget(SUPABASE_URL); // H4 P0 — never against production
  const tag = `${Date.now()}-${scratchSeq++}`;
  const email = `am-${tag}@stockbolt.test`;
  const password = `Am!${tag}`;

  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (cErr || !created.user) throw new Error(`createUser: ${cErr?.message}`);
  const userId = created.user.id;

  const userClient = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: sErr } = await userClient.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn: ${sErr.message}`);

  const adapter = createSupabaseAdapter(userClient);
  const wizard: WizardData = {
    full_name: 'AM Test Owner',
    company_name: `AM Scratch ${tag}`,
    company_name_ar: 'اختبار الاستهلاك',
    address: 'Dubai',
    country_code: 'AE',
    is_tax_registered: false,
    tax_id: '',
    currency: 'AED',
    fiscal_year_start: '2025-01-01',
    warehouse_name: 'Main',
    warehouse_name_ar: 'رئيسي',
    warehouse_code: 'MAIN',
    load_sample_data: false,
  };
  const { company_id } = await runOnboarding(wizard, adapter);
  return { adapter, userClient, companyId: company_id, userId };
}

async function destroyScratch(s: Scratch | null): Promise<void> {
  if (!s) return;
  const { companyId, userId } = s;
  await admin.from('general_ledger').delete().eq('company_id', companyId);
  await admin.from('journal_entries').delete().eq('company_id', companyId);
  // phase61 tables are not in the generated types (applied by hand).
  await (admin.from('amortization_entries' as any) as any).delete().eq('company_id', companyId);
  await (admin.from('amortization_schedules' as any) as any).delete().eq('company_id', companyId);
  await admin.from('audit_logs').delete().eq('company_id', companyId);
  await admin.from('companies').delete().eq('id', companyId);
  await admin.auth.admin.deleteUser(userId).catch(() => undefined);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** A 12-month prepaid insurance schedule: 1200 over 12 months from 1 Jan. */
function prepaid(over: Partial<AmortizationScheduleInsert> = {}): AmortizationScheduleInsert {
  return {
    kind: 'prepaid_expense',
    name: 'Prepaid insurance',
    bs_account_code: '1410',
    pl_account_code: '6200',
    total_amount: 1200,
    periods: 12,
    start_date: '2025-01-01',
    ...over,
  };
}

async function getSchedule(id: string) {
  const { data } = await (admin.from('amortization_schedules' as any) as any).select('*').eq('id', id).single();
  return data as any;
}
async function getCompany(companyId: string) {
  const { data } = await admin.from('companies').select('*').eq('id', companyId).single();
  return data as any;
}
async function glForJE(jeId: string): Promise<Array<{ account_code: string; debit: number; credit: number }>> {
  const { data } = await admin.from('general_ledger')
    .select('account_code, debit, credit').eq('journal_entry_id', jeId);
  return (data ?? []).map((r: any) => ({ account_code: r.account_code, debit: Number(r.debit), credit: Number(r.credit) }));
}
/** Net (debit − credit) on an account_code — natural sign for assets/expenses. */
async function glDebitNet(companyId: string, code: string): Promise<number> {
  // `as any` — a projected + reassigned PostgREST builder collapses its generics.
  const { data } = await (admin.from('general_ledger') as any)
    .select('debit, credit').eq('company_id', companyId).eq('account_code', code);
  return (data ?? []).reduce((sum: number, r: any) => sum + (Number(r.debit) - Number(r.credit)), 0);
}
async function assertInvariants(companyId: string, asOf: string): Promise<void> {
  const { data, error } = await admin.rpc('verify_invariants', { p_company_id: companyId, p_as_of_date: asOf });
  expect(error, `verify_invariants error: ${error?.message}`).toBeFalsy();
  const checks = (data as Array<{ name: string; invariant: string; pass: boolean }>) ?? [];
  const failed = checks.filter((c) => !c.pass);
  expect(failed, `failing invariants @${asOf}: ${JSON.stringify(failed)}`).toHaveLength(0);
}
const sum = (rows: Array<{ debit: number; credit: number }>, k: 'debit' | 'credit') =>
  rows.reduce((a, r) => a + r[k], 0);

// ════════════════════════════════════════════════════════════════════════════
// G1 — Prepaid expense: posting, catch-up, idempotency (A1, A2, A3)
// ════════════════════════════════════════════════════════════════════════════
describe('AC-6A.2/G1 — prepaid expense amortizes the asset down', () => {
  let s: Scratch | null = null;
  beforeAll(async () => { s = await createScratch(); }, 60_000);
  afterAll(async () => { await destroyScratch(s); s = null; });

  it('A1: one period posts Dr expense / Cr prepaid and moves the schedule', async () => {
    const sch = await s!.adapter.amortization.create(s!.companyId, prepaid());
    const res = await s!.adapter.amortization.run('2025-01-31');
    expect(res.entries_posted).toBe(1);
    expect(res.total_amount).toBeCloseTo(100, 2);

    const entries = await s!.adapter.amortization.listEntries(sch.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ period_index: 1, period_end: '2025-01-31' });
    expect(Number(entries[0].amount)).toBeCloseTo(100, 2);
    expect(Number(entries[0].remaining_after)).toBeCloseTo(1100, 2);

    const legs = await glForJE(entries[0].journal_entry_id!);
    expect(legs.find((l) => l.account_code === '6200')!.debit).toBeCloseTo(100, 2);   // expense up
    expect(legs.find((l) => l.account_code === '1410')!.credit).toBeCloseTo(100, 2);  // prepaid down
    expect(sum(legs, 'debit')).toBeCloseTo(sum(legs, 'credit'), 2);

    const row = await getSchedule(sch.id);
    expect(Number(row.amortized_amount)).toBeCloseTo(100, 2);
    expect(row.periods_posted).toBe(1);
    expect(row.status).toBe('active');

    await assertInvariants(s!.companyId, '2025-01-31');
  }, 60_000);

  it('A2: a later run catches up every missed period in one call', async () => {
    const res = await s!.adapter.amortization.run('2025-04-30');
    expect(res.entries_posted).toBe(3);
    expect(res.total_amount).toBeCloseTo(300, 2);
    expect(await glDebitNet(s!.companyId, '6200')).toBeCloseTo(400, 2);
    expect(await glDebitNet(s!.companyId, '1410')).toBeCloseTo(-400, 2);
    await assertInvariants(s!.companyId, '2025-04-30');
  }, 60_000);

  it('A3: re-running the same period posts nothing (idempotent)', async () => {
    const before = await glDebitNet(s!.companyId, '6200');
    const res = await s!.adapter.amortization.run('2025-04-30');
    expect(res.entries_posted).toBe(0);
    expect(await glDebitNet(s!.companyId, '6200')).toBeCloseTo(before, 2);
    await assertInvariants(s!.companyId, '2025-04-30');
  }, 60_000);
});

// ════════════════════════════════════════════════════════════════════════════
// G2 — The remainder rule + completion (A4, A7)
// ════════════════════════════════════════════════════════════════════════════
describe('AC-6A.2/G2 — the final installment absorbs the remainder', () => {
  it('A4/A7: 1000 over 3 posts 333.33 / 333.33 / 333.34 and completes exactly', async () => {
    const s = await createScratch();
    try {
      const sch = await s.adapter.amortization.create(s.companyId, prepaid({
        name: 'Prepaid rent', total_amount: 1000, periods: 3,
      }));
      const res = await s.adapter.amortization.run('2025-12-31');   // well past the end
      expect(res.entries_posted).toBe(3);

      const entries = await s.adapter.amortization.listEntries(sch.id);
      expect(entries.map((e) => Number(e.amount))).toEqual([333.33, 333.33, 333.34]);
      // the whole prepayment is recognised — not a fraction left behind
      expect(await glDebitNet(s.companyId, '6200')).toBeCloseTo(1000, 2);
      expect(await glDebitNet(s.companyId, '1410')).toBeCloseTo(-1000, 2);
      expect(Number(entries[2].remaining_after)).toBeCloseTo(0, 2);

      const row = await getSchedule(sch.id);
      expect(Number(row.amortized_amount)).toBeCloseTo(1000, 2);
      expect(row.status).toBe('completed');

      // a completed schedule posts nothing further
      const again = await s.adapter.amortization.run('2026-06-30');
      expect(again.entries_posted).toBe(0);
      await assertInvariants(s.companyId, '2025-12-31');
    } finally { await destroyScratch(s); }
  }, 90_000);
});

// ════════════════════════════════════════════════════════════════════════════
// G3 — Direction per kind (A5, A6)
// ════════════════════════════════════════════════════════════════════════════
describe('AC-6A.2/G3 — each kind posts in the right direction', () => {
  it('A5: deferred revenue draws the liability down into revenue', async () => {
    const s = await createScratch();
    try {
      const sch = await s.adapter.amortization.create(s.companyId, prepaid({
        kind: 'deferred_revenue', name: 'Annual service contract',
        bs_account_code: '2500', pl_account_code: '4100',
        total_amount: 1200, periods: 12,
      }));
      await s.adapter.amortization.run('2025-01-31');
      const entries = await s.adapter.amortization.listEntries(sch.id);
      const legs = await glForJE(entries[0].journal_entry_id!);

      expect(legs.find((l) => l.account_code === '2500')!.debit).toBeCloseTo(100, 2);   // liability down
      expect(legs.find((l) => l.account_code === '4100')!.credit).toBeCloseTo(100, 2);  // revenue up
      expect(sum(legs, 'debit')).toBeCloseTo(sum(legs, 'credit'), 2);
      await assertInvariants(s.companyId, '2025-01-31');
    } finally { await destroyScratch(s); }
  }, 90_000);

  it('A6: accrued expense charges the P&L and builds the liability', async () => {
    const s = await createScratch();
    try {
      const sch = await s.adapter.amortization.create(s.companyId, prepaid({
        kind: 'accrued_expense', name: 'Accrued audit fee',
        bs_account_code: '2300', pl_account_code: '6500',
        total_amount: 600, periods: 6,
      }));
      await s.adapter.amortization.run('2025-02-28');
      const entries = await s.adapter.amortization.listEntries(sch.id);
      expect(entries).toHaveLength(2);
      const legs = await glForJE(entries[0].journal_entry_id!);

      expect(legs.find((l) => l.account_code === '6500')!.debit).toBeCloseTo(100, 2);   // expense up
      expect(legs.find((l) => l.account_code === '2300')!.credit).toBeCloseTo(100, 2);  // liability up
      expect(await glDebitNet(s.companyId, '2300')).toBeCloseTo(-200, 2);               // credit balance grows
      await assertInvariants(s.companyId, '2025-02-28');
    } finally { await destroyScratch(s); }
  }, 90_000);
});

// ════════════════════════════════════════════════════════════════════════════
// G4 — Cancellation (A8)
// ════════════════════════════════════════════════════════════════════════════
describe('AC-6A.2/G4 — cancel stops future postings only', () => {
  it('A8: recognised amounts survive; nothing further posts', async () => {
    const s = await createScratch();
    try {
      const sch = await s.adapter.amortization.create(s.companyId, prepaid());
      await s.adapter.amortization.run('2025-03-31');            // 3 × 100
      const before = await glDebitNet(s.companyId, '6200');
      expect(before).toBeCloseTo(300, 2);

      const res = await s.adapter.amortization.cancel(sch.id, 'Policy cancelled early');
      expect(res.status).toBe('cancelled');
      expect(Number(res.amortized_amount)).toBeCloseTo(300, 2);
      expect(Number(res.remaining)).toBeCloseTo(900, 2);

      const after = await s.adapter.amortization.run('2025-12-31');
      expect(after.entries_posted).toBe(0);
      expect(await glDebitNet(s.companyId, '6200')).toBeCloseTo(before, 2);  // untouched
      expect((await getSchedule(sch.id)).status).toBe('cancelled');
      await assertInvariants(s.companyId, '2025-12-31');
    } finally { await destroyScratch(s); }
  }, 90_000);
});

// ════════════════════════════════════════════════════════════════════════════
// G5 — LIFO reversal (A9)
// ════════════════════════════════════════════════════════════════════════════
describe('AC-6A.2/G5 — reversing the last installment', () => {
  it('A9: reversal flips the legs, rolls back, and the period can be re-posted', async () => {
    const s = await createScratch();
    try {
      const sch = await s.adapter.amortization.create(s.companyId, prepaid());
      await s.adapter.amortization.run('2025-03-31');   // 3 × 100

      const res = await s.adapter.amortization.reverseLast(sch.id);
      expect(Number(res.amount)).toBeCloseTo(100, 2);

      const legs = await glForJE(res.journal_entry_id);
      expect(legs.find((l) => l.account_code === '1410')!.debit).toBeCloseTo(100, 2);   // prepaid back up
      expect(legs.find((l) => l.account_code === '6200')!.credit).toBeCloseTo(100, 2);  // expense back out
      expect(sum(legs, 'debit')).toBeCloseTo(sum(legs, 'credit'), 2);

      expect(await glDebitNet(s.companyId, '6200')).toBeCloseTo(200, 2);
      const row = await getSchedule(sch.id);
      expect(Number(row.amortized_amount)).toBeCloseTo(200, 2);
      expect(row.periods_posted).toBe(2);

      // re-running re-posts exactly that one period
      const again = await s.adapter.amortization.run('2025-03-31');
      expect(again.entries_posted).toBe(1);
      expect(Number((await getSchedule(sch.id)).amortized_amount)).toBeCloseTo(300, 2);
      await assertInvariants(s.companyId, '2025-03-31');
    } finally { await destroyScratch(s); }
  }, 90_000);
});

// ════════════════════════════════════════════════════════════════════════════
// G6 — Period lock (A10)
// ════════════════════════════════════════════════════════════════════════════
describe('AC-6A.2/G6 — period lock', () => {
  it('A10: amortizing into a locked period is rejected and posts nothing', async () => {
    const s = await createScratch();
    try {
      await s.adapter.amortization.create(s.companyId, prepaid());
      await admin.from('companies').update({ period_lock_date: '2025-03-31' } as any).eq('id', s.companyId);
      await expect(s.adapter.amortization.run('2025-03-31')).rejects.toThrow(/lock|period/i);
      expect(await glDebitNet(s.companyId, '6200')).toBeCloseTo(0, 2);

      await admin.from('companies').update({ period_lock_date: null } as any).eq('id', s.companyId);
      const res = await s.adapter.amortization.run('2025-03-31');
      expect(res.entries_posted).toBe(3);
      expect((await getCompany(s.companyId)).period_lock_date ?? null).toBeNull();
      await assertInvariants(s.companyId, '2025-03-31');
    } finally { await destroyScratch(s); }
  }, 90_000);
});
