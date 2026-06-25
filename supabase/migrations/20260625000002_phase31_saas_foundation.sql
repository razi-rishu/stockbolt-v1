-- ════════════════════════════════════════════════════════════════════════════
-- Phase 31 — SaaS Subscription Foundation (Milestone M1)
-- ════════════════════════════════════════════════════════════════════════════
-- First milestone of the SaaS billing platform (see docs/Document_6).
-- PURE DATA MODEL + RLS — no PayPal, no UI, no enforcement yet.
--
-- Backward-compat guarantees (critical — existing tenants must not change):
--   • Every EXISTING company is back-filled as a GRANDFATHERED 'active'
--     subscription (provider='manual', no billing date). They are never charged
--     and never gated.
--   • NEW companies get a 30-day 'trialing' subscription via an AFTER INSERT
--     trigger that can NEVER fail onboarding (errors are swallowed).
--   • Billing state is server-controlled: tenants get READ-ONLY RLS on their own
--     rows; there are no client INSERT/UPDATE/DELETE policies. Mutations happen
--     only via SECURITY DEFINER RPCs / the (future) webhook handler / service role.
--   • All tables are NEW — no existing table is altered. Rollback = drop them.
--
-- Reuses: current_user_company_id() + has_perm() (Phase 22), document_sequences,
-- the platform_admins super-admin model (Phase 20) for later admin RPCs.
-- Idempotent. Run by hand in the SQL Editor, then NOTIFY pgrst.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. subscription_plans — catalog (nothing hardcoded in app) ──────────────
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text UNIQUE NOT NULL,
  name              text NOT NULL,
  description       text,
  monthly_price     numeric(12,2) NOT NULL DEFAULT 0,
  yearly_price      numeric(12,2) NOT NULL DEFAULT 0,
  price_currency    text NOT NULL DEFAULT 'USD',
  trial_days        int  NOT NULL DEFAULT 30,
  features          jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_plan_ids jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {"paypal":{"monthly":"P-..","yearly":"P-.."}}
  is_active         boolean NOT NULL DEFAULT true,
  sort_order        int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ── 2. subscriptions — one per company (1:1) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  plan_id                  uuid REFERENCES public.subscription_plans(id),
  status                   text NOT NULL DEFAULT 'trialing'
                             CHECK (status IN ('trialing','active','past_due','suspended',
                                               'cancelled','expired','pending_payment','payment_failed')),
  billing_cycle            text CHECK (billing_cycle IN ('monthly','yearly')),
  provider                 text NOT NULL DEFAULT 'manual',
  provider_subscription_id text,
  grandfathered            boolean NOT NULL DEFAULT false,
  trial_start              date,
  trial_end                date,
  current_period_start     date,
  current_period_end       date,
  next_billing_date        date,
  grace_until              date,
  cancel_at_period_end     boolean NOT NULL DEFAULT false,
  amount                   numeric(12,2),
  currency                 text,
  terms_accepted_at        timestamptz,
  activated_at             timestamptz,
  cancelled_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_subscriptions_status        ON public.subscriptions(status);
CREATE INDEX IF NOT EXISTS ix_subscriptions_next_billing  ON public.subscriptions(next_billing_date);
CREATE INDEX IF NOT EXISTS ix_subscriptions_grace         ON public.subscriptions(grace_until);

-- ── 3. subscription_history — status-change audit ──────────────────────────
CREATE TABLE IF NOT EXISTS public.subscription_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  from_status     text,
  to_status       text NOT NULL,
  reason          text,
  actor           text NOT NULL DEFAULT 'system',   -- system|user|webhook|admin
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_sub_history_company ON public.subscription_history(company_id);
CREATE INDEX IF NOT EXISTS ix_sub_history_sub     ON public.subscription_history(subscription_id);

-- ── 4. billing_addresses — buyer billing identity (per company) ─────────────
CREATE TABLE IF NOT EXISTS public.billing_addresses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  company_name text,
  address      text,
  country      text,
  state        text,
  city         text,
  postal_code  text,
  tax_number   text,
  phone        text,
  email        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ── 5. tax_profiles — SELLER tax config (configurable, drives invoices) ─────
CREATE TABLE IF NOT EXISTS public.tax_profiles (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country              text UNIQUE NOT NULL,        -- 'AE' | 'IN'
  tax_label            text NOT NULL,               -- 'VAT' | 'GST'
  seller_tax_number    text,
  default_rate         numeric(6,3) NOT NULL DEFAULT 0,
  place_of_supply_state text,
  split_rules          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"intra":["CGST","SGST"],"inter":["IGST"]}
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ── 6. payment_provider_configs — provider registry (secrets stay in env) ───
CREATE TABLE IF NOT EXISTS public.payment_provider_configs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text UNIQUE NOT NULL,               -- 'paypal'
  is_active     boolean NOT NULL DEFAULT false,
  mode          text NOT NULL DEFAULT 'sandbox',     -- sandbox|live
  public_config jsonb NOT NULL DEFAULT '{}'::jsonb,  -- non-secret config only
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- RLS
-- ════════════════════════════════════════════════════════════════════════════
-- Global config (read by everyone, written by service/admin only):
ALTER TABLE public.subscription_plans        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_provider_configs  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sub_plans_read ON public.subscription_plans;
CREATE POLICY sub_plans_read ON public.subscription_plans FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS tax_profiles_read ON public.tax_profiles;
CREATE POLICY tax_profiles_read ON public.tax_profiles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS provider_cfg_read ON public.payment_provider_configs;
CREATE POLICY provider_cfg_read ON public.payment_provider_configs FOR SELECT TO authenticated USING (true);

