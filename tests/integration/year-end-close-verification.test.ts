/**
 * AC-1.3B — Year-End Close: behavioural (Tier B) verification suite.
 *
 * The enforced regression suite (regressions.test.ts) is read-only/service-role
 * and CANNOT drive close_fiscal_year / reopen_fiscal_year — those RPCs gate on
 * auth.uid() + current_user_company_id(), which are NULL under the service role.
 * This suite proves the *numbers*: it creates a scratch tenant, signs in as its
 * owner, seeds P&L activity with manual journal entries, runs the real
 * authenticated close/reopen RPCs, and asserts the exact GL, the period lock,
 * Retained Earnings roll-forward, and every verify_invariants identity.
 *
 * PRODUCTION SAFETY — this suite MUTATES (creates + deletes users and
 * companies). It calls assertNotProductionTarget() first in every scratch
 * setup, so it REFUSES to run against the production project (H4 P0 guard).
 * It runs only when the harness points at a non-prod (staging) Supabase project.
 * It is NOT wired into the pre-commit hook. Run explicitly:
 *     npm run test:year-end-close      (only meaningful against staging)
 *
 * Scenario coverage (docs/AC1_3_CLOSE_TEST_ANALYSIS_2026-07-24.txt):
 *   T1 profit close · T2 loss close · T3 zero-activity · T4 sequential ·
 *   T5 LIFO reopen · T6 reopen+re-close · T7 BS continuity · T8 TB balancing ·
 *   T9 P&L exclusion · T10 RE roll-forward · T11 period lock · T12 JE balancing ·
 *   T13 edge cases · T14 rollback.
 */

import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'node:path';
import type { Database } from '../../src/types/database';
import { createSupabaseAdapter } from '../../src/data/supabaseAdapter';
import { runOnboarding, type WizardData } from '../../src/core/onboarding';
import { assertNotProductionTarget } from './_env-guard';

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

/** Create a confirmed user, sign in, and onboard a fresh company. Guarded. */
async function createScratch(fiscalYearStart: string): Promise<Scratch> {
  assertNotProductionTarget(SUPABASE_URL); // H4 P0 — never against production
  const tag = `${Date.now()}-${scratchSeq++}`;
  const email = `yec-${tag}@stockbolt.test`;
  const password = `Yec!${tag}`;

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
    full_name: 'YEC Test Owner',
    company_name: `YEC Scratch ${tag}`,
    company_name_ar: 'اختبار الإقفال',
    address: 'Dubai',
    country_code: 'AE',
    is_tax_registered: false,
    tax_id: '',
    currency: 'AED',
    fiscal_year_start: fiscalYearStart,
    warehouse_name: 'Main',
    warehouse_name_ar: 'رئيسي',
    warehouse_code: 'MAIN',
    load_sample_data: false,
  };
  const { company_id } = await runOnboarding(wizard, adapter);
  return { adapter, userClient, companyId: company_id, userId };
}

/** Best-effort teardown. Deletes the rows this suite writes, then the tenant.
 *  (On a throwaway staging DB full cascade is fine; explicit child deletes keep
 *  the tenant deletable even where company_id FKs are not ON DELETE CASCADE.) */
async function destroyScratch(s: Scratch | null): Promise<void> {
  if (!s) return;
  const { companyId, userId } = s;
  await admin.from('general_ledger').delete().eq('company_id', companyId);
  await admin.from('journal_entries').delete().eq('company_id', companyId);
  // fiscal_year_closes is not in the generated types (phase56 applied by hand).
  await (admin.from('fiscal_year_closes' as any) as any).delete().eq('company_id', companyId);
  await admin.from('audit_logs').delete().eq('company_id', companyId);
  await admin.from('companies').delete().eq('id', companyId);
  await admin.auth.admin.deleteUser(userId).catch(() => undefined);
}

// ── Seeding + reading helpers (admin bypasses RLS for inspection) ────────────

