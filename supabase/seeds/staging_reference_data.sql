-- ════════════════════════════════════════════════════════════════════════════
-- STAGING REFERENCE DATA — LOCAL SUPABASE ONLY. NEVER RUN ON PRODUCTION.
--
-- A schema-only restore has no rows, so the built-in roles, plans, tax
-- profiles and shared make catalog are missing, and role-based tests pass for
-- the wrong reason. This file restores the global (company_id NULL or
-- tenant-less) reference rows, exactly as the migrations define them:
--
--   roles                     5  20260619000016_phase23_custom_roles.sql
--   role_permissions         37  20260619000013_phase22_user_roles_foundation.sql
--   subscription_plans        1  phase31 insert + phase35 prices + phase49 api_access
--   tax_profiles              2  20260625000002_phase31_saas_foundation.sql
--   payment_provider_configs  1  20260625000002_phase31_saas_foundation.sql
--   vehicle_makes            34  20260625000003_phase32_automotive_catalog_c1.sql
--
-- tests/unit/staging-seed.test.ts re-derives every value from those migrations
-- and fails if this file drifts. Apply it with `npm run staging:seed`, which
-- only targets the supabase_db_stockbolt_local container.
--
-- Idempotent: every insert skips rows that already exist, and nothing is
-- updated or deleted. If an existing row differs from its migration value, an
-- assertion below fails and the whole transaction rolls back. No company-scoped
-- row is touched.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
BEGIN;

-- Refuse anything but a local-socket session. docker exec psql connects over
-- the container's unix socket; the Supabase dashboard, the CLI and any remote
-- client connect over TCP.
DO $$
BEGIN
  IF inet_server_addr() IS NOT NULL THEN
    RAISE EXCEPTION 'staging seed refused: not a local-socket session (use npm run staging:seed)';
  END IF;
END $$;

-- ── roles (phase23) ──
INSERT INTO public.roles (company_id, key, name, is_system) VALUES
  (NULL, 'admin', 'Admin', TRUE),
  (NULL, 'accountant', 'Accountant', TRUE),
  (NULL, 'sales', 'Salesperson', TRUE),
  (NULL, 'counter', 'Counter / Cashier', TRUE),
  (NULL, 'viewer', 'Viewer', TRUE)
ON CONFLICT (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), key) DO NOTHING;

-- ── role_permissions (phase22) ──
INSERT INTO public.role_permissions (company_id, role, permission) VALUES
  (NULL, 'admin', 'sales.read'),
  (NULL, 'admin', 'sales.write'),
  (NULL, 'admin', 'purchasing.read'),
  (NULL, 'admin', 'purchasing.write'),
  (NULL, 'admin', 'inventory.read'),
  (NULL, 'admin', 'inventory.write'),
  (NULL, 'admin', 'accounting.read'),
  (NULL, 'admin', 'accounting.write'),
  (NULL, 'admin', 'payroll.read'),
  (NULL, 'admin', 'payroll.write'),
  (NULL, 'admin', 'reports.read'),
  (NULL, 'admin', 'settings.read'),
  (NULL, 'admin', 'settings.write'),
  (NULL, 'admin', 'users.manage'),
  (NULL, 'accountant', 'sales.read'),
  (NULL, 'accountant', 'purchasing.read'),
  (NULL, 'accountant', 'purchasing.write'),
  (NULL, 'accountant', 'inventory.read'),
  (NULL, 'accountant', 'accounting.read'),
  (NULL, 'accountant', 'accounting.write'),
  (NULL, 'accountant', 'payroll.read'),
  (NULL, 'accountant', 'reports.read'),
  (NULL, 'accountant', 'settings.read'),
  (NULL, 'sales', 'sales.read'),
  (NULL, 'sales', 'sales.write'),
  (NULL, 'sales', 'inventory.read'),
  (NULL, 'sales', 'reports.read'),
  (NULL, 'counter', 'sales.read'),
  (NULL, 'counter', 'sales.write'),
  (NULL, 'counter', 'inventory.read'),
  (NULL, 'viewer', 'sales.read'),
  (NULL, 'viewer', 'purchasing.read'),
  (NULL, 'viewer', 'inventory.read'),
  (NULL, 'viewer', 'accounting.read'),
  (NULL, 'viewer', 'payroll.read'),
  (NULL, 'viewer', 'reports.read'),
  (NULL, 'viewer', 'settings.read')
