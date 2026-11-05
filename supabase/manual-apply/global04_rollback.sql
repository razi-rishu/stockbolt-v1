-- global04 ROLLBACK - removes the wizard drafts table.
--
-- WARNING: every unfinished wizard draft is lost (users start the wizard
-- again). No company, configuration or business record is affected.

BEGIN;

-- ROLLBACK GUARD - rollbacks are refused unless this block is deliberately removed.
DO $$ BEGIN
  RAISE EXCEPTION 'ROLLBACK GUARD: this rollback deletes every unfinished setup draft. Delete this block to run it deliberately.';
END $$;

DROP TABLE IF EXISTS public.setup_drafts;

COMMIT;
