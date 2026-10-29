import { useEffect, useRef } from 'react';
import { pushOverlay } from './back';

/**
 * While `active`, Android hardware Back calls `onBack` (e.g. close this modal
 * or drawer) instead of navigating. The most recently activated handler runs
 * first. Does nothing on the web — no native Back button there.
 */
export function useBackHandler(active: boolean, onBack: () => void): void {
  const callback = useRef(onBack);
  useEffect(() => {
    callback.current = onBack;
  });
  useEffect(() => {
    if (!active) return;
    return pushOverlay(() => callback.current());
  }, [active]);
}
