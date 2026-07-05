-- ════════════════════════════════════════════════════════════════════════════
-- Phase 35 — SaaS Milestone M3: PayPal + new pricing
-- ════════════════════════════════════════════════════════════════════════════
-- 1. New pricing: $21/month · $105/6-months · $200/year, ONE YEAR FREE trial.
--    Adds the missing 6-month billing cycle (plan column + cycle CHECK).
-- 2. "One year free" for EXISTING customers: grandfathered manual-active
--    subscriptions become 'trialing' with trial_end = today + 365. They keep
--    grandfathered=true (never gated even after M7 enforcement ships) — the
--    trial is an offer, not a lock. Idempotent: only rows not yet converted.
-- 3. M3 server tables: webhook_logs (idempotency + audit for PayPal events)
--    and subscription_payments (payment results, NO card data — IDs only).
--    Both RLS-enabled; webhook_logs has NO client policies (service-role only),
--    subscription_payments is tenant READ-ONLY.
-- Additive + idempotent. Run by hand in the Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Plan: 6-month price column + new prices + 1-year trial ────────────────
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS half_yearly_price numeric(12,2) NOT NULL DEFAULT 0;

UPDATE public.subscription_plans
SET monthly_price     = 21.00,
    half_yearly_price = 105.00,
    yearly_price      = 200.00,
    trial_days        = 365,
    updated_at        = now()
WHERE code = 'professional';

-- Allow the new cycle on subscriptions (constraint was inline in phase31).
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_billing_cycle_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_billing_cycle_check
  CHECK (billing_cycle IN ('monthly','half_yearly','yearly'));

-- ── 2. One year free for existing customers ─────────────────────────────────
-- Grandfathered manual-active rows (the phase31 back-fill) → trialing for 365
-- days from today. grandfathered stays true. Only touches rows that still look
-- exactly like the back-fill (no trial dates set), so re-running is a no-op.
WITH converted AS (
  UPDATE public.subscriptions
     SET status      = 'trialing',
         trial_start = CURRENT_DATE,
         trial_end   = CURRENT_DATE + 365,
         updated_at  = now()
   WHERE grandfathered = true
     AND provider = 'manual'
     AND status = 'active'
     AND trial_end IS NULL
  RETURNING id, company_id
)
INSERT INTO public.subscription_history (company_id, subscription_id, from_status, to_status, reason, actor)
SELECT company_id, id, 'active', 'trialing', 'one year free offer for existing customers', 'system'
FROM converted;

-- New signups already read trial_days from the plan (phase31 trigger) → 365 now.

-- ── 3. webhook_logs — idempotency + verification audit (service-role only) ──
CREATE TABLE IF NOT EXISTS public.webhook_logs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider           text NOT NULL,                 -- 'paypal'
  event_type         text,
  provider_event_id  text UNIQUE,                   -- dedupe key
  payload            jsonb NOT NULL DEFAULT '{}'::jsonb,
  signature_verified boolean NOT NULL DEFAULT false,
  processed          boolean NOT NULL DEFAULT false,
  processed_at       timestamptz,
  error              text,
  received_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: clients can neither read nor write; only the
-- service-role webhook handler touches this table.

-- ── 4. subscription_payments — payment results (no card data, IDs only) ─────
CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  subscription_id          uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  provider                 text NOT NULL DEFAULT 'paypal',
  provider_payment_id      text,                    -- PayPal txn/capture id
  provider_subscription_id text,
  amount                   numeric(12,2) NOT NULL DEFAULT 0,
  currency                 text NOT NULL DEFAULT 'USD',
  status                   text NOT NULL DEFAULT 'succeeded'
                             CHECK (status IN ('succeeded','failed','refunded','chargeback','pending')),
  paid_at                  timestamptz,
  raw                      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- provider response (IDs only)
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_sub_payments_company ON public.subscription_payments(company_id);
CREATE INDEX IF NOT EXISTS ix_sub_payments_sub     ON public.subscription_payments(subscription_id);
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sub_payments_read ON public.subscription_payments;
CREATE POLICY sub_payments_read ON public.subscription_payments
  FOR SELECT TO authenticated USING (company_id = public.current_user_company_id());
-- No client write policies — the webhook handler (service role) writes.

NOTIFY pgrst, 'reload schema';
