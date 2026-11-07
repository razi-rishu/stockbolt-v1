import { defaultTaxRate } from '@/lib/locale';
import { vatApplies } from '@/core/global-config/country-packs';
import type { DataAdapter, CoaMap, TaxRateRow } from '@/data/adapter';

/** India GST 2.0 (from 2025-09-22): slabs + the Notification 9/2025-IT(R) specials. */
const INDIA_GST: { name: string; rate: number }[] = [
  { name: 'GST 0%', rate: 0 }, { name: 'GST 5%', rate: 5 }, { name: 'GST 18%', rate: 18 }, { name: 'GST 40%', rate: 40 },
  { name: 'GST 3% (gold, silver, jewellery)', rate: 3 },
  { name: 'GST 1.5% (cut & polished diamonds)', rate: 1.5 },
  { name: 'GST 0.25% (rough diamonds)', rate: 0.25 },
];

/**
 * Links a new company's tax rates to its tax accounts (Doc 3 Part A tax codes).
 *
 * phase118 — the rates themselves come from the database: the trigger on
 * companies (seed_default_tax_rates) creates them the moment the company is
 * inserted. This only fills in the account links.
 *
 * phase123 (Global Phase 4 decisions, 2026-11-07):
 *  1. Kuwait / Qatar have no VAT: no tax codes are created or linked.
 *  2. India gets the GST 2.0 slabs plus the 3 / 1.5 / 0.25 % specials;
 *     specials are selectable, never the default.
 *  3. No manual IGST row for new companies: the posting engine (phase122)
 *     decides CGST + SGST or IGST from the place of supply. An existing
 *     company's IGST row is left alone and still linked.
 *
 * Only when a database has no seed trigger at all (no rates exist) does it
 * insert the set itself, typed by product tax category like the trigger.
 */
export async function seedTaxRates(
  company_id: string,
  country_code: string,
  coa_map: CoaMap,
  adapter: DataAdapter,
): Promise<void> {
  if (!vatApplies(country_code)) return;   // decision 1: no VAT, no tax codes
  const india = country_code === 'IN';
  const acc = (code: string) => coa_map[code] ?? null;

  let rates: TaxRateRow[] = await adapter.taxRates.listAll(company_id);
  if (rates.length === 0) {
    const fallback = india
      ? INDIA_GST.map((r) => ({ ...r, tax_type: 'GST' }))
      : [
          // The country's verified standard rate (SA 15, BH 10, AE / OM 5).
          { name: `Standard Rate ${defaultTaxRate(country_code)}%`, rate: defaultTaxRate(country_code), tax_type: 'standard' },
          { name: 'Zero-rated 0%', rate: 0, tax_type: 'zero_rated' },
          { name: 'Exempt', rate: 0, tax_type: 'exempt' },
        ];
    for (const r of fallback) await adapter.onboarding.insertTaxRate({ company_id, is_active: true, ...r });
    rates = await adapter.taxRates.listAll(company_id);
  }

  // Input / output accounts by tax type. Exempt carries no tax: no accounts.
  // GST links to the CGST pair nominally; phase122 posts the real split.
  const links: Record<string, [string, string]> = india
    ? { GST: ['1510', '2210'], IGST: ['1530', '2230'] }
    : { standard: ['1500', '2200'], zero_rated: ['1500', '2200'], VAT: ['1500', '2200'] };
  for (const r of rates) {
    const pair = links[r.tax_type];
    if (!pair || r.coa_output_account_id) continue;
    await adapter.taxRates.update(r.id, { coa_input_account_id: acc(pair[0]), coa_output_account_id: acc(pair[1]) });
  }
}
