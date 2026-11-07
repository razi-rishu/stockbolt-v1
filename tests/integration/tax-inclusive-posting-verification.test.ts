/**
 * phase123 decision 4 — tax-inclusive and tax-exclusive invoices POSTED to the
 * GL, behaviour against STAGING ONLY. Countries onboarded through the real
 * onboarding path, so they carry the phase123 seeded rates.
 *
 *   T1  Saudi Arabia 15 %, inclusive and exclusive
 *   T2  Bahrain 10 %, inclusive and exclusive
 *   T3  India 18 % (intra-state, CGST + SGST), inclusive and exclusive
 *   T4  India specials 3 / 1.5 / 0.25 % on one invoice, inclusive and exclusive
 *   T5  Kuwait: a zero-tax invoice posts no tax line at all
 *
 * For every invoice: the header satisfies subtotal − discount + tax = total;
 * the journal entry balances; Dr 1200 = total; output tax (22xx) = tax; and
 * revenue (4xxx) = total − tax (phase38).
 *
 * Reads .env.staging.local only (loadStagingEnv); refuses any non-local target.
 * Creates and deletes users and companies: not in the pre-commit hook.
 *     npm run test:tax-inclusive
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../src/types/database';
import { createSupabaseAdapter } from '../../src/data/supabaseAdapter';
import { runOnboarding } from '../../src/core/onboarding';
import { calcLine, calcHeaderTotals } from '../../src/core/sales/invoice-calc';
import { assertNotProductionTarget, loadStagingEnv } from './_env-guard';
import { destroyTenant } from './_tenant-cleanup';

const env = loadStagingEnv();
assertNotProductionTarget(env.VITE_SUPABASE_URL);
const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient<Database>(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY, noSession);
const PREFIX = 'TAX Scratch tax-inclusive ';
const DATE = '2026-05-10';
const CURRENCY: Record<string, string> = { SA: 'SAR', BH: 'BHD', IN: 'INR', KW: 'KWD' };

type Adapter = ReturnType<typeof createSupabaseAdapter>;
interface T { adapter: Adapter; companyId: string; currency: string; customer: string; productId: string }
const cleanup: { companyId: string; userIds: string[] }[] = [];
let seq = 0;

async function tenant(country: 'SA' | 'BH' | 'IN' | 'KW'): Promise<T> {
  const email = `ti-${Date.now()}-${seq++}@stockbolt.test`, password = 'TaxInclusive!pass';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const client = createClient<Database>(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, noSession);
  const { error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn: ${sErr.message}`);
  const adapter = createSupabaseAdapter(client);
  const india = country === 'IN', currency = CURRENCY[country];
  const { company_id } = await runOnboarding({
    company_name: PREFIX + country, company_name_ar: '', address: '', full_name: 'TI Owner', country_code: country,
    is_tax_registered: country !== 'KW', tax_id: india ? '32AAACB1234F1Z5' : country === 'KW' ? '' : '300000000000003',
    currency, fiscal_year_start: india ? '2026-04-01' : '2026-01-01',
    warehouse_name: 'Main', warehouse_name_ar: 'رئيسي', warehouse_code: 'MAIN', load_sample_data: false,
  }, adapter);
  cleanup.push({ companyId: company_id, userIds: [data.user.id] });
  await (admin.from('companies') as any).update({ allow_negative_stock: true, state: india ? 'Kerala' : null }).eq('id', company_id);
  const customer = (await adapter.contacts.create({
    company_id, type: 'customer', name: 'TI Customer', name_ar: null, email: null, phone: null, mobile: null, tax_id: null,
    address_city: null, address_country: country, currency, contact_person_name: null, contact_person_phone: null,
    contact_person_email: null, credit_limit: 0, payment_terms_days: 30, notes: null, is_active: true,
    default_price_level_id: null, place_of_supply_code: india ? '32' : null,   // intra-state for India
  } as any)).id;
  const product = await adapter.products.create({
    company_id, sku: `TI-${Date.now()}-${seq++}`, barcode: null, name: 'TI Part', name_ar: null, description: null,
    description_ar: null, oe_number: null, replacement_numbers: null, brand_id: null, category_id: null, unit_id: null,
    quality_tier: null, selling_price: 100, tax_category: 'standard', min_stock_level: 0, requires_serial: false,
    is_active: true, image_urls: null,
  } as any);
  return { adapter, companyId: company_id, currency, customer, productId: product.id };
}

type Row = [qty: number, price: number, disc: number, rate: number];

/** Builds the invoice exactly as the editor does (calcLine / calcHeaderTotals), confirms it. */
async function postInvoice(t: T, inclusive: boolean, rows: Row[]) {
  const lines = rows.map(([quantity, unit_price, discount_percent, tax_rate]) =>
    ({ quantity, unit_price, discount_percent, tax_rate, ...calcLine({ quantity, unit_price, discount_percent, tax_rate, inclusive }) }));
  const h = calcHeaderTotals(lines);
  const number = await t.adapter.invoices.getNextNumber(t.companyId);
  const inv = await t.adapter.invoices.create({
    company_id: t.companyId, contact_id: t.customer, invoice_number: number, date: DATE, due_date: DATE,
    currency: t.currency, exchange_rate: 1, subtotal: h.subtotal, tax_amount: h.tax_amount, discount_amount: h.discount_amount,
    total_amount: h.total_amount, prices_inclusive: inclusive, status: 'draft',
  } as any, lines.map((l, i) => ({
    invoice_id: '', product_id: t.productId, quantity: l.quantity, unit_price: l.unit_price, line_subtotal: l.line_subtotal,
    line_total: l.line_total, tax_amount: l.tax_amount, tax_rate: l.tax_rate, discount_amount: l.discount_amount,
    discount_percent: l.discount_percent, sort_order: i,
  } as any)));
  await t.adapter.invoices.confirm(inv.id);

  const { data, error } = await (admin.from('general_ledger') as any)
    .select('journal_entry_id, debit, credit, chart_of_accounts!inner(code)')
    .eq('company_id', t.companyId).eq('related_doc_id', inv.id);
  if (error) throw new Error(error.message);
  const gl = (data ?? []) as { journal_entry_id: string; debit: number; credit: number; chart_of_accounts: { code: string } }[];
  const sum = (pred: (c: string) => boolean, f: (r: typeof gl[number]) => number) =>
    Math.round(gl.filter((r) => pred(r.chart_of_accounts.code)).reduce((s, r) => s + f(r), 0) * 100) / 100;
  const byJe = new Map<string, number>();
  for (const r of gl) byJe.set(r.journal_entry_id, (byJe.get(r.journal_entry_id) ?? 0) + Number(r.debit) - Number(r.credit));
  return {
    h,
    ar:        sum((c) => c === '1200', (r) => Number(r.debit) - Number(r.credit)),
    tax:       sum((c) => c.startsWith('22'), (r) => Number(r.credit) - Number(r.debit)),
    taxByCode: Object.fromEntries([...new Set(gl.map((r) => r.chart_of_accounts.code).filter((c) => c.startsWith('22')))]
      .map((c) => [c, sum((x) => x === c, (r) => Number(r.credit) - Number(r.debit))])),
    revenue:   sum((c) => c.startsWith('4'), (r) => Number(r.credit) - Number(r.debit)),
    unbalanced: [...byJe.values()].filter((v) => Math.abs(v) > 0.005),
    rows: gl.length,
  };
}

