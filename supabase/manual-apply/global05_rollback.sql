-- global05 ROLLBACK — removes the legal-structure columns and their checks.
-- GUARDED: refuses while any company has filled one in, so a rollback can
-- never silently delete information a customer entered.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies
             WHERE legal_form IS NOT NULL OR legal_name IS NOT NULL OR registration_number IS NOT NULL
                OR registration_authority IS NOT NULL OR incorporation_date IS NOT NULL) THEN
    RAISE EXCEPTION 'global05 rollback refused: % companies have legal-structure data; export it first',
      (SELECT count(*) FROM public.companies
        WHERE legal_form IS NOT NULL OR legal_name IS NOT NULL OR registration_number IS NOT NULL
           OR registration_authority IS NOT NULL OR incorporation_date IS NOT NULL);
  END IF;
END $$;

ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_india_registration_format;
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_incorporation_date_check;
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_legal_text_lengths;
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_legal_form_check;
ALTER TABLE public.companies
  DROP COLUMN IF EXISTS incorporation_date,
  DROP COLUMN IF EXISTS registration_authority,
  DROP COLUMN IF EXISTS registration_number,
  DROP COLUMN IF EXISTS legal_name,
  DROP COLUMN IF EXISTS legal_form;

COMMIT;
