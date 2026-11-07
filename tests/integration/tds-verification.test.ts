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
 *   T10-T17 (phase114) TDS settles the bill: bill, supplier, AP aging and the
 *           2100 ledger agree through payments, reversal, edit, currency,
 *           period lock, tenant isolation and a UAE company
 */

import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/types/database';
import { createSupabaseAdapter } from '../../src/data/supabaseAdapter';
import { runOnboarding, type WizardData } from '../../src/core/onboarding';
import { assertNotProductionTarget, loadStagingEnv } from './_env-guard';
import { destroyTenantOrThrow } from './_tenant-cleanup';

// INFRA-1: .env.staging.local only, never .env.local (production). Refused
// unless every target is the local Supabase stack (127.0.0.1:54321/54322).
const env = loadStagingEnv();

const SUPABASE_URL        = env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY   = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL)        throw new Error('Missing VITE_SUPABASE_URL in .env.staging.local');
if (!SUPABASE_ANON_KEY)   throw new Error('Missing VITE_SUPABASE_PUBLISHABLE_KEY in .env.staging.local');
if (!SUPABASE_SECRET_KEY) throw new Error('Missing SUPABASE_SECRET_KEY in .env.staging.local');

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
  // INFRA-1: every row the tenant owns, children first; throws if anything is left.
  await destroyTenantOrThrow(admin, { companyId: s.companyId, userIds: [s.userId], namePrefix: 'TDS Scratch ' });
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
  // vendor_bills.currency is required; a bill is in the company's base currency.
  const { data: co } = await (admin.from('companies') as Untyped).select('base_currency').eq('id', s.companyId).single();
  const { data, error } = await (admin.from('vendor_bills') as any).insert({
    company_id: s.companyId, supplier_id: supplierId, currency: co.base_currency,
    bill_number: `BILL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    date: '2025-06-15', status,
    subtotal: amount, tax_amount: 0, total_amount: amount,
  }).select().single();
  if (error) throw new Error(`makeConfirmedBill: ${error.message}`);

  if (status === 'confirmed') {
    // Dr expense / Cr AP — the position TDS will later reduce. The AP line
    // names the supplier and the bill, as confirm_vendor_bill's does; without
    // it the payable belongs to nobody and B3 (party attribution) fails.
    await s.adapter.accounting.postJE({
      source_type: 'manual', date: '2025-06-15', description: 'Bill booking',
      lines: [
        { account_code: '6500', debit: amount, credit: 0 },
        { account_code: '2100', debit: 0, credit: amount, contact_id: supplierId },
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

      // phase118: one tax-rate set per company, no duplicates. phase123: India
      // gets the GST 2.0 slabs (0/5/18/40) plus the 3 / 1.5 / 0.25 specials from
      // the database seed, no manual IGST row (the engine splits), all linked to
      // the GST accounts.
      const inRates = await inCo.adapter.taxRates.listAll(inCo.companyId);
      expect(inRates.map((r) => `${r.tax_type} ${Number(r.rate)}`).sort())
        .toEqual(['GST 0', 'GST 0.25', 'GST 1.5', 'GST 18', 'GST 3', 'GST 40', 'GST 5']);
      const inCodes = new Map(inCoa.map((c) => [c.id, c.code]));
      for (const r of inRates) {
        expect(inCodes.get(r.coa_output_account_id ?? ''), `${r.name} output account`).toBe(r.tax_type === 'IGST' ? '2230' : '2210');
      }
      const aeRates = await aeCo.adapter.taxRates.listAll(aeCo.companyId);
      expect(aeRates.filter((r) => Number(r.rate) === 5), 'AE: exactly one 5% rate').toHaveLength(1);
    } finally {
      await destroyScratch(inCo);
      await destroyScratch(aeCo);
    }
  }, 120_000);
});

// ════════════════════════════════════════════════════════════════════════════
// G5 — phase114: TDS settles the bill (T10–T17)
//
// One rule everywhere: bill outstanding = total − payments applied − posted
// TDS. Each step checks that the bill balance, the supplier balance (open
// bills), the AP aging report and the supplier's 2100 ledger all agree, and
// that every invariant still holds.
// ════════════════════════════════════════════════════════════════════════════

// PostgREST builders on tables missing from the generated types, and rows
// read through them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Untyped = any;

/** A cash account on 1100 so vendor payments can be confirmed. */
async function makeCashAccount(s: Scratch): Promise<string> {
  const { data: co } = await (admin.from('companies') as Untyped).select('base_currency').eq('id', s.companyId).single();
  const { data: coa } = await (admin.from('chart_of_accounts') as Untyped)
    .select('id').eq('company_id', s.companyId).eq('code', '1100').single();
  const { data, error } = await (admin.from('bank_accounts') as Untyped).insert({
    company_id: s.companyId, name: 'Cash', account_type: 'cash',
    currency: co.base_currency, coa_account_id: coa.id,
  }).select('id').single();
  if (error) throw new Error(`makeCashAccount: ${error.message}`);
  // Fund it with owner's equity so payments never drive cash negative (G2).
  await s.adapter.accounting.postJE({
    source_type: 'manual', date: '2025-06-01', description: 'Owner funds cash',
    lines: [
      { account_code: '1100', debit: 500000, credit: 0 },
      { account_code: '3200', debit: 0, credit: 500000 },
    ],
  });
  return (data as { id: string }).id;
}

/** Pay `amount` to the supplier against one bill, through the real confirm RPC. */
async function payBill(
  s: Scratch, supplierId: string, billId: string, amount: number, applied: number, cashId: string,
): Promise<void> {
  const pmt = await s.adapter.vendorPayments.create({
    company_id: s.companyId,
    payment_number: `PAY-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    type: 'outbound', contact_id: supplierId, date: '2025-06-25',
    amount, currency: 'INR', classification: 'against_invoice', bank_account_id: cashId,
  } as Untyped, [{ doc_type: 'vendor_bill', doc_id: billId, amount_applied: applied } as Untyped]);
  await s.adapter.vendorPayments.confirm(pmt.id);
}

