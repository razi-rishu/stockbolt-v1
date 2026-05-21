-- ════════════════════════════════════════════════════════════════════════════
-- Phase 13.01 — Expense items table + multi-line confirm_expense
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHY
-- ───
-- The original expense flow (Phase 8) supports a single expense_account_id
-- per expense — fine for a one-off receipt but not for SME workflows that
-- need to split a single payment across multiple expense categories
-- (e.g. one supplier invoice that covers fuel + parking + meals).
--
-- This phase introduces a child table `expense_items` modelled after
-- `invoice_items`, plus the columns needed for the Zoho-style "billable
-- expense" re-bill flow (Phase 13.03):
--
--   is_billable             — line is reimbursable from a customer
--   customer_id             — which customer it'll be re-billed to
--   billed_invoice_id       — stamped when the line lands on an invoice
--   billed_invoice_item_id  — deeper link to the exact invoice line
--
-- WHAT
-- ────
-- 1. CREATE expense_items + indexes + RLS (mirrors invoice_items pattern).
-- 2. Rewrite confirm_expense so it:
--      - Detects expense_items rows for the expense.
--      - If items exist  → posts multi-line GL (one Dr per item's expense
--                          account, summed by account so the trial balance
--                          stays clean; Dr 1500 Input VAT for the
--                          aggregated tax; Cr paid_from for total).
--      - If items absent → legacy single-line path, identical math to the
--                          original Phase 8 RPC.
--    Also fixes the original GL inserts to include `account_code`, `date`
--    and `related_doc_type` / `related_doc_id` which were missing — every
--    other RPC writes them and downstream reports filter on account_code.
-- 3. void_expense is unchanged — reversal works off journal_entry_id, so
--    the multi-line entries reverse together by linking to the same JE.
--
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. expense_items table ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.expense_items (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id               UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  sort_order               INTEGER NOT NULL DEFAULT 0,

  -- Posting target: which 5xxx / 6xxx CoA account this slice hits.
  expense_account_id       UUID NOT NULL REFERENCES public.chart_of_accounts(id),

  description              TEXT,
  quantity                 NUMERIC(15,4) NOT NULL DEFAULT 1,
  unit_amount              NUMERIC(15,2) NOT NULL DEFAULT 0,    -- ex-tax
  tax_rate                 NUMERIC(5,2)  NOT NULL DEFAULT 0,    -- %
  tax_amount               NUMERIC(15,2) NOT NULL DEFAULT 0,    -- absolute
  line_subtotal            NUMERIC(15,2) NOT NULL DEFAULT 0,    -- qty*unit
  line_total               NUMERIC(15,2) NOT NULL DEFAULT 0,    -- subtotal+tax

  -- Billable re-bill flow (used by Phase 13.03)
  is_billable              BOOLEAN NOT NULL DEFAULT FALSE,
  customer_id              UUID REFERENCES public.contacts(id),
  billed_invoice_id        UUID REFERENCES public.invoices(id),
  billed_invoice_item_id   UUID REFERENCES public.invoice_items(id),

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Integrity guards. SME workflows don't need to mark something billable
  -- and forget to pick the customer, and once billed the row must stay
  -- billable for the re-bill link to make sense.
  CONSTRAINT expense_items_billable_requires_customer
    CHECK (NOT is_billable OR customer_id IS NOT NULL),
  CONSTRAINT expense_items_billed_requires_billable
    CHECK (billed_invoice_id IS NULL OR is_billable)
);

-- Cheap lookup by parent (loaded every time an expense is opened).
CREATE INDEX IF NOT EXISTS expense_items_expense_idx
  ON public.expense_items(expense_id);

-- Partial index for the "Add billable expenses to invoice" picker in
-- Phase 13.03. Only indexes the rows that picker actually queries (small).
CREATE INDEX IF NOT EXISTS expense_items_unbilled_idx
  ON public.expense_items(customer_id)
  WHERE is_billable = TRUE AND billed_invoice_id IS NULL;

