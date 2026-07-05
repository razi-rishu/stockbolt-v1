/**
 * PayPal REST helpers for the Vercel serverless functions (SaaS M3).
 *
 * Secrets come ONLY from env vars (Vercel project settings):
 *   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MODE (sandbox|live),
 *   PAYPAL_WEBHOOK_ID (for signature verification).
 * No card data ever touches this code — PayPal hosts the payment sheet.
 */

const MODE = process.env.PAYPAL_MODE === 'live' ? 'live' : 'sandbox';
export const PAYPAL_BASE =
  MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

let cachedToken: { token: string; expires: number } | null = null;

export async function getPayPalToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires - 60_000) return cachedToken.token;
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('PayPal env vars not configured (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)');
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal token failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, expires: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

export async function paypalFetch(path: string, init?: { method?: string; body?: unknown }) {
  const token = await getPayPalToken();
  const res = await fetch(`${PAYPAL_BASE}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: init?.body != null ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`PayPal ${path} → ${res.status}: ${text}`);
  return json;
}

/**
 * Verify a webhook came from PayPal, using PayPal's own verification API
 * (works with the parsed JSON event — no raw-body cert crypto needed).
 */
export async function verifyPayPalWebhook(
  headers: Record<string, string | string[] | undefined>,
  event: unknown,
): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false;
  const h = (k: string) => {
    const v = headers[k];
    return Array.isArray(v) ? v[0] : v;
  };
  try {
    const result = (await paypalFetch('/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      body: {
        auth_algo: h('paypal-auth-algo'),
        cert_url: h('paypal-cert-url'),
        transmission_id: h('paypal-transmission-id'),
        transmission_sig: h('paypal-transmission-sig'),
        transmission_time: h('paypal-transmission-time'),
        webhook_id: webhookId,
        webhook_event: event,
      },
    })) as { verification_status?: string };
    return result?.verification_status === 'SUCCESS';
  } catch {
    return false;
  }
}
