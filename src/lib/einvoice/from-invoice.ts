/**
 * AC-4D — assemble a CanonicalBuildInput from the real StockBolt rows.
 *
 * Pure mapper (no React, no DB): turns a confirmed invoice + its stored items +
 * the customer + the company + the referenced products into the jurisdiction-
 * neutral CanonicalBuildInput the AC-4B formatters consume. Amounts are taken
 * straight from the stored invoice_items / invoice header — never recomputed.
 *
 * Design notes:
 *  • Supplier GST state code is derived from the company GSTIN (first 2 digits
 *    encode the state) — so no separate company "state" field is needed.
 *  • Buyer state = the contact's captured place-of-supply, else the buyer GSTIN
 *    prefix. Per-line HSN / is_service / default treatment come from the product.
 */
import type { CanonicalBuildInput } from './canonical';

export type Jurisdiction = 'IN_GST' | 'AE_VAT';
export type EInvoiceFormat = 'india_gst_json' | 'pint_ae_ubl';

/** India → GST JSON; everything else (UAE + GCC) → PINT-AE UBL. */
export function jurisdictionAndFormat(country_code: string | null | undefined): {
  jurisdiction: Jurisdiction;
  format: EInvoiceFormat;
  supported: boolean;
} {
  if (country_code === 'IN') return { jurisdiction: 'IN_GST', format: 'india_gst_json', supported: true };
  if (country_code === 'AE') return { jurisdiction: 'AE_VAT', format: 'pint_ae_ubl', supported: true };
  // Other GCC VAT countries have no formatter yet (PINT-AE is UAE-specific).
  return { jurisdiction: 'AE_VAT', format: 'pint_ae_ubl', supported: false };
}

/** The 2-digit GST state code encoded in a GSTIN, if it looks like one. */
function gstinStateCode(tax_id: string | null | undefined): string | null {
  const t = (tax_id ?? '').trim();
  return /^\d{2}/.test(t) ? t.slice(0, 2) : null;
}

// Narrow structural inputs — the real Row types satisfy these by width.
export interface AssembleInput {
  company: { name: string; tax_id: string | null; country_code: string | null; address: string | null };
  invoice: {
    invoice_number: string; date: string; currency: string;
    is_export?: boolean | null; reference: string | null;
    subtotal: number; discount_amount: number; tax_amount: number;
    round_off_amount?: number | null; total_amount: number;
  };
  customer: {
    name: string; tax_id: string | null;
    buyer_type?: string | null; place_of_supply_code?: string | null; country_code?: string | null;
    address_street?: string | null; address_city?: string | null; address_postal?: string | null;
  } | null;
  items: Array<{
    description: string | null; product_id: string | null;
    quantity: number; unit_id: string | null; unit_price: number;
    discount_amount: number; line_subtotal: number;
    tax_rate: number | null; tax_amount: number; line_total: number;
  }>;
  products: Array<{ id: string; name: string; hsn_code?: string | null; default_tax_treatment?: string | null; type?: string | null }>;
  unitCodeById?: Record<string, string>;
}

export function assembleCanonicalFromInvoice(input: AssembleInput): CanonicalBuildInput {
  const isIndia = input.company.country_code === 'IN';
  const productById = new Map(input.products.map((p) => [p.id, p]));

  return {
    supplier: {
      legal_name: input.company.name,
      tax_id: input.company.tax_id,
      country_code: input.company.country_code,
      state_code: isIndia ? gstinStateCode(input.company.tax_id) : null,
      address_line: input.company.address,
      city: null,
      pincode: null,
    },
    buyer: {
      legal_name: input.customer?.name ?? '',
      tax_id: input.customer?.tax_id ?? null,
      buyer_type: input.customer?.buyer_type ?? null,
      country_code: input.customer?.country_code ?? null,
      place_of_supply_code: input.customer?.place_of_supply_code ?? null,
      state_code: input.customer?.place_of_supply_code
        ?? (isIndia ? gstinStateCode(input.customer?.tax_id) : null),
      address_line: input.customer?.address_street ?? null,
      city: input.customer?.address_city ?? null,
      pincode: input.customer?.address_postal ?? null,
    },
    document: {
      number: input.invoice.invoice_number,
      date: input.invoice.date,
      currency: input.invoice.currency,
      is_export: !!input.invoice.is_export,
      reference: input.invoice.reference,
    },
    lines: input.items.map((it) => {
      const p = it.product_id ? productById.get(it.product_id) : undefined;
      return {
        description: it.description ?? p?.name ?? '',
        hsn_code: p?.hsn_code ?? null,
        is_service: p?.type === 'service',
        quantity: it.quantity,
        unit: (it.unit_id ? input.unitCodeById?.[it.unit_id] : null) ?? null,
        unit_price: it.unit_price,
        discount_amount: it.discount_amount,
        taxable_value: it.line_subtotal,
        tax_rate: it.tax_rate ?? 0,
        tax_amount: it.tax_amount,
        line_total: it.line_total,
        default_tax_treatment: p?.default_tax_treatment ?? null,
      };
    }),
    totals: {
      subtotal: input.invoice.subtotal,
      discount: input.invoice.discount_amount,
      tax_total: input.invoice.tax_amount,
      round_off: input.invoice.round_off_amount ?? 0,
      grand_total: input.invoice.total_amount,
    },
  };
}