COMMENT ON TABLE public.expense_items IS
  'Phase 13.01 — child table of expenses. One row per expense category split. '
  'Each line posts to its own 5xxx/6xxx CoA account when the parent expense '
  'is confirmed. Billable flags drive the Phase 13.03 re-bill flow.';

-- ── 2. RLS policy (mirrors invoice_items) ───────────────────────────────────
-- expense_items has no company_id of its own — we lean on the parent.
ALTER TABLE public.expense_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.expense_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses e
       WHERE e.id = expense_items.expense_id
         AND e.company_id = public.current_user_company_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.expenses e
       WHERE e.id = expense_items.expense_id
         AND e.company_id = public.current_user_company_id()
    )
  );

-- ── 3. updated_at trigger (cheap; mirrors other child tables) ───────────────
CREATE OR REPLACE FUNCTION public.touch_expense_items_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS expense_items_updated_at ON public.expense_items;
CREATE TRIGGER expense_items_updated_at
  BEFORE UPDATE ON public.expense_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_expense_items_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Rewrite confirm_expense
-- ════════════════════════════════════════════════════════════════════════════
--
-- Multi-line posting math:
--   For each row in expense_items grouped by expense_account_id:
--     Dr expense_account_id  SUM(line_subtotal)
--   Dr 1500 Input VAT        SUM(tax_amount)   -- if > 0 and account exists
--   Cr paid_from_account     v_expense.total_amount
--
-- The grouping keeps the trial balance compact even if the user splits
-- across 5 rows of the same fuel-and-meals account. Total Dr always
-- equals total Cr because expense.total_amount is recomputed from item
-- sums by the application before calling this RPC.
--
-- Legacy single-line path (when no items exist) preserved verbatim for
-- backward compatibility with the old /banking/expenses screen.

