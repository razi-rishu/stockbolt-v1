/**
 * Phase 63 — Deferred COGS: behavioural verification suite.
 *
 * The enforced regression suite (regressions.test.ts) is read-only/service-role
 * and CANNOT drive confirm_invoice / confirm_vendor_bill — those RPCs resolve
 * the tenant from auth.uid(), which is NULL under the service role. This suite
 * proves the *numbers*: it creates a scratch tenant, signs in as its owner,
 * sells before buying, confirms the covering bill through the real authenticated
 * RPC, and asserts that COGS is recognised at the arriving cost and that
 * Inventory 1300 nets back to the value actually on hand.
 *
 * WHY THIS EXISTS
 * Selling before buying defers COGS until the goods arrive. The flush used to
 * price off running_avg_cost — but the phase-29 valuation trigger recomputes
 * that value in the same transaction and forces it to 0 whenever a receipt
 * lands cumulative stock exactly on zero. The flush guard (`IF v_flush_mac <= 0
 * THEN CONTINUE`) then skipped the row permanently. Nothing re-scans pending
 * rows, so it never self-healed: the purchase had already debited 1300, the
 * sale never recognised COGS, and inventory was overstated by the full purchase
 * value — silently, on live books. D3 is that exact scenario.
 *
 * PRODUCTION SAFETY — this suite MUTATES (creates + deletes users, companies,
 * products, documents and journal entries). It calls assertNotProductionTarget()
 * first in every scratch setup, so it REFUSES to run against the production
 * project (H4 P0 guard). It runs only when the harness points at a non-prod
 * (staging) Supabase project. It is NOT wired into the pre-commit hook. Run it
 * explicitly:
 *     npm run test:deferred-cogs      (only meaningful against staging)
 *
 * Requires phase63 AND phase64 to be applied to the target database.
 *
 * Scenario coverage:
 *   D1  selling with no stock defers COGS — nothing hits 5100, queue row pending
 *   D2  the covering purchase flushes at the ARRIVING cost, not the average
 *   D3  a receipt landing stock exactly on zero still flushes  ← the regression
 *   D4  buying more than was sold flushes and leaves the surplus valued
 *   D5  a partial receipt flushes nothing and leaves the row pending
 *   D6  landed cost is carried into the flushed COGS
 *   D7  flush_stranded_deferred_cogs dry-run reports a plan and posts nothing
 *   D8  the repair posts once and is idempotent on a second run
 *   D9  (phase64) the flush costs the sale row, so the average is not inflated
 *   D10 (phase64) the subledger repair backfills without touching the GL
 *
 * D9 is the one D1–D8 could not catch: those assert the GENERAL LEDGER, and the
 * ledger was already right. The defect lived in the subledger — an uncosted sale
 * row leaving the moving average too high, which then overcharges every later
 * sale of that part.
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
  customerId: string;
  supplierId: string;
}

let scratchSeq = 0;

async function createScratch(): Promise<Scratch> {
  assertNotProductionTarget(SUPABASE_URL); // H4 P0 — never against production
  const tag = `${Date.now()}-${scratchSeq++}`;
  const email = `dc-${tag}@stockbolt.test`;
  const password = `Dc!${tag}`;

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
    full_name: 'DC Test Owner',
    company_name: `DC Scratch ${tag}`,
    company_name_ar: 'اختبار التكلفة المؤجلة',
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

  // Selling before buying drives stock negative, which the phase-30 guard
  // blocks by default. Backorders are the entire premise of this suite.
  // `as any` — allow_negative_stock is a phase-30 column, absent from the
  // generated types.
  await (admin.from('companies') as any)
    .update({ allow_negative_stock: true }).eq('id', company_id);

  const customer = await adapter.contacts.create({
    company_id, type: 'customer', name: 'DC Customer', name_ar: null,
    email: null, phone: null, mobile: null, tax_id: null,
    billing_address: null, shipping_address: null, city: null, country: 'AE',
    contact_person_name: null, contact_person_phone: null, contact_person_email: null,
    credit_limit: 0, payment_terms_days: 30,
    notes: null, is_active: true, default_price_level_id: null,
  } as any);

  const supplier = await adapter.contacts.create({
    company_id, type: 'supplier', name: 'DC Supplier', name_ar: null,
    email: null, phone: null, mobile: null, tax_id: null,
    billing_address: null, shipping_address: null, city: null, country: 'AE',
    contact_person_name: null, contact_person_phone: null, contact_person_email: null,
    credit_limit: 0, payment_terms_days: 30,
    notes: null, is_active: true, default_price_level_id: null,
  } as any);

  return {
    adapter, userClient, companyId: company_id, userId,
    customerId: customer.id, supplierId: supplier.id,
  };
}

async function destroyScratch(s: Scratch | null): Promise<void> {
  if (!s) return;
  const { companyId, userId } = s;
  await admin.from('general_ledger').delete().eq('company_id', companyId);
  await admin.from('journal_entries').delete().eq('company_id', companyId);
  await (admin.from('deferred_cogs_queue' as any) as any).delete().eq('company_id', companyId);
  await admin.from('stock_ledger').delete().eq('company_id', companyId);
  await admin.from('audit_logs').delete().eq('company_id', companyId);
  await admin.from('companies').delete().eq('id', companyId);
  await admin.auth.admin.deleteUser(userId).catch(() => undefined);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

let skuSeq = 0;
async function makeProduct(s: Scratch, sellingPrice = 100): Promise<string> {
  const p = await s.adapter.products.create({
    company_id: s.companyId,
    sku: `DC-${Date.now()}-${skuSeq++}`,
    barcode: null,
    name: 'DC Part',
    name_ar: null,
    description: null, description_ar: null,
    oe_number: null, replacement_numbers: null,
    brand_id: null, category_id: null, unit_id: null,
    quality_tier: 'aftermarket',
    selling_price: sellingPrice,
    tax_category: 'standard',
    min_stock_level: 0,
    requires_serial: false,
    is_active: true,
    image_urls: null,
  } as any);
  return p.id;
}

/** Sell `qty` at `price` and confirm. Returns the invoice id. */
async function sell(s: Scratch, productId: string, qty: number, price: number, date: string): Promise<string> {
  const number = await s.adapter.invoices.getNextNumber(s.companyId);
  const inv = await s.adapter.invoices.create(
    {
      company_id: s.companyId, contact_id: s.customerId, invoice_number: number,
      date, due_date: date, currency: 'AED', exchange_rate: 1,
      subtotal: qty * price, tax_amount: 0, discount_amount: 0,
      total_amount: qty * price, status: 'draft',
    } as any,
    [{
      invoice_id: '', product_id: productId, quantity: qty, unit_price: price,
      line_subtotal: qty * price, line_total: qty * price,
      tax_amount: 0, tax_rate: 0, discount_amount: 0, discount_percent: 0, sort_order: 0,
    } as any],
  );
  await s.adapter.invoices.confirm(inv.id);
  return inv.id;
}

