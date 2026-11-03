-- phase112: a reversed depreciation / amortization month can be posted again
--
-- WHAT WENT WRONG
-- reverse_last_depreciation / reverse_last_amortization keep the entry (they
-- set reversed_at and post the opposite journal entry) and roll the asset or
-- schedule back one period. But run_depreciation / run_amortization skipped a
-- period if ANY entry existed for it, reversed or not, and a unique index on
-- (asset_id, period_end) / (schedule_id, period_index) would have refused a
-- fresh row anyway. So a reversed month could never be posted again: the asset
-- stayed under-depreciated (book value too high, expense too low), and the
-- schedule stayed short. Found 2026-11-03 by fixed-assets F9 on local staging.
-- Production has the same definitions.
--
-- THE FIX
--  * The two unique indexes become partial: at most ONE ACTIVE entry
--    (reversed_at IS NULL) per asset/period and per schedule/installment.
--    Reversed entries stay, untouched, as history. The database enforces the
--    rule, so even two concurrent runs can't both post (and both functions
--    already lock the asset/schedule row FOR UPDATE).
--  * run_depreciation / run_amortization only skip a period that has an
--    ACTIVE entry. One condition each, from the live definitions
--    (pg_get_functiondef, 2026-11-03); nothing else in them changes.
-- No foreign key, ON CONFLICT clause or other function depends on the old
-- indexes. No data changes: no entry is deleted or rewritten. Postings still
-- go through post_journal_entry, so period locks and the balance trigger
-- apply. Grants are unchanged (CREATE OR REPLACE keeps them).
--
-- Rollback: supabase/manual-apply/phase112_rollback.sql (guarded).

BEGIN;

DROP INDEX public.depreciation_entries_asset_period_key;
CREATE UNIQUE INDEX depreciation_entries_asset_period_active_key
  ON public.depreciation_entries (asset_id, period_end) WHERE reversed_at IS NULL;

DROP INDEX public.amortization_entries_schedule_period_key;
CREATE UNIQUE INDEX amortization_entries_schedule_period_active_key
  ON public.amortization_entries (schedule_id, period_index) WHERE reversed_at IS NULL;

CREATE OR REPLACE FUNCTION public.run_depreciation(p_period_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user    uuid := auth.uid();
  v_company uuid := public.current_user_company_id();
  v_asset   public.fixed_assets%ROWTYPE;
  v_month   date;
  v_period  date;
  v_charge  numeric;
  v_je      jsonb;
  v_count   int := 0;
  v_total   numeric := 0;
BEGIN
  IF v_user IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.auth_require('accounting.write');

  FOR v_asset IN
    SELECT * FROM public.fixed_assets
     WHERE company_id = v_company AND status = 'active' AND in_service_date <= p_period_end
     ORDER BY acquisition_date
     FOR UPDATE
  LOOP
    v_month := CASE
      WHEN v_asset.last_depreciated_period IS NULL THEN date_trunc('month', v_asset.in_service_date)::date
      ELSE (date_trunc('month', v_asset.last_depreciated_period) + interval '1 month')::date
    END;

    WHILE (v_month + interval '1 month - 1 day')::date <= p_period_end LOOP
      v_period := (v_month + interval '1 month - 1 day')::date;

      IF NOT EXISTS (SELECT 1 FROM public.depreciation_entries WHERE asset_id = v_asset.id AND period_end = v_period AND reversed_at IS NULL) THEN
        v_charge := public._fixed_asset_monthly_charge(
          v_asset.cost, v_asset.salvage_value, v_asset.useful_life_months, v_asset.method,
          v_asset.wdv_rate, v_asset.in_service_date, v_asset.accumulated_depreciation, v_period);

        IF v_charge > 0 THEN
          v_je := public.post_journal_entry(jsonb_build_object(
            'date', v_period::text,
            'description', 'Depreciation — ' || v_asset.name || ' (' || to_char(v_period, 'Mon YYYY') || ')',
            'source_type', 'depreciation',
            'source_id', v_asset.id::text,
            'lines', jsonb_build_array(
              jsonb_build_object('account_code', v_asset.expense_account_code,   'debit', v_charge, 'credit', 0),
              jsonb_build_object('account_code', v_asset.accum_dep_account_code, 'debit', 0,        'credit', v_charge)
            )
          ));

          INSERT INTO public.depreciation_entries (company_id, asset_id, period_end, charge, book_value_after, journal_entry_id, created_by)
          VALUES (v_company, v_asset.id, v_period, v_charge,
                  round(v_asset.cost - (v_asset.accumulated_depreciation + v_charge), 2),
                  (v_je->>'journal_entry_id')::uuid, v_user);

          v_asset.accumulated_depreciation := v_asset.accumulated_depreciation + v_charge;
          UPDATE public.fixed_assets
             SET accumulated_depreciation = v_asset.accumulated_depreciation,
                 last_depreciated_period = v_period, updated_at = now()
           WHERE id = v_asset.id;

          v_count := v_count + 1;
          v_total := v_total + v_charge;
        ELSE
          -- fully depreciated to salvage: stop this asset
          UPDATE public.fixed_assets SET status = 'fully_depreciated', updated_at = now() WHERE id = v_asset.id;
          EXIT;
        END IF;
      END IF;

      v_month := (v_month + interval '1 month')::date;
    END LOOP;
  END LOOP;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company, v_user, 'run_depreciation', 'depreciation', NULL,
      jsonb_build_object('period_end', p_period_end, 'entries_posted', v_count, 'total_charge', v_total));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('entries_posted', v_count, 'total_charge', v_total, 'period_end', p_period_end);
END;
$function$;

CREATE OR REPLACE FUNCTION public.run_amortization(p_period_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
         WHERE schedule_id = v_s.id AND period_index = v_i AND reversed_at IS NULL
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
$function$;

COMMIT;
