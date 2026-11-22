/**
 * phase151 — read-only mode after a subscription ends.
 *
 * The server is the real enforcement (has_perm + the posting guard), so a
 * refused save arrives as a database error: a row-level-security violation,
 * "permission denied", or the posting guard's 'subscription_read_only'. This
 * module turns those into one clear, translated sentence while the company is
 * read-only, so nobody sees a technical message. The banner hook keeps the
 * flag current from my_company_access().
 */
import i18next from 'i18next';

let readOnly = false;

/** Set by the access banner from my_company_access() (enforced read-only only). */
export function setCompanyReadOnly(value: boolean): void {
  readOnly = value;
}

export function isCompanyReadOnly(): boolean {
  return readOnly;
}

const REFUSED = /row-level security|permission denied|insufficient privilege|42501/i;

/**
 * The message to show instead of `raw`, or null to keep `raw`. The posting
 * guard's own marker is always translated; generic refusals only while the
 * company is known to be read-only (they mean something else otherwise).
 */
export function readOnlyErrorMessage(raw: string): string | null {
  if (/subscription_read_only/i.test(raw) || (readOnly && REFUSED.test(raw))) {
    return i18next.t('billingAccess.write_refused');
  }
  return null;
}
