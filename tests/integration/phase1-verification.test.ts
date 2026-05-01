/**
 * Phase 1 Verification Test
 *
 * Verifies the complete onboarding flow for a UAE auto parts company:
 *   1. Sign up a new user
 *   2. Run the onboarding wizard (createCompanyAndProfile + seed services)
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
 * (Phase 0 COA migration) yields 32 for a UAE company after excluding India
 * GST accounts (1510, 1520, 1530, 2210, 2220, 2230) and the v2-deferred
 * Salaries account (6100). Doc 5 will be updated to reflect 32.
 *
 * Run with: npm run test:phase1
 */

import { describe, it, expect, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../src/types/database';
import { createSupabaseAdapter } from '../../src/data/supabaseAdapter';
import { runOnboarding, type WizardData } from '../../src/core/onboarding';
import 'dotenv/config';

// ── Test env -------------------------------------------------------------------
const SUPABASE_URL        = process.env.VITE_SUPABASE_URL!;
const SUPABASE_ANON_KEY   = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SECRET_KEY) {
  throw new Error(
    'Missing env vars. Ensure VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, ' +
    'and SUPABASE_SECRET_KEY are set in .env.local',
  );
}

const TEST_EMAIL    = `phase1-test-${Date.now()}@stockbolt.test`;
const TEST_PASSWORD = 'Phase1Test!2026';

// Admin client to clean up after test (bypasses RLS)
const adminClient = createClient<Database>(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let testUserId: string | null = null;
let testCompanyId: string | null = null;

// ── Cleanup -------------------------------------------------------------------
afterAll(async () => {
  if (testCompanyId) {
    // Cascade delete cleans up all seeded rows
    await adminClient.from('companies').delete().eq('id', testCompanyId);
  }
  if (testUserId) {
    await adminClient.auth.admin.deleteUser(testUserId);
  }
});

// ── Tests ---------------------------------------------------------------------
describe('Phase 1 — Onboarding Verification', () => {
  it('signs up a new user', async () => {
    const anonClient = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await anonClient.auth.signUp({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    expect(error).toBeNull();
    expect(data.user).toBeTruthy();
    testUserId = data.user!.id;
  });

  it('runs the onboarding wizard end-to-end', async () => {
    // Sign in with the new user's credentials (simulates post-signup signIn)
    const userClient = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInError } = await userClient.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    // Email confirmation is disabled in test mode; if it isn't, skip this test gracefully
    if (signInError?.message.includes('Email not confirmed')) {
      console.warn('Email confirmation required — confirm via Supabase dashboard or disable in Auth settings for tests.');
      return;
    }
    expect(signInError).toBeNull();

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
      bank_account_name:    'Emirates NBD — Current',
      bank_account_name_ar: 'الإمارات دبي الوطني',
      bank_account_type:    'bank',
      bank_name:            'Emirates NBD',
      account_number:       '0012345678',
      load_sample_data:     false,
    };

    const { company_id } = await runOnboarding(wizard, adapter);
    expect(company_id).toBeTruthy();
    testCompanyId = company_id;
  });

  it('companies table has correct row with costing_method=mac', async () => {
    if (!testCompanyId) return;
    const { data } = await adminClient
      .from('companies')
      .select('*')
      .eq('id', testCompanyId)
      .single();
    expect(data).toBeTruthy();
    expect(data!.costing_method).toBe('mac');
    expect(data!.country_code).toBe('AE');
    expect(data!.currency).toBe('AED');
    expect(data!.is_tax_registered).toBe(true);
    expect(data!.tax_id).toBe('TRN100000000');
  });

  it('chart_of_accounts has 32 system accounts (UAE)', async () => {
    if (!testCompanyId) return;
    const { data } = await adminClient
      .from('chart_of_accounts')
      .select('code')
      .eq('company_id', testCompanyId)
      .eq('is_system', true);
    expect(data).toBeTruthy();
    expect(data!.length).toBe(32);
    // Spot-check key accounts
    const codes = data!.map((r) => r.code);
    expect(codes).toContain('1100'); // Cash in Hand
    expect(codes).toContain('1200'); // AR
    expect(codes).toContain('1300'); // Inventory
    expect(codes).toContain('2100'); // AP
    expect(codes).toContain('2200'); // Output VAT
    expect(codes).toContain('4100'); // Sales Revenue
    expect(codes).toContain('5100'); // COGS
    // Must NOT contain India GST accounts
    expect(codes).not.toContain('1510');
    expect(codes).not.toContain('2210');
  });

  it('warehouses: 1 row with is_default=true', async () => {
    if (!testCompanyId) return;
    const { data } = await adminClient
      .from('warehouses')
      .select('*')
      .eq('company_id', testCompanyId);
    expect(data!.length).toBe(1);
    expect(data![0].is_default).toBe(true);
    expect(data![0].code).toBe('MAIN');
  });

  it('tax_rates: 1 row "UAE VAT 5%"', async () => {
    if (!testCompanyId) return;
    const { data } = await adminClient
      .from('tax_rates')
      .select('*')
      .eq('company_id', testCompanyId);
    expect(data!.length).toBe(1);
    expect(data![0].name).toBe('UAE VAT 5%');
    expect(data![0].rate).toBe(5);
    expect(data![0].tax_type).toBe('VAT');
  });

  it('payment_methods: 4 rows (Cash, Bank Transfer, Cheque, Card)', async () => {
    if (!testCompanyId) return;
    const { data } = await adminClient
      .from('payment_methods')
      .select('name')
      .eq('company_id', testCompanyId);
    expect(data!.length).toBe(4);
    const names = data!.map((r) => r.name).sort();
    expect(names).toEqual(['Bank Transfer', 'Card', 'Cash', 'Cheque']);
  });

  it('units_of_measure: 5 rows (PCS, SET, KG, LITRE, BOX)', async () => {
    if (!testCompanyId) return;
    const { data } = await adminClient
      .from('units_of_measure')
      .select('code')
      .eq('company_id', testCompanyId);
    expect(data!.length).toBe(5);
    const codes = data!.map((r) => r.code).sort();
    expect(codes).toEqual(['BOX', 'KG', 'LITRE', 'PCS', 'SET']);
  });

  it('bank_accounts: 1 row linked to COA 1110', async () => {
    if (!testCompanyId) return;
    const { data: bankAccounts } = await adminClient
      .from('bank_accounts')
      .select('*, chart_of_accounts!bank_accounts_coa_account_id_fkey(code)')
      .eq('company_id', testCompanyId);
    expect(bankAccounts!.length).toBe(1);

    const coa = bankAccounts![0].chart_of_accounts as { code: string } | null;
    expect(coa?.code).toBe('1110');
    expect(bankAccounts![0].is_default).toBe(true);
  });

  it('profiles table has correct admin row', async () => {
    if (!testUserId) return;
    const { data } = await adminClient
      .from('profiles')
      .select('*')
      .eq('id', testUserId)
      .single();
    expect(data).toBeTruthy();
    expect(data!.role).toBe('admin');
    expect(data!.company_id).toBe(testCompanyId);
  });
});
