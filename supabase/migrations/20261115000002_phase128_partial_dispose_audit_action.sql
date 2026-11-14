-- ═══════════════════════════════════════════════════════════════════════════
-- phase128 — partial disposal audit entry was silently dropped
--
-- phase127's dispose_fixed_asset_partial() wrote audit_logs.action =
-- 'dispose_partial', which the audit_logs_action_check constraint (phase110)
-- does not accept. The insert sits in an EXCEPTION block, so the disposal
-- itself posted fine but its audit row was dropped without a trace.
--
-- Fix: log it under the existing 'dispose_fixed_asset' action with
-- "partial": true in new_data. Nothing else in the function changes. The
-- disposed row's own audit entry (written by dispose_fixed_asset) was never
-- affected, so no history is missing for the posting itself.
--
-- PRE-CHECK on prod (expected 810d557a033a2c9a1da591dbca9cf1f1):
--   SELECT md5(replace(pg_get_functiondef(
--     'public.dispose_fixed_asset_partial(uuid,numeric,date,numeric,text)'::regprocedure), chr(13), ''));
-- If it differs, STOP and send the result.
--
-- SAFE TO APPLY: one CREATE OR REPLACE of a SECURITY INVOKER function; same
-- signature, so grants are kept. Re-running is safe.
-- ROLLBACK: re-run section 4 of phase127.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.dispose_fixed_asset_partial(p_asset_id uuid, p_quantity numeric, p_disposal_date date, p_proceeds numeric, p_proceeds_account_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
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
    VALUES (v_a.company_id, auth.uid(), 'dispose_fixed_asset', 'fixed_asset', v_a.id,
            jsonb_build_object('partial', true, 'disposed_asset_id', v_child, 'quantity', p_quantity,
                               'of_quantity', v_a.quantity, 'cost', v_cost,
                               'accumulated', v_acc, 'phase', 'phase128'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_res || jsonb_build_object('asset_id', v_child, 'quantity', p_quantity);
END;
$function$;

COMMIT;

-- ── Verify after applying (read-only) — expect true, false ────────────────
-- SELECT pg_get_functiondef('public.dispose_fixed_asset_partial(uuid,numeric,date,numeric,text)'::regprocedure) LIKE '%''partial'', true%' AS fixed,
--        pg_get_functiondef('public.dispose_fixed_asset_partial(uuid,numeric,date,numeric,text)'::regprocedure) LIKE '%dispose_partial%'  AS old_action_left;
