-- phase105: projects / jobs — the ledger inherits the document's project
--
-- Stage 2 of 4. Stage 1 added a nullable project_id to the documents and to
-- general_ledger but nothing wrote it, so every value was NULL. This migration
-- makes the ledger carry the tag, which is what turns a project into a
-- profitability question the GL can answer.
--
-- WHY THIS IS A TRIGGER AND NOT 54 PATCHED POSTING FUNCTIONS
-- The plan said "patch the posting engines". A survey of the live database
-- found 54 functions that INSERT INTO public.general_ledger directly — they do
-- NOT funnel through post_journal_entry, each builds its own rows. Hand-editing
-- 54 function bodies read back from pg_get_functiondef, to add one column to
-- each INSERT, is a very large amount of exposure for a tagging feature: a
-- single mis-pasted line silently breaks a posting path.
--
-- It is also unnecessary. Every GL row already identifies its parent document
-- through related_doc_type + related_doc_id, and the coverage is total, not
-- partial — measured live across every company before writing this:
--
--     sales_invoice        217 rows   100% carry a doc link
--     vendor_bill          192 rows   100%
--     inventory_cogs       156 rows   100%
--     expense               97 rows   100%
--     sales_credit_note     39 rows   100%
--     receipts/payments/
--       advances/transfers 131 rows   100%
--     manual / opening_gl /
--       opening_bank        76 rows     0%  <- no parent document to inherit
--
-- All 369 invoice, 192 vendor_bill, 97 expense and 43 credit_note links were
-- verified to resolve to real rows in their tables. So the parent is already
-- reachable from every row that could belong to a job, and one BEFORE INSERT
-- trigger can resolve it without any posting engine being touched at all.
--
-- A further benefit: engines added later inherit the behaviour for free, which
-- is the opposite of the 54-patch approach, where every new engine is one more
-- place to forget.
--
-- THE COST, STATED PLAINLY
-- The tagging is now invisible from the posting functions: someone reading
-- confirm_invoice will not see project_id being set. That is the real downside
-- of a trigger, and the mitigation is the COMMENT ON statements at the foot of
-- this file, which point a reader from the column and the functions to here.
--
-- IT FAILS SAFE
-- An unrecognised related_doc_type, a missing parent, or a parent in another
-- company all yield NULL. A row is therefore never tagged WRONGLY, only left
-- untagged — absent from a project report rather than wrong inside one. For a
-- financial figure that is the only acceptable direction to fail in.
--
-- SECURITY INVOKER, deliberately, matching remap_ap_account, tg_je_must_balance
-- and set_updated_at, which are all SECURITY INVOKER. Inside the posting RPCs
-- (SECURITY DEFINER, owned by postgres) the lookups bypass RLS and resolve
-- normally. Outside them RLS applies, so a direct INSERT cannot use the trigger
-- to read another tenant's rows. Every lookup ALSO carries an explicit
-- company_id = NEW.company_id predicate, so cross-tenant resolution is refused
-- even where RLS is bypassed. Belt and braces, because the cheap predicate
-- removes the need to reason about which context the trigger is running in.
--
-- ADDITIVE AND IDEMPOTENT: functions are CREATE OR REPLACE, triggers are
-- dropped before being created, and the backfill is a no-op on a second run.
-- No column is added, dropped or retyped and no existing row's money changes.
--
-- UNDO PATH: DROP the four triggers. The project_id values already written stay
-- behind harmlessly — nothing but the project report reads them.

BEGIN;

