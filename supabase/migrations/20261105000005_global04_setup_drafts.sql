-- global04: per-user drafts for the Global setup wizard (save and resume)
--
-- Global v1, Phase 7 (approved 2026-11-05): per-user draft storage, autosave
-- and resume, explicit review and activation, safe recovery of an incomplete
-- activation.
--
-- WHY A USER-KEYED TABLE (deliberate exception to "every table has
-- company_id"): a new-company draft exists BEFORE the company does. Each row
-- belongs to exactly one signed-in user and is visible to nobody else. Once a
-- company exists the draft records it (company_id), so an activation that
-- stopped half-way (company created, configuration not yet saved) can be
-- finished from Settings instead of starting over.
--
-- A draft is only wizard input (form values, chosen activities and modules,
-- the step reached). It is never read by posting, reports or permissions;
-- activation still goes through complete_onboarding (resumable since
-- phase111) and save_company_configuration (global01), which re-validate
-- everything server-side. Autosave here is of this draft only: no business
-- record is ever saved without the explicit activation step.
--
-- Rollback: supabase/manual-apply/global04_rollback.sql (guarded).

BEGIN;

CREATE TABLE IF NOT EXISTS public.setup_drafts (
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind        text        NOT NULL CHECK (kind IN ('onboarding', 'configuration')),
  company_id  uuid        REFERENCES public.companies(id) ON DELETE CASCADE,
  step        text        NOT NULL CHECK (step ~ '^[a-z_]{1,40}$'),
  payload     jsonb       NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 65536),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind)
);
CREATE INDEX IF NOT EXISTS setup_drafts_company_idx ON public.setup_drafts (company_id);

DROP TRIGGER IF EXISTS setup_drafts_set_updated_at ON public.setup_drafts;
CREATE TRIGGER setup_drafts_set_updated_at
  BEFORE UPDATE ON public.setup_drafts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.setup_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_draft ON public.setup_drafts;
CREATE POLICY own_draft ON public.setup_drafts
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  -- A draft may point only at the user's own company (or none yet).
  WITH CHECK (user_id = auth.uid()
              AND (company_id IS NULL OR company_id = public.current_user_company_id()));

REVOKE ALL ON public.setup_drafts FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.setup_drafts TO authenticated;
GRANT ALL ON public.setup_drafts TO service_role;

COMMIT;