/** Buy `qty` at `cost` and confirm. Returns the bill id. */
async function buy(
  s: Scratch, productId: string, qty: number, cost: number, date: string,
  landed?: { label: string; amount: number; credit_account_code: string },
): Promise<string> {
  const number = await s.adapter.vendorBills.getNextNumber(s.companyId);
  let landedCosts: any[] | undefined;
  if (landed) {
    const { data: acct } = await (admin.from('chart_of_accounts') as any)
      .select('id').eq('company_id', s.companyId).eq('code', landed.credit_account_code).single();
    landedCosts = [{
      bill_id: '', label: landed.label, amount: landed.amount,
      credit_account_id: acct.id, contact_id: null, sort_order: 0,
    }];
  }
  const bill = await s.adapter.vendorBills.create(
    {
      company_id: s.companyId, supplier_id: s.supplierId, bill_number: number,
      date, due_date: date, currency: 'AED', exchange_rate: 1,
      subtotal: qty * cost, tax_amount: 0, discount_amount: 0,
      total_amount: qty * cost, status: 'draft',
    } as any,
    [{
      bill_id: '', product_id: productId, quantity: qty, unit_cost: cost,
      line_subtotal: qty * cost, line_total: qty * cost,
      tax_amount: 0, tax_rate: 0, discount_amount: 0, discount_percent: 0, sort_order: 0,
    } as any],
    landedCosts,
  );
  await s.adapter.vendorBills.confirm(bill.id);
  return bill.id;
}

async function queueRows(companyId: string, productId?: string): Promise<any[]> {
  let q = (admin.from('deferred_cogs_queue' as any) as any).select('*').eq('company_id', companyId);
  if (productId) q = q.eq('product_id', productId);
  const { data } = await q;
  return (data ?? []) as any[];
}

