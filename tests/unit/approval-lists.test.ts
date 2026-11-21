// phase145 — approvals labels and routing: every document type has a label,
// a route, and refunds open on the payment page.
import { describe, it, expect } from 'vitest';
import type { TFunction } from 'i18next';
import { APPROVAL_DOC_TYPES, docRoute, docTypeLabel, problemLabel, stepLabel, approvalError } from '../../src/components/approvals/approval-lists';

const t = ((k: string) => k) as unknown as TFunction;

describe('approvals lists', () => {
  it('labels every batch-1 document type and "all documents"', () => {
    for (const d of APPROVAL_DOC_TYPES) expect(docTypeLabel(t, d)).toBe(`apprOcean.dt_${d}`);
    expect(docTypeLabel(t, '*')).toBe('apprOcean.dt_all');
  });
  it('routes each type to its page; refunds open as payments', () => {
    expect(docRoute('vendor_bill', 'x')).toBe('/purchasing/bills/x');
    expect(docRoute('purchase_order', 'x')).toBe('/purchasing/orders/x');
    expect(docRoute('goods_receipt', 'x')).toBe('/purchasing/grns/x');
    expect(docRoute('vendor_refund', 'x')).toBe('/purchasing/payments/x');
    expect(docRoute('vendor_credit_refund', 'x')).toBe('/purchasing/payments/x');
  });
  it('explains why someone can\'t approve, and names every step', () => {
    expect(problemLabel(t, null)).toBe('');
    expect(problemLabel(t, 'no_login')).toBe('apprOcean.p_no_login');
    expect(stepLabel(t, 'admin_void')).toBe('apprOcean.s_admin_void');
    expect(stepLabel(t, 'passed_on')).toBe('apprOcean.s_passed_on');
  });
  it('strips the adapter prefix from server errors', () => {
    expect(approvalError(new Error('approvals.approve: This request was already approved.'))).toBe('This request was already approved.');
  });
});
