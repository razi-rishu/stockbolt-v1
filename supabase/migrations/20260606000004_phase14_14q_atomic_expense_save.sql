-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 14.14q — atomic expense save (header + items)
-- ─────────────────────────────────────────────────────────────────────────
-- Follow-up to Phase 14.14p — second known partial-save site.
--
-- The purchasing/expense-editor saveMutation does:
--
--   1. expenses.create() OR expenses.update()    ← header committed here
--   2. expenses.replaceItems(id, items)          ← items committed here
--
-- If step 2 fails (validation, RLS, network blip), step 1 is already
-- committed. The header sits in the DB with stale items from before the
-- edit (update path) or no items at all (create path). The next confirm
-- attempt would post a GL using the WRONG line totals, since the header
-- already has the new sum but the item lines disagree.
--
-- This RPC wraps both halves in one function. Postgres rolls back the
-- whole function on any exception in step 2.
--
-- Signature:
--   save_expense_with_items(
--     p_id     UUID,    -- NULL for create, existing id for update
--     p_header JSONB,   -- expense columns
--     p_items  JSONB    -- array of line-item objects
--   ) RETURNS UUID      -- the expense id (new or existing)
--
-- Header payload (matches the existing frontend headerCommon shape):
--   { company_id, expense_number?, date, expense_account_id,
--     paid_from_account_id, amount, tax_amount, total_amount,
--     supplier_id?, reference?, description, receipt_url? }
--
-- Items payload (matches the existing ExpenseItemInsert shape):
--   [{ sort_order, expense_account_id, description?, quantity,
--      unit_amount, tax_rate, tax_amount, line_subtotal, line_total,
--      is_billable, customer_id? }]
-- ─────────────────────────────────────────────────────────────────────────

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
    -- ── CREATE path ──────────────────────────────────────────────────
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
    -- ── UPDATE path ──────────────────────────────────────────────────
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

  -- ── Items: delete-then-insert in the same transaction ──────────────
  -- expense_items FK CASCADEs on expense_id, so the DELETE is clean.
  -- Any INSERT failure rolls the header insert/update back too.
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
  'Atomic expense header + items save. Replaces the two-call pattern in '
  'purchasing/expense-editor (expenses.create + expenses.replaceItems). '
  'If the item-replace step fails, the header insert/update rolls back '
  'too. p_id NULL = create, p_id provided = update. p_items always '
  'replaces the full set; pass [] to clear.';
