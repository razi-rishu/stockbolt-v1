/**
 * Razorpay helpers for the Vercel serverless functions (phase139).
 *
 * Secrets come ONLY from env vars (Vercel project settings):
 *   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET   — API keys (rzp_test_… / rzp_live_…)
 *   RAZORPAY_WEBHOOK_SECRET                — the secret typed when the webhook
 *                                            was created in the Razorpay dashboard
 * No card data ever touches this code: Razorpay Checkout collects it.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

const BASE = 'https://api.razorpay.com/v1';

export function razorpayKeyId(): string {
  const id = process.env.RAZORPAY_KEY_ID;
  if (!id) throw new Error('Razorpay env vars not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)');
  return id;
}

export async function razorpayFetch(path: string, opts: { method?: string; body?: unknown } = {}): Promise<unknown> {
  const id = razorpayKeyId();
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) throw new Error('Razorpay env vars not configured (RAZORPAY_KEY_SECRET)');
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const msg = (json as { error?: { description?: string } })?.error?.description ?? text;
    throw new Error(`Razorpay ${opts.method ?? 'GET'} ${path} failed: ${res.status} ${msg}`);
  }
  return json;
}

/** Razorpay signs the exact raw body: HMAC-SHA256 with the webhook secret, hex. */
export function verifyRazorpayWebhook(rawBody: string, signature: string | undefined): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Read the untouched request body (the function sets bodyParser: false). */
export async function readRawBody(req: AsyncIterable<Buffer | string>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Whether `provider` is the active billing provider (payment_provider_configs,
 * phase139: at most one row is active), with its non-secret settings.
 */
export async function activeProvider(supa: SupabaseClient, provider: string):
  Promise<{ active: boolean; config: Record<string, unknown> }> {
  const { data } = await supa.from('payment_provider_configs')
    .select('is_active, public_config').eq('provider', provider).maybeSingle();
  return { active: !!data?.is_active, config: (data?.public_config ?? {}) as Record<string, unknown> };
}

/** Unix seconds → YYYY-MM-DD (null-safe). */
export function dayOf(unix: number | null | undefined): string | null {
  return unix ? new Date(unix * 1000).toISOString().slice(0, 10) : null;
}
