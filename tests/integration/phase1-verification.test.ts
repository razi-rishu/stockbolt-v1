/**
 * Phase 1 Verification Test
 *
 * Verifies the complete onboarding flow for a UAE auto parts company:
 *   1. Create a pre-confirmed user via admin client (bypasses email confirmation)
 *   2. Sign in as that user and run the onboarding wizard
 *   3. Assert all expected DB rows exist in the correct state
 *
 * Per Doc 5 §"PHASE 1" verification test:
 *   - chart_of_accounts: 32 system accounts (UAE: excl. India GST + Salaries)
 *   - warehouses: 1 row, is_default=true
 *   - tax_rates: one set (phase118) — Standard Rate 5% (linked to 1500/2200),
 *     Zero-rated 0%, Exempt; exactly one 5% rate, typed by product tax category
 *   - payment_methods: 4 rows
 *   - units_of_measure: 5 rows
 *
 * Note on account count: Doc 5 says "30" but the finalised Doc 3 Part A list
 * yields 32 for a UAE company (minus India GST accounts 1510/1520/1530/2210/
 * 2220/2230 and the v2-deferred Salaries account 6100). Doc 5 §Phase 1 will
 * be updated from 30 → 32.
 *
 * Run with: npm run test:phase1
 */

import { beforeAll, describe, it, expect, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../src/types/database';
import { createSupabaseAdapter } from '../../src/data/supabaseAdapter';
import { runOnboarding, type WizardData } from '../../src/core/onboarding';
import { assertNotProductionTarget, loadStagingEnv } from './_env-guard';
import { destroyTenantOrThrow } from './_tenant-cleanup';

// INFRA-1: .env.staging.local only, never .env.local (production). Refused
// unless every target is the local Supabase stack (127.0.0.1:54321/54322).
const env = loadStagingEnv();

// ── Test env ------------------------------------------------------------------
const SUPABASE_URL        = env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY   = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL)        throw new Error('Missing VITE_SUPABASE_URL in .env.staging.local');
if (!SUPABASE_ANON_KEY)   throw new Error('Missing VITE_SUPABASE_PUBLISHABLE_KEY in .env.staging.local');
if (!SUPABASE_SECRET_KEY) throw new Error('Missing SUPABASE_SECRET_KEY in .env.staging.local');

const TAG           = Date.now();
const TEST_EMAIL    = `phase1-${TAG}@stockbolt.test`;
const TEST_PASSWORD = `Phase1!${TAG}`;

