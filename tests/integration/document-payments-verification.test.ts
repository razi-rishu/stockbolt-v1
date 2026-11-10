/**
 * Payment details on documents (documentPayments.list), behaviour against
 * STAGING ONLY. The section must show the records that really settled a
 * document — never a status-derived guess — and never another company's.
 *
 *   P1  posted expense: the bank/cash GL line names the paid-from account
 *   P2  voided expense: entry + reversal, nothing left paid
 *   P3  invoice with two partial receipts from two accounts (method, reference)
 *   P4  the receipts listed equal the applied total the list pages use (getAppliedMap)
 *   P5  a voided receipt drops out of the invoice's payments
 *   P6  a refund raised from a credit note is listed on that credit note
 *   P7  another company's user sees none of it (RLS)
 *   P8  every journal entry of the company still balances
 *
 * Reads .env.staging.local only; refuses any non-local target. Creates and
 * deletes users and companies: not in the pre-commit hook.
 *     npm run test:document-payments
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../src/types/database';
import { createSupabaseAdapter } from '../../src/data/supabaseAdapter';
import { runOnboarding } from '../../src/core/onboarding';
import { assertNotProductionTarget, loadStagingEnv } from './_env-guard';
import { destroyTenant } from './_tenant-cleanup';

const env = loadStagingEnv();
assertNotProductionTarget(env.VITE_SUPABASE_URL);
const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient<Database>(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY, noSession);
const PREFIX = 'TAX Scratch doc-payments ';
const DATE = '2026-05-10';

type Adapter = ReturnType<typeof createSupabaseAdapter>;
interface T { adapter: Adapter; companyId: string; cash: string; bank: string; customer: string; customer2: string; productId: string; transfer: string; cashCoa: string }
const cleanup: { companyId: string; userIds: string[] }[] = [];
let seq = 0;

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped insert shapes, as in the other staging suites */
async function tenant(name: string): Promise<T> {
  const email = `dp-${Date.now()}-${seq++}@stockbolt.test`, password = 'DocPayments!pass';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const client = createClient<Database>(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, noSession);
  const { error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn: ${sErr.message}`);
  const adapter = createSupabaseAdapter(client);
  const { company_id } = await runOnboarding({
    company_name: PREFIX + name, company_name_ar: '', address: '', full_name: 'DP Owner', country_code: 'AE',
    is_tax_registered: false, tax_id: '', currency: 'AED', fiscal_year_start: '2026-01-01',
    warehouse_name: 'Main', warehouse_name_ar: 'رئيسي', warehouse_code: 'MAIN', load_sample_data: false,
  }, adapter);
  cleanup.push({ companyId: company_id, userIds: [data.user.id] });
  await (admin.from('companies') as any).update({ allow_negative_stock: true }).eq('id', company_id);
  const coa = async (code: string) => ((await (admin.from('chart_of_accounts') as any)
    .select('id').eq('company_id', company_id).eq('code', code).single()).data as { id: string }).id;
  const bankRow = async (nm: string, type: 'cash' | 'bank', code: string, acct: string | null) => {
    const { data: b, error: e } = await (admin.from('bank_accounts') as any).insert({
      company_id, name: nm, account_type: type, currency: 'AED', coa_account_id: await coa(code), account_number: acct,
    }).select('id').single();
    if (e) throw new Error(`bank: ${e.message}`);
    return (b as { id: string }).id;
  };
  const contact = async (nm: string) => (await adapter.contacts.create({
    company_id, type: 'customer', name: nm, name_ar: null, email: null, phone: null, mobile: null, tax_id: null,
    address_city: null, address_country: 'AE', currency: 'AED', contact_person_name: null, contact_person_phone: null,
    contact_person_email: null, credit_limit: 0, payment_terms_days: 30, notes: null, is_active: true, default_price_level_id: null,
  } as any)).id;
  const product = await adapter.products.create({
    company_id, sku: `DP-${Date.now()}-${seq++}`, barcode: null, name: 'DP Service', name_ar: null, description: null,
    description_ar: null, oe_number: null, replacement_numbers: null, brand_id: null, category_id: null, unit_id: null,
    quality_tier: null, selling_price: 100, tax_category: 'standard', min_stock_level: 0, requires_serial: false,
    is_active: true, image_urls: null,
  } as any);
  const methods = (await (admin.from('payment_methods') as any).select('id, name').eq('company_id', company_id)).data as { id: string; name: string }[];
  return {
    adapter, companyId: company_id, cashCoa: await coa('1100'),
    cash: await bankRow('Petty Cash', 'cash', '1100', null),
    bank: await bankRow('Main Bank', 'bank', '1110', 'AE070331234567890123456'),
    customer: await contact('DP Customer'), customer2: await contact('DP Customer 2'), productId: product.id,
    transfer: methods.find(m => m.name === 'Bank Transfer')!.id,
  };
}

async function invoice(t: T, customer: string, amount: number): Promise<string> {
  const number = await t.adapter.invoices.getNextNumber(t.companyId);
  const inv = await t.adapter.invoices.create({
    company_id: t.companyId, contact_id: customer, invoice_number: number, date: DATE, due_date: DATE,
    currency: 'AED', exchange_rate: 1, subtotal: amount, tax_amount: 0, discount_amount: 0, total_amount: amount, status: 'draft',
  } as any, [{ invoice_id: '', product_id: t.productId, quantity: 1, unit_price: amount, line_subtotal: amount,
    line_total: amount, tax_amount: 0, tax_rate: 0, discount_amount: 0, discount_percent: 0, sort_order: 0 } as any]);
  await t.adapter.invoices.confirm(inv.id);
  return inv.id;
}

async function receipt(t: T, customer: string, invoiceId: string, amount: number, bank: string, method: string | null, reference: string | null) {
  const p = await t.adapter.payments.create({
    company_id: t.companyId, payment_number: await t.adapter.payments.getNextNumber(t.companyId), type: 'inbound',
    contact_id: customer, date: DATE, amount, currency: 'AED', exchange_rate: 1, bank_account_id: bank,
    reference, classification: 'against_invoice', status: 'draft', notes: null, payment_method_id: method,
    void_reason: null, voided_at: null, voided_by: null,
  } as any, [{ company_id: t.companyId, payment_id: '', doc_type: 'invoice', doc_id: invoiceId, amount_applied: amount, discount_amount: 0 } as any]);
  await t.adapter.payments.confirm(p.id);
  return p.id;
}

async function expense(t: T): Promise<string> {
  const exp = await t.adapter.expenses.create({
    company_id: t.companyId, expense_number: `EXP-DP-${seq++}`, date: DATE, description: 'DP expense',
    expense_account_id: (((await (admin.from('chart_of_accounts') as any).select('id').eq('company_id', t.companyId).eq('code', '6100').single()).data) as { id: string }).id,
    paid_from_account_id: t.cash, supplier_id: null, amount: 99, tax_amount: 0, total_amount: 99, status: 'draft',
  } as any);
  await t.adapter.expenses.confirm(exp.id);
  return exp.id;
}

let a: T, b: T;
beforeAll(async () => { a = await tenant('A'); b = await tenant('B'); }, 240_000);
afterAll(async () => {
  const left: string[] = [];
  for (const c of cleanup) left.push(...await destroyTenant(admin, { ...c, namePrefix: PREFIX }));
  if (left.length) throw new Error(left.join('\n'));
}, 240_000);

const ids: Record<string, string> = {};

describe('documentPayments shows what really settled a document', () => {
  it('P1 a posted expense names its paid-from account from the ledger', async () => {
    ids.exp = await expense(a);
    const lines = await a.adapter.documentPayments.list('expense', ids.exp);
    expect(lines.map(l => [l.kind, l.status, l.amount, l.account_name, l.account_type])).toEqual([['ledger', 'posted', 99, 'Petty Cash', 'cash']]);
  });

  it('P2 a voided expense shows the entry and its reversal, nothing left paid', async () => {
    const id = await expense(a);
    await a.adapter.expenses.void(id, 'test');
    const lines = await a.adapter.documentPayments.list('expense', id);
    expect(lines.map(l => l.status).sort()).toEqual(['reversal', 'reversed']);
    expect(lines.filter(l => l.status === 'posted').reduce((s, l) => s + l.amount, 0)).toBe(0);
  });

  it('P3 two partial receipts from two accounts, with method and reference', async () => {
    ids.inv = await invoice(a, a.customer, 300);
    ids.r1 = await receipt(a, a.customer, ids.inv, 100, a.bank, a.transfer, 'TT-1');
    ids.r2 = await receipt(a, a.customer, ids.inv, 50, a.cash, null, null);
    const lines = await a.adapter.documentPayments.list('invoice', ids.inv);
    expect(lines.map(l => [l.kind, l.amount, l.account_name, l.method, l.reference, l.status]).sort()).toEqual([
      ['payment', 100, 'Main Bank', 'Bank Transfer', 'TT-1', 'confirmed'],
      ['payment', 50, 'Petty Cash', null, null, 'confirmed'],
    ].sort());
  });

  it('P4 the receipts listed add up to the applied total the list pages show', async () => {
    const lines = await a.adapter.documentPayments.list('invoice', ids.inv);
    const applied = (await a.adapter.payments.getAppliedMap(a.companyId, 'invoice'))[ids.inv];
    expect(lines.reduce((s, l) => s + l.amount + l.discount, 0)).toBe(applied);
  });

  it('P5 a voided receipt drops out of the invoice\'s payments', async () => {
    await a.adapter.payments.void(ids.r2, 'test');
    const lines = await a.adapter.documentPayments.list('invoice', ids.inv);
    const active = lines.filter(l => l.status !== 'void');
    expect(active.map(l => l.amount)).toEqual([100]);
    expect(active.reduce((s, l) => s + l.amount, 0)).toBe((await a.adapter.payments.getAppliedMap(a.companyId, 'invoice'))[ids.inv]);
  });

  it('P6 a refund raised from a credit note is listed on it', async () => {
    const inv2 = await invoice(a, a.customer2, 100);
    await receipt(a, a.customer2, inv2, 100, a.bank, a.transfer, 'TT-2');
    const items = await a.adapter.invoices.getItems(inv2);
    const cn = await a.adapter.creditNotes.create({
      company_id: a.companyId, credit_note_number: `CN-DP-${seq++}`, contact_id: a.customer2, linked_invoice_id: inv2,
      date: DATE, currency: 'AED', exchange_rate: 1, subtotal: 100, tax_amount: 0, discount_amount: 0, total_amount: 100,
      status: 'draft', restock: false,
    } as any, [{ credit_note_id: '', product_id: a.productId, invoice_item_id: items[0].id, quantity: 1, unit_price: 100,
      tax_rate: 0, tax_amount: 0, line_subtotal: 100, line_total: 100, discount_amount: 0, discount_percent: 0, sort_order: 0 } as any]);
    await a.adapter.creditNotes.confirm(cn.id);
    ids.cn = cn.id;
    await a.adapter.payments.refundCustomerCredit({
      company_id: a.companyId, contact_id: a.customer2, date: DATE, amount: 40, currency: 'AED', bank_account_id: a.cash,
      reference: 'RF-1', source_doc_type: 'credit_note', source_doc_id: cn.id,
    });
    const lines = await a.adapter.documentPayments.list('credit_note', cn.id);
    expect(lines.map(l => [l.kind, l.amount, l.account_name, l.reference])).toEqual([['refund', 40, 'Petty Cash', 'RF-1']]);
  });

  it('P7 another company sees none of it', async () => {
    for (const [type, id] of [['expense', ids.exp], ['invoice', ids.inv], ['credit_note', ids.cn]] as const) {
      expect(await b.adapter.documentPayments.list(type, id), type).toEqual([]);
    }
  });

  it('P8 every journal entry of the company still balances', async () => {
    const { data } = await (admin.from('general_ledger') as any).select('journal_entry_id, debit, credit').eq('company_id', a.companyId);
    const net = new Map<string, number>();
    for (const r of (data ?? []) as { journal_entry_id: string; debit: number; credit: number }[]) {
      net.set(r.journal_entry_id, (net.get(r.journal_entry_id) ?? 0) + Number(r.debit) - Number(r.credit));
    }
    expect([...net.values()].filter(v => Math.abs(v) > 0.005)).toEqual([]);
    expect(net.size).toBeGreaterThan(5);
  });
});
