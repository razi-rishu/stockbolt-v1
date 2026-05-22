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
  SalesQuoteRow, SalesQuoteItemRow,
  PurchaseOrderRow, PurchaseOrderItemRow,
  CreditNoteRow, CreditNoteItemRow,
  DebitNoteRow, DebitNoteItemRow,
  SalesReturnRow, SalesReturnItemRow,
  PaymentRow, PaymentAllocationRow,
  BankAccountRow, PaymentMethodRow,
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

// ────────────────────────────────────────────────────────────────────────────
// Phase 14.04 — Quote / PO / Credit Note / Debit Note / Sales Return adapters.
//
// All five reuse the Tax Invoice template shape; the difference between them
// is mostly cosmetic (title, no VAT-compliance language, valid-until vs.
// due-date, etc.). The template honours `data.title` so we can render every
// one of these through the same component until they earn dedicated variants
// in a later phase.
// ────────────────────────────────────────────────────────────────────────────

const QUOTE_STATUS_MAP: Record<string, DocumentStatus> = {
  draft: 'draft', sent: 'sent', accepted: 'accepted', confirmed: 'confirmed',
  void: 'void',
};

export interface QuoteToDocInput {
  quote:    SalesQuoteRow;
  items:    SalesQuoteItemRow[];
  contact:  ContactRow | null;
  company:  Company | null;
  products?: ProductRow[];
}

/** Sales Quote → DocumentData. Renders with title "Quotation" and
 *  swaps the "Due date" stamp slot for an "Expires" date. */
