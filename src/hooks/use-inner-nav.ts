import { useEffect } from 'react';
import { useUiLayoutStore } from '@/store/ui-layout';

/**
 * Declare that this screen shows its own side menu (a settings rail, a step
 * rail…). While it is mounted and `active`, the website's main sidebar
 * collapses automatically; the user can still reopen it with the menu button.
 * When the screen goes away the main sidebar returns to how it was.
 *
 *   useInnerNav();             // always has an inner menu
 *   useInnerNav(!isHubPage);   // only on some routes
 */
export function useInnerNav(active = true): void {
  const registerInnerNav = useUiLayoutStore((s) => s.registerInnerNav);
  useEffect(() => {
    if (!active) return;
    return registerInnerNav();
  }, [active, registerInnerNav]);
}
