-- phase121 — editing an invoice works again after Finding C (phase119).
--
-- The invoice editor replaces an invoice's lines on every save of an existing
-- invoice. deferred_cogs_queue.invoice_item_id is ON DELETE RESTRICT, so the
-- app first cleared the queue rows for that invoice with a direct
-- DELETE FROM deferred_cogs_queue. phase119 (correctly) took DELETE on the
-- ledgers away from clients, and Postgres checks that privilege before it looks
-- at any row — so EVERY save of an existing invoice, even a draft with nothing
-- queued, failed with "permission denied for table deferred_cogs_queue".
-- Reported live 2026-11-06 (a user could not save draft INV-1001).
--
-- This moves that one delete behind a posting function, the Finding C way:
--   * caller needs sales.write (the same right that edits the invoice)
--   * the invoice must be the caller's own company's (RLS also applies:
--     ledger_writer has no RLS bypass)
--   * it deletes only that invoice's queue rows, and returns how many
--   * owned by ledger_writer, SECURITY DEFINER, pinned search_path, no anon
-- The semantics are exactly the old client delete's: edit_invoice, which the
-- editor runs next, reverses the old posting and re-queues COGS for the new
-- lines. Clients still have no write right on any ledger table.
--
-- Re-runnable. Rollback: supabase/manual-apply/phase121_rollback.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.clear_invoice_deferred_cogs(p_invoice_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_company UUID;
  v_n       INTEGER;
BEGIN
  PERFORM public.auth_require('sales.write');

  SELECT company_id INTO v_company FROM public.invoices WHERE id = p_invoice_id;
  IF v_company IS NULL OR v_company IS DISTINCT FROM public.current_user_company_id() THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM public.deferred_cogs_queue
   WHERE sale_invoice_id = p_invoice_id
     AND company_id = v_company;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

-- Same order as phase119: anon first, then definer + search_path, then owner.
REVOKE EXECUTE ON FUNCTION public.clear_invoice_deferred_cogs(p_invoice_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_invoice_deferred_cogs(p_invoice_id uuid) TO authenticated;
ALTER FUNCTION public.clear_invoice_deferred_cogs(p_invoice_id uuid) SECURITY DEFINER SET search_path = public, pg_temp;

-- ALTER ... OWNER needs CREATE on the schema for the new owner; granted only
-- for the transfer and taken back in this same transaction.
GRANT CREATE ON SCHEMA public TO ledger_writer;
ALTER FUNCTION public.clear_invoice_deferred_cogs(p_invoice_id uuid) OWNER TO ledger_writer;
REVOKE CREATE ON SCHEMA public FROM ledger_writer;

COMMIT;
