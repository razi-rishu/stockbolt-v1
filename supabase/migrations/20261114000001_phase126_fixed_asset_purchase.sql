-- ═══════════════════════════════════════════════════════════════════════════
-- phase126 — buy a fixed asset from New Asset (credit or cash / bank)
--
-- Until now New Asset only wrote the register row: the cost never reached the
-- ledger unless someone also keyed a vendor bill by hand. This lets the
-- purchase and the register entry happen together.
--
-- NO NEW POSTING LOGIC. A purchase is carried by a document the books already
-- know how to post:
--
--   payment type   document        engine                 posts
--   credit         vendor bill     confirm_vendor_bill    Dr asset (+ input tax) / Cr 2100 AP, supplier tagged
--   cash / bank    expense         confirm_expense        Dr asset (+ input tax) / Cr the bank or cash account
--
-- Both engines already accept a GL-account line (vendor_bill_items.
-- coa_account_id, expense_items.expense_account_id), so pointing that line at
-- a fixed-asset account is the whole accounting change (Doc 3 B4 / D3). AP
-- aging, the supplier statement, vendor payments, the period lock and tax all
-- keep working because the payable IS a vendor bill.
--
-- What this migration adds:
--   1. fixed_asset_purchases — one row per purchase: which document carries
--      it, the payment type, and the per-line asset details (category, tag,
--      in-service date, depreciation settings) while it is still a draft.
--   2. fixed_assets.purchase_id — the register row points back at it.
--   3. post_fixed_asset_purchase(id)    confirm the document AND create one
--                                       register row per line, atomically.
--   4. reopen_fixed_asset_purchase(id)  reverse via the document's own control
--                                       (edit_vendor_bill / reopen_expense),
--                                       remove its register rows, back to draft.
--                                       Refused once depreciation is posted.
--   5. delete_fixed_asset_purchase_draft(id)
--
-- Asset cost = exactly what the engine debits to the asset account for that
-- line, so the register and the ledger can never disagree:
--   bill    line_total − tax_amount
--   expense line_subtotal (+ tax_amount when the expense engine folds tax in:
--           no 1500 account and not India — same rule as confirm_expense)
--
-- The functions are SECURITY INVOKER: the caller's own RLS and permissions
-- apply (purchasing.write for the document, accounting.write for the
-- register). Nothing is elevated, so there is no definer guard to get wrong.
--
-- SAFE TO APPLY: additive. New table + nullable column + new functions. No
-- existing function, policy, constraint or row is changed. Run as one
-- transaction; re-running is safe (IF NOT EXISTS / CREATE OR REPLACE).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The purchase record ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fixed_asset_purchases (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  payment_type  text        NOT NULL CHECK (payment_type IN ('credit', 'cash', 'bank')),
  doc_type      text        NOT NULL CHECK (doc_type IN ('vendor_bill', 'expense')),
  doc_id        uuid        NOT NULL,
  status        text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted')),
  -- [{ sort_order, name, asset_tag, category, in_service_date, salvage_value,
  --    useful_life_months, method, wdv_rate, accum_dep_account_code,
  --    expense_account_code }]
  asset_specs   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  notes         text,
  created_by    uuid        DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixed_asset_purchases_doc_matches_type CHECK (
    (payment_type = 'credit' AND doc_type = 'vendor_bill') OR
    (payment_type IN ('cash', 'bank') AND doc_type = 'expense')
  ),
  CONSTRAINT fixed_asset_purchases_doc_unique UNIQUE (doc_type, doc_id)
);

CREATE INDEX IF NOT EXISTS fixed_asset_purchases_company_idx ON public.fixed_asset_purchases (company_id);
CREATE INDEX IF NOT EXISTS fixed_asset_purchases_status_idx  ON public.fixed_asset_purchases (company_id, status);

ALTER TABLE public.fixed_asset_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fixed_asset_purchases_read  ON public.fixed_asset_purchases;
DROP POLICY IF EXISTS fixed_asset_purchases_write ON public.fixed_asset_purchases;
-- Same shape as fixed_assets: read within the company, write with accounting.write.
CREATE POLICY fixed_asset_purchases_read ON public.fixed_asset_purchases
  FOR SELECT USING (company_id = public.current_user_company_id());
CREATE POLICY fixed_asset_purchases_write ON public.fixed_asset_purchases
  FOR ALL
  USING      (company_id = public.current_user_company_id() AND public.has_perm('accounting.write'))
  WITH CHECK (company_id = public.current_user_company_id() AND public.has_perm('accounting.write'));

REVOKE ALL ON public.fixed_asset_purchases FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fixed_asset_purchases TO authenticated;