export function quoteToDocumentData({
  quote, items, contact, company, products,
}: QuoteToDocInput): DocumentData {
  const productById: Record<string, ProductRow> = {};
  for (const p of products ?? []) productById[p.id] = p;

  const lines: LineItem[] = items.map((it, i) => {
    const prod = it.product_id ? productById[it.product_id] : null;
    return {
      index:       i + 1,
      sku:         prod?.sku ?? null,
      description: it.description ?? prod?.name ?? '—',
      description_ar: prod?.name_ar ?? null,
      quantity:    Number(it.quantity ?? 0),
      unit_code:   null,
      unit_price:  Number(it.unit_price ?? 0),
      discount_percent: Number(it.discount_percent ?? 0),
      discount_amount:  Number(it.discount_amount ?? 0),
      tax_rate:    Number(it.tax_rate ?? 0),
      tax_amount:  Number(it.tax_amount ?? 0),
      line_total:  Number(it.line_total ?? 0),
    };
  });

  const subtotal = Number(quote.subtotal ?? 0);
  const tax      = Number(quote.tax_amount ?? 0);
  const total    = Number(quote.total_amount ?? 0);

  return {
    type:   'quotation',
    title:  'Quotation',
    number: quote.quote_number,
    status: QUOTE_STATUS_MAP[quote.status] ?? 'draft',
    date:   quote.date as unknown as string,
    // The stamp card reads `due_date` as the secondary date slot; for quotes
    // we surface the expiry there so the customer sees a hard validity edge.
    due_date:    (quote.expiry_date as unknown as string) ?? null,
    valid_until: (quote.expiry_date as unknown as string) ?? null,
    reference:   quote.reference ?? null,
    currency:    quote.currency ?? 'AED',

    company: companyToInfo(company),
    bill_to: contactToParty(contact),
    ship_to: null,

    items: lines,

    subtotal,
    discount_total: Number(quote.discount_amount ?? 0),
    tax_total:      tax,
    shipping_total: 0,
    grand_total:    total,
    paid_amount:    0,
    balance_due:    total,

    vat_breakdown: buildVatBreakdown(items.map(it => ({
      tax_rate: Number(it.tax_rate ?? 0),
      line_subtotal: Number(it.line_subtotal ?? 0),
      tax_amount: Number(it.tax_amount ?? 0),
    }))),

    qr_payload: null,
    banking: null,                              // quotes don't need bank details
    notes: quote.notes ?? null,
    terms: quote.terms ?? null,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Purchase Order → DocumentData
// ────────────────────────────────────────────────────────────────────────────

const PO_STATUS_MAP: Record<string, DocumentStatus> = {
  draft: 'draft', sent: 'sent', confirmed: 'confirmed',
  partially_received: 'partially_paid', received: 'paid', void: 'void',
};

export interface POToDocInput {
  po:       PurchaseOrderRow;
  items:    PurchaseOrderItemRow[];
  supplier: ContactRow | null;
  company:  Company | null;
  products?: ProductRow[];
}

export function purchaseOrderToDocumentData({
  po, items, supplier, company, products,
}: POToDocInput): DocumentData {
  const productById: Record<string, ProductRow> = {};
  for (const p of products ?? []) productById[p.id] = p;

  const lines: LineItem[] = items.map((it, i) => {
    const prod = it.product_id ? productById[it.product_id] : null;
    return {
      index:       i + 1,
      sku:         prod?.sku ?? null,
      description: it.description ?? prod?.name ?? '—',
      description_ar: prod?.name_ar ?? null,
      quantity:    Number(it.quantity ?? 0),
      unit_code:   null,
      unit_price:  Number(it.unit_cost ?? 0),
      discount_percent: Number(it.discount_percent ?? 0),
      discount_amount:  Number(it.discount_amount ?? 0),
      tax_rate:    Number(it.tax_rate ?? 0),
      tax_amount:  Number(it.tax_amount ?? 0),
      line_total:  Number(it.line_total ?? 0),
    };
  });

  const subtotal = Number(po.subtotal ?? 0);
  const tax      = Number(po.tax_amount ?? 0);
  const total    = Number(po.total_amount ?? 0);

  return {
    type:   'purchase_order',
    title:  'Purchase Order',
    number: po.po_number,
    status: PO_STATUS_MAP[po.status] ?? 'draft',
    date:   po.date as unknown as string,
    // PO's secondary stamp date is expected delivery, not a due-date.
    due_date:  (po.expected_delivery_date as unknown as string) ?? null,
    reference: po.reference ?? null,
    currency:  po.currency ?? 'AED',

    company: companyToInfo(company),
    bill_to: contactToParty(supplier),          // supplier — rendered as "Bill to"
    ship_to: null,

    items: lines,

    subtotal,
    discount_total: Number(po.discount_amount ?? 0),
    tax_total:      tax,
    shipping_total: 0,
    grand_total:    total,
    paid_amount:    0,
    balance_due:    total,

    vat_breakdown: buildVatBreakdown(items.map(it => ({
      tax_rate: Number(it.tax_rate ?? 0),
      line_subtotal: Number(it.line_subtotal ?? 0),
      tax_amount: Number(it.tax_amount ?? 0),
    }))),

    qr_payload: null,
    banking: null,
    notes: po.notes ?? null,
    terms: po.terms ?? null,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Credit Note → DocumentData
// ────────────────────────────────────────────────────────────────────────────

const CN_STATUS_MAP: Record<string, DocumentStatus> = {
  draft: 'draft', confirmed: 'confirmed', void: 'void',
};

export interface CreditNoteToDocInput {
  creditNote: CreditNoteRow;
  items:      CreditNoteItemRow[];
  contact:    ContactRow | null;
  company:    Company | null;
  products?:  ProductRow[];
  /** Optional linked invoice number for the reference line. */
  linkedInvoiceNumber?: string | null;
}

export function creditNoteToDocumentData({
  creditNote, items, contact, company, products, linkedInvoiceNumber,
}: CreditNoteToDocInput): DocumentData {
  const productById: Record<string, ProductRow> = {};
  for (const p of products ?? []) productById[p.id] = p;

  const lines: LineItem[] = items.map((it, i) => {
    const prod = it.product_id ? productById[it.product_id] : null;
    return {
      index:       i + 1,
      sku:         prod?.sku ?? null,
      description: it.description ?? prod?.name ?? '—',
      description_ar: prod?.name_ar ?? null,
      quantity:    Number(it.quantity ?? 0),
      unit_code:   null,
      unit_price:  Number(it.unit_price ?? 0),
      discount_percent: Number(it.discount_percent ?? 0),
      discount_amount:  Number(it.discount_amount ?? 0),
      tax_rate:    Number(it.tax_rate ?? 0),
      tax_amount:  Number(it.tax_amount ?? 0),
      line_total:  Number(it.line_total ?? 0),
    };
  });

  const subtotal = Number(creditNote.subtotal ?? 0);
  const tax      = Number(creditNote.tax_amount ?? 0);
  const total    = Number(creditNote.total_amount ?? 0);

  // Build a single reference line that calls out the original invoice and
  // (if present) the reason — the customer needs both to recognise the
  // refund quickly.
  const refBits: string[] = [];
  if (linkedInvoiceNumber) refBits.push(`Ref invoice: ${linkedInvoiceNumber}`);
  if (creditNote.reason)   refBits.push(`Reason: ${creditNote.reason}`);

  return {
    type:   'credit_note',
    title:  'Credit Note',
    number: creditNote.credit_note_number,
    status: CN_STATUS_MAP[creditNote.status] ?? 'draft',
    date:   creditNote.date as unknown as string,
    due_date: null,
    reference: refBits.join(' · ') || null,
    reference_doc: linkedInvoiceNumber ?? null,
    currency: creditNote.currency ?? 'AED',

    company: companyToInfo(company),
    bill_to: contactToParty(contact),
    ship_to: null,

    items: lines,

    subtotal,
    discount_total: Number(creditNote.discount_amount ?? 0),
    tax_total:      tax,
    shipping_total: 0,
    grand_total:    total,
    paid_amount:    0,
    balance_due:    total,

    vat_breakdown: buildVatBreakdown(items.map(it => ({
      tax_rate: Number(it.tax_rate ?? 0),
      line_subtotal: Number(it.line_subtotal ?? 0),
      tax_amount: Number(it.tax_amount ?? 0),
    }))),

    qr_payload: null,
    banking: null,
    notes: creditNote.notes ?? null,
    terms: null,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Debit Note → DocumentData
// ────────────────────────────────────────────────────────────────────────────

const DN_STATUS_MAP: Record<string, DocumentStatus> = {
  draft: 'draft', confirmed: 'confirmed', void: 'void',
};

export interface DebitNoteToDocInput {
  debitNote: DebitNoteRow;
  items:     DebitNoteItemRow[];
  supplier:  ContactRow | null;
  company:   Company | null;
  products?: ProductRow[];
  /** Optional linked vendor bill number for the reference line. */
  linkedBillNumber?: string | null;
}

export function debitNoteToDocumentData({
  debitNote, items, supplier, company, products, linkedBillNumber,
}: DebitNoteToDocInput): DocumentData {
  const productById: Record<string, ProductRow> = {};
  for (const p of products ?? []) productById[p.id] = p;

  const lines: LineItem[] = items.map((it, i) => {
    const prod = it.product_id ? productById[it.product_id] : null;
    return {
      index:       i + 1,
      sku:         prod?.sku ?? null,
      description: it.description ?? prod?.name ?? '—',
      description_ar: prod?.name_ar ?? null,
      quantity:    Number(it.quantity ?? 0),
      unit_code:   null,
      unit_price:  Number(it.unit_cost ?? 0),
      discount_percent: Number(it.discount_percent ?? 0),
      discount_amount:  Number(it.discount_amount ?? 0),
      tax_rate:    Number(it.tax_rate ?? 0),
      tax_amount:  Number(it.tax_amount ?? 0),
      line_total:  Number(it.line_total ?? 0),
    };
  });

  const subtotal = Number(debitNote.subtotal ?? 0);
  const tax      = Number(debitNote.tax_amount ?? 0);
  const total    = Number(debitNote.total_amount ?? 0);

  const refBits: string[] = [];
  if (linkedBillNumber) refBits.push(`Ref bill: ${linkedBillNumber}`);
  if (debitNote.reason) refBits.push(`Reason: ${debitNote.reason}`);

  return {
    type:   'credit_note',                      // shape reuse
    title:  'Debit Note',
    number: debitNote.debit_note_number,
    status: DN_STATUS_MAP[debitNote.status] ?? 'draft',
    date:   debitNote.date as unknown as string,
    due_date: null,
    reference: refBits.join(' · ') || null,
    reference_doc: linkedBillNumber ?? null,
    currency: debitNote.currency ?? 'AED',

    company: companyToInfo(company),
    bill_to: contactToParty(supplier),
    ship_to: null,

    items: lines,

    subtotal,
    discount_total: Number(debitNote.discount_amount ?? 0),
    tax_total:      tax,
    shipping_total: 0,
    grand_total:    total,
    paid_amount:    0,
    balance_due:    total,

    vat_breakdown: buildVatBreakdown(items.map(it => ({
      tax_rate: Number(it.tax_rate ?? 0),
      line_subtotal: Number(it.line_subtotal ?? 0),
      tax_amount: Number(it.tax_amount ?? 0),
    }))),

    qr_payload: null,
    banking: null,
    notes: debitNote.notes ?? null,
    terms: null,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Sales Return → DocumentData
//
// Sales-return items are sparse — only qty + cost. We treat the printout
// like a delivery note: qty-focused, no pricing. The template still renders
// through TaxInvoiceTemplate but most amount columns will be zero.
// ────────────────────────────────────────────────────────────────────────────

const SR_STATUS_MAP: Record<string, DocumentStatus> = {
  draft: 'draft', confirmed: 'confirmed', void: 'void',
};

export interface SalesReturnToDocInput {
  salesReturn:    SalesReturnRow;
  items:          SalesReturnItemRow[];
  contact:        ContactRow | null;
  company:        Company | null;
  products?:      ProductRow[];
  /** The invoice this return is against. */
  linkedInvoiceNumber?: string | null;
}

export function salesReturnToDocumentData({
  salesReturn, items, contact, company, products, linkedInvoiceNumber,
}: SalesReturnToDocInput): DocumentData {
  const productById: Record<string, ProductRow> = {};
  for (const p of products ?? []) productById[p.id] = p;

  const lines: LineItem[] = items.map((it, i) => {
    const prod = it.product_id ? productById[it.product_id] : null;
    const qty  = Number(it.qty_returned ?? 0);
    const cost = Number(it.unit_cost ?? 0);
    return {
      index:       i + 1,
      sku:         prod?.sku ?? null,
      description: prod?.name ?? '—',
      description_ar: prod?.name_ar ?? null,
      quantity:    qty,
      unit_code:   null,
      unit_price:  cost,
      discount_percent: 0,
      discount_amount:  0,
      tax_rate:    0,
      tax_amount:  0,
      line_total:  qty * cost,
    };
  });

  // Sum line costs as the "subtotal" so the totals ladder still balances.
  const subtotal = lines.reduce((s, l) => s + l.line_total, 0);

  const refBits: string[] = [];
  if (linkedInvoiceNumber) refBits.push(`Against invoice: ${linkedInvoiceNumber}`);
  if (salesReturn.reason)  refBits.push(`Reason: ${salesReturn.reason}`);

  return {
    type:   'delivery_note',                    // closest semantic shape
    title:  'Sales Return',
    number: salesReturn.return_number,
    status: SR_STATUS_MAP[salesReturn.status] ?? 'draft',
    date:   salesReturn.date as unknown as string,
    due_date: null,
    reference: refBits.join(' · ') || null,
    reference_doc: linkedInvoiceNumber ?? null,
    currency: 'AED',

    company: companyToInfo(company),
    bill_to: contactToParty(contact),
    ship_to: null,

    items: lines,

    subtotal,
    discount_total: 0,
    tax_total:      0,
    shipping_total: 0,
    grand_total:    subtotal,
    paid_amount:    0,
    balance_due:    subtotal,

    vat_breakdown: [],

    qr_payload: null,
    banking: null,
    notes: salesReturn.notes ?? null,
    terms: null,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 14.05 — Customer Payment / Vendor Payment adapters.
//
// Payments share a single `payments` table (sales-side and purchase-side
// are distinguished by `type`). The PaymentReceiptTemplate uses these
// adapters — the only render-time difference is the `paidTo` flag the
// template takes, which we set based on which adapter ran.
// ────────────────────────────────────────────────────────────────────────────

const PAYMENT_STATUS_MAP: Record<string, DocumentStatus> = {
  draft: 'draft', confirmed: 'confirmed', void: 'void',
};

export interface PaymentToDocInput {
  payment:      PaymentRow;
  allocations:  PaymentAllocationRow[];
  contact:      ContactRow | null;
  company:      Company | null;
  /** Bank accounts list, used to label the bank slot. */
  bankAccounts?: BankAccountRow[];
  /** Payment methods list, used to label the method slot. */
  paymentMethods?: PaymentMethodRow[];
  /** Optional invoice/bill lookup so allocation rows show document numbers
   *  rather than UUIDs. The caller can pass either invoice rows OR vendor
   *  bill rows — we pick the matching one based on doc_id. */
  invoices?:    Array<{ id: string; invoice_number?: string; bill_number?: string; date?: string; total_amount?: number }>;
}

function buildAllocationsForReceipt(
  allocations: PaymentAllocationRow[],
  docs: PaymentToDocInput['invoices'],
): DocumentData['allocations'] {
  return allocations.map(a => {
    const ref = docs?.find(d => d.id === a.doc_id);
    return {
      doc_number:      ref?.invoice_number ?? ref?.bill_number ?? a.doc_id.slice(0, 8),
      doc_date:        ref?.date ?? null,
      original_amount: ref?.total_amount ?? undefined,
      applied_amount:  Number(a.amount_applied ?? 0),
      discount_amount: Number(a.discount_amount ?? 0),
    };
  });
}

export function paymentToDocumentData({
  payment, allocations, contact, company,
  bankAccounts, paymentMethods, invoices,
}: PaymentToDocInput): DocumentData {
  const bank   = bankAccounts?.find(b => b.id === payment.bank_account_id);
  const method = paymentMethods?.find(m => m.id === payment.payment_method_id);
  const amount = Number(payment.amount ?? 0);

  return {
    type:   'payment_receipt',
    title:  'Payment Receipt',
    number: payment.payment_number,
    status: PAYMENT_STATUS_MAP[payment.status] ?? 'draft',
    date:   payment.date as unknown as string,
    due_date: null,
    reference: payment.reference ?? null,
    currency: payment.currency ?? 'AED',

    company: companyToInfo(company),
    bill_to: contactToParty(contact),
    ship_to: null,

    items: [],                                  // not used by this template

    subtotal:    amount,
    tax_total:   0,
    grand_total: amount,
    paid_amount: amount,
    balance_due: 0,

    payment_method: method?.name ?? null,
    bank_account:   bank
      ? `${bank.name}${bank.account_number ? ` · ${bank.account_number}` : ''}`
      : null,

    allocations: buildAllocationsForReceipt(allocations, invoices),

    qr_payload: null,
    banking: null,
    notes: payment.notes ?? null,
    terms: null,
  };
}

/** Same shape as customer payment, but the template is invoked with
 *  `paidTo: true` so the party label reads "Paid to" and the title
 *  defaults to "Vendor Payment". */
export function vendorPaymentToDocumentData(input: PaymentToDocInput): DocumentData {
  const doc = paymentToDocumentData(input);
  doc.title = 'Vendor Payment';
  return doc;
}
