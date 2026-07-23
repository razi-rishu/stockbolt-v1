-- ============================================================================
-- Phase 55 — Audit M2-P1
-- Atomic per-key/per-minute rate counter for the public API.
-- ============================================================================
--
-- WHY
--   The Edge Function's rateLimited() decided by COUNTING api_request_log, which
--   is written only AFTER the response — so concurrent requests never saw each
--   other's rows (racy: a burst bypassed the limit). This adds a DB-atomic
--   counter so each request increments and reads its own count, serialized by the
--   database across concurrent requests and Edge instances.
--
-- WHAT
--   1. api_rate_buckets(api_key_id, bucket, n) — one row per key per wall-clock
--      minute; PK (api_key_id, bucket) is the ON CONFLICT target for the atomic
--      upsert-increment.
--   2. api_rate_increment(p_api_key_id, p_limit) -> boolean — atomically bumps
--      THIS minute's bucket and returns whether the new count exceeds p_limit.
--
-- SCOPE (M2-P1)
--   * NO pruning / auto-delete of buckets (deferred to M2-P2). The table will
--     grow (one row per key per minute) until a later pruning phase.
--   * api_request_log is UNCHANGED — it stays the metering/audit log; it is just
--     no longer the rate source.
--   * The Edge caller keeps the current bounded FAIL-OPEN on RPC error (the
--     fail-closed decision is deferred and will be made configurable later).
--
-- SECURITY
--   Counter is internal: RLS enabled with NO policy (no client read/write). The
--   RPC is SECURITY DEFINER, search_path pinned; EXECUTE revoked from
--   PUBLIC/anon/authenticated and granted ONLY to service_role (the Edge role).
--
-- SEMANTICS NOTE
--   This is a FIXED 1-minute window (date_trunc('minute', now())), vs the prior
--   sliding 60s window — the standard, simplest atomic approach. A fixed window
--   can allow up to ~2x the limit across a minute boundary; acceptable for a
--   courtesy throttle and consistent with "per-minute counter".
--
-- SAFETY: additive + idempotent. No data change. Applied BY HAND (SQL editor).
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.api_rate_increment(uuid, integer);
--   DROP TABLE    IF EXISTS public.api_rate_buckets;
-- ============================================================================

-- 1. Counter table -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.api_rate_buckets (
  api_key_id uuid        NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  bucket     timestamptz NOT NULL,               -- date_trunc('minute', now())
  n          integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (api_key_id, bucket)
);

-- Internal counter: lock out all client (anon/authenticated) access. The RPC
-- (SECURITY DEFINER) and the Edge service_role role bypass RLS; no policy is
-- defined, so RLS denies every tenant role.
ALTER TABLE public.api_rate_buckets ENABLE ROW LEVEL SECURITY;

-- 2. Atomic increment RPC ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.api_rate_increment(p_api_key_id uuid, p_limit integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bucket timestamptz := date_trunc('minute', now());
  v_n      integer;
BEGIN
  INSERT INTO public.api_rate_buckets (api_key_id, bucket, n)
    VALUES (p_api_key_id, v_bucket, 1)
  ON CONFLICT (api_key_id, bucket)
    DO UPDATE SET n = public.api_rate_buckets.n + 1
  RETURNING public.api_rate_buckets.n INTO v_n;

  -- limited when the running count for this minute EXCEEDS the limit (n includes
  -- the current request), preserving "p_limit requests per minute" served.
  RETURN v_n > p_limit;
END;
$$;

REVOKE ALL     ON FUNCTION public.api_rate_increment(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.api_rate_increment(uuid, integer) TO service_role;
