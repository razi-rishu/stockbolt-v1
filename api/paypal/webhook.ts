/**
 * POST /api/paypal/webhook   (SaaS M3)
 *
 * PayPal event receiver. Every event is:
 *   1. signature-VERIFIED via PayPal's verification API (PAYPAL_WEBHOOK_ID),
 *   2. DEDUPED on provider_event_id via webhook_logs (unique — replay-safe),
 *   3. processed with the service role (clients can never write billing state).
 * Unhandled event types are logged + acknowledged (200) so PayPal stops retrying.
 */
import { verifyPayPalWebhook } from '../_lib/paypal';
import { getAdminClient } from '../_lib/supa';

interface PayPalEvent {
  id: string;
  event_type: string;
  resource?: {
    id?: string;
    custom_id?: string;
    billing_agreement_id?: string;          // on PAYMENT.SALE.* events
    amount?: { total?: string; currency?: string };
    billing_info?: { next_billing_time?: string };
    status?: string;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supa = getAdminClient();
  const event = req.body as PayPalEvent;
  if (!event?.id || !event?.event_type) return res.status(400).json({ error: 'Malformed event' });

  // 1. Verify it really came from PayPal.
  const verified = await verifyPayPalWebhook(req.headers, event);

  // 2. Dedupe: first writer wins; a replayed event inserts nothing and exits.
  const { data: logRow } = await supa
    .from('webhook_logs')
    .insert({
      provider: 'paypal', event_type: event.event_type, provider_event_id: event.id,
      payload: event, signature_verified: verified,
    })
    .select('id')
    .maybeSingle();
  if (!logRow) return res.status(200).json({ ok: true, duplicate: true });
  if (!verified) {
    await supa.from('webhook_logs').update({ error: 'signature verification failed' }).eq('id', logRow.id);
    return res.status(400).json({ error: 'Signature verification failed' });
  }

  try {
    const r = event.resource ?? {};
    // Subscription events carry the sub id in resource.id; sale events in billing_agreement_id.
    const providerSubId = event.event_type.startsWith('PAYMENT.SALE.')
      ? r.billing_agreement_id
      : r.id;

    let sub: { id: string; company_id: string; status: string } | null = null;
    if (providerSubId) {
      const { data } = await supa.from('subscriptions')
        .select('id, company_id, status')
        .eq('provider_subscription_id', providerSubId).maybeSingle();
      sub = data as typeof sub;
    }
    if (!sub && r.custom_id) {
      const { data } = await supa.from('subscriptions')
        .select('id, company_id, status')
        .eq('company_id', r.custom_id).maybeSingle();
      sub = data as typeof sub;
    }

    const transition = async (to: string, patch: Record<string, unknown>, reason: string) => {
      if (!sub) return;
      await supa.from('subscriptions')
        .update({ status: to, updated_at: new Date().toISOString(), ...patch })
        .eq('id', sub.id);
      await supa.from('subscription_history').insert({
        company_id: sub.company_id, subscription_id: sub.id,
        from_status: sub.status, to_status: to,
        reason, actor: 'webhook', metadata: { event_id: event.id, event_type: event.event_type },
      });
    };

    switch (event.event_type) {
      case 'BILLING.SUBSCRIPTION.ACTIVATED': {
        const nextBilling = r.billing_info?.next_billing_time?.slice(0, 10) ?? null;
        await transition('active', {
          activated_at: new Date().toISOString(),
          current_period_start: new Date().toISOString().slice(0, 10),
          current_period_end: nextBilling,
          next_billing_date: nextBilling,
          grace_until: null,
          cancel_at_period_end: false,
        }, 'PayPal subscription activated');
        break;
      }
      case 'PAYMENT.SALE.COMPLETED': {
        if (sub) {
          await supa.from('subscription_payments').insert({
            company_id: sub.company_id, subscription_id: sub.id,
            provider: 'paypal', provider_payment_id: r.id ?? null,
            provider_subscription_id: providerSubId ?? null,
            amount: Number(r.amount?.total ?? 0), currency: r.amount?.currency ?? 'USD',
            status: 'succeeded', paid_at: new Date().toISOString(),
            raw: { event_id: event.id, sale_id: r.id },
          });
          // A successful charge always means the sub is (or returns to) active.
          if (sub.status !== 'active') {
            await transition('active', { grace_until: null }, 'Payment received');
          }
        }
        break;
      }
      case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED': {
        const grace = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
        await transition('payment_failed', { grace_until: grace }, 'PayPal payment failed (7-day grace)');
        break;
      }
      case 'BILLING.SUBSCRIPTION.CANCELLED': {
        await transition('cancelled', { cancelled_at: new Date().toISOString() }, 'PayPal subscription cancelled');
        break;
      }
      case 'BILLING.SUBSCRIPTION.SUSPENDED': {
        await transition('suspended', {}, 'PayPal subscription suspended');
        break;
      }
      case 'PAYMENT.SALE.REFUNDED': {
        if (sub) {
          await supa.from('subscription_payments').insert({
            company_id: sub.company_id, subscription_id: sub.id,
            provider: 'paypal', provider_payment_id: r.id ?? null,
            provider_subscription_id: providerSubId ?? null,
            amount: -Math.abs(Number(r.amount?.total ?? 0)), currency: r.amount?.currency ?? 'USD',
            status: 'refunded', paid_at: new Date().toISOString(),
            raw: { event_id: event.id, refund_id: r.id },
          });
        }
        break;
      }
      default:
        // Log-only for event types we don't act on yet.
        break;
    }

    await supa.from('webhook_logs')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('id', logRow.id);
    return res.status(200).json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supa.from('webhook_logs').update({ error: msg }).eq('id', logRow.id);
    // 500 → PayPal retries later (event stays unprocessed but logged).
    return res.status(500).json({ error: msg });
  }
}
