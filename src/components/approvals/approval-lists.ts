/**
 * Approvals (phase145) — labels and routing shared by the settings page, the
 * inbox and the document panels. Literal t() calls so the i18n key test sees
 * every key.
 */
import type { TFunction } from 'i18next';
import type { ApprovalDocType, ApprovalStepRow, ApproverProblem } from '@/data/adapter';

/** The document types approvals cover today, in menu order (purchasing, then sales). */
export const APPROVAL_DOC_TYPES: ApprovalDocType[] = [
  'purchase_order', 'goods_receipt', 'vendor_bill', 'debit_note', 'expense',
  'vendor_payment', 'vendor_refund', 'vendor_credit_refund',
  'sales_quote', 'invoice', 'credit_note', 'customer_receipt', 'customer_refund', 'customer_credit_refund',
];
export const SALES_APPROVAL_TYPES: ApprovalDocType[] = [
  'sales_quote', 'invoice', 'credit_note', 'customer_receipt', 'customer_refund', 'customer_credit_refund',
];

export function docTypeLabel(t: TFunction, type: ApprovalDocType | '*'): string {
  switch (type) {
    case '*': return t('apprOcean.dt_all');
    case 'purchase_order': return t('apprOcean.dt_purchase_order');
    case 'goods_receipt': return t('apprOcean.dt_goods_receipt');
    case 'vendor_bill': return t('apprOcean.dt_vendor_bill');
    case 'debit_note': return t('apprOcean.dt_debit_note');
    case 'expense': return t('apprOcean.dt_expense');
    case 'vendor_payment': return t('apprOcean.dt_vendor_payment');
    case 'vendor_refund': return t('apprOcean.dt_vendor_refund');
    case 'vendor_credit_refund': return t('apprOcean.dt_vendor_credit_refund');
    case 'sales_quote': return t('apprOcean.dt_sales_quote');
    case 'invoice': return t('apprOcean.dt_invoice');
    case 'credit_note': return t('apprOcean.dt_credit_note');
    case 'customer_receipt': return t('apprOcean.dt_customer_receipt');
    case 'customer_refund': return t('apprOcean.dt_customer_refund');
    case 'customer_credit_refund': return t('apprOcean.dt_customer_credit_refund');
  }
}

export function problemLabel(t: TFunction, p: ApproverProblem): string {
  switch (p) {
    case null: return '';
    case 'inactive': return t('apprOcean.p_inactive');
    case 'no_login': return t('apprOcean.p_no_login');
    case 'login_disabled': return t('apprOcean.p_login_disabled');
    case 'no_authority': return t('apprOcean.p_no_authority');
    case 'no_permission': return t('apprOcean.p_no_permission');
    default: return p;
  }
}

export function stepLabel(t: TFunction, a: ApprovalStepRow['action']): string {
  switch (a) {
    case 'submitted': return t('apprOcean.s_submitted');
    case 'passed_on': return t('apprOcean.s_passed_on');
    case 'approved': return t('apprOcean.s_approved');
    case 'override': return t('apprOcean.s_override');
    case 'forwarded': return t('apprOcean.s_forwarded');
    case 'rejected': return t('apprOcean.s_rejected');
    case 'cancelled': return t('apprOcean.s_cancelled');
    case 'admin_reopen': return t('apprOcean.s_admin_reopen');
    case 'admin_void': return t('apprOcean.s_admin_void');
  }
}

/** The document page for a request (refunds open on the payment page). */
export function docRoute(type: ApprovalDocType, id: string): string {
  switch (type) {
    case 'purchase_order': return `/purchasing/orders/${id}`;
    case 'goods_receipt': return `/purchasing/grns/${id}`;
    case 'vendor_bill': return `/purchasing/bills/${id}`;
    case 'debit_note': return `/purchasing/debit-notes/${id}`;
    case 'expense': return `/purchasing/expenses/${id}`;
    case 'sales_quote': return `/sales/quotes/${id}`;
    case 'invoice': return `/sales/invoices/${id}`;
    case 'credit_note': return `/sales/credit-notes/${id}`;
    case 'customer_receipt': case 'customer_refund': case 'customer_credit_refund': return `/sales/payments/${id}`;
    default: return `/purchasing/payments/${id}`;
  }
}

/** Query keys — one fetch per document, shared by the panel and the editor. */
export const approvalKeys = {
  config: (company: string | null) => ['approval_config', company] as const,
  doc: (type: ApprovalDocType, id: string | null) => ['approval_doc', type, id] as const,
  steps: (id: string) => ['approval_steps', id] as const,
  inbox: ['approval_inbox'] as const,
};

/** Clean the "approvals.approve: " prefix the adapter adds to server errors. */
export const approvalError = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^approvals\.\w+: /, '');
