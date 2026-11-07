/**
 * Global v1 Phase 4 — country tax rates for new companies (phase123), STAGING.
 *
 * Verified 2026-11-07 against each tax authority: SA 15 % (ZATCA), BH 10 %
 * (NBR), AE / OM 5 % (FTA / Oman Tax Authority), KW / QA no VAT law in force,
 * India GST 2.0 slabs 0 / 5 / 18 / 40 (56th GST Council, from 2025-09-22).
 *
 *   R1  each VAT country (AE, SA, BH, OM) gets exactly one standard rate, its own
 *   R1b Kuwait / Qatar get no tax codes and no VAT accounts (1500 / 2200), and
 *       are never VAT-registered (decision 1)
 *   R2  India gets 0 / 5 / 18 / 40 + specials 3 / 1.5 / 0.25, never 12 or 28,
 *       and no manual IGST row (decisions 2 and 3)
 *   R3  the app's default line rate agrees with the seeded standard rate
 *
 * Reads .env.staging.local only; refuses any non-local target. Not in the
 * pre-commit hook.     npm run test:country-rates
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../src/types/database';
import { createSupabaseAdapter } from '../../src/data/supabaseAdapter';
import { runOnboarding } from '../../src/core/onboarding';
import { defaultTaxRate } from '../../src/lib/locale';
import { assertNotProductionTarget, loadStagingEnv } from './_env-guard';
import { destroyTenant } from './_tenant-cleanup';

const env = loadStagingEnv();
assertNotProductionTarget(env.VITE_SUPABASE_URL);
const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient<Database>(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY, noSession);
const PREFIX = 'TAX Scratch country-rates ';
const CURRENCY: Record<string, string> = { AE: 'AED', SA: 'SAR', BH: 'BHD', OM: 'OMR', KW: 'KWD', QA: 'QAR', IN: 'INR' };
const EXPECTED_STANDARD: Record<string, number> = { AE: 5, SA: 15, BH: 10, OM: 5 };
const NO_VAT = ['KW', 'QA'];

const cleanup: { companyId: string; userIds: string[] }[] = [];
const rates: Record<string, { name: string; rate: number; tax_type: string }[]> = {};
const accounts: Record<string, string[]> = {};
const registered: Record<string, { is_tax_registered: boolean | null; tax_id: string | null }> = {};
let seq = 0;

async function onboard(country: string): Promise<void> {
  const email = `cr-${Date.now()}-${seq++}@stockbolt.test`, password = 'CountryRates!pass';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const client = createClient<Database>(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, noSession);
  const { error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn: ${sErr.message}`);
  const ad = createSupabaseAdapter(client);
  const { company_id } = await runOnboarding({
    company_name: PREFIX + country, company_name_ar: '', address: '', full_name: 'CR Owner', country_code: country,
    // Ask for registration everywhere: KW / QA must refuse it (decision 1).
    is_tax_registered: true, tax_id: 'TRN-TEST-' + country, currency: CURRENCY[country],
    fiscal_year_start: country === 'IN' ? '2026-04-01' : '2026-01-01',
    warehouse_name: 'Main', warehouse_name_ar: 'رئيسي', warehouse_code: 'MAIN', load_sample_data: false,
  }, ad);
  cleanup.push({ companyId: company_id, userIds: [data.user.id] });
  rates[country] = (await ad.taxRates.listAll(company_id)).map((r) => ({ name: r.name, rate: Number(r.rate), tax_type: r.tax_type as string }));
  const { data: coa } = await admin.from('chart_of_accounts').select('code').eq('company_id', company_id);
  accounts[country] = (coa ?? []).map((a) => a.code as string);
  const { data: co } = await admin.from('companies').select('is_tax_registered, tax_id').eq('id', company_id).single();
  registered[country] = { is_tax_registered: co?.is_tax_registered ?? null, tax_id: co?.tax_id ?? null };
}

beforeAll(async () => {
  for (const c of ['AE', 'SA', 'BH', 'OM', 'KW', 'QA', 'IN']) await onboard(c);
}, 300_000);
afterAll(async () => {
  const left: string[] = [];
  for (const c of cleanup) left.push(...await destroyTenant(admin, { ...c, namePrefix: PREFIX }));
  if (left.length) throw new Error(left.join('\n'));
}, 300_000);

describe('phase123 country tax rates', () => {
  it('R1 each VAT company gets exactly one standard rate, its own country\'s', () => {
    for (const [c, expected] of Object.entries(EXPECTED_STANDARD)) {
      const std = rates[c].filter((r) => r.tax_type === 'standard');
      expect(std.map((r) => r.rate), c).toEqual([expected]);
      expect(rates[c].map((r) => r.tax_type).sort(), c).toEqual(['exempt', 'standard', 'zero_rated']);
      expect(accounts[c], c).toEqual(expect.arrayContaining(['1500', '2200']));
      expect(registered[c].is_tax_registered, c).toBe(true);
    }
  });

  it('R1b Kuwait and Qatar get no tax codes, no VAT accounts, no VAT registration', () => {
    for (const c of NO_VAT) {
      expect(rates[c], c).toEqual([]);
      expect(accounts[c].length, c).toBeGreaterThan(0);
      expect(accounts[c], c).not.toContain('1500');
      expect(accounts[c], c).not.toContain('2200');
      expect(registered[c].is_tax_registered, c).toBe(false);
      expect(registered[c].tax_id ?? '', c).toBe('');
      expect(defaultTaxRate(c), c).toBe(0);
    }
  });

  it('R2 India gets the GST 2.0 slabs, never 12 % or 28 %', () => {
    expect(rates.IN.map((r) => `${r.tax_type} ${r.rate}`).sort()).toEqual(
      ['GST 0', 'GST 0.25', 'GST 1.5', 'GST 18', 'GST 3', 'GST 40', 'GST 5']);
    expect(rates.IN.some((r) => r.tax_type === 'IGST')).toBe(false);
  });

  it('R3 the default rate on new document lines matches the seeded standard rate', () => {
    for (const [c, expected] of Object.entries(EXPECTED_STANDARD)) expect(defaultTaxRate(c), c).toBe(expected);
    expect(rates.IN.some((r) => r.rate === defaultTaxRate('IN'))).toBe(true);
  });
});
