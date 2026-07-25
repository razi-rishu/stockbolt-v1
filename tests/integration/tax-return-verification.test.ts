/**
 * AC-3C — VAT/GST Return filing: behavioural (Tier B) verification suite.
 *
 * The enforced regression suite is read-only/service-role and cannot drive
 * file_tax_return / reopen_tax_return (they gate on auth.uid()). This suite
 * proves the lifecycle end-to-end: it creates a scratch tenant, seeds posted
 * tax activity with manual journal entries, computes the return via the AC-3A
 * engine, files it, and asserts the tax_filings snapshot + the ADVANCED period
 * lock + audit — then that posting into the filed period is blocked, and that
 * reopen restores the lock. Filing must post NO journal entry.
 *
 * PRODUCTION SAFETY — MUTATES (creates + deletes users/companies). Calls
 * assertNotProductionTarget() first in every scratch setup (H4 P0 guard), so it
 * REFUSES to run against production. Not in the pre-commit hook. Run explicitly:
 *     npm run test:tax-return      (only meaningful against staging)
 *
 * Requires the phase57 migration applied on the target.
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
interface Scratch { adapter: Adapter; userClient: SupabaseClient<Database>; companyId: string; userId: string }
let scratchSeq = 0;

async function createScratch(countryCode: string): Promise<Scratch> {
  assertNotProductionTarget(SUPABASE_URL); // H4 P0 — never against production
  const tag = `${Date.now()}-${scratchSeq++}`;
  const email = `tax-${tag}@stockbolt.test`;
  const password = `Tax!${tag}`;

  const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (cErr || !created.user) throw new Error(`createUser: ${cErr?.message}`);
  const userId = created.user.id;

  const userClient = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: sErr } = await userClient.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn: ${sErr.message}`);

  const adapter = createSupabaseAdapter(userClient);
  const wizard: WizardData = {
    full_name: 'Tax Test Owner',
    company_name: `TAX Scratch ${tag}`,
    company_name_ar: 'اختبار الضريبة',
    address: countryCode === 'IN' ? 'Mumbai' : 'Dubai',
    country_code: countryCode,
    is_tax_registered: true,
    tax_id: countryCode === 'IN' ? '27ABCDE1234F1Z5' : 'TRN100000000003',
    currency: countryCode === 'IN' ? 'INR' : 'AED',
    fiscal_year_start: '2021-01-01',
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
  await (admin.from('tax_filings' as any) as any).delete().eq('company_id', companyId);
  await admin.from('audit_logs').delete().eq('company_id', companyId);
  await admin.from('companies').delete().eq('id', companyId);
  await admin.auth.admin.deleteUser(userId).catch(() => undefined);
}

// ── Seeding + reading helpers ────────────────────────────────────────────────
type JELine = { account_code: string; debit: number; credit: number };
async function seedJE(s: Scratch, dateISO: string, lines: JELine[]): Promise<void> {
  await s.adapter.accounting.postJE({ source_type: 'manual', date: dateISO, description: `tax seed ${dateISO}`, lines });
}
/** UAE VAT sale: cash (incl) / net sales 4100 / output VAT 2200. */
const uaeSale = (net: number, vat: number): JELine[] => [
  { account_code: '1100', debit: net + vat, credit: 0 },
  { account_code: '4100', debit: 0, credit: net },
  { account_code: '2200', debit: 0, credit: vat },
];
/** UAE VAT purchase: expense 5100 / input VAT 1500 / cash. */
const uaePurchase = (net: number, vat: number): JELine[] => [
  { account_code: '5100', debit: net, credit: 0 },
  { account_code: '1500', debit: vat, credit: 0 },
  { account_code: '1100', debit: 0, credit: net + vat },
];
/** India GST sale: cash / net 4100 / output CGST 2210 + SGST 2220. */
const inSale = (net: number, cgst: number, sgst: number): JELine[] => [
  { account_code: '1100', debit: net + cgst + sgst, credit: 0 },
  { account_code: '4100', debit: 0, credit: net },
  { account_code: '2210', debit: 0, credit: cgst },
  { account_code: '2220', debit: 0, credit: sgst },
];

