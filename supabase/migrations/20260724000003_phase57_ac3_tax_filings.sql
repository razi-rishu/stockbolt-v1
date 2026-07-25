-- ============================================================================
-- Phase 57 — AC-3A: VAT/GST Return filing register (tax_filings)
--   companies.tax_filing_frequency + tax_filings table
--   + file_tax_return() / reopen_tax_return()
-- ============================================================================
-- Approved design (AC-3 spec, 2026-07-24):
--   • Filing posts NO journal entry. It snapshots the computed return and
--     ADVANCES the existing companies.period_lock_date to the period end —
--     reusing the proven posting guard so "filed = locked" needs no change to
--     any posting RPC. Reopen restores prior_lock_date. (The AC-1 year-end
--     close lock mechanism, minus the JE — there is no GL to reverse.)
--   • Locking reuses period_lock_date; filing gated by accounting.write.
--   • Jurisdictions: AE_VAT (UAE + GCC 5% VAT) and IN_GST (India).
--   • Reopen is LIFO (single-lock safety): reopen the latest filed period first.
--
-- Relies on (VERIFIED live): current_user_company_id(); auth_require(text) ->
-- has_perm; companies.period_lock_date; audit_logs(company_id,user_id,action,
-- entity_type,entity_id,new_data).
--
-- Additive + idempotent. Apply BY HAND in the Supabase SQL editor.
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.reopen_tax_return(uuid);
--   DROP FUNCTION IF EXISTS public.file_tax_return(text,text,date,date,numeric,numeric,numeric,jsonb,jsonb,text);
--   DROP TABLE    IF EXISTS public.tax_filings;
--   ALTER TABLE   public.companies DROP COLUMN IF EXISTS tax_filing_frequency;
-- ============================================================================

-- 1. Company filing frequency ------------------------------------------------
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS tax_filing_frequency text NOT NULL DEFAULT 'quarterly';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'companies_tax_filing_frequency_check'
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_tax_filing_frequency_check
      CHECK (tax_filing_frequency IN ('monthly','quarterly'));
  END IF;
END$$;

-- 2. Filing register ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tax_filings (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  jurisdiction   text          NOT NULL CHECK (jurisdiction IN ('AE_VAT','IN_GST')),
  period_type    text          NOT NULL CHECK (period_type IN ('monthly','quarterly')),
  period_start   date          NOT NULL,
  period_end     date          NOT NULL,
  status         text          NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','filed','reopened')),
  output_tax     numeric(15,2) NOT NULL DEFAULT 0,
  input_tax      numeric(15,2) NOT NULL DEFAULT 0,
  net_payable    numeric(15,2) NOT NULL DEFAULT 0,
  boxes          jsonb         NOT NULL DEFAULT '[]'::jsonb,   -- computed return snapshot
  reconciliation jsonb         NOT NULL DEFAULT '{}'::jsonb,   -- GL-vs-documents snapshot
  reference_number text,                                       -- FTA / GSTN ack no. (optional)
  notes          text,
  prior_lock_date date,                                        -- lock before this filing (for reopen)
  created_at     timestamptz   NOT NULL DEFAULT now(),
  created_by     uuid,
  filed_at       timestamptz,   filed_by    uuid,
  reopened_at    timestamptz,   reopened_by uuid,
  updated_at     timestamptz   NOT NULL DEFAULT now()
);

-- 3. Constraints & indexes ---------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS tax_filings_company_period_key
  ON public.tax_filings (company_id, jurisdiction, period_start, period_end);
CREATE INDEX IF NOT EXISTS tax_filings_company_status_idx
  ON public.tax_filings (company_id, status);

-- 4. RLS: tenant read only; all writes via the SECURITY DEFINER RPCs ----------
ALTER TABLE public.tax_filings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tax_filings_read ON public.tax_filings;
CREATE POLICY tax_filings_read ON public.tax_filings
  FOR SELECT USING (company_id = public.current_user_company_id());
REVOKE ALL ON public.tax_filings FROM anon, authenticated;
GRANT  SELECT ON public.tax_filings TO authenticated;