// Admin client (service role — bypasses RLS, used for setup and cleanup)
const adminClient = createClient<Database>(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let testUserId: string | null = null;
let testCompanyId: string | null = null;

// ── Setup: create confirmed user + run wizard ---------------------------------
beforeAll(async () => {
  // H4 P0: refuse to create/delete real users+companies against production.
  assertNotProductionTarget(SUPABASE_URL);
  // 1. Create auth user with email pre-confirmed (no inbox required in tests).
  //    Same pattern as Phase 0 test.
  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (createErr || !created.user) {
    throw new Error(`admin.createUser failed: ${createErr?.message}`);
  }
  testUserId = created.user.id;

  // 2. Sign in as the new user (anon key, subject to RLS).
  const userClient = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await userClient.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  if (signInError) throw new Error(`signIn failed: ${signInError.message}`);

  // 3. Run the full onboarding wizard.
  const adapter = createSupabaseAdapter(userClient);
  const wizard: WizardData = {
    full_name:            'Ahmad Al Rashid',
    company_name:         'Phase 1 Test Auto Parts',
    company_name_ar:      'قطع غيار اختبار المرحلة الأولى',
    address:              'Dubai, UAE',
    country_code:         'AE',
    is_tax_registered:    true,
    tax_id:               'TRN100000000',
    currency:             'AED',
    fiscal_year_start:    '2026-01-01',
    warehouse_name:       'Main Warehouse',
    warehouse_name_ar:    'المستودع الرئيسي',
    warehouse_code:       'MAIN',
    // Phase 14.13h removed the wizard bank step; bank accounts are added
    // via CoA quick-create after onboarding. WizardData no longer carries
    // bank_account_*, account_number, or bank_name fields.
    load_sample_data:     false,
  };

  const { company_id } = await runOnboarding(wizard, adapter);
  testCompanyId = company_id;
}, 30_000);

// ── Cleanup -------------------------------------------------------------------
afterAll(async () => {
  // INFRA-1: every row the tenant owns, children first; throws if anything is left.
  if (testCompanyId) {
    await destroyTenantOrThrow(adminClient, { companyId: testCompanyId, userIds: testUserId ? [testUserId] : [], namePrefix: 'Phase 1 Test Auto Parts' });
  } else if (testUserId) {
    const { error } = await adminClient.auth.admin.deleteUser(testUserId);
    if (error) throw new Error(`[cleanup] auth user ${testUserId}: ${error.message}`);
  }
});

// ── Assertions ----------------------------------------------------------------
describe('Phase 1 — Onboarding Verification', () => {
  it('companies row: correct fields, costing_method=mac', async () => {
    const { data } = await adminClient
      .from('companies')
      .select('*')
      .eq('id', testCompanyId!)
      .single();
    expect(data).toBeTruthy();
    expect(data!.costing_method).toBe('mac');
    expect(data!.country_code).toBe('AE');
    expect(data!.currency).toBe('AED');
    expect(data!.is_tax_registered).toBe(true);
    expect(data!.tax_id).toBe('TRN100000000');
  });

  it('profiles row: admin role, linked to correct company', async () => {
    const { data } = await adminClient
      .from('profiles')
      .select('*')
      .eq('id', testUserId!)
      .single();
    expect(data).toBeTruthy();
    expect(data!.role).toBe('admin');
    expect(data!.company_id).toBe(testCompanyId);
  });

  // seedCOA.ts: 58 accounts, 7 of them India-only (GST 1510-1530/2210-2230, TDS 2320),
  // so a UAE company gets 51. The 32 of Phase 1 grew with approved later phases
  // (fixed assets, amortization, opening balances, payroll).
  it('chart_of_accounts: 51 system accounts for UAE', async () => {
    const { data } = await adminClient
      .from('chart_of_accounts')
      .select('code')
      .eq('company_id', testCompanyId!)
      .eq('is_system', true);
    expect(data).toBeTruthy();
    expect(data!.length).toBe(51);
    const codes = data!.map((r) => r.code);
    // Key accounts present
    expect(codes).toContain('1100'); // Cash in Hand
    expect(codes).toContain('1200'); // AR
    expect(codes).toContain('1300'); // Inventory
    expect(codes).toContain('2100'); // AP
    expect(codes).toContain('2200'); // Output VAT (UAE)
    expect(codes).toContain('4100'); // Sales Revenue
    expect(codes).toContain('5100'); // COGS
    // India GST accounts must NOT be present for UAE
    expect(codes).not.toContain('1510');
    expect(codes).not.toContain('2210');
    // Salaries: payroll moved into v1 (AGENTS.md section 6, amended 2026-06-13), so 6100 is seeded
    expect(codes).toContain('6100');
  });

  it('warehouses: 1 row, is_default=true', async () => {
    const { data } = await adminClient
      .from('warehouses')
      .select('*')
      .eq('company_id', testCompanyId!);
    expect(data!.length).toBe(1);
    expect(data![0].is_default).toBe(true);
    expect(data![0].code).toBe('MAIN');
    expect(data![0].name).toBe('Main Warehouse');
  });

  // phase118: the company's rates come from ONE seed (seed_default_tax_rates on
  // company insert); onboarding links them to the tax accounts instead of
  // inserting a second 'UAE VAT 5%'. This expected exactly that single row
  // before the database seed existed; since phase21 both ran and every UAE
  // company got two 5% rates.
  it('tax_rates: one set, exactly one 5% rate, linked to the VAT accounts', async () => {
    const { data } = await adminClient
      .from('tax_rates')
      .select('*')
      .eq('company_id', testCompanyId!);
    const { data: accts } = await adminClient
      .from('chart_of_accounts').select('id, code')
      .eq('company_id', testCompanyId!).in('code', ['1500', '2200']);
    const id = (code: string) => accts!.find((a) => a.code === code)!.id;

    expect(data!.length).toBe(3);
    const five = data!.filter((r) => Number(r.rate) === 5);
    expect(five, 'no duplicate 5% rate').toHaveLength(1);
    expect(five[0].tax_type, 'matches products.tax_category').toBe('standard');
    expect(five[0].coa_input_account_id).toBe(id('1500'));
    expect(five[0].coa_output_account_id).toBe(id('2200'));
    expect(data!.map((r) => r.tax_type).sort()).toEqual(['exempt', 'standard', 'zero_rated']);
    expect(new Set(data!.map((r) => r.name)).size, 'no duplicate names').toBe(3);
  });

  it('payment_methods: 4 rows (Cash, Bank Transfer, Cheque, Card)', async () => {
    const { data } = await adminClient
      .from('payment_methods')
      .select('name')
      .eq('company_id', testCompanyId!);
    expect(data!.length).toBe(4);
    const names = data!.map((r) => r.name).sort();
    expect(names).toEqual(['Bank Transfer', 'Card', 'Cash', 'Cheque']);
  });

  it('units_of_measure: 5 rows (BOX, KG, LITRE, PCS, SET)', async () => {
    const { data } = await adminClient
      .from('units_of_measure')
      .select('code')
      .eq('company_id', testCompanyId!);
    expect(data!.length).toBe(5);
    const codes = data!.map((r) => r.code).sort();
    expect(codes).toEqual(['BOX', 'KG', 'LITRE', 'PCS', 'SET']);
  });

  // Phase 14.13h (f912fb7) removed the "first bank account" onboarding step: the
  // operator adds bank accounts through the chart of accounts afterwards. So
  // onboarding creates none, but the 1110 bank GL account they hang off exists.
  it('bank_accounts: none created by onboarding; COA 1110 is ready for one', async () => {
    const { data } = await adminClient
      .from('bank_accounts')
      .select('id')
      .eq('company_id', testCompanyId!);
    expect(data!.length).toBe(0);
    const { data: coa } = await adminClient
      .from('chart_of_accounts')
      .select('code, type')
      .eq('company_id', testCompanyId!)
      .eq('code', '1110')
      .single();
    expect(coa?.type).toBe('asset');
  });
});