async function getCompany(companyId: string) {
  const { data } = await admin.from('companies').select('*').eq('id', companyId).single();
  return data as any;
}
async function getFilings(companyId: string): Promise<any[]> {
  const { data } = await (admin.from('tax_filings' as any) as any).select('*').eq('company_id', companyId);
  return data ?? [];
}
async function countJEs(companyId: string): Promise<number> {
  const { count } = await admin.from('journal_entries').select('id', { count: 'exact', head: true }).eq('company_id', companyId);
  return count ?? 0;
}
async function auditCount(companyId: string, action: string): Promise<number> {
  const { count } = await admin.from('audit_logs').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('action', action);
  return count ?? 0;
}
/** File the AC-3A-computed return for a period (client passes the snapshot). */
async function fileReturn(s: Scratch, from: string, to: string, reference?: string) {
  const ret = await s.adapter.reports.getTaxReturn(s.companyId, from, to);
  return {
    ret,
    result: await s.adapter.accounting.fileTaxReturn({
      jurisdiction: ret.jurisdiction, period_type: 'quarterly',
      period_start: from, period_end: to,
      output_tax: ret.output_tax, input_tax: ret.input_tax, net_payable: ret.net_payable,
      boxes: { output: ret.output_boxes, input: ret.input_boxes }, reconciliation: ret.reconciliation,
      reference: reference ?? null,
    }),
  };
}

// Q1/Q2 2024 — both ended (relative to 2026 test clock).
const Q1 = { from: '2024-01-01', to: '2024-03-31' };
const Q2 = { from: '2024-04-01', to: '2024-06-30' };

