/**
 * AC-4B — golden-fixture tests for the UAE PINT-AE UBL 2.1 XML formatter.
 * Run: npx vitest run tests/unit/einvoice-pint-ae.test.ts
 *
 * The XML is asserted with a full-string golden for the base case (locks the
 * exact format/ordering/indentation) plus targeted structural checks for the
 * zero-rated case.
 */
import { describe, it, expect } from 'vitest';
import { buildCanonicalInvoice, type CanonicalBuildInput } from '../../src/lib/einvoice/canonical';
import { toPintAeUbl } from '../../src/lib/einvoice/pint-ae';

function aeInput(over: Partial<CanonicalBuildInput> = {}): CanonicalBuildInput {
  return {
    supplier: { legal_name: 'StockBolt Auto FZE', tax_id: '100000000000003', country_code: 'AE', state_code: null, address_line: 'Sheikh Zayed Rd', city: 'Dubai', pincode: null },
    buyer: { legal_name: 'Gulf Motors LLC', tax_id: '100000000000012', buyer_type: 'registered', country_code: 'AE', place_of_supply_code: null, state_code: null, address_line: 'Al Quoz', city: 'Dubai', pincode: null },
    document: { number: 'INV-2001', date: '2026-07-05', currency: 'AED', is_export: false, reference: null },
    lines: [{ description: 'Oil Filter', hsn_code: null, is_service: false, quantity: 3, unit: 'PCS', unit_price: 50, discount_amount: 0, taxable_value: 150, tax_rate: 5, tax_amount: 7.5, line_total: 157.5, default_tax_treatment: null }],
    totals: { subtotal: 150, discount: 0, tax_total: 7.5, round_off: 0, grand_total: 157.5 },
    ...over,
  };
}

const GOLDEN_STANDARD = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
  <cbc:CustomizationID>urn:peppol:pint:billing-1@ae-1</cbc:CustomizationID>
  <cbc:ProfileID>urn:peppol:bis:billing</cbc:ProfileID>
  <cbc:ID>INV-2001</cbc:ID>
  <cbc:IssueDate>2026-07-05</cbc:IssueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>AED</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PostalAddress>
        <cbc:StreetName>Sheikh Zayed Rd</cbc:StreetName>
        <cbc:CityName>Dubai</cbc:CityName>
        <cac:Country>
          <cbc:IdentificationCode>AE</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>100000000000003</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>StockBolt Auto FZE</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PostalAddress>
        <cbc:StreetName>Al Quoz</cbc:StreetName>
        <cbc:CityName>Dubai</cbc:CityName>
        <cac:Country>
          <cbc:IdentificationCode>AE</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>100000000000012</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Gulf Motors LLC</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="AED">7.50</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="AED">150.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="AED">7.50</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>5.00</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="AED">150.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="AED">150.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="AED">157.50</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="AED">157.50</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="PCS">3</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="AED">150.00</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>Oil Filter</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>5.00</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="AED">50.00</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>
</Invoice>
`;

describe('toPintAeUbl — standard-rated domestic (golden)', () => {
  it('renders the exact PINT-AE UBL document', () => {
    expect(toPintAeUbl(buildCanonicalInvoice(aeInput()))).toBe(GOLDEN_STANDARD);
  });
});

describe('toPintAeUbl — zero-rated export', () => {
  it('uses tax category Z at 0% and zero tax amounts', () => {
    const xml = toPintAeUbl(buildCanonicalInvoice(aeInput({
      buyer: { legal_name: 'Overseas Ltd', tax_id: null, buyer_type: 'export', country_code: 'IN', place_of_supply_code: null, state_code: null, address_line: 'x', city: 'Mumbai', pincode: null },
      document: { number: 'INV-2002', date: '2026-07-06', currency: 'AED', is_export: true, reference: null },
      lines: [{ description: 'Brake Disc', hsn_code: null, is_service: false, quantity: 1, unit: 'PCS', unit_price: 200, discount_amount: 0, taxable_value: 200, tax_rate: 0, tax_amount: 0, line_total: 200, default_tax_treatment: null }],
      totals: { subtotal: 200, discount: 0, tax_total: 0, round_off: 0, grand_total: 200 },
    })));
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<cbc:CustomizationID>urn:peppol:pint:billing-1@ae-1</cbc:CustomizationID>');
    expect(xml).not.toContain('<cbc:ID>S</cbc:ID>'); // no standard-rate category
    expect(xml).toContain('<cbc:ID>Z</cbc:ID>');
    expect(xml).toContain('<cbc:Percent>0.00</cbc:Percent>');
    expect(xml).toContain('<cbc:TaxAmount currencyID="AED">0.00</cbc:TaxAmount>');
    expect(xml).toContain('<cbc:PayableAmount currencyID="AED">200.00</cbc:PayableAmount>');
    expect(xml.trimEnd().endsWith('</Invoice>')).toBe(true);
  });

  it('escapes XML-special characters in text', () => {
    const xml = toPintAeUbl(buildCanonicalInvoice(aeInput({
      lines: [{ description: 'Bolt <M8> & washer', hsn_code: null, is_service: false, quantity: 1, unit: 'PCS', unit_price: 10, discount_amount: 0, taxable_value: 10, tax_rate: 5, tax_amount: 0.5, line_total: 10.5, default_tax_treatment: null }],
      totals: { subtotal: 10, discount: 0, tax_total: 0.5, round_off: 0, grand_total: 10.5 },
    })));
    expect(xml).toContain('<cbc:Name>Bolt &lt;M8&gt; &amp; washer</cbc:Name>');
  });
});
