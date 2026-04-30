-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 0 — Migration 02: Section A (Core / Tenancy)
-- ─────────────────────────────────────────────────────────────────────────
-- Per Doc 2 §A: companies, profiles, audit_logs.
-- These are the foundation tables — almost everything else has a FK to
-- `companies` and an RLS policy keyed by `company_id`.
--
-- profiles.assigned_warehouse_id has a forward FK to warehouses; we add
-- that constraint in migration 03 once warehouses exists.
-- ─────────────────────────────────────────────────────────────────────────

-- ── companies ────────────────────────────────────────────────────────────
CREATE TABLE public.companies (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                        TEXT NOT NULL,
  name_ar                     TEXT,
  country_code                TEXT NOT NULL CHECK (country_code IN ('AE','SA','KW','BH','OM','QA','IN')),
  currency                    TEXT NOT NULL,
  tax_id                      TEXT,
  is_tax_registered           BOOLEAN NOT NULL DEFAULT FALSE,
  address                     TEXT,
  address_ar                  TEXT,
  city                        TEXT,
  state                       TEXT,
  phone                       TEXT,
  email                       TEXT,
  logo_url                    TEXT,
  fiscal_year_start           DATE NOT NULL DEFAULT '2026-01-01',
  base_currency               TEXT NOT NULL,
  period_lock_date            DATE,
  allow_future_dating         BOOLEAN NOT NULL DEFAULT FALSE,
  costing_method              TEXT NOT NULL DEFAULT 'mac' CHECK (costing_method IN ('mac')),
  cogs_deferral_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  prices_inclusive_of_tax     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER companies_set_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON COLUMN public.companies.costing_method IS
  'Locked to MAC for v1 per Doc 3 Part O. v2 may add fifo. LIFO permanently excluded.';
COMMENT ON COLUMN public.companies.cogs_deferral_enabled IS
  'Always TRUE in v1 — sales without cost basis defer to deferred_cogs_queue per Doc 3 A1.b.';

-- ── profiles ─────────────────────────────────────────────────────────────
-- Mirrors auth.users; created on signup. id matches auth.users.id.
CREATE TABLE public.profiles (
  id                          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id                  UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  full_name                   TEXT NOT NULL,
  email                       TEXT NOT NULL,
  role                        TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','accountant','sales','counter','viewer')),
  assigned_warehouse_id       UUID,                            -- FK added in migration 03
  phone                       TEXT,
  is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at               TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX profiles_company_id_idx ON public.profiles (company_id);
CREATE INDEX profiles_email_idx      ON public.profiles (email);

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── audit_logs ───────────────────────────────────────────────────────────
-- Append-only. Per AGENTS.md §8.5, eventual writes route through a
-- SECURITY DEFINER function (added in Phase 3). For Phase 0 we just need
-- the table; the function comes later.
CREATE TABLE public.audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  user_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action        TEXT NOT NULL CHECK (action IN ('create','update','delete','post_gl','reverse_gl','login','void','confirm','setup_completed')),
  entity_type   TEXT NOT NULL,
  entity_id     UUID,
  old_data      JSONB,
  new_data      JSONB,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_logs_company_id_idx     ON public.audit_logs (company_id, created_at DESC);
CREATE INDEX audit_logs_entity_idx         ON public.audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_user_id_idx        ON public.audit_logs (user_id);

-- ── current_user_company_id() — RLS helper ────────────────────────────────
-- Defined here (rather than migration 01) because LANGUAGE sql parses the
-- function body at CREATE TIME, so public.profiles must exist first.
-- STABLE so Postgres caches the lookup per-statement.
-- SECURITY DEFINER so it can bypass RLS to read profiles during the
-- tenant-isolation check itself (avoids a chicken-and-egg recursion).
CREATE OR REPLACE FUNCTION public.current_user_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid()
$$;

COMMENT ON FUNCTION public.current_user_company_id IS
  'Phase 0 — returns the company_id of the currently-authenticated user. Used by every tenant_isolation RLS policy. SECURITY DEFINER + STABLE.';