// ════════════════════════════════════════════════════════════════════════════
// G1 — file → snapshot + lock + audit + reconciliation + no-JE (UAE)
// ════════════════════════════════════════════════════════════════════════════
describe('AC-3C/G1 — file a UAE VAT return', () => {
  let s: Scratch | null = null;
  beforeAll(async () => {
    s = await createScratch('AE');
    await seedJE(s, '2024-05-15', uaeSale(300, 15));      // output VAT 15
    await seedJE(s, '2024-05-16', uaePurchase(100, 5));   // input VAT 5
  }, 60_000);
  afterAll(async () => { await destroyScratch(s); s = null; });

  it('computes output/input/net from posted GL', async () => {
    const ret = await s!.adapter.reports.getTaxReturn(s!.companyId, Q2.from, Q2.to);
    expect(ret.jurisdiction).toBe('AE_VAT');
    expect(ret.output_tax).toBeCloseTo(15, 2);
    expect(ret.input_tax).toBeCloseTo(5, 2);
    expect(ret.net_payable).toBeCloseTo(10, 2);
    // seeded via manual JEs (no documents) → reconciliation flags untied tax
    expect(ret.reconciliation.matched).toBe(false);
    expect(ret.reconciliation.output.gl).toBeCloseTo(15, 2);
    expect(ret.reconciliation.output.documents).toBeCloseTo(0, 2);
  });

  it('filing snapshots the return, advances the lock, audits, and posts NO journal entry', async () => {
    const jesBefore = await countJEs(s!.companyId);
    const { result } = await fileReturn(s!, Q2.from, Q2.to, 'FTA-REF-001');
    expect(result.status).toBe('filed');
    expect(result.period_lock_date).toBe('2024-06-30');

    const [row] = await getFilings(s!.companyId);
    expect(row.status).toBe('filed');
    expect(Number(row.output_tax)).toBeCloseTo(15, 2);
    expect(Number(row.input_tax)).toBeCloseTo(5, 2);
    expect(Number(row.net_payable)).toBeCloseTo(10, 2);
    expect(row.reference_number).toBe('FTA-REF-001');

    expect((await getCompany(s!.companyId)).period_lock_date).toBe('2024-06-30');   // lock advanced
    expect(await countJEs(s!.companyId)).toBe(jesBefore);                            // no JE posted
    expect(await auditCount(s!.companyId, 'file_tax_return')).toBeGreaterThan(0);    // audited
  });

  it('cannot re-file an already-filed period', async () => {
    await expect(fileReturn(s!, Q2.from, Q2.to)).rejects.toThrow(/already filed/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G2 — filed period is locked; reopen restores the lock (UAE)
// ════════════════════════════════════════════════════════════════════════════
describe('AC-3C/G2 — lock enforcement + reopen', () => {
  let s: Scratch | null = null;
  beforeAll(async () => {
    s = await createScratch('AE');
    await seedJE(s, '2024-05-15', uaeSale(200, 10));
    await fileReturn(s, Q2.from, Q2.to);
  }, 60_000);
  afterAll(async () => { await destroyScratch(s); s = null; });

  it('posting into the filed period is rejected by the lock; reopen re-allows it', async () => {
    // lock is 2024-06-30 → a JE dated inside the period must be refused
    await expect(seedJE(s!, '2024-05-01', uaeSale(50, 2.5))).rejects.toThrow(/lock|period|closed/i);

    const [row] = await getFilings(s!.companyId);
    const res = await s!.adapter.accounting.reopenTaxReturn(row.id);
    expect(res.status).toBe('reopened');
    expect((await getFilings(s!.companyId))[0].status).toBe('reopened');
    // lock rolled back to prior (none was set before the first filing)
    expect((await getCompany(s!.companyId)).period_lock_date ?? null).toBeNull();
    expect(await auditCount(s!.companyId, 'reopen_tax_return')).toBeGreaterThan(0);

    // now the previously-blocked post is allowed
    await expect(seedJE(s!, '2024-05-01', uaeSale(50, 2.5))).resolves.toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G3 — LIFO reopen + future-period guard (UAE)
// ════════════════════════════════════════════════════════════════════════════
describe('AC-3C/G3 — LIFO reopen + guards', () => {
  let s: Scratch | null = null;
  beforeAll(async () => {
    s = await createScratch('AE');
    // seed BOTH quarters before filing (filing Q1 would otherwise lock Q2's dates)
    await seedJE(s, '2024-02-15', uaeSale(100, 5));
    await seedJE(s, '2024-05-15', uaeSale(200, 10));
    await fileReturn(s, Q1.from, Q1.to);
    await fileReturn(s, Q2.from, Q2.to);
  }, 60_000);
  afterAll(async () => { await destroyScratch(s); s = null; });

  it('cannot reopen the earlier period while a later one is filed (LIFO)', async () => {
    const q1 = (await getFilings(s!.companyId)).find((f) => f.period_end === '2024-03-31');
    await expect(s!.adapter.accounting.reopenTaxReturn(q1.id)).rejects.toThrow(/reverse order|later tax periods/i);
  });

  it('reopening in strict reverse order works', async () => {
    const filings = await getFilings(s!.companyId);
    const q1 = filings.find((f) => f.period_end === '2024-03-31');
    const q2 = filings.find((f) => f.period_end === '2024-06-30');
    await expect(s!.adapter.accounting.reopenTaxReturn(q2.id)).resolves.toMatchObject({ status: 'reopened' });
    await expect(s!.adapter.accounting.reopenTaxReturn(q1.id)).resolves.toMatchObject({ status: 'reopened' });
  });

  it('cannot file a period that has not ended yet', async () => {
    const nextYear = new Date().getUTCFullYear() + 1;
    await expect(fileReturn(s!, `${nextYear}-01-01`, `${nextYear}-03-31`)).rejects.toThrow(/not ended/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G4 — India GST jurisdiction (CGST + SGST output)
// ════════════════════════════════════════════════════════════════════════════
describe('AC-3C/G4 — India GST return', () => {
  let s: Scratch | null = null;
  beforeAll(async () => {
    s = await createScratch('IN');
    await seedJE(s, '2024-05-15', inSale(100, 9, 9));   // CGST 9 + SGST 9 = 18 output GST
  }, 60_000);
  afterAll(async () => { await destroyScratch(s); s = null; });

  it('aggregates CGST+SGST into output GST and files as IN_GST', async () => {
    const ret = await s!.adapter.reports.getTaxReturn(s!.companyId, Q2.from, Q2.to);
    expect(ret.jurisdiction).toBe('IN_GST');
    expect(ret.output_tax).toBeCloseTo(18, 2);

    const { result } = await fileReturn(s!, Q2.from, Q2.to);
    expect(result.status).toBe('filed');
    expect(result.jurisdiction).toBe('IN_GST');
    expect((await getFilings(s!.companyId))[0].jurisdiction).toBe('IN_GST');
  });
});
