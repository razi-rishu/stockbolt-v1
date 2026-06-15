import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Guards against losing unsaved form edits. Two layers:
 *
 *  1. Browser-level (`beforeunload`) — fires on refresh, tab close, or
 *     navigating away from the app entirely. The browser shows its own
 *     native "Leave site?" prompt; we can't customise its text.
 *
 *  2. In-app — call the returned `confirmLeave()` from the editor's own
 *     Back / Cancel handlers before `navigate()`. Returns `true` when it's
 *     safe to leave (not dirty, or the user confirmed the discard).
 *
 * NOTE: clicking a top-nav menu item or the browser Back button is an
 * in-app (pushState) navigation that this lightweight guard does NOT
 * intercept — that needs a React-Router data router + useBlocker. Wiring
 * the editor Back/Cancel buttons covers the common accidental-exit case.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Required for the prompt to show in Chrome/Edge.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const confirmLeave = useCallback((): boolean => {
    if (!dirty) return true;
    return window.confirm(t('common.unsaved_warning'));
  }, [dirty, t]);

  return confirmLeave;
}
