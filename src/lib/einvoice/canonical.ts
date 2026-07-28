/**
 * AC-4B — Canonical e-invoice model (pure, offline).
 *
 * A jurisdiction-neutral intermediate representation of a sales invoice, built
 * once from the fields AC-4A/AC-4A.2 capture, then handed to a jurisdiction
 * formatter (India GST JSON / UAE PINT-AE UBL). No React, no DB, no network,
 * no signing, no IRN/QR — this only re-shapes and derives.
 *
 * The tax SPLIT here (CGST/SGST vs IGST for India; category code for UAE) is a
 * presentation of the tax the posting engine already computed — it never
 * re-derives or changes any tax amount. `tax_amount` on each input line is the
 * authoritative figure; we only allocate it across the right heads.
 */
import { resolveLineTreatment, isValidStateCode, type TaxTreatment } from '../einvoice-metadata';

// ── Input (mapped from real rows by AC-4C/AC-4D; kept row-agnostic here) ──────
export interface CanonicalParty {
  legal_name: string;
  tax_id: string | null;        // GSTIN (India) / TRN (UAE)
  country_code: string | null;  // ISO-2, e.g. 'IN' | 'AE'
  state_code: string | null;    // India GST state code (place of establishment)
  address_line: string | null;
  city: string | null;
  pincode: string | null;
}

export interface CanonicalLineInput {
  description: string;
  hsn_code: string | null;
  is_service: boolean;
  quantity: number;
  unit: string | null;
  unit_price: number;
  discount_amount: number;      // absolute, on the line
  taxable_value: number;        // assessable / net value (after discount, before tax)
  tax_rate: number;             // percent
  tax_amount: number;           // total tax on the line (authoritative)
  line_total: number;           // taxable_value + tax_amount
  default_tax_treatment: string | null;
}

export interface CanonicalBuildInput {
  supplier: CanonicalParty;
  buyer: CanonicalParty & { buyer_type: string | null; place_of_supply_code: string | null };
  document: {
    number: string;
    date: string;               // ISO yyyy-mm-dd
    currency: string;
    is_export: boolean;
    reference: string | null;
  };
  lines: CanonicalLineInput[];
  totals: {
    subtotal: number;           // sum of taxable values (pre-tax, post-discount)
    discount: number;
    tax_total: number;
    round_off: number;
    grand_total: number;
  };
}

// ── Output (the canonical, formatter-ready shape) ────────────────────────────
export type Jurisdiction = 'IN_GST' | 'AE_VAT';
export type SupplyType = 'B2B' | 'B2C' | 'EXPWP' | 'EXPWOP' | 'SEZWP' | 'SEZWOP';

export interface CanonicalLine {
  sl_no: number;
  description: string;
  hsn_code: string | null;
  is_service: boolean;
  quantity: number;
  unit: string | null;
  unit_price: number;
  discount_amount: number;
  taxable_value: number;
  tax_rate: number;
  treatment: TaxTreatment;
  // India allocation of tax_amount across heads:
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  // UAE UBL tax-category code (UNCL5305 subset): S/Z/E/O/AE:
  tax_category_code: string;
  total_tax: number;
  line_total: number;
}

export interface CanonicalInvoice {
  jurisdiction: Jurisdiction;
  supply_type: SupplyType;
  is_intra_state: boolean;      // India: supplier state == place of supply
  place_of_supply_code: string | null;
  supplier: CanonicalParty;
  buyer: CanonicalParty & { buyer_type: string | null };
  document: CanonicalBuildInput['document'];
  lines: CanonicalLine[];
  totals: {
    assessable: number;
    discount: number;
    cgst: number;
    sgst: number;
    igst: number;
    tax_total: number;
    round_off: number;
    grand_total: number;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }

/** UBL tax-category code (UNCL5305 subset) for a resolved treatment. */
export function uaeTaxCategoryCode(t: TaxTreatment): string {
  switch (t) {
    case 'zero_rated':
    case 'export':        return 'Z';
    case 'exempt':        return 'E';
    case 'out_of_scope':  return 'O';
    case 'reverse_charge':return 'AE';
    case 'standard':
    default:              return 'S';
  }
}

/** India NIC supply type from buyer class + export/tax. */
export function indiaSupplyType(buyerType: string | null, isExport: boolean, taxTotal: number): SupplyType {
  if (isExport) return taxTotal > 0 ? 'EXPWP' : 'EXPWOP';
  if (buyerType === 'sez') return taxTotal > 0 ? 'SEZWP' : 'SEZWOP';
  if (buyerType === 'unregistered') return 'B2C';
  return 'B2B';
}

/**
 * Build the canonical invoice. Pure: derives jurisdiction, supply type, place
 * of supply, intra/inter-state, and allocates each line's tax across heads.
 */
export function buildCanonicalInvoice(input: CanonicalBuildInput): CanonicalInvoice {
  const jurisdiction: Jurisdiction = input.supplier.country_code === 'IN' ? 'IN_GST' : 'AE_VAT';
  const isExport = !!input.document.is_export;

  // Place of supply: India uses '96' (other country) for exports.
  const pos = isExport
    ? '96'
    : (input.buyer.place_of_supply_code || input.buyer.state_code || null);

  const isIntraState =
    jurisdiction === 'IN_GST' &&
    !isExport &&
    isValidStateCode(input.supplier.state_code) &&
    isValidStateCode(pos) &&
    input.supplier.state_code === pos;

  const lines: CanonicalLine[] = input.lines.map((l, i) => {
    const treatment = resolveLineTreatment(
      { default_tax_treatment: l.default_tax_treatment },
      { is_export: isExport },
    );
    const tax = round2(l.tax_amount);
    // Inter-state / export → IGST; intra-state → CGST + SGST (split evenly, the
    // second head absorbs any rounding remainder so the two sum to `tax`).
    let cgst = 0, sgst = 0, igst = 0;
    if (jurisdiction === 'IN_GST') {
      if (isIntraState) {
        cgst = round2(tax / 2);
        sgst = round2(tax - cgst);
      } else {
        igst = tax;
      }
    }
    return {
      sl_no: i + 1,
      description: l.description,
      hsn_code: l.hsn_code,
      is_service: l.is_service,
      quantity: l.quantity,
      unit: l.unit,
      unit_price: round2(l.unit_price),
      discount_amount: round2(l.discount_amount),
      taxable_value: round2(l.taxable_value),
      tax_rate: l.tax_rate,
      treatment,
      cgst_amount: cgst,
      sgst_amount: sgst,
      igst_amount: igst,
      tax_category_code: uaeTaxCategoryCode(treatment),
      total_tax: tax,
      line_total: round2(l.line_total),
    };
  });

  const sum = (pick: (l: CanonicalLine) => number) => round2(lines.reduce((s, l) => s + pick(l), 0));

  return {
    jurisdiction,
    supply_type: indiaSupplyType(input.buyer.buyer_type, isExport, input.totals.tax_total),
    is_intra_state: isIntraState,
    place_of_supply_code: pos,
    supplier: input.supplier,
    buyer: input.buyer,
    document: input.document,
    lines,
    totals: {
      assessable: round2(input.totals.subtotal),
      discount: round2(input.totals.discount),
      cgst: sum((l) => l.cgst_amount),
      sgst: sum((l) => l.sgst_amount),
      igst: sum((l) => l.igst_amount),
      tax_total: round2(input.totals.tax_total),
      round_off: round2(input.totals.round_off),
      grand_total: round2(input.totals.grand_total),
    },
  };
}
