import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { unsavedGuard } from '@/lib/unsaved-guard';

/**
 * Guards against losing unsaved form edits. Three layers:
 *
 *  1. Browser-level (`beforeunload`) — fires on refresh, tab close, or
 *     navigating away from the app entirely. The browser shows its own
 *     native "Leave site?" prompt; we can't customise its text.
 *
 *  2. In-app navigation (Phase 27) — mirrors `dirty` into a global flag that
 *     the app-wide UnsavedNavGuard reads to intercept ANY <Link>/nav-bar
 *     click and prompt before leaving. This covers top-nav menu items,
 *     breadcrumbs, etc. — the case the editor Back/Cancel buttons missed.
 *
 *  3. `confirmLeave()` — still call it from the editor's own Back / Cancel
 *     handlers before `navigate()` (programmatic nav isn't a link click).
 *     Returns `true` when it's safe to leave (not dirty, or user confirmed).
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const { t } = useTranslation();

  // Mirror dirty into the global flag for the app-wide nav interceptor.
  useEffect(() => {
    unsavedGuard.setDirty(dirty);
    return () => unsavedGuard.setDirty(false);
  }, [dirty]);

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
