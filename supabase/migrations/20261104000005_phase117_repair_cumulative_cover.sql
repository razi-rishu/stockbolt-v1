-- phase117: the stranded deferred-COGS repair covers a backorder across
-- several receipts
--
-- WHAT WENT WRONG
-- flush_stranded_deferred_cogs only plans a pending row when ONE vendor bill
-- has enough quantity to cover it. A backorder stranded because two partial
-- receipts covered it together (the defect phase115 fixed going forward)
-- therefore can never be repaired: the repair skips it like the flush did.
--
-- THE FIX
-- When no single bill covers a row, fall back to the phase115 coverage:
-- net stock + still-pending quantity, less what this run already planned.
-- If that covers the row it is flushed at the cost and date of the latest
-- receipt (the one that completed the cover). The single-bill path, the
-- dry-run default, the posting, the phase64 write-back and the recompute
-- are unchanged. Body = live definition plus the marked blocks; no data
-- changes, no new grants. Rollback: supabase/manual-apply/phase117_rollback.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.flush_stranded_deferred_cogs(p_dry_run boolean DEFAULT true, p_post_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID;
  v_user_id    UUID := auth.uid();
  v_row        RECORD;
  v_arr        RECORD;
  v_grp        RECORD;
  v_pick_bill  UUID;
  v_pick_cost  NUMERIC(15,2);
  v_pick_date  DATE;
  v_key        TEXT;
  v_used       NUMERIC(15,3);
  v_grand      NUMERIC(15,2) := 0;
  v_res        JSONB;
  v_je_id      UUID;
  v_plan       JSONB := '[]'::JSONB;   -- allocation: one element per queue row
  v_out        JSONB := '[]'::JSONB;   -- reported: one element per journal entry
  v_consumed   JSONB := '{}'::JSONB;   -- receipt capacity used, per product+bill
  v_posted     INTEGER := 0;
  v_wb          RECORD;   -- Phase 64
  v_sale_row_id UUID;     -- Phase 64
  v_planned    JSONB := '{}'::JSONB;   -- Phase 117 - quantity planned, per product
  v_covered    NUMERIC(15,3);          -- Phase 117
BEGIN
  PERFORM public.auth_require('accounting.write');

  v_company_id := public.current_user_company_id();
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'flush_stranded_deferred_cogs: no company for user %', v_user_id;
  END IF;

  -- ── Pass 1: allocate each pending row to a covering receipt ───────────────
  -- Oldest sale first; within a product, the earliest bill that still has
  -- uncommitted quantity. A row with no covering receipt stays pending.
  FOR v_row IN
    SELECT d.* FROM public.deferred_cogs_queue d
    WHERE d.company_id = v_company_id AND d.status = 'pending'
    ORDER BY d.sale_date, d.created_at
  LOOP
    v_pick_bill := NULL;

    FOR v_arr IN
      SELECT sl.related_doc_id                                        AS bill_id,
             SUM(sl.quantity)                                         AS qty,
             ROUND(SUM(sl.quantity * sl.unit_cost)
                   / NULLIF(SUM(sl.quantity), 0), 2)                  AS unit_cost,
             MIN(sl.date)                                             AS arrival_date
      FROM public.stock_ledger sl
      WHERE sl.company_id       = v_company_id
        AND sl.product_id       = v_row.product_id
        AND sl.direction        = 1
        AND sl.related_doc_type = 'vendor_bill'
        AND sl.reversal_of_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id)
      GROUP BY sl.related_doc_id
      HAVING ROUND(SUM(sl.quantity * sl.unit_cost)
                   / NULLIF(SUM(sl.quantity), 0), 2) > 0
      ORDER BY MIN(sl.seq)
    LOOP
      v_key  := v_row.product_id::TEXT || ':' || v_arr.bill_id::TEXT;
      v_used := COALESCE((v_consumed ->> v_key)::NUMERIC, 0);
      IF (v_arr.qty - v_used) >= v_row.quantity THEN
        v_pick_bill := v_arr.bill_id;
        v_pick_cost := v_arr.unit_cost;
        v_pick_date := v_arr.arrival_date;
        v_consumed  := jsonb_set(v_consumed, ARRAY[v_key],
                                 to_jsonb(v_used + v_row.quantity));
        EXIT;
      END IF;
    END LOOP;

    -- Phase 117 - no single bill covers the row, but several together may
    -- (sell 10, receive 3 then 7). Same coverage as confirm_vendor_bill since
    -- phase115: net stock + still-pending quantity, less what this run has
    -- already planned. The cost and date are those of the latest receipt,
    -- the one that completed the cover, which is where confirm_vendor_bill
    -- would have flushed it.
    IF v_pick_bill IS NULL THEN
      SELECT COALESCE((SELECT SUM(sl.direction * sl.quantity)
                         FROM public.stock_ledger sl
                        WHERE sl.company_id = v_company_id
                          AND sl.product_id = v_row.product_id), 0)
           + COALESCE((SELECT SUM(q.quantity)
                         FROM public.deferred_cogs_queue q
                        WHERE q.company_id = v_company_id
                          AND q.product_id = v_row.product_id
                          AND q.status     = 'pending'), 0)
           - COALESCE((v_planned ->> v_row.product_id::TEXT)::NUMERIC, 0)
        INTO v_covered;
      IF v_covered >= v_row.quantity THEN
        SELECT a.bill_id, a.unit_cost, a.arrival_date
          INTO v_pick_bill, v_pick_cost, v_pick_date
        FROM (
          SELECT sl.related_doc_id                                       AS bill_id,
                 ROUND(SUM(sl.quantity * sl.unit_cost)
                       / NULLIF(SUM(sl.quantity), 0), 2)                 AS unit_cost,
                 MIN(sl.date)                                            AS arrival_date,
                 MAX(sl.seq)                                             AS last_seq
          FROM public.stock_ledger sl
          WHERE sl.company_id       = v_company_id
            AND sl.product_id       = v_row.product_id
            AND sl.direction        = 1
            AND sl.related_doc_type = 'vendor_bill'
            AND sl.reversal_of_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id)
          GROUP BY sl.related_doc_id
        ) a
        WHERE a.unit_cost > 0
        ORDER BY a.last_seq DESC
        LIMIT 1;
      END IF;
    END IF;

    CONTINUE WHEN v_pick_bill IS NULL;

    v_planned := jsonb_set(v_planned, ARRAY[v_row.product_id::TEXT],
      to_jsonb(COALESCE((v_planned ->> v_row.product_id::TEXT)::NUMERIC, 0) + v_row.quantity));

    v_plan := v_plan || jsonb_build_object(
      'queue_id',        v_row.id,
      'sale_invoice_id', v_row.sale_invoice_id,
      'product_id',      v_row.product_id,
      'warehouse_id',    v_row.warehouse_id,
      'bill_id',         v_pick_bill,
      'post_date',       COALESCE(p_post_date, v_pick_date),
      'quantity',        v_row.quantity,
      'unit_cost',       v_pick_cost,
      'amount',          ROUND(v_row.quantity * v_pick_cost, 2)
    );
  END LOOP;

  -- ── Pass 2: one journal entry per covering bill + date ────────────────────
  -- post_journal_entry dates the whole entry, so the grouping key carries the
  -- date. source_type/source_id mirror the engine's own flush JE, which is what
  -- edit_vendor_bill matches on when it re-queues a bill's flushed rows.
  FOR v_grp IN
    SELECT (e ->> 'bill_id')::UUID          AS bill_id,
           (e ->> 'post_date')::DATE        AS post_date,
           SUM((e ->> 'amount')::NUMERIC)   AS total,
           COUNT(*)                         AS rows_n,
           jsonb_agg(jsonb_build_object(
             'account_code', '5100',
             'debit',        (e ->> 'amount')::NUMERIC,
             'credit',       0,
             'description',  'Deferred COGS — sale ' || (e ->> 'sale_invoice_id')
           ) ORDER BY e ->> 'sale_invoice_id')
           ||
           jsonb_agg(jsonb_build_object(
             'account_code', '1300',
             'debit',        0,
             'credit',       (e ->> 'amount')::NUMERIC,
             'description',  'Deferred COGS — sale ' || (e ->> 'sale_invoice_id')
           ) ORDER BY e ->> 'sale_invoice_id')       AS lines
    FROM jsonb_array_elements(v_plan) e
    GROUP BY 1, 2
    ORDER BY 2, 1
  LOOP
    v_grand := v_grand + v_grp.total;

    v_out := v_out || jsonb_build_object(
      'bill_id', v_grp.bill_id,
      'date',    v_grp.post_date,
      'amount',  v_grp.total,
      'rows',    v_grp.rows_n,
      'lines',   v_grp.lines
    );

    CONTINUE WHEN p_dry_run;

    v_res := public.post_journal_entry(jsonb_build_object(
      'date',        v_grp.post_date,
      'description', 'Deferred COGS repair (phase 63)',
      'source_type', 'inventory_cogs',
      'source_id',   v_grp.bill_id,
      'lines',       v_grp.lines
    ));
    v_je_id  := (v_res ->> 'journal_entry_id')::UUID;
    v_posted := v_posted + 1;

    UPDATE public.deferred_cogs_queue d
    SET status                   = 'flushed',
        flushed_at               = NOW(),
        flushed_journal_entry_id = v_je_id,
        flush_unit_cost          = (e ->> 'unit_cost')::NUMERIC,
        updated_at               = NOW()
    FROM jsonb_array_elements(v_plan) e
    WHERE d.id                      = (e ->> 'queue_id')::UUID
      AND d.company_id              = v_company_id
      AND (e ->> 'bill_id')::UUID   = v_grp.bill_id
      AND (e ->> 'post_date')::DATE = v_grp.post_date;

    -- Phase 64 -- mirror the recognised cost onto each originating sale row
    -- so the subledger stops relieving those sales at zero.
    FOR v_wb IN
      SELECT (e ->> 'sale_invoice_id')::UUID AS sale_invoice_id,
             (e ->> 'product_id')::UUID      AS product_id,
             (e ->> 'warehouse_id')::UUID    AS warehouse_id,
             (e ->> 'unit_cost')::NUMERIC    AS unit_cost
      FROM jsonb_array_elements(v_plan) e
      WHERE (e ->> 'bill_id')::UUID   = v_grp.bill_id
        AND (e ->> 'post_date')::DATE = v_grp.post_date
    LOOP
      SELECT sl.id INTO v_sale_row_id
      FROM public.stock_ledger sl
      WHERE sl.company_id       = v_company_id
        AND sl.product_id       = v_wb.product_id
        AND sl.related_doc_type = 'invoice'
        AND sl.related_doc_id   = v_wb.sale_invoice_id
        AND sl.direction        = -1
        AND sl.unit_cost        = 0
        AND sl.warehouse_id IS NOT DISTINCT FROM v_wb.warehouse_id
        AND sl.reversal_of_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id)
      ORDER BY sl.seq
      LIMIT 1;

      IF v_sale_row_id IS NOT NULL THEN
        UPDATE public.stock_ledger
        SET unit_cost  = v_wb.unit_cost,
            total_cost = ROUND(quantity * v_wb.unit_cost, 2)
        WHERE id = v_sale_row_id;
      END IF;
    END LOOP;
  END LOOP;

  -- Phase 64 -- the valuation trigger is INSERT-only; refresh explicitly.
  IF NOT p_dry_run AND v_posted > 0 THEN
    PERFORM public.recompute_stock_valuation(v_company_id);
  END IF;

  IF NOT p_dry_run AND v_posted > 0 THEN
    BEGIN
      INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
      VALUES (v_company_id, v_user_id, 'repair', 'deferred_cogs_queue', NULL,
        jsonb_build_object('total', v_grand, 'entries', v_posted, 'phase', '63'));
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'dry_run',        p_dry_run,
    'total',          v_grand,
    'entries',        jsonb_array_length(v_out),
    'entries_posted', v_posted,
    'plan',           v_out
  );
END;
$function$;

COMMIT;
