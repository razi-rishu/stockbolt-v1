-- ═══════════════════════════════════════════════════════════════════════════
-- phase137 — an asset purchase's bill / expense can only be changed from the
--            asset purchase
--
-- phase126 carries a fixed-asset purchase on an ordinary document: a vendor
-- bill (credit) or an expense (cash / bank). The register rows are created by
-- post_fixed_asset_purchase and removed by reopen_fixed_asset_purchase, so the
-- register and the ledger agree only while the document is changed THROUGH
-- those two functions. Nothing stopped the document being changed directly:
--
--   • Edit on a confirmed asset bill (edit_vendor_bill) reversed the ledger
--     entry but left the asset on the register; re-confirming with new figures
--     left register cost ≠ ledger.
--   • A draft purchase's bill / expense could be confirmed from the Bills /
--     Expenses screens (ledger posted, no asset created) or deleted (purchase
--     left pointing at nothing).
--   • A debit note linked to an asset bill credits 1300 Inventory, not the
--     asset account, and leaves the register untouched.
--
-- What this migration adds (NO posting logic changes):
--   1. tg_asset_purchase_doc_guard — BEFORE UPDATE OF status / BEFORE DELETE
--      on vendor_bills and expenses. If a fixed_asset_purchases row carries the
--      document, the status change or delete is refused unless it comes from
--      post_ / reopen_fixed_asset_purchase, which set the transaction-local
--      setting stockbolt.asset_purchase_doc to that document's id around their
--      own confirm / reopen call. delete_fixed_asset_purchase_draft needs no
--      change: it removes the purchase row before deleting the document.
--      Statuses are only draft / confirmed / void, so payments are unaffected.
--   2. tg_asset_purchase_debit_note_guard — a debit note (or debit note line)
--      may not be linked to an asset purchase's bill. Returning an asset =
--      reopen the purchase, or dispose of the asset.
--   3. post_fixed_asset_purchase / reopen_fixed_asset_purchase re-issued from
--      their live definitions with ONLY the two set_config lines added around
--      the document call. Still SECURITY INVOKER.
--
-- The guard functions are SECURITY DEFINER because the document engines run as
-- ledger_writer (phase119), which has no grant on fixed_asset_purchases. They
-- only read whether a link exists and raise; they write nothing. EXECUTE is
-- revoked from everyone (a trigger does not need it to fire).
--
-- PRE-CHECK on prod before applying (the two re-issued functions must start
-- from these definitions). Run:
--   SELECT md5(replace(pg_get_functiondef('public.post_fixed_asset_purchase(uuid)'::regprocedure), chr(13), '')) AS post,
--          md5(replace(pg_get_functiondef('public.reopen_fixed_asset_purchase(uuid)'::regprocedure), chr(13), '')) AS reopen;
-- Expected: post   = 5e5295ab316ba00e6c21a6d6ac136180
--           reopen = 3b6659c837451588af8976d0d21c5c5f
-- If either differs, STOP and send the result.
--
-- Also check nothing already breaks the new rule (expect 0):
--   SELECT count(*) FROM public.debit_notes dn
--     JOIN public.fixed_asset_purchases p ON p.doc_type = 'vendor_bill' AND p.doc_id = dn.linked_bill_id
--    WHERE dn.status <> 'void';
--
-- SAFE TO APPLY: additive. Two new trigger functions, five triggers, two
-- re-issued functions (two lines each). One transaction; re-running is safe.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS vendor_bills_asset_purchase_guard ON public.vendor_bills;
--   DROP TRIGGER IF EXISTS vendor_bills_asset_purchase_guard_del ON public.vendor_bills;
--   DROP TRIGGER IF EXISTS expenses_asset_purchase_guard ON public.expenses;
--   DROP TRIGGER IF EXISTS expenses_asset_purchase_guard_del ON public.expenses;
--   DROP TRIGGER IF EXISTS debit_notes_asset_purchase_guard ON public.debit_notes;
--   DROP TRIGGER IF EXISTS debit_note_items_asset_purchase_guard ON public.debit_note_items;
--   DROP FUNCTION IF EXISTS public.tg_asset_purchase_doc_guard();
--   DROP FUNCTION IF EXISTS public.tg_asset_purchase_debit_note_guard();
--   (the set_config lines in the two functions are harmless without the
--    triggers; to remove them, re-run phase127 for post_ and phase126 §4 for
--    reopen_.)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Bill / expense guard ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_asset_purchase_doc_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_type text := CASE TG_TABLE_NAME WHEN 'vendor_bills' THEN 'vendor_bill' ELSE 'expense' END;
  v_doc  text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.fixed_asset_purchases
                  WHERE doc_type = v_type AND doc_id = OLD.id) THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  -- Allowed only from post_ / reopen_fixed_asset_purchase, for this document.
  IF COALESCE(current_setting('stockbolt.asset_purchase_doc', true), '') = OLD.id::text THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = 'P0001',
    MESSAGE = CASE v_type
      WHEN 'vendor_bill' THEN 'This bill belongs to a fixed asset purchase. Change or reverse it from Fixed Assets → the asset purchase.'
      ELSE 'This expense belongs to a fixed asset purchase. Change or reverse it from Fixed Assets → the asset purchase.'
    END;