/** Every view of what we owe this supplier, side by side. */
async function payableViews(s: Scratch, supplierId: string, billId: string, asOf = '2025-07-31') {
  const open = await s.adapter.vendorBills.listOpenForSupplier(s.companyId, supplierId);
  const aging = await s.adapter.reports.getAPAgingReport(s.companyId, asOf);
  const { data: gl } = await (admin.from('general_ledger') as Untyped)
    .select('debit, credit').eq('company_id', s.companyId).eq('contact_id', supplierId)
    .eq('account_code', '2100').lte('date', asOf);
  return {
    bill: open.find((b) => b.id === billId)?.outstanding ?? 0,
    supplier: open.reduce((a, b) => a + b.outstanding, 0),
    aging: aging.buckets.find((b) => b.contact_id === supplierId)?.total ?? 0,
    ledger: (gl ?? []).reduce((a: number, r: Untyped) => a + Number(r.credit) - Number(r.debit), 0),
  };
}
async function expectPayable(s: Scratch, supplierId: string, billId: string, expected: number): Promise<void> {
  const v = await payableViews(s, supplierId, billId);
  expect(v.bill, `bill outstanding ${JSON.stringify(v)}`).toBeCloseTo(expected, 2);
  expect(v.supplier, `supplier balance ${JSON.stringify(v)}`).toBeCloseTo(expected, 2);
  expect(v.aging, `AP aging ${JSON.stringify(v)}`).toBeCloseTo(expected, 2);
  expect(v.ledger, `2100 ledger ${JSON.stringify(v)}`).toBeCloseTo(expected, 2);
}

