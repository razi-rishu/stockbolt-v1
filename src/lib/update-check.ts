/**
 * "A new version is available" — one check for both places StockBolt runs.
 *
 *   • Website: the running bundle knows its own build id (__BUILD_ID__). The
 *     latest deploy's id is in /version.json. If they differ, a newer deploy
 *     is live, and reloading the page picks it up.
 *   • Android app: the web code ships inside the APK, so a new deploy does not
 *     reach it. Google Play is asked instead (Play In-App Updates), and the
 *     update itself runs through Play.
 *
 * Every failure (offline, app sideloaded rather than from Play, dev server
 * with no version.json) counts as "no update" — this must never get in the way.
 */
import { AppUpdate, AppUpdateAvailability, AppUpdateResultCode } from '@capawesome/capacitor-app-update';
import { isNative } from '@/lib/platform';

export async function isUpdateAvailable(): Promise<boolean> {
  try {
    if (isNative()) {
      const info = await AppUpdate.getAppUpdateInfo();
      return info.updateAvailability === AppUpdateAvailability.UPDATE_AVAILABLE;
    }
    if (import.meta.env.DEV) return false;
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    const body = (await res.json()) as { build_id?: unknown };
    return typeof body.build_id === 'string' && body.build_id !== __BUILD_ID__;
  } catch {
    return false;
  }
}

/** Website: reload into the new deploy. App: Play's update screen, else the Play listing. */
export async function applyUpdate(): Promise<void> {
  if (!isNative()) {
    window.location.reload();
    return;
  }
  try {
    const info = await AppUpdate.getAppUpdateInfo();
    if (info.immediateUpdateAllowed) {
      const result = await AppUpdate.performImmediateUpdate();
      if (result.code === AppUpdateResultCode.OK) return;
    }
  } catch {
    // Fall through to the Play listing.
  }
  await AppUpdate.openAppStore();
}