ON CONFLICT DO NOTHING;

-- ── subscription_plans: the phase31 row with the phase35 prices and trial and
--    the phase49 api_access flag already applied ──
INSERT INTO public.subscription_plans
  (code, name, description, monthly_price, half_yearly_price, yearly_price, trial_days, features, sort_order)
VALUES ('professional', 'StockBolt Professional', 'Unlimited modules', 21.00, 105.00, 200.00, 365,
        '{"modules":"unlimited","api_access":true}'::jsonb, 1)
ON CONFLICT (code) DO NOTHING;

-- ── tax_profiles (phase31) ──
INSERT INTO public.tax_profiles (country, tax_label, default_rate, split_rules) VALUES
  ('AE', 'VAT', 5.000,  '{}'::jsonb),
  ('IN', 'GST', 18.000, '{"intra":["CGST","SGST"],"inter":["IGST"]}'::jsonb)
ON CONFLICT (country) DO NOTHING;

-- ── payment_provider_configs (phase31): inactive sandbox, no credentials ──
INSERT INTO public.payment_provider_configs (provider, is_active, mode, public_config)
VALUES ('paypal', false, 'sandbox', '{}'::jsonb)
ON CONFLICT (provider) DO NOTHING;

-- ── vehicle_makes (phase32): shared catalog; no unique key, so the same NOT EXISTS rule ──
INSERT INTO public.vehicle_makes (company_id, name, country)
SELECT NULL, s.name, s.country
FROM (VALUES
  ('Toyota', 'Japan'),
  ('Honda', 'Japan'),
  ('Nissan', 'Japan'),
  ('Mitsubishi', 'Japan'),
  ('Mazda', 'Japan'),
  ('Suzuki', 'Japan'),
  ('Lexus', 'Japan'),
  ('Isuzu', 'Japan'),
  ('Subaru', 'Japan'),
  ('Hyundai', 'South Korea'),
  ('Kia', 'South Korea'),
  ('Genesis', 'South Korea'),
  ('Ford', 'USA'),
  ('Chevrolet', 'USA'),
  ('GMC', 'USA'),
  ('Jeep', 'USA'),
  ('Dodge', 'USA'),
  ('Mercedes-Benz', 'Germany'),
  ('BMW', 'Germany'),
  ('Volkswagen', 'Germany'),
  ('Audi', 'Germany'),
  ('Porsche', 'Germany'),
  ('Renault', 'France'),
  ('Peugeot', 'France'),
  ('Citroen', 'France'),
  ('Land Rover', 'UK'),
  ('Jaguar', 'UK'),
  ('Tata', 'India'),
  ('Mahindra', 'India'),
  ('Maruti Suzuki', 'India'),
  ('MG', 'China'),
  ('Chery', 'China'),
  ('Geely', 'China'),
  ('Changan', 'China')
) AS s(name, country)
WHERE NOT EXISTS (
  SELECT 1 FROM public.vehicle_makes vm
  WHERE vm.company_id IS NULL AND lower(vm.name) = lower(s.name)
);

