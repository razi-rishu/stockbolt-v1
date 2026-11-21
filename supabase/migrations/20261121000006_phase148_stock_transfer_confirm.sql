-- ═══════════════════════════════════════════════════════════════════════════
-- phase148 — stock transfers can be confirmed again
--
-- Bug: confirm_stock_transfer wrote status = 'confirmed', but
-- stock_transfers_status_check only allows 'draft', 'in_transit', 'completed',
-- 'void'. The UPDATE failed with a check violation, the whole call rolled back,
-- and no stock transfer could ever be confirmed (no stock moved, nothing saved).
--
-- Fix: the function now finishes a transfer as 'completed' (the table's
-- existing "done" state; the screens only ever test for 'draft'). Everything
-- else in the function is the live definition, unchanged: same stock-ledger
-- rows (transfer_out / transfer_in at the company MAC), same period-lock check,
-- same audit row. Still SECURITY DEFINER with the same search_path; CREATE OR
-- REPLACE keeps its owner (ledger_writer, phase119) and its grants.
--
-- No data change: no transfer can be in 'confirmed' today.
-- SAFE TO APPLY: one function replaced, one transaction, re-runnable.
--
-- PRE-CHECK (run first on production, read-only) — expect writes_confirmed = true,
-- owner = ledger_writer, check_allows_confirmed = false:
-- SELECT p.prosrc LIKE '%status = ''confirmed''%' AS writes_confirmed,
--        pg_get_userbyid(p.proowner) AS owner,
--        pg_get_constraintdef(c.oid) LIKE '%''confirmed''%' AS check_allows_confirmed
--   FROM pg_proc p, pg_constraint c
--  WHERE p.proname = 'confirm_stock_transfer' AND p.pronamespace = 'public'::regnamespace
--    AND c.conname = 'stock_transfers_status_check';
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.confirm_stock_transfer(p_transfer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id        UUID := auth.uid();
  v_company_id     UUID;
  v_transfer       public.stock_transfers%ROWTYPE;
  v_item           RECORD;
  v_lock_date      DATE;
  v_from_qty       NUMERIC(15,3);
  v_to_qty         NUMERIC(15,3);
  v_mac            NUMERIC(15,2);
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_stock_transfer: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_transfer
  FROM public.stock_transfers
  WHERE id = p_transfer_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_stock_transfer: transfer % not found', p_transfer_id;
  END IF;
  IF v_transfer.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_stock_transfer: transfer % not in draft (status=%)', p_transfer_id, v_transfer.status;
  END IF;
  IF v_transfer.from_warehouse_id = v_transfer.to_warehouse_id THEN
    RAISE EXCEPTION 'confirm_stock_transfer: from and to warehouse must differ';
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_transfer.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_stock_transfer: date % on or before period lock %', v_transfer.date, v_lock_date;
  END IF;

  -- Process each line item
  FOR v_item IN
    SELECT * FROM public.stock_transfer_items WHERE transfer_id = p_transfer_id
  LOOP
    -- Current company-wide MAC for this product
    SELECT COALESCE(running_avg_cost, 0) INTO v_mac
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_item.product_id
    ORDER BY seq DESC LIMIT 1;
    v_mac := COALESCE(v_mac, COALESCE(v_item.unit_cost, 0));

    -- Running qty at from_warehouse
    SELECT COALESCE(running_qty, 0) INTO v_from_qty
    FROM public.stock_ledger
    WHERE company_id = v_company_id
      AND product_id = v_item.product_id
      AND warehouse_id = v_transfer.from_warehouse_id
    ORDER BY seq DESC LIMIT 1;
    v_from_qty := COALESCE(v_from_qty, 0);

    -- Running qty at to_warehouse
    SELECT COALESCE(running_qty, 0) INTO v_to_qty
    FROM public.stock_ledger
    WHERE company_id = v_company_id
      AND product_id = v_item.product_id
      AND warehouse_id = v_transfer.to_warehouse_id
    ORDER BY seq DESC LIMIT 1;
    v_to_qty := COALESCE(v_to_qty, 0);

    -- Row 1: transfer_out (from warehouse loses stock)
    INSERT INTO public.stock_ledger
      (company_id, product_id, warehouse_id, date,
       type, direction, quantity, unit_cost, total_cost,
       running_qty, running_avg_cost,
       related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_item.product_id, v_transfer.from_warehouse_id, v_transfer.date,
       'transfer_out', -1, v_item.quantity, v_mac, v_mac * v_item.quantity,
       v_from_qty - v_item.quantity, v_mac,
       'stock_transfer', p_transfer_id);

    -- Row 2: transfer_in (to warehouse gains stock)
    INSERT INTO public.stock_ledger
      (company_id, product_id, warehouse_id, date,
       type, direction, quantity, unit_cost, total_cost,
       running_qty, running_avg_cost,
       related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_item.product_id, v_transfer.to_warehouse_id, v_transfer.date,
       'transfer_in', 1, v_item.quantity, v_mac, v_mac * v_item.quantity,
       v_to_qty + v_item.quantity, v_mac,
       'stock_transfer', p_transfer_id);
  END LOOP;

  -- phase148 — 'completed', not 'confirmed': stock_transfers_status_check allows
  -- only draft / in_transit / completed / void, so 'confirmed' failed every time.
  UPDATE public.stock_transfers
  SET status = 'completed', updated_at = NOW()
  WHERE id = p_transfer_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'stock_transfer', p_transfer_id,
      jsonb_build_object('transfer_number', v_transfer.transfer_number));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'transfer_id',     p_transfer_id,
    'transfer_number', v_transfer.transfer_number
  );
END;
$function$;

COMMIT;

-- ── Verify after applying (read-only) — expect writes_completed = true,
--    writes_confirmed = false, still_definer = true, owner = ledger_writer ──
-- SELECT p.prosrc LIKE '%status = ''completed''%' AS writes_completed,
--        p.prosrc LIKE '%status = ''confirmed''%' AS writes_confirmed,
--        p.prosecdef AS still_definer, pg_get_userbyid(p.proowner) AS owner
--   FROM pg_proc p WHERE p.proname = 'confirm_stock_transfer' AND p.pronamespace = 'public'::regnamespace;

-- ── ROLLBACK: re-create the function with SET status = 'confirmed' (the broken
--    state; there is no reason to). ───────────────────────────────────────────
