/**
 * Payment details on documents — withPaymentDetails / toPaymentDetailRows.
 * The section is built only from verified records; an expense is never shown
 * as PAID unless a posted bank/cash ledger line says so.
 */
import { describe, it, expect } from 'vitest';
import { withPaymentDetails, toPaymentDetailRows } from '../../src/modules/print/_signature/adapters';
import type { DocumentData } from '../../src/modules/print/_signature/types';
import type { DocumentPaymentLine } from '../../src/data/adapter';

const doc = (over: Partial<DocumentData> = {}): DocumentData => ({
  type: 'standard_invoice', number: 'EXP-1', status: 'confirmed', date: '2026-11-01', currency: 'AED',
  company: { name: 'Co' }, bill_to: { name: '—' }, items: [],
  subtotal: 99, tax_total: 0, grand_total: 99, paid_amount: 0, balance_due: 99,
  ...over,
} as DocumentData);

const line = (over: Partial<DocumentPaymentLine>): DocumentPaymentLine => ({
  kind: 'payment', id: 'x', number: 'REC-1', date: '2026-11-02', status: 'confirmed', amount: 0, discount: 0,
  currency: 'AED', account_name: 'Main Bank', account_type: 'bank', account_number: 'AE070331234567890123456',
  method: 'Bank Transfer', reference: 'TT-55', counterparty: 'Cust', ...over,
});

describe('expense paid / due come from the posted bank-cash line', () => {
  it('a posted cash line makes it paid, naming the account', () => {
    const d = withPaymentDetails(doc(), 'expense', [line({ kind: 'ledger', number: 'JE-9', status: 'posted', amount: 99,
      account_name: 'Petty Cash', account_type: 'cash', account_number: null, method: null, reference: null })]);
    expect(d.paid_amount).toBe(99);
    expect(d.balance_due).toBe(0);
    expect(d.payment_details).toEqual([{ kind: 'Paid', date: '2026-11-02', number: 'JE-9', account: 'Petty Cash (Cash)',
      method: null, reference: null, amount: 99, status: '' }]);
  });

  it('a voided expense (entry + reversal) is NOT paid', () => {
    const d = withPaymentDetails(doc({ status: 'void' }), 'expense', [
      line({ kind: 'ledger', status: 'reversed', amount: 99 }),
      line({ kind: 'ledger', status: 'reversal', amount: -99 }),
    ]);
    expect(d.paid_amount).toBe(0);
    expect(d.balance_due).toBe(99);
    expect(d.payment_details!.map(r => r.status)).toEqual(['Reversed', 'Reversal']);
  });

  it('no ledger line (legacy / never posted) says so instead of claiming PAID', () => {
    const d = withPaymentDetails(doc(), 'expense', []);
    expect(d.paid_amount).toBe(0);
    expect(d.balance_due).toBe(99);
    expect(d.payment_details_note).toMatch(/No posted bank or cash entry/);
  });

  it('not loaded yet: the document is left untouched', () => {
    const base = doc();
    expect(withPaymentDetails(base, 'expense', undefined)).toBe(base);
  });
});

describe('invoices / bills list every receipt or payment', () => {
  it('two partial receipts from different accounts, with discount counted as settled', () => {
    const rows = toPaymentDetailRows('invoice', [
      line({ id: 'a', number: 'REC-1', amount: 40, discount: 2 }),
      line({ id: 'b', number: 'REC-2', amount: 30, account_name: 'Cash Box', account_type: 'cash', account_number: null, method: null, reference: null }),
    ]);
    expect(rows.map(r => [r.kind, r.number, r.account, r.method, r.amount])).toEqual([
      ['Receipt', 'REC-1', 'Main Bank (Bank) · ••3456', 'Bank Transfer', 42],
      ['Receipt', 'REC-2', 'Cash Box (Cash)', null, 30],
    ]);
  });

  it('a bill payment is labelled Payment; an unpaid confirmed bill says no payments', () => {
    expect(toPaymentDetailRows('vendor_bill', [line({ amount: 5 })])[0].kind).toBe('Payment');
    expect(withPaymentDetails(doc(), 'vendor_bill', []).payment_details_note).toBe('No payments recorded.');
  });

  it('refunds on a credit note are listed as Refund; voided ones are flagged', () => {
    const rows = toPaymentDetailRows('credit_note', [line({ kind: 'refund', number: 'CCR-1', amount: 10, status: 'void' })]);
    expect(rows[0]).toMatchObject({ kind: 'Refund', number: 'CCR-1', amount: 10, status: 'Void' });
  });

  it('paid / due of invoices are not changed by the section', () => {
    const base = doc({ paid_amount: 70, balance_due: 29 });
    const d = withPaymentDetails(base, 'invoice', [line({ amount: 70 })]);
    expect([d.paid_amount, d.balance_due]).toEqual([70, 29]);
  });
});
