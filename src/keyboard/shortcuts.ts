/**
 * Static keyboard-shortcut definitions (Phase 1 global layer).
 *
 * Single source of truth for: the Alt-key navigation map, the "new document"
 * route map, and the grouped list rendered in the help modal. Context actions
 * (save/print/duplicate) are registered at runtime by editors via
 * use-shortcut-action and are merged into the Documents group of the modal.
 */

/** Alt + <key> → route. Alt avoids clobbering browser Ctrl shortcuts. */
export const NAV_MAP: Record<string, string> = {
  d: '/dashboard',
  s: '/sales/invoices',
  p: '/purchasing/bills',
  i: '/products',
  a: '/accounting/chart-of-accounts',
  r: '/reports/trial-balance',
  c: '/contacts/customers',
  v: '/contacts/suppliers',
};

/**
 * Alt+N "new document" — maps the current path prefix to its create route.
 * Longest-prefix match wins. Returns null when the current module has no
 * obvious "new" target.
 */
const NEW_DOC_MAP: Array<[string, string]> = [
  ['/sales/invoices',     '/sales/invoices/new'],
  ['/sales/quotes',       '/sales/quotes/new'],
  ['/sales/credit-notes', '/sales/credit-notes/new'],
  ['/sales/returns',      '/sales/returns/new'],
  ['/sales/payments',     '/sales/payments/new'],
  ['/purchasing/orders',    '/purchasing/orders/new'],
  ['/purchasing/bills',     '/purchasing/bills/new'],
  ['/purchasing/grns',      '/purchasing/grns/new'],
  ['/purchasing/payments',  '/purchasing/payments/new'],
  ['/purchasing/expenses',  '/purchasing/expenses/new'],
  ['/purchasing/debit-notes', '/purchasing/debit-notes/new'],
  ['/products',           '/products/new'],
  ['/accounting/journal-entries', '/accounting/journal-entries/new'],
  ['/contacts/customers', '/contacts/customers/new'],
  ['/contacts/suppliers', '/contacts/suppliers/new'],
];

export function newDocRouteFor(pathname: string): string | null {
  let best: string | null = null;
  let bestLen = -1;
  for (const [prefix, route] of NEW_DOC_MAP) {
    if (pathname.startsWith(prefix) && prefix.length > bestLen) {
      best = route; bestLen = prefix.length;
    }
  }
  return best;
}

export interface ShortcutHint { keys: string; label: string }
export interface ShortcutGroup { title: string; items: ShortcutHint[] }

/** Grouped list shown in the help modal. `mod` renders as ⌘ on Mac, Ctrl else. */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigation',
    items: [
      { keys: 'Alt + D', label: 'Go to Dashboard' },
      { keys: 'Alt + S', label: 'Go to Sales' },
      { keys: 'Alt + P', label: 'Go to Purchasing' },
      { keys: 'Alt + I', label: 'Go to Inventory' },
      { keys: 'Alt + A', label: 'Go to Accounting' },
      { keys: 'Alt + R', label: 'Go to Reports' },
      { keys: 'Alt + C', label: 'Go to Customers' },
      { keys: 'Alt + V', label: 'Go to Vendors' },
      { keys: 'mod + /', label: 'Open global search' },
    ],
  },
  {
    title: 'Documents',
    items: [
      { keys: 'Alt + N',        label: 'New document in this module' },
      { keys: 'mod + S',        label: 'Save document' },
      { keys: 'mod + Enter',    label: 'Save document' },
      { keys: 'mod + P',        label: 'Print document' },
      { keys: 'mod + D',        label: 'Duplicate document' },
      { keys: 'Esc',            label: 'Close dialog / modal' },
    ],
  },
  {
    title: 'Forms',
    items: [
      { keys: 'Tab',         label: 'Next field' },
      { keys: 'Shift + Tab', label: 'Previous field' },
      { keys: 'mod + Enter', label: 'Submit / save' },
    ],
  },
  {
    title: 'Dropdowns & Tables',
    items: [
      { keys: '↑ / ↓',  label: 'Move between options / rows' },
      { keys: 'Enter',  label: 'Select option' },
      { keys: 'Esc',    label: 'Close dropdown' },
      { keys: 'Type',   label: 'Filter options as you type' },
    ],
  },
  {
    title: 'Help',
    items: [
      { keys: '?', label: 'Show this shortcuts list' },
    ],
  },
];
