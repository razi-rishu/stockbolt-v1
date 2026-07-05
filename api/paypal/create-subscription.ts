/**
 * POST /api/paypal/create-subscription   (SaaS M3)
 * Body: { cycle: 'monthly' | 'half_yearly' | 'yearly' }
 * Auth: Supabase access token (Authorization: Bearer …)
 *
 * Creates a PayPal subscription for the caller's company on the Professional
 * plan and returns the PayPal approval URL to redirect the user to. The
 * subscription only becomes 'active' when the BILLING.SUBSCRIPTION.ACTIVATED
 * webhook confirms it — this endpoint never grants access by itself.
 */
import { paypalFetch } from '../_lib/paypal';
import { getAdminClient, getCaller } from '../_lib/supa';

type Cycle = 'monthly' | 'half_yearly' | 'yearly';

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
    const { data: plan, error: planErr } = await supa
      .from('subscription_plans')
      .select('id, code, monthly_price, half_yearly_price, yearly_price, price_currency, provider_plan_ids')
      .eq('code', 'professional').eq('is_active', true).single();
    if (planErr || !plan) return res.status(500).json({ error: 'Plan not found' });

    const paypalPlanId = (plan.provider_plan_ids as Record<string, Record<string, string>>)?.paypal?.[cycle];
    if (!paypalPlanId) {
      return res.status(400).json({ error: `PayPal plan for '${cycle}' is not configured yet (subscription_plans.provider_plan_ids).` });
    }

    const amount =
      cycle === 'monthly' ? plan.monthly_price :
      cycle === 'half_yearly' ? plan.half_yearly_price : plan.yearly_price;

    const origin = (req.headers.origin as string) || process.env.APP_URL || 'https://stockbolt-v1.vercel.app';
    const created = await paypalFetch('/v1/billing/subscriptions', {
      method: 'POST',
      body: {
        plan_id: paypalPlanId,
        custom_id: companyId,
        application_context: {
          brand_name: 'StockBolt',
          user_action: 'SUBSCRIBE_NOW',
          return_url: `${origin}/settings/billing?paypal=approved`,
          cancel_url: `${origin}/settings/billing?paypal=cancelled`,
        },
      },
    }) as { id: string; links?: { rel: string; href: string }[] };

    const approvalUrl = created.links?.find(l => l.rel === 'approve')?.href;
    if (!approvalUrl) return res.status(502).json({ error: 'PayPal did not return an approval link' });

    // Snapshot intent on our subscription row; status flips via webhook only.
    await supa.from('subscriptions').update({
      provider: 'paypal',
      provider_subscription_id: created.id,
      plan_id: plan.id,
      billing_cycle: cycle,
      amount,
      currency: plan.price_currency ?? 'USD',
      updated_at: new Date().toISOString(),
    }).eq('company_id', companyId);

    const { data: sub } = await supa.from('subscriptions').select('id, status').eq('company_id', companyId).single();
    if (sub) {
      await supa.from('subscription_history').insert({
        company_id: companyId, subscription_id: sub.id,
        from_status: sub.status, to_status: sub.status,
        reason: `PayPal checkout started (${cycle})`, actor: 'user',
        metadata: { provider_subscription_id: created.id, user_id: userId },
      });
    }

    return res.status(200).json({ approvalUrl, providerSubscriptionId: created.id });
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
