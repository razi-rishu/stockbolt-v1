/**
 * POST /api/razorpay/webhook   (phase139)
 *
 * Razorpay event receiver. Every event is:
 *   1. signature-VERIFIED (HMAC-SHA256 of the raw body, RAZORPAY_WEBHOOK_SECRET),
 *   2. DEDUPED on x-razorpay-event-id via webhook_logs (unique — replay-safe),
 *   3. processed with the service role (clients can never write billing state).
 * Unhandled event types are logged and acknowledged (200) so Razorpay stops retrying.
 *
 * Mapping (Razorpay subscription → our subscriptions.status):
 *   subscription.authenticated  card authorised; still in the free period → next charge date only
 *   subscription.activated      active
 *   subscription.charged        payment recorded; active
 *   subscription.pending        payment_failed, 7-day grace (Razorpay retries the card)
 *   subscription.halted         suspended (retries exhausted)
 *   subscription.paused         suspended          subscription.resumed  active
 *   subscription.cancelled      cancelled          subscription.completed expired
 *   refund.processed            refund recorded against the original payment
 */
import { dayOf, readRawBody, verifyRazorpayWebhook } from '../_lib/razorpay.js';
import { getAdminClient } from '../_lib/supa.js';

// Razorpay signs the exact bytes it sent: Vercel must not parse the body.
export const config = { api: { bodyParser: false } };

