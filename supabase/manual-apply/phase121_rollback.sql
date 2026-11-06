-- phase121 ROLLBACK — removes clear_invoice_deferred_cogs. Touches no rows.
-- After a rollback, editing an invoice that has queued deferred COGS fails
-- again (drafts keep working: the app skips the call when nothing is queued).

BEGIN;
DROP FUNCTION IF EXISTS public.clear_invoice_deferred_cogs(p_invoice_id uuid);
COMMIT;
