/**
 * Shared shape definitions for the Signature print templates — Phase 14.01.
 *
 * One unified vocabulary so any of the 8 document types (Tax Invoice,
 * Quotation, Delivery Note, …) can be rendered by composing the same
 * primitive blocks against the same data shape. Real-world adapters
 * (invoice → IvData, quote → IvData, etc.) live next to each template
 * file.
 */

export type DocumentType =
  | 'tax_invoice'
  | 'standard_invoice'
  | 'proforma_invoice'
  | 'quotation'
  | 'delivery_note'
  | 'purchase_order'
  | 'credit_note'
  | 'payment_receipt';

export type DocumentStatus =
  | 'draft' | 'confirmed' | 'sent' | 'accepted'
  | 'paid'  | 'partially_paid' | 'overdue' | 'void';

export interface CompanyInfo {
  name:      string;
  name_ar?:  string;
  logo_url?: string | null;
  trn?:      string | null;        // VAT registration number
  address?:  string | null;
  city?:     string | null;
  country?:  string | null;
  phone?:    string | null;
  email?:    string | null;
  website?:  string | null;
}

export interface PartyInfo {
  name:        string;
  name_ar?:    string;
  trn?:        string | null;
  contact?:    string | null;      // contact person
  phone?:      string | null;
  email?:      string | null;
  address?:    string | null;
  city?:       string | null;
  country?:    string | null;
}

export interface LineItem {
  /** Line number for the printed "#" column. */
  index?:        number;
  sku?:          string | null;
  description:   string;
  description_ar?: string | null;
  quantity:      number;
  unit_code?:    string | null;     // pcs / kg / box
  unit_price:    number;             // ex-tax
  discount_percent?: number;
  discount_amount?:  number;
  tax_rate?:     number;             // % e.g. 5 for UAE VAT
  tax_amount?:   number;
  line_total:    number;             // inclusive of tax
}

export interface BankingDetails {
  account_name:   string;
  bank_name?:     string | null;
  account_number?:string | null;
  iban?:          string | null;
  swift?:         string | null;
  branch?:        string | null;
}

export interface DocumentData {
  type:           DocumentType;
  /** Optional human title override; otherwise derived from type. */
  title?:         string;
  /** Document number e.g. INV-1042 / QT-0103 / DN-2204. */
  number:         string;
  /** Status drives the dot/pill on the stamp card. */
  status:         DocumentStatus;

  date:           string;            // YYYY-MM-DD
  due_date?:      string | null;
  /** For quotes: validity end date. For proformas: validity end. */
  valid_until?:   string | null;
  /** For credit notes: the invoice they reference. */
  reference_doc?: string | null;
  /** Free-text reference. PO number, supplier invoice #, etc. */
  reference?:     string | null;

  currency:       string;            // 'AED'

  /** Issuer / from. Reused on every doc type. */
  company:        CompanyInfo;

  /** Bill-to. Customer for sales-side, supplier for purchase-side. */
  bill_to:        PartyInfo;
  /** Optional second party — ship-to address, or hidden for receipts/POs. */
  ship_to?:       PartyInfo | null;

  /** Line items. Delivery notes show qty only; price/tax columns hidden. */
  items:          LineItem[];

  /** Totals — all pre-computed by the caller. */
  subtotal:       number;
  discount_total?:number;
  tax_total:      number;
  /** Phase 46 — cash rounding on the grand total (may be negative). */
  round_off?:     number;
  shipping_total?:number;
  grand_total:    number;
  paid_amount?:   number;            // for invoices
  balance_due?:   number;            // grand_total − paid_amount

  /** Per-rate VAT breakdown for the compliance section. */
  vat_breakdown?: Array<{ rate: number; taxable: number; tax: number }>;

  /** UAE FTA TLV QR payload (base64 string). Caller is responsible for
   *  building it. If absent the QR slot renders an inert placeholder. */
  qr_payload?:    string | null;

  banking?:       BankingDetails | null;
  notes?:         string | null;
  terms?:         string | null;

  /** Shown when the template's Warehouse / Salesperson toggles are on. */
  warehouse_name?:   string | null;
  salesperson_name?: string | null;

  /** Optional signature block — used by Delivery Note + Quotation. */
  show_signature?: boolean;
  signed_by?:      string | null;
  signature_date?: string | null;

  // ── Phase 14.05 — Payment Receipt extras ─────────────────────────────────
  /** Payment method label (e.g. "Bank Transfer", "Cheque #1234"). */
  payment_method?: string | null;
  /** Bank account this payment hit (label, masked digits). */
  bank_account?:   string | null;
  /** Allocations against invoices/bills. Renders as a small table. */
  allocations?:    Array<{
    doc_number:      string;
    doc_date?:       string | null;
    original_amount?:number;            // outstanding before this payment
    applied_amount:  number;
    discount_amount?:number;
  }>;
}
