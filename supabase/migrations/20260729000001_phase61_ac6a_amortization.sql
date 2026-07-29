-- ============================================================================
-- Phase 61 — AC-6A: Prepaid / deferred-revenue / accrual schedules
--   CoA seed/backfill · amortization_schedules · amortization_entries
--   + run_amortization() / reverse_last_amortization() / cancel_amortization_schedule()
-- ============================================================================
-- Approved design (AC-6 spec, 2026-07-29):
--   • ONE engine, three kinds. An amortization schedule spreads a total over N
--     monthly periods; each period posts a two-line JE between a balance-sheet
--     account and a P&L account. Only the DIRECTION differs:
--       prepaid_expense  → Dr P&L expense      / Cr BS prepaid asset   (asset down)
--       deferred_revenue → Dr BS deferred liab / Cr P&L revenue        (liab down)
--       accrued_expense  → Dr P&L expense      / Cr BS accrued liab    (liab up)
--   • AMORTIZE ONLY — a schedule never posts the opening entry. The prepayment
--     or receipt is assumed already booked to 1410 / 2500 by the originating
--     bill, expense or payment. This makes double-booking impossible.
--   • Straight-line over a period COUNT, monthly, NO daily proration. The final
--     installment absorbs the rounding remainder so the installments always sum
--     to the total exactly (mirrors src/lib/amortization.ts — keep in lock-step).
--   • Posting REUSES post_journal_entry(), which enforces balance, period lock,
--     JE numbering and audit — so NO new GL-writing path is introduced.
--
-- Relies on (VERIFIED live): current_user_company_id(); auth_require(text);
-- has_perm(text); post_journal_entry(jsonb) -> {journal_entry_id, entry_number};
-- chart_of_accounts(company_id, code, name, name_ar, type, sub_type, is_active).
--
-- Additive + idempotent. Apply BY HAND in the Supabase SQL editor.
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.cancel_amortization_schedule(uuid,text);
--   DROP FUNCTION IF EXISTS public.reverse_last_amortization(uuid);
--   DROP FUNCTION IF EXISTS public.run_amortization(date);
--   DROP FUNCTION IF EXISTS public._amortization_installment(numeric,int,int);
--   DROP TABLE    IF EXISTS public.amortization_entries;
--   DROP TABLE    IF EXISTS public.amortization_schedules;
--   -- (leave the seeded CoA accounts; harmless if unused)
-- ============================================================================

-- 1. CoA seed + backfill for every existing company -------------------------
--    Kept deliberately separate from 1400 Vendor Advances and 2400 Customer
--    Advances, which the payments engine already uses for a different purpose.
INSERT INTO public.chart_of_accounts (company_id, code, name, name_ar, type, sub_type, is_active)
SELECT c.id, v.code, v.name, v.name_ar, v.type, v.sub_type, true
FROM public.companies c
CROSS JOIN (VALUES
  ('1410','Prepaid Expenses',  'مصروفات مدفوعة مقدمًا', 'asset',     'current'),
  ('2500','Deferred Revenue',  'إيرادات مؤجلة',          'liability', 'current')
) AS v(code, name, name_ar, type, sub_type)
WHERE NOT EXISTS (
  SELECT 1 FROM public.chart_of_accounts x WHERE x.company_id = c.id AND x.code = v.code
);