describe('AC-7A.2/G5 — phase114: a TDS deduction settles the bill everywhere', () => {
  let s: Scratch | null = null;
  let cashId = '';
  beforeAll(async () => { s = await createScratch('IN'); cashId = await makeCashAccount(s); }, 60_000);
  afterAll(async () => { await destroyScratch(s); s = null; });

  it('T10: TDS with no payment — every view shows the net payable', async () => {
    const vendor = await makeSupplier(s!, { pan: 'ABCDE1234F' });
    const bill = await makeConfirmedBill(s!, vendor, 100000);
    await s!.adapter.tds.record({ vendor_bill_id: bill, section_code: '194C', base_amount: 100000, rate: 2, deduction_date: '2025-06-20' });

    await expectPayable(s!, vendor, bill, 98000);
    const open = await s!.adapter.vendorBills.listOpenForSupplier(s!.companyId, vendor);
    expect(open[0].tds_withheld).toBeCloseTo(2000, 2);
    expect(await glCreditNet(s!.companyId, '2320')).toBeCloseTo(2000, 2); // TDS Payable kept separately
    await assertInvariants(s!.companyId, '2025-07-31');
  }, 60_000);

  it('T11: partial then full net payment leaves nothing owed; further TDS is refused', async () => {
    const vendor = await makeSupplier(s!, { pan: 'ABCDE1234F' });
    const bill = await makeConfirmedBill(s!, vendor, 100000);
    await s!.adapter.tds.record({ vendor_bill_id: bill, section_code: '194C', base_amount: 100000, rate: 2, deduction_date: '2025-06-20' });

    await payBill(s!, vendor, bill, 40000, 40000, cashId);
    await expectPayable(s!, vendor, bill, 58000);
    await assertInvariants(s!.companyId, '2025-07-31');

    // the payment screen caps an allocation at the bill's outstanding: 58,000, not 60,000
    const open = await s!.adapter.vendorBills.listOpenForSupplier(s!.companyId, vendor);
    expect(open.find((b) => b.id === bill)!.outstanding).toBeCloseTo(58000, 2);

    await payBill(s!, vendor, bill, 58000, 58000, cashId);
    await expectPayable(s!, vendor, bill, 0);
    expect(await s!.adapter.vendorBills.listOpenForSupplier(s!.companyId, vendor)).toHaveLength(0);

    // settled by payments + TDS: withholding again would count the same money twice
    await expect(s!.adapter.tds.record({
      vendor_bill_id: bill, section_code: '194C', base_amount: 50000, rate: 2, deduction_date: '2025-06-26',
    })).rejects.toThrow(/still unpaid/i);
    await expectPayable(s!, vendor, bill, 0);
    await assertInvariants(s!.companyId, '2025-07-31');
  }, 90_000);

  it('T12: TDS on a bill already paid in full is refused (no double subtraction)', async () => {
    const vendor = await makeSupplier(s!, { pan: 'ABCDE1234F' });
    const bill = await makeConfirmedBill(s!, vendor, 10000);
    await payBill(s!, vendor, bill, 10000, 10000, cashId);
    await expect(s!.adapter.tds.record({
      vendor_bill_id: bill, section_code: '194C', base_amount: 10000, rate: 2, deduction_date: '2025-06-26',
    })).rejects.toThrow(/still unpaid/i);
    await expectPayable(s!, vendor, bill, 0);
    expect(await s!.adapter.tds.listDeductionsForBill(bill)).toHaveLength(0);
    await assertInvariants(s!.companyId, '2025-07-31');
  }, 60_000);

  it('T13: two deductions, one reversed — only the posted one counts', async () => {
    const vendor = await makeSupplier(s!, { pan: 'ABCDE1234F' });
    const bill = await makeConfirmedBill(s!, vendor, 100000);
    const a = await s!.adapter.tds.record({ vendor_bill_id: bill, section_code: '194C', base_amount: 50000, rate: 2, deduction_date: '2025-06-20' });
    await s!.adapter.tds.record({ vendor_bill_id: bill, section_code: '194J', base_amount: 20000, rate: 10, deduction_date: '2025-06-21' });
    await expectPayable(s!, vendor, bill, 97000); // 100,000 − 1,000 − 2,000
    await assertInvariants(s!.companyId, '2025-07-31');

    await s!.adapter.tds.reverse(a.deduction_id);
    await expectPayable(s!, vendor, bill, 98000); // the 1,000 is owed to the vendor again
    const open = await s!.adapter.vendorBills.listOpenForSupplier(s!.companyId, vendor);
    expect(open.find((b) => b.id === bill)!.tds_withheld).toBeCloseTo(2000, 2);
    await assertInvariants(s!.companyId, '2025-07-31');
  }, 60_000);

  it('T14: a bill without TDS, and the other supplier, are unaffected', async () => {
    const plain = await makeSupplier(s!, { pan: 'ABCDE1234F' });
    const plainBill = await makeConfirmedBill(s!, plain, 25000);
    const other = await makeSupplier(s!, { pan: 'ABCDE1234F' });
    const otherBill = await makeConfirmedBill(s!, other, 30000);
    await s!.adapter.tds.record({ vendor_bill_id: otherBill, section_code: '194C', base_amount: 30000, rate: 2, deduction_date: '2025-06-20' });

    await expectPayable(s!, plain, plainBill, 25000);
    const open = await s!.adapter.vendorBills.listOpenForSupplier(s!.companyId, plain);
    expect(open[0].tds_withheld).toBe(0);
    await expectPayable(s!, other, otherBill, 29400);
    await assertInvariants(s!.companyId, '2025-07-31');
  }, 60_000);

  it('T15: a bill with TDS cannot be edited until the deduction is reversed', async () => {
    const vendor = await makeSupplier(s!, { pan: 'ABCDE1234F' });
    const bill = await makeConfirmedBill(s!, vendor, 10000);
    await s!.adapter.tds.record({ vendor_bill_id: bill, section_code: '194C', base_amount: 10000, rate: 2, deduction_date: '2025-06-20' });
    const { error } = await (s!.userClient.rpc as Untyped)('edit_vendor_bill', { p_bill_id: bill });
    expect(error?.message ?? '').toMatch(/TDS deducted/i);
    await expectPayable(s!, vendor, bill, 9800);
  }, 60_000);

  it('T16: currency and period lock are enforced', async () => {
    const vendor = await makeSupplier(s!, { pan: 'ABCDE1234F' });
    // a bill in a foreign currency: the deduction would post at face value in base
    const { data: usd, error } = await (admin.from('vendor_bills') as Untyped).insert({
      company_id: s!.companyId, supplier_id: vendor, currency: 'USD', exchange_rate: 83,
      bill_number: `BILL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      date: '2025-06-15', status: 'draft', subtotal: 1000, tax_amount: 0, total_amount: 1000,
    }).select('id').single();
    expect(error).toBeFalsy();
    const usdId = (usd as { id: string }).id;
    // confirmed only for the guard check; it has no AP leg, so it is removed before the invariants
    await (admin.from('vendor_bills') as Untyped).update({ status: 'confirmed' }).eq('id', usdId);
    try {
      await expect(s!.adapter.tds.record({
        vendor_bill_id: usdId, section_code: '194C', base_amount: 1000, rate: 2, deduction_date: '2025-06-20',
      })).rejects.toThrow(/base currency/i);
    } finally {
      await (admin.from('vendor_bills') as Untyped).delete().eq('id', usdId);
    }

    const bill = await makeConfirmedBill(s!, vendor, 10000);
    await (admin.from('companies') as Untyped).update({ period_lock_date: '2025-06-30' }).eq('id', s!.companyId);
    try {
      await expect(s!.adapter.tds.record({
        vendor_bill_id: bill, section_code: '194C', base_amount: 10000, rate: 2, deduction_date: '2025-06-20',
      })).rejects.toThrow(/period lock/i);
    } finally {
      await (admin.from('companies') as Untyped).update({ period_lock_date: null }).eq('id', s!.companyId);
    }
    await expectPayable(s!, vendor, bill, 10000);
    await assertInvariants(s!.companyId, '2025-07-31');
  }, 60_000);

  it("T17: another company cannot deduct on, or see, this company's bill; UAE unaffected", async () => {
    const vendor = await makeSupplier(s!, { pan: 'ABCDE1234F' });
    const bill = await makeConfirmedBill(s!, vendor, 10000);
    await s!.adapter.tds.record({ vendor_bill_id: bill, section_code: '194C', base_amount: 10000, rate: 2, deduction_date: '2025-06-20' });

    const ae = await createScratch('AE');
    try {
      await expect(ae.adapter.tds.record({
        vendor_bill_id: bill, section_code: '194C', base_amount: 10000, rate: 2, deduction_date: '2025-06-20',
      })).rejects.toThrow(/not found/i);
      expect(await ae.adapter.tds.listDeductionsForBill(bill)).toHaveLength(0);
      expect(await ae.adapter.tds.getWithheldMap(s!.companyId)).toEqual({});

      // a UAE company's own bill: no TDS anywhere, outstanding is the plain total
      const aeVendor = (await ae.adapter.contacts.create({
        company_id: ae.companyId, name: 'UAE Vendor', type: 'supplier', currency: 'AED',
        credit_limit: 0, payment_terms_days: 0, is_active: true,
      } as Untyped)).id;
      const aeBill = await makeConfirmedBill(ae, aeVendor, 5000);
      await expectPayable(ae, aeVendor, aeBill, 5000);
      await assertInvariants(ae.companyId, '2025-07-31');
    } finally { await destroyScratch(ae); }

    await expectPayable(s!, vendor, bill, 9800);
    await assertInvariants(s!.companyId, '2025-07-31');
  }, 120_000);
});
