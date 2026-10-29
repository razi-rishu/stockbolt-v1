/**
 * Platform detection. Native-only behaviour (Android Back button, native
 * print/share) must be gated on `isNative()` so stockbolt.online is unchanged.
 */
import { Capacitor } from '@capacitor/core';

/** The public website. Email links opened from the app land here. */
export const WEB_ORIGIN = 'https://www.stockbolt.online';

const APP_PREVIEW_KEY = 'stockbolt.appPreview';

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * True when the phone app UI (bottom tabs, card lists, phone layouts) is used:
 * always inside the Android app. In a dev build, opening any page with
 * `?app=1` previews the app UI in a browser (`?app=0` turns it off) — never
 * in a production web build, so stockbolt.online keeps its own design.
 */
export function isAppShell(): boolean {
  if (isNative()) return true;
  if (!import.meta.env.DEV) return false;
  try {
    const flag = new URLSearchParams(window.location.search).get('app');
    if (flag === '1') sessionStorage.setItem(APP_PREVIEW_KEY, '1');
    if (flag === '0') sessionStorage.removeItem(APP_PREVIEW_KEY);
    return sessionStorage.getItem(APP_PREVIEW_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Origin for links Supabase emails out (verify email, reset password). Inside
 * the app window.location.origin is https://localhost, which no phone browser
 * can open, so the app sends people to the website instead.
 */
export function authRedirectOrigin(): string {
  return isNative() ? WEB_ORIGIN : window.location.origin;
}
