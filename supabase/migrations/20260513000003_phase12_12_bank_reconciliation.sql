-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 12 — Migration 12: Bank Reconciliation
-- ─────────────────────────────────────────────────────────────────────────
-- Charter-mandated "Reconciled" status. The model:
--
--   - Reconciliation lives at the GL LINE level (general_ledger).
--     Every bank-touching event (payment, vendor payment, bank transfer,
--     expense, pdc clear, manual JE) already produces a general_ledger
--     row keyed by account_id = bank-account-COA. So reconciling means
--     "tag these GL lines as matched against a bank statement."
--
--   - bank_reconciliations is a HEADER per (bank_account, statement_end_date)
--     storing the statement closing balance and lock state. Open
--     reconciliations can be re-edited; locked ones can't.
--
--   - Soft delete by design: deleting a header CASCADEs reconciliation_id
--     back to NULL on the GL lines (no GL postings change). No accounting
--     impact ever — this is metadata about the SAME GL row.
--
-- What this migration DOES NOT include:
--   - No bank statement import (CSV/OFX). Out of scope for v1 — bookkeeper
--     reconciles against the paper/PDF statement in hand.
--   - No auto-match algorithm. Manual ticking only.
--   - No reconciled_at on payments/expenses/etc — surface via JOIN to GL
--     in queries (single source of truth).
-- ─────────────────────────────────────────────────────────────────────────

-- ── bank_reconciliations ─────────────────────────────────────────────────
CREATE TABLE public.bank_reconciliations (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  bank_account_id             UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  statement_end_date          DATE NOT NULL,
  statement_closing_balance   NUMERIC(15,2) NOT NULL,
  -- Sum of GL debits − credits on the bank-account COA across the
  -- reconciled lines. Equals statement_closing_balance only when the
  -- bookkeeper has matched a clean set of items; difference goes into
  -- "outstanding" (items on book not yet on statement).
  reconciled_book_balance     NUMERIC(15,2) NOT NULL,
  outstanding_amount          NUMERIC(15,2) NOT NULL,
  -- Number of GL lines matched in this reconciliation.
  line_count                  INTEGER NOT NULL,
  notes                       TEXT,
  status                      TEXT NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open','locked')),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  locked_at                   TIMESTAMPTZ,
  locked_by                   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- A bank account can only have one OPEN reconciliation at a time —
  -- enforced by partial unique index below.
  UNIQUE (company_id, bank_account_id, statement_end_date)
);

CREATE INDEX bank_reconciliations_company_idx
  ON public.bank_reconciliations (company_id);
CREATE INDEX bank_reconciliations_bank_idx
  ON public.bank_reconciliations (bank_account_id, statement_end_date);

-- Only one OPEN recon per bank account at a time. Once locked you can
-- start a new one for the next period.
CREATE UNIQUE INDEX bank_reconciliations_one_open_per_bank
  ON public.bank_reconciliations (company_id, bank_account_id)
  WHERE status = 'open';

COMMENT ON TABLE public.bank_reconciliations IS
  'Per-statement reconciliation header. One row per (bank_account, statement_end_date). '
  'When status=locked, the matched GL lines cannot be un-reconciled.';

-- ── general_ledger.reconciliation_id ─────────────────────────────────────
ALTER TABLE public.general_ledger
  ADD COLUMN IF NOT EXISTS reconciliation_id UUID
    REFERENCES public.bank_reconciliations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS general_ledger_reconciliation_idx
  ON public.general_ledger (reconciliation_id)
  WHERE reconciliation_id IS NOT NULL;

COMMENT ON COLUMN public.general_ledger.reconciliation_id IS
  'When non-null, this GL line was matched against a bank statement in the named reconciliation. '
  'Only meaningful for lines on a bank-account COA.';

-- ── save_bank_reconciliation RPC ─────────────────────────────────────────
-- Creates (or upserts on the unique key) the header, sets the
-- reconciliation_id on the named GL lines, and recomputes the summary
-- fields. Refuses to touch GL lines that don't belong to the named bank
-- account (defense against forged inputs).
CREATE OR REPLACE FUNCTION public.save_bank_reconciliation(
  p_company_id              UUID,
  p_bank_account_id         UUID,
  p_statement_end_date      DATE,
  p_statement_closing_balance NUMERIC(15,2),
  p_gl_line_ids             UUID[],
  p_notes                   TEXT DEFAULT NULL,
  p_lock                    BOOLEAN DEFAULT FALSE
)
RETURNS public.bank_reconciliations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bank_coa_id UUID;
  v_recon       public.bank_reconciliations;
  v_existing_id UUID;
  v_book_bal    NUMERIC(15,2) := 0;
  v_line_count  INTEGER       := 0;
  v_user_id     UUID;
