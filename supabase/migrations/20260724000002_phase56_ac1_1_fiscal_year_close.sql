-- ============================================================================
-- Phase 56 — AC-1.1: Fiscal Year Close engine (hard close)
--   fiscal_year_closes table + close_fiscal_year() + reopen_fiscal_year()
-- ============================================================================
-- Approved design decisions: hard close (explicit year_end_close JE zeroing
-- income/expense into Retained Earnings 3100); statuses closed/reopened (draft
-- reserved in the CHECK, not produced by these RPCs); RE fixed to code '3100';
-- fiscal years closed sequentially (FY N-1 must be closed or have no activity);
-- reopen is LIFO (no later closed year); permission gate reuses accounting.write;
-- status is authoritative and complements — does not replace — period_lock_date.
--
-- Relies on (all VERIFIED live): year_end_close ∈ journal_entries.source_type
-- CHECK; je_must_balance is DEFERRABLE INITIALLY DEFERRED (validated at commit);
-- current_user_company_id(); auth_require(text)->has_perm; reverse_journal_entry
-- dates the mirror at the voucher date and inherits source_type; period lock is
-- companies.period_lock_date. AC-1.0 already excludes year_end_close from the P&L
-- (and cash-flow net-income basis); the Balance Sheet includes it.
--
-- Additive + idempotent. Apply BY HAND in the Supabase SQL editor.
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.reopen_fiscal_year(integer);
--   DROP FUNCTION IF EXISTS public.close_fiscal_year(integer);
--   DROP TABLE    IF EXISTS public.fiscal_year_closes;
-- ============================================================================

-- 1. Lifecycle table ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fiscal_year_closes (
  id                     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  fiscal_year            integer       NOT NULL,              -- starting calendar year (e.g. 2025)
  fiscal_year_start      date          NOT NULL,              -- snapshot of the FY start used
  fiscal_year_end        date          NOT NULL,              -- close (voucher) date; snapshot
  status                 text          NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft','closed','reopened')),
  je_id                  uuid          REFERENCES public.journal_entries(id),  -- active close JE (NULL if zero-activity / reopened)
  net_income             numeric(15,2) NOT NULL DEFAULT 0,
  retained_earnings_code text          NOT NULL DEFAULT '3100',
  prior_lock_date        date,                                -- period_lock_date before this close (for reopen)
  created_at             timestamptz   NOT NULL DEFAULT now(),
  created_by             uuid,
  closed_at              timestamptz,   closed_by   uuid,
  reopened_at            timestamptz,   reopened_by uuid,
  updated_at             timestamptz   NOT NULL DEFAULT now()
);

-- 2. Constraints & indexes ---------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_year_closes_company_year_key
  ON public.fiscal_year_closes (company_id, fiscal_year);
CREATE INDEX IF NOT EXISTS fiscal_year_closes_company_status_idx
  ON public.fiscal_year_closes (company_id, status);

-- 3. RLS: tenant read only; all writes go through the SECURITY DEFINER RPCs ---
ALTER TABLE public.fiscal_year_closes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fiscal_year_closes_read ON public.fiscal_year_closes;
CREATE POLICY fiscal_year_closes_read ON public.fiscal_year_closes
  FOR SELECT USING (company_id = public.current_user_company_id());
REVOKE ALL ON public.fiscal_year_closes FROM anon, authenticated;
GRANT  SELECT ON public.fiscal_year_closes TO authenticated;

