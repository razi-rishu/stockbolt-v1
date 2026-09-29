import { useCallback, useState } from 'react';

/**
 * Z4 — voided documents are hidden from every list by default.
 *
 * "Delete means deleted. I don't want to see the deleted transaction there."
 *
 * A voided document is not a deleted one and cannot become one: its number was
 * issued, its journal entries are already reversed in the ledger, and Doc 3
 * Rule 5 is reverse-never-delete. If a VAT period had already included it,
 * deleting the row would leave a filing that cannot be reconciled.
 *
 * What was actually wrong is that they were in the way. One reopened sales
 * return left two voided credit notes sitting in the customer's list next to
 * the live one, all three for the same 131.25. So they come out of the default
 * view and stay one click away — the standard answer, and the honest one.
 *
 * Default is HIDDEN. The trail is for when you go looking, not for every time
 * you open a list.
 *
 * Per-list key, so hunting for a voided invoice does not also un-hide voided
 * payments and lose your place in both.
 */
export function useHideVoided(storageKey: string) {
  const [hidden, setHidden] = useState<boolean>(() => {
    try {
      // Anything other than an explicit 'false' means hidden, so a corrupt or
      // missing value fails to the default rather than to a cluttered list.
      return localStorage.getItem(storageKey) !== 'false';
    } catch {
      return true;   // private mode, blocked storage
    }
  });

  const setHideVoided = useCallback((next: boolean) => {
    setHidden(next);
    try { localStorage.setItem(storageKey, String(next)); } catch { /* private mode */ }
  }, [storageKey]);

  return { hideVoided: hidden, setHideVoided };
}

/**
 * The filter itself, so no list hand-rolls the status comparison. Returns
 * true when the row should be SHOWN.
 *
 * Void is the only status hidden. A draft has posted nothing but is still
 * work in progress someone means to finish, and hiding it would lose it.
 */
export function showsInList(
  row: { status?: string | null },
  hideVoided: boolean,
): boolean {
  return !(hideVoided && row.status === 'void');
}