interface RzpSubscription {
  id: string; status?: string; notes?: Record<string, string> | unknown[];
  current_start?: number | null; current_end?: number | null; charge_at?: number | null; start_at?: number | null;
}
interface RzpPayment { id: string; amount?: number; currency?: string; status?: string }
interface RzpRefund { id: string; amount?: number; currency?: string; payment_id?: string }
interface RzpEvent {
  event: string;
  created_at?: number;
  payload?: {
    subscription?: { entity?: RzpSubscription };
    payment?: { entity?: RzpPayment };
    refund?: { entity?: RzpRefund };
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supa = getAdminClient();

  const raw = await readRawBody(req);
  let event: RzpEvent;
  try { event = JSON.parse(raw) as RzpEvent; } catch { return res.status(400).json({ error: 'Malformed event' }); }
  if (!event?.event) return res.status(400).json({ error: 'Malformed event' });

  // 1. Verify it really came from Razorpay.
  const verified = verifyRazorpayWebhook(raw, req.headers['x-razorpay-signature']);
  const s = event.payload?.subscription?.entity;
  const eventId = (req.headers['x-razorpay-event-id'] as string | undefined)
    ?? `${event.event}:${s?.id ?? event.payload?.refund?.entity?.id ?? ''}:${event.created_at ?? ''}`;

  // 2. Dedupe: first writer wins. A replay of an event that was already
  //    processed exits; a retry of one that failed half-way (we answered 500)
  //    is processed again, or Razorpay's retry would be thrown away.
  const logKey = `razorpay:${eventId}`;
  let { data: logRow } = await supa
    .from('webhook_logs')
    .insert({
      provider: 'razorpay', event_type: event.event, provider_event_id: logKey,
      payload: event, signature_verified: verified,
    })
    .select('id')
    .maybeSingle();
  if (!logRow) {
    const { data: earlier } = await supa.from('webhook_logs')
      .select('id, processed').eq('provider_event_id', logKey).maybeSingle();
    if (!earlier || earlier.processed || !verified) return res.status(200).json({ ok: true, duplicate: true });
    logRow = { id: earlier.id };
  }
  if (!verified) {
    await supa.from('webhook_logs').update({ error: 'signature verification failed' }).eq('id', logRow.id);
    return res.status(400).json({ error: 'Signature verification failed' });
  }

  try {
    // Which of our subscriptions is it? By Razorpay subscription id, else by the company noted at checkout.
    type SubRow = { id: string; company_id: string; status: string };
    let sub: SubRow | null = null;
    if (s?.id) {
      const { data } = await supa.from('subscriptions').select('id, company_id, status')
        .eq('provider_subscription_id', s.id).maybeSingle();
      sub = (data as SubRow | null) ?? null;
    }
    const notedCompany = s?.notes && !Array.isArray(s.notes) ? (s.notes as Record<string, string>).company_id : undefined;
    if (!sub && notedCompany) {
      const { data } = await supa.from('subscriptions').select('id, company_id, status')
        .eq('company_id', notedCompany).maybeSingle();
      sub = (data as SubRow | null) ?? null;
    }

    const transition = async (to: string, patch: Record<string, unknown>, reason: string) => {
      if (!sub) return;
      await supa.from('subscriptions')
        .update({ status: to, updated_at: new Date().toISOString(), ...patch })
        .eq('id', sub.id);
      await supa.from('subscription_history').insert({
        company_id: sub.company_id, subscription_id: sub.id,
        from_status: sub.status, to_status: to,
        reason, actor: 'webhook', metadata: { event_id: eventId, event_type: event.event },
      });
      sub = { ...sub, status: to };
    };
    const periods = () => ({
      current_period_start: dayOf(s?.current_start),
      current_period_end: dayOf(s?.current_end),
      next_billing_date: dayOf(s?.charge_at),
    });
    const recordPayment = async (p: RzpPayment | undefined, status: 'succeeded' | 'refunded', sign = 1) => {
      if (!sub || !p) return;
      await supa.from('subscription_payments').insert({
        company_id: sub.company_id, subscription_id: sub.id,
        provider: 'razorpay', provider_payment_id: p.id ?? null,
        provider_subscription_id: s?.id ?? null,
        amount: sign * Math.abs(Number(p.amount ?? 0)) / 100,   // Razorpay amounts are in the smallest unit
        currency: (p.currency ?? 'USD').toUpperCase(),
        status, paid_at: new Date().toISOString(),
        raw: { event_id: eventId, payment_id: p.id },
      });
    };

    switch (event.event) {
      case 'subscription.authenticated': {
        // The card is authorised. During the free period nothing is charged yet:
        // keep the status, note when the first charge will happen.
        if (sub) {
          const first = dayOf(s?.charge_at ?? s?.start_at);
          await supa.from('subscriptions')
            .update({ next_billing_date: first, cancel_at_period_end: false, updated_at: new Date().toISOString() })
            .eq('id', sub.id);
          await supa.from('subscription_history').insert({
            company_id: sub.company_id, subscription_id: sub.id,
            from_status: sub.status, to_status: sub.status,
            reason: first ? `Razorpay card authorised; first charge on ${first}` : 'Razorpay card authorised',
            actor: 'webhook', metadata: { event_id: eventId, event_type: event.event },
          });
        }
        break;
      }
      case 'subscription.activated':
      case 'subscription.resumed':
        await transition('active', {
          activated_at: new Date().toISOString(), grace_until: null, cancel_at_period_end: false, ...periods(),
        }, event.event === 'subscription.resumed' ? 'Razorpay subscription resumed' : 'Razorpay subscription activated');
        break;
      case 'subscription.charged': {
        await recordPayment(event.payload?.payment?.entity, 'succeeded');
        if (sub) {
          if (sub.status !== 'active') await transition('active', { grace_until: null, ...periods() }, 'Payment received');
          else await supa.from('subscriptions').update({ ...periods(), updated_at: new Date().toISOString() }).eq('id', sub.id);
        }
        break;
      }
      case 'subscription.pending': {
        const grace = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
        await transition('payment_failed', { grace_until: grace }, 'Razorpay payment failed (7-day grace; Razorpay retries the card)');
        break;
      }
      case 'subscription.halted':
        await transition('suspended', {}, 'Razorpay subscription halted (payment retries exhausted)');
        break;
      case 'subscription.paused':
        await transition('suspended', {}, 'Razorpay subscription paused');
        break;
      case 'subscription.cancelled':
        await transition('cancelled', { cancelled_at: new Date().toISOString() }, 'Razorpay subscription cancelled');
        break;
      case 'subscription.completed':
        await transition('expired', {}, 'Razorpay subscription completed all billing cycles');
        break;
      case 'refund.processed': {
        const r = event.payload?.refund?.entity;
        if (r?.payment_id) {
          const { data: paid } = await supa.from('subscription_payments')
            .select('company_id, subscription_id, provider_subscription_id')
            .eq('provider', 'razorpay').eq('provider_payment_id', r.payment_id).maybeSingle();
          if (paid) {
            await supa.from('subscription_payments').insert({
              company_id: paid.company_id, subscription_id: paid.subscription_id,
              provider: 'razorpay', provider_payment_id: r.id,
              provider_subscription_id: paid.provider_subscription_id,
              amount: -Math.abs(Number(r.amount ?? 0)) / 100, currency: (r.currency ?? 'USD').toUpperCase(),
              status: 'refunded', paid_at: new Date().toISOString(),
              raw: { event_id: eventId, refund_id: r.id, payment_id: r.payment_id },
            });
          }
        }
        break;
      }
      default:
        // Log-only for event types we don't act on.
        break;
    }

    await supa.from('webhook_logs')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('id', logRow.id);
    return res.status(200).json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supa.from('webhook_logs').update({ error: msg }).eq('id', logRow.id);
    // 500 → Razorpay retries later (the event stays logged but unprocessed).
    return res.status(500).json({ error: msg });
  }
}
