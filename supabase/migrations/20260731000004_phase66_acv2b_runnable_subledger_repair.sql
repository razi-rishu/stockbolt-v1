-- ============================================================================
-- Phase 66 (AC-V2b) — make the subledger repair actually runnable
--
-- PROBLEM
-- repair_flushed_cogs_subledger could not be invoked by anyone.
--
-- It opens with auth_require('inventory.write'). auth_require -> has_perm reads
-- auth.uid(); with no user session that is NULL, has_perm returns FALSE, and the
-- call dies with "forbidden: requires inventory.write permission". That is
-- exactly the situation in the Supabase SQL editor (runs as postgres) and under
-- service_role. Verified against production: both repair RPCs return forbidden.
--
-- There is also no UI that calls it. So the repair tool shipped in phase 64 was
-- unreachable, and the instruction to "run it in the SQL editor" was wrong.
--
-- WHY A SERVICE-ROLE PATH IS SAFE HERE
-- This function posts NOTHING: no journal entry, no general_ledger row. It only
-- writes the cost onto stock_ledger rows whose value was already recognised in
-- the GL, then re-derives the averages. It is GL-neutral by construction and a
-- tripwire asserts that.
--
-- A caller with no user session is service_role, which already bypasses RLS
-- entirely and can UPDATE stock_ledger directly. Gating it behind a permission
-- check therefore adds no protection — it only made the tool unusable.
--
-- The authenticated path is UNCHANGED: auth_require still runs, and the repair
-- is still scoped to the caller's own tenant.
--
-- NOT DONE HERE — flush_stranded_deferred_cogs (the Pro_Parts 596.44 repair)
-- composes post_journal_entry, which hard-requires auth.uid() -> profiles to
-- resolve the company and stamp created_by. It genuinely cannot run without a
-- user session, and relaxing the shared posting primitive to allow that would
-- weaken the one place balance and the period lock are centrally enforced. That
-- repair is being given a signed-in admin action instead (AC-V2c).
--
-- Signature is unchanged, so this is a true CREATE OR REPLACE with no overload.
-- Additive and idempotent. Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.repair_flushed_cogs_subledger(p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id  UUID;
  v_user_id     UUID := auth.uid();
  v_row         RECORD;
  v_sale_row_id UUID;
  v_claimed     UUID[] := '{}';
  v_plan        JSONB  := '[]'::JSONB;
  v_fixed       INTEGER := 0;
  v_value       NUMERIC(15,2) := 0;
  v_all_tenants BOOLEAN := FALSE;   -- Phase 66
  v_audit_co    UUID;               -- Phase 66
BEGIN
  -- ---- Phase 66 (AC-V2b) -----------------------------------------------
  -- No user session => service_role / SQL editor. Sweep every tenant. This
  -- function posts nothing, and service_role can already write stock_ledger
  -- directly, so the permission gate protected nothing and blocked everything.
  IF auth.uid() IS NULL THEN
    v_company_id  := NULL;
    v_all_tenants := TRUE;
  ELSE
    PERFORM public.auth_require('inventory.write');
    v_company_id  := public.current_user_company_id();
    v_all_tenants := FALSE;
    IF v_company_id IS NULL THEN
      RAISE EXCEPTION 'repair_flushed_cogs_subledger: no company for user %', v_user_id;
    END IF;
  END IF;
  -- ---- end Phase 66 ----------------------------------------------------

  FOR v_row IN
    SELECT d.id, d.company_id, d.product_id, d.sale_invoice_id, d.warehouse_id,
           d.quantity, d.flush_unit_cost
    FROM public.deferred_cogs_queue d
    WHERE (v_all_tenants OR d.company_id = v_company_id)
      AND d.status     = 'flushed'
      AND COALESCE(d.flush_unit_cost, 0) > 0
    ORDER BY d.company_id, d.sale_date, d.created_at
  LOOP
    -- v_claimed keeps a dry run honest: without it, two deferred rows on the
    -- same invoice + product would both report the SAME sale row, and the
    -- plan would overstate what the real run actually changes.
    SELECT sl.id INTO v_sale_row_id
    FROM public.stock_ledger sl
    WHERE sl.company_id       = v_row.company_id
      AND sl.product_id       = v_row.product_id
      AND sl.related_doc_type = 'invoice'
      AND sl.related_doc_id   = v_row.sale_invoice_id
      AND sl.direction        = -1
      AND sl.unit_cost        = 0
      AND sl.warehouse_id IS NOT DISTINCT FROM v_row.warehouse_id
      AND sl.reversal_of_id IS NULL
      AND NOT (sl.id = ANY(v_claimed))
      AND NOT EXISTS (SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id)
    ORDER BY sl.seq
    LIMIT 1;

    CONTINUE WHEN v_sale_row_id IS NULL;

    v_claimed := v_claimed || v_sale_row_id;
    v_fixed   := v_fixed + 1;
    v_value   := v_value + ROUND(v_row.quantity * v_row.flush_unit_cost, 2);
    v_plan    := v_plan || jsonb_build_object(
      'company_id',   v_row.company_id,   -- Phase 66: a cross-tenant sweep must
                                          -- say which tenant each row belongs to
      'queue_id',     v_row.id,
      'stock_row_id', v_sale_row_id,
      'product_id',   v_row.product_id,
      'quantity',     v_row.quantity,
      'unit_cost',    v_row.flush_unit_cost,
      'total_cost',   ROUND(v_row.quantity * v_row.flush_unit_cost, 2)
    );

    CONTINUE WHEN p_dry_run;

    UPDATE public.stock_ledger
    SET unit_cost  = v_row.flush_unit_cost,
        total_cost = ROUND(quantity * v_row.flush_unit_cost, 2)
    WHERE id = v_sale_row_id;
  END LOOP;

  IF NOT p_dry_run AND v_fixed > 0 THEN
    -- INSERT-only trigger: the UPDATEs above need an explicit re-derive.
    -- NULL means every company, which is what the service-role sweep wants.
    PERFORM public.recompute_stock_valuation(v_company_id);

    -- Phase 66 — one audit row per affected tenant, so a cross-tenant sweep is
    -- traceable in each company's own log rather than only the caller's.
    FOR v_audit_co IN
      SELECT DISTINCT (e ->> 'company_id')::UUID FROM jsonb_array_elements(v_plan) e
    LOOP
      BEGIN
        INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
        VALUES (v_audit_co, v_user_id, 'repair', 'stock_ledger', NULL,
          jsonb_build_object(
            'rows',  (SELECT count(*) FROM jsonb_array_elements(v_plan) e
                       WHERE (e ->> 'company_id')::UUID = v_audit_co),
            'value', (SELECT COALESCE(SUM((e ->> 'total_cost')::NUMERIC), 0)
                        FROM jsonb_array_elements(v_plan) e
                       WHERE (e ->> 'company_id')::UUID = v_audit_co),
            'phase', '66'));
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'dry_run',     p_dry_run,
    'all_tenants', v_all_tenants,
    'rows',        v_fixed,
    'value',       v_value,
    'plan',        v_plan
  );
END;
$function$;
