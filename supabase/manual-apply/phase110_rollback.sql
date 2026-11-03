-- phase110 ROLLBACK - restores the phase0 audit_logs action CHECK.
--
-- WARNING: the 40 functions that write other actions go back to having their
-- audit entries silently dropped (file_tax_return, close_fiscal_year,
-- run_depreciation, edit, reopen, ...). Business operations keep working; only
-- the audit trail is lost. Fix forward instead if possible.
--
-- The CHECK is re-added NOT VALID: rows written since phase110 with the new
-- action names stay in place (deleting audit history is not acceptable), and
-- only new inserts are held to the narrow list.

BEGIN;

-- ROLLBACK GUARD - rollbacks are refused unless this block is deliberately
-- removed (a rollback was once run by mistake, 2026-11-02). Delete this DO
-- block, run the file, and record why in the security report.
DO $$ BEGIN
  RAISE EXCEPTION 'ROLLBACK GUARD: this rollback makes 40 functions silently drop their audit entries again. Delete this block to run it deliberately.';
END $$;

ALTER TABLE public.audit_logs DROP CONSTRAINT audit_logs_action_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_action_check CHECK (action = ANY (ARRAY[
  'create', 'update', 'delete', 'post_gl', 'reverse_gl', 'login', 'void', 'confirm', 'setup_completed'
]::text[])) NOT VALID;

COMMIT;