-- 1. Resolve the project when a ledger row is written -------------------------
-- BEFORE INSERT so the value lands in the row itself rather than costing a
-- second write. Fires after trg_remap_ap_account (triggers fire in name order);
-- the two touch different columns — that one rewrites account_id, this one sets
-- project_id — so the ordering between them does not matter.
CREATE OR REPLACE FUNCTION public.tg_set_gl_project()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  -- An explicitly supplied project wins. This is what lets a manual journal
  -- entry be tagged directly from the UI later: a manual JE has no parent
  -- document to inherit from, so the caller is the only possible source.
  IF NEW.project_id IS NOT NULL OR NEW.related_doc_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- A PL/pgSQL CASE with no matching branch raises CASE_NOT_FOUND, so the
  -- ELSE below is load-bearing, not decoration: without it every payment,
  -- transfer and opening-balance row would fail to post.
  CASE NEW.related_doc_type

    WHEN 'invoice' THEN
      SELECT i.project_id INTO NEW.project_id
        FROM public.invoices i
       WHERE i.id = NEW.related_doc_id
         AND i.company_id = NEW.company_id;

    WHEN 'vendor_bill' THEN
      SELECT v.project_id INTO NEW.project_id
        FROM public.vendor_bills v
       WHERE v.id = NEW.related_doc_id
         AND v.company_id = NEW.company_id;

    WHEN 'expense' THEN
      SELECT e.project_id INTO NEW.project_id
        FROM public.expenses e
       WHERE e.id = NEW.related_doc_id
         AND e.company_id = NEW.company_id;

    -- A credit note holds no project of its own: it offsets an invoice, so it
    -- belongs to whatever job that invoice belongs to. Both labels are handled
    -- because the credit-note merge made the credit note the single sales-return
    -- document while confirm_sales_return still writes the older 'sales_return'
    -- tag; both resolve against credit_notes.
    WHEN 'credit_note', 'sales_return' THEN
      SELECT i.project_id INTO NEW.project_id
        FROM public.credit_notes c
        JOIN public.invoices i ON i.id = c.linked_invoice_id
       WHERE c.id = NEW.related_doc_id
         AND c.company_id = NEW.company_id;

    WHEN 'debit_note', 'purchase_return' THEN
      SELECT v.project_id INTO NEW.project_id
        FROM public.debit_notes d
        JOIN public.vendor_bills v ON v.id = d.linked_bill_id
       WHERE d.id = NEW.related_doc_id
         AND d.company_id = NEW.company_id;

    ELSE
      -- Correct by design, not an oversight:
      --   payment / customer_credit_refund — cash Dr, AR Cr. Neither leg is
      --     income or expense, so a payment can never be project revenue or
      --     project cost; counting it would double-count the invoice.
      --   bank_transfer — moves money between two of the company's own
      --     accounts. No P&L effect at all.
      --   product — inventory adjustments and opening stock. Stock, not a job.
      --   manual / opening_gl / opening_bank — no parent document exists.
      --   inventory_cogs — the DEFERRED-COGS flush writes a related_doc_id that
      --     resolves to no table in the database (the sale invoice id survives
      --     only as text in the description). That is a pre-existing defect
      --     which also breaks document drill-down on those rows, and it is
      --     fixed separately rather than worked around here. Ordinary COGS is
      --     unaffected: it writes related_doc_type = 'invoice' and is tagged by
      --     the branch above, which is what makes a trading tenant's job cost
      --     land at moving-average cost on sale.
      NULL;

  END CASE;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_set_gl_project ON public.general_ledger;
CREATE TRIGGER trg_set_gl_project
  BEFORE INSERT ON public.general_ledger
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_gl_project();

-- 2. Carry a later re-tag down to rows already posted -------------------------
-- Without this the feature quietly loses tags. The natural workflow is to
-- confirm a bill and only then realise it belongs to the Dubai job; by that
-- point its ledger rows exist and the BEFORE INSERT trigger has been and gone.
--
-- Setting project_id on a GL row is not a ledger mutation: debit, credit,
-- account, date and journal entry are untouched, so the je_must_balance
-- constraint trigger re-checks a balance that has not moved and passes. The
-- function can only ever write this one column.
--
-- SECURITY INVOKER: the caller needs has_any_write() and the matching company
-- to pass the general_ledger policies, which anyone permitted to edit the
-- document already holds. Authorisation to move the document's tag and
-- authorisation to move its ledger tag are therefore the same thing.
CREATE OR REPLACE FUNCTION public.tg_retag_gl_project()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_doc_type text := TG_ARGV[0];
BEGIN
  UPDATE public.general_ledger g
     SET project_id = NEW.project_id
   WHERE g.company_id       = NEW.company_id
     AND g.related_doc_type = v_doc_type
     AND g.related_doc_id   = NEW.id
     AND g.project_id IS DISTINCT FROM NEW.project_id;

  -- The notes hanging off this document inherit from it, so they have to move
  -- with it or a job's revenue would include an invoice whose credit note sat
  -- on a different job.
  IF v_doc_type = 'invoice' THEN
    UPDATE public.general_ledger g
       SET project_id = NEW.project_id
      FROM public.credit_notes c
     WHERE c.linked_invoice_id = NEW.id
       AND c.company_id        = NEW.company_id
       AND g.company_id        = NEW.company_id
       AND g.related_doc_type IN ('credit_note', 'sales_return')
       AND g.related_doc_id    = c.id
       AND g.project_id IS DISTINCT FROM NEW.project_id;

  ELSIF v_doc_type = 'vendor_bill' THEN
    UPDATE public.general_ledger g
       SET project_id = NEW.project_id
      FROM public.debit_notes d
     WHERE d.linked_bill_id = NEW.id
       AND d.company_id     = NEW.company_id
       AND g.company_id     = NEW.company_id
       AND g.related_doc_type IN ('debit_note', 'purchase_return')
       AND g.related_doc_id  = d.id
       AND g.project_id IS DISTINCT FROM NEW.project_id;
  END IF;

  RETURN NEW;
