/**
 * Saved-document → Signature DocumentData adapters — Phase 14.03.
 *
 * Lets the in-app view-mode renderers feed the Signature template with
 * data already loaded by the editor pages, without an extra round trip
 * to the DB. Each adapter is pure (records in → DocumentData out) so
 * it can also be reused by the /print/invoice/:id static print routes
 * once we wire those.
 *
 * NB: we deliberately tolerate sparse fields here — the editors only
 * fetch the rows they need, so we accept what we get and fall back to
 * sensible blanks. The Signature components themselves render every
 * optional slot only when content exists.
 */
import type {
  InvoiceRow, InvoiceItemRow, VendorBillRow, VendorBillItemRow,
  ContactRow, ProductRow, Company,
} from '@/data/adapter';

// Local alias so the file reads consistently with *Row naming elsewhere.
type CompanyRow = Company;
import type {
  DocumentData, DocumentStatus, LineItem, CompanyInfo, PartyInfo,
} from './types';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function companyToInfo(c: CompanyRow | null | undefined): CompanyInfo {
  // Company.tax_id holds the UAE TRN. Country comes from country_code (the
  // schema doesn't store a free-text country name). Website isn't on the
  // companies table today — we leave it blank rather than invent a slot.
  return {
    name:      c?.name ?? 'Your Company',
    name_ar:   c?.name_ar ?? undefined,
    trn:       c?.tax_id ?? null,
    address:   c?.address ?? null,
    city:      c?.city ?? null,
    country:   c?.country_code ?? null,
    phone:     c?.phone ?? null,
    email:     c?.email ?? null,
    website:   null,
    logo_url:  c?.logo_url ?? null,
  };
}

function contactToParty(c: ContactRow | null | undefined): PartyInfo {
  return {
    name:    c?.name ?? '—',
    name_ar: c?.name_ar ?? undefined,
    trn:     c?.tax_id ?? null,
    phone:   c?.phone ?? c?.mobile ?? null,
    email:   c?.email ?? null,
    address: c?.address_street ?? null,
    city:    c?.address_city ?? null,
    country: c?.address_country ?? null,
    contact: c?.contact_person_name ?? null,
  };
}

/** Group items by tax_rate for the VAT breakdown table. Skips rows where
 *  the rate is zero AND no tax was charged (saves space on the printout
 *  for zero-rated or exempt entries that would just say 0 / 0 / 0). */
function buildVatBreakdown(
  items: Array<{ tax_rate?: number | null; line_subtotal: number; tax_amount: number }>
): DocumentData['vat_breakdown'] {
  const map = new Map<number, { taxable: number; tax: number }>();
  for (const it of items) {
    const rate = Number(it.tax_rate ?? 0);
    const cur = map.get(rate) ?? { taxable: 0, tax: 0 };
    cur.taxable += Number(it.line_subtotal ?? 0);
    cur.tax     += Number(it.tax_amount ?? 0);
    map.set(rate, cur);
  }
  return Array.from(map.entries())
    .filter(([rate, v]) => rate > 0 || v.tax > 0)
    .map(([rate, v]) => ({ rate, taxable: v.taxable, tax: v.tax }))
    .sort((a, b) => a.rate - b.rate);
}

const INVOICE_STATUS_MAP: Record<string, DocumentStatus> = {
  draft:     'draft',
  confirmed: 'confirmed',
  void:      'void',
  paid:      'paid',
  partially_paid: 'partially_paid',
  overdue:   'overdue',
};

// ────────────────────────────────────────────────────────────────────────────
// Invoice → DocumentData
// ────────────────────────────────────────────────────────────────────────────

export interface InvoiceToDocInput {
  invoice:   InvoiceRow;
  items:     InvoiceItemRow[];
  contact:   ContactRow | null;
  company:   CompanyRow | null;
  /** Optional product lookup to enrich line descriptions with SKU. */
  products?: ProductRow[];
  /** Optional paid amount (from payment_allocations sum). */
  paidAmount?: number;
}

