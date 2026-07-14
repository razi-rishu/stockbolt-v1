-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 49 — Public API foundation (M-API 1)
-- ─────────────────────────────────────────────────────────────────────────
-- First slice of the customer-facing REST API: per-company API keys so a
-- tenant can connect their OWN data (their store / other software) to
-- StockBolt. This migration is the DB foundation only — no endpoints yet
-- (those are Supabase Edge Functions, a later phase).
--
-- Security model:
--   • A key belongs to exactly ONE company and carries a scope set.
--   • Only the SHA-256 HASH of a key is stored — never the raw secret. The
--     raw key is generated + hashed in the browser (Web Crypto) and shown to
--     the admin ONCE; the DB (and later the Edge Function) only ever see the
--     hash, so a DB leak can't reveal usable keys.
--   • The api_keys table is locked to clients (RLS on, no client policy);
--     all management goes through the SECURITY DEFINER RPCs below, each
--     gated by settings.write (admin-only) and the company's plan.
--   • Additive only. Safe to re-run (IF NOT EXISTS / OR REPLACE).
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. api_keys ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  key_prefix   TEXT NOT NULL,                                   -- shown in UI, e.g. sk_live_ab12cd34
  key_hash     TEXT NOT NULL UNIQUE,                            -- sha256 hex of the full key (lookup key)
  scopes       TEXT[] NOT NULL DEFAULT ARRAY['read']::TEXT[],   -- read | write:contacts | write:orders
  created_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS api_keys_company_idx ON public.api_keys (company_id);
CREATE INDEX IF NOT EXISTS api_keys_hash_idx    ON public.api_keys (key_hash) WHERE revoked_at IS NULL;

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
-- Deny-by-default: no client policy. Reads/writes only via the definer RPCs
-- below; the Edge Function uses the service role (bypasses RLS).

-- ── 2. api_request_log — per-key usage (metering + audit) ──────────────────
CREATE TABLE IF NOT EXISTS public.api_request_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  api_key_id  UUID REFERENCES public.api_keys(id) ON DELETE SET NULL,
  method      TEXT NOT NULL,
  path        TEXT NOT NULL,
  status_code INT,
  duration_ms INT,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS api_request_log_company_time_idx ON public.api_request_log (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_request_log_key_idx          ON public.api_request_log (api_key_id);

ALTER TABLE public.api_request_log ENABLE ROW LEVEL SECURITY;
-- Company admins may read their own usage; only the service role writes.
DROP POLICY IF EXISTS api_request_log_read ON public.api_request_log;
CREATE POLICY api_request_log_read ON public.api_request_log
  FOR SELECT
  USING (company_id = public.current_user_company_id() AND public.has_perm('settings.read'));

-- ── 3. Plan gate — API is a Professional-plan feature ──────────────────────
-- Flag the plan(s) that include API access. New/cheaper plans that omit
-- {"api_access": true} won't be able to mint keys.
UPDATE public.subscription_plans
   SET features = features || '{"api_access": true}'::jsonb
 WHERE code = 'professional';

-- company_has_api_access(): true when the current user's company holds an
-- active/trialing (or grandfathered) subscription on a plan that includes API.
CREATE OR REPLACE FUNCTION public.company_has_api_access()
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_ok BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.subscriptions s
    JOIN public.subscription_plans p ON p.id = s.plan_id
    WHERE s.company_id = public.current_user_company_id()
      AND (s.status IN ('active','trialing') OR s.grandfathered = TRUE)
      AND COALESCE((p.features ->> 'api_access')::BOOLEAN, FALSE) = TRUE
  ) INTO v_ok;
  RETURN COALESCE(v_ok, FALSE);
END;
$$;

-- ── 4. Management RPCs (admin-gated, SECURITY DEFINER) ─────────────────────
-- create_api_key: the raw secret is generated + hashed in the browser; this
-- RPC receives only the prefix + hash. Scopes are validated; company is the
-- caller's own. Returns the new row's id (the client already holds the key).
CREATE OR REPLACE FUNCTION public.create_api_key(
  p_name       TEXT,
  p_scopes     TEXT[],
  p_key_prefix TEXT,
  p_key_hash   TEXT
) RETURNS TABLE(id UUID, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_company UUID;
  v_scopes  TEXT[];
  s         TEXT;
  v_id      UUID;
  v_at      TIMESTAMPTZ;
BEGIN
  PERFORM public.auth_require('settings.write');
  v_company := public.current_user_company_id();

  IF NOT public.company_has_api_access() THEN
    RAISE EXCEPTION 'create_api_key: API access is not included in your plan' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(BTRIM(p_name), '') = '' THEN
    RAISE EXCEPTION 'create_api_key: name is required';
  END IF;
  IF p_key_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'create_api_key: key_hash must be a 64-char sha256 hex digest';
  END IF;
  IF COALESCE(BTRIM(p_key_prefix), '') = '' THEN
    RAISE EXCEPTION 'create_api_key: key_prefix is required';
  END IF;

  v_scopes := COALESCE(p_scopes, ARRAY['read']::TEXT[]);
  IF array_length(v_scopes, 1) IS NULL THEN v_scopes := ARRAY['read']::TEXT[]; END IF;
  FOREACH s IN ARRAY v_scopes LOOP
    IF s NOT IN ('read','write:contacts','write:orders') THEN
      RAISE EXCEPTION 'create_api_key: invalid scope %', s;
    END IF;
  END LOOP;

  INSERT INTO public.api_keys (company_id, name, key_prefix, key_hash, scopes, created_by)
    VALUES (v_company, BTRIM(p_name), p_key_prefix, p_key_hash, v_scopes, auth.uid())
    RETURNING api_keys.id, api_keys.created_at INTO v_id, v_at;

  RETURN QUERY SELECT v_id, v_at;
END;
$$;

-- list_api_keys: safe fields only (never the hash) for the caller's company.
CREATE OR REPLACE FUNCTION public.list_api_keys()
RETURNS TABLE(
  id UUID, name TEXT, key_prefix TEXT, scopes TEXT[],
  created_at TIMESTAMPTZ, last_used_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.auth_require('settings.write');
  RETURN QUERY
    SELECT k.id, k.name, k.key_prefix, k.scopes,
           k.created_at, k.last_used_at, k.revoked_at, k.expires_at
    FROM public.api_keys k
    WHERE k.company_id = public.current_user_company_id()
    ORDER BY k.created_at DESC;
END;
$$;

-- revoke_api_key: soft-revoke (keeps the row for audit). Own company only.
CREATE OR REPLACE FUNCTION public.revoke_api_key(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.auth_require('settings.write');
  UPDATE public.api_keys
     SET revoked_at = NOW()
   WHERE id = p_id
     AND company_id = public.current_user_company_id()
     AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'revoke_api_key: key not found or already revoked';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.company_has_api_access()                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_api_key(TEXT, TEXT[], TEXT, TEXT)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_api_keys()                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_api_key(UUID)                       TO authenticated;

COMMENT ON TABLE public.api_keys IS
  'Phase 49 — per-company public-API keys. Only the sha256 hash is stored; raw keys are generated client-side and shown once.';
