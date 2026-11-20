/**
 * POST /api/razorpay/cancel-subscription   (phase139)
 * Auth: Supabase access token. Cancels the caller's Razorpay subscription.
 *
 * A paying subscription is cancelled at the end of the current cycle (the
 * customer keeps what they paid for); one that has not started charging yet
 * (still in the free period) is cancelled straight away. Our status flips to
 * 'cancelled' when Razorpay's subscription.cancelled webhook confirms it.
 * Works even after the active provider was switched away from Razorpay.
 */
import { razorpayFetch } from '../_lib/razorpay';
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
    if (sub.provider !== 'razorpay' || !sub.provider_subscription_id) {
      return res.status(400).json({ error: 'No Razorpay subscription to cancel' });
    }

    const atCycleEnd = sub.status === 'active' ? 1 : 0;
    await razorpayFetch(`/subscriptions/${sub.provider_subscription_id}/cancel`, {
      method: 'POST',
      body: { cancel_at_cycle_end: atCycleEnd },
    });

    await supa.from('subscriptions').update({
      cancel_at_period_end: true,
      updated_at: new Date().toISOString(),
    }).eq('id', sub.id);

    await supa.from('subscription_history').insert({
      company_id: companyId, subscription_id: sub.id,
      from_status: sub.status, to_status: sub.status,
      reason: atCycleEnd
        ? 'Cancellation requested for the end of the current cycle (confirming via Razorpay webhook)'
        : 'Cancellation requested (confirming via Razorpay webhook)',
      actor: 'user',
      metadata: { user_id: userId },
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
