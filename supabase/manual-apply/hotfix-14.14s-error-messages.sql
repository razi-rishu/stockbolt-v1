-- ═══════════════════════════════════════════════════════════════════════════
-- StockBolt — Phase 14.14s hotfix
-- Fix: reverse_journal_entry error messages were too generic.
--
-- Existing messages were "reverse_journal_entry: …" with raw UUIDs. The
-- front-end couldn't distinguish "period locked" from "JE not found"
-- from "already reversed". Operators got cryptic Postgres-style text.
--
-- This hotfix re-creates the function with friendlier messages and
-- proper ERRCODEs:
--   42501 (insufficient_privilege)  →  caller not in a company
--   P0002 (no_data_found)           →  JE not found
--   P0001 (raise_exception)         →  already reversed / period locked
--
-- HOW TO RUN
-- ──────────
-- Supabase Dashboard → SQL Editor → New query → paste this → Run.
-- "Success. No rows returned." → done. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════


-- Phase 3 — reverse_journal_entry RPC
-- Creates a mirror JE: all GL lines with debit↔credit flipped.
-- Links original JE.reversed_by_id → new JE, new JE.reversal_of_id → original.
-- Respects period lock: reversal date defaults to today; rejects if locked.
--
-- Returns: { journal_entry_id, entry_number }

CREATE OR REPLACE FUNCTION public.reverse_journal_entry(
  p_je_id      UUID,
  p_description TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_company_id  UUID;
  v_orig        public.journal_entries%ROWTYPE;
  v_rev_id      UUID;
  v_entry_number TEXT;
  v_seq         BIGINT;
  v_today       DATE := CURRENT_DATE;
  v_lock_date   DATE;
  v_gl          public.general_ledger%ROWTYPE;
BEGIN
  -- Resolve caller's company
  SELECT company_id INTO v_company_id
  FROM public.profiles
  WHERE id = v_user_id;
  -- Phase 14.14s — friendlier error messages with ERRCODEs so the front
  -- end can distinguish "no permission" vs "not found" vs "period locked"
  -- vs "already reversed" instead of showing raw Postgres strings.
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'You are not signed in to a company. Sign out and sign back in.'
      USING ERRCODE = '42501';
  END IF;

  -- Load original JE (must belong to same company)
  SELECT * INTO v_orig
  FROM public.journal_entries
  WHERE id = p_je_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry not found, or it belongs to a different company.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_orig.reversed_by_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Journal entry % is already reversed (entry %s). Refresh the page to see the current state.',
      v_orig.entry_number, v_orig.reversed_by_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Period lock guard on REVERSAL date (today)
  SELECT period_lock_date INTO v_lock_date
  FROM public.companies
  WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_today <= v_lock_date THEN
    RAISE EXCEPTION
      'Period is locked. Cannot post a reversal on or before %s. Unlock the period (Accounting → Period Lock) or wait until after the lock date.',
      v_lock_date
      USING ERRCODE = 'P0001';
  END IF;

  -- Advance sequence
  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1,
        updated_at    = NOW()
  RETURNING current_value INTO v_seq;

  v_entry_number := 'JE-' || v_seq::TEXT;

  -- Insert reversal JE header
  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id,
    currency, exchange_rate,
    total_debit, total_credit,
    reversal_of_id,
    created_by
  ) VALUES (
    v_company_id,
    v_entry_number,
    v_today,
    COALESCE(p_description, 'Reversal of ' || v_orig.entry_number),
    v_orig.source_type,
    v_orig.source_id,
    v_orig.currency,
    v_orig.exchange_rate,
    v_orig.total_credit,   -- swapped
    v_orig.total_debit,    -- swapped
    p_je_id,
    v_user_id
  )
  RETURNING id INTO v_rev_id;

  -- Mirror each GL line with Dr↔Cr flipped
  FOR v_gl IN
    SELECT * FROM public.general_ledger
    WHERE journal_entry_id = p_je_id
  LOOP
    INSERT INTO public.general_ledger (
      company_id, journal_entry_id, account_id, account_code, date,
      debit, credit, description,
      contact_id, related_doc_type, related_doc_id,
      reversal_of_id
    ) VALUES (
      v_company_id,
      v_rev_id,
      v_gl.account_id,
      v_gl.account_code,
      v_today,
      v_gl.credit,  -- flipped
      v_gl.debit,   -- flipped
      COALESCE(p_description, 'Reversal of ' || v_orig.entry_number),
      v_gl.contact_id,
      v_gl.related_doc_type,
      v_gl.related_doc_id,
      v_gl.id
    );
  END LOOP;

  -- Mark original as reversed
  UPDATE public.journal_entries
  SET reversed_by_id = v_rev_id
  WHERE id = p_je_id;

  -- Audit log
  BEGIN
    INSERT INTO public.audit_logs (
      company_id, user_id, action, entity_type, entity_id, new_data
    ) VALUES (
      v_company_id, v_user_id, 'reverse_gl', 'journal_entry', v_rev_id,
      jsonb_build_object(
        'entry_number',    v_entry_number,
        'reversal_of_id',  p_je_id,
        'original_number', v_orig.entry_number
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'journal_entry_id', v_rev_id,
    'entry_number',     v_entry_number
  );
END;
$$;


NOTIFY pgrst, 'reload schema';
