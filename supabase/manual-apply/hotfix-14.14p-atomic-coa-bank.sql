-- ═══════════════════════════════════════════════════════════════════════════
-- StockBolt — Phase 14.14p hotfix
-- Fix: atomic CoA + bank_accounts insert.
--
-- Why: the Phase 14.13d Add Custom Account modal called coa.create() then
-- bankAccounts.create() as two separate adapter calls. If the bank insert
-- failed (duplicate account_number, RLS, network blip), the CoA row was
-- already committed — orphan account visible in the CoA tree but invisible
-- to payment / expense / bank-transfer pickers. The friendly error message
-- mitigated the UX but left the data corrupted.
--
-- This RPC wraps both inserts in a single PL/pgSQL function. Postgres
-- rolls back the whole function on any exception, so either both halves
-- commit or both roll back. No half-created state possible.
--
-- HOW TO RUN
-- ──────────
-- Supabase Dashboard → SQL Editor → New query → paste this → Run.
-- "Success. No rows returned." → done. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

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

  RETURN jsonb_build_object('coa_id', v_coa_id, 'bank_id', v_bank_id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_coa_with_optional_bank(JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_coa_with_optional_bank(JSONB, JSONB) TO authenticated;

COMMENT ON FUNCTION public.create_coa_with_optional_bank(JSONB, JSONB) IS
  'Atomic CoA + (optional) bank_accounts insert. Replaces the Phase 14.13d '
  'two-call pattern in the Add Custom Account modal.';

NOTIFY pgrst, 'reload schema';
