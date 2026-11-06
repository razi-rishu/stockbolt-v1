-- phase120 — GL opening balances carry the company's currency, not 'AED'.
--
-- The committed 14.14m version of post_gl_opening_balance already reads the
-- company currency, and production ran it (found 2026-11-06). Local staging
-- held an older copy with a literal 'AED', which is what this was first built
-- from. Applied on production it is therefore functionally a no-op (same
-- lookup, two comment lines fewer); on any database still holding the old
-- copy it fixes the label. Amounts were never affected (base currency,
-- rate 1.0).
--
-- CREATE OR REPLACE keeps the owner (ledger_writer, phase119) and the grants;
-- SECURITY DEFINER and the pinned search_path are restated below.
-- Existing rows are NOT changed. Re-runnable. Rollback (restores the 14.14m
-- version, never the 'AED' one): supabase/manual-apply/phase120_rollback.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.post_gl_opening_balance(p_account_id uuid, p_direction text, p_amount numeric, p_date date, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company_id    UUID;
  v_user_id       UUID;
  v_je_id         UUID;
  v_entry_number  TEXT;
  v_seq           INT;
  v_acct_code     TEXT;
  v_acct_name     TEXT;
  v_ob_eq_id      UUID;
  v_descr         TEXT;
  v_currency      TEXT;
BEGIN
  -- Resolve and validate the target account; gives us the company_id too.
  SELECT company_id, code, name
    INTO v_company_id, v_acct_code, v_acct_name
  FROM public.chart_of_accounts WHERE id = p_account_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Chart-of-accounts row % not found', p_account_id;
  END IF;

  v_user_id := auth.uid();

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Opening amount must be positive, got %', p_amount;
  END IF;
  IF p_direction NOT IN ('debit','credit') THEN
    RAISE EXCEPTION 'Direction must be debit or credit, got %', p_direction;
  END IF;
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'Opening date is required';
  END IF;

  -- The 3010 contra account — must exist (seeded by Phase 14.09).
  SELECT id INTO v_ob_eq_id FROM public.chart_of_accounts
   WHERE company_id = v_company_id AND code = '3010';
  IF v_ob_eq_id IS NULL THEN
    RAISE EXCEPTION '3010 Opening Balance Equity not seeded for this company';
  END IF;

  -- Reserve a JE number.
  -- Phase 14.14f fix: see note in 20260522000004; padding_length/allow_reset
  -- don't exist — using defaults via column omission instead.
  INSERT INTO public.document_sequences
    (company_id, prefix, current_value, format)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}')
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1,
        updated_at    = NOW()
  RETURNING current_value INTO v_seq;
  v_entry_number := 'JE-' || v_seq::TEXT;

  v_descr := 'Opening balance — ' || v_acct_code || ' ' || v_acct_name;

  -- phase120: the company's own currency, as post_bank_opening_balance already
  -- does. A literal 'AED' labelled every non-UAE company's GL openings as dirhams.
  SELECT COALESCE(NULLIF(currency, ''), NULLIF(base_currency, ''), 'AED')
    INTO v_currency
  FROM public.companies WHERE id = v_company_id;

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, currency, exchange_rate,
    total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_entry_number, p_date,
    v_descr,
    'opening_gl', NULL, v_currency, 1.0,
    p_amount, p_amount, v_user_id
  ) RETURNING id INTO v_je_id;

  IF p_direction = 'debit' THEN
    -- Dr the target account, Cr 3010
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description)
    VALUES
      (v_company_id, v_je_id, p_account_id, v_acct_code, p_date,
       p_amount, 0, COALESCE(p_notes, v_descr));
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description)
    VALUES
      (v_company_id, v_je_id, v_ob_eq_id, '3010', p_date,
       0, p_amount, COALESCE(p_notes, v_descr));
  ELSE
    -- Cr the target account, Dr 3010
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description)
    VALUES
      (v_company_id, v_je_id, p_account_id, v_acct_code, p_date,
       0, p_amount, COALESCE(p_notes, v_descr));
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description)
    VALUES
      (v_company_id, v_je_id, v_ob_eq_id, '3010', p_date,
       p_amount, 0, COALESCE(p_notes, v_descr));
  END IF;

  -- Best-effort audit log.
  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'post_gl_opening_balance', 'journal_entry', v_je_id,
            jsonb_build_object(
              'account_code', v_acct_code, 'direction', p_direction,
              'amount', p_amount, 'date', p_date,
              'entry_number', v_entry_number));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'journal_entry_id', v_je_id,
    'entry_number',     v_entry_number,
    'account_code',     v_acct_code,
    'account_name',     v_acct_name,
    'direction',        p_direction,
    'amount',           p_amount
  );
END;
$function$;

COMMIT;