-- 4. close_fiscal_year(p_fiscal_year) ---------------------------------------
CREATE OR REPLACE FUNCTION public.close_fiscal_year(p_fiscal_year integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    uuid := auth.uid();
  v_company_id uuid := public.current_user_company_id();
  v_fys        date;
  v_fye        date;
  v_row        public.fiscal_year_closes%ROWTYPE;
  v_prev_closed  boolean;
  v_prev_activity boolean;
  v_re_id      uuid;
  v_lock_date  date;
  v_net_income numeric(15,2);
  v_has_legs   boolean;
  v_row_id     uuid;
  v_je_id      uuid;
  v_seq        bigint;
  v_entry_no   text;
  v_currency   text;
  v_total_dr   numeric(15,2) := 0;
  v_total_cr   numeric(15,2) := 0;
  v_leg        record;
  v_dr         numeric(15,2);
  v_cr         numeric(15,2);
BEGIN
  -- 4.1 Auth + permission (reuse accounting.write)
  IF v_user_id IS NULL OR v_company_id IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.auth_require('accounting.write');

  -- 4.2 Fiscal year window from the company's fiscal_year_start month/day
  SELECT make_date(p_fiscal_year,
                   EXTRACT(MONTH FROM c.fiscal_year_start)::int,
                   EXTRACT(DAY   FROM c.fiscal_year_start)::int),
         c.currency, c.period_lock_date
    INTO v_fys, v_currency, v_lock_date
    FROM public.companies c WHERE c.id = v_company_id;
  IF v_fys IS NULL THEN
    RAISE EXCEPTION 'Company fiscal year start is not set.' USING ERRCODE = 'P0001';
  END IF;
  v_fye := (v_fys + INTERVAL '1 year' - INTERVAL '1 day')::date;

  -- 4.3 The year must have ended
  IF v_fye > CURRENT_DATE THEN
    RAISE EXCEPTION 'Fiscal year % has not ended yet (ends %).', p_fiscal_year, v_fye
      USING ERRCODE = 'P0001';
  END IF;

  -- 4.4 Idempotency: lock the lifecycle row; reject if already closed
  SELECT * INTO v_row FROM public.fiscal_year_closes
    WHERE company_id = v_company_id AND fiscal_year = p_fiscal_year
    FOR UPDATE;
  IF FOUND AND v_row.status = 'closed' THEN
    RAISE EXCEPTION 'Fiscal year % is already closed.', p_fiscal_year USING ERRCODE = 'P0001';
  END IF;

  -- 4.5 Sequential guard: FY N-1 must be closed, OR have no P&L activity
  SELECT EXISTS (SELECT 1 FROM public.fiscal_year_closes
                  WHERE company_id = v_company_id AND fiscal_year = p_fiscal_year - 1
                    AND status = 'closed')
    INTO v_prev_closed;
  IF NOT v_prev_closed THEN
    SELECT EXISTS (
      SELECT 1 FROM public.general_ledger gl
        JOIN public.journal_entries  je  ON je.id  = gl.journal_entry_id
        JOIN public.chart_of_accounts coa ON coa.id = gl.account_id
       WHERE gl.company_id = v_company_id
         AND gl.date BETWEEN (v_fys - INTERVAL '1 year')::date AND (v_fye - INTERVAL '1 year')::date
         AND coa.type IN ('income','expense')
         AND je.source_type <> 'year_end_close'
    ) INTO v_prev_activity;
    IF v_prev_activity THEN
      RAISE EXCEPTION 'Close fiscal year % first — years must be closed in order.',
        p_fiscal_year - 1 USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 4.6 Resolve Retained Earnings (fixed 3100)
  SELECT id INTO v_re_id FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND code = '3100';
  IF v_re_id IS NULL THEN
    RAISE EXCEPTION 'Retained Earnings account 3100 not found for this company.'
      USING ERRCODE = 'P0001';
  END IF;

  -- 4.7 Net income for the year (SUM(credit-debit) over income+expense,
  --     excluding any prior year_end_close legs). = total closing Dr - Cr.
  SELECT COALESCE(SUM(gl.credit - gl.debit), 0)
    INTO v_net_income
    FROM public.general_ledger gl
    JOIN public.journal_entries  je  ON je.id  = gl.journal_entry_id
    JOIN public.chart_of_accounts coa ON coa.id = gl.account_id
   WHERE gl.company_id = v_company_id
     AND gl.date BETWEEN v_fys AND v_fye
     AND coa.type IN ('income','expense')
     AND je.source_type <> 'year_end_close';

  SELECT EXISTS (
    SELECT 1 FROM public.general_ledger gl
      JOIN public.journal_entries  je  ON je.id  = gl.journal_entry_id
      JOIN public.chart_of_accounts coa ON coa.id = gl.account_id
     WHERE gl.company_id = v_company_id
       AND gl.date BETWEEN v_fys AND v_fye
       AND coa.type IN ('income','expense')
       AND je.source_type <> 'year_end_close'
     GROUP BY gl.account_id HAVING SUM(gl.debit) <> SUM(gl.credit)
  ) INTO v_has_legs;

  -- 4.8 Upsert the lifecycle row → status closed (handles reopened → closed)
  INSERT INTO public.fiscal_year_closes AS f (
    company_id, fiscal_year, fiscal_year_start, fiscal_year_end,
    status, net_income, retained_earnings_code, prior_lock_date,
    created_by, closed_at, closed_by, updated_at
  ) VALUES (
    v_company_id, p_fiscal_year, v_fys, v_fye,
    'closed', v_net_income, '3100', v_lock_date,
    v_user_id, now(), v_user_id, now()
  )
  ON CONFLICT (company_id, fiscal_year) DO UPDATE SET
    status = 'closed', net_income = EXCLUDED.net_income,
    fiscal_year_start = EXCLUDED.fiscal_year_start,
    fiscal_year_end   = EXCLUDED.fiscal_year_end,
    prior_lock_date   = EXCLUDED.prior_lock_date,
    je_id = NULL, closed_at = now(), closed_by = v_user_id,
    reopened_at = NULL, reopened_by = NULL, updated_at = now()
  RETURNING f.id INTO v_row_id;

  -- 4.9 Build the close JE directly (by account_id → zeroes archived accounts too)
  IF v_has_legs THEN
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE
      SET current_value = public.document_sequences.current_value + 1, updated_at = now()
    RETURNING current_value INTO v_seq;
    v_entry_no := 'JE-' || v_seq::text;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description, source_type, source_id,
      currency, exchange_rate, total_debit, total_credit, created_by
    ) VALUES (
      v_company_id, v_entry_no, v_fye,
      'Year-end close FY ' || p_fiscal_year, 'year_end_close', v_row_id,
      v_currency, 1, 0, 0, v_user_id
    ) RETURNING id INTO v_je_id;

    -- income/expense legs — one row per posting account with non-zero net.
    -- Uniform rule zeroes each account regardless of type or contra sign.
    FOR v_leg IN
      SELECT gl.account_id, gl.account_code,
             SUM(gl.debit) AS sdr, SUM(gl.credit) AS scr
        FROM public.general_ledger gl
        JOIN public.journal_entries  je  ON je.id  = gl.journal_entry_id
        JOIN public.chart_of_accounts coa ON coa.id = gl.account_id
       WHERE gl.company_id = v_company_id
         AND gl.date BETWEEN v_fys AND v_fye
         AND coa.type IN ('income','expense')
         AND je.source_type <> 'year_end_close'
       GROUP BY gl.account_id, gl.account_code
      HAVING SUM(gl.debit) <> SUM(gl.credit)
    LOOP
      v_dr := GREATEST(v_leg.scr - v_leg.sdr, 0);
      v_cr := GREATEST(v_leg.sdr - v_leg.scr, 0);
      INSERT INTO public.general_ledger (
        company_id, journal_entry_id, account_id, account_code, date,
        debit, credit, description, related_doc_type, related_doc_id
      ) VALUES (
        v_company_id, v_je_id, v_leg.account_id, v_leg.account_code, v_fye,
        v_dr, v_cr, 'Year-end close FY ' || p_fiscal_year, 'year_end_close', v_row_id
      );
      v_total_dr := v_total_dr + v_dr;
      v_total_cr := v_total_cr + v_cr;
    END LOOP;

    -- Retained Earnings balancing leg (exact residual → balances to the cent)
    IF v_net_income > 0 THEN
      INSERT INTO public.general_ledger (company_id, journal_entry_id, account_id, account_code, date,
        debit, credit, description, related_doc_type, related_doc_id)
      VALUES (v_company_id, v_je_id, v_re_id, '3100', v_fye,
        0, v_net_income, 'Year-end close FY ' || p_fiscal_year || ' — net profit to retained earnings', 'year_end_close', v_row_id);
      v_total_cr := v_total_cr + v_net_income;
    ELSIF v_net_income < 0 THEN
      INSERT INTO public.general_ledger (company_id, journal_entry_id, account_id, account_code, date,
        debit, credit, description, related_doc_type, related_doc_id)
      VALUES (v_company_id, v_je_id, v_re_id, '3100', v_fye,
        -v_net_income, 0, 'Year-end close FY ' || p_fiscal_year || ' — net loss from retained earnings', 'year_end_close', v_row_id);
      v_total_dr := v_total_dr + (-v_net_income);
    END IF;

    UPDATE public.journal_entries
      SET total_debit = v_total_dr, total_credit = v_total_cr
      WHERE id = v_je_id;
    UPDATE public.fiscal_year_closes SET je_id = v_je_id, updated_at = now()
      WHERE id = v_row_id;
  END IF;

  -- 4.10 Advance the period lock to the year-end (never backward)
  UPDATE public.companies
    SET period_lock_date = GREATEST(COALESCE(period_lock_date, v_fye), v_fye)
    WHERE id = v_company_id;

  -- 4.11 Audit (best-effort — must not fail the close)
  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'close_fiscal_year', 'fiscal_year_close', v_row_id,
      jsonb_build_object('fiscal_year', p_fiscal_year, 'net_income', v_net_income,
                         'je_id', v_je_id, 'fiscal_year_end', v_fye));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'fiscal_year', p_fiscal_year, 'status', 'closed',
    'net_income', v_net_income, 'journal_entry_id', v_je_id,
    'entry_number', v_entry_no, 'fiscal_year_end', v_fye);
