-- ═══════════════════════════════════════════════════════════════════════════
-- phase138 — Document activity: who created a document, and quote / purchase
--            order status changes
--
-- The Activity panel on every document reads the history StockBolt already
-- keeps (audit_logs: confirm, reopen, void … with the user and time). Two
-- things were never recorded:
--
--   1. WHO CREATED A DOCUMENT. Documents keep created_at only (journal_entries
--      is the exception: it has created_by). This adds created_by to the nine
--      document tables. A trigger fills it from the signed-in user on INSERT
--      and keeps it unchanged on UPDATE, so a client can neither forge nor
--      overwrite it. Existing rows stay NULL — nobody knows who made them, and
--      guessing (e.g. from the confirming user) would be wrong.
--
--   2. QUOTE / PURCHASE ORDER STATUS CHANGES. Neither has a posting function,
--      so nothing was logged when a quote was sent / accepted / invoiced or a
--      PO was sent / received / closed. An AFTER UPDATE OF status trigger now
--      writes one audit_logs row: action 'update', old_data / new_data =
--      {"status": …}. Logging never blocks the business change: a failed
--      insert is swallowed (same rule as the posting functions).
--
-- NO posting logic, no GL, no stock. Nothing reads created_by for money.
--
-- created_by has no foreign key on purpose: deleting a user must never be
-- blocked by (or cascade into) the documents they made. Names are looked up
-- from profiles at read time; a removed user shows as "Former user".
--
-- The status-log function is SECURITY DEFINER because PO status also moves
-- inside posting functions that run as ledger_writer (phase119); it writes
-- only the audit row for the row being updated. EXECUTE is revoked from all
-- client roles (a trigger does not need it to fire).
--
-- PRE-CHECK on prod (expect exactly one row: journal_entries):
--   SELECT table_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND column_name = 'created_by'
--      AND table_name IN ('sales_quotes','invoices','payments','credit_notes','purchase_orders',
--                         'goods_receipts','vendor_bills','debit_notes','expenses','journal_entries');
-- If any other table is listed, STOP and send the result.
--
-- SAFE TO APPLY: additive. Nullable columns, two new trigger functions,
-- eleven triggers. One transaction; re-running is safe.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS <table>_created_by ON public.<table>;   -- for each of the nine
--   DROP TRIGGER IF EXISTS sales_quotes_status_log ON public.sales_quotes;
--   DROP TRIGGER IF EXISTS purchase_orders_status_log ON public.purchase_orders;
--   DROP FUNCTION IF EXISTS public.tg_document_created_by();
--   DROP FUNCTION IF EXISTS public.tg_document_status_log();
--   (the created_by columns may stay; they are read by nothing else)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. created_by ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_document_created_by()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- The signed-in user, always. Without a session (service role, imports)
    -- the supplied value is kept.
    NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
  ELSE
    NEW.created_by := OLD.created_by;   -- never changes after creation
  END IF;
  RETURN NEW;
END;
$function$;

DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_quotes','invoices','payments','credit_notes','purchase_orders',
                           'goods_receipts','vendor_bills','debit_notes','expenses']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS created_by uuid', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_created_by', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF created_by ON public.%I
                      FOR EACH ROW EXECUTE FUNCTION public.tg_document_created_by()', t || '_created_by', t);
  END LOOP;
END
$do$;

-- ── 2. Quote / purchase order status changes → audit_logs ──────────────────
CREATE OR REPLACE FUNCTION public.tg_document_status_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, old_data, new_data)
    VALUES (NEW.company_id, auth.uid(), 'update',
            CASE TG_TABLE_NAME WHEN 'sales_quotes' THEN 'sales_quote' ELSE 'purchase_order' END,
            NEW.id,
            jsonb_build_object('status', OLD.status),
            jsonb_build_object('status', NEW.status));
  EXCEPTION WHEN OTHERS THEN
    NULL;   -- the history is a convenience; never block the change itself
  END;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS sales_quotes_status_log ON public.sales_quotes;
CREATE TRIGGER sales_quotes_status_log
  AFTER UPDATE OF status ON public.sales_quotes
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.tg_document_status_log();

DROP TRIGGER IF EXISTS purchase_orders_status_log ON public.purchase_orders;
CREATE TRIGGER purchase_orders_status_log
  AFTER UPDATE OF status ON public.purchase_orders
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.tg_document_status_log();

REVOKE ALL ON FUNCTION public.tg_document_created_by() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_document_status_log() FROM PUBLIC, anon, authenticated;

COMMIT;

-- ── Verify after applying (read-only) ──────────────────────────────────────
-- SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
--           AND column_name = 'created_by' AND table_name IN ('sales_quotes','invoices','payments',
--           'credit_notes','purchase_orders','goods_receipts','vendor_bills','debit_notes','expenses')) AS cols,  -- expect 9
--        (SELECT count(*) FROM pg_trigger WHERE tgname LIKE '%\_created\_by' AND NOT tgisinternal) AS creator_triggers, -- expect 9
--        (SELECT count(*) FROM pg_trigger WHERE tgname LIKE '%\_status\_log') AS status_triggers;                       -- expect 2
