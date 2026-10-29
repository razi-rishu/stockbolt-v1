import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { setInAppNavigator } from './install';
import { completeNativeOAuth, isNativeAuthCallback } from './oauth';

/**
 * Router-aware glue for the Android app. Render once, inside the router, on
 * native only: lets window.open('/print/…') navigate in-app, and finishes
 * Google sign-in when the online.stockbolt.app://auth-callback link returns.
 */
export function NativeBridge() {
  const navigate = useNavigate();
  const latestNavigate = useRef(navigate);

  useEffect(() => {
    latestNavigate.current = navigate;
  }, [navigate]);

  useEffect(() => setInAppNavigator((to) => latestNavigate.current(to)), []);

  useEffect(() => {
    let handledUrl: string | null = null;

    const handle = async (url: string | undefined) => {
      if (!url || !isNativeAuthCallback(url) || url === handledUrl) return;
      handledUrl = url;
      void Browser.close().catch(() => undefined);
      const error = await completeNativeOAuth(url);
      // The callback page waits for the session, then routes to /dashboard or /setup.
      latestNavigate.current(
        error ? `/auth/callback?error_description=${encodeURIComponent(error)}` : '/auth/callback',
        { replace: true },
      );
    };

    const listener = App.addListener('appUrlOpen', ({ url }) => void handle(url));
    // Cold start: Android killed the app while the Custom Tab was open.
    void App.getLaunchUrl().then((launch) => handle(launch?.url));

    return () => {
      void listener.then((l) => l.remove());
    };
  }, []);

  return null;
}
