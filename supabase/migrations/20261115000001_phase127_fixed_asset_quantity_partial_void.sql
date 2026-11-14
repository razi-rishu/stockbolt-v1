-- ═══════════════════════════════════════════════════════════════════════════
-- phase127 — fixed assets: quantity, partial disposal, void
--
-- 1. fixed_assets.quantity
--    How many units the register row holds (100 plates bought on one line).
--    New purchases take it from the bill / expense line; existing purchased
--    assets are backfilled from their line where the match is unambiguous;
--    everything else stays 1.
--
-- 2. dispose_fixed_asset_partial(asset, qty, date, proceeds, account)
--    NO NEW POSTING LOGIC. The asset is split: a new register row takes the
--    disposed units with their exact share of cost, salvage and accumulated
--    depreciation (child = round(parent × qty / quantity, 2); the parent keeps
--    the remainder, so the two always add back to the original to the cent).
--    The child is then disposed by the existing dispose_fixed_asset(), which
--    posts the same Doc 3 asset_disposal entry it always has:
--       Dr accumulated depreciation (share) · Dr proceeds account
--       Cr asset account (share) · Cr 4250 gain / Dr 6910 loss
--    Register totals and the ledger therefore move by exactly the same amount.
--    The remaining units keep depreciating at the reduced cost, which is the
--    proportional charge for what is left.
--    Refused when:
--      • depreciation is not posted up to the month before the disposal
--        (the disposed share would carry too little depreciation), or
--      • depreciation is already posted for the disposal month or later
--        (it was charged on units that are now gone — reverse it first).
--
-- 3. Reversing depreciation charged BEFORE a partial disposal is refused
--    (trigger on depreciation_entries). That entry was charged on the full
--    quantity; reversing it from the smaller remaining asset would take back
--    more depreciation than the asset still carries.
--
-- 4. void_fixed_asset(asset, reason)
--    For a register entry made in error. Kept on the register as 'void' (never
--    deleted) and ignored by depreciation. Allowed only while nothing has been
--    posted for it: no depreciation, no disposal, no partial disposal, and no
--    purchase document behind it (a purchased asset is undone by reopening its
--    purchase, which reverses the bill / expense). Posts nothing: a register
--    entry made outside a purchase never reached the ledger.
--
-- Functions are SECURITY INVOKER: the caller's RLS and accounting.write apply,
-- exactly as for phase126. dispose_fixed_asset() is called, not changed.
--
-- PRE-CHECK on prod before applying (the patched function must start from the
-- definition below). Expected md5 = 3fc032725cd531cbc07ed0d3bb20c9a3:
--   SELECT md5(pg_get_functiondef('public.post_fixed_asset_purchase(uuid)'::regprocedure));
-- If it differs, STOP and send the result.
--
-- SAFE TO APPLY: additive. New columns with defaults, a widened status CHECK,
-- new functions, one new trigger, one patched function (quantity only).
-- One transaction; re-running is safe.
--
-- ROLLBACK (only if nothing was partially disposed or voided yet):
--   DROP TRIGGER IF EXISTS depreciation_entries_split_guard ON public.depreciation_entries;
--   DROP FUNCTION IF EXISTS public.tg_depreciation_split_guard();
--   DROP FUNCTION IF EXISTS public.dispose_fixed_asset_partial(uuid,numeric,date,numeric,text);
--   DROP FUNCTION IF EXISTS public.void_fixed_asset(uuid,text);
--   then re-run phase126 section 3 to restore post_fixed_asset_purchase.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Columns ─────────────────────────────────────────────────────────────
ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS quantity        numeric(15,3) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS parent_asset_id uuid REFERENCES public.fixed_assets(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS void_reason     text,
  ADD COLUMN IF NOT EXISTS voided_at       timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by       uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.fixed_assets'::regclass AND conname = 'fixed_assets_quantity_positive') THEN
    ALTER TABLE public.fixed_assets ADD CONSTRAINT fixed_assets_quantity_positive CHECK (quantity > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS fixed_assets_parent_idx ON public.fixed_assets (parent_asset_id);

-- Widen the status list with 'void'.
ALTER TABLE public.fixed_assets DROP CONSTRAINT IF EXISTS fixed_assets_status_check;
ALTER TABLE public.fixed_assets ADD CONSTRAINT fixed_assets_status_check
  CHECK (status IN ('active','disposed','fully_depreciated','void'));

-- ── 2. Backfill quantity for purchased assets (unambiguous matches only) ──
WITH m AS (
  SELECT a.id AS asset_id, i.quantity AS qty
    FROM public.fixed_assets a
    JOIN public.fixed_asset_purchases p ON p.id = a.purchase_id AND p.doc_type = 'vendor_bill'
    JOIN LATERAL jsonb_array_elements(p.asset_specs) s ON COALESCE(NULLIF(s->>'name',''),'Asset') = a.name
    JOIN public.vendor_bill_items i ON i.bill_id = p.doc_id AND i.sort_order = (s->>'sort_order')::int
                                   AND ROUND(i.line_total - i.tax_amount, 2) = a.cost
  UNION ALL
  SELECT a.id, i.quantity
    FROM public.fixed_assets a
    JOIN public.fixed_asset_purchases p ON p.id = a.purchase_id AND p.doc_type = 'expense'
    JOIN LATERAL jsonb_array_elements(p.asset_specs) s ON COALESCE(NULLIF(s->>'name',''),'Asset') = a.name
    JOIN public.expense_items i ON i.expense_id = p.doc_id AND i.sort_order = (s->>'sort_order')::int
), one AS (
  SELECT asset_id, MIN(qty) AS qty FROM m GROUP BY asset_id HAVING COUNT(*) = 1
)
UPDATE public.fixed_assets a
   SET quantity = one.qty
  FROM one
 WHERE a.id = one.asset_id AND one.qty > 0 AND a.quantity = 1 AND a.parent_asset_id IS NULL;

-- ── 3. New purchases carry the line quantity ───────────────────────────────
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


-- ── 4. Partial disposal ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dispose_fixed_asset_partial(
  p_asset_id uuid, p_quantity numeric, p_disposal_date date,
  p_proceeds numeric, p_proceeds_account_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_a       public.fixed_assets%ROWTYPE;
  v_prev_me date;
  v_ratio   numeric;
  v_cost    numeric(15,2);
  v_salv    numeric(15,2);
  v_acc     numeric(15,2);
  v_child   uuid;
  v_res     jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'dispose_fixed_asset_partial: not signed in';
  END IF;
  PERFORM public.auth_require('accounting.write');

  SELECT * INTO v_a FROM public.fixed_assets
   WHERE id = p_asset_id AND company_id = public.current_user_company_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Asset not found.' USING ERRCODE = 'P0001'; END IF;
  IF v_a.status NOT IN ('active', 'fully_depreciated') THEN
    RAISE EXCEPTION 'Only an asset on the books can be disposed.' USING ERRCODE = 'P0001';
  END IF;
  IF p_disposal_date IS NULL THEN
    RAISE EXCEPTION 'Disposal date is required.' USING ERRCODE = 'P0001';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity to dispose must be more than zero.' USING ERRCODE = 'P0001';
  END IF;
  IF p_quantity > v_a.quantity THEN
    RAISE EXCEPTION 'Only % units are left on this asset.', v_a.quantity USING ERRCODE = 'P0001';
  END IF;

  -- The whole asset: the existing disposal, unchanged.
  IF p_quantity = v_a.quantity THEN
    RETURN public.dispose_fixed_asset(p_asset_id, p_disposal_date, p_proceeds, p_proceeds_account_code)
           || jsonb_build_object('asset_id', p_asset_id, 'quantity', p_quantity);
  END IF;

  IF p_disposal_date < v_a.in_service_date THEN
    RAISE EXCEPTION 'Disposal date is before the asset went into service.' USING ERRCODE = 'P0001';
  END IF;

  -- Depreciation must be up to date before the split, or the disposed share
  -- carries the wrong amount.
  v_prev_me := (date_trunc('month', p_disposal_date) - interval '1 day')::date;
  IF v_a.status = 'active' AND v_a.in_service_date <= v_prev_me
     AND (v_a.last_depreciated_period IS NULL OR v_a.last_depreciated_period < v_prev_me) THEN
    RAISE EXCEPTION 'Run depreciation up to % before disposing part of this asset.', v_prev_me USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.depreciation_entries
              WHERE asset_id = v_a.id AND reversed_at IS NULL AND period_end >= p_disposal_date) THEN
    RAISE EXCEPTION 'Depreciation is already posted for % or later. Reverse it, dispose, then run depreciation again.',
      to_char(p_disposal_date, 'Mon YYYY') USING ERRCODE = 'P0001';
  END IF;

  v_ratio := p_quantity / v_a.quantity;
  v_cost  := ROUND(v_a.cost * v_ratio, 2);
  v_salv  := LEAST(ROUND(v_a.salvage_value * v_ratio, 2), v_cost);
  v_acc   := LEAST(ROUND(v_a.accumulated_depreciation * v_ratio, 2), v_cost);

  INSERT INTO public.fixed_assets (
    company_id, asset_tag, name, category, acquisition_date, in_service_date,
    cost, salvage_value, useful_life_months, method, wdv_rate,
    asset_account_code, accum_dep_account_code, expense_account_code,
    accumulated_depreciation, last_depreciated_period, status, notes,
    created_by, purchase_id, quantity, parent_asset_id
  ) VALUES (
    v_a.company_id, v_a.asset_tag, v_a.name, v_a.category, v_a.acquisition_date, v_a.in_service_date,
    v_cost, v_salv, v_a.useful_life_months, v_a.method, v_a.wdv_rate,
    v_a.asset_account_code, v_a.accum_dep_account_code, v_a.expense_account_code,
    v_acc, v_a.last_depreciated_period, v_a.status, v_a.notes,
    auth.uid(), v_a.purchase_id, p_quantity, v_a.id
  ) RETURNING id INTO v_child;

  UPDATE public.fixed_assets
     SET quantity                 = quantity - p_quantity,
         cost                     = cost - v_cost,
         salvage_value            = salvage_value - v_salv,
         accumulated_depreciation = accumulated_depreciation - v_acc,
         updated_at               = now()
   WHERE id = v_a.id;

  v_res := public.dispose_fixed_asset(v_child, p_disposal_date, p_proceeds, p_proceeds_account_code);

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_a.company_id, auth.uid(), 'dispose_partial', 'fixed_asset', v_a.id,
            jsonb_build_object('disposed_asset_id', v_child, 'quantity', p_quantity,
                               'of_quantity', v_a.quantity, 'cost', v_cost,
                               'accumulated', v_acc, 'phase', 'phase127'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_res || jsonb_build_object('asset_id', v_child, 'quantity', p_quantity);
END;
$function$;

-- ── 5. Guard: no reversing depreciation charged before a partial disposal ──
CREATE OR REPLACE FUNCTION public.tg_depreciation_split_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.reversed_at IS NULL AND NEW.reversed_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.fixed_assets c
                  WHERE c.parent_asset_id = NEW.asset_id
                    AND c.disposal_date > NEW.period_end) THEN
    RAISE EXCEPTION 'This depreciation was charged before part of the asset was disposed, so it can no longer be reversed.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS depreciation_entries_split_guard ON public.depreciation_entries;
CREATE TRIGGER depreciation_entries_split_guard
  BEFORE UPDATE OF reversed_at ON public.depreciation_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_depreciation_split_guard();

-- ── 6. Void a register entry made in error ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.void_fixed_asset(p_asset_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_a public.fixed_assets%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'void_fixed_asset: not signed in';
  END IF;
  PERFORM public.auth_require('accounting.write');
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'A reason is required to void an asset.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_a FROM public.fixed_assets
   WHERE id = p_asset_id AND company_id = public.current_user_company_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Asset not found.' USING ERRCODE = 'P0001'; END IF;
  IF v_a.status = 'void' THEN RAISE EXCEPTION 'This asset is already void.' USING ERRCODE = 'P0001'; END IF;
  IF v_a.purchase_id IS NOT NULL THEN
    RAISE EXCEPTION 'This asset was bought on a purchase. Reopen the purchase to undo it; that reverses the bill or expense.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_a.status = 'disposed' OR v_a.parent_asset_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.fixed_assets c WHERE c.parent_asset_id = v_a.id) THEN
    RAISE EXCEPTION 'A disposal is posted on this asset, so it cannot be voided.' USING ERRCODE = 'P0001';
  END IF;
  IF v_a.accumulated_depreciation <> 0
     OR EXISTS (SELECT 1 FROM public.depreciation_entries d WHERE d.asset_id = v_a.id AND d.reversed_at IS NULL) THEN
    RAISE EXCEPTION 'Depreciation is posted on this asset. Reverse it first, then void.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.fixed_assets
     SET status = 'void', void_reason = btrim(p_reason), voided_at = now(), voided_by = auth.uid(), updated_at = now()
   WHERE id = v_a.id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, old_data, new_data)
    VALUES (v_a.company_id, auth.uid(), 'void', 'fixed_asset', v_a.id,
            jsonb_build_object('status', v_a.status, 'cost', v_a.cost, 'quantity', v_a.quantity),
            jsonb_build_object('status', 'void', 'reason', btrim(p_reason), 'phase', 'phase127'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('asset_id', v_a.id, 'status', 'void');
END;
$function$;

REVOKE ALL ON FUNCTION public.dispose_fixed_asset_partial(uuid,numeric,date,numeric,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.void_fixed_asset(uuid,text)                                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tg_depreciation_split_guard()                               FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispose_fixed_asset_partial(uuid,numeric,date,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_fixed_asset(uuid,text)                                 TO authenticated;

COMMIT;

-- ── Verify after applying (read-only) ──────────────────────────────────────
-- SELECT
--   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fixed_assets' AND column_name='quantity') AS qty_col,
--   to_regprocedure('public.dispose_fixed_asset_partial(uuid,numeric,date,numeric,text)') IS NOT NULL AS partial_fn,
--   to_regprocedure('public.void_fixed_asset(uuid,text)') IS NOT NULL AS void_fn,
--   EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='depreciation_entries_split_guard') AS guard,
--   pg_get_functiondef('public.post_fixed_asset_purchase(uuid)'::regprocedure) LIKE '%v_line.qty%' AS purchase_qty;
-- Expect: all true.
