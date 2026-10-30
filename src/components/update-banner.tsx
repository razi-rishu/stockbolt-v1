/**
 * UpdateBanner — tells people a newer StockBolt is out and lets them get it
 * with one tap (reload on the website, Google Play in the app).
 *
 * Checks on start, every 15 minutes, and whenever the tab or app comes back
 * to the foreground. Dismissing hides it until the next start; it never
 * reloads on its own, so nobody loses a half-filled form.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { App } from '@capacitor/app';
import { isNative, isAppShell } from '@/lib/platform';
import { applyUpdate, isUpdateAvailable } from '@/lib/update-check';

const CHECK_EVERY_MS = 15 * 60 * 1000;

export function UpdateBanner() {
  const { t } = useTranslation();
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      void isUpdateAvailable().then((yes) => { if (!cancelled && yes) setAvailable(true); });
    };
    check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    const resume = isNative()
      ? App.addListener('resume', check)
      : null;
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      void resume?.then((h) => h.remove());
    };
  }, []);

  if (!available || dismissed) return null;

  const phone = isAppShell();
  const onUpdate = async () => {
    setBusy(true);
    try {
      await applyUpdate();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="status"
      className="fixed z-[1000] flex items-center gap-3 rounded-card border border-border-subtle bg-surface-card shadow-card"
      style={{
        // Full width on narrow screens; on wide ones the auto margin pushes
        // the 420px card to the end corner.
        insetInlineStart: 12,
        insetInlineEnd: phone ? 12 : 16,
        marginInlineStart: 'auto',
        bottom: phone ? 'calc(92px + env(safe-area-inset-bottom))' : 16,
        maxWidth: phone ? undefined : 420,
        padding: '12px 12px 12px 16px',
      }}
    >
      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-brand-50 text-brand-500">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-ink-primary">{t('update.title')}</div>
        <div className="text-xs text-ink-secondary">{t(isNative() ? 'update.body_app' : 'update.body_web')}</div>
      </div>
      <button
        type="button"
        onClick={() => void onUpdate()}
        disabled={busy}
        className="shrink-0 rounded-pill bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
      >
        {t(isNative() ? 'update.action_app' : 'update.action_web')}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t('update.dismiss')}
        className="shrink-0 rounded-pill p-1.5 text-ink-tertiary hover:bg-surface-muted hover:text-ink-secondary"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
