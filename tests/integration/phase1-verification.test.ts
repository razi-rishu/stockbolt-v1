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
 *   - tax_rates: 1 row "UAE VAT 5%"
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
import * as dotenv from 'dotenv';
import { resolve } from 'node:path';
import type { Database } from '../../src/types/database';
import { createSupabaseAdapter } from '../../src/data/supabaseAdapter';
import { runOnboarding, type WizardData } from '../../src/core/onboarding';

// Load .env.local explicitly — Vitest runs in Node, no Vite env processing.
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

// ── Test env ------------------------------------------------------------------
const SUPABASE_URL        = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY   = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL)        throw new Error('Missing VITE_SUPABASE_URL in .env.local');
if (!SUPABASE_ANON_KEY)   throw new Error('Missing VITE_SUPABASE_PUBLISHABLE_KEY in .env.local');
if (!SUPABASE_SECRET_KEY) throw new Error('Missing SUPABASE_SECRET_KEY in .env.local');

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
  if (testCompanyId) {
    await adminClient.from('companies').delete().eq('id', testCompanyId);
  }
  if (testUserId) {
    await adminClient.auth.admin.deleteUser(testUserId);
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

  it('chart_of_accounts: 32 system accounts for UAE', async () => {
    const { data } = await adminClient
      .from('chart_of_accounts')
      .select('code')
      .eq('company_id', testCompanyId!)
      .eq('is_system', true);
    expect(data).toBeTruthy();
    expect(data!.length).toBe(32);
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
    // Salaries (v2-deferred) must NOT be present
    expect(codes).not.toContain('6100');
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

  it('tax_rates: 1 row "UAE VAT 5%"', async () => {
    const { data } = await adminClient
      .from('tax_rates')
      .select('*')
      .eq('company_id', testCompanyId!);
    expect(data!.length).toBe(1);
    expect(data![0].name).toBe('UAE VAT 5%');
    expect(data![0].rate).toBe(5);
    expect(data![0].tax_type).toBe('VAT');
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

  it('bank_accounts: 1 row linked to COA 1110 (Bank Account Main)', async () => {
    const { data } = await adminClient
      .from('bank_accounts')
      .select('*, chart_of_accounts!bank_accounts_coa_account_id_fkey(code)')
      .eq('company_id', testCompanyId!);
    expect(data!.length).toBe(1);
    const coa = data![0].chart_of_accounts as { code: string } | null;
    expect(coa?.code).toBe('1110');
    expect(data![0].is_default).toBe(true);
    expect(data![0].account_type).toBe('bank');
  });
});