/** Post a balanced income JE (Dr 1100 Cash / Cr 4100 Sales) for `amount`. */
async function seedIncome(s: Scratch, dateISO: string, amount: number, code = '4100'): Promise<void> {
  await s.adapter.accounting.postJE({
    source_type: 'manual', date: dateISO, description: `Income ${dateISO}`,
    lines: [
      { account_code: '1100', debit: amount, credit: 0 },
      { account_code: code,   debit: 0,      credit: amount },
    ],
  });
}
/** Post a balanced expense JE (Dr 6500 G&A / Cr 1100 Cash) for `amount`. */
async function seedExpense(s: Scratch, dateISO: string, amount: number, code = '6500'): Promise<void> {
  await s.adapter.accounting.postJE({
    source_type: 'manual', date: dateISO, description: `Expense ${dateISO}`,
    lines: [
      { account_code: code,   debit: amount, credit: 0 },
      { account_code: '1100', debit: 0,      credit: amount },
    ],
  });
}

async function getCompany(companyId: string) {
  const { data } = await admin.from('companies').select('*').eq('id', companyId).single();
  return data as any;
}
async function getCloseRow(companyId: string, fy: number) {
  const { data } = await admin.from('fiscal_year_closes' as any)
    .select('*').eq('company_id', companyId).eq('fiscal_year', fy).maybeSingle();
  return data as any;
}
async function glForJE(jeId: string): Promise<Array<{ account_code: string; debit: number; credit: number }>> {
  const { data } = await admin.from('general_ledger')
    .select('account_code, debit, credit').eq('journal_entry_id', jeId);
  return (data ?? []).map((r: any) => ({ account_code: r.account_code, debit: Number(r.debit), credit: Number(r.credit) }));
}
/** Net (credit − debit) on an account_code within an optional [from,to] window. */
async function glNet(companyId: string, code: string, from?: string, to?: string): Promise<number> {
  // `as any` — a projected + reassigned PostgREST builder collapses its generics.
  let q = (admin.from('general_ledger') as any)
    .select('debit, credit').eq('company_id', companyId).eq('account_code', code);
  if (from) q = q.gte('date', from);
  if (to)   q = q.lte('date', to);
  const { data } = await q;
  return (data ?? []).reduce((sum: number, r: any) => sum + (Number(r.credit) - Number(r.debit)), 0);
}
/** Assert every verify_invariants identity passes for the company as-of a date. */
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
// G1 — Profit / Loss / Zero close, in sequence (T1, T2, T3, T8, T9, T12)
// ════════════════════════════════════════════════════════════════════════════
describe('AC-1.3B/G1 — profit, loss and zero-activity closes', () => {
  let s: Scratch | null = null;
  beforeAll(async () => {
    s = await createScratch('2021-01-01');
    // FY2021 profit +60000 ; FY2022 loss −20000 ; FY2023 zero
    await seedIncome(s, '2021-06-15', 100000);
    await seedExpense(s, '2021-06-16', 40000);
    await seedIncome(s, '2022-06-15', 30000);
    await seedExpense(s, '2022-06-16', 50000);
    // FY2023: no activity
  }, 60_000);
  afterAll(async () => { await destroyScratch(s); s = null; });

  it('T1: profit year credits net profit to Retained Earnings and zeroes P&L', async () => {
    const res = await s!.adapter.accounting.closeFiscalYear(2021);
    expect(res.status).toBe('closed');
    expect(res.net_income).toBeCloseTo(60000, 2);
    expect(res.fiscal_year_end).toBe('2021-12-31');

    const row = await getCloseRow(s!.companyId, 2021);
    expect(row.status).toBe('closed');
    expect(row.je_id).toBeTruthy();
    expect(Number(row.net_income)).toBeCloseTo(60000, 2);

    const legs = await glForJE(row.je_id);
    // income 4100 zeroed by a debit; expense 6500 zeroed by a credit; RE credited.
    expect(legs.find((l) => l.account_code === '4100')!.debit).toBeCloseTo(100000, 2);
    expect(legs.find((l) => l.account_code === '6500')!.credit).toBeCloseTo(40000, 2);
    expect(legs.find((l) => l.account_code === '3100')!.credit).toBeCloseTo(60000, 2);
    expect(sum(legs, 'debit')).toBeCloseTo(sum(legs, 'credit'), 2); // T12 balanced

    // period lock advanced to fiscal_year_end
    expect((await getCompany(s!.companyId)).period_lock_date).toBe('2021-12-31');

    // T9 — P&L for the closed year still shows 60000 (year_end_close excluded),
    //      while the same window INCLUDING the close JE nets to ~0.
    const pl = await s!.adapter.reports.getProfitAndLoss(s!.companyId, '2021-01-01', '2021-12-31');
    expect(pl.net_profit).toBeCloseTo(60000, 2);
    const inclIncome = await glNet(s!.companyId, '4100', '2021-01-01', '2021-12-31');
    const inclExpense = await glNet(s!.companyId, '6500', '2021-01-01', '2021-12-31');
    expect(inclIncome + inclExpense).toBeCloseTo(0, 2); // both zeroed by the close

    await assertInvariants(s!.companyId, '2021-12-31'); // T8 + JE_BAL + BS
  });

  it('T2: loss year debits the net loss from Retained Earnings', async () => {
    const res = await s!.adapter.accounting.closeFiscalYear(2022);
    expect(res.status).toBe('closed');
    expect(res.net_income).toBeCloseTo(-20000, 2);

    const row = await getCloseRow(s!.companyId, 2022);
    const legs = await glForJE(row.je_id);
    expect(legs.find((l) => l.account_code === '4100')!.debit).toBeCloseTo(30000, 2);
    expect(legs.find((l) => l.account_code === '6500')!.credit).toBeCloseTo(50000, 2);
    expect(legs.find((l) => l.account_code === '3100')!.debit).toBeCloseTo(20000, 2); // loss ← RE
    expect(sum(legs, 'debit')).toBeCloseTo(sum(legs, 'credit'), 2);

    expect((await getCompany(s!.companyId)).period_lock_date).toBe('2022-12-31');
    await assertInvariants(s!.companyId, '2022-12-31');
  });

  it('T3: zero-activity year closes with no journal entry', async () => {
    const res = await s!.adapter.accounting.closeFiscalYear(2023);
    expect(res.status).toBe('closed');
    expect(res.net_income).toBeCloseTo(0, 2);
    expect(res.journal_entry_id ?? null).toBeNull();

    const row = await getCloseRow(s!.companyId, 2023);
    expect(row.status).toBe('closed');
    expect(row.je_id ?? null).toBeNull(); // no JE for a break-even/empty year

    // lock still advances even with no JE
    expect((await getCompany(s!.companyId)).period_lock_date).toBe('2023-12-31');
    await assertInvariants(s!.companyId, '2023-12-31');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G2 — Sequential closing guard (T4)
// ════════════════════════════════════════════════════════════════════════════
describe('AC-1.3B/G2 — sequential closing', () => {
  let s: Scratch | null = null;
  beforeAll(async () => {
    s = await createScratch('2021-01-01');
    await seedIncome(s, '2021-06-15', 50000);   // FY2021 has activity
    await seedIncome(s, '2022-06-15', 70000);   // FY2022 has activity
  }, 60_000);
  afterAll(async () => { await destroyScratch(s); s = null; });

  it('T4: cannot close FY2022 while FY2021 is open and had activity', async () => {
    await expect(s!.adapter.accounting.closeFiscalYear(2022)).rejects.toThrow(/must be closed in order/i);
  });

  it('T4: closing FY2021 then FY2022 succeeds in order', async () => {
    const a = await s!.adapter.accounting.closeFiscalYear(2021);
    expect(a.status).toBe('closed');
    const b = await s!.adapter.accounting.closeFiscalYear(2022);
    expect(b.status).toBe('closed');
    await assertInvariants(s!.companyId, '2022-12-31');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G3 — LIFO reopen + reopen/re-close (T5, T6)
// ════════════════════════════════════════════════════════════════════════════
describe('AC-1.3B/G3 — LIFO reopen and re-close', () => {
  let s: Scratch | null = null;
  beforeAll(async () => {
    s = await createScratch('2021-01-01');
    await seedIncome(s, '2021-06-15', 40000);
    await seedExpense(s, '2021-06-16', 10000);   // FY2021 +30000
    await seedIncome(s, '2022-06-15', 90000);
    await seedExpense(s, '2022-06-16', 40000);   // FY2022 +50000
    await s.adapter.accounting.closeFiscalYear(2021);
    await s.adapter.accounting.closeFiscalYear(2022);
  }, 60_000);
  afterAll(async () => { await destroyScratch(s); s = null; });

  it('T5: cannot reopen FY2021 while FY2022 is still closed (LIFO)', async () => {
    await expect(s!.adapter.accounting.reopenFiscalYear(2021)).rejects.toThrow(/reverse order|later fiscal years first/i);
  });

  it('T6: reopen FY2022 reverses its close JE and rolls the lock back', async () => {
    const before = await getCloseRow(s!.companyId, 2022);
    const res = await s!.adapter.accounting.reopenFiscalYear(2022);
    expect(res.status).toBe('reopened');

    const row = await getCloseRow(s!.companyId, 2022);
    expect(row.status).toBe('reopened');
    // the original close JE is now reversed
    const { data: je } = await admin.from('journal_entries').select('reversed_by_id').eq('id', before.je_id).single();
    expect((je as any).reversed_by_id).toBeTruthy();
    // lock rolled back to prior_lock_date (the 2021 close left it at 2021-12-31)
    expect((await getCompany(s!.companyId)).period_lock_date).toBe(before.prior_lock_date);
    expect((await getCompany(s!.companyId)).period_lock_date).toBe('2021-12-31');
    await assertInvariants(s!.companyId, '2022-12-31');
  });

  it('T6: re-closing FY2022 posts a NEW close JE and re-advances the lock', async () => {
    const prev = await getCloseRow(s!.companyId, 2022);
    const res = await s!.adapter.accounting.closeFiscalYear(2022);
    expect(res.status).toBe('closed');
    expect(res.net_income).toBeCloseTo(50000, 2);

    const row = await getCloseRow(s!.companyId, 2022);
    expect(row.status).toBe('closed');
    expect(row.je_id).toBeTruthy();
    expect(row.je_id).not.toBe(prev.je_id); // a fresh JE, not the reversed one
    expect((await getCompany(s!.companyId)).period_lock_date).toBe('2022-12-31');
    await assertInvariants(s!.companyId, '2022-12-31');
  });

  it('T5: after re-close, reopening in strict reverse order works', async () => {
    await expect(s!.adapter.accounting.reopenFiscalYear(2022)).resolves.toMatchObject({ status: 'reopened' });
    await expect(s!.adapter.accounting.reopenFiscalYear(2021)).resolves.toMatchObject({ status: 'reopened' });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G4 — Balance Sheet continuity + Retained Earnings roll-forward (T7, T10)
// ════════════════════════════════════════════════════════════════════════════
describe('AC-1.3B/G4 — balance sheet continuity + RE roll-forward', () => {
  let s: Scratch | null = null;
  beforeAll(async () => {
    s = await createScratch('2021-01-01');
    await seedIncome(s, '2021-03-15', 100000);
    await seedExpense(s, '2021-03-16', 30000);   // FY2021 +70000
    await seedIncome(s, '2022-03-15', 60000);
    await seedExpense(s, '2022-03-16', 20000);   // FY2022 +40000
  }, 60_000);
  afterAll(async () => { await destroyScratch(s); s = null; });

  const eqSum = (bs: { lines: Array<{ account_type: string; balance: number }> }, type: string) =>
    bs.lines.filter((l) => l.account_type === type).reduce((a, l) => a + l.balance, 0);
  const re = (bs: { lines: Array<{ account_code: string; balance: number }> }) =>
    bs.lines.find((l) => l.account_code === '3100')?.balance ?? 0;

  it('T7: closing FY2021 conserves assets/equity and rolls net profit into RE', async () => {
    const bsBefore = await s!.adapter.reports.getBalanceSheet(s!.companyId, '2021-12-31');
    const assetsBefore = eqSum(bsBefore, 'asset');
    const equityBefore = eqSum(bsBefore, 'equity');
    const reBefore = re(bsBefore);

    await s!.adapter.accounting.closeFiscalYear(2021);

    const bsAfter = await s!.adapter.reports.getBalanceSheet(s!.companyId, '2021-12-31');
    expect(eqSum(bsAfter, 'asset')).toBeCloseTo(assetsBefore, 2);   // assets untouched
    expect(eqSum(bsAfter, 'equity')).toBeCloseTo(equityBefore, 2);  // total equity conserved
    expect(re(bsAfter) - reBefore).toBeCloseTo(70000, 2);           // RE up by net profit
    await assertInvariants(s!.companyId, '2021-12-31');
  });

  it('T10: multi-year RE == Σ closed net_income', async () => {
    await s!.adapter.accounting.closeFiscalYear(2022);
    // 3100 movement from year-end-close postings == 70000 + 40000
    const reMove = await glNet(s!.companyId, '3100'); // credit − debit, all-time
    expect(reMove).toBeCloseTo(110000, 2);
    const closes = await s!.adapter.accounting.listFiscalYearCloses(s!.companyId);
    const sumNi = closes.filter((c) => c.status === 'closed').reduce((a, c) => a + Number(c.net_income), 0);
    expect(sumNi).toBeCloseTo(110000, 2);
    await assertInvariants(s!.companyId, '2022-12-31');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G5 — Period lock behaviour (T11)
// ════════════════════════════════════════════════════════════════════════════
describe('AC-1.3B/G5 — period lock', () => {
  let s: Scratch | null = null;
  beforeAll(async () => {
    s = await createScratch('2021-01-01');
    await seedIncome(s, '2021-06-15', 50000);
    await s.adapter.accounting.closeFiscalYear(2021);
  }, 60_000);
  afterAll(async () => { await destroyScratch(s); s = null; });

  it('T11: posting into the closed year is rejected; reopen re-allows it', async () => {
    // lock is 2021-12-31 → a JE dated inside 2021 must be refused
    await expect(seedIncome(s!, '2021-08-01', 1000)).rejects.toThrow(/lock|period|closed/i);

    await s!.adapter.accounting.reopenFiscalYear(2021); // rolls lock back
    await expect(seedIncome(s!, '2021-08-01', 1000)).resolves.toBeUndefined(); // now allowed
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G6 — Edge cases (T13)
// ════════════════════════════════════════════════════════════════════════════
describe('AC-1.3B/G6 — edge cases', () => {
  // T13c — fiscal year not ended yet
  it('T13c: closing a year that has not ended is rejected', async () => {
    const s = await createScratch('2021-01-01');
    try {
      const futureYear = new Date().getUTCFullYear() + 1;
      await expect(s.adapter.accounting.closeFiscalYear(futureYear)).rejects.toThrow(/not ended/i);
    } finally { await destroyScratch(s); }
  }, 60_000);

  // T13b — Retained Earnings 3100 missing
  it('T13b: closing without a Retained Earnings 3100 account is rejected', async () => {
    const s = await createScratch('2021-01-01');
    try {
      await seedIncome(s, '2021-06-15', 40000);
      // rename 3100 out of the way so the lookup fails (avoids system-account delete guards)
      await admin.from('chart_of_accounts').update({ code: '3199' } as any)
        .eq('company_id', s.companyId).eq('code', '3100');
      await expect(s.adapter.accounting.closeFiscalYear(2021)).rejects.toThrow(/Retained Earnings account 3100 not found/i);
    } finally { await destroyScratch(s); }
  }, 60_000);

  // T13d — already closed (idempotency)
  it('T13d: closing an already-closed year is rejected', async () => {
    const s = await createScratch('2021-01-01');
    try {
      await seedIncome(s, '2021-06-15', 40000);
      await s.adapter.accounting.closeFiscalYear(2021);
      await expect(s.adapter.accounting.closeFiscalYear(2021)).rejects.toThrow(/already closed/i);
    } finally { await destroyScratch(s); }
  }, 60_000);

  // T13f — non-January fiscal year boundary
  it('T13f: a non-January fiscal year closes over the correct window', async () => {
    const s = await createScratch('2021-04-01'); // FY2021 = 2021-04-01 .. 2022-03-31
    try {
      await seedIncome(s, '2021-09-15', 80000);   // inside FY2021
      await seedExpense(s, '2022-01-15', 30000);   // still inside FY2021
      const res = await s.adapter.accounting.closeFiscalYear(2021);
      expect(res.status).toBe('closed');
      expect(res.fiscal_year_end).toBe('2022-03-31');
      expect(res.net_income).toBeCloseTo(50000, 2);
      const row = await getCloseRow(s.companyId, 2021);
      expect(row.fiscal_year_start).toBe('2021-04-01');
      expect(row.fiscal_year_end).toBe('2022-03-31');
      const legs = await glForJE(row.je_id);
      expect(sum(legs, 'debit')).toBeCloseTo(sum(legs, 'credit'), 2);
      await assertInvariants(s.companyId, '2022-03-31');
    } finally { await destroyScratch(s); }
  }, 60_000);

  // T13a — a contra / ARCHIVED income account with activity is still zeroed
  it('T13a: an archived P&L account is still zeroed by the close', async () => {
    const s = await createScratch('2021-01-01');
    try {
      await seedIncome(s, '2021-06-15', 25000, '4200'); // Other Income
      // archive 4200 after it has activity
      await admin.from('chart_of_accounts').update({ is_active: false } as any)
        .eq('company_id', s.companyId).eq('code', '4200');
      const res = await s.adapter.accounting.closeFiscalYear(2021);
      expect(res.status).toBe('closed');
      const legs = await glForJE((await getCloseRow(s.companyId, 2021)).je_id);
      // the close builds legs by account_id, so the archived account is zeroed
      expect(legs.find((l) => l.account_code === '4200')?.debit).toBeCloseTo(25000, 2);
      expect(sum(legs, 'debit')).toBeCloseTo(sum(legs, 'credit'), 2);
    } finally { await destroyScratch(s); }
  }, 60_000);

  // T13e — two concurrent first-closes of the same year.
  //
  // STAGING-VALIDATION ONLY — skipped, NOT a proven invariant. The close RPC's
  // idempotency rests on a read-check (SELECT ... FOR UPDATE at step 4.4) that a
  // *first*-close race can slip past, because step 4.8 is INSERT ... ON CONFLICT
  // DO UPDATE (not a hard reject). It is currently UNKNOWN whether two concurrent
  // first-closes produce two active year_end_close JEs (a double-post) or are
  // serialized safely. Enable this on staging (INFRA-1) to find out: if it fails,
  // the engine needs strengthening (e.g. a pg_advisory_xact_lock on
  // (company_id, fiscal_year), or pre-inserting a 'draft' row before the JE).
  // Until then we neither assert the invariant holds nor let a maybe-false
  // expectation fail the suite.
  it.skip('T13e (staging-validation): concurrent double-close — verify no double-post JE', async () => {
    const s = await createScratch('2021-01-01');
    try {
      await seedIncome(s, '2021-06-15', 40000);
      const results = await Promise.allSettled([
        s.adapter.accounting.closeFiscalYear(2021),
        s.adapter.accounting.closeFiscalYear(2021),
      ]);
      const ok = results.filter((r) => r.status === 'fulfilled');
      const { data } = await admin.from('journal_entries')
        .select('id').eq('company_id', s.companyId)
        .eq('source_type', 'year_end_close').is('reversal_of_id', null).is('reversed_by_id', null);
      // The desired behaviour (to be confirmed on staging): exactly one active
      // close JE, and exactly one of the two concurrent calls succeeds.
      expect((data ?? []).length,
        'exactly one active close JE for the fiscal year (double-post race)').toBe(1);
      expect(ok.length,
        'exactly one concurrent close should succeed').toBe(1);
    } finally { await destroyScratch(s); }
  }, 60_000);
});

// ════════════════════════════════════════════════════════════════════════════
// G7 — Rollback: reopen fully reverses (T14)
// ════════════════════════════════════════════════════════════════════════════
describe('AC-1.3B/G7 — reopen fully reverses (rollback)', () => {
  let s: Scratch | null = null;
  beforeAll(async () => {
    s = await createScratch('2021-01-01');
    await seedIncome(s, '2021-06-15', 100000);
    await seedExpense(s, '2021-06-16', 45000);   // +55000
  }, 60_000);
  afterAll(async () => { await destroyScratch(s); s = null; });

  it('T14: close then reopen nets every account (incl 3100) back to pre-close', async () => {
    const reBefore = await glNet(s!.companyId, '3100');            // 0 pre-close
    const income2021 = await glNet(s!.companyId, '4100', '2021-01-01', '2021-12-31');
    const expense2021 = await glNet(s!.companyId, '6500', '2021-01-01', '2021-12-31');

    await s!.adapter.accounting.closeFiscalYear(2021);
    await s!.adapter.accounting.reopenFiscalYear(2021);

    // 3100 net returns to its pre-close value (close leg + its reversal cancel)
    expect(await glNet(s!.companyId, '3100')).toBeCloseTo(reBefore, 2);
    // income/expense windows return to their original (pre-close) net
    expect(await glNet(s!.companyId, '4100', '2021-01-01', '2021-12-31')).toBeCloseTo(income2021, 2);
    expect(await glNet(s!.companyId, '6500', '2021-01-01', '2021-12-31')).toBeCloseTo(expense2021, 2);
    // lock unwound; books still internally consistent
    expect((await getCompany(s!.companyId)).period_lock_date ?? null).toBeNull();
    await assertInvariants(s!.companyId, '2021-12-31');
  });
});