-- ════════════════════════════════════════════════════════════════════════════
-- Assertions: exact keys and values, not just counts. Any failure rolls back.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_missing text; v_extra text;
BEGIN
  -- roles: the 5 system roles, exact names, flagged system, global.
  SELECT string_agg(e.k, ', ') INTO v_missing FROM (VALUES ('admin', 'Admin'), ('accountant', 'Accountant'), ('sales', 'Salesperson'), ('counter', 'Counter / Cashier'), ('viewer', 'Viewer')) e(k, n)
   WHERE NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.company_id IS NULL AND r.key = e.k AND r.name = e.n AND r.is_system);
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'roles missing or different: %', v_missing; END IF;
  IF (SELECT count(*) FROM public.roles WHERE company_id IS NULL) <> 5 THEN
    RAISE EXCEPTION 'expected exactly 5 global roles, found %', (SELECT count(*) FROM public.roles WHERE company_id IS NULL);
  END IF;

  -- role_permissions: the global set equals phase22 exactly, in both directions.
  SELECT string_agg(e.r || ':' || e.p, ', ') INTO v_missing FROM (VALUES ('admin', 'sales.read'), ('admin', 'sales.write'), ('admin', 'purchasing.read'), ('admin', 'purchasing.write'), ('admin', 'inventory.read'), ('admin', 'inventory.write'), ('admin', 'accounting.read'), ('admin', 'accounting.write'), ('admin', 'payroll.read'), ('admin', 'payroll.write'), ('admin', 'reports.read'), ('admin', 'settings.read'), ('admin', 'settings.write'), ('admin', 'users.manage'), ('accountant', 'sales.read'), ('accountant', 'purchasing.read'), ('accountant', 'purchasing.write'), ('accountant', 'inventory.read'), ('accountant', 'accounting.read'), ('accountant', 'accounting.write'), ('accountant', 'payroll.read'), ('accountant', 'reports.read'), ('accountant', 'settings.read'), ('sales', 'sales.read'), ('sales', 'sales.write'), ('sales', 'inventory.read'), ('sales', 'reports.read'), ('counter', 'sales.read'), ('counter', 'sales.write'), ('counter', 'inventory.read'), ('viewer', 'sales.read'), ('viewer', 'purchasing.read'), ('viewer', 'inventory.read'), ('viewer', 'accounting.read'), ('viewer', 'payroll.read'), ('viewer', 'reports.read'), ('viewer', 'settings.read')) e(r, p)
   WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.company_id IS NULL AND rp.role = e.r AND rp.permission = e.p);
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'role_permissions missing: %', v_missing; END IF;
  SELECT string_agg(rp.role || ':' || rp.permission, ', ') INTO v_extra FROM public.role_permissions rp
   WHERE rp.company_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM (VALUES ('admin', 'sales.read'), ('admin', 'sales.write'), ('admin', 'purchasing.read'), ('admin', 'purchasing.write'), ('admin', 'inventory.read'), ('admin', 'inventory.write'), ('admin', 'accounting.read'), ('admin', 'accounting.write'), ('admin', 'payroll.read'), ('admin', 'payroll.write'), ('admin', 'reports.read'), ('admin', 'settings.read'), ('admin', 'settings.write'), ('admin', 'users.manage'), ('accountant', 'sales.read'), ('accountant', 'purchasing.read'), ('accountant', 'purchasing.write'), ('accountant', 'inventory.read'), ('accountant', 'accounting.read'), ('accountant', 'accounting.write'), ('accountant', 'payroll.read'), ('accountant', 'reports.read'), ('accountant', 'settings.read'), ('sales', 'sales.read'), ('sales', 'sales.write'), ('sales', 'inventory.read'), ('sales', 'reports.read'), ('counter', 'sales.read'), ('counter', 'sales.write'), ('counter', 'inventory.read'), ('viewer', 'sales.read'), ('viewer', 'purchasing.read'), ('viewer', 'inventory.read'), ('viewer', 'accounting.read'), ('viewer', 'payroll.read'), ('viewer', 'reports.read'), ('viewer', 'settings.read')) e(r, p) WHERE e.r = rp.role AND e.p = rp.permission);
  IF v_extra IS NOT NULL THEN RAISE EXCEPTION 'unexpected global role_permissions: %', v_extra; END IF;
  -- The permission the phase109c E7 tests depend on, spelled out.
  IF NOT EXISTS (SELECT 1 FROM public.role_permissions WHERE company_id IS NULL AND role = 'accountant' AND permission = 'accounting.write')
  OR EXISTS (SELECT 1 FROM public.role_permissions WHERE company_id IS NULL AND role IN ('viewer', 'sales', 'counter') AND permission = 'accounting.write') THEN
    RAISE EXCEPTION 'accounting.write must belong to admin and accountant only';
  END IF;

  -- subscription_plans: professional with its final values.
  IF NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE code = 'professional'
      AND name = 'StockBolt Professional' AND description = 'Unlimited modules'
      AND monthly_price = 21.00 AND half_yearly_price = 105.00 AND yearly_price = 200.00
      AND trial_days = 365 AND features = '{"modules":"unlimited","api_access":true}'::jsonb
      AND sort_order = 1 AND is_active AND price_currency = 'USD' AND provider_plan_ids = '{}'::jsonb) THEN
    RAISE EXCEPTION 'subscription plan professional missing or different from phase31/35/49';
  END IF;

  -- tax_profiles: AE and IN exactly.
  IF NOT EXISTS (SELECT 1 FROM public.tax_profiles WHERE country = 'AE' AND tax_label = 'VAT'
                   AND default_rate = 5.000 AND split_rules = '{}'::jsonb AND is_active)
  OR NOT EXISTS (SELECT 1 FROM public.tax_profiles WHERE country = 'IN' AND tax_label = 'GST' AND default_rate = 18.000
                   AND split_rules = '{"intra":["CGST","SGST"],"inter":["IGST"]}'::jsonb AND is_active) THEN
    RAISE EXCEPTION 'tax profiles AE/IN missing or different from phase31';
  END IF;

  -- payment_provider_configs: PayPal inactive, sandbox, nothing configured.
  IF NOT EXISTS (SELECT 1 FROM public.payment_provider_configs WHERE provider = 'paypal'
      AND is_active = false AND mode = 'sandbox' AND public_config = '{}'::jsonb) THEN
    RAISE EXCEPTION 'paypal provider config missing, active, live or configured';
  END IF;

  -- vehicle_makes: all 34 shared makes with their country, no duplicates.
  SELECT string_agg(e.n, ', ') INTO v_missing FROM (VALUES ('Toyota', 'Japan'), ('Honda', 'Japan'), ('Nissan', 'Japan'), ('Mitsubishi', 'Japan'), ('Mazda', 'Japan'), ('Suzuki', 'Japan'), ('Lexus', 'Japan'), ('Isuzu', 'Japan'), ('Subaru', 'Japan'), ('Hyundai', 'South Korea'), ('Kia', 'South Korea'), ('Genesis', 'South Korea'), ('Ford', 'USA'), ('Chevrolet', 'USA'), ('GMC', 'USA'), ('Jeep', 'USA'), ('Dodge', 'USA'), ('Mercedes-Benz', 'Germany'), ('BMW', 'Germany'), ('Volkswagen', 'Germany'), ('Audi', 'Germany'), ('Porsche', 'Germany'), ('Renault', 'France'), ('Peugeot', 'France'), ('Citroen', 'France'), ('Land Rover', 'UK'), ('Jaguar', 'UK'), ('Tata', 'India'), ('Mahindra', 'India'), ('Maruti Suzuki', 'India'), ('MG', 'China'), ('Chery', 'China'), ('Geely', 'China'), ('Changan', 'China')) e(n, c)
   WHERE NOT EXISTS (SELECT 1 FROM public.vehicle_makes vm WHERE vm.company_id IS NULL AND lower(vm.name) = lower(e.n) AND vm.country = e.c);
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'vehicle makes missing or different: %', v_missing; END IF;
  IF EXISTS (SELECT 1 FROM public.vehicle_makes WHERE company_id IS NULL GROUP BY lower(name) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'duplicate global vehicle makes';
  END IF;
END $$;

COMMIT;