-- 5. file_tax_return(...) ----------------------------------------------------
--    Snapshots the computed return + advances the period lock. Posts NO JE.
CREATE OR REPLACE FUNCTION public.file_tax_return(
  p_jurisdiction   text,
  p_period_type    text,
  p_period_start   date,
  p_period_end     date,
  p_output_tax     numeric,
  p_input_tax      numeric,
  p_net_payable    numeric,
  p_boxes          jsonb,
  p_reconciliation jsonb,
  p_reference      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_company uuid := public.current_user_company_id();
  v_row     public.tax_filings%ROWTYPE;
  v_lock    date;
  v_id      uuid;
BEGIN
  IF v_user IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.auth_require('accounting.write');

  IF p_jurisdiction NOT IN ('AE_VAT','IN_GST') THEN
    RAISE EXCEPTION 'Unknown tax jurisdiction %.', p_jurisdiction USING ERRCODE = 'P0001';
  END IF;
  IF p_period_type NOT IN ('monthly','quarterly') THEN
    RAISE EXCEPTION 'Unknown filing period type %.', p_period_type USING ERRCODE = 'P0001';
  END IF;
  IF p_period_end < p_period_start THEN
    RAISE EXCEPTION 'Period end precedes period start.' USING ERRCODE = 'P0001';
  END IF;
  IF p_period_end > CURRENT_DATE THEN
    RAISE EXCEPTION 'Tax period % has not ended yet.', p_period_end USING ERRCODE = 'P0001';
  END IF;

  -- Idempotency: lock the register row; reject a re-file of a filed period.
  SELECT * INTO v_row FROM public.tax_filings
    WHERE company_id = v_company AND jurisdiction = p_jurisdiction
      AND period_start = p_period_start AND period_end = p_period_end
    FOR UPDATE;
  IF FOUND AND v_row.status = 'filed' THEN
    RAISE EXCEPTION 'This tax period is already filed.' USING ERRCODE = 'P0001';
  END IF;

  SELECT period_lock_date INTO v_lock FROM public.companies WHERE id = v_company;

  INSERT INTO public.tax_filings AS f (
    company_id, jurisdiction, period_type, period_start, period_end,
    status, output_tax, input_tax, net_payable, boxes, reconciliation,
    reference_number, prior_lock_date, created_by, filed_at, filed_by, updated_at
  ) VALUES (
    v_company, p_jurisdiction, p_period_type, p_period_start, p_period_end,
    'filed', COALESCE(p_output_tax,0), COALESCE(p_input_tax,0), COALESCE(p_net_payable,0),
    COALESCE(p_boxes,'[]'::jsonb), COALESCE(p_reconciliation,'{}'::jsonb),
    p_reference, v_lock, v_user, now(), v_user, now()
  )
  ON CONFLICT (company_id, jurisdiction, period_start, period_end) DO UPDATE SET
    status = 'filed', period_type = EXCLUDED.period_type,
    output_tax = EXCLUDED.output_tax, input_tax = EXCLUDED.input_tax, net_payable = EXCLUDED.net_payable,
    boxes = EXCLUDED.boxes, reconciliation = EXCLUDED.reconciliation,
    reference_number = EXCLUDED.reference_number, prior_lock_date = EXCLUDED.prior_lock_date,
    filed_at = now(), filed_by = v_user, reopened_at = NULL, reopened_by = NULL, updated_at = now()
  RETURNING f.id INTO v_id;

  -- Advance the accounting period lock to the period end (never backward).
  UPDATE public.companies
    SET period_lock_date = GREATEST(COALESCE(period_lock_date, p_period_end), p_period_end)
    WHERE id = v_company;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company, v_user, 'file_tax_return', 'tax_filing', v_id,
      jsonb_build_object('jurisdiction', p_jurisdiction, 'period_start', p_period_start,
                         'period_end', p_period_end, 'net_payable', p_net_payable));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'filing_id', v_id, 'jurisdiction', p_jurisdiction, 'status', 'filed',
    'period_start', p_period_start, 'period_end', p_period_end, 'net_payable', p_net_payable,
    'period_lock_date', (SELECT period_lock_date FROM public.companies WHERE id = v_company));
END;
$$;

-- 6. reopen_tax_return(p_filing_id) ------------------------------------------
--    Rolls the lock back and re-opens the period. Posts/reverses NO JE.
CREATE OR REPLACE FUNCTION public.reopen_tax_return(p_filing_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_company uuid := public.current_user_company_id();
  v_row     public.tax_filings%ROWTYPE;
  v_later   boolean;
BEGIN
  IF v_user IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.auth_require('accounting.write');

  SELECT * INTO v_row FROM public.tax_filings
    WHERE id = p_filing_id AND company_id = v_company
    FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'filed' THEN
    RAISE EXCEPTION 'This tax period is not filed.' USING ERRCODE = 'P0001';
  END IF;

  -- LIFO: a single period_lock_date can only be rolled back from the top.
  SELECT EXISTS (SELECT 1 FROM public.tax_filings
                  WHERE company_id = v_company AND status = 'filed'
                    AND period_end > v_row.period_end)
    INTO v_later;
  IF v_later THEN
    RAISE EXCEPTION 'Reopen later tax periods first (reverse order).' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.companies SET period_lock_date = v_row.prior_lock_date WHERE id = v_company;

  UPDATE public.tax_filings
    SET status = 'reopened', reopened_at = now(), reopened_by = v_user, updated_at = now()
    WHERE id = v_row.id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company, v_user, 'reopen_tax_return', 'tax_filing', v_row.id,
      jsonb_build_object('jurisdiction', v_row.jurisdiction, 'period_start', v_row.period_start,
                         'period_end', v_row.period_end));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('filing_id', v_row.id, 'status', 'reopened',
    'period_lock_date', (SELECT period_lock_date FROM public.companies WHERE id = v_company));
END;
$$;

-- 7. Grants: user-facing, permission-gated inside; never PUBLIC/anon ---------
REVOKE ALL     ON FUNCTION public.file_tax_return(text,text,date,date,numeric,numeric,numeric,jsonb,jsonb,text) FROM PUBLIC, anon;
REVOKE ALL     ON FUNCTION public.reopen_tax_return(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.file_tax_return(text,text,date,date,numeric,numeric,numeric,jsonb,jsonb,text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.reopen_tax_return(uuid) TO authenticated;
