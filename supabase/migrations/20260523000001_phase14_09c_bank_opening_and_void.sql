-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 14 — Migration 09c: Per-bank openings + void RPC
-- ─────────────────────────────────────────────────────────────────────────
-- Two improvements to the opening-balances wizard (14.09 + 14.09b):
--
-- 1. post_bank_opening_balance(...) — dedicated RPC for opening a SPECIFIC
--    bank account (chosen from bank_accounts, not the raw CoA picker).
--    Does three things atomically:
--      a) posts a 2-line JE to the bank's coa_account_id + 3010 contra
--      b) updates bank_accounts.opening_balance / opening_balance_date so
--         the bank reconciliation report and bank-accounts settings page
--         agree with the GL
--      c) tags the JE with source_type='opening_bank' so listPosted can
--         distinguish bank openings from generic GL openings
--
--    Without this, the operator either (i) had to manually edit
--    bank_accounts.opening_balance separately from posting a GL JE — two
--    sources of truth — or (ii) posted to the bank's CoA row but the
--    bank_accounts.opening_balance field stayed at zero, breaking the
--    reconciliation report.
--
-- 2. void_opening_balance(p_doc_id, p_doc_type) — corrects mistakes on a
--    posted opening row. Reverses the underlying JE (creates a mirror JE
--    with debit/credit flipped, links them via reversed_by_id) and marks
--    the source doc (invoice / vendor_bill / payment) status='void' so it
--    drops out of open-invoice / open-bill / advance lists. GL-only
--    openings (no source doc) just get the JE reversed.
--
--    Conservative by design: we never DELETE; the audit trail keeps both
--    the original and the reversal. The wizard's "Already posted" panel
--    will start excluding voided rows so the operator can re-post a
--    corrected entry without seeing the wrong one alongside.
--
-- Phase tag `Phase 14.09c` appears in both functions for the regression
-- suite.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. post_bank_opening_balance ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_bank_opening_balance(
  p_bank_account_id UUID,
  p_direction       TEXT,
  p_amount          NUMERIC,
  p_date            DATE,
  p_notes           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
-- Phase 14.09c — per-bank opening balance.
DECLARE
  v_company_id    UUID;
  v_user_id       UUID;
  v_bank_name     TEXT;
  v_coa_id        UUID;
  v_coa_code      TEXT;
  v_coa_name      TEXT;
  v_ob_eq_id      UUID;
  v_je_id         UUID;
  v_entry_number  TEXT;
  v_seq           INT;
  v_descr         TEXT;
BEGIN
  -- Resolve the bank — gives us company_id, the linked CoA row, and the
  -- bank's display name (for the JE description).
  SELECT b.company_id, b.name, b.coa_account_id, coa.code, coa.name
    INTO v_company_id, v_bank_name, v_coa_id, v_coa_code, v_coa_name
  FROM public.bank_accounts b
  JOIN public.chart_of_accounts coa ON coa.id = b.coa_account_id
  WHERE b.id = p_bank_account_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Bank account % not found', p_bank_account_id;
  END IF;

  v_user_id := auth.uid();

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Opening amount must be positive, got %', p_amount;
  END IF;
  IF p_direction NOT IN ('debit','credit') THEN
    RAISE EXCEPTION 'Direction must be debit or credit, got %', p_direction;
  END IF;
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'Opening date is required';
  END IF;

  -- 3010 contra (seeded by 14.09).
  SELECT id INTO v_ob_eq_id FROM public.chart_of_accounts
   WHERE company_id = v_company_id AND code = '3010';
  IF v_ob_eq_id IS NULL THEN
    RAISE EXCEPTION '3010 Opening Balance Equity not seeded for this company';
  END IF;

  -- JE number.
  INSERT INTO public.document_sequences
    (company_id, prefix, current_value, format, padding_length, allow_reset)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1,
        updated_at    = NOW()
  RETURNING current_value INTO v_seq;
  v_entry_number := 'JE-' || v_seq::TEXT;

  v_descr := 'Opening balance — ' || v_bank_name || ' (' || v_coa_code || ')';

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, currency, exchange_rate,
    total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_entry_number, p_date,
    v_descr,
    'opening_bank', p_bank_account_id, 'AED', 1.0,
    p_amount, p_amount, v_user_id
  ) RETURNING id INTO v_je_id;

  IF p_direction = 'debit' THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description)
    VALUES
      (v_company_id, v_je_id, v_coa_id, v_coa_code, p_date,
       p_amount, 0, COALESCE(p_notes, v_descr));
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description)
    VALUES
      (v_company_id, v_je_id, v_ob_eq_id, '3010', p_date,
       0, p_amount, COALESCE(p_notes, v_descr));
  ELSE
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description)
    VALUES
      (v_company_id, v_je_id, v_coa_id, v_coa_code, p_date,
       0, p_amount, COALESCE(p_notes, v_descr));
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description)
    VALUES
      (v_company_id, v_je_id, v_ob_eq_id, '3010', p_date,
       p_amount, 0, COALESCE(p_notes, v_descr));
  END IF;

  -- Sync the legacy column so the bank-accounts settings page + bank
  -- reconciliation report agree with the GL. The column is informational
  -- (reports aggregate general_ledger for the real balance), but keeping
  -- both in sync prevents operator confusion.
  UPDATE public.bank_accounts
     SET opening_balance      = CASE WHEN p_direction = 'debit'
                                     THEN p_amount ELSE -p_amount END,
         opening_balance_date = p_date,
         updated_at           = NOW()
   WHERE id = p_bank_account_id;

  -- Best-effort audit.
  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'post_bank_opening_balance', 'journal_entry', v_je_id,
            jsonb_build_object(
              'bank_account_id', p_bank_account_id, 'bank_name', v_bank_name,
              'coa_code', v_coa_code, 'direction', p_direction,
              'amount', p_amount, 'date', p_date,
              'entry_number', v_entry_number));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'journal_entry_id', v_je_id,
    'entry_number',     v_entry_number,
    'bank_account_id',  p_bank_account_id,
    'bank_name',        v_bank_name,
    'account_code',     v_coa_code,
    'direction',        p_direction,
    'amount',           p_amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_bank_opening_balance(
  UUID, TEXT, NUMERIC, DATE, TEXT
) TO authenticated;

