-- ═══════════════════════════════════════════════════════════════════════════
-- StockBolt — Phase 14.14n hotfix
-- Fix: edit_opening_balance — atomic void + re-post under one transaction.
--
-- Why: Phase 14.14i shipped Edit on posted opening rows as two separate RPC
-- calls (void → post). If the post failed (period locked, network blip,
-- validation), the void was already committed and the operator was left
-- with no row visible.
--
-- This adds a single PL/pgSQL function that wraps both halves. Postgres
-- rolls back the whole function on any exception, so either both succeed
-- or both roll back. No half-edited state possible.
--
-- HOW TO RUN
-- ──────────
-- Supabase Dashboard → SQL Editor → New query → paste this → Run.
-- "Success. No rows returned." → done.
--
-- Idempotent (CREATE OR REPLACE FUNCTION). Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.edit_opening_balance(
  p_doc_id        UUID,
  p_void_doc_type TEXT,
  p_kind          TEXT,
  p_payload       JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_result      JSONB;
  v_edit_reason TEXT;
BEGIN
  IF p_doc_id IS NULL THEN
    RAISE EXCEPTION 'edit_opening_balance: p_doc_id is required';
  END IF;
  IF p_void_doc_type IS NULL OR p_void_doc_type = '' THEN
    RAISE EXCEPTION 'edit_opening_balance: p_void_doc_type is required';
  END IF;
  IF p_kind NOT IN ('subsidiary','gl','bank') THEN
    RAISE EXCEPTION 'edit_opening_balance: p_kind must be subsidiary | gl | bank, got %', p_kind;
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'edit_opening_balance: p_payload must be a JSON object';
  END IF;

  v_edit_reason := 'Edited on ' || to_char(NOW(), 'YYYY-MM-DD')
                   || ' — replaced with new opening row';

  PERFORM public.void_opening_balance(p_doc_id, p_void_doc_type, v_edit_reason);

  IF p_kind = 'subsidiary' THEN
    IF (p_payload->>'type') IS NULL
       OR (p_payload->>'contact_id') IS NULL
       OR (p_payload->>'doc_number') IS NULL
       OR (p_payload->>'date') IS NULL
       OR (p_payload->>'amount') IS NULL THEN
      RAISE EXCEPTION 'edit_opening_balance(subsidiary): missing required field(s) in payload';
    END IF;

    v_result := public.post_opening_balance(
      (p_payload->>'type')::TEXT,
      (p_payload->>'contact_id')::UUID,
      (p_payload->>'doc_number')::TEXT,
      (p_payload->>'date')::DATE,
      NULLIF(p_payload->>'due_date', '')::DATE,
      (p_payload->>'amount')::NUMERIC,
      COALESCE(NULLIF(p_payload->>'currency', ''), 'AED'),
      NULLIF(p_payload->>'notes', '')
    );

  ELSIF p_kind = 'gl' THEN
    IF (p_payload->>'account_id') IS NULL
       OR (p_payload->>'direction') IS NULL
       OR (p_payload->>'amount') IS NULL
       OR (p_payload->>'date') IS NULL THEN
      RAISE EXCEPTION 'edit_opening_balance(gl): missing required field(s) in payload';
    END IF;

    v_result := public.post_gl_opening_balance(
      (p_payload->>'account_id')::UUID,
      (p_payload->>'direction')::TEXT,
      (p_payload->>'amount')::NUMERIC,
      (p_payload->>'date')::DATE,
      NULLIF(p_payload->>'notes', '')
    );

  ELSIF p_kind = 'bank' THEN
    IF (p_payload->>'bank_account_id') IS NULL
       OR (p_payload->>'direction') IS NULL
       OR (p_payload->>'amount') IS NULL
       OR (p_payload->>'date') IS NULL THEN
      RAISE EXCEPTION 'edit_opening_balance(bank): missing required field(s) in payload';
    END IF;

    v_result := public.post_bank_opening_balance(
      (p_payload->>'bank_account_id')::UUID,
      (p_payload->>'direction')::TEXT,
      (p_payload->>'amount')::NUMERIC,
      (p_payload->>'date')::DATE,
      NULLIF(p_payload->>'notes', '')
    );
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.edit_opening_balance(UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edit_opening_balance(UUID, TEXT, TEXT, JSONB) TO authenticated;

COMMENT ON FUNCTION public.edit_opening_balance(UUID, TEXT, TEXT, JSONB) IS
  'Atomically replaces a posted opening-balance row by voiding it and posting '
  'a fresh one with new values, all inside a single transaction. Used by the '
  'Edit modal on /settings/opening-balances. If the new post fails, the void '
  'is rolled back so the original row stays intact.';

NOTIFY pgrst, 'reload schema';
