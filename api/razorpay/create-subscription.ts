/**
 * POST /api/razorpay/create-subscription   (phase139)
 * Body: { cycle: 'monthly' | 'half_yearly' | 'yearly' }
 * Auth: Supabase access token (Authorization: Bearer …)
 *
 * Creates a Razorpay subscription for the caller's company on the Professional
 * plan and returns what the browser needs to open Razorpay Checkout. The
 * subscription only becomes 'active' when Razorpay's webhook confirms it —
 * this endpoint never grants access by itself.
 *
 * While the company is still in its free period, the first charge is set to
 * the day that period ends (public_config.charge_after_trial, default on):
 * Razorpay authorises the card now and charges on that date.
 */
import { activeProvider, razorpayFetch, razorpayKeyId } from '../_lib/razorpay.js';
import { getAdminClient, getCaller } from '../_lib/supa.js';

type Cycle = 'monthly' | 'half_yearly' | 'yearly';

// Razorpay needs a fixed number of billing cycles; ~10 years of each.
const TOTAL_COUNT: Record<Cycle, number> = { monthly: 120, half_yearly: 20, yearly: 10 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { userId, companyId } = await getCaller(req.headers.authorization);
    const cycle = (req.body?.cycle ?? 'monthly') as Cycle;
    if (!['monthly', 'half_yearly', 'yearly'].includes(cycle)) {
      return res.status(400).json({ error: 'Invalid cycle' });
    }

    const supa = getAdminClient();
    const provider = await activeProvider(supa, 'razorpay');
    if (!provider.active) return res.status(400).json({ error: 'Razorpay is not the active payment method.' });

    const { data: plan, error: planErr } = await supa
      .from('subscription_plans')
      .select('id, code, name, monthly_price, half_yearly_price, yearly_price, price_currency, provider_plan_ids')
      .eq('code', 'professional').eq('is_active', true).single();
    if (planErr || !plan) return res.status(500).json({ error: 'Plan not found' });

    const planId = (plan.provider_plan_ids as Record<string, Record<string, string>>)?.razorpay?.[cycle];
    if (!planId) {
      return res.status(400).json({ error: `Razorpay plan for '${cycle}' is not configured yet (subscription_plans.provider_plan_ids).` });
    }

    const { data: current } = await supa.from('subscriptions')
      .select('id, status, provider, trial_end').eq('company_id', companyId).maybeSingle();
    if (current?.provider === 'razorpay' && current.status === 'active') {
      return res.status(400).json({ error: 'This company already has an active subscription.' });
    }

    // First charge when the free period ends (if it is still running).
    const chargeAfterTrial = provider.config.charge_after_trial !== false;
    const trialEnd = current?.trial_end ? Date.parse(String(current.trial_end)) : NaN;
    const startAt = chargeAfterTrial && Number.isFinite(trialEnd) && trialEnd > Date.now() + 86_400_000
      ? Math.floor(trialEnd / 1000) : undefined;

    const created = await razorpayFetch('/subscriptions', {
      method: 'POST',
      body: {
        plan_id: planId,
        total_count: TOTAL_COUNT[cycle],
        quantity: 1,
        customer_notify: 1,
        ...(startAt ? { start_at: startAt } : {}),
        notes: { company_id: companyId, cycle },
      },
    }) as { id: string };

    const amount =
      cycle === 'monthly' ? plan.monthly_price :
      cycle === 'half_yearly' ? plan.half_yearly_price : plan.yearly_price;

    // Snapshot intent on our subscription row; status changes via webhook only.
    await supa.from('subscriptions').update({
      provider: 'razorpay',
      provider_subscription_id: created.id,
      plan_id: plan.id,
      billing_cycle: cycle,
      amount,
      currency: plan.price_currency ?? 'USD',
      updated_at: new Date().toISOString(),
    }).eq('company_id', companyId);

    if (current) {
      await supa.from('subscription_history').insert({
        company_id: companyId, subscription_id: current.id,
        from_status: current.status, to_status: current.status,
        reason: `Razorpay checkout started (${cycle})`, actor: 'user',
        metadata: { provider_subscription_id: created.id, user_id: userId, first_charge_at: startAt ?? null },
      });
    }

    const { data: who } = await supa.auth.admin.getUserById(userId);
    return res.status(200).json({
      provider: 'razorpay',
      checkout: {
        key: razorpayKeyId(),
        subscription_id: created.id,
        name: 'StockBolt',
        description: `${plan.name ?? 'StockBolt Professional'} — ${cycle.replace('_', '-')}`,
        prefill: { email: who?.user?.email ?? undefined },
        notes: { company_id: companyId },
      },
      first_charge_at: startAt ? new Date(startAt * 1000).toISOString().slice(0, 10) : null,
    });
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