COMMENT ON FUNCTION public.post_bank_opening_balance IS
  'Phase 14.09c — posts an opening balance against a SPECIFIC bank '
  'account (resolves to bank.coa_account_id), updates the bank''s '
  'opening_balance + opening_balance_date columns, and tags the JE '
  'with source_type=''opening_bank''.';


-- ── 2. void_opening_balance ─────────────────────────────────────────────
-- Corrects a mistake on a posted opening row. Reverses the underlying JE
-- and marks the source doc void so it stops affecting open-balance lists.
-- Accepts the doc_id + a doc_type discriminator so a single client call
-- can void any of the four shapes (invoice / vendor_bill / payment /
-- pure GL JE).
CREATE OR REPLACE FUNCTION public.void_opening_balance(
  p_doc_id    UUID,
  p_doc_type  TEXT,
  p_reason    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
-- Phase 14.09c — void an opening balance row.
DECLARE
  v_company_id   UUID;
  v_user_id      UUID;
  v_je_id        UUID;
  v_was_opening  BOOLEAN := false;
  v_bank_id      UUID;
  v_rev_result   JSONB;
BEGIN
  v_user_id := auth.uid();
  IF p_doc_type NOT IN ('invoice','vendor_bill','payment','opening_gl','opening_bank') THEN
    RAISE EXCEPTION 'void_opening_balance: invalid doc_type %', p_doc_type;
  END IF;

  -- Find the source JE for this doc + verify it's an opening row before
  -- we touch anything. void_opening_balance refuses to void non-opening
  -- documents — there are dedicated void_invoice / void_payment RPCs for
  -- those, with different side-effects (stock reversal, allocation
  -- unwinding, etc.) that don't apply to opening rows.
  IF p_doc_type = 'invoice' THEN
    SELECT company_id, is_opening INTO v_company_id, v_was_opening
    FROM public.invoices WHERE id = p_doc_id;
    SELECT id INTO v_je_id FROM public.journal_entries
     WHERE source_type = 'opening_balance' AND source_id = p_doc_id;
  ELSIF p_doc_type = 'vendor_bill' THEN
    SELECT company_id, is_opening INTO v_company_id, v_was_opening
    FROM public.vendor_bills WHERE id = p_doc_id;
    SELECT id INTO v_je_id FROM public.journal_entries
     WHERE source_type = 'opening_balance' AND source_id = p_doc_id;
  ELSIF p_doc_type = 'payment' THEN
    SELECT company_id, is_opening INTO v_company_id, v_was_opening
    FROM public.payments WHERE id = p_doc_id;
    SELECT id INTO v_je_id FROM public.journal_entries
     WHERE source_type = 'opening_balance' AND source_id = p_doc_id;
  ELSIF p_doc_type = 'opening_gl' THEN
    -- For pure-GL openings the doc_id IS the JE id.
    SELECT company_id INTO v_company_id
    FROM public.journal_entries WHERE id = p_doc_id AND source_type = 'opening_gl';
    v_je_id := p_doc_id;
    v_was_opening := v_je_id IS NOT NULL;
  ELSE  -- opening_bank
    SELECT id, source_id INTO v_je_id, v_bank_id
    FROM public.journal_entries WHERE id = p_doc_id AND source_type = 'opening_bank';
    SELECT company_id INTO v_company_id
    FROM public.journal_entries WHERE id = v_je_id;
    v_was_opening := v_je_id IS NOT NULL;
  END IF;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'void_opening_balance: doc % (%) not found', p_doc_id, p_doc_type;
  END IF;
  IF NOT v_was_opening THEN
    RAISE EXCEPTION 'void_opening_balance: doc % is not an opening row — '
      'use the regular void_invoice / void_payment RPC instead', p_doc_id;
  END IF;
  IF v_je_id IS NULL THEN
    RAISE EXCEPTION 'void_opening_balance: no JE linked to doc %', p_doc_id;
  END IF;

  -- Reverse the JE (creates a mirror entry with debit/credit flipped and
  -- links them via reversed_by_id). Errors propagate (period lock, etc.).
  v_rev_result := public.reverse_journal_entry(
    v_je_id,
    COALESCE('Void opening — ' || p_reason, 'Void opening balance')
  );

  -- Mark the source doc void so it drops out of open lists.
  IF p_doc_type = 'invoice' THEN
    UPDATE public.invoices
       SET status = 'void', void_reason = p_reason, voided_at = NOW(), voided_by = v_user_id,
           updated_at = NOW()
     WHERE id = p_doc_id;
  ELSIF p_doc_type = 'vendor_bill' THEN
    UPDATE public.vendor_bills
       SET status = 'void', void_reason = p_reason, voided_at = NOW(), voided_by = v_user_id,
           updated_at = NOW()
     WHERE id = p_doc_id;
  ELSIF p_doc_type = 'payment' THEN
    UPDATE public.payments
       SET status = 'void', void_reason = p_reason, voided_at = NOW(), voided_by = v_user_id,
           updated_at = NOW()
     WHERE id = p_doc_id;
  ELSIF p_doc_type = 'opening_bank' AND v_bank_id IS NOT NULL THEN
    -- Reset the bank's legacy opening_balance column so the bank-accounts
    -- page reverts to zero (the operator can re-post a corrected entry).
    UPDATE public.bank_accounts
       SET opening_balance = 0, opening_balance_date = NULL, updated_at = NOW()
     WHERE id = v_bank_id;
  END IF;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'void_opening_balance', 'journal_entry', v_je_id,
            jsonb_build_object('doc_type', p_doc_type, 'doc_id', p_doc_id,
                               'reason', p_reason, 'reversal', v_rev_result));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'doc_id',           p_doc_id,
    'doc_type',         p_doc_type,
    'journal_entry_id', v_je_id,
    'reversal',         v_rev_result
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.void_opening_balance(UUID, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.void_opening_balance IS
  'Phase 14.09c — voids one opening-balance row by reversing its JE and '
  'marking the source doc void. Refuses to void non-opening documents '
  '(those have their own void_* RPCs with stock/allocation side-effects).';

NOTIFY pgrst, 'reload schema';
