/**
 * Who runs StockBolt and how to reach them — used by the public Privacy
 * Policy and Delete Account pages (also linked from the Google Play listing).
 * Change the contact here and every page follows.
 */
export const OPERATOR_NAME = 'Linqora Technologies';
export const SUPPORT_EMAIL = 'rashidpattaratil333@gmail.com';
/** Shown as "Last updated" on the legal pages; bump when their text changes. */
export const LEGAL_UPDATED = '29 October 2026';

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
