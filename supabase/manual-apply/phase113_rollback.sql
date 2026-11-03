-- phase113 ROLLBACK - removes the automatic India TDS section seeding.
--
-- WARNING: new India companies go back to starting with no TDS sections.
-- Sections already seeded are KEPT: deductions may reference them, and
-- deleting reference data a company may have edited is not acceptable.

BEGIN;

-- ROLLBACK GUARD - rollbacks are refused unless this block is deliberately removed.
DO $$ BEGIN
  RAISE EXCEPTION 'ROLLBACK GUARD: this rollback stops new India companies getting TDS sections. Delete this block to run it deliberately.';
END $$;

DROP TRIGGER IF EXISTS companies_seed_tds_sections ON public.companies;
DROP FUNCTION IF EXISTS public.tg_seed_tds_sections();
DROP FUNCTION IF EXISTS public.seed_default_tds_sections(uuid);

COMMIT;