-- 2. Schedules ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amortization_schedules (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  kind              text          NOT NULL
                      CHECK (kind IN ('prepaid_expense','deferred_revenue','accrued_expense')),
  name              text          NOT NULL,
  reference         text,
  contact_id        uuid          REFERENCES public.contacts(id) ON DELETE SET NULL,
  bs_account_code   text          NOT NULL,   -- 1410 / 2500 / 2300 (balance sheet side)
  pl_account_code   text          NOT NULL,   -- expense or revenue account
  total_amount      numeric(15,2) NOT NULL CHECK (total_amount > 0),
  periods           integer       NOT NULL CHECK (periods > 0),
  start_date        date          NOT NULL,   -- first period ends at this month's end
  amortized_amount  numeric(15,2) NOT NULL DEFAULT 0,
  periods_posted    integer       NOT NULL DEFAULT 0,
  last_period_end   date,
  status            text          NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','completed','cancelled')),
  cancelled_at      timestamptz,  cancelled_by uuid,  cancel_reason text,
  notes             text,
  created_at        timestamptz   NOT NULL DEFAULT now(),  created_by uuid,
  updated_at        timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS amortization_schedules_company_status_idx
  ON public.amortization_schedules (company_id, status);

-- 3. Posted installments ledger (audit + idempotency) ------------------------
CREATE TABLE IF NOT EXISTS public.amortization_entries (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  schedule_id       uuid          NOT NULL REFERENCES public.amortization_schedules(id) ON DELETE CASCADE,
  period_index      integer       NOT NULL,
  period_end        date          NOT NULL,
  amount            numeric(15,2) NOT NULL,
  remaining_after   numeric(15,2) NOT NULL,
  journal_entry_id  uuid,
  reversed_at       timestamptz,  reversed_je_id uuid,
  created_at        timestamptz   NOT NULL DEFAULT now(),  created_by uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS amortization_entries_schedule_period_key
  ON public.amortization_entries (schedule_id, period_index);

-- 4. RLS ---------------------------------------------------------------------
--    Schedules: CRUD by accounting.write (master data).
--    Entries: read only; all writes via the SECURITY DEFINER RPCs.
ALTER TABLE public.amortization_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS amortization_schedules_read  ON public.amortization_schedules;
DROP POLICY IF EXISTS amortization_schedules_write ON public.amortization_schedules;
CREATE POLICY amortization_schedules_read ON public.amortization_schedules
  FOR SELECT USING (company_id = public.current_user_company_id());
CREATE POLICY amortization_schedules_write ON public.amortization_schedules
  FOR ALL USING (company_id = public.current_user_company_id() AND public.has_perm('accounting.write'))
          WITH CHECK (company_id = public.current_user_company_id() AND public.has_perm('accounting.write'));
REVOKE ALL ON public.amortization_schedules FROM anon;
GRANT  SELECT, INSERT, UPDATE, DELETE ON public.amortization_schedules TO authenticated;

ALTER TABLE public.amortization_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS amortization_entries_read ON public.amortization_entries;
CREATE POLICY amortization_entries_read ON public.amortization_entries
  FOR SELECT USING (company_id = public.current_user_company_id());
REVOKE ALL ON public.amortization_entries FROM anon, authenticated;
GRANT  SELECT ON public.amortization_entries TO authenticated;

-- 5. Installment helper (mirrors src/lib/amortization.ts installments()) ------
--    Period p_index is 1-based; the FINAL period absorbs the rounding remainder.
CREATE OR REPLACE FUNCTION public._amortization_installment(
  p_total numeric, p_periods int, p_index int
)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_n    int     := GREATEST(1, p_periods);
  v_tot  numeric := round(p_total, 2);
  v_base numeric := round(v_tot / v_n, 2);
BEGIN
  IF p_index < 1 OR p_index > v_n THEN RETURN 0; END IF;
  IF p_index < v_n THEN RETURN v_base; END IF;
  RETURN round(v_tot - v_base * (v_n - 1), 2);
END;
$$;

-- 6. run_amortization(p_period_end) ------------------------------------------
--    Catches every active schedule up to p_period_end, one JE per installment
--    via post_journal_entry. Idempotent per (schedule, period_index). Period
--    lock is enforced inside post_journal_entry. Posts NO JE directly.
CREATE OR REPLACE FUNCTION public.run_amortization(p_period_end date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user     uuid := auth.uid();
  v_company  uuid := public.current_user_company_id();
  v_s        public.amortization_schedules%ROWTYPE;
  v_i        int;
  v_pe       date;
  v_amount   numeric;
  v_dr       text;
  v_cr       text;
  v_je       jsonb;
  v_count    int := 0;
  v_total    numeric := 0;
BEGIN
  IF v_user IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.auth_require('accounting.write');

  FOR v_s IN
    SELECT * FROM public.amortization_schedules
     WHERE company_id = v_company AND status = 'active'
     ORDER BY start_date
     FOR UPDATE
  LOOP
    -- Direction from kind (mirrors amortizationLegs in the TS lib).
    IF v_s.kind = 'deferred_revenue' THEN
      v_dr := v_s.bs_account_code; v_cr := v_s.pl_account_code;
    ELSE
      v_dr := v_s.pl_account_code;  v_cr := v_s.bs_account_code;
    END IF;

    v_i := v_s.periods_posted + 1;
    WHILE v_i <= v_s.periods LOOP
      v_pe := (date_trunc('month', v_s.start_date)
               + ((v_i - 1) * interval '1 month')
               + interval '1 month - 1 day')::date;
      EXIT WHEN v_pe > p_period_end;

      IF NOT EXISTS (
        SELECT 1 FROM public.amortization_entries
         WHERE schedule_id = v_s.id AND period_index = v_i
      ) THEN
        v_amount := public._amortization_installment(v_s.total_amount, v_s.periods, v_i);

        IF v_amount > 0 THEN
          v_je := public.post_journal_entry(jsonb_build_object(
            'date', v_pe::text,
            'description', v_s.name || ' — ' || to_char(v_pe, 'Mon YYYY'),
            'source_type', 'amortization',
            'source_id', v_s.id::text,
            'lines', jsonb_build_array(
              jsonb_build_object('account_code', v_dr, 'debit', v_amount, 'credit', 0),
              jsonb_build_object('account_code', v_cr, 'debit', 0,        'credit', v_amount)
            )
          ));

          INSERT INTO public.amortization_entries (
            company_id, schedule_id, period_index, period_end, amount, remaining_after,
            journal_entry_id, created_by
          ) VALUES (
            v_company, v_s.id, v_i, v_pe, v_amount,
            round(v_s.total_amount - (v_s.amortized_amount + v_amount), 2),
            (v_je->>'journal_entry_id')::uuid, v_user
          );

          v_s.amortized_amount := round(v_s.amortized_amount + v_amount, 2);
          v_s.periods_posted   := v_i;
          v_count := v_count + 1;
          v_total := v_total + v_amount;
        END IF;
      END IF;

      v_i := v_i + 1;
    END LOOP;

    UPDATE public.amortization_schedules
       SET amortized_amount = v_s.amortized_amount,
           periods_posted   = v_s.periods_posted,
           last_period_end  = (SELECT MAX(period_end) FROM public.amortization_entries
                                WHERE schedule_id = v_s.id AND reversed_at IS NULL),
           status = CASE WHEN v_s.periods_posted >= v_s.periods THEN 'completed' ELSE status END,
           updated_at = now()
     WHERE id = v_s.id;
  END LOOP;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company, v_user, 'run_amortization', 'amortization', NULL,
      jsonb_build_object('period_end', p_period_end, 'entries_posted', v_count, 'total_amount', v_total));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('entries_posted', v_count, 'total_amount', v_total, 'period_end', p_period_end);
END;
$$;

-- 7. reverse_last_amortization(p_schedule_id) --------------------------------
--    LIFO correction: reverses the latest posted installment at its voucher
--    date and rolls the schedule back one period.
CREATE OR REPLACE FUNCTION public.reverse_last_amortization(p_schedule_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_company uuid := public.current_user_company_id();
  v_s       public.amortization_schedules%ROWTYPE;
  v_e       public.amortization_entries%ROWTYPE;
  v_dr      text;
  v_cr      text;
  v_je      jsonb;
BEGIN
  IF v_user IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.auth_require('accounting.write');

  SELECT * INTO v_s FROM public.amortization_schedules
    WHERE id = p_schedule_id AND company_id = v_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Schedule not found.' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO v_e FROM public.amortization_entries
    WHERE schedule_id = p_schedule_id AND company_id = v_company AND reversed_at IS NULL
    ORDER BY period_index DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nothing to reverse.' USING ERRCODE = 'P0001'; END IF;

  -- Reversal flips the original legs.
  IF v_s.kind = 'deferred_revenue' THEN
    v_dr := v_s.pl_account_code; v_cr := v_s.bs_account_code;
  ELSE
    v_dr := v_s.bs_account_code; v_cr := v_s.pl_account_code;
  END IF;

  v_je := public.post_journal_entry(jsonb_build_object(
    'date', v_e.period_end::text,
    'description', v_s.name || ' — reversal ' || to_char(v_e.period_end, 'Mon YYYY'),
    'source_type', 'amortization_reversal',
    'source_id', v_s.id::text,
    'lines', jsonb_build_array(
      jsonb_build_object('account_code', v_dr, 'debit', v_e.amount, 'credit', 0),
      jsonb_build_object('account_code', v_cr, 'debit', 0,          'credit', v_e.amount)
    )
  ));

  UPDATE public.amortization_entries
     SET reversed_at = now(), reversed_je_id = (v_je->>'journal_entry_id')::uuid
   WHERE id = v_e.id;

  UPDATE public.amortization_schedules
     SET amortized_amount = round(amortized_amount - v_e.amount, 2),
         periods_posted   = GREATEST(0, v_e.period_index - 1),
         last_period_end  = (SELECT MAX(period_end) FROM public.amortization_entries
                              WHERE schedule_id = p_schedule_id AND reversed_at IS NULL),
         status = CASE WHEN status = 'completed' THEN 'active' ELSE status END,
         updated_at = now()
   WHERE id = p_schedule_id;

  RETURN jsonb_build_object('reversed_entry_id', v_e.id,
                            'journal_entry_id', v_je->>'journal_entry_id',
                            'amount', v_e.amount);
END;
$$;

-- 8. cancel_amortization_schedule(...) ---------------------------------------
--    Stops FUTURE postings. Posts and reverses nothing — what is already
--    recognised stays recognised (use reverse_last_amortization to unwind).
CREATE OR REPLACE FUNCTION public.cancel_amortization_schedule(
  p_schedule_id uuid, p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_company uuid := public.current_user_company_id();
  v_s       public.amortization_schedules%ROWTYPE;
BEGIN
  IF v_user IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.auth_require('accounting.write');

  SELECT * INTO v_s FROM public.amortization_schedules
    WHERE id = p_schedule_id AND company_id = v_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Schedule not found.' USING ERRCODE = 'P0001'; END IF;
  IF v_s.status = 'cancelled' THEN
    RAISE EXCEPTION 'Schedule is already cancelled.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.amortization_schedules
     SET status = 'cancelled', cancel_reason = p_reason,
         cancelled_at = now(), cancelled_by = v_user, updated_at = now()
   WHERE id = p_schedule_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company, v_user, 'cancel_amortization_schedule', 'amortization_schedule', p_schedule_id,
      jsonb_build_object('reason', p_reason, 'amortized_amount', v_s.amortized_amount));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('schedule_id', p_schedule_id, 'status', 'cancelled',
                            'amortized_amount', v_s.amortized_amount,
                            'remaining', round(v_s.total_amount - v_s.amortized_amount, 2));
END;
$$;

-- 9. Grants ------------------------------------------------------------------
REVOKE ALL     ON FUNCTION public._amortization_installment(numeric,int,int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public._amortization_installment(numeric,int,int) TO authenticated;
REVOKE ALL     ON FUNCTION public.run_amortization(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.run_amortization(date) TO authenticated;
REVOKE ALL     ON FUNCTION public.reverse_last_amortization(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reverse_last_amortization(uuid) TO authenticated;
REVOKE ALL     ON FUNCTION public.cancel_amortization_schedule(uuid,text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cancel_amortization_schedule(uuid,text) TO authenticated;
