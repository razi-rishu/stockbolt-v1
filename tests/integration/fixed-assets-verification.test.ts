/**
 * AC-5A.2 — Fixed assets + depreciation: behavioural verification suite.
 *
 * The enforced regression suite (regressions.test.ts) is read-only/service-role
 * and CANNOT drive run_depreciation / dispose_fixed_asset — those RPCs gate on
 * auth.uid() + current_user_company_id(), which are NULL under the service role.
 * This suite proves the *numbers*: it creates a scratch tenant, signs in as its
 * owner, registers assets, runs the real authenticated RPCs, and asserts the
 * exact GL legs, the running accumulated depreciation, the salvage cap, the
 * disposal gain/loss, idempotency, the period lock, and every verify_invariants
 * identity (so the Trial Balance still nets to zero after every post).
 *
 * PRODUCTION SAFETY — this suite MUTATES (creates + deletes users, companies,
 * assets and journal entries). It calls assertNotProductionTarget() first in
 * every scratch setup, so it REFUSES to run against the production project
 * (H4 P0 guard). It runs only when the harness points at a non-prod (staging)
 * Supabase project. It is NOT wired into the pre-commit hook. Run explicitly:
 *     npm run test:fixed-assets      (only meaningful against staging)
 *
 * Requires phase60 (AC-5A) to be applied to the target database.
 *
 * Scenario coverage:
 *   F1  straight-line month posts Dr 6750 / Cr 1790 and moves the asset
 *   F2  multi-month catch-up in one run
 *   F3  re-running the same period posts nothing (idempotent)
 *   F4  pro-rata in the acquisition month
 *   F5  salvage cap → never below salvage, status fully_depreciated
 *   F6  reducing-balance (WDV) charges on the declining book value
 *   F7  disposal at a gain → 4250; books cost + accum out
 *   F8  disposal at a loss → 6910
 *   F9  LIFO reversal rolls back the last month
 *   F10 period lock blocks depreciating into a locked period
 */

