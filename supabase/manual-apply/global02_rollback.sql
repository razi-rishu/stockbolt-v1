-- global02 ROLLBACK - removes the financial-settings guard on companies.
--
-- WARNING: currency, financial year, costing method and country become
-- editable again through the REST API after transactions exist.

BEGIN;

-- ROLLBACK GUARD - rollbacks are refused unless this block is deliberately removed.
DO $$ BEGIN
  RAISE EXCEPTION 'ROLLBACK GUARD: this rollback lets posted companies change currency and financial year. Delete this block to run it deliberately.';
END $$;

DROP TRIGGER IF EXISTS companies_guard_financial_settings ON public.companies;
DROP FUNCTION IF EXISTS public.tg_guard_company_financial_settings();

COMMIT;
