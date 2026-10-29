/**
 * Android app adaptations for browser APIs that do nothing in a WebView.
 * Installed once from main.tsx; a no-op on the website.
 *
 *  • window.print()  → Android print dialog (23 call sites, reports included)
 *  • window.open('/print/…') → same screen inside the app (no second window
 *    exists in the app); external http(s) links → in-app Custom Tab
 */
import { Browser } from '@capacitor/browser';
import { isNative } from '@/lib/platform';
import { printCurrentPage } from './document';

type Navigate = (to: string) => void;

let navigateInApp: Navigate | null = null;

/** Registered by <NativeBridge> once the router is mounted. */
export function setInAppNavigator(fn: Navigate): () => void {
  navigateInApp = fn;
  return () => {
    if (navigateInApp === fn) navigateInApp = null;
  };
}

export function installNativeOverrides(): void {
  if (!isNative()) return;

  window.print = () => {
    void printCurrentPage().catch((err) => console.error('[native] print failed', err));
  };

  const browserOpen = window.open.bind(window);
  window.open = (url?: string | URL, target?: string, features?: string) => {
    const href = url?.toString() ?? '';
    if (href.startsWith('/') && navigateInApp) {
      navigateInApp(href);
      return null;
    }
    if (/^https?:\/\//i.test(href)) {
      void Browser.open({ url: href });
      return null;
    }
    return browserOpen(url, target, features);
  };
}