import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'node:path';
import type { Database } from '../../src/types/database';
import { createSupabaseAdapter } from '../../src/data/supabaseAdapter';
import { runOnboarding, type WizardData } from '../../src/core/onboarding';
import { assertNotProductionTarget } from './_env-guard';
import type { FixedAssetInsert } from '../../src/data/adapter';

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
async function createScratch(): Promise<Scratch> {
  assertNotProductionTarget(SUPABASE_URL); // H4 P0 — never against production
  const tag = `${Date.now()}-${scratchSeq++}`;
  const email = `fa-${tag}@stockbolt.test`;
  const password = `Fa!${tag}`;

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
    full_name: 'FA Test Owner',
    company_name: `FA Scratch ${tag}`,
    company_name_ar: 'اختبار الأصول',
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

/** Best-effort teardown of everything this suite writes, then the tenant. */
async function destroyScratch(s: Scratch | null): Promise<void> {
  if (!s) return;
  const { companyId, userId } = s;
  await admin.from('general_ledger').delete().eq('company_id', companyId);
  await admin.from('journal_entries').delete().eq('company_id', companyId);
  // phase60 tables are not in the generated types (applied by hand).
  await (admin.from('depreciation_entries' as any) as any).delete().eq('company_id', companyId);
  await (admin.from('fixed_assets' as any) as any).delete().eq('company_id', companyId);
  await admin.from('audit_logs').delete().eq('company_id', companyId);
  await admin.from('companies').delete().eq('id', companyId);
  await admin.auth.admin.deleteUser(userId).catch(() => undefined);
}

// ── Helpers (admin bypasses RLS for inspection) ──────────────────────────────

/** A straight-line asset: 12 000 over 12 months, no salvage, in service 1 Jan. */
function slAsset(over: Partial<FixedAssetInsert> = {}): FixedAssetInsert {
  return {
    name: 'Delivery Van',
    category: 'Motor Vehicles',
    acquisition_date: '2025-01-01',
    in_service_date: '2025-01-01',
    cost: 12000,
    salvage_value: 0,
    useful_life_months: 12,
    method: 'straight_line',
    wdv_rate: 0,
    asset_account_code: '1730',
    accum_dep_account_code: '1790',
    expense_account_code: '6750',
    ...over,
  };
}

async function getAsset(id: string) {
  const { data } = await (admin.from('fixed_assets' as any) as any).select('*').eq('id', id).single();
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
/** Assert every verify_invariants identity passes (incl. the Trial Balance). */
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
// G1 — Straight-line posting, catch-up, idempotency (F1, F2, F3)
// ════════════════════════════════════════════════════════════════════════════
describe('AC-5A.2/G1 — straight-line depreciation posts and accumulates', () => {
  let s: Scratch | null = null;
  beforeAll(async () => { s = await createScratch(); }, 60_000);
  afterAll(async () => { await destroyScratch(s); s = null; });

  it('F1: one month posts Dr 6750 / Cr 1790 and moves the asset', async () => {
    const asset = await s!.adapter.fixedAssets.create(s!.companyId, slAsset());
    const res = await s!.adapter.fixedAssets.runDepreciation('2025-01-31');
    expect(res.entries_posted).toBe(1);
    expect(res.total_charge).toBeCloseTo(1000, 2);

    const entries = await s!.adapter.fixedAssets.listEntries(asset.id);
    expect(entries).toHaveLength(1);
    expect(Number(entries[0].charge)).toBeCloseTo(1000, 2);
    expect(entries[0].period_end).toBe('2025-01-31');
    expect(Number(entries[0].book_value_after)).toBeCloseTo(11000, 2);

    // the exact GL legs
    const legs = await glForJE(entries[0].journal_entry_id!);
    expect(legs.find((l) => l.account_code === '6750')!.debit).toBeCloseTo(1000, 2);
    expect(legs.find((l) => l.account_code === '1790')!.credit).toBeCloseTo(1000, 2);
    expect(sum(legs, 'debit')).toBeCloseTo(sum(legs, 'credit'), 2); // balanced

    const row = await getAsset(asset.id);
    expect(Number(row.accumulated_depreciation)).toBeCloseTo(1000, 2);
    expect(row.last_depreciated_period).toBe('2025-01-31');
    expect(row.status).toBe('active');

    await assertInvariants(s!.companyId, '2025-01-31'); // Trial Balance still nets 0
  }, 60_000);

  it('F2: a later run catches up every missed month in one call', async () => {
    const res = await s!.adapter.fixedAssets.runDepreciation('2025-04-30');
    expect(res.entries_posted).toBe(3);                       // Feb, Mar, Apr
    expect(res.total_charge).toBeCloseTo(3000, 2);

    // 4 months booked: expense 4000 debit, accumulated 4000 credit
    expect(await glDebitNet(s!.companyId, '6750')).toBeCloseTo(4000, 2);
    expect(await glDebitNet(s!.companyId, '1790')).toBeCloseTo(-4000, 2);
    await assertInvariants(s!.companyId, '2025-04-30');
  }, 60_000);

  it('F3: re-running the same period posts nothing (idempotent)', async () => {
    const before = await glDebitNet(s!.companyId, '6750');
    const res = await s!.adapter.fixedAssets.runDepreciation('2025-04-30');
    expect(res.entries_posted).toBe(0);
    expect(res.total_charge).toBeCloseTo(0, 2);
    expect(await glDebitNet(s!.companyId, '6750')).toBeCloseTo(before, 2);
    await assertInvariants(s!.companyId, '2025-04-30');
  }, 60_000);
});

// ════════════════════════════════════════════════════════════════════════════
// G2 — Pro-rata + salvage cap (F4, F5)
// ════════════════════════════════════════════════════════════════════════════
describe('AC-5A.2/G2 — pro-rata acquisition month and the salvage floor', () => {
  it('F4: the acquisition month is pro-rated by days in service', async () => {
    const s = await createScratch();
    try {
      // in service 16 Jan → 16 of 31 days → 1000 × 16/31 = 516.13
      const asset = await s.adapter.fixedAssets.create(s.companyId, slAsset({ in_service_date: '2025-01-16' }));
      const res = await s.adapter.fixedAssets.runDepreciation('2025-01-31');
      expect(res.entries_posted).toBe(1);
      expect(res.total_charge).toBeCloseTo(516.13, 2);

      // the following full month is the undiscounted charge
      const res2 = await s.adapter.fixedAssets.runDepreciation('2025-02-28');
      expect(res2.total_charge).toBeCloseTo(1000, 2);
      expect(Number((await getAsset(asset.id)).accumulated_depreciation)).toBeCloseTo(1516.13, 2);
      await assertInvariants(s.companyId, '2025-02-28');
    } finally { await destroyScratch(s); }
  }, 90_000);

  it('F5: never depreciates below salvage; the asset ends fully_depreciated', async () => {
    const s = await createScratch();
    try {
      // cost 1000, salvage 100, 3 months → depreciable base 900 (300/mo)
      const asset = await s.adapter.fixedAssets.create(s.companyId, slAsset({
        name: 'Racking', cost: 1000, salvage_value: 100, useful_life_months: 3, asset_account_code: '1750',
      }));
      // run well past the life — the engine must stop at the salvage floor
      const res = await s.adapter.fixedAssets.runDepreciation('2025-12-31');
      expect(res.total_charge).toBeCloseTo(900, 2);

      const row = await getAsset(asset.id);
      expect(Number(row.accumulated_depreciation)).toBeCloseTo(900, 2);
      expect(Number(row.cost) - Number(row.accumulated_depreciation)).toBeCloseTo(100, 2); // book == salvage
      expect(row.status).toBe('fully_depreciated');

      // total expense booked never exceeds the depreciable base
      expect(await glDebitNet(s.companyId, '6750')).toBeCloseTo(900, 2);
      await assertInvariants(s.companyId, '2025-12-31');
    } finally { await destroyScratch(s); }
  }, 90_000);
});

// ════════════════════════════════════════════════════════════════════════════
// G3 — Reducing balance / WDV (F6)
// ════════════════════════════════════════════════════════════════════════════
describe('AC-5A.2/G3 — reducing-balance (WDV)', () => {
  it('F6: charges the annual rate / 12 on the declining book value', async () => {
    const s = await createScratch();
    try {
      // 10 000 @ 12%/yr → month 1 = 100, month 2 = 1% of 9 900 = 99
      const asset = await s.adapter.fixedAssets.create(s.companyId, slAsset({
        name: 'Diagnostic Rig', cost: 10000, salvage_value: 0, useful_life_months: 120,
        method: 'reducing_balance', wdv_rate: 12, asset_account_code: '1750',
      }));
      const m1 = await s.adapter.fixedAssets.runDepreciation('2025-01-31');
      expect(m1.total_charge).toBeCloseTo(100, 2);
      const m2 = await s.adapter.fixedAssets.runDepreciation('2025-02-28');
      expect(m2.total_charge).toBeCloseTo(99, 2);

      const entries = await s.adapter.fixedAssets.listEntries(asset.id);
      expect(entries.map((e) => Number(e.charge))).toEqual([100, 99]);
      expect(Number((await getAsset(asset.id)).accumulated_depreciation)).toBeCloseTo(199, 2);
      await assertInvariants(s.companyId, '2025-02-28');
    } finally { await destroyScratch(s); }
  }, 90_000);
});

// ════════════════════════════════════════════════════════════════════════════
// G4 — Disposal at a gain and at a loss (F7, F8)
// ════════════════════════════════════════════════════════════════════════════
describe('AC-5A.2/G4 — disposal books cost, accumulated depreciation and gain/loss', () => {
  it('F7: proceeds above book value credit 4250 Gain on Asset Disposal', async () => {
    const s = await createScratch();
    try {
      const asset = await s.adapter.fixedAssets.create(s.companyId, slAsset());
      await s.adapter.fixedAssets.runDepreciation('2025-03-31');      // 3 × 1000 = 3000
      const before = await getAsset(asset.id);
      const book = Number(before.cost) - Number(before.accumulated_depreciation); // 9000

      const res = await s.adapter.fixedAssets.dispose({
        asset_id: asset.id, disposal_date: '2025-04-15',
        proceeds: 10000, proceeds_account_code: '1100',            // cash
      });
      expect(res.status).toBe('disposed');
      expect(res.gain_loss).toBeCloseTo(10000 - book, 2);           // +1000 gain

      const legs = await glForJE(res.journal_entry_id);
      expect(legs.find((l) => l.account_code === '1790')!.debit).toBeCloseTo(3000, 2);   // accum out
      expect(legs.find((l) => l.account_code === '1100')!.debit).toBeCloseTo(10000, 2);  // proceeds in
      expect(legs.find((l) => l.account_code === '1730')!.credit).toBeCloseTo(12000, 2); // cost out
      expect(legs.find((l) => l.account_code === '4250')!.credit).toBeCloseTo(1000, 2);  // gain
      expect(sum(legs, 'debit')).toBeCloseTo(sum(legs, 'credit'), 2);

      // the asset and its accumulated depreciation are fully removed from the books
      expect(await glDebitNet(s.companyId, '1790')).toBeCloseTo(0, 2);
      const row = await getAsset(asset.id);
      expect(row.status).toBe('disposed');
      expect(row.disposal_date).toBe('2025-04-15');
      await assertInvariants(s.companyId, '2025-04-30');
    } finally { await destroyScratch(s); }
  }, 90_000);

  it('F8: proceeds below book value debit 6910 Loss on Asset Disposal', async () => {
    const s = await createScratch();
    try {
      const asset = await s.adapter.fixedAssets.create(s.companyId, slAsset());
      await s.adapter.fixedAssets.runDepreciation('2025-03-31');      // book 9000
      const res = await s.adapter.fixedAssets.dispose({
        asset_id: asset.id, disposal_date: '2025-04-15',
        proceeds: 6500, proceeds_account_code: '1100',
      });
      expect(res.gain_loss).toBeCloseTo(-2500, 2);

      const legs = await glForJE(res.journal_entry_id);
      expect(legs.find((l) => l.account_code === '6910')!.debit).toBeCloseTo(2500, 2);
      expect(legs.find((l) => l.account_code === '1730')!.credit).toBeCloseTo(12000, 2);
      expect(sum(legs, 'debit')).toBeCloseTo(sum(legs, 'credit'), 2);
      await assertInvariants(s.companyId, '2025-04-30');
    } finally { await destroyScratch(s); }
  }, 90_000);

  it('F8b: a disposed asset is skipped by later depreciation runs', async () => {
    const s = await createScratch();
    try {
      const asset = await s.adapter.fixedAssets.create(s.companyId, slAsset());
      await s.adapter.fixedAssets.runDepreciation('2025-02-28');
      await s.adapter.fixedAssets.dispose({
        asset_id: asset.id, disposal_date: '2025-03-10', proceeds: 0, proceeds_account_code: '1100',
      });
      const after = await s.adapter.fixedAssets.runDepreciation('2025-06-30');
      expect(after.entries_posted).toBe(0);
      await assertInvariants(s.companyId, '2025-06-30');
    } finally { await destroyScratch(s); }
  }, 90_000);
});

// ════════════════════════════════════════════════════════════════════════════
// G5 — LIFO reversal (F9)
// ════════════════════════════════════════════════════════════════════════════
describe('AC-5A.2/G5 — reversing the last depreciation', () => {
  it('F9: reversal posts the opposite legs and rolls the asset back', async () => {
    const s = await createScratch();
    try {
      const asset = await s.adapter.fixedAssets.create(s.companyId, slAsset());
      await s.adapter.fixedAssets.runDepreciation('2025-03-31');   // 3000 over 3 months

      const res = await s.adapter.fixedAssets.reverseLast(asset.id);
      expect(res.charge).toBeCloseTo(1000, 2);

      const legs = await glForJE(res.journal_entry_id);
      expect(legs.find((l) => l.account_code === '1790')!.debit).toBeCloseTo(1000, 2);  // accum back out
      expect(legs.find((l) => l.account_code === '6750')!.credit).toBeCloseTo(1000, 2); // expense back out
      expect(sum(legs, 'debit')).toBeCloseTo(sum(legs, 'credit'), 2);

      // net position is back to two months
      expect(await glDebitNet(s.companyId, '6750')).toBeCloseTo(2000, 2);
      const row = await getAsset(asset.id);
      expect(Number(row.accumulated_depreciation)).toBeCloseTo(2000, 2);
      expect(row.last_depreciated_period).toBe('2025-02-28');

      // re-running the period re-posts the reversed month exactly once
      const again = await s.adapter.fixedAssets.runDepreciation('2025-03-31');
      expect(again.entries_posted).toBe(1);
      expect(Number((await getAsset(asset.id)).accumulated_depreciation)).toBeCloseTo(3000, 2);
      await assertInvariants(s.companyId, '2025-03-31');
    } finally { await destroyScratch(s); }
  }, 90_000);
});

// ════════════════════════════════════════════════════════════════════════════
// G6 — Period lock (F10)
// ════════════════════════════════════════════════════════════════════════════
describe('AC-5A.2/G6 — period lock', () => {
  it('F10: depreciating into a locked period is rejected', async () => {
    const s = await createScratch();
    try {
      await s.adapter.fixedAssets.create(s.companyId, slAsset());
      // lock through March — a January..March charge must be refused
      await admin.from('companies').update({ period_lock_date: '2025-03-31' } as any).eq('id', s.companyId);
      await expect(s.adapter.fixedAssets.runDepreciation('2025-03-31')).rejects.toThrow(/lock|period/i);

      // nothing was posted
      expect(await glDebitNet(s.companyId, '6750')).toBeCloseTo(0, 2);

      // after clearing the lock the same run succeeds
      await admin.from('companies').update({ period_lock_date: null } as any).eq('id', s.companyId);
      const res = await s.adapter.fixedAssets.runDepreciation('2025-03-31');
      expect(res.entries_posted).toBe(3);
      expect((await getCompany(s.companyId)).period_lock_date ?? null).toBeNull();
      await assertInvariants(s.companyId, '2025-03-31');
    } finally { await destroyScratch(s); }
  }, 90_000);
});