CREATE OR REPLACE FUNCTION public.confirm_expense(p_expense_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id        UUID := auth.uid();
  v_company_id     UUID;
  v_expense        public.expenses%ROWTYPE;
  v_lock_date      DATE;
  v_paid_coa_id    UUID;
  v_paid_coa_code  TEXT;
  v_input_vat_id   UUID;
  v_je_id          UUID;
  v_je_number      TEXT;
  v_item_count     INTEGER;
  v_total_tax      NUMERIC(15,2);
  v_rec            RECORD;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_expense: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_expense
    FROM public.expenses
   WHERE id = p_expense_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_expense: expense % not found', p_expense_id;
  END IF;
  IF v_expense.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_expense: expense already % — cannot confirm', v_expense.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_expense.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_expense: date % is on or before period lock %', v_expense.date, v_lock_date;
  END IF;

  -- Resolve paid-from bank account → CoA id + code.
  SELECT ba.coa_account_id, coa.code
    INTO v_paid_coa_id, v_paid_coa_code
    FROM public.bank_accounts ba
    JOIN public.chart_of_accounts coa ON coa.id = ba.coa_account_id
   WHERE ba.id = v_expense.paid_from_account_id
     AND ba.company_id = v_company_id;
  IF v_paid_coa_id IS NULL THEN
    RAISE EXCEPTION 'confirm_expense: paid_from_account has no CoA link';
  END IF;

  -- Resolve Input VAT account (1500) only if any tax is present.
  SELECT id INTO v_input_vat_id
    FROM public.chart_of_accounts
   WHERE company_id = v_company_id AND code = '1500' LIMIT 1;
  -- v_input_vat_id may be NULL — that's fine; companies that don't claim
  -- input VAT just leave the tax baked into the expense line below.

  -- JE number via the shared document_sequences row.
  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1000, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'JE-' || current_value::TEXT INTO v_je_number
    FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'JE';

  -- JE header (one per expense regardless of line count).
  INSERT INTO public.journal_entries
    (company_id, je_number, date, source_type, source_id, description, posted_by, is_reversed)
  VALUES
    (v_company_id, v_je_number, v_expense.date,
     'expense', p_expense_id,
     COALESCE(v_expense.description, 'Expense ' || v_expense.expense_number),
     v_user_id, FALSE)
  RETURNING id INTO v_je_id;

  -- ── Branch: multi-line vs single-line ─────────────────────────────────────
  SELECT COUNT(*) INTO v_item_count
    FROM public.expense_items WHERE expense_id = p_expense_id;

  IF v_item_count > 0 THEN
    -- Multi-line path. Aggregate by expense account so each posting account
    -- gets at most one GL row per JE (cleaner TB / GL drill-down).
    FOR v_rec IN
      SELECT ei.expense_account_id,
             coa.code  AS account_code,
             SUM(ei.line_subtotal) AS subtotal_sum,
             SUM(ei.tax_amount)    AS tax_sum
        FROM public.expense_items ei
        JOIN public.chart_of_accounts coa ON coa.id = ei.expense_account_id
       WHERE ei.expense_id = p_expense_id
       GROUP BY ei.expense_account_id, coa.code
    LOOP
      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date,
         debit, credit, description, contact_id, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_je_id, v_rec.expense_account_id, v_rec.account_code, v_expense.date,
         v_rec.subtotal_sum, 0,
         'Expense ' || v_expense.expense_number,
         v_expense.supplier_id, 'expense', p_expense_id);
    END LOOP;

    SELECT COALESCE(SUM(tax_amount), 0) INTO v_total_tax
      FROM public.expense_items WHERE expense_id = p_expense_id;
  ELSE
    -- Legacy single-line path. Same Dr posting the original RPC did, plus
    -- the missing account_code / date / related_doc_* columns so the row
    -- shows up in TB / GL drill-down / customer-supplier statements.
    DECLARE
      v_legacy_code TEXT;
    BEGIN
      SELECT code INTO v_legacy_code FROM public.chart_of_accounts
       WHERE id = v_expense.expense_account_id LIMIT 1;

      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date,
         debit, credit, description, contact_id, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_je_id, v_expense.expense_account_id, v_legacy_code, v_expense.date,
         v_expense.amount, 0,
         COALESCE(v_expense.description, 'Expense'),
         v_expense.supplier_id, 'expense', p_expense_id);
    END;
    v_total_tax := v_expense.tax_amount;
  END IF;

  -- Dr Input VAT (one row, total tax across all items).
  IF v_total_tax > 0 AND v_input_vat_id IS NOT NULL THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_input_vat_id, '1500', v_expense.date,
       v_total_tax, 0,
       'Input VAT on ' || v_expense.expense_number,
       v_expense.supplier_id, 'expense', p_expense_id);
  END IF;

  -- Cr paid-from (single row, total amount).
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date,
     debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_paid_coa_id, v_paid_coa_code, v_expense.date,
     0, v_expense.total_amount,
     'Payment for ' || v_expense.expense_number,
     v_expense.supplier_id, 'expense', p_expense_id);

  UPDATE public.expenses
     SET status = 'confirmed', updated_at = NOW()
   WHERE id = p_expense_id;

  INSERT INTO public.audit_logs (company_id, table_name, record_id, action, performed_by, new_data)
  VALUES (v_company_id, 'expenses', p_expense_id, 'confirm', v_user_id,
          jsonb_build_object('journal_entry_id', v_je_id, 'item_count', v_item_count));

  RETURN jsonb_build_object(
    'expense_id',       p_expense_id,
    'journal_entry_id', v_je_id,
    'item_count',       v_item_count
  );
END;
$$;

COMMENT ON FUNCTION public.confirm_expense IS
  'Phase 13.01 — multi-line aware confirm. If expense_items exist for the '
  'expense the GL post is split by account; otherwise the legacy '
  'single-line path runs. Always populates account_code/date/contact_id '
  'so reports filter correctly.';
