/**
 * Invoice edits after Finding C (phase121), behaviour against STAGING ONLY.
 *
 * phase119 took write rights on the ledgers away from clients. The invoice
 * editor's save of an EXISTING invoice still cleared deferred_cogs_queue with a
 * direct DELETE, so every such save failed with "permission denied for table
 * deferred_cogs_queue" (reported live 2026-11-06 on a draft invoice).
 *
 *   E1  re-saving a draft invoice (nothing queued) works
 *   E2  editing a confirmed invoice that has pending deferred COGS works: the
 *       old queue row is cleared, edit_invoice re-queues it for the new line,
 *       and the invariants still pass
 *   E3  a user of another company cannot clear this invoice's queue
 *   E4  the anon key cannot execute clear_invoice_deferred_cogs
 *   E5  a client still cannot DELETE from deferred_cogs_queue directly
 *
 * Reads .env.staging.local only (loadStagingEnv); refuses any non-local target.
 * It creates and deletes users and companies, so it is not in the pre-commit
 * hook.   npm run test:invoice-edit
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
const anon = createClient<Database>(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, noSession);
const PREFIX = 'TAX Scratch invoice-edit ';

type Adapter = ReturnType<typeof createSupabaseAdapter>;
type Res = { data: unknown; error: { code?: string; message: string } | null };
type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<Res>;
const rpcOf = (c: SupabaseClient<Database>): Rpc => (fn, args) => (c as unknown as { rpc: Rpc }).rpc(fn, args);

interface T { client: SupabaseClient<Database>; adapter: Adapter; companyId: string; customerId: string; productId: string }
const cleanup: { companyId: string; userIds: string[] }[] = [];
let seq = 0;

async function tenant(name: string): Promise<T> {
  const email = `ie-${Date.now()}-${seq++}@stockbolt.test`, password = 'InvEdit!pass';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const client = createClient<Database>(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, noSession);
  const { error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn: ${sErr.message}`);
  const adapter = createSupabaseAdapter(client);
  const { company_id } = await runOnboarding({ company_name: PREFIX + name, company_name_ar: '', address: '', full_name: 'IE Owner',
    country_code: 'AE', is_tax_registered: false, tax_id: '', currency: 'AED', fiscal_year_start: '2026-01-01',
    warehouse_name: 'Main', warehouse_name_ar: 'رئيسي', warehouse_code: 'MAIN', load_sample_data: false }, adapter);
  cleanup.push({ companyId: company_id, userIds: [data.user.id] });
  // Selling before buying is what creates a deferred-COGS queue row.
  await (admin.from('companies') as any).update({ allow_negative_stock: true }).eq('id', company_id);
  const customer = await adapter.contacts.create({
    company_id, type: 'customer', name: 'IE Customer', name_ar: null, email: null, phone: null, mobile: null, tax_id: null,
    address_city: null, address_country: 'AE', currency: 'AED', contact_person_name: null, contact_person_phone: null,
    contact_person_email: null, credit_limit: 0, payment_terms_days: 30, notes: null, is_active: true, default_price_level_id: null,
  } as any);
  const product = await adapter.products.create({
    company_id, sku: `IE-${Date.now()}-${seq++}`, barcode: null, name: 'IE Part', name_ar: null, description: null,
    description_ar: null, oe_number: null, replacement_numbers: null, brand_id: null, category_id: null, unit_id: null,
    quality_tier: null, selling_price: 100, tax_category: 'standard', min_stock_level: 0, requires_serial: false,
    is_active: true, image_urls: null,
  } as any);
  return { client, adapter, companyId: company_id, customerId: customer.id, productId: product.id };
}

const header = (t: T, number: string, qty: number, status: 'draft' | 'confirmed') => ({
  company_id: t.companyId, contact_id: t.customerId, invoice_number: number, date: '2026-03-01', due_date: '2026-03-01',
  currency: 'AED', exchange_rate: 1, subtotal: qty * 100, tax_amount: 0, discount_amount: 0, total_amount: qty * 100, status,
}) as any;
const line = (t: T, qty: number) => [{
  invoice_id: '', product_id: t.productId, quantity: qty, unit_price: 100, line_subtotal: qty * 100, line_total: qty * 100,
  tax_amount: 0, tax_rate: 0, discount_amount: 0, discount_percent: 0, sort_order: 0,
} as any];
const queued = async (invoiceId: string) => {
  const { data } = await (admin.from('deferred_cogs_queue' as any) as any).select('quantity, status').eq('sale_invoice_id', invoiceId);
  return (data ?? []) as { quantity: number; status: string }[];
};

let a: T, b: T, confirmedId = '';
beforeAll(async () => {
  a = await tenant('A');
  b = await tenant('B');
}, 180_000);
afterAll(async () => {
  const left: string[] = [];
  for (const c of cleanup) left.push(...await destroyTenant(admin, { ...c, namePrefix: PREFIX }));
  if (left.length) throw new Error(left.join('\n'));
}, 180_000);

describe('Invoice edits after Finding C (phase121)', () => {
  it('E1 re-saving a draft invoice works', async () => {
    const number = await a.adapter.invoices.getNextNumber(a.companyId);
    const inv = await a.adapter.invoices.create(header(a, number, 1, 'draft'), line(a, 1));
    await expect(a.adapter.invoices.update(inv.id, header(a, number, 2, 'draft'), line(a, 2))).resolves.toBeUndefined();
    const items = await a.adapter.invoices.getItems(inv.id);
    expect(items.map((i) => Number(i.quantity))).toEqual([2]);
  });

  it('E2 editing a confirmed invoice with pending deferred COGS works and re-queues it', async () => {
    const number = await a.adapter.invoices.getNextNumber(a.companyId);
    const inv = await a.adapter.invoices.create(header(a, number, 3, 'draft'), line(a, 3));
    await a.adapter.invoices.confirm(inv.id);
    confirmedId = inv.id;
    expect((await queued(inv.id)).map((r) => Number(r.quantity))).toEqual([3]);

    // What the editor's edit-save does: replace the lines, then reverse and repost.
    await a.adapter.invoices.update(inv.id, header(a, number, 5, 'confirmed'), line(a, 5));
    await a.adapter.invoices.edit(inv.id);

    const rows = await queued(inv.id);
    expect(rows.map((r) => Number(r.quantity))).toEqual([5]);
    const { data, error } = await admin.rpc('verify_invariants', { p_company_id: a.companyId, p_as_of_date: '2026-12-31' } as any);
    expect(error).toBeNull();
    const failed = ((data ?? []) as { name: string; pass: boolean }[]).filter((c) => !c.pass);
    expect(failed).toEqual([]);
  });

  it('E3 a user of another company cannot clear this invoice\'s queue', async () => {
    const res = await rpcOf(b.client)('clear_invoice_deferred_cogs', { p_invoice_id: confirmedId });
    expect(res.error).not.toBeNull();
    expect((await queued(confirmedId)).length).toBe(1);
  });

  it('E4 the anon key cannot execute clear_invoice_deferred_cogs', async () => {
    const res = await rpcOf(anon)('clear_invoice_deferred_cogs', { p_invoice_id: confirmedId });
    expect(res.error).not.toBeNull();
    expect((await queued(confirmedId)).length).toBe(1);
  });

  it('E5 a client still cannot DELETE from deferred_cogs_queue directly', async () => {
    const { error } = await (a.client.from('deferred_cogs_queue' as any) as any).delete().eq('sale_invoice_id', confirmedId);
    expect(error?.message ?? '').toMatch(/permission denied/i);
    expect((await queued(confirmedId)).length).toBe(1);
  });
});
