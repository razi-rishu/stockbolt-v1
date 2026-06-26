/**
 * Document drill-down registry (Document 7 — D1).
 *
 * Single source of truth mapping every document type to its existing route,
 * display label, and the read-permission required to open it. Used by <DocLink>
 * so that every figure/reference across the ERP can trace back to its source.
 *
 * No new routes are introduced — these all already exist in App.tsx.
 */
import type { Permission } from '@/lib/permissions';

export type DocType =
  | 'journal_entry' | 'invoice' | 'quote' | 'customer_payment' | 'credit_note' | 'sales_return'
  | 'vendor_bill' | 'vendor_payment' | 'purchase_order' | 'goods_receipt' | 'expense' | 'debit_note'
  | 'stock_transfer' | 'inventory_adjustment' | 'bank_transfer' | 'payroll_run'
  | 'customer' | 'supplier' | 'product';

export interface DocMeta {
  route: (id: string) => string;
  label: string;
  perm: Permission;
}

export const DOC_REGISTRY: Record<DocType, DocMeta> = {
  journal_entry:        { route: (id) => `/accounting/journal-entries/${id}`, label: 'Journal Entry',  perm: 'accounting.read' },
  invoice:              { route: (id) => `/sales/invoices/${id}`,             label: 'Invoice',        perm: 'sales.read' },
  quote:                { route: (id) => `/sales/quotes/${id}`,               label: 'Quote',          perm: 'sales.read' },
  customer_payment:     { route: (id) => `/sales/payments/${id}`,             label: 'Receipt',        perm: 'sales.read' },
  credit_note:          { route: (id) => `/sales/credit-notes/${id}`,         label: 'Credit Note',    perm: 'sales.read' },
  sales_return:         { route: (id) => `/sales/returns/${id}`,              label: 'Sales Return',   perm: 'sales.read' },
  vendor_bill:          { route: (id) => `/purchasing/bills/${id}`,           label: 'Bill',           perm: 'purchasing.read' },
  vendor_payment:       { route: (id) => `/purchasing/payments/${id}`,        label: 'Payment',        perm: 'purchasing.read' },
  purchase_order:       { route: (id) => `/purchasing/orders/${id}`,          label: 'Purchase Order', perm: 'purchasing.read' },
  goods_receipt:        { route: (id) => `/purchasing/grns/${id}`,            label: 'GRN',            perm: 'purchasing.read' },
  expense:              { route: (id) => `/purchasing/expenses/${id}`,        label: 'Expense',        perm: 'purchasing.read' },
  debit_note:           { route: (id) => `/purchasing/debit-notes/${id}`,     label: 'Debit Note',     perm: 'purchasing.read' },
  stock_transfer:       { route: (id) => `/inventory/transfers/${id}`,        label: 'Stock Transfer', perm: 'inventory.read' },
  inventory_adjustment: { route: (id) => `/inventory/adjustments/${id}`,      label: 'Adjustment',     perm: 'inventory.read' },
  bank_transfer:        { route: (id) => `/banking/transfers/${id}`,          label: 'Bank Transfer',  perm: 'accounting.read' },
  payroll_run:          { route: (id) => `/payroll/runs/${id}`,               label: 'Payroll Run',    perm: 'payroll.read' },
  customer:             { route: (id) => `/contacts/customers/${id}`,         label: 'Customer',       perm: 'sales.read' },
  supplier:             { route: (id) => `/contacts/suppliers/${id}`,         label: 'Supplier',       perm: 'purchasing.read' },
  product:              { route: (id) => `/products/${id}`,                   label: 'Product',        perm: 'inventory.read' },
};

// The same concept appears under different strings across tables
// (journal_entries.source_type vs general_ledger/stock_ledger.related_doc_type).
// JE-only sources (inventory_cogs, opening_balance, manual) intentionally map to
// nothing — the journal entry itself is the drill-down target there.
const ALIASES: Record<string, DocType> = {
  sales_invoice: 'invoice',
  payment:       'customer_payment',
  grn:           'goods_receipt',
  po:            'purchase_order',
};

export function normalizeDocType(raw: string | null | undefined): DocType | null {
  if (!raw) return null;
  const key = raw.toLowerCase();
  if (key in DOC_REGISTRY) return key as DocType;
  return ALIASES[key] ?? null;
}

/** Route for a (type, id) pair, or null if it can't resolve. */
export function resolveDocRoute(type: string | null | undefined, id: string | null | undefined): string | null {
  if (!id) return null;
  const canon = normalizeDocType(type);
  return canon ? DOC_REGISTRY[canon].route(id) : null;
}
