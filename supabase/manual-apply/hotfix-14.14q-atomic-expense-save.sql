-- ═══════════════════════════════════════════════════════════════════════════
-- StockBolt — Phase 14.14q hotfix
-- Fix: atomic expense header + items save.
--
-- Why: purchasing/expense-editor called expenses.create()/update() then
-- expenses.replaceItems() as two separate RPC calls. If item-replace
-- failed after the header was committed, the header sat in the DB with
-- stale items (update path) or no items at all (create path). A
-- subsequent confirm attempt would post a GL using a header total that
-- disagreed with the actual line items.
--
-- This RPC wraps both halves in one PL/pgSQL function. Postgres rolls
-- back the whole function on any exception in the item-replace step.
--
-- HOW TO RUN
-- ──────────
-- Supabase Dashboard → SQL Editor → New query → paste this → Run.
-- "Success. No rows returned." → done. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.save_expense_with_items(
  p_id     UUID,
  p_header JSONB,
  p_items  JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id      UUID;
  v_company UUID;
  v_item    JSONB;
BEGIN
  IF p_header IS NULL OR jsonb_typeof(p_header) <> 'object' THEN
    RAISE EXCEPTION 'save_expense_with_items: p_header must be a JSON object';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'save_expense_with_items: p_items must be a JSON array (use [] to clear)';
  END IF;

  IF p_id IS NULL THEN
    IF (p_header->>'company_id') IS NULL THEN
      RAISE EXCEPTION 'save_expense_with_items: p_header.company_id is required for create';
    END IF;
    IF (p_header->>'expense_number') IS NULL THEN
      RAISE EXCEPTION 'save_expense_with_items: p_header.expense_number is required for create';
    END IF;
    v_company := (p_header->>'company_id')::UUID;

    INSERT INTO public.expenses (
      company_id, expense_number, date,
      expense_account_id, paid_from_account_id,
      amount, tax_amount, total_amount,
      supplier_id, reference, description, receipt_url
    )
    VALUES (
      v_company,
      p_header->>'expense_number',
      (p_header->>'date')::DATE,
      (p_header->>'expense_account_id')::UUID,
      (p_header->>'paid_from_account_id')::UUID,
      COALESCE((p_header->>'amount')::NUMERIC, 0),
      COALESCE((p_header->>'tax_amount')::NUMERIC, 0),
      COALESCE((p_header->>'total_amount')::NUMERIC, 0),
      NULLIF(p_header->>'supplier_id', '')::UUID,
      NULLIF(p_header->>'reference', ''),
      COALESCE(p_header->>'description', '(no description)'),
      NULLIF(p_header->>'receipt_url', '')
    )
    RETURNING id INTO v_id;
  ELSE
    v_id := p_id;
    UPDATE public.expenses
       SET expense_account_id   = (p_header->>'expense_account_id')::UUID,
           paid_from_account_id = (p_header->>'paid_from_account_id')::UUID,
           amount               = COALESCE((p_header->>'amount')::NUMERIC, amount),
           tax_amount           = COALESCE((p_header->>'tax_amount')::NUMERIC, tax_amount),
           total_amount         = COALESCE((p_header->>'total_amount')::NUMERIC, total_amount),
           supplier_id          = NULLIF(p_header->>'supplier_id', '')::UUID,
           reference            = NULLIF(p_header->>'reference', ''),
           description          = COALESCE(NULLIF(p_header->>'description', ''), description),
           receipt_url          = NULLIF(p_header->>'receipt_url', ''),
           date                 = COALESCE((p_header->>'date')::DATE, date),
           updated_at           = NOW()
     WHERE id = v_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'save_expense_with_items: expense % not found', v_id;
    END IF;
  END IF;

  DELETE FROM public.expense_items WHERE expense_id = v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.expense_items (
      expense_id, sort_order, expense_account_id, description,
      quantity, unit_amount, tax_rate, tax_amount,
      line_subtotal, line_total,
      is_billable, customer_id
    )
    VALUES (
      v_id,
      COALESCE((v_item->>'sort_order')::INT, 0),
      (v_item->>'expense_account_id')::UUID,
      NULLIF(v_item->>'description', ''),
      COALESCE((v_item->>'quantity')::NUMERIC, 1),
      COALESCE((v_item->>'unit_amount')::NUMERIC, 0),
      COALESCE((v_item->>'tax_rate')::NUMERIC, 0),
      COALESCE((v_item->>'tax_amount')::NUMERIC, 0),
      COALESCE((v_item->>'line_subtotal')::NUMERIC, 0),
      COALESCE((v_item->>'line_total')::NUMERIC, 0),
      COALESCE((v_item->>'is_billable')::BOOLEAN, false),
      NULLIF(v_item->>'customer_id', '')::UUID
    );
  END LOOP;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_expense_with_items(UUID, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_expense_with_items(UUID, JSONB, JSONB) TO authenticated;

COMMENT ON FUNCTION public.save_expense_with_items(UUID, JSONB, JSONB) IS
  'Atomic expense header + items save. Replaces the two-call pattern '
  '(create/update + replaceItems) so a failed item-replace rolls back '
  'the header insert/update too.';

NOTIFY pgrst, 'reload schema';
