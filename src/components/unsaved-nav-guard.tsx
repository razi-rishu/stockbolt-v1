/**
 * App-wide unsaved-changes navigation guard (Phase 27).
 *
 * Mounted once near the app root. While an editor has unsaved edits (mirrored
 * into unsavedGuard by useUnsavedChangesGuard), this intercepts ANY in-app link
 * click — top-nav items, breadcrumbs, list rows, etc. — in the capture phase,
 * BEFORE React Router's <Link> handler runs, and asks the user to confirm. On
 * "cancel" it blocks the navigation; on "ok" it lets it through.
 *
 * Works with the plain BrowserRouter (no data-router / useBlocker needed).
 * Programmatic navigate() (editor Back/Cancel buttons) is still covered by the
 * editor calling confirmLeave(); browser refresh/close by beforeunload.
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { unsavedGuard } from '@/lib/unsaved-guard';

export function UnsavedNavGuard() {
  const { t } = useTranslation();

  useEffect(() => {
    const onClickCapture = (e: MouseEvent) => {
      if (!unsavedGuard.isDirty() || e.defaultPrevented) return;
      // Let modified clicks (open-in-new-tab) and non-primary buttons pass.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const anchor = (e.target as HTMLElement | null)?.closest('a');
      const href = anchor?.getAttribute('href');
      if (!anchor || !href) return;
      if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;

      let url: URL;
      try { url = new URL(href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin) return;                 // external — beforeunload covers it
      if (url.pathname === window.location.pathname && url.search === window.location.search) return; // same page

      // Unsaved edits + a real in-app navigation → confirm before leaving.
      if (!window.confirm(t('common.unsaved_warning'))) {
        e.preventDefault();
        e.stopPropagation();   // stop React Router's <Link> handler too
      } else {
        unsavedGuard.setDirty(false);
      }
    };

    document.addEventListener('click', onClickCapture, true);   // capture phase
    return () => document.removeEventListener('click', onClickCapture, true);
  }, [t]);

  return null;
}
