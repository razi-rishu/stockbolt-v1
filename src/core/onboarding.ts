import type { DataAdapter, OnboardingRpcInput, CoaMap } from '@/data/adapter';
import { seedCOA } from './seeds/seedCOA';
import { seedTaxRates } from './seeds/seedTaxRates';
import { seedPaymentMethods } from './seeds/seedPaymentMethods';
import { seedUnits } from './seeds/seedUnits';
import { seedSampleData } from './seeds/seedSampleData';

export interface WizardData {
  // Step 1 — Company basics
  company_name: string;
  company_name_ar: string;
  address: string;
  full_name: string;

  // Step 2 — Country & tax
  country_code: string;
  is_tax_registered: boolean;
  tax_id: string;

  // Step 3 — Currency & fiscal year
  currency: string;
  fiscal_year_start: string; // YYYY-MM-DD

  // Step 4 — First warehouse
  warehouse_name: string;
  warehouse_name_ar: string;
  warehouse_code: string;

  // Step 5 — Bank/cash account
  bank_account_name: string;
  bank_account_name_ar: string;
  bank_account_type: 'bank' | 'cash';
  bank_name: string;
  account_number: string;

  // Step 6 — Sample data
  load_sample_data: boolean;
}

/**
 * Orchestrates the complete onboarding sequence.
 *
 * Step A: SECURITY DEFINER RPC creates company + profile (bypasses RLS).
 * Step B: TypeScript seed services run under the anon key (profile now
 *         exists, so current_user_company_id() works for all inserts).
 */
export async function runOnboarding(
  wizard: WizardData,
  adapter: DataAdapter,
): Promise<{ company_id: string }> {
  // A — Create company + profile via SECURITY DEFINER Postgres function
  const rpcInput: OnboardingRpcInput = {
    company_name: wizard.company_name,
    company_name_ar: wizard.company_name_ar,
    address: wizard.address,
    country_code: wizard.country_code,
    currency: wizard.currency,
    fiscal_year_start: wizard.fiscal_year_start,
    is_tax_registered: wizard.is_tax_registered,
    tax_id: wizard.tax_id,
    full_name: wizard.full_name,
  };
  const { company_id } = await adapter.onboarding.createCompanyAndProfile(rpcInput);

  // B — Seed foundational data (anon key, RLS now functional)
  const coa_map: CoaMap = await seedCOA(company_id, wizard.country_code, adapter);
  await seedTaxRates(company_id, wizard.country_code, coa_map, adapter);
  await seedPaymentMethods(company_id, adapter);
  await seedUnits(company_id, adapter);

  // C — Create first warehouse
  await adapter.onboarding.insertWarehouse({
    company_id,
    name: wizard.warehouse_name,
    name_ar: wizard.warehouse_name_ar,
    code: wizard.warehouse_code || 'MAIN',
    is_default: true,
    is_active: true,
  });

  // D — Create first bank/cash account linked to COA
  const coa_code = wizard.bank_account_type === 'cash' ? '1100' : '1110';
  const coa_account_id = coa_map[coa_code];
  if (!coa_account_id) {
    throw new Error(`COA account ${coa_code} not found after seeding`);
  }
  await adapter.onboarding.insertBankAccount({
    company_id,
    name: wizard.bank_account_name,
    name_ar: wizard.bank_account_name_ar,
    account_type: wizard.bank_account_type === 'cash' ? 'cash' : 'bank',
    bank_name: wizard.bank_name || null,
    account_number: wizard.account_number || null,
    currency: wizard.currency,
    coa_account_id,
    is_default: true,
    is_active: true,
    opening_balance: 0,
  });

  // E — Optionally seed sample auto-parts data
  if (wizard.load_sample_data) {
    const warehouses = await adapter.warehouses.list(company_id);
    const warehouse_id = warehouses[0]?.id ?? '';
    await seedSampleData(company_id, adapter, warehouse_id);
  }

  return { company_id };
}
