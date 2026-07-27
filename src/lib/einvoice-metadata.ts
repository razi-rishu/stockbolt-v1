/**
 * AC-4A — E-invoice / tax classification metadata: pure logic + types.
 *
 * The shared foundation for e-invoicing (AC-4) and AC-3 full-fidelity. No React,
 * no data access, no tax recompute — just the enums, the India GST state-code
 * reference, and small pure helpers that classify a document for a compliant
 * e-invoice / a complete VAT201-GSTR return.
 */

// ── Enums ─────────────────────────────────────────────────────────────────────
export type TaxTreatment =
  | 'standard' | 'zero_rated' | 'exempt' | 'reverse_charge' | 'export' | 'out_of_scope';
export const TAX_TREATMENTS: readonly TaxTreatment[] =
  ['standard', 'zero_rated', 'exempt', 'reverse_charge', 'export', 'out_of_scope'] as const;
export function isTaxTreatment(v: unknown): v is TaxTreatment {
  return typeof v === 'string' && (TAX_TREATMENTS as readonly string[]).includes(v);
}

export type BuyerType = 'registered' | 'unregistered' | 'export' | 'sez' | 'composition';
export const BUYER_TYPES: readonly BuyerType[] =
  ['registered', 'unregistered', 'export', 'sez', 'composition'] as const;
export function isBuyerType(v: unknown): v is BuyerType {
  return typeof v === 'string' && (BUYER_TYPES as readonly string[]).includes(v);
}

// ── India GST state codes (place of supply) ──────────────────────────────────
export interface GstStateCode { code: string; name: string }
export const GST_STATE_CODES: readonly GstStateCode[] = [
  { code: '01', name: 'Jammu & Kashmir' }, { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' }, { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' }, { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' }, { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' }, { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' }, { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' }, { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' }, { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' }, { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' }, { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' }, { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' }, { code: '24', name: 'Gujarat' },
  { code: '25', name: 'Daman & Diu' }, { code: '26', name: 'Dadra & Nagar Haveli and Daman & Diu' },
  { code: '27', name: 'Maharashtra' }, { code: '28', name: 'Andhra Pradesh (Old)' },
  { code: '29', name: 'Karnataka' }, { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' }, { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' }, { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman & Nicobar Islands' }, { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' }, { code: '38', name: 'Ladakh' },
  { code: '97', name: 'Other Territory' }, { code: '99', name: 'Centre Jurisdiction' },
];
const STATE_CODE_SET = new Set(GST_STATE_CODES.map((s) => s.code));
export function isValidStateCode(code: string | null | undefined): boolean {
  return !!code && STATE_CODE_SET.has(code);
}
export function stateNameForCode(code: string | null | undefined): string | null {
  return GST_STATE_CODES.find((s) => s.code === code)?.name ?? null;
}

// ── Classification helpers ───────────────────────────────────────────────────
/** Suggest the buyer type from an explicit value, else infer from tax_id presence. */
export function suggestBuyerType(contact: { tax_id?: string | null; buyer_type?: string | null }): BuyerType {
  if (isBuyerType(contact.buyer_type)) return contact.buyer_type;
  return contact.tax_id && contact.tax_id.trim() ? 'registered' : 'unregistered';
}

/** The line's effective treatment: an export invoice forces 'export'; else the
 *  product default; else 'standard'. */
export function resolveLineTreatment(
  product: { default_tax_treatment?: string | null },
  invoice: { is_export?: boolean | null },
): TaxTreatment {
  if (invoice.is_export) return 'export';
  return isTaxTreatment(product.default_tax_treatment) ? product.default_tax_treatment : 'standard';
}

// ── E-invoice readiness (drives the UI hint; reused by AC-4B/AC-4D) ───────────
export interface ReadinessInput {
  jurisdiction: 'AE_VAT' | 'IN_GST';
  is_export?: boolean | null;
  contact: { tax_id?: string | null; place_of_supply_code?: string | null; buyer_type?: string | null };
  lines: { hsn_code?: string | null; description?: string | null }[];
}
export interface Readiness { ready: boolean; missing: string[] }

/**
 * List the fields a compliant e-invoice needs but the document is missing.
 * Pure + jurisdiction-aware; non-blocking (the UI shows these as hints).
 */
export function eInvoiceReadiness(input: ReadinessInput): Readiness {
  const missing: string[] = [];
  const buyerType = suggestBuyerType(input.contact);
  const isExport = !!input.is_export || buyerType === 'export';

  if (input.jurisdiction === 'IN_GST') {
    // India: HSN per line, buyer GSTIN for B2B, and a place-of-supply state.
    if (buyerType === 'registered' && !(input.contact.tax_id && input.contact.tax_id.trim())) {
      missing.push('Buyer GSTIN (registered buyer)');
    }
    if (!isExport && !isValidStateCode(input.contact.place_of_supply_code)) {
      missing.push('Place of supply (GST state code)');
    }
    input.lines.forEach((l, i) => {
      if (!(l.hsn_code && l.hsn_code.trim())) missing.push(`HSN/SAC code for line ${i + 1}${l.description ? ` (${l.description})` : ''}`);
    });
  } else {
    // UAE: buyer TRN for a registered (B2B) supply.
    if (buyerType === 'registered' && !(input.contact.tax_id && input.contact.tax_id.trim())) {
      missing.push('Buyer Tax Registration Number (TRN)');
    }
  }

  return { ready: missing.length === 0, missing };
}
