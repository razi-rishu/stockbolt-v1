-- global01 ROLLBACK - removes the Global v1 company configuration store.
--
-- WARNING: every saved business configuration is deleted. Those companies go
-- back to the legacy configuration (every module on, Projects following
-- companies.projects_enabled), which is what they had before global01. No
-- financial or master data is touched. Turn VITE_GLOBAL_ONBOARDING off and
-- redeploy BEFORE running this, or the wizard's save will fail.

BEGIN;

-- ROLLBACK GUARD - rollbacks are refused unless this block is deliberately removed.
DO $$ BEGIN
  RAISE EXCEPTION 'ROLLBACK GUARD: this rollback deletes every saved business configuration. Delete this block to run it deliberately.';
END $$;

DROP FUNCTION IF EXISTS public.save_company_configuration(text, text[], text, text[]);
DROP TABLE IF EXISTS public.company_configurations;

COMMIT;