END;
$$;

-- 5. reopen_fiscal_year(p_fiscal_year) --------------------------------------
CREATE OR REPLACE FUNCTION public.reopen_fiscal_year(p_fiscal_year integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    uuid := auth.uid();
  v_company_id uuid := public.current_user_company_id();
  v_row        public.fiscal_year_closes%ROWTYPE;
  v_later      boolean;
  v_rev        jsonb := NULL;
BEGIN
  IF v_user_id IS NULL OR v_company_id IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.auth_require('accounting.write');

  SELECT * INTO v_row FROM public.fiscal_year_closes
    WHERE company_id = v_company_id AND fiscal_year = p_fiscal_year
    FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'closed' THEN
    RAISE EXCEPTION 'Fiscal year % is not closed.', p_fiscal_year USING ERRCODE = 'P0001';
  END IF;

  -- LIFO: cannot reopen a year that sits inside a still-closed later year
  SELECT EXISTS (SELECT 1 FROM public.fiscal_year_closes
                  WHERE company_id = v_company_id AND fiscal_year > p_fiscal_year
                    AND status = 'closed')
    INTO v_later;
  IF v_later THEN
    RAISE EXCEPTION 'Reopen later fiscal years first (reverse order).' USING ERRCODE = 'P0001';
  END IF;

  -- Roll the lock back FIRST (so the year-end-dated reversal is allowed)
  UPDATE public.companies SET period_lock_date = v_row.prior_lock_date
    WHERE id = v_company_id;

  -- Reverse the close JE (if any), unless already reversed
  IF v_row.je_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.journal_entries
                      WHERE id = v_row.je_id AND reversed_by_id IS NOT NULL) THEN
    v_rev := public.reverse_journal_entry(v_row.je_id, 'Reopen FY ' || p_fiscal_year);
  END IF;

  UPDATE public.fiscal_year_closes
    SET status = 'reopened', reopened_at = now(), reopened_by = v_user_id, updated_at = now()
    WHERE id = v_row.id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'reopen_fiscal_year', 'fiscal_year_close', v_row.id,
      jsonb_build_object('fiscal_year', p_fiscal_year, 'reversed_close_je', v_row.je_id));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('fiscal_year', p_fiscal_year, 'status', 'reopened', 'reversal', v_rev);
END;
$$;

-- 6. Grants: user-facing, permission-gated inside; never PUBLIC/anon ---------
REVOKE ALL     ON FUNCTION public.close_fiscal_year(integer)  FROM PUBLIC, anon;
REVOKE ALL     ON FUNCTION public.reopen_fiscal_year(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.close_fiscal_year(integer)  TO authenticated;
GRANT  EXECUTE ON FUNCTION public.reopen_fiscal_year(integer) TO authenticated;
