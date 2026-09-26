import { describe, it, expect } from 'vitest';
import { salesReturnToDocumentData } from '@/modules/print/_signature/adapters';
import type {
  SalesReturnRow, SalesReturnItemRow, InvoiceItemRow, ContactRow, ProductRow, Company,
} from '@/data/adapter';

/**
 * The saved-return document printed 0.00 in every money column.
 *
 * Two faults, one cause: it priced each line at the return row's `unit_cost`
 * and forced discount and tax to zero. A DRAFT has no cost yet — it is stamped
 * at confirm — so a draft showed nothing but zeros. A CONFIRMED return showed
 * what we PAID for the goods, on a document that goes to the customer. Neither
 * figure was the credit the customer actually receives.
 *
 * Price, discount and tax belong to the INVOICE line, which is where
 * confirm_sales_return reads them from. These tests pin that.
 */

type DocInput = Parameters<typeof salesReturnToDocumentData>[0];

const RETURN = {
  id: 'sr1', return_number: 'SR-1002', status: 'draft',
  date: '2026-09-07', invoice_id: 'inv1', notes: null, reason: 'wrong_part',
} as unknown as SalesReturnRow;

const PRODUCT   = { id: 'p1', sku: 'PAD-001', name: 'Pad Kit, Disc Brake', name_ar: null } as unknown as ProductRow;
const CUSTOMER  = { id: 'c1', name: 'Juma Arif' } as unknown as ContactRow;
const AE_COMPANY = { id: 'co1', name: 'Pro_Parts',     base_currency: 'AED' } as unknown as Company;
const IN_COMPANY = { id: 'co2', name: 'Bharat Spares', base_currency: 'INR' } as unknown as Company;

/** One return line against one invoice line. */
const line = (over: Record<string, unknown> = {}) => ([{
  id: 'sri1', sales_return_id: 'sr1', product_id: 'p1',
  qty_returned: 1, unit_cost: 0, condition: 'resellable',
  invoice_item_id: 'ii1', ...over,
}] as unknown as SalesReturnItemRow[]);

const invLine = (over: Record<string, unknown> = {}) => ([{
  id: 'ii1', invoice_id: 'inv1', product_id: 'p1',
  description: 'PAD KIT, DISC BRAKE, REAR',
  quantity: 4, unit_price: 125, discount_percent: 0, tax_rate: 5,
  line_subtotal: 500, tax_amount: 25, line_total: 525, ...over,
}] as unknown as InvoiceItemRow[]);

const build = (over: Partial<DocInput> = {}) => salesReturnToDocumentData({
  salesReturn: RETURN,
  items: line(),
  contact: CUSTOMER,
  company: AE_COMPANY,
  products: [PRODUCT],
  invoiceItems: invLine(),
  linkedInvoiceNumber: 'INV-1044',
  ...over,
});

describe('sales return document', () => {
  it('prices a DRAFT line from the invoice, not from the unset cost', () => {
    // The exact case from the bug report: unit_cost 0 on a draft, invoice line
    // at 125 + 5%. Every one of these read 0.00 before.
    const doc = build();
    expect(doc.items[0]!.unit_price).toBe(125);
    expect(doc.items[0]!.tax_rate).toBe(5);
    expect(doc.items[0]!.tax_amount).toBe(6.25);
    expect(doc.items[0]!.line_total).toBe(131.25);
    expect(doc.subtotal).toBe(125);
    expect(doc.tax_total).toBe(6.25);
    expect(doc.grand_total).toBe(131.25);
  });

  it('never prints the cost of goods on a CONFIRMED return', () => {
    // The fault that leaked margin: a confirmed return carries a real
    // unit_cost, and the document printed it as the unit price.
    const doc = build({
      salesReturn: { ...RETURN, status: 'confirmed' } as SalesReturnRow,
      items: line({ unit_cost: 39.37 }),
    });
    expect(doc.items[0]!.unit_price).toBe(125);
    expect(JSON.stringify(doc)).not.toContain('39.37');
  });

  it('credits only the quantity returned, not the quantity invoiced', () => {
    // The invoice line sold 4; this return brings back 3.
    const doc = build({ items: line({ qty_returned: 3 }) });
    expect(doc.items[0]!.quantity).toBe(3);
    expect(doc.subtotal).toBe(375);
    expect(doc.grand_total).toBe(393.75);
  });

  it('carries the invoice line discount through to the credit', () => {
    // You cannot credit back more than you charged: a 10%-discounted sale
    // comes back at the discounted price.
    const doc = build({
      items: line({ qty_returned: 4 }),
      invoiceItems: invLine({ discount_percent: 10 }),
    });
    expect(doc.items[0]!.discount_amount).toBe(50);
    expect(doc.subtotal).toBe(450);
    expect(doc.tax_total).toBe(22.5);
    expect(doc.grand_total).toBe(472.5);
  });

  it('is region-neutral: an India GST line needs no separate code path', () => {
    // 18% whether it splits into CGST+SGST or stands as IGST — the line
    // carries one rate, and the document just credits it back.
    const doc = build({
      company: IN_COMPANY,
      items: line({ qty_returned: 2 }),
      invoiceItems: invLine({ tax_rate: 18 }),
      currency: 'INR',
    });
    expect(doc.currency).toBe('INR');
    expect(doc.tax_total).toBe(45);
    expect(doc.grand_total).toBe(295);
    expect(doc.vat_breakdown).toEqual([{ rate: 18, taxable: 250, tax: 45 }]);
  });

  it('falls back to the company base currency, never to a hardcoded AED', () => {
    // An Indian company's return used to print dirhams.
    expect(build({ company: IN_COMPANY, currency: null }).currency).toBe('INR');
  });

  it('groups the VAT breakdown by rate across lines', () => {
    const doc = build({
      items: [
        ...line(),
        { id: 'sri2', product_id: 'p1', qty_returned: 2, invoice_item_id: 'ii2' },
      ] as unknown as SalesReturnItemRow[],
      invoiceItems: [
        ...invLine(),
        { id: 'ii2', product_id: 'p1', description: 'Zero-rated export', unit_price: 100, tax_rate: 0 },
      ] as unknown as InvoiceItemRow[],
    });
    // A zero-rated line is dropped from the breakdown but still counted in the
    // subtotal — 125 + 200.
    expect(doc.subtotal).toBe(325);
    expect(doc.vat_breakdown).toEqual([{ rate: 5, taxable: 125, tax: 6.25 }]);
  });

  it('uses the description the customer saw, not the current product name', () => {
    // A product renamed after the sale must not change what an issued credit
    // says the customer is being credited for.
    expect(build().items[0]!.description).toBe('PAD KIT, DISC BRAKE, REAR');
  });

  it('prices at zero when a line has no invoice link, rather than guessing', () => {
    // R2b — a row saved before phase 72 carries no link, and
    // confirm_sales_return refuses it. Showing nothing is the honest answer;
    // inventing a price from the product master would be worse.
    const doc = build({ items: line({ invoice_item_id: null }) });
    expect(doc.grand_total).toBe(0);
  });
});