-- Tenant-scoped, READ-ONLY for clients (no write policies → server-only writes):
ALTER TABLE public.subscriptions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscriptions_read ON public.subscriptions;
CREATE POLICY subscriptions_read ON public.subscriptions
  FOR SELECT TO authenticated USING (company_id = public.current_user_company_id());
DROP POLICY IF EXISTS sub_history_read ON public.subscription_history;
CREATE POLICY sub_history_read ON public.subscription_history
  FOR SELECT TO authenticated USING (company_id = public.current_user_company_id());

-- Billing address — tenant may read + manage its own (settings.write):
ALTER TABLE public.billing_addresses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_addr_read ON public.billing_addresses;
CREATE POLICY billing_addr_read ON public.billing_addresses
  FOR SELECT TO authenticated USING (company_id = public.current_user_company_id());
DROP POLICY IF EXISTS billing_addr_write ON public.billing_addresses;
CREATE POLICY billing_addr_write ON public.billing_addresses
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id() AND public.has_perm('settings.write'))
  WITH CHECK (company_id = public.current_user_company_id() AND public.has_perm('settings.write'));

-- ════════════════════════════════════════════════════════════════════════════
-- Seed data (idempotent)
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.subscription_plans (code, name, description, monthly_price, yearly_price, trial_days, features, sort_order)
VALUES ('professional', 'StockBolt Professional', 'Unlimited modules', 10.00, 100.00, 30,
        '{"modules":"unlimited"}'::jsonb, 1)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.tax_profiles (country, tax_label, default_rate, split_rules) VALUES
  ('AE', 'VAT', 5.000,  '{}'::jsonb),
  ('IN', 'GST', 18.000, '{"intra":["CGST","SGST"],"inter":["IGST"]}'::jsonb)
ON CONFLICT (country) DO NOTHING;

INSERT INTO public.payment_provider_configs (provider, is_active, mode, public_config)
VALUES ('paypal', false, 'sandbox', '{}'::jsonb)
ON CONFLICT (provider) DO NOTHING;

-- ── Grandfather every EXISTING company as active (never charged/gated) ──────
INSERT INTO public.subscriptions (company_id, plan_id, status, provider, grandfathered, amount, currency, activated_at)
SELECT c.id,
       (SELECT id FROM public.subscription_plans WHERE code = 'professional'),
       'active', 'manual', true, 0, 'USD', now()
FROM public.companies c
WHERE NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.company_id = c.id);

INSERT INTO public.subscription_history (company_id, subscription_id, to_status, reason, actor)
SELECT s.company_id, s.id, 'active', 'grandfathered existing tenant', 'system'
FROM public.subscriptions s
WHERE s.grandfathered = true
  AND NOT EXISTS (SELECT 1 FROM public.subscription_history h WHERE h.subscription_id = s.id);

-- ════════════════════════════════════════════════════════════════════════════
-- New-company trial trigger — NEVER fails onboarding (errors swallowed)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.tg_new_company_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan  uuid;
  v_trial int;
  v_sub   uuid;
BEGIN
  BEGIN
    SELECT id, trial_days INTO v_plan, v_trial
    FROM public.subscription_plans WHERE code = 'professional' AND is_active LIMIT 1;
    IF v_plan IS NULL THEN RETURN NEW; END IF;

    INSERT INTO public.subscriptions (company_id, plan_id, status, provider, trial_start, trial_end)
    VALUES (NEW.id, v_plan, 'trialing', 'manual', CURRENT_DATE, CURRENT_DATE + COALESCE(v_trial, 30))
    ON CONFLICT (company_id) DO NOTHING
    RETURNING id INTO v_sub;

    IF v_sub IS NOT NULL THEN
      INSERT INTO public.subscription_history (company_id, subscription_id, to_status, reason, actor)
      VALUES (NEW.id, v_sub, 'trialing', 'new company trial started', 'system');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Billing must never block company creation.
    NULL;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS companies_new_subscription ON public.companies;
CREATE TRIGGER companies_new_subscription
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.tg_new_company_subscription();

-- ════════════════════════════════════════════════════════════════════════════
-- get_my_subscription() — tenant reads its own subscription + plan (M2 UI)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_my_subscription()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_co  uuid := public.current_user_company_id();
  v_res jsonb;
BEGIN
  IF v_co IS NULL THEN RETURN NULL; END IF;
  SELECT to_jsonb(s) || jsonb_build_object(
           'plan',         to_jsonb(p),
           'trial_days_left', GREATEST(0, (s.trial_end - CURRENT_DATE))
         )
    INTO v_res
  FROM public.subscriptions s
  LEFT JOIN public.subscription_plans p ON p.id = s.plan_id
  WHERE s.company_id = v_co;
  RETURN v_res;   -- NULL if none (app treats null as no-enforcement / full access)
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_subscription() TO authenticated;

NOTIFY pgrst, 'reload schema';
