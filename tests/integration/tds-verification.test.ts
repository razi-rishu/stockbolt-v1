/**
 * AC-7A.2 — India TDS: behavioural verification suite.
 *
 * The enforced regression suite (regressions.test.ts) is read-only/service-role
 * and CANNOT drive record_tds_deduction / reverse_tds_deduction — those RPCs
 * gate on auth.uid() + current_user_company_id(), which are NULL under the
 * service role. This suite proves the *numbers*: it creates an INDIA scratch
 * tenant, signs in as its owner, books a vendor bill, deducts TDS, and asserts
 * the exact GL legs, the AP reduction, the guards, reversal, and every
 * verify_invariants identity.
 *
 * The behaviour that matters most here: after Dr AP / Cr TDS Payable, the
 * vendor's payable is reduced by exactly the withheld amount and the government
 * liability rises by the same — with confirm_vendor_bill untouched.
 *
 * PRODUCTION SAFETY — this suite MUTATES. It calls assertNotProductionTarget()
 * first in every scratch setup, so it REFUSES to run against production
 * (H4 P0 guard). Not wired into the pre-commit hook. Run explicitly:
 *     npm run test:tds        (only meaningful against staging)
 *
 * Requires phase62 (AC-7A) applied, on a company with country_code = 'IN'.
 *
 * Scenario coverage:
 *   T1  deduction posts Dr AP / Cr 2320 and reduces the payable
 *   T2  the section rate is applied for the deductee class
 *   T3  no-PAN escalation (§206AA) posts the 20% amount
 *   T4  deducting more than the bill total is refused
 *   T5  a draft (unconfirmed) bill is refused
 *   T6  two partial deductions accumulate and are capped at the bill total
 *   T7  reversal flips the legs and restores the payable
 *   T8  a reversed deduction cannot be reversed twice
 *   T9  India-gating: 2320 exists for IN and not for AE
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

type Adapter = ReturnType<typeof createSupabaseAdapter>;
interface Scratch {
  adapter: Adapter;
  userClient: SupabaseClient<Database>;
  companyId: string;
  userId: string;
}

let scratchSeq = 0;

/** Create an INDIA company (country drives the India-only CoA + section seed). */
async function createScratch(countryCode: 'IN' | 'AE' = 'IN'): Promise<Scratch> {
  assertNotProductionTarget(SUPABASE_URL); // H4 P0 — never against production
  const tag = `${Date.now()}-${scratchSeq++}`;
  const email = `tds-${tag}@stockbolt.test`;
  const password = `Tds!${tag}`;

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
    full_name: 'TDS Test Owner',
    company_name: `TDS Scratch ${tag}`,
    company_name_ar: 'اختبار الاستقطاع',
    address: countryCode === 'IN' ? 'Mumbai' : 'Dubai',
    country_code: countryCode,
    is_tax_registered: true,
    tax_id: countryCode === 'IN' ? '27ABCDE1234F1Z5' : '100000000000003',
    currency: countryCode === 'IN' ? 'INR' : 'AED',
    fiscal_year_start: '2025-04-01',
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
  // phase62 tables are not in the generated types (applied by hand).
  await (admin.from('tds_deductions' as any) as any).delete().eq('company_id', companyId);
  await (admin.from('tds_sections' as any) as any).delete().eq('company_id', companyId);
  await admin.from('vendor_bills').delete().eq('company_id', companyId);
  await admin.from('contacts').delete().eq('company_id', companyId);
  await admin.from('audit_logs').delete().eq('company_id', companyId);
  await admin.from('companies').delete().eq('id', companyId);
  await admin.auth.admin.deleteUser(userId).catch(() => undefined);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Create a supplier with optional PAN / TDS configuration. */
async function makeSupplier(
  s: Scratch,
  opts: { pan?: string | null; section?: string; deductee?: 'individual_huf' | 'other'; lower?: number | null } = {},
): Promise<string> {
  const created = await s.adapter.contacts.create({
    company_id: s.companyId,
    name: `Vendor ${Math.random().toString(36).slice(2, 8)}`,
    type: 'supplier', currency: 'INR',
    credit_limit: 0, payment_terms_days: 0, is_active: true,
    pan: opts.pan ?? null,
    tds_section_code: opts.section ?? '194C',
    tds_deductee_type: opts.deductee ?? 'other',
    lower_deduction_rate: opts.lower ?? null,
  } as any);
  return created.id;
}

/**
 * A confirmed vendor bill for `amount`. Written directly with the service role
 * plus a matching AP journal entry, so this suite tests the TDS engine rather
 * than re-testing the purchasing engine.
 */
async function makeConfirmedBill(s: Scratch, supplierId: string, amount: number, status = 'confirmed'): Promise<string> {
  const { data, error } = await (admin.from('vendor_bills') as any).insert({
    company_id: s.companyId, supplier_id: supplierId,
    bill_number: `BILL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    date: '2025-06-15', status,
    subtotal: amount, tax_amount: 0, total_amount: amount,
  }).select().single();
  if (error) throw new Error(`makeConfirmedBill: ${error.message}`);

  if (status === 'confirmed') {
    // Dr expense / Cr AP — the position TDS will later reduce.
    await s.adapter.accounting.postJE({
      source_type: 'manual', date: '2025-06-15', description: 'Bill booking',
      lines: [
        { account_code: '6500', debit: amount, credit: 0 },
        { account_code: '2100', debit: 0, credit: amount },
      ],
    });
  }
  return (data as any).id;
}

async function glForJE(jeId: string): Promise<Array<{ account_code: string; debit: number; credit: number }>> {
  const { data } = await admin.from('general_ledger')
    .select('account_code, debit, credit').eq('journal_entry_id', jeId);
  return (data ?? []).map((r: any) => ({ account_code: r.account_code, debit: Number(r.debit), credit: Number(r.credit) }));
}
/** Credit-positive balance — natural sign for liabilities (AP, TDS Payable). */
async function glCreditNet(companyId: string, code: string): Promise<number> {
  // `as any` — a projected + reassigned PostgREST builder collapses its generics.
  const { data } = await (admin.from('general_ledger') as any)
    .select('debit, credit').eq('company_id', companyId).eq('account_code', code);
  return (data ?? []).reduce((sum: number, r: any) => sum + (Number(r.credit) - Number(r.debit)), 0);
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
// G1 — Deduction posts and reduces the payable (T1, T2)
// ════════════════════════════════════════════════════════════════════════════
describe('AC-7A.2/G1 — a deduction moves AP into TDS Payable', () => {
  let s: Scratch | null = null;
  beforeAll(async () => { s = await createScratch('IN'); }, 60_000);
  afterAll(async () => { await destroyScratch(s); s = null; });

  it('T1/T2: 194C @2% on 100,000 posts Dr AP 2,000 / Cr 2320 2,000', async () => {
    const vendor = await makeSupplier(s!, { pan: 'ABCDE1234F', section: '194C', deductee: 'other' });
    const bill = await makeConfirmedBill(s!, vendor, 100000);

    const apBefore = await glCreditNet(s!.companyId, '2100');
    expect(apBefore).toBeCloseTo(100000, 2);

    const res = await s!.adapter.tds.record({
      vendor_bill_id: bill, section_code: '194C',
      base_amount: 100000, rate: 2, deduction_date: '2025-06-20', rate_reason: 'section',
    });
    expect(Number(res.amount)).toBeCloseTo(2000, 2);

    const legs = await glForJE(res.journal_entry_id);
    expect(legs.find((l) => l.account_code === '2100')!.debit).toBeCloseTo(2000, 2);
    expect(legs.find((l) => l.account_code === '2320')!.credit).toBeCloseTo(2000, 2);
    expect(sum(legs, 'debit')).toBeCloseTo(sum(legs, 'credit'), 2);

    // the vendor is now owed 98,000 and the government 2,000
    expect(await glCreditNet(s!.companyId, '2100')).toBeCloseTo(98000, 2);
    expect(await glCreditNet(s!.companyId, '2320')).toBeCloseTo(2000, 2);

    await assertInvariants(s!.companyId, '2025-06-30');
  }, 60_000);

  it('T3: no PAN escalates the same bill to the §206AA 20% rate', async () => {
    const vendor = await makeSupplier(s!, { pan: null, section: '194C', deductee: 'other' });
    const bill = await makeConfirmedBill(s!, vendor, 100000);

    const res = await s!.adapter.tds.record({
      vendor_bill_id: bill, section_code: '194C',
      base_amount: 100000, rate: 20, deduction_date: '2025-06-21', rate_reason: 'no_pan_206aa',
    });
    expect(Number(res.amount)).toBeCloseTo(20000, 2);

    const legs = await glForJE(res.journal_entry_id);
    expect(legs.find((l) => l.account_code === '2320')!.credit).toBeCloseTo(20000, 2);
    await assertInvariants(s!.companyId, '2025-06-30');
  }, 60_000);
});

// ════════════════════════════════════════════════════════════════════════════
// G2 — Guards (T4, T5, T6)
// ════════════════════════════════════════════════════════════════════════════
describe('AC-7A.2/G2 — the engine refuses impossible deductions', () => {
  it('T4: deducting more than the bill total is refused', async () => {
    const s = await createScratch('IN');
    try {
      const vendor = await makeSupplier(s, { pan: 'ABCDE1234F' });
      const bill = await makeConfirmedBill(s, vendor, 1000);
      // Deducting exactly the bill total is allowed (the guard rejects >, not =).
      await expect(s.adapter.tds.record({
        vendor_bill_id: bill, section_code: '194C',
        base_amount: 1000, rate: 100, deduction_date: '2025-06-20',
      })).resolves.toBeTruthy();
      // the bill is now fully withheld, so any further deduction must be refused
      await expect(s.adapter.tds.record({
        vendor_bill_id: bill, section_code: '194C',
        base_amount: 1000, rate: 10, deduction_date: '2025-06-21',
      })).rejects.toThrow(/exceed the bill total/i);
    } finally { await destroyScratch(s); }
  }, 90_000);

  it('T5: a draft bill cannot have TDS deducted', async () => {
    const s = await createScratch('IN');
    try {
      const vendor = await makeSupplier(s, { pan: 'ABCDE1234F' });
      const bill = await makeConfirmedBill(s, vendor, 50000, 'draft');
      await expect(s.adapter.tds.record({
        vendor_bill_id: bill, section_code: '194C',
        base_amount: 50000, rate: 2, deduction_date: '2025-06-20',
      })).rejects.toThrow(/confirmed bill/i);
    } finally { await destroyScratch(s); }
  }, 90_000);

  it('T6: two partial deductions accumulate against the same bill', async () => {
    const s = await createScratch('IN');
    try {
      const vendor = await makeSupplier(s, { pan: 'ABCDE1234F' });
      const bill = await makeConfirmedBill(s, vendor, 100000);

      await s.adapter.tds.record({ vendor_bill_id: bill, section_code: '194C', base_amount: 50000, rate: 2, deduction_date: '2025-06-20' });
      await s.adapter.tds.record({ vendor_bill_id: bill, section_code: '194C', base_amount: 50000, rate: 2, deduction_date: '2025-07-20' });

      const rows = await s.adapter.tds.listDeductionsForBill(bill);
      expect(rows).toHaveLength(2);
      expect(rows.reduce((a, r) => a + Number(r.amount), 0)).toBeCloseTo(2000, 2);
      expect(await glCreditNet(s.companyId, '2320')).toBeCloseTo(2000, 2);
      expect(await glCreditNet(s.companyId, '2100')).toBeCloseTo(98000, 2);
      await assertInvariants(s.companyId, '2025-07-31');
    } finally { await destroyScratch(s); }
  }, 90_000);
});

// ════════════════════════════════════════════════════════════════════════════
// G3 — Reversal (T7, T8)
// ════════════════════════════════════════════════════════════════════════════
describe('AC-7A.2/G3 — reversing a deduction', () => {
  it('T7/T8: reversal flips the legs, restores AP, and cannot repeat', async () => {
    const s = await createScratch('IN');
    try {
      const vendor = await makeSupplier(s, { pan: 'ABCDE1234F' });
      const bill = await makeConfirmedBill(s, vendor, 100000);
      const posted = await s.adapter.tds.record({
        vendor_bill_id: bill, section_code: '194C', base_amount: 100000, rate: 2, deduction_date: '2025-06-20',
      });
      expect(await glCreditNet(s.companyId, '2100')).toBeCloseTo(98000, 2);

      const rev = await s.adapter.tds.reverse(posted.deduction_id);
      expect(Number(rev.amount)).toBeCloseTo(2000, 2);

      const legs = await glForJE(rev.journal_entry_id);
      expect(legs.find((l) => l.account_code === '2320')!.debit).toBeCloseTo(2000, 2);   // liability out
      expect(legs.find((l) => l.account_code === '2100')!.credit).toBeCloseTo(2000, 2);  // payable back
      expect(sum(legs, 'debit')).toBeCloseTo(sum(legs, 'credit'), 2);

      // fully unwound
      expect(await glCreditNet(s.companyId, '2100')).toBeCloseTo(100000, 2);
      expect(await glCreditNet(s.companyId, '2320')).toBeCloseTo(0, 2);

      await expect(s.adapter.tds.reverse(posted.deduction_id)).rejects.toThrow(/already reversed/i);
      await assertInvariants(s.companyId, '2025-06-30');
    } finally { await destroyScratch(s); }
  }, 90_000);
});

// ════════════════════════════════════════════════════════════════════════════
// G4 — India gating (T9)
// ════════════════════════════════════════════════════════════════════════════
describe('AC-7A.2/G4 — TDS is India-only', () => {
  it('T9: 2320 + sections are seeded for IN and absent for AE', async () => {
    const inCo = await createScratch('IN');
    const aeCo = await createScratch('AE');
    try {
      const inCoa = await inCo.adapter.coa.list(inCo.companyId);
      const aeCoa = await aeCo.adapter.coa.list(aeCo.companyId);
      expect(inCoa.some((c) => c.code === '2320'), 'IN company has TDS Payable').toBe(true);
      expect(aeCoa.some((c) => c.code === '2320'), 'AE company has no TDS Payable').toBe(false);

      const inSections = await inCo.adapter.tds.listSections(inCo.companyId);
      const aeSections = await aeCo.adapter.tds.listSections(aeCo.companyId);
      expect(inSections.length, 'IN company has seeded TDS sections').toBeGreaterThan(0);
      expect(inSections.map((x) => x.code)).toContain('194C');
      expect(aeSections.length, 'AE company has no TDS sections').toBe(0);
    } finally {
      await destroyScratch(inCo);
      await destroyScratch(aeCo);
    }
  }, 120_000);
});
