-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 0 — Migration 01: Extensions & updated_at trigger
-- ─────────────────────────────────────────────────────────────────────────
-- Foundation: pgcrypto + uuid-ossp extensions, plus the set_updated_at()
-- trigger function that every table with `updated_at` will use.
--
-- The current_user_company_id() RLS helper is defined in migration 02,
-- AFTER public.profiles exists — Postgres parses LANGUAGE sql function
-- bodies at CREATE TIME, so the function can't be defined before its
-- referenced table exists.
-- ─────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;       -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";    -- uuid_generate_v4() (back-compat)

-- Trigger function: auto-update `updated_at` to NOW() on every UPDATE.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_updated_at IS
  'Phase 0 — auto-updates updated_at on every UPDATE. Attached as BEFORE UPDATE trigger on every table that has updated_at.';
