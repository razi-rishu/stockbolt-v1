import { defaultTaxRate } from '@/lib/locale';
import type { DataAdapter, CoaMap, TaxRateRow } from '@/data/adapter';

/**
 * Links a new company's tax rates to its tax accounts (Doc 3 Part A tax codes).
 *
 * phase118 — the rates themselves come from the database: the trigger on
 * companies (seed_default_tax_rates) creates them the moment the company is
 * inserted. This used to insert a second set ('UAE VAT 5%' on top of
 * 'Standard Rate 5%'), which is how every company since phase21 ended up with
 * two 5% rates. Now it only fills in the account links, and adds India's
 * IGST rate, which the database set doesn't carry.
 *
 * Only when a database has no seed trigger at all (no rates exist) does it
 * insert the set itself, typed by product tax category like the trigger.
 * Rows typed 'VAT' / 'none' by the pre-phase118 trigger are linked too, so no
 * duplicate appears whichever version of the trigger is installed.
 */
export async function seedTaxRates(
  company_id: string,
  country_code: string,
  coa_map: CoaMap,
  adapter: DataAdapter,
): Promise<void> {
  const india = country_code === 'IN';
  const acc = (code: string) => coa_map[code] ?? null;

  let rates: TaxRateRow[] = await adapter.taxRates.listAll(company_id);
  if (rates.length === 0) {
    const fallback = india
      ? [0, 5, 18, 40].map((r) => ({ name: `GST ${r}%`, rate: r, tax_type: 'GST' }))   // GST 2.0 slabs (2025-09-22)
      : [
          // Phase 4: the country's verified standard rate (SA 15, BH 10, AE/OM 5, KW/QA 0).
          { name: `Standard Rate ${defaultTaxRate(country_code)}%`, rate: defaultTaxRate(country_code), tax_type: 'standard' },
          { name: 'Zero-rated 0%', rate: 0, tax_type: 'zero_rated' },
          { name: 'Exempt', rate: 0, tax_type: 'exempt' },
        ];
    for (const r of fallback) await adapter.onboarding.insertTaxRate({ company_id, is_active: true, ...r });
    rates = await adapter.taxRates.listAll(company_id);
  }

  if (india && !rates.some((r) => r.tax_type === 'IGST')) {
    await adapter.onboarding.insertTaxRate({
      company_id, name: 'IGST 18% (Interstate)', rate: 18, tax_type: 'IGST', is_active: true,
      coa_input_account_id: acc('1530'), coa_output_account_id: acc('2230'),
    });
  }

  // Input / output accounts by tax type. Exempt carries no tax: no accounts.
  const links: Record<string, [string, string]> = india
    ? { GST: ['1510', '2210'], IGST: ['1530', '2230'] }
    : { standard: ['1500', '2200'], zero_rated: ['1500', '2200'], VAT: ['1500', '2200'] };
  for (const r of rates) {
    const pair = links[r.tax_type];
    if (!pair || r.coa_output_account_id) continue;
    await adapter.taxRates.update(r.id, { coa_input_account_id: acc(pair[0]), coa_output_account_id: acc(pair[1]) });
  }
}