/** Net (debit − credit) on an account_code — natural sign for assets/expenses. */
async function glNet(companyId: string, code: string): Promise<number> {
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

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ════════════════════════════════════════════════════════════════════════════
// G1 — Defer, then flush at the arriving cost (D1, D2, D3)
// ════════════════════════════════════════════════════════════════════════════
describe('Phase 63/G1 — sell-before-buy defers, then flushes at the arriving cost', () => {
  let s: Scratch | null = null;
  beforeAll(async () => { s = await createScratch(); }, 60_000);
  afterAll(async () => { await destroyScratch(s); s = null; });

  it('D1: selling with no stock defers COGS instead of guessing a cost', async () => {
    const pid = await makeProduct(s!);
    await sell(s!, pid, 10, 100, '2025-03-01');

    // Nothing may hit COGS: there is no cost basis yet.
    expect(await glNet(s!.companyId, '5100')).toBeCloseTo(0, 2);
    // …and inventory must not be credited for stock that was never bought.
    expect(await glNet(s!.companyId, '1300')).toBeCloseTo(0, 2);

    const q = await queueRows(s!.companyId, pid);
    expect(q, 'one deferred row per sold line').toHaveLength(1);
    expect(q[0].status).toBe('pending');
    expect(Number(q[0].quantity)).toBeCloseTo(10, 3);

    await assertInvariants(s!.companyId, '2025-03-01');
  }, 60_000);

  it('D2: the covering purchase flushes at the arriving cost', async () => {
    const pid = await makeProduct(s!);
    await sell(s!, pid, 10, 100, '2025-04-01');
    await buy(s!, pid, 10, 40, '2025-04-05');

    const q = await queueRows(s!.companyId, pid);
    expect(q).toHaveLength(1);
    expect(q[0].status, 'row was flushed by the receipt').toBe('flushed');
    expect(Number(q[0].flush_unit_cost), 'flushed at the arriving cost').toBeCloseTo(40, 2);
    expect(q[0].flushed_journal_entry_id).toBeTruthy();

    // COGS = 10 × 40. Inventory nets to zero: bought 400, relieved 400.
    const legs = await (admin.from('general_ledger') as any)
      .select('debit, credit').eq('company_id', s!.companyId)
      .eq('journal_entry_id', q[0].flushed_journal_entry_id);
    const dr = (legs.data ?? []).reduce((a: number, r: any) => a + Number(r.debit), 0);
    const cr = (legs.data ?? []).reduce((a: number, r: any) => a + Number(r.credit), 0);
    expect(dr, 'flush JE balances').toBeCloseTo(cr, 2);
    expect(dr).toBeCloseTo(400, 2);

    await assertInvariants(s!.companyId, '2025-04-05');
  }, 60_000);

  it('D3: a receipt landing stock exactly on zero still flushes (the regression)', async () => {
    // This is the shape that stranded value on live books: the receipt covers
    // the backorder exactly, cumulative qty lands on 0, and the phase-29 trigger
    // zeroes running_avg_cost in the same transaction. Pricing off that average
    // skipped the row forever; pricing off the arriving line does not.
    const pid = await makeProduct(s!);
    const before1300 = await glNet(s!.companyId, '1300');
    const before5100 = await glNet(s!.companyId, '5100');

    await sell(s!, pid, 8, 90, '2025-05-01');
    await buy(s!, pid, 8, 3.49, '2025-05-02');   // exact cover → on-hand 0

    const q = await queueRows(s!.companyId, pid);
    expect(q[0].status, 'must NOT be left pending').toBe('flushed');
    expect(Number(q[0].flush_unit_cost)).toBeCloseTo(3.49, 2);

    // Stock is zero, so 1300 must be back where it started — no stranded value.
    expect(round2((await glNet(s!.companyId, '1300')) - before1300)).toBeCloseTo(0, 2);
    // …and the full purchase value became COGS.
    expect(round2((await glNet(s!.companyId, '5100')) - before5100)).toBeCloseTo(27.92, 2);

    await assertInvariants(s!.companyId, '2025-05-02');
  }, 60_000);
});

// ════════════════════════════════════════════════════════════════════════════
// G2 — Coverage edges (D4, D5, D6)
// ════════════════════════════════════════════════════════════════════════════
describe('Phase 63/G2 — over-supply, partial supply and landed cost', () => {
  let s: Scratch | null = null;
  beforeAll(async () => { s = await createScratch(); }, 60_000);
  afterAll(async () => { await destroyScratch(s); s = null; });

  it('D4: buying more than was sold flushes and leaves the surplus valued', async () => {
    const pid = await makeProduct(s!);
    const before1300 = await glNet(s!.companyId, '1300');
    const before5100 = await glNet(s!.companyId, '5100');

    await sell(s!, pid, 4, 100, '2025-06-01');
    await buy(s!, pid, 10, 25, '2025-06-02');   // 6 left on hand @ 25

    const q = await queueRows(s!.companyId, pid);
    expect(q[0].status).toBe('flushed');
    expect(Number(q[0].flush_unit_cost)).toBeCloseTo(25, 2);

    expect(round2((await glNet(s!.companyId, '5100')) - before5100), 'COGS = 4 × 25').toBeCloseTo(100, 2);
    expect(round2((await glNet(s!.companyId, '1300')) - before1300), 'inventory = 6 × 25').toBeCloseTo(150, 2);

    await assertInvariants(s!.companyId, '2025-06-02');
  }, 60_000);

  it('D5: a partial receipt flushes nothing and leaves the row pending', async () => {
    // Crediting 1300 for units that have not arrived would overstate COGS and
    // understate inventory. The row must wait for a receipt that covers it.
    const pid = await makeProduct(s!);
    const before5100 = await glNet(s!.companyId, '5100');

    await sell(s!, pid, 10, 100, '2025-07-01');
    await buy(s!, pid, 3, 30, '2025-07-02');    // only 3 of 10 arrive

    const q = await queueRows(s!.companyId, pid);
    expect(q[0].status, 'not covered → still pending').toBe('pending');
    expect(round2((await glNet(s!.companyId, '5100')) - before5100), 'no COGS recognised').toBeCloseTo(0, 2);

    // The rest arrives: now it covers, and the row flushes.
    await buy(s!, pid, 7, 30, '2025-07-03');
    const q2 = await queueRows(s!.companyId, pid);
    expect(q2[0].status).toBe('flushed');
    expect(round2((await glNet(s!.companyId, '5100')) - before5100)).toBeCloseTo(300, 2);

    await assertInvariants(s!.companyId, '2025-07-03');
  }, 60_000);

  it('D6: landed cost is carried into the flushed COGS', async () => {
    const pid = await makeProduct(s!);
    const before5100 = await glNet(s!.companyId, '5100');

    await sell(s!, pid, 10, 100, '2025-08-01');
    // 10 @ 20 = 200 goods + 50 freight → effective unit cost 25.
    await buy(s!, pid, 10, 20, '2025-08-02', {
      label: 'Freight', amount: 50, credit_account_code: '2100',
    });

    const q = await queueRows(s!.companyId, pid);
    expect(q[0].status).toBe('flushed');
    expect(Number(q[0].flush_unit_cost), 'landed cost included').toBeCloseTo(25, 2);
    expect(round2((await glNet(s!.companyId, '5100')) - before5100)).toBeCloseTo(250, 2);

    await assertInvariants(s!.companyId, '2025-08-02');
  }, 60_000);
});

// ════════════════════════════════════════════════════════════════════════════
// G3 — The repair RPC (D7, D8)
// ════════════════════════════════════════════════════════════════════════════
describe('Phase 63/G3 — flush_stranded_deferred_cogs repairs stranded rows', () => {
  let s: Scratch | null = null;
  beforeAll(async () => { s = await createScratch(); }, 60_000);
  afterAll(async () => { await destroyScratch(s); s = null; });

  /**
   * Re-creates the stranded state the bug produced: a covered row forced back
   * to 'pending' with its flush JE removed, exactly as production looked.
   */
  async function strand(companyId: string, productId: string): Promise<void> {
    const rows = await queueRows(companyId, productId);
    for (const r of rows) {
      if (r.flushed_journal_entry_id) {
        await admin.from('general_ledger').delete().eq('journal_entry_id', r.flushed_journal_entry_id);
        await admin.from('journal_entries').delete().eq('id', r.flushed_journal_entry_id);
      }
      await (admin.from('deferred_cogs_queue' as any) as any)
        .update({ status: 'pending', flushed_at: null, flushed_journal_entry_id: null, flush_unit_cost: null })
        .eq('id', r.id);
    }
  }

  it('D7: dry run reports a plan and posts nothing', async () => {
    const pid = await makeProduct(s!);
    await sell(s!, pid, 8, 90, '2025-09-01');
    await buy(s!, pid, 8, 3.49, '2025-09-02');
    await strand(s!.companyId, pid);

    const before5100 = await glNet(s!.companyId, '5100');
    const { data, error } = await s!.userClient.rpc('flush_stranded_deferred_cogs' as any, {} as any);
    expect(error, `dry run error: ${error?.message}`).toBeFalsy();

    const res = data as any;
    expect(res.dry_run).toBe(true);
    expect(Number(res.total), 'plan totals 8 × 3.49').toBeCloseTo(27.92, 2);
    expect(res.entries_posted).toBe(0);

    expect(round2((await glNet(s!.companyId, '5100')) - before5100), 'nothing posted').toBeCloseTo(0, 2);
    const q = await queueRows(s!.companyId, pid);
    expect(q[0].status, 'still pending after a dry run').toBe('pending');
  }, 60_000);

  it('D8: the repair posts once, clears the drift, and is idempotent', async () => {
    const pid = await makeProduct(s!);
    const before1300 = await glNet(s!.companyId, '1300');
    const before5100 = await glNet(s!.companyId, '5100');

    await sell(s!, pid, 2, 400, '2025-10-01');
    await buy(s!, pid, 2, 163.10, '2025-10-02');
    await strand(s!.companyId, pid);

    // Stranded: 1300 holds 326.20 with no stock behind it, COGS is 0.
    expect(round2((await glNet(s!.companyId, '1300')) - before1300)).toBeCloseTo(326.20, 2);
    expect(round2((await glNet(s!.companyId, '5100')) - before5100)).toBeCloseTo(0, 2);

    const { data, error } = await s!.userClient.rpc(
      'flush_stranded_deferred_cogs' as any, { p_dry_run: false } as any);
    expect(error, `repair error: ${error?.message}`).toBeFalsy();
    expect((data as any).entries_posted).toBeGreaterThanOrEqual(1);

    // Repaired: stock is zero, so 1300 is back to base and COGS carries it.
    expect(round2((await glNet(s!.companyId, '1300')) - before1300)).toBeCloseTo(0, 2);
    expect(round2((await glNet(s!.companyId, '5100')) - before5100)).toBeCloseTo(326.20, 2);

    const q = await queueRows(s!.companyId, pid);
    expect(q[0].status).toBe('flushed');
    expect(Number(q[0].flush_unit_cost)).toBeCloseTo(163.10, 2);

    // Second run must find nothing left to do.
    const after5100 = await glNet(s!.companyId, '5100');
    const { data: again } = await s!.userClient.rpc(
      'flush_stranded_deferred_cogs' as any, { p_dry_run: false } as any);
    expect((again as any).entries_posted, 'idempotent').toBe(0);
    expect(await glNet(s!.companyId, '5100'), 'no double post').toBeCloseTo(after5100, 2);

    await assertInvariants(s!.companyId, '2025-10-02');
  }, 60_000);
});

// ════════════════════════════════════════════════════════════════════════════
// G4 — Phase 64: the subledger must agree with the GL after a flush (D9, D10)
// ════════════════════════════════════════════════════════════════════════════
describe('Phase 64/G4 — flush writes the cost back to the subledger', () => {
  let s: Scratch | null = null;
  beforeAll(async () => { s = await createScratch(); }, 60_000);
  afterAll(async () => { await destroyScratch(s); s = null; });

  /** Subledger value the way E1 computes it: latest running_qty × MAC. */
  async function subledgerValue(companyId: string): Promise<number> {
    const { data } = await (admin.from('stock_ledger') as any)
      .select('product_id, warehouse_id, running_qty, running_avg_cost, seq')
      .eq('company_id', companyId).order('seq', { ascending: false });
    const seen = new Set<string>();
    let total = 0;
    for (const r of (data ?? []) as any[]) {
      const key = `${r.product_id}:${r.warehouse_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      total += Number(r.running_qty) * Number(r.running_avg_cost);
    }
    return round2(total);
  }

  async function saleRow(companyId: string, productId: string): Promise<any> {
    const { data } = await (admin.from('stock_ledger') as any)
      .select('*').eq('company_id', companyId).eq('product_id', productId)
      .eq('direction', -1).order('seq', { ascending: true });
    return ((data ?? []) as any[]).filter((r) => !r.reversal_of_id).pop();
  }

  async function latestRow(companyId: string, productId: string): Promise<any> {
    const { data } = await (admin.from('stock_ledger') as any)
      .select('*').eq('company_id', companyId).eq('product_id', productId)
      .order('seq', { ascending: false }).limit(1);
    return ((data ?? []) as any[])[0];
  }

  it('D9: after a flush the sale row is costed and the average is not inflated', async () => {
    // The IMBD123 shape: sell 1 with no stock, then receive 20 @ 200 and
    // 10 @ 250. Correct end state is 29 on hand at 216.88 (6289.47 / 29),
    // NOT 224.14 (6500 / 29) — the latter is what an uncosted sale row gives.
    const pid = await makeProduct(s!);
    await sell(s!, pid, 1, 400, '2025-11-01');
    await buy(s!, pid, 20, 200, '2025-11-02');
    await buy(s!, pid, 10, 250, '2025-11-03');

    const sr = await saleRow(s!.companyId, pid);
    expect(Number(sr.unit_cost), 'sale row was written back').toBeCloseTo(210.53, 2);
    expect(Number(sr.total_cost)).toBeCloseTo(210.53, 2);

    const last = await latestRow(s!.companyId, pid);
    expect(Number(last.running_qty)).toBeCloseTo(29, 3);
    expect(Number(last.running_avg_cost), 'average excludes the relieved sale').toBeCloseTo(216.88, 2);

    // The whole point: subledger and GL must now agree (within rounding).
    const gl = await glNet(s!.companyId, '1300');
    expect(gl).toBeCloseTo(6289.47, 2);
    expect(Math.abs(await subledgerValue(s!.companyId) - gl), 'subledger ties to GL').toBeLessThan(0.10);

    await assertInvariants(s!.companyId, '2025-11-03');
  }, 60_000);

  it('D10: the repair backfills a historically flushed row without touching the GL', async () => {
    const pid = await makeProduct(s!);
    await sell(s!, pid, 2, 400, '2025-12-01');
    await buy(s!, pid, 10, 50, '2025-12-02');

    // Re-create the pre-phase-64 state: flushed in the GL, sale row still at 0.
    const sr = await saleRow(s!.companyId, pid);
    await (admin.from('stock_ledger') as any)
      .update({ unit_cost: 0, total_cost: 0 }).eq('id', sr.id);
    // `as any` — phase-29 helper, absent from the generated RPC types.
    await admin.rpc('recompute_stock_valuation' as any, { p_company_id: s!.companyId } as any);

    const glBefore = await glNet(s!.companyId, '1300');
    const inflated = await latestRow(s!.companyId, pid);
    expect(Number(inflated.running_avg_cost), 'average is inflated while uncosted').toBeCloseTo(50, 2);
    expect(Math.abs(await subledgerValue(s!.companyId) - glBefore), 'subledger drifts').toBeGreaterThan(50);

    // Dry run reports but changes nothing.
    const { data: dry } = await s!.userClient.rpc('repair_flushed_cogs_subledger' as any, {} as any);
    expect((dry as any).dry_run).toBe(true);
    expect((dry as any).rows).toBeGreaterThanOrEqual(1);
    expect(Number((await saleRow(s!.companyId, pid)).unit_cost), 'dry run posted nothing').toBeCloseTo(0, 2);

    const { data: run, error } = await s!.userClient.rpc(
      'repair_flushed_cogs_subledger' as any, { p_dry_run: false } as any);
    expect(error, `repair error: ${error?.message}`).toBeFalsy();
    expect((run as any).rows).toBeGreaterThanOrEqual(1);

    // GL untouched — this repair may never move the books.
    expect(await glNet(s!.companyId, '1300'), 'GL is unchanged').toBeCloseTo(glBefore, 2);
    expect(Number((await saleRow(s!.companyId, pid)).unit_cost)).toBeCloseTo(50, 2);
    expect(Math.abs(await subledgerValue(s!.companyId) - glBefore), 'subledger now ties').toBeLessThan(0.10);

    // Idempotent: nothing left to claim.
    const { data: again } = await s!.userClient.rpc(
      'repair_flushed_cogs_subledger' as any, { p_dry_run: false } as any);
    expect((again as any).rows, 'idempotent').toBe(0);

    await assertInvariants(s!.companyId, '2025-12-02');
  }, 60_000);
});
