/**
 * Global v1 Phase 6 — branch access enforcement (global06), STAGING ONLY.
 *
 * Company A: Head Office (warehouse HQ) + branch "North" (warehouse N).
 *   owner  admin                                  (B4: never restricted)
 *   R      sales, restricted, assigned to North    (one branch)
 *   M      sales, restricted, assigned to North + Head Office (several branches)
 *   Z      sales, restricted, no assignment         (zero access)
 *   U      sales, unrestricted (the default)        (legacy users unchanged)
 *   RA     admin, marked restricted                 (B4: admin wins)
 * Company B: its own owner (tenant isolation).
 *
 *   X0  enforcement OFF: a restricted user still sees everything (inert)
 *   X1  R sees only North's invoices, warehouses, stock movements and lines
 *   X2  R cannot create or change a document in Head Office (REST)
 *   X3  R can post in North; cannot confirm a Head Office invoice by RPC
 *   X4  R cannot read the company-wide GL / journal entries (B2) but posting
 *       still writes them
 *   X5  R is refused by the company-wide report functions (B2)
 *   X6  a Head Office document without a warehouse is Head Office's (B1)
 *   X7  vendor bills stay company-wide (B3)
 *   X8  Z sees nothing branch-scoped; M sees both branches
 *   X9  U (unrestricted) and RA (admin) see everything
 *   X10 a non-admin cannot widen their own access or switch enforcement
 *   X11 company B sees nothing of company A
 *   X12 purchase orders and stock transfers follow the branch too
 *
 * Reads .env.staging.local only; refuses any non-local target. Not in the
 * pre-commit hook.     npm run test:global06
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/types/database';
import { createSupabaseAdapter } from '../../src/data/supabaseAdapter';
import { runOnboarding } from '../../src/core/onboarding';
import { assertNotProductionTarget, loadStagingEnv } from './_env-guard';
import { destroyTenant } from './_tenant-cleanup';

const env = loadStagingEnv();
assertNotProductionTarget(env.VITE_SUPABASE_URL);
const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient<Database>(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY, noSession);
const PREFIX = 'TAX Scratch global06 ';
const DATE = '2026-06-01';
const db = (c: SupabaseClient<Database>) => c as any;

interface U { client: SupabaseClient<Database>; userId: string; email: string }
const cleanup: { companyId: string; userIds: string[] }[] = [];
let seq = 0;

async function signIn(): Promise<U> {
  const email = `g6-${Date.now()}-${seq++}@stockbolt.test`, password = 'Global06!pass';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const client = createClient<Database>(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, noSession);
  const { error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn: ${sErr.message}`);
  return { client, userId: data.user.id, email };
}

async function company(name: string) {
  const owner = await signIn();
  const { company_id } = await runOnboarding({
    company_name: PREFIX + name, company_name_ar: '', address: '', full_name: 'G6 Owner', country_code: 'AE',
    is_tax_registered: false, tax_id: '', currency: 'AED', fiscal_year_start: '2026-01-01',
    warehouse_name: 'HQ Store', warehouse_name_ar: 'رئيسي', warehouse_code: 'HQ', load_sample_data: false,
  }, createSupabaseAdapter(owner.client));
  cleanup.push({ companyId: company_id, userIds: [owner.userId] });
  await db(admin).from('companies').update({ allow_negative_stock: true }).eq('id', company_id);
  return { owner, companyId: company_id };
}

async function member(companyId: string, role: string, access: 'restricted' | 'unrestricted', branches: string[]): Promise<U> {
  const u = await signIn();
  cleanup.find((c) => c.companyId === companyId)!.userIds.push(u.userId);
  const { error } = await db(admin).from('profiles').insert({ id: u.userId, company_id: companyId, full_name: `G6 ${role}`,
    email: u.email, role, is_active: true, branch_access: access });
  if (error) throw new Error(`profile: ${error.message}`);
  for (const b of branches) {
    const { error: e } = await db(admin).from('profile_branches').insert({ company_id: companyId, profile_id: u.userId, branch_id: b });
    if (e) throw new Error(`assign: ${e.message}`);
  }
  return u;
}

let A: Awaited<ReturnType<typeof company>>, B: Awaited<ReturnType<typeof company>>;
let R: U, M: U, Z: U, UU: U, RA: U;
let hqBranch = '', northBranch = '', whHQ = '', whN = '', productId = '', customerId = '';
const inv: Record<string, string> = {};

async function draft(c: SupabaseClient<Database>, warehouse: string | null, amount = 100) {
  const ad = createSupabaseAdapter(c);
  const number = `G6-${seq++}`;
  return ad.invoices.create({ company_id: A.companyId, contact_id: customerId, invoice_number: number, date: DATE,
    due_date: DATE, currency: 'AED', exchange_rate: 1, subtotal: amount, tax_amount: 0, discount_amount: 0,
    total_amount: amount, status: 'draft', warehouse_id: warehouse } as any,
  [{ invoice_id: '', product_id: productId, quantity: 1, unit_price: amount, line_subtotal: amount, line_total: amount,
     tax_amount: 0, tax_rate: 0, discount_amount: 0, discount_percent: 0, sort_order: 0 } as any]);
}
const ids = async (c: SupabaseClient<Database>, table: string) =>
  ((await db(c).from(table).select('id').eq('company_id', A.companyId)).data ?? []).map((r: { id: string }) => r.id);
const setEnforcement = (on: boolean) => db(admin).from('companies').update({ branch_restriction_enabled: on }).eq('id', A.companyId);

beforeAll(async () => {
  A = await company('A');
  B = await company('B');
  const ownerAd = createSupabaseAdapter(A.owner.client);
  hqBranch = ((await db(admin).from('branches').select('id').eq('company_id', A.companyId).eq('is_default', true).single()).data).id;
  whHQ = ((await db(admin).from('warehouses').select('id').eq('company_id', A.companyId).single()).data).id;
  northBranch = ((await db(admin).from('branches').insert({ company_id: A.companyId, code: 'NORTH', name: 'North' }).select('id').single()).data).id;
  whN = ((await db(admin).from('warehouses').insert({ company_id: A.companyId, code: 'N', name: 'North Store', branch_id: northBranch }).select('id').single()).data).id;
  customerId = (await ownerAd.contacts.create({ company_id: A.companyId, type: 'customer', name: 'G6 Customer', name_ar: null,
    email: null, phone: null, mobile: null, tax_id: null, address_city: null, address_country: 'AE', currency: 'AED',
    contact_person_name: null, contact_person_phone: null, contact_person_email: null, credit_limit: 0,
    payment_terms_days: 30, notes: null, is_active: true, default_price_level_id: null } as any)).id;
  productId = (await ownerAd.products.create({ company_id: A.companyId, sku: `G6-${Date.now()}`, barcode: null, name: 'G6 Part',
    name_ar: null, description: null, description_ar: null, oe_number: null, replacement_numbers: null, brand_id: null,
    category_id: null, unit_id: null, quality_tier: null, selling_price: 100, tax_category: 'standard', min_stock_level: 0,
    requires_serial: false, is_active: true, image_urls: null } as any)).id;

  // Owner documents in both branches, plus a warehouse-less (Head Office) one.
  for (const [k, wh] of [['hq', whHQ], ['north', whN]] as const) {
    const d = await draft(A.owner.client, wh); await ownerAd.invoices.confirm(d.id); inv[k] = d.id;
  }
  inv.hqDraft = (await draft(A.owner.client, whHQ)).id;
  inv.noWarehouse = (await draft(A.owner.client, null)).id;
  inv.bill = (await ownerAd.vendorBills.create({ company_id: A.companyId, supplier_id: customerId, bill_number: `G6B-${seq++}`,
    date: DATE, due_date: DATE, currency: 'AED', exchange_rate: 1, subtotal: 50, tax_amount: 0, discount_amount: 0,
    total_amount: 50, status: 'draft' } as any, [])).id;

  R = await member(A.companyId, 'sales', 'restricted', [northBranch]);
  M = await member(A.companyId, 'sales', 'restricted', [northBranch, hqBranch]);
  Z = await member(A.companyId, 'sales', 'restricted', []);
  UU = await member(A.companyId, 'sales', 'unrestricted', []);
  RA = await member(A.companyId, 'admin', 'restricted', [northBranch]);
}, 300_000);

afterAll(async () => {
  await setEnforcement(false);
  const left: string[] = [];
  for (const c of cleanup) left.push(...await destroyTenant(admin, { ...c, namePrefix: PREFIX }));
  if (left.length) throw new Error(left.join('\n'));
}, 300_000);

describe('global06 branch access', () => {
  it('X0 with enforcement OFF a restricted user still sees every branch', async () => {
    await setEnforcement(false);
    expect(await ids(R.client, 'invoices')).toEqual(expect.arrayContaining([inv.hq, inv.north, inv.noWarehouse]));
    await setEnforcement(true);
  });

  it('X1 R sees only North: invoices, warehouses, stock movements, lines', async () => {
    const seen = await ids(R.client, 'invoices');
    expect(seen).toContain(inv.north);
    expect(seen).not.toContain(inv.hq);
    expect(await ids(R.client, 'warehouses')).toEqual([whN]);
    const moves = (await db(R.client).from('stock_ledger').select('warehouse_id').eq('company_id', A.companyId)).data ?? [];
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m: { warehouse_id: string }) => m.warehouse_id === whN)).toBe(true);
    expect((await db(R.client).from('invoice_items').select('id').eq('invoice_id', inv.hq)).data).toEqual([]);
    expect(((await db(R.client).from('invoice_items').select('id').eq('invoice_id', inv.north)).data ?? []).length).toBe(1);
  });

  it('X2 R cannot create or change a Head Office document through the API', async () => {
    await expect(draft(R.client, whHQ)).rejects.toThrow();
    const upd = await db(R.client).from('invoices').update({ notes: 'tampered' }).eq('id', inv.hqDraft).select('id');
    expect(upd.data ?? []).toEqual([]);
    const own = await draft(R.client, whN);
    expect(own.id).toBeTruthy();
    inv.rNorthDraft = own.id;
  });

  it('X3 R posts in North but cannot confirm a Head Office invoice by RPC', async () => {
    await expect(createSupabaseAdapter(R.client).invoices.confirm(inv.rNorthDraft)).resolves.not.toThrow();
    const gl = (await db(admin).from('general_ledger').select('id').eq('related_doc_id', inv.rNorthDraft)).data ?? [];
    expect(gl.length).toBeGreaterThan(0);
    const r = await db(R.client).rpc('confirm_invoice', { p_invoice_id: inv.hqDraft });
    expect(r.error).not.toBeNull();
    expect(((await db(admin).from('invoices').select('status').eq('id', inv.hqDraft).single()).data).status).toBe('draft');
  });

  it('X4 R cannot read the company-wide GL or journal entries (B2)', async () => {
    expect((await db(R.client).from('general_ledger').select('id').eq('company_id', A.companyId)).data).toEqual([]);
    expect((await db(R.client).from('journal_entries').select('id').eq('company_id', A.companyId)).data).toEqual([]);
    expect((await db(R.client).from('gl_active').select('id').eq('company_id', A.companyId)).data ?? []).toEqual([]);
  });

  it('X5 R is refused by the company-wide report functions (B2)', async () => {
    const r = await db(R.client).rpc('get_daily_cash_report', { p_company_id: A.companyId, p_date: DATE });
    expect(r.error?.message ?? '').toMatch(/branch-restricted/);
    const p = await db(R.client).rpc('get_project_profitability', { p_company_id: A.companyId, p_from: '2026-01-01', p_to: '2026-12-31' });
    expect(p.error?.message ?? '').toMatch(/branch-restricted/);
  });

  it('X6 a document without a warehouse belongs to Head Office (B1)', async () => {
    expect(await ids(R.client, 'invoices')).not.toContain(inv.noWarehouse);
    expect(await ids(M.client, 'invoices')).toContain(inv.noWarehouse);
  });

  it('X7 vendor bills stay company-wide (B3)', async () => {
    expect(await ids(R.client, 'vendor_bills')).toContain(inv.bill);
  });

  it('X8 zero assignments = zero branch access; several assignments = all of them', async () => {
    expect(await ids(Z.client, 'invoices')).toEqual([]);
    expect(await ids(Z.client, 'warehouses')).toEqual([]);
    expect(await ids(M.client, 'invoices')).toEqual(expect.arrayContaining([inv.hq, inv.north]));
    expect((await ids(M.client, 'warehouses')).sort()).toEqual([whHQ, whN].sort());
  });

  it('X9 an unrestricted user and an admin marked restricted see everything', async () => {
    for (const c of [UU.client, RA.client]) {
      expect(await ids(c, 'invoices')).toEqual(expect.arrayContaining([inv.hq, inv.north, inv.noWarehouse]));
    }
    expect(((await db(UU.client).from('general_ledger').select('id').eq('company_id', A.companyId)).data ?? []).length).toBeGreaterThan(0);
  });

  it('X10 a non-admin cannot widen their own access or switch enforcement', async () => {
    for (const p of ['users.manage', 'settings.write']) {
      const { error } = await db(admin).from('user_permission_overrides').insert({ user_id: R.userId, permission: p, mode: 'allow' });
      if (error) throw new Error(`override: ${error.message}`);
    }
    const self = await db(R.client).from('profile_branches').insert({ company_id: A.companyId, profile_id: R.userId, branch_id: hqBranch });
    expect(self.error?.message ?? '').toMatch(/own branch assignments/);
    const unrestrict = await db(R.client).from('profiles').update({ branch_access: 'unrestricted' }).eq('id', R.userId);
    expect(unrestrict.error?.message ?? '').toMatch(/only an admin/);
    const off = await db(R.client).from('companies').update({ branch_restriction_enabled: false }).eq('id', A.companyId);
    expect(off.error?.message ?? '').toMatch(/only an admin/);
    const still = (await db(admin).from('companies').select('branch_restriction_enabled').eq('id', A.companyId).single()).data;
    expect(still.branch_restriction_enabled).toBe(true);
    await db(admin).from('user_permission_overrides').delete().eq('user_id', R.userId);
  });

  it('X12 purchases and transfers follow the branch too', async () => {
    const po = async (wh: string) => ((await db(admin).from('purchase_orders').insert({ company_id: A.companyId,
      po_number: `G6PO-${seq++}`, supplier_id: customerId, warehouse_id: wh, date: DATE, currency: 'AED' }).select('id').single()).data).id;
    const poHQ = await po(whHQ), poN = await po(whN);
    const seen = await ids(R.client, 'purchase_orders');
    expect(seen).toContain(poN);
    expect(seen).not.toContain(poHQ);
    const ins = await db(R.client).from('purchase_orders').insert({ company_id: A.companyId, po_number: `G6PO-${seq++}`,
      supplier_id: customerId, warehouse_id: whHQ, date: DATE, currency: 'AED' });
    expect(ins.error).not.toBeNull();
    const tr = async (from: string, to: string) => ((await db(admin).from('stock_transfers').insert({ company_id: A.companyId,
      transfer_number: `G6T-${seq++}`, from_warehouse_id: from, to_warehouse_id: to, date: DATE }).select('id').single()).data).id;
    const toNorth = await tr(whHQ, whN);
    const whHQ2 = ((await db(admin).from('warehouses').insert({ company_id: A.companyId, code: 'HQ2', name: 'HQ Annex',
      branch_id: hqBranch }).select('id').single()).data).id;
    const hqOnly = await tr(whHQ, whHQ2);
    const tSeen = await ids(R.client, 'stock_transfers');
    expect(tSeen).toContain(toNorth);
    expect(tSeen).not.toContain(hqOnly);
  });

  it('X11 company B sees nothing of company A', async () => {
    expect(await ids(B.owner.client, 'invoices')).toEqual([]);
    expect(await ids(B.owner.client, 'warehouses')).toEqual([]);
  });
});