function expectPosted(p: Awaited<ReturnType<typeof postInvoice>>) {
  expect(Math.round((p.h.subtotal - p.h.discount_amount + p.h.tax_amount) * 100) / 100).toBe(p.h.total_amount);
  expect(p.unbalanced, 'every journal entry balances').toEqual([]);
  expect(p.ar, 'Dr 1200 = invoice total').toBe(p.h.total_amount);
  expect(p.tax, 'output tax = invoice tax').toBe(p.h.tax_amount);
  expect(p.revenue, 'revenue = total − tax').toBe(Math.round((p.h.total_amount - p.h.tax_amount) * 100) / 100);
}

const tenants: Partial<Record<'SA' | 'BH' | 'IN' | 'KW', T>> = {};
beforeAll(async () => {
  for (const c of ['SA', 'BH', 'IN', 'KW'] as const) tenants[c] = await tenant(c);
}, 300_000);
afterAll(async () => {
  const left: string[] = [];
  for (const c of cleanup) left.push(...await destroyTenant(admin, { ...c, namePrefix: PREFIX }));
  if (left.length) throw new Error(left.join('\n'));
}, 300_000);

describe('tax-inclusive / exclusive invoices post correctly', () => {
  it.each([true, false])('T1 Saudi Arabia 15 %% (inclusive=%s)', async (inclusive) => {
    const p = await postInvoice(tenants.SA!, inclusive, [[3, 9.99, 0, 15], [1, 1234.5, 7.5, 15]]);
    expectPosted(p);
    expect(Object.keys(p.taxByCode)).toEqual(['2200']);
  });

  it.each([true, false])('T2 Bahrain 10 %% (inclusive=%s)', async (inclusive) => {
    const p = await postInvoice(tenants.BH!, inclusive, [[2, 49.95, 5, 10], [11, 3.333, 0, 10]]);
    expectPosted(p);
    expect(Object.keys(p.taxByCode)).toEqual(['2200']);
  });

  it.each([true, false])('T3 India 18 %% intra-state (inclusive=%s): CGST = SGST', async (inclusive) => {
    const p = await postInvoice(tenants.IN!, inclusive, [[1, 118, 0, 18], [3, 77.77, 0, 18]]);
    expectPosted(p);
    expect(Object.keys(p.taxByCode).sort()).toEqual(['2210', '2220']);
    // An odd paisa goes to one half; the total is exact (expectPosted).
    expect(Math.round(Math.abs(p.taxByCode['2210'] - p.taxByCode['2220']) * 100)).toBeLessThanOrEqual(1);
  });

  it.each([true, false])('T4 India specials 3 / 1.5 / 0.25 %% (inclusive=%s)', async (inclusive) => {
    const p = await postInvoice(tenants.IN!, inclusive, [[2, 5150.75, 2, 3], [1, 80000, 0, 1.5], [4, 2500.1, 0, 0.25]]);
    expectPosted(p);
    expect(Object.keys(p.taxByCode).sort()).toEqual(['2210', '2220']);
  });

  it('T5 Kuwait: a zero-tax invoice posts no tax line', async () => {
    const p = await postInvoice(tenants.KW!, false, [[2, 50, 0, 0]]);
    expectPosted(p);
    expect(p.h.tax_amount).toBe(0);
    expect(p.taxByCode).toEqual({});
  });
});