BEGIN
  v_user_id := auth.uid();

  -- 1. Validate bank account exists and belongs to the company. Pull
  --    its COA id so we can verify the GL lines later.
  SELECT coa_account_id INTO v_bank_coa_id
  FROM public.bank_accounts
  WHERE id = p_bank_account_id AND company_id = p_company_id;

  IF v_bank_coa_id IS NULL THEN
    RAISE EXCEPTION 'save_bank_reconciliation: bank account % not found in company %',
      p_bank_account_id, p_company_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 2. Upsert the header. Re-saving an OPEN recon for the same
  --    (bank, statement_date) updates it. Refuses to touch a LOCKED one.
  SELECT id INTO v_existing_id
  FROM public.bank_reconciliations
  WHERE company_id = p_company_id
    AND bank_account_id = p_bank_account_id
    AND statement_end_date = p_statement_end_date;

  IF v_existing_id IS NOT NULL THEN
    SELECT * INTO v_recon FROM public.bank_reconciliations WHERE id = v_existing_id;
    IF v_recon.status = 'locked' THEN
      RAISE EXCEPTION 'save_bank_reconciliation: reconciliation % is locked, cannot edit',
        v_existing_id USING ERRCODE = 'P0001';
    END IF;
    -- Clear previous matches (they may be different now)
    UPDATE public.general_ledger
       SET reconciliation_id = NULL
     WHERE reconciliation_id = v_existing_id;
  ELSE
    INSERT INTO public.bank_reconciliations
      (company_id, bank_account_id, statement_end_date,
       statement_closing_balance, reconciled_book_balance, outstanding_amount,
       line_count, notes, created_by)
    VALUES
      (p_company_id, p_bank_account_id, p_statement_end_date,
       p_statement_closing_balance, 0, 0, 0, p_notes, v_user_id)
    RETURNING * INTO v_recon;
    v_existing_id := v_recon.id;
  END IF;

  -- 3. Validate every GL line: must belong to this company, this bank's
  --    COA, and not already linked to a DIFFERENT recon (would conflict).
  --    Then set reconciliation_id on them and tally book balance.
  IF array_length(p_gl_line_ids, 1) IS NOT NULL THEN
    WITH validated AS (
      SELECT gl.id, gl.debit, gl.credit
      FROM public.general_ledger gl
      WHERE gl.id = ANY(p_gl_line_ids)
        AND gl.company_id = p_company_id
        AND gl.account_id = v_bank_coa_id
        AND (gl.reconciliation_id IS NULL OR gl.reconciliation_id = v_existing_id)
        AND gl.date <= p_statement_end_date
    )
    SELECT
      COALESCE(SUM(debit) - SUM(credit), 0),
      COUNT(*)
      INTO v_book_bal, v_line_count
    FROM validated;

    -- Fail loudly if any of the requested lines were rejected — better
    -- than silently reconciling a subset.
    IF v_line_count <> array_length(p_gl_line_ids, 1) THEN
      RAISE EXCEPTION
        'save_bank_reconciliation: % of % GL lines rejected (wrong bank, already reconciled elsewhere, or after statement date)',
        array_length(p_gl_line_ids, 1) - v_line_count, array_length(p_gl_line_ids, 1)
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.general_ledger
       SET reconciliation_id = v_existing_id
     WHERE id = ANY(p_gl_line_ids);
  END IF;

  -- 4. Update header with computed summary.
  UPDATE public.bank_reconciliations
     SET statement_closing_balance = p_statement_closing_balance,
         reconciled_book_balance   = v_book_bal,
         outstanding_amount        = p_statement_closing_balance - v_book_bal,
         line_count                = v_line_count,
         notes                     = p_notes,
         status                    = CASE WHEN p_lock THEN 'locked' ELSE 'open' END,
         locked_at                 = CASE WHEN p_lock THEN NOW() ELSE NULL END,
         locked_by                 = CASE WHEN p_lock THEN v_user_id ELSE NULL END
   WHERE id = v_existing_id
   RETURNING * INTO v_recon;

  RETURN v_recon;
END;
$$;

-- ── delete_bank_reconciliation RPC ───────────────────────────────────────
-- Soft delete (clears the header). GL lines are released back to
-- unreconciled state via the ON DELETE SET NULL on the FK. Refuses to
-- delete locked reconciliations — they're meant to be permanent.
CREATE OR REPLACE FUNCTION public.delete_bank_reconciliation(
  p_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status
  FROM public.bank_reconciliations
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'delete_bank_reconciliation: % not found', p_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_status = 'locked' THEN
    RAISE EXCEPTION
      'delete_bank_reconciliation: reconciliation % is locked, cannot delete',
      p_id USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.bank_reconciliations WHERE id = p_id;
  -- FK ON DELETE SET NULL releases the matched GL lines automatically.
END;
$$;

REVOKE ALL ON FUNCTION public.save_bank_reconciliation(UUID, UUID, DATE, NUMERIC, UUID[], TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_bank_reconciliation(UUID, UUID, DATE, NUMERIC, UUID[], TEXT, BOOLEAN) TO authenticated;
REVOKE ALL ON FUNCTION public.delete_bank_reconciliation(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_bank_reconciliation(UUID) TO authenticated;

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.bank_reconciliations ENABLE ROW LEVEL SECURITY;

CREATE POLICY bank_recon_read ON public.bank_reconciliations
  FOR SELECT
  USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

-- Inserts/updates/deletes go through the RPCs above; no direct write policy.
