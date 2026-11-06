/**
 * India GST posting (Doc 3 Part K), behaviour against STAGING ONLY.
 *
 * Doc 3 Part K: an Indian company's output tax is CGST 2210 + SGST 2220 for an
 * intra-state supply and IGST 2230 for inter-state; purchases mirror it on
 * 1510 / 1520 / 1530. Found 2026-11-06: every posting engine instead takes the
 * first 22xx / 15xx account (or a fixed 1500) and writes the line coded
 * '2200' / '1500'. These tests state the rule; until a correction is approved
 * and applied, G1–G7 are EXPECTED TO FAIL (they document the defect). G8 is the
 * UAE control and must pass both before and after.
 *
 *   G1  intra-state invoice: Cr 2210 + Cr 2220, half each, codes match accounts
 *   G2  inter-state invoice: Cr 2230 for the whole tax
 *   G3  every GL row of the Indian company is coded with its own account's code
 *   G4  the India GST return sees the output tax of G1 + G2
 *   G5  intra-state bill: Dr 1510 + Dr 1520
 *   G6  a debit note with tax can be confirmed and reverses input GST
 *   G7  an expense with tax books input GST instead of folding it into expense
 *   G8  (control) a UAE invoice still posts its VAT to 2200
 *   G9  a credit note on an intra-state invoice reverses CGST + SGST
 *   G10 editing an inter-state invoice re-posts its tax as IGST
 *   G11 the Indian company's books still pass every invariant
 *
 * Reads .env.staging.local only (loadStagingEnv); refuses any non-local target.
 * Creates and deletes users and companies: not in the pre-commit hook.
 *     npm run test:india-gst
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
const PREFIX = 'TAX Scratch india-gst ';
const DATE = '2026-05-10';

type Adapter = ReturnType<typeof createSupabaseAdapter>;
interface T {
  client: SupabaseClient<Database>; adapter: Adapter; companyId: string; currency: string;
  localCustomer: string; otherStateCustomer: string; localSupplier: string; productId: string;
}
const cleanup: { companyId: string; userIds: string[] }[] = [];
let seq = 0;

async function tenant(name: string, country: 'IN' | 'AE'): Promise<T> {
  const email = `gst-${Date.now()}-${seq++}@stockbolt.test`, password = 'IndiaGst!pass';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const client = createClient<Database>(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, noSession);
  const { error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn: ${sErr.message}`);
  const adapter = createSupabaseAdapter(client);
  const india = country === 'IN';
  const currency = india ? 'INR' : 'AED';
  const { company_id } = await runOnboarding({
    company_name: PREFIX + name, company_name_ar: '', address: '', full_name: 'GST Owner', country_code: country,
    // Kerala GSTIN: the first two digits (32) are the supplier's state code.
    is_tax_registered: true, tax_id: india ? '32AAACB1234F1Z5' : '100123456700003', currency,
    fiscal_year_start: india ? '2026-04-01' : '2026-01-01',
    warehouse_name: 'Main', warehouse_name_ar: 'رئيسي', warehouse_code: 'MAIN', load_sample_data: false,
  }, adapter);
  cleanup.push({ companyId: company_id, userIds: [data.user.id] });
  await (admin.from('companies') as any).update({ allow_negative_stock: true, state: india ? 'Kerala' : null }).eq('id', company_id);
  const contact = async (type: 'customer' | 'supplier', nm: string, pos: string | null) => (await adapter.contacts.create({
    company_id, type, name: nm, name_ar: null, email: null, phone: null, mobile: null, tax_id: null,
    address_city: null, address_country: country, currency, contact_person_name: null, contact_person_phone: null,
    contact_person_email: null, credit_limit: 0, payment_terms_days: 30, notes: null, is_active: true,
    default_price_level_id: null, place_of_supply_code: pos,
  } as any)).id;
  const product = await adapter.products.create({
    company_id, sku: `GST-${Date.now()}-${seq++}`, barcode: null, name: 'GST Part', name_ar: null, description: null,
    description_ar: null, oe_number: null, replacement_numbers: null, brand_id: null, category_id: null, unit_id: null,
    quality_tier: null, selling_price: 1000, tax_category: 'standard', min_stock_level: 0, requires_serial: false,
    is_active: true, image_urls: null,
  } as any);
  return {
    client, adapter, companyId: company_id, currency,
    localCustomer: await contact('customer', 'Kochi Customer', india ? '32' : null),
    otherStateCustomer: await contact('customer', 'Bengaluru Customer', india ? '29' : null),
    localSupplier: await contact('supplier', 'Kochi Supplier', india ? '32' : null),
    productId: product.id,
  };
}

/** A confirmed invoice of 1,000 + tax at `rate`% to `customer`. Returns its id. */
async function invoice(t: T, customer: string, rate: number): Promise<string> {
  const tax = 1000 * rate / 100;
  const number = await t.adapter.invoices.getNextNumber(t.companyId);
  const inv = await t.adapter.invoices.create({
    company_id: t.companyId, contact_id: customer, invoice_number: number, date: DATE, due_date: DATE,
    currency: t.currency, exchange_rate: 1, subtotal: 1000, tax_amount: tax, discount_amount: 0,
    total_amount: 1000 + tax, status: 'draft',
  } as any, [{
    invoice_id: '', product_id: t.productId, quantity: 1, unit_price: 1000, line_subtotal: 1000,
    line_total: 1000 + tax, tax_amount: tax, tax_rate: rate, discount_amount: 0, discount_percent: 0, sort_order: 0,
  } as any]);
  await t.adapter.invoices.confirm(inv.id);
  return inv.id;
}

