-- ═══════════════════════════════════════════════════════════════════════════
-- phase139 — Razorpay as a subscription payment provider, and a one-line
--            switch between providers
--
-- PayPal (phase35) needs a registered business account, so subscriptions move
-- to Razorpay. PayPal's code stays in place, hidden, so it can come back.
--
-- WHICH provider customers pay with is ONE row: payment_provider_configs with
-- is_active = true. The Billing page shows that provider's Subscribe button;
-- each provider's /api/<provider>/create-subscription refuses unless its row
-- is active. A company already subscribed through a provider can still cancel
-- through it after a switch (cancel follows subscriptions.provider).
--
-- What this migration adds:
--   1. payment_provider_configs row 'razorpay' (inactive, test mode).
--   2. At most one active provider (partial unique index).
--   3. set_billing_provider(p_provider) — deactivates every provider, then
--      activates one (or none, with NULL). Callable only by the database owner
--      (Supabase SQL editor) and the service role, never by app users.
--   4. subscription_plans.provider_plan_ids.razorpay placeholder (empty), so
--      the setup guide only has to fill in three plan IDs.
--
-- NO accounting, GL or stock change. Subscriptions stay server-written only.
--
-- SAFE TO APPLY: additive. One new row, one index, one function, one JSON key
-- merged into the plan. One transaction; re-running is safe.
--
-- PRE-CHECK on prod (expect: at most one row with is_active = true):
--   SELECT provider, is_active, mode FROM public.payment_provider_configs;
-- If two or more rows are active, STOP and send the result.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.set_billing_provider(text);
--   DROP INDEX IF EXISTS public.payment_provider_configs_one_active;
--   DELETE FROM public.payment_provider_configs WHERE provider = 'razorpay';
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Razorpay provider row ───────────────────────────────────────────────
-- public_config holds NON-secret settings only (secrets live in Vercel env):
--   charge_after_trial — first charge on the day the free period ends (true)
--                        or at checkout (false).
INSERT INTO public.payment_provider_configs (provider, is_active, mode, public_config)
VALUES ('razorpay', false, 'test', '{"charge_after_trial": true}'::jsonb)
ON CONFLICT (provider) DO NOTHING;

-- ── 2. One active provider at a time ───────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS payment_provider_configs_one_active
  ON public.payment_provider_configs ((true)) WHERE is_active;

-- ── 3. The switch ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_billing_provider(p_provider text)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_provider IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.payment_provider_configs WHERE provider = p_provider) THEN
    RAISE EXCEPTION 'Unknown payment provider %', p_provider USING ERRCODE = '22023';
  END IF;
  -- Two statements, in this order, so the one-active index is never violated.
  UPDATE public.payment_provider_configs SET is_active = false, updated_at = now() WHERE is_active;
  IF p_provider IS NOT NULL THEN
    UPDATE public.payment_provider_configs SET is_active = true, updated_at = now() WHERE provider = p_provider;
  END IF;
  RETURN COALESCE(p_provider, 'none');
END;
$function$;

REVOKE ALL ON FUNCTION public.set_billing_provider(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_billing_provider(text) TO service_role;

-- ── 4. Plan ID placeholder for Razorpay ────────────────────────────────────
UPDATE public.subscription_plans
   SET provider_plan_ids = jsonb_build_object('razorpay', '{}'::jsonb) || provider_plan_ids
 WHERE code = 'professional'
   AND NOT (provider_plan_ids ? 'razorpay');

COMMIT;

-- ── Verify after applying (read-only) ──────────────────────────────────────
-- SELECT provider, is_active, mode, public_config FROM public.payment_provider_configs ORDER BY provider;
--   expect a 'razorpay' row (inactive until set_billing_provider('razorpay'))
-- SELECT provider_plan_ids FROM public.subscription_plans WHERE code = 'professional';
--   expect a "razorpay" key
--
-- ── Switching provider (after the setup guide) ─────────────────────────────
-- SELECT public.set_billing_provider('razorpay');   -- customers pay with Razorpay
-- SELECT public.set_billing_provider('paypal');     -- back to PayPal
-- SELECT public.set_billing_provider(NULL);         -- no Subscribe button at all