END;
$function$;

DROP TRIGGER IF EXISTS vendor_bills_asset_purchase_guard ON public.vendor_bills;
CREATE TRIGGER vendor_bills_asset_purchase_guard
  BEFORE UPDATE OF status ON public.vendor_bills
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.tg_asset_purchase_doc_guard();
DROP TRIGGER IF EXISTS vendor_bills_asset_purchase_guard_del ON public.vendor_bills;
CREATE TRIGGER vendor_bills_asset_purchase_guard_del
  BEFORE DELETE ON public.vendor_bills
  FOR EACH ROW EXECUTE FUNCTION public.tg_asset_purchase_doc_guard();

DROP TRIGGER IF EXISTS expenses_asset_purchase_guard ON public.expenses;
CREATE TRIGGER expenses_asset_purchase_guard
  BEFORE UPDATE OF status ON public.expenses
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.tg_asset_purchase_doc_guard();
DROP TRIGGER IF EXISTS expenses_asset_purchase_guard_del ON public.expenses;
CREATE TRIGGER expenses_asset_purchase_guard_del
  BEFORE DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.tg_asset_purchase_doc_guard();

-- ── 2. Debit note guard ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_asset_purchase_debit_note_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bill uuid;
BEGIN
  IF TG_TABLE_NAME = 'debit_notes' THEN
    v_bill := NEW.linked_bill_id;
  ELSIF NEW.vendor_bill_item_id IS NOT NULL THEN
    SELECT bill_id INTO v_bill FROM public.vendor_bill_items WHERE id = NEW.vendor_bill_item_id;
  END IF;

  IF v_bill IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.fixed_asset_purchases
        WHERE doc_type = 'vendor_bill' AND doc_id = v_bill) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'A debit note cannot be raised against a fixed asset purchase bill. Reopen the asset purchase, or dispose of the asset.';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS debit_notes_asset_purchase_guard ON public.debit_notes;
CREATE TRIGGER debit_notes_asset_purchase_guard
  BEFORE INSERT OR UPDATE OF linked_bill_id, status ON public.debit_notes
  FOR EACH ROW WHEN (NEW.linked_bill_id IS NOT NULL AND NEW.status <> 'void')
  EXECUTE FUNCTION public.tg_asset_purchase_debit_note_guard();
DROP TRIGGER IF EXISTS debit_note_items_asset_purchase_guard ON public.debit_note_items;
CREATE TRIGGER debit_note_items_asset_purchase_guard
  BEFORE INSERT OR UPDATE OF vendor_bill_item_id ON public.debit_note_items
  FOR EACH ROW WHEN (NEW.vendor_bill_item_id IS NOT NULL)
  EXECUTE FUNCTION public.tg_asset_purchase_debit_note_guard();

REVOKE ALL ON FUNCTION public.tg_asset_purchase_doc_guard()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_asset_purchase_debit_note_guard() FROM PUBLIC, anon, authenticated;

