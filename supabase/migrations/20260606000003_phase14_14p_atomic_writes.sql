-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 14.14p — atomic CoA + bank quick-create
-- ─────────────────────────────────────────────────────────────────────────
-- Audit-adjacent fix. Known partial-save risk from Phase 14.13d:
--
--   The Add Custom Account modal calls coa.create() then (when the operator
--   ticks "Also add as a bank/cash account") bankAccounts.create() as two
--   separate adapter calls. If the bank insert fails (e.g. duplicate
--   account_number unique violation, RLS rejection, network blip), the
--   CoA row is already committed. Phase 14.13d added a try/catch with a
--   friendly error pointing the operator at Settings → Bank Accounts,
--   but the underlying half-created state remains: an orphan CoA row
--   that looks like a bank in the tree picker but doesn't appear in any
--   payment / expense / bank-transfer picker.
--
-- This RPC wraps both inserts in a single function body. PL/pgSQL functions
-- run inside one Postgres transaction by default — any exception in the
-- bank insert rolls back the CoA insert too. Either the operator gets a
-- fully-wired account (CoA + bank both visible everywhere) or nothing.
--
-- The bank input is OPTIONAL — pass NULL to create a pure CoA row (the
-- "uncheck the bank toggle" or non-1110/1100 parent path). The RPC
-- returns both IDs in a JSONB so the caller can navigate / invalidate.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_coa_with_optional_bank(
  p_coa  JSONB,
  p_bank JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_coa_id   UUID;
  v_bank_id  UUID;
  v_company  UUID;
BEGIN
  IF p_coa IS NULL OR jsonb_typeof(p_coa) <> 'object' THEN
    RAISE EXCEPTION 'create_coa_with_optional_bank: p_coa must be a JSON object';
  END IF;
  IF (p_coa->>'company_id') IS NULL THEN
    RAISE EXCEPTION 'create_coa_with_optional_bank: p_coa.company_id is required';
  END IF;
  IF (p_coa->>'code') IS NULL OR (p_coa->>'code') = '' THEN
    RAISE EXCEPTION 'create_coa_with_optional_bank: p_coa.code is required';
  END IF;
  IF (p_coa->>'name') IS NULL OR (p_coa->>'name') = '' THEN
    RAISE EXCEPTION 'create_coa_with_optional_bank: p_coa.name is required';
  END IF;
  IF (p_coa->>'type') IS NULL OR (p_coa->>'type') = '' THEN
    RAISE EXCEPTION 'create_coa_with_optional_bank: p_coa.type is required';
  END IF;

  v_company := (p_coa->>'company_id')::UUID;

  -- Step 1 — insert the CoA row. RLS still applies (SECURITY INVOKER).
  INSERT INTO public.chart_of_accounts (
    company_id, code, name, name_ar, type, sub_type,
    parent_id, is_active, is_system
  )
  VALUES (
    v_company,
    p_coa->>'code',
    p_coa->>'name',
    NULLIF(p_coa->>'name_ar', ''),
    p_coa->>'type',
    NULLIF(p_coa->>'sub_type', ''),
    NULLIF(p_coa->>'parent_id', '')::UUID,
    COALESCE((p_coa->>'is_active')::BOOLEAN, true),
    COALESCE((p_coa->>'is_system')::BOOLEAN, false)
  )
  RETURNING id INTO v_coa_id;

  -- Step 2 — optionally insert the matching bank_accounts row. Any
  -- exception here propagates and rolls back step 1. No orphan possible.
  IF p_bank IS NOT NULL AND jsonb_typeof(p_bank) = 'object' THEN
    INSERT INTO public.bank_accounts (
      company_id, coa_account_id, account_type, name, name_ar,
      account_number, bank_name, iban, swift_code, branch,
      currency, is_active, is_default, opening_balance
    )
    VALUES (
      v_company,
      v_coa_id,
      COALESCE(NULLIF(p_bank->>'account_type', ''), 'bank'),
      COALESCE(NULLIF(p_bank->>'name', ''), p_coa->>'name'),
      NULLIF(p_bank->>'name_ar', ''),
      NULLIF(p_bank->>'account_number', ''),
      NULLIF(p_bank->>'bank_name', ''),
      NULLIF(p_bank->>'iban', ''),
      NULLIF(p_bank->>'swift_code', ''),
      NULLIF(p_bank->>'branch', ''),
      COALESCE(
        NULLIF(p_bank->>'currency', ''),
        (SELECT NULLIF(currency, '') FROM public.companies WHERE id = v_company),
        'AED'
      ),
      COALESCE((p_bank->>'is_active')::BOOLEAN, true),
      COALESCE((p_bank->>'is_default')::BOOLEAN, false),
      COALESCE((p_bank->>'opening_balance')::NUMERIC, 0)
    )
    RETURNING id INTO v_bank_id;
  END IF;

  RETURN jsonb_build_object(
    'coa_id',  v_coa_id,
    'bank_id', v_bank_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_coa_with_optional_bank(JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_coa_with_optional_bank(JSONB, JSONB) TO authenticated;

COMMENT ON FUNCTION public.create_coa_with_optional_bank(JSONB, JSONB) IS
  'Atomically inserts a chart_of_accounts row and (optionally) a matching '
  'bank_accounts row pointing at it. Replaces the Phase 14.13d two-call '
  'pattern in the Add Custom Account modal so a failed bank insert no '
  'longer leaves an orphan CoA row.';
