-- global02: a company's financial settings cannot change once it has transactions
--
-- Global v1, Phase 3 (Smart Hybrid accounting, simplified v1 approved
-- 2026-11-05): the existing country chart of accounts and posting engine stay
-- exactly as they are; the wizard reviews base currency, financial year,
-- chart template and costing method, and "financial settings are protected
-- from unsafe changes after transactions exist".
--
-- WHAT WAS UNPROTECTED
-- Company Settings shows currency, financial year, country and costing method
-- read-only, but the companies row itself only checks settings.write (RLS).
-- Any user with that permission could PATCH them through the REST API after
-- posting: every historical amount would then be read in the wrong currency,
-- fiscal-year reports would split at the wrong month, and the country's tax
-- set would no longer match the documents.
--
-- THE FIX
-- A BEFORE UPDATE trigger refuses a change to currency, base_currency,
-- fiscal_year_start, costing_method or country_code while the company has any
-- journal entry or stock movement. Before the first transaction they remain
-- changeable (the wizard's accounting step and phase111's country correction
-- rely on that). SECURITY DEFINER so the existence check sees every row
-- whatever the caller may read; trigger-only (EXECUTE revoked from clients).
--
-- No data changes. Rollback: supabase/manual-apply/global02_rollback.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.tg_guard_company_financial_settings()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (NEW.currency          IS DISTINCT FROM OLD.currency
   OR NEW.base_currency     IS DISTINCT FROM OLD.base_currency
   OR NEW.fiscal_year_start IS DISTINCT FROM OLD.fiscal_year_start
   OR NEW.costing_method    IS DISTINCT FROM OLD.costing_method
   OR NEW.country_code      IS DISTINCT FROM OLD.country_code)
  AND (EXISTS (SELECT 1 FROM public.journal_entries WHERE company_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.stock_ledger    WHERE company_id = OLD.id)) THEN
    RAISE EXCEPTION 'financial_settings_locked: currency, financial year, costing method and country cannot change after transactions exist'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_guard_company_financial_settings() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS companies_guard_financial_settings ON public.companies;
CREATE TRIGGER companies_guard_financial_settings
  BEFORE UPDATE OF currency, base_currency, fiscal_year_start, costing_method, country_code ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_company_financial_settings();

COMMIT;
