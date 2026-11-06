/**
 * Company currency on opening balances (phase120 + the opening-balances page),
 * behaviour against STAGING ONLY.
 *
 *   K1  an Indian (INR) company's GL opening journal entry is labelled INR,
 *       not 'AED' (post_gl_opening_balance used a literal 'AED')
 *   K2  a UAE company's GL opening is still labelled AED
 *   K3  a customer opening posted the way the page now posts it (with the
 *       company currency) creates an INR invoice and INR journal entry
 *   K4  the posted-openings list shows the journal entry's own currency for
 *       a GL opening, not a fixed 'AED'
 *
 * Found in the Global pilot: an Indian company's Bank & Cash page showed AED.
 * Reads .env.staging.local only (loadStagingEnv); refuses any non-local target.
 * It creates and deletes users and companies, so it is not in the pre-commit
 * hook.   npm run test:company-currency
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
const PREFIX = 'TAX Scratch currency ';

interface T { client: SupabaseClient<Database>; companyId: string }
const cleanup: { companyId: string; userIds: string[] }[] = [];
let seq = 0;

async function tenant(name: string, country_code: 'IN' | 'AE', currency: 'INR' | 'AED'): Promise<T> {
  const email = `cc-${Date.now()}-${seq++}@stockbolt.test`, password = 'Currency!pass';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const client = createClient<Database>(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, noSession);
  const { error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn: ${sErr.message}`);
  const { company_id } = await runOnboarding({ company_name: PREFIX + name, company_name_ar: '', address: '', full_name: 'CC Owner',
    country_code, is_tax_registered: false, tax_id: '', currency, fiscal_year_start: '2026-04-01',
    warehouse_name: 'Main', warehouse_name_ar: 'رئيسي', warehouse_code: 'MAIN', load_sample_data: false },
  createSupabaseAdapter(client));
  cleanup.push({ companyId: company_id, userIds: [data.user.id] });
  return { client, companyId: company_id };
}

/** Any active asset account other than the opening-balance equity contra. */
async function assetAccount(t: T): Promise<string> {
  const { data, error } = await t.client.from('chart_of_accounts').select('id, code, type')
    .eq('company_id', t.companyId).eq('type', 'asset').eq('is_active', true).neq('code', '3010').limit(1);
  if (error || !data?.length) throw new Error(`no asset account: ${error?.message}`);
  return data[0].id;
}

async function jeCurrency(t: T, jeId: string): Promise<string | null> {
  const { data, error } = await t.client.from('journal_entries').select('currency').eq('id', jeId).single();
  if (error) throw new Error(error.message);
  return (data as { currency: string | null }).currency;
}

let india: T, uae: T;
beforeAll(async () => {
  india = await tenant('India', 'IN', 'INR');
  uae = await tenant('UAE', 'AE', 'AED');
}, 120_000);
afterAll(async () => {
  const left: string[] = [];
  for (const c of cleanup) left.push(...await destroyTenant(admin, { ...c, namePrefix: PREFIX }));
  if (left.length) throw new Error(left.join('\n'));
}, 120_000);

describe('Opening balances carry the company currency', () => {
  it('K1 an INR company GL opening journal entry is labelled INR', async () => {
    const res = await createSupabaseAdapter(india.client).openingBalances.postGl({
      account_id: await assetAccount(india), direction: 'debit', amount: 1000, date: '2026-04-01',
    });
    expect(await jeCurrency(india, res.journal_entry_id)).toBe('INR');
  });

  it('K2 an AED company GL opening is still labelled AED', async () => {
    const res = await createSupabaseAdapter(uae.client).openingBalances.postGl({
      account_id: await assetAccount(uae), direction: 'debit', amount: 500, date: '2026-04-01',
    });
    expect(await jeCurrency(uae, res.journal_entry_id)).toBe('AED');
  });

  it('K3 a customer opening posted with the company currency is INR end to end', async () => {
    const { data: contact, error } = await (india.client.from('contacts') as unknown as {
      insert: (v: object) => { select: (c: string) => { single: () => PromiseLike<{ data: { id: string } | null; error: { message: string } | null }> } };
    }).insert({ company_id: india.companyId, type: 'customer', name: 'CC Customer', currency: 'INR' }).select('id').single();
    if (error || !contact) throw new Error(`contact: ${error?.message}`);
    await createSupabaseAdapter(india.client).openingBalances.post({
      type: 'ar_owed', contact_id: contact.id, doc_number: 'OLD-1', date: '2026-04-01',
      amount: 2500, currency: 'INR',
    });
    const { data: inv } = await india.client.from('invoices').select('currency').eq('invoice_number', 'OLD-1').single();
    expect((inv as { currency: string }).currency).toBe('INR');
    const { data: je } = await india.client.from('journal_entries').select('currency')
      .eq('company_id', india.companyId).eq('source_type', 'opening_balance');
    expect((je as { currency: string }[]).map(j => j.currency)).toEqual(['INR']);
  });

  it('K4 the posted-openings list shows the GL opening in INR', async () => {
    const rows = await createSupabaseAdapter(india.client).openingBalances.listPosted(india.companyId);
    const gl = rows.filter(r => r.type === 'gl_debit' || r.type === 'gl_credit');
    expect(gl.length).toBeGreaterThan(0);
    expect(gl.every(r => r.currency === 'INR')).toBe(true);
  });
});