DROP TRIGGER IF EXISTS set_updated_at ON public.fixed_asset_purchases;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.fixed_asset_purchases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2. Register row → purchase ─────────────────────────────────────────────
ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS purchase_id uuid REFERENCES public.fixed_asset_purchases(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS fixed_assets_purchase_idx ON public.fixed_assets (purchase_id);

-- ── 3. Post: confirm the document and create the register rows ─────────────
CREATE OR REPLACE FUNCTION public.post_fixed_asset_purchase(p_purchase_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
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
    PERFORM public.confirm_vendor_bill(v_p.doc_id);
    SELECT date, bill_number INTO v_doc_date, v_doc_no FROM public.vendor_bills WHERE id = v_p.doc_id;
  ELSE
    PERFORM public.confirm_expense(v_p.doc_id);
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
    SELECT i.sort_order, i.coa_account_id AS acct, (i.line_total - i.tax_amount) AS cost
      FROM public.vendor_bill_items i
     WHERE v_p.doc_type = 'vendor_bill' AND i.bill_id = v_p.doc_id
    UNION ALL
    SELECT i.sort_order, i.expense_account_id,
           i.line_subtotal + CASE WHEN v_fold THEN COALESCE(i.tax_amount, 0) ELSE 0 END
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
      status, notes, created_by, purchase_id
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
      v_p.id
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

-- ── 4. Reopen: reverse through the document's own control ──────────────────
CREATE OR REPLACE FUNCTION public.reopen_fixed_asset_purchase(p_purchase_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
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
    PERFORM public.edit_vendor_bill(v_p.doc_id);
  ELSE
    PERFORM public.reopen_expense(v_p.doc_id);
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

-- ── 5. Delete a draft purchase and its draft document ──────────────────────
CREATE OR REPLACE FUNCTION public.delete_fixed_asset_purchase_draft(p_purchase_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_p public.fixed_asset_purchases%ROWTYPE;
  v_s text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'delete_fixed_asset_purchase_draft: not signed in';
  END IF;
  SELECT * INTO v_p FROM public.fixed_asset_purchases WHERE id = p_purchase_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'delete_fixed_asset_purchase_draft: purchase % not found', p_purchase_id;
  END IF;
  IF v_p.status <> 'draft' THEN
    RAISE EXCEPTION 'delete_fixed_asset_purchase_draft: reopen the purchase before deleting it';
  END IF;

  IF v_p.doc_type = 'vendor_bill' THEN
    SELECT status INTO v_s FROM public.vendor_bills WHERE id = v_p.doc_id;
    IF v_s IS NOT NULL AND v_s <> 'draft' THEN
      RAISE EXCEPTION 'delete_fixed_asset_purchase_draft: the bill is not a draft';
    END IF;
    DELETE FROM public.fixed_asset_purchases WHERE id = v_p.id;
    DELETE FROM public.vendor_bill_items WHERE bill_id = v_p.doc_id;
    DELETE FROM public.vendor_bills WHERE id = v_p.doc_id AND status = 'draft';
  ELSE
    SELECT status INTO v_s FROM public.expenses WHERE id = v_p.doc_id;
    IF v_s IS NOT NULL AND v_s <> 'draft' THEN
      RAISE EXCEPTION 'delete_fixed_asset_purchase_draft: the expense is not a draft';
    END IF;
    DELETE FROM public.fixed_asset_purchases WHERE id = v_p.id;
    DELETE FROM public.expense_items WHERE expense_id = v_p.doc_id;
    DELETE FROM public.expenses WHERE id = v_p.doc_id AND status = 'draft';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.post_fixed_asset_purchase(uuid)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reopen_fixed_asset_purchase(uuid)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_fixed_asset_purchase_draft(uuid)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_fixed_asset_purchase(uuid)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_fixed_asset_purchase(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_fixed_asset_purchase_draft(uuid)  TO authenticated;

COMMIT;

-- ── Verify after applying (read-only) ──────────────────────────────────────
-- SELECT to_regclass('public.fixed_asset_purchases') IS NOT NULL AS table_ok,
--        EXISTS (SELECT 1 FROM information_schema.columns
--                 WHERE table_name = 'fixed_assets' AND column_name = 'purchase_id') AS link_ok,
--        (SELECT count(*) FROM pg_proc WHERE proname IN
--          ('post_fixed_asset_purchase','reopen_fixed_asset_purchase','delete_fixed_asset_purchase_draft')) AS fns;  -- expect 3
--
-- ── Rollback (dev only; refuses while any asset was bought this way) ───────
-- BEGIN;
-- DO $$ BEGIN
--   IF EXISTS (SELECT 1 FROM public.fixed_assets WHERE purchase_id IS NOT NULL) THEN
--     RAISE EXCEPTION 'Assets were purchased through phase126; reopen and delete those purchases first.';
--   END IF;
-- END $$;
-- DROP FUNCTION IF EXISTS public.delete_fixed_asset_purchase_draft(uuid);
-- DROP FUNCTION IF EXISTS public.reopen_fixed_asset_purchase(uuid);
-- DROP FUNCTION IF EXISTS public.post_fixed_asset_purchase(uuid);
-- ALTER TABLE public.fixed_assets DROP COLUMN IF EXISTS purchase_id;
-- DROP TABLE IF EXISTS public.fixed_asset_purchases;
-- COMMIT;
