-- global05: legal structure and registration (Global v1, Phase 2)
--
-- One legal entity per workspace (approved architecture). The company row kept
-- a trading name and a tax number (TRN / GSTIN) but nothing about WHAT the
-- entity is or where it is registered. This adds five optional fields:
--
--   legal_form              one of a fixed list of keys (below); the wizard
--                           offers the subset that exists in the company's
--                           country (src/core/global-config/legal-structure.ts)
--   legal_name              registered name when it differs from the trading name
--   registration_number     commercial / trade licence no. (GCC), CIN or LLPIN (India)
--   registration_authority  issuing body, e.g. "Dubai DET", "Registrar of Companies, Kerala"
--   incorporation_date      date of registration
--
-- Country-aware validation, enforced here as well as in the app:
--   India: a company (private / public limited, one person company) must give a
--   CIN in the MCA format; an LLP an LLPIN (AAA-0000). Other forms and every
--   other country: free text, no statutory format is asserted.
-- No compliance is claimed by these fields. Every existing company keeps NULLs
-- and passes every check; nothing is backfilled or rewritten.
--
-- Re-runnable. Rollback: supabase/manual-apply/global05_rollback.sql.

BEGIN;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS legal_form             text,
  ADD COLUMN IF NOT EXISTS legal_name             text,
  ADD COLUMN IF NOT EXISTS registration_number    text,
  ADD COLUMN IF NOT EXISTS registration_authority text,
  ADD COLUMN IF NOT EXISTS incorporation_date     date;

ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_legal_form_check;
ALTER TABLE public.companies ADD CONSTRAINT companies_legal_form_check CHECK (
  legal_form IS NULL OR legal_form IN (
    'sole_proprietorship', 'partnership', 'llp', 'private_limited', 'public_limited',
    'one_person_company', 'llc', 'free_zone_entity', 'branch_of_foreign_company',
    'civil_company', 'joint_stock_company', 'nonprofit', 'government', 'other'));

ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_legal_text_lengths;
ALTER TABLE public.companies ADD CONSTRAINT companies_legal_text_lengths CHECK (
  coalesce(length(legal_name), 0) <= 200
  AND coalesce(length(registration_number), 0) <= 50
  AND coalesce(length(registration_authority), 0) <= 120);

ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_incorporation_date_check;
ALTER TABLE public.companies ADD CONSTRAINT companies_incorporation_date_check CHECK (
  incorporation_date IS NULL OR incorporation_date BETWEEN DATE '1800-01-01' AND DATE '2100-12-31');

-- India: CIN for companies, LLPIN for LLPs (MCA formats). Only checked when a
-- number is given; leaving it empty is allowed.
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_india_registration_format;
ALTER TABLE public.companies ADD CONSTRAINT companies_india_registration_format CHECK (
  country_code IS DISTINCT FROM 'IN'
  OR registration_number IS NULL
  OR (legal_form IN ('private_limited', 'public_limited', 'one_person_company')
      AND registration_number ~ '^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$')
  OR (legal_form = 'llp' AND registration_number ~ '^[A-Z]{3}-[0-9]{4}$')
  OR legal_form IS NULL
  OR legal_form NOT IN ('private_limited', 'public_limited', 'one_person_company', 'llp'));

COMMENT ON COLUMN public.companies.legal_form IS 'Global v1 Phase 2: legal form key (country subset in legal-structure.ts)';
COMMENT ON COLUMN public.companies.registration_number IS 'Global v1 Phase 2: trade licence / CR no. (GCC), CIN or LLPIN (India)';

COMMIT;
