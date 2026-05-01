import type { DataAdapter, CoaMap } from '@/data/adapter';

/**
 * Seeds default tax rates per country.
 * Links each rate to the correct Input/Output tax COA accounts.
 * Per Doc 3 Part A tax codes.
 */
export async function seedTaxRates(
  company_id: string,
  country_code: string,
  coa_map: CoaMap,
  adapter: DataAdapter,
): Promise<void> {
  if (country_code === 'IN') {
    // India GST — three rates (CGST, SGST pair + IGST)
    const rates = [
      {
        name: 'GST 18% (CGST 9% + SGST 9%)',
        rate: 18,
        tax_type: 'GST',
        coa_input_account_id: coa_map['1510'] ?? null,
        coa_output_account_id: coa_map['2210'] ?? null,
      },
      {
        name: 'IGST 18% (Interstate)',
        rate: 18,
        tax_type: 'IGST',
        coa_input_account_id: coa_map['1530'] ?? null,
        coa_output_account_id: coa_map['2230'] ?? null,
      },
      {
        name: 'GST 5% (Reduced)',
        rate: 5,
        tax_type: 'GST',
        coa_input_account_id: coa_map['1510'] ?? null,
        coa_output_account_id: coa_map['2210'] ?? null,
      },
      {
        name: 'GST 12%',
        rate: 12,
        tax_type: 'GST',
        coa_input_account_id: coa_map['1510'] ?? null,
        coa_output_account_id: coa_map['2210'] ?? null,
      },
    ];
    for (const r of rates) {
      await adapter.onboarding.insertTaxRate({ company_id, is_active: true, ...r });
    }
    return;
  }

  // UAE: 5% VAT standard
  if (country_code === 'AE') {
    await adapter.onboarding.insertTaxRate({
      company_id,
      name: 'UAE VAT 5%',
      rate: 5,
      tax_type: 'VAT',
      is_active: true,
      coa_input_account_id: coa_map['1500'] ?? null,
      coa_output_account_id: coa_map['2200'] ?? null,
    });
    return;
  }

  // Other GCC — all levy VAT at 5% (KSA, KW, BH, OM, QA all have VAT now)
  const gccCountryNames: Record<string, string> = {
    SA: 'KSA',
    KW: 'Kuwait',
    BH: 'Bahrain',
    OM: 'Oman',
    QA: 'Qatar',
  };
  const label = gccCountryNames[country_code] ?? country_code;
  await adapter.onboarding.insertTaxRate({
    company_id,
    name: `${label} VAT 5%`,
    rate: 5,
    tax_type: 'VAT',
    is_active: true,
    coa_input_account_id: coa_map['1500'] ?? null,
    coa_output_account_id: coa_map['2200'] ?? null,
  });
}
