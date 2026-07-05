/**
 * POST /api/paypal/cancel-subscription   (SaaS M3)
 * Auth: Supabase access token. Cancels the caller's PayPal subscription.
 * Our status flips to 'cancelled' when PayPal's CANCELLED webhook confirms.
 */
import { paypalFetch } from '../_lib/paypal';
import { getAdminClient, getCaller } from '../_lib/supa';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { userId, companyId } = await getCaller(req.headers.authorization);
    const supa = getAdminClient();

    const { data: sub, error } = await supa
      .from('subscriptions')
      .select('id, status, provider, provider_subscription_id')
      .eq('company_id', companyId).single();
    if (error || !sub) return res.status(404).json({ error: 'No subscription' });
    if (sub.provider !== 'paypal' || !sub.provider_subscription_id) {
      return res.status(400).json({ error: 'No PayPal subscription to cancel' });
    }

    await paypalFetch(`/v1/billing/subscriptions/${sub.provider_subscription_id}/cancel`, {
      method: 'POST',
      body: { reason: req.body?.reason ?? 'Customer requested cancellation' },
    });

    await supa.from('subscriptions').update({
      cancel_at_period_end: true,
      updated_at: new Date().toISOString(),
    }).eq('id', sub.id);

    await supa.from('subscription_history').insert({
      company_id: companyId, subscription_id: sub.id,
      from_status: sub.status, to_status: sub.status,
      reason: 'Cancellation requested (confirming via PayPal webhook)', actor: 'user',
      metadata: { user_id: userId },
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
