import type { DataAdapter, OnboardingRpcInput } from '@/data/adapter';
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

  // Step 5 — Sample data
  // (Phase 14.13h removed the "first bank account" step. Bank accounts
  //  are now created from Accounting → Chart of Accounts via the
  //  Phase 14.13d quick-create flow. This keeps onboarding lean and
  //  stops operators from accidentally typing personal names into the
  //  account-name field during setup — the "Rashid" trap.)
  load_sample_data: boolean;
}

/**
 * Orchestrates the complete onboarding sequence.
 *
 * Step A: SECURITY DEFINER RPC creates company + profile (bypasses RLS).
 * Step B: TypeScript seed services run under the anon key (profile now
 *         exists, so current_user_company_id() works for all inserts).
 *
 * Note (Phase 14.13h): the operator no longer picks a first bank account
 * here. They land on the dashboard right after onboarding and add bank
 * accounts via Chart of Accounts → Add Custom Account under 1110 / 1100,
 * which auto-mirrors a bank_accounts row (Phase 14.13d flow). Reasons:
 *   - The CoA shows the parent context (1110 Bank Main, 1100 Cash) so
 *     the operator knows where the account fits in the trial balance.
 *   - "Account name" on a fresh form is a name-guessing trap — operators
 *     have typed their own name (the "Rashid" leak) instead of a bank
 *     name. Removing the field removes the trap.
 *   - Onboarding is now 5 steps instead of 6.
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
  const coa_map = await seedCOA(company_id, wizard.country_code, adapter);
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

  // D — (removed in Phase 14.13h: bank-account creation moved to CoA flow)

  // E — Optionally seed sample auto-parts data
  if (wizard.load_sample_data) {
    const warehouses = await adapter.warehouses.list(company_id);
    const warehouse_id = warehouses[0]?.id ?? '';
    await seedSampleData(company_id, adapter, warehouse_id);
  }

  return { company_id };
}