/** Net tax per account code for one document: output = credit − debit, input = debit − credit. */
async function taxLines(companyId: string, docId: string, prefix: '22' | '15') {
  const { data } = await (admin.from('general_ledger') as any)
    .select('account_code, debit, credit, chart_of_accounts!inner(code)')
    .eq('company_id', companyId).eq('related_doc_id', docId).like('chart_of_accounts.code', `${prefix}%`);
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as { account_code: string; debit: number; credit: number; chart_of_accounts: { code: string } }[]) {
    const key = `${r.account_code}@${r.chart_of_accounts.code}`;
    out[key] = (out[key] ?? 0) + (prefix === '22' ? Number(r.credit) - Number(r.debit) : Number(r.debit) - Number(r.credit));
  }
  return out;
}

let india: T, uae: T;
beforeAll(async () => {
  india = await tenant('IN', 'IN');
  uae = await tenant('AE', 'AE');
}, 240_000);
afterAll(async () => {
  const left: string[] = [];
  for (const c of cleanup) left.push(...await destroyTenant(admin, { ...c, namePrefix: PREFIX }));
  if (left.length) throw new Error(left.join('\n'));
}, 240_000);

describe('India GST posting follows Doc 3 Part K', () => {
  it('G1 intra-state invoice: Cr 2210 + Cr 2220, half each', async () => {
    const id = await invoice(india, india.localCustomer, 18);
    expect(await taxLines(india.companyId, id, '22')).toEqual({ '2210@2210': 90, '2220@2220': 90 });
  });

  it('G2 inter-state invoice: Cr 2230 for the whole tax', async () => {
    const id = await invoice(india, india.otherStateCustomer, 18);
    expect(await taxLines(india.companyId, id, '22')).toEqual({ '2230@2230': 180 });
  });

  it('G3 every GL row is coded with its own account\'s code', async () => {
    const { data } = await (admin.from('general_ledger') as any)
      .select('account_code, chart_of_accounts!inner(code)').eq('company_id', india.companyId);
    const wrong = ((data ?? []) as { account_code: string; chart_of_accounts: { code: string } }[])
      .filter((r) => r.account_code !== r.chart_of_accounts.code).map((r) => `${r.account_code}@${r.chart_of_accounts.code}`);
    expect(wrong).toEqual([]);
  });

  it('G4 the India GST return sees the output tax of G1 + G2', async () => {
    const ret = await india.adapter.reports.getTaxReturn(india.companyId, '2026-04-01', '2026-06-30');
    expect(ret.output_tax).toBe(360);
  });

  it('G5 intra-state bill: Dr 1510 + Dr 1520', async () => {
    const number = await india.adapter.vendorBills.getNextNumber(india.companyId);
    const bill = await india.adapter.vendorBills.create({
      company_id: india.companyId, supplier_id: india.localSupplier, bill_number: number, date: DATE, due_date: DATE,
      currency: 'INR', exchange_rate: 1, subtotal: 1000, tax_amount: 180, discount_amount: 0, total_amount: 1180, status: 'draft',
    } as any, [{
      bill_id: '', product_id: india.productId, quantity: 1, unit_cost: 1000, line_subtotal: 1000, line_total: 1180,
      tax_amount: 180, tax_rate: 18, discount_amount: 0, discount_percent: 0, sort_order: 0,
    } as any]);
    await india.adapter.vendorBills.confirm(bill.id);
    expect(await taxLines(india.companyId, bill.id, '15')).toEqual({ '1510@1510': 90, '1520@1520': 90 });
  });

  it('G6 a debit note with tax confirms and reverses input GST', async () => {
    const dn = await india.adapter.debitNotes.create({
      company_id: india.companyId, debit_note_number: `DN-GST-${seq++}`, supplier_id: india.localSupplier, date: DATE,
      currency: 'INR', exchange_rate: 1, subtotal: 100, tax_amount: 18, discount_amount: 0, total_amount: 118, status: 'draft',
    } as any, [{
      debit_note_id: '', product_id: india.productId, quantity: 0.1, unit_cost: 1000, tax_rate: 18, tax_amount: 18,
      line_subtotal: 100, line_total: 118, discount_amount: 0, discount_percent: 0, sort_order: 0,
    } as any]);
    await expect(india.adapter.debitNotes.confirm(dn.id)).resolves.toBeTruthy();
    expect(await taxLines(india.companyId, dn.id, '15')).toEqual({ '1510@1510': -9, '1520@1520': -9 });
  });

  it('G7 an expense with tax books input GST instead of folding it into the expense', async () => {
    const acct = async (code: string) => ((await (admin.from('chart_of_accounts') as any)
      .select('id').eq('company_id', india.companyId).eq('code', code).single()).data as { id: string }).id;
    // Expenses are paid from a bank/cash account (bank_accounts), not a chart row.
    const { data: cash, error: cErr } = await (admin.from('bank_accounts') as any).insert({
      company_id: india.companyId, name: 'GST Cash', account_type: 'cash', currency: 'INR', coa_account_id: await acct('1100'),
    }).select('id').single();
    if (cErr) throw new Error(`bank account: ${cErr.message}`);
    const exp = await india.adapter.expenses.create({
      company_id: india.companyId, expense_number: `EXP-GST-${seq++}`, date: DATE, description: 'GST expense',
      expense_account_id: await acct('6100'), paid_from_account_id: (cash as { id: string }).id, supplier_id: india.localSupplier,
      amount: 1000, tax_amount: 180, total_amount: 1180, status: 'draft',
    } as any);
    await india.adapter.expenses.confirm(exp.id);
    const lines = await taxLines(india.companyId, exp.id, '15');
    expect(Object.values(lines).reduce((s, v) => s + v, 0)).toBe(180);
  });

  it('G9 a credit note on an intra-state invoice reverses CGST + SGST', async () => {
    const invId = await invoice(india, india.localCustomer, 18);
    const items = await india.adapter.invoices.getItems(invId);
    const cn = await india.adapter.creditNotes.create({
      company_id: india.companyId, credit_note_number: `CN-GST-${seq++}`, contact_id: india.localCustomer,
      linked_invoice_id: invId, date: DATE, currency: 'INR', exchange_rate: 1, subtotal: 1000, tax_amount: 180,
      discount_amount: 0, total_amount: 1180, status: 'draft', restock: false,
    } as any, [{
      credit_note_id: '', product_id: india.productId, invoice_item_id: items[0].id, quantity: 1, unit_price: 1000,
      tax_rate: 18, tax_amount: 180, line_subtotal: 1000, line_total: 1180, discount_amount: 0, discount_percent: 0, sort_order: 0,
    } as any]);
    await india.adapter.creditNotes.confirm(cn.id);
    expect(await taxLines(india.companyId, cn.id, '22')).toEqual({ '2210@2210': -90, '2220@2220': -90 });
  });

  it('G10 editing an inter-state invoice re-posts its tax as IGST', async () => {
    const id = await invoice(india, india.otherStateCustomer, 18);
    const inv = (await india.adapter.invoices.getById(id))!;
    await india.adapter.invoices.update(id, { ...inv, subtotal: 2000, tax_amount: 360, total_amount: 2360 } as any, [{
      invoice_id: '', product_id: india.productId, quantity: 2, unit_price: 1000, line_subtotal: 2000,
      line_total: 2360, tax_amount: 360, tax_rate: 18, discount_amount: 0, discount_percent: 0, sort_order: 0,
    } as any]);
    await india.adapter.invoices.edit(id);
    // The old 180 is reversed and 360 re-posted, all on IGST: net 360.
    expect(await taxLines(india.companyId, id, '22')).toEqual({ '2230@2230': 360 });
  });

  it('G11 the books of the Indian company still pass every invariant', async () => {
    const { data, error } = await admin.rpc('verify_invariants', { p_company_id: india.companyId, p_as_of_date: '2026-12-31' } as any);
    expect(error).toBeNull();
    // G2 "Cash balance >= 0" is informational: G7 pays an expense from an empty
    // cash account on purpose. Every accounting invariant must pass.
    const failed = ((data ?? []) as { name: string; pass: boolean }[])
      .filter((c) => !c.pass && !/informational/i.test(c.name));
    expect(failed).toEqual([]);
  });

  it('G8 (control) a UAE invoice still posts its VAT to 2200', async () => {
    const id = await invoice(uae, uae.localCustomer, 5);
    expect(await taxLines(uae.companyId, id, '22')).toEqual({ '2200@2200': 50 });
  });
});