END;
$fn$;

-- UPDATE OF project_id plus the WHEN clause means this costs nothing on the
-- ordinary document edits that happen constantly and never touch the tag.
DROP TRIGGER IF EXISTS trg_retag_gl_project ON public.invoices;
CREATE TRIGGER trg_retag_gl_project
  AFTER UPDATE OF project_id ON public.invoices
  FOR EACH ROW WHEN (OLD.project_id IS DISTINCT FROM NEW.project_id)
  EXECUTE FUNCTION public.tg_retag_gl_project('invoice');

DROP TRIGGER IF EXISTS trg_retag_gl_project ON public.vendor_bills;
CREATE TRIGGER trg_retag_gl_project
  AFTER UPDATE OF project_id ON public.vendor_bills
  FOR EACH ROW WHEN (OLD.project_id IS DISTINCT FROM NEW.project_id)
  EXECUTE FUNCTION public.tg_retag_gl_project('vendor_bill');

DROP TRIGGER IF EXISTS trg_retag_gl_project ON public.expenses;
CREATE TRIGGER trg_retag_gl_project
  AFTER UPDATE OF project_id ON public.expenses
  FOR EACH ROW WHEN (OLD.project_id IS DISTINCT FROM NEW.project_id)
  EXECUTE FUNCTION public.tg_retag_gl_project('expense');

-- 3. Backfill -----------------------------------------------------------------
-- Currently a no-op: no document carries a project yet, so this updates zero
-- rows. It is here so the migration is still correct if it is applied after
-- someone has tagged documents by hand, and it is safe to re-run because the
-- IS DISTINCT FROM predicate makes a second pass match nothing.
UPDATE public.general_ledger g
   SET project_id = i.project_id
  FROM public.invoices i
 WHERE g.related_doc_type = 'invoice'
   AND g.related_doc_id   = i.id
   AND g.company_id       = i.company_id
   AND i.project_id IS NOT NULL
   AND g.project_id IS DISTINCT FROM i.project_id;

UPDATE public.general_ledger g
   SET project_id = v.project_id
  FROM public.vendor_bills v
 WHERE g.related_doc_type = 'vendor_bill'
   AND g.related_doc_id   = v.id
   AND g.company_id       = v.company_id
   AND v.project_id IS NOT NULL
   AND g.project_id IS DISTINCT FROM v.project_id;

UPDATE public.general_ledger g
   SET project_id = e.project_id
  FROM public.expenses e
 WHERE g.related_doc_type = 'expense'
   AND g.related_doc_id   = e.id
   AND g.company_id       = e.company_id
   AND e.project_id IS NOT NULL
   AND g.project_id IS DISTINCT FROM e.project_id;

UPDATE public.general_ledger g
   SET project_id = i.project_id
  FROM public.credit_notes c
  JOIN public.invoices i ON i.id = c.linked_invoice_id
 WHERE g.related_doc_type IN ('credit_note', 'sales_return')
   AND g.related_doc_id   = c.id
   AND g.company_id       = c.company_id
   AND i.project_id IS NOT NULL
   AND g.project_id IS DISTINCT FROM i.project_id;

UPDATE public.general_ledger g
   SET project_id = v.project_id
  FROM public.debit_notes d
  JOIN public.vendor_bills v ON v.id = d.linked_bill_id
 WHERE g.related_doc_type IN ('debit_note', 'purchase_return')
   AND g.related_doc_id   = d.id
   AND g.company_id       = d.company_id
   AND v.project_id IS NOT NULL
   AND g.project_id IS DISTINCT FROM v.project_id;

-- 4. Signposts ----------------------------------------------------------------
-- The posting functions do not mention project_id, so without these a reader
-- of confirm_invoice has no way to discover where the value comes from.
COMMENT ON COLUMN public.general_ledger.project_id IS
  'Project / job this line belongs to. NOT written by the posting functions: '
  'filled by the trg_set_gl_project trigger, which resolves it from '
  'related_doc_type + related_doc_id at INSERT time (phase105). NULL for '
  'payments, transfers, stock movements and manual entries by design.';

COMMENT ON FUNCTION public.tg_set_gl_project() IS
  'phase105: resolves general_ledger.project_id from the parent document so no '
  'posting engine has to carry the column. Fails safe — an unknown doc type or '
  'a missing/cross-tenant parent leaves the row untagged rather than mistagged.';

COMMENT ON FUNCTION public.tg_retag_gl_project() IS
  'phase105: when a document is moved onto (or off) a project after it has been '
  'posted, carries the new tag down to its existing ledger rows and to the '
  'credit/debit notes that inherit from it. Writes project_id only.';

COMMIT;
