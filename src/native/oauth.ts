/**
 * Google sign-in for the Android app.
 *
 * Google refuses to sign in inside an embedded WebView, and a plain redirect
 * hands the whole flow to the phone's browser, which then lands on the
 * website. Instead the app:
 *   1. asks Supabase for the Google URL without navigating (skipBrowserRedirect),
 *   2. opens it in a Chrome Custom Tab (@capacitor/browser),
 *   3. Supabase redirects to online.stockbolt.app://auth-callback?code=…,
 *      which Android routes back into the app (AndroidManifest intent-filter),
 *   4. the code is exchanged (PKCE) and the session handed to the app's client.
 *
 * PKCE runs on a separate, short-lived client so the main client — and with it
 * every website auth flow — keeps its existing settings. The redirect URL must
 * be allow-listed in Supabase → Authentication → URL Configuration.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Browser } from '@capacitor/browser';
import { env } from '@/lib/env';
import { getSupabaseClient } from '@/data/supabase-client';

export const NATIVE_AUTH_REDIRECT = 'online.stockbolt.app://auth-callback';
const OAUTH_STORAGE_KEY = 'sb-native-oauth';

let oauthClient: SupabaseClient | null = null;

function getOAuthClient(): SupabaseClient {
  if (!oauthClient) {
    oauthClient = createClient(env.supabase_url, env.supabase_publishable_key, {
      auth: {
        flowType: 'pkce',
        storageKey: OAUTH_STORAGE_KEY,
        persistSession: true, // keeps the PKCE verifier if Android pauses the app
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return oauthClient;
}

export function isNativeAuthCallback(url: string): boolean {
  return url.startsWith(NATIVE_AUTH_REDIRECT);
}

/** Set when the deep link arrives, so closing the tab afterwards is not a cancel. */
let callbackReceived = false;

/**
 * Opens Google sign-in in a Custom Tab. Resolves once the deep link has come
 * back; rejects if the user closes the tab without finishing, so the login
 * button stops spinning.
 */
export async function startNativeOAuth(provider: 'google'): Promise<void> {
  const { data, error } = await getOAuthClient().auth.signInWithOAuth({
    provider,
    options: { redirectTo: NATIVE_AUTH_REDIRECT, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data.url) throw new Error('Supabase returned no sign-in URL');

  callbackReceived = false;
  const closed = new Promise<void>((resolve) => {
    const listener = Browser.addListener('browserFinished', () => {
      void listener.then((l) => l.remove());
      resolve();
    });
  });
  await Browser.open({ url: data.url });
  await closed;
  // The deep link and the tab closing race each other; give the link a moment.
  await new Promise((r) => setTimeout(r, 1500));
  if (!callbackReceived) throw new Error('Google sign-in was cancelled.');
}

/**
 * Finishes sign-in from the deep link. Returns an error message for the
 * callback page, or null once the app's client holds the new session.
 */
export async function completeNativeOAuth(url: string): Promise<string | null> {
  callbackReceived = true;
  const parsed = new URL(url);
  const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  const failure =
    parsed.searchParams.get('error_description') ?? hash.get('error_description') ??
    parsed.searchParams.get('error') ?? hash.get('error');
  if (failure) return failure.replace(/\+/g, ' ');

  const code = parsed.searchParams.get('code');
  if (!code) return 'Google sign-in did not return a code.';

  try {
    const { data, error } = await getOAuthClient().auth.exchangeCodeForSession(code);
    if (error || !data.session) return error?.message ?? 'Google sign-in failed.';
    const { error: setError } = await getSupabaseClient().auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
    return setError ? setError.message : null;
  } finally {
    clearOAuthStorage();
  }
}

/** The short-lived client's copy of the session and verifier is no longer needed. */
function clearOAuthStorage(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(OAUTH_STORAGE_KEY)) localStorage.removeItem(key);
    }
  } catch {
    // Storage unavailable — nothing was persisted then.
  }
}
