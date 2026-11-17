/**
 * Who runs StockBolt and how to reach them — used by the public Privacy
 * Policy and Delete Account pages (also linked from the Google Play listing).
 * Change the contact here and every page follows.
 */
export const OPERATOR_NAME = 'Linqora Technologies';
export const SUPPORT_EMAIL = 'linqora@stockbolt.online';
/**
 * phase135 — false while docs/legal/*.md are drafts (founder details and legal
 * review pending). While false, /privacy keeps the current page and /terms
 * says the Terms are being finalised: no draft with placeholders is shown as
 * if it were in force. Set to true in the same release that publishes the
 * documents in public.legal_documents.
 */
export const LEGAL_DOCS_PUBLISHED = false;

/** Shown as "Last updated" on the legal pages; bump when their text changes. */
export const LEGAL_UPDATED = '17 November 2026';

/** Prefilled email for an account-deletion request. */
export function deletionRequestMailto(accountEmail?: string | null): string {
  const subject = 'StockBolt account deletion request';
  const body = [
    'Please delete my StockBolt account.',
    '',
    `Account email: ${accountEmail ?? '(the email I sign in with)'}`,
    'Company name: ',
    '',
    'I understand this permanently deletes my login and, if I am the company owner, my company’s records.',
  ].join('\n');
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
