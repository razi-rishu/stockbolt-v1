-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 14.14n — atomic edit_opening_balance
-- ─────────────────────────────────────────────────────────────────────────
-- Why this exists:
--
--   Phase 14.14i shipped in-place edit on posted opening rows by orchestrating
--   void → post from the frontend as two separate RPC calls. The senior-dev
--   audit (Phase 14.14j, item I — HIGH) flagged the gap: if the second call
--   fails (period locked, network blip, validation error), the first call's
--   void is already committed, leaving the operator with no row visible and
--   an audit-log entry showing only the void. No client-side compensating
--   action exists.
--
--   This RPC wraps both halves in a single PL/pgSQL function, so they run
--   inside one Postgres transaction. Either both succeed and the row is
--   replaced cleanly, or both roll back and the original row stays intact.
--
-- Contract:
--
--   edit_opening_balance(
--     p_doc_id        UUID,    -- the existing posted row to replace
--     p_void_doc_type TEXT,    -- 'invoice' | 'vendor_bill' | 'payment'
--                              -- | 'opening_gl' | 'opening_bank'
--     p_kind          TEXT,    -- 'subsidiary' | 'gl' | 'bank'
--     p_payload       JSONB    -- type-specific new values (see below)
--   ) RETURNS JSONB
--
--   Payload by kind:
--     subsidiary → { type, contact_id, doc_number, date, due_date?, amount,
--                    currency?, notes? }
--     gl         → { account_id, direction, amount, date, notes? }
--     bank       → { bank_account_id, direction, amount, date, notes? }
--
--   The function:
--     1. Validates p_payload has the required fields for p_kind.
--     2. Calls void_opening_balance(p_doc_id, p_void_doc_type, edit-reason).
--     3. Calls the appropriate post_*_opening_balance with payload values.
--     4. Returns the post RPC's JSONB result.
--
--   Atomicity: PL/pgSQL functions execute inside a single transaction by
--   default. If step 3 raises, step 2 rolls back automatically. Atomic.
-- ─────────────────────────────────────────────────────────────────────────

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
  -- Sanity checks on inputs.
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

  -- Step 1 — void the existing row. If this fails (e.g. row already voided,
  -- period locked on the original date), the exception propagates and the
  -- whole edit is rolled back; the operator sees the original error.
  PERFORM public.void_opening_balance(p_doc_id, p_void_doc_type, v_edit_reason);

  -- Step 2 — post a fresh row with the new values. Branch by kind. Any
  -- exception here rolls back step 1 too — that's the whole point.
  IF p_kind = 'subsidiary' THEN
    -- Required: type, contact_id, doc_number, date, amount
    -- Optional: due_date, currency (default RPC-side), notes
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
