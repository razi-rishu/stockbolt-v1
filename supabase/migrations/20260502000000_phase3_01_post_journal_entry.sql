-- Phase 3 — post_journal_entry RPC
-- Atomically inserts a journal entry header + general_ledger lines.
-- Validates period lock and resolves account IDs from codes.
-- Lazily seeds the JE document sequence on first use.
--
-- Called from TypeScript AFTER client-side validation (balance, mapping rules).
-- Returns: { journal_entry_id, entry_number }

CREATE OR REPLACE FUNCTION public.post_journal_entry(p_data JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_company_id  UUID;
  v_je_id       UUID;
  v_entry_number TEXT;
  v_seq         BIGINT;
  v_date        DATE;
  v_total_debit  NUMERIC(15,2) := 0;
  v_total_credit NUMERIC(15,2) := 0;
  v_line        JSONB;
  v_account_id  UUID;
  v_lock_date   DATE;
BEGIN
  -- Resolve caller's company
  SELECT company_id INTO v_company_id
  FROM public.profiles
  WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'post_journal_entry: no company found for user %', v_user_id;
  END IF;

  -- Parse date (default today)
  v_date := COALESCE((p_data->>'date')::DATE, CURRENT_DATE);

  -- Period lock guard
  SELECT period_lock_date INTO v_lock_date
  FROM public.companies
  WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_date <= v_lock_date THEN
    RAISE EXCEPTION 'post_journal_entry: date % is on or before period lock date %',
      v_date, v_lock_date;
  END IF;

  -- Sum debits and credits (balance already enforced by TypeScript, but DB checks too)
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_data->'lines') LOOP
    v_total_debit  := v_total_debit  + COALESCE((v_line->>'debit')::NUMERIC,  0);
    v_total_credit := v_total_credit + COALESCE((v_line->>'credit')::NUMERIC, 0);
  END LOOP;

  IF ABS(v_total_debit - v_total_credit) > 0.01 THEN
    RAISE EXCEPTION 'post_journal_entry: entry does not balance (debit=%, credit=%)',
      v_total_debit, v_total_credit;
  END IF;

  -- Advance document sequence (lazy init on first JE for this company)
  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1,
        updated_at    = NOW()
  RETURNING current_value INTO v_seq;

  v_entry_number := 'JE-' || v_seq::TEXT;

  -- Insert JE header
  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id,
    currency, exchange_rate,
    total_debit, total_credit,
    created_by
  ) VALUES (
    v_company_id,
    v_entry_number,
    v_date,
    COALESCE(p_data->>'description', ''),
    COALESCE(p_data->>'source_type', 'manual'),
    (p_data->>'source_id')::UUID,
    COALESCE(p_data->>'currency',
      (SELECT currency FROM public.companies WHERE id = v_company_id)),
    COALESCE((p_data->>'exchange_rate')::NUMERIC, 1),
    v_total_debit,
    v_total_credit,
    v_user_id
  )
  RETURNING id INTO v_je_id;

  -- Insert GL lines
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_data->'lines') LOOP
    SELECT id INTO v_account_id
    FROM public.chart_of_accounts
    WHERE company_id = v_company_id
      AND code = v_line->>'account_code'
      AND is_active = true;
    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'post_journal_entry: account code % not found or inactive',
        v_line->>'account_code';
    END IF;

    INSERT INTO public.general_ledger (
      company_id, journal_entry_id, account_id, account_code, date,
      debit, credit, description,
      contact_id, related_doc_type, related_doc_id
    ) VALUES (
      v_company_id,
      v_je_id,
      v_account_id,
      v_line->>'account_code',
      v_date,
      COALESCE((v_line->>'debit')::NUMERIC,  0),
      COALESCE((v_line->>'credit')::NUMERIC, 0),
      COALESCE(v_line->>'description', p_data->>'description', ''),
      (v_line->>'contact_id')::UUID,
      COALESCE(p_data->>'source_type', 'manual'),
      (p_data->>'source_id')::UUID
    );
  END LOOP;

  -- Audit log (failure must NOT block the GL post — Rule 10)
  BEGIN
    INSERT INTO public.audit_logs (
      company_id, user_id, action, entity_type, entity_id, new_data
    ) VALUES (
      v_company_id, v_user_id, 'post_gl', 'journal_entry', v_je_id,
      jsonb_build_object(
        'entry_number', v_entry_number,
        'source_type',  COALESCE(p_data->>'source_type', 'manual'),
        'total_debit',  v_total_debit,
        'date',         v_date
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'journal_entry_id', v_je_id,
    'entry_number',     v_entry_number
  );
END;
$$;