export function invoiceToDocumentData({
  invoice, items, contact, company, products, paidAmount,
}: InvoiceToDocInput): DocumentData {
  const productById: Record<string, ProductRow> = {};
  for (const p of products ?? []) productById[p.id] = p;

  const lines: LineItem[] = items.map((it, i) => {
    const prod = it.product_id ? productById[it.product_id] : null;
    return {
      index:        i + 1,
      sku:          prod?.sku ?? null,
      description:  it.description ?? prod?.name ?? '—',
      description_ar: prod?.name_ar ?? null,
      quantity:     Number(it.quantity ?? 0),
      unit_code:    null,                       // unit lookup deferred
      unit_price:   Number(it.unit_price ?? 0),
      discount_percent: Number(it.discount_percent ?? 0),
      discount_amount:  Number(it.discount_amount ?? 0),
      tax_rate:     Number(it.tax_rate ?? 0),
      tax_amount:   Number(it.tax_amount ?? 0),
      line_total:   Number(it.line_total ?? 0),
    };
  });

  const subtotal = Number(invoice.subtotal ?? 0);
  const tax      = Number(invoice.tax_amount ?? 0);
  const total    = Number(invoice.total_amount ?? 0);
  const paid     = paidAmount ?? 0;

  // Inherit any onboarding-provided default banking from the company row
  // if it has those fields; otherwise leave null so the card hides.
  const banking = (company && (company as any).bank_account_number) ? {
    account_name:   (company as any).bank_account_name ?? company.name,
    bank_name:      (company as any).bank_name ?? null,
    account_number: (company as any).bank_account_number ?? null,
    iban:           (company as any).bank_iban ?? null,
    swift:          (company as any).bank_swift ?? null,
    branch:         (company as any).bank_branch ?? null,
  } : null;

  return {
    type:   'tax_invoice',
    number: invoice.invoice_number,
    status: INVOICE_STATUS_MAP[invoice.status] ?? 'draft',
    date:   invoice.date as unknown as string,
    due_date: (invoice.due_date as unknown as string) ?? null,
    reference: invoice.reference ?? null,
    currency: invoice.currency ?? 'AED',

    company: companyToInfo(company),
    bill_to: contactToParty(contact),
    ship_to: null,                              // separate ship_to lookup deferred

    items: lines,

    subtotal,
    discount_total: Number(invoice.discount_amount ?? 0),
    tax_total:      tax,
    shipping_total: 0,
    grand_total:    total,
    paid_amount:    paid,
    balance_due:    Math.max(total - paid, 0),

    vat_breakdown: buildVatBreakdown(items.map(it => ({
      tax_rate: Number(it.tax_rate ?? 0),
      line_subtotal: Number(it.line_subtotal ?? 0),
      tax_amount: Number(it.tax_amount ?? 0),
    }))),

    qr_payload: null,                           // TLV builder pending
    banking,
    notes: invoice.notes ?? null,
    terms: invoice.terms ?? null,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Vendor Bill → DocumentData
// ────────────────────────────────────────────────────────────────────────────

const BILL_STATUS_MAP: Record<string, DocumentStatus> = {
  draft: 'draft', confirmed: 'confirmed', void: 'void',
};

export interface BillToDocInput {
  bill:      VendorBillRow;
  items:     VendorBillItemRow[];
  supplier:  ContactRow | null;
  company:   CompanyRow | null;
  products?: ProductRow[];
}

/**
 * A vendor bill is a supplier's invoice to us. The Signature template
 * renders our internal "received bill" view — our company in the
 * header, the supplier in the "Bill From" slot. Conceptually it's
 * still a tax-invoice-shaped document, but with the party direction
 * flipped (we receive, supplier issued). The template prop
 * `partyLabel` defaults to "Bill to"; we override to "Bill from" so
 * the printout makes sense.
 */
export function vendorBillToDocumentData({
  bill, items, supplier, company, products,
}: BillToDocInput): DocumentData {
  const productById: Record<string, ProductRow> = {};
  for (const p of products ?? []) productById[p.id] = p;

  const lines: LineItem[] = items.map((it, i) => {
    const prod = it.product_id ? productById[it.product_id] : null;
    return {
      index:        i + 1,
      sku:          prod?.sku ?? null,
      description:  it.description ?? prod?.name ?? '—',
      description_ar: prod?.name_ar ?? null,
      quantity:     Number(it.quantity ?? 0),
      unit_code:    null,
      unit_price:   Number(it.unit_cost ?? 0),
      discount_percent: Number(it.discount_percent ?? 0),
      discount_amount:  Number(it.discount_amount ?? 0),
      tax_rate:     Number(it.tax_rate ?? 0),
      tax_amount:   Number(it.tax_amount ?? 0),
      line_total:   Number(it.line_total ?? 0),
    };
  });

  const subtotal = Number(bill.subtotal ?? 0);
  const tax      = Number(bill.tax_amount ?? 0);
  const total    = Number(bill.total_amount ?? 0);

  return {
    type:   'tax_invoice',                      // template shape; label below
    title:  'Vendor Bill',                      // overrides stamp title
    number: bill.bill_number,
    status: BILL_STATUS_MAP[bill.status] ?? 'draft',
    date:   bill.date as unknown as string,
    due_date: (bill.due_date as unknown as string) ?? null,
    reference: bill.supplier_bill_number ?? bill.reference ?? null,
    currency: bill.currency ?? 'AED',

    company: companyToInfo(company),
    bill_to: contactToParty(supplier),          // shown in the From-labelled slot
    ship_to: null,

    items: lines,

    subtotal,
    discount_total: Number(bill.discount_amount ?? 0),
    tax_total:      tax,
    shipping_total: 0,
    grand_total:    total,
    paid_amount:    0,                          // payment side not loaded
    balance_due:    total,

    vat_breakdown: buildVatBreakdown(items.map(it => ({
      tax_rate: Number(it.tax_rate ?? 0),
      line_subtotal: Number(it.line_subtotal ?? 0),
      tax_amount: Number(it.tax_amount ?? 0),
    }))),

    qr_payload: null,
    banking: null,                              // banking is THEIRS not ours; omit
    notes: bill.notes ?? null,
    terms: null,
  };
}