-- ── 3. The two asset-purchase functions, re-issued with the setting ────────
-- From the live definitions (md5 above); only the set_config lines are new.
CREATE OR REPLACE FUNCTION public.post_fixed_asset_purchase(p_purchase_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_p        public.fixed_asset_purchases%ROWTYPE;
  v_doc_date date;
  v_doc_no   text;
  v_fold     boolean := false;
  v_line     record;
  v_spec     jsonb;
  v_cls      text;
  v_code     text;
  v_cost     numeric(15,2);
  v_count    int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'post_fixed_asset_purchase: not signed in';
  END IF;

  -- Row lock: two clicks on Post cannot both get past the status check.
  SELECT * INTO v_p FROM public.fixed_asset_purchases WHERE id = p_purchase_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_fixed_asset_purchase: purchase % not found', p_purchase_id;
  END IF;
  IF v_p.status <> 'draft' THEN
    RAISE EXCEPTION 'post_fixed_asset_purchase: this purchase is already posted';
  END IF;
  IF jsonb_array_length(v_p.asset_specs) = 0 THEN
    RAISE EXCEPTION 'post_fixed_asset_purchase: add at least one asset line';
  END IF;

  -- Validate every line BEFORE anything posts: each must carry an ASSET-class
  -- account and have its asset details.
  IF v_p.doc_type = 'vendor_bill' THEN
    FOR v_line IN
      SELECT i.sort_order, i.coa_account_id AS acct, i.product_id
        FROM public.vendor_bill_items i WHERE i.bill_id = v_p.doc_id
    LOOP
      IF v_line.product_id IS NOT NULL OR v_line.acct IS NULL THEN
        RAISE EXCEPTION 'post_fixed_asset_purchase: every line needs a fixed-asset GL account';
      END IF;
      SELECT type INTO v_cls FROM public.chart_of_accounts WHERE id = v_line.acct;
      IF v_cls IS DISTINCT FROM 'asset' THEN
        RAISE EXCEPTION 'post_fixed_asset_purchase: line % is not posted to an asset account', v_line.sort_order + 1;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_p.asset_specs) s
                      WHERE (s->>'sort_order')::int = v_line.sort_order) THEN
        RAISE EXCEPTION 'post_fixed_asset_purchase: line % has no asset details', v_line.sort_order + 1;
      END IF;
    END LOOP;
  ELSE
    FOR v_line IN
      SELECT i.sort_order, i.expense_account_id AS acct
        FROM public.expense_items i WHERE i.expense_id = v_p.doc_id
    LOOP
      SELECT type INTO v_cls FROM public.chart_of_accounts WHERE id = v_line.acct;
      IF v_cls IS DISTINCT FROM 'asset' THEN
        RAISE EXCEPTION 'post_fixed_asset_purchase: line % is not posted to an asset account', v_line.sort_order + 1;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_p.asset_specs) s
                      WHERE (s->>'sort_order')::int = v_line.sort_order) THEN
        RAISE EXCEPTION 'post_fixed_asset_purchase: line % has no asset details', v_line.sort_order + 1;
      END IF;
    END LOOP;
  END IF;

  -- Post through the document's own engine. It enforces the period lock, the
  -- draft status, permissions, tax and the balanced-entry rule.
  IF v_p.doc_type = 'vendor_bill' THEN
    PERFORM set_config('stockbolt.asset_purchase_doc', v_p.doc_id::text, true);  -- phase137
    PERFORM public.confirm_vendor_bill(v_p.doc_id);
    PERFORM set_config('stockbolt.asset_purchase_doc', '', true);                -- phase137
    SELECT date, bill_number INTO v_doc_date, v_doc_no FROM public.vendor_bills WHERE id = v_p.doc_id;
  ELSE
    PERFORM set_config('stockbolt.asset_purchase_doc', v_p.doc_id::text, true);  -- phase137
    PERFORM public.confirm_expense(v_p.doc_id);
    PERFORM set_config('stockbolt.asset_purchase_doc', '', true);                -- phase137
    SELECT e.date, e.expense_number,
           (e.tax_amount > 0
            AND NOT EXISTS (SELECT 1 FROM public.chart_of_accounts c
                             WHERE c.company_id = e.company_id AND c.code = '1500')
            AND COALESCE((SELECT country_code FROM public.companies WHERE id = e.company_id), '') <> 'IN')
      INTO v_doc_date, v_doc_no, v_fold
      FROM public.expenses e WHERE e.id = v_p.doc_id;
  END IF;

  -- One register row per line, costed at exactly what was debited.
  FOR v_line IN
    SELECT i.sort_order, i.coa_account_id AS acct, (i.line_total - i.tax_amount) AS cost, i.quantity AS qty
      FROM public.vendor_bill_items i
     WHERE v_p.doc_type = 'vendor_bill' AND i.bill_id = v_p.doc_id
    UNION ALL
    SELECT i.sort_order, i.expense_account_id,
           i.line_subtotal + CASE WHEN v_fold THEN COALESCE(i.tax_amount, 0) ELSE 0 END, i.quantity
      FROM public.expense_items i
     WHERE v_p.doc_type = 'expense' AND i.expense_id = v_p.doc_id
     ORDER BY 1
  LOOP
    SELECT s INTO v_spec FROM jsonb_array_elements(v_p.asset_specs) s
     WHERE (s->>'sort_order')::int = v_line.sort_order LIMIT 1;
    SELECT code INTO v_code FROM public.chart_of_accounts WHERE id = v_line.acct;
    v_cost := ROUND(v_line.cost, 2);

    INSERT INTO public.fixed_assets (
      company_id, asset_tag, name, category, acquisition_date, in_service_date,
      cost, salvage_value, useful_life_months, method, wdv_rate,
      asset_account_code, accum_dep_account_code, expense_account_code,
      status, notes, created_by, purchase_id, quantity
    ) VALUES (
      v_p.company_id,
      NULLIF(v_spec->>'asset_tag', ''),
      COALESCE(NULLIF(v_spec->>'name', ''), 'Asset'),
      NULLIF(v_spec->>'category', ''),
      v_doc_date,
      COALESCE(NULLIF(v_spec->>'in_service_date', '')::date, v_doc_date),
      v_cost,
      LEAST(COALESCE(NULLIF(v_spec->>'salvage_value', '')::numeric, 0), v_cost),
      COALESCE(NULLIF(v_spec->>'useful_life_months', '')::int, 60),
      COALESCE(NULLIF(v_spec->>'method', ''), 'straight_line'),
      COALESCE(NULLIF(v_spec->>'wdv_rate', '')::numeric, 0),
      v_code,
      COALESCE(NULLIF(v_spec->>'accum_dep_account_code', ''), '1790'),
      COALESCE(NULLIF(v_spec->>'expense_account_code', ''), '6750'),
      'active',
      'Purchased on ' || v_doc_no,
      auth.uid(),
      v_p.id,
      CASE WHEN COALESCE(v_line.qty, 0) > 0 THEN v_line.qty ELSE 1 END
    );
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.fixed_asset_purchases SET status = 'posted' WHERE id = v_p.id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_p.company_id, auth.uid(), 'confirm', 'fixed_asset_purchase', v_p.id,
            jsonb_build_object('doc_type', v_p.doc_type, 'doc', v_doc_no, 'assets', v_count, 'phase', 'phase126'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('purchase_id', v_p.id, 'doc_type', v_p.doc_type, 'doc_id', v_p.doc_id,
                            'doc_number', v_doc_no, 'assets_created', v_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_fixed_asset_purchase(p_purchase_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_p       public.fixed_asset_purchases%ROWTYPE;
  v_removed int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'reopen_fixed_asset_purchase: not signed in';
  END IF;

  SELECT * INTO v_p FROM public.fixed_asset_purchases WHERE id = p_purchase_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reopen_fixed_asset_purchase: purchase % not found', p_purchase_id;
  END IF;
  IF v_p.status <> 'posted' THEN
    RAISE EXCEPTION 'reopen_fixed_asset_purchase: only a posted purchase can be reopened';
  END IF;

  -- An asset that has started its life in the books cannot silently vanish.
  IF EXISTS (
    SELECT 1 FROM public.fixed_assets a
     WHERE a.purchase_id = v_p.id
       AND (a.status <> 'active'
            OR a.accumulated_depreciation > 0
            OR EXISTS (SELECT 1 FROM public.depreciation_entries d
                        WHERE d.asset_id = a.id AND d.reversed_at IS NULL))
  ) THEN
    RAISE EXCEPTION 'reopen_fixed_asset_purchase: depreciation or a disposal is already posted on these assets — reverse it first';
  END IF;

  -- The document's own reversal: posts the reversing entry at the voucher
  -- date and puts the document back in draft. It refuses on its own if a
  -- payment is applied or the period is locked.
  IF v_p.doc_type = 'vendor_bill' THEN
    PERFORM set_config('stockbolt.asset_purchase_doc', v_p.doc_id::text, true);  -- phase137
    PERFORM public.edit_vendor_bill(v_p.doc_id);
    PERFORM set_config('stockbolt.asset_purchase_doc', '', true);                -- phase137
  ELSE
    PERFORM set_config('stockbolt.asset_purchase_doc', v_p.doc_id::text, true);  -- phase137
    PERFORM public.reopen_expense(v_p.doc_id);
    PERFORM set_config('stockbolt.asset_purchase_doc', '', true);                -- phase137
  END IF;

  DELETE FROM public.fixed_assets WHERE purchase_id = v_p.id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  UPDATE public.fixed_asset_purchases SET status = 'draft' WHERE id = v_p.id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_p.company_id, auth.uid(), 'edit_reopen', 'fixed_asset_purchase', v_p.id,
            jsonb_build_object('doc_type', v_p.doc_type, 'assets_removed', v_removed, 'phase', 'phase126'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('purchase_id', v_p.id, 'assets_removed', v_removed);
END;
$function$;


COMMIT;

-- ── Verify after applying (read-only) ──────────────────────────────────────
-- SELECT (SELECT count(*) FROM pg_trigger WHERE tgname LIKE '%asset_purchase_guard%') AS triggers,   -- expect 6
--        (SELECT count(*) FROM pg_proc WHERE proname IN
--          ('tg_asset_purchase_doc_guard','tg_asset_purchase_debit_note_guard')) AS guard_fns,      -- expect 2
--        (SELECT count(*) FROM pg_proc WHERE proname IN ('post_fixed_asset_purchase','reopen_fixed_asset_purchase')
--           AND prosrc LIKE '%stockbolt.asset_purchase_doc%') AS patched,                           -- expect 2
--        (SELECT bool_or(prosecdef) FROM pg_proc WHERE proname IN
--          ('post_fixed_asset_purchase','reopen_fixed_asset_purchase')) AS any_definer;            -- expect false
