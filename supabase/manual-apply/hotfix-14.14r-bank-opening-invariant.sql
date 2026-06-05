-- ═══════════════════════════════════════════════════════════════════════════
-- StockBolt — Phase 14.14r hotfix
-- Fix: bank_accounts.opening_balance mirror invariant.
--
-- Why: two bugs in the existing opening-bank flow:
--
--   1. post_bank_opening_balance allowed a second active opening JE for
--      the same bank. Operator could forget they already posted and re-
--      post — creating a stacked-openings scenario.
--
--   2. void_opening_balance unconditionally set bank_accounts.opening_balance
--      to 0 when voiding an opening_bank JE. If a second active opening
--      existed (from #1), the mirror column zeroed while the GL still
--      carried the other JE. Silent data corruption.
--
-- Both halves of the fix are applied below — defense in depth.
--
-- HOW TO RUN
-- ──────────
-- Supabase Dashboard → SQL Editor → New query → paste this → Run.
-- "Success. No rows returned." → done. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 14.14r — bank_accounts.opening_balance mirror invariant
-- ─────────────────────────────────────────────────────────────────────────
-- Audit item B.1 (HIGH). The bank_accounts.opening_balance column is a
-- legacy mirror of the posted opening JE — set by post_bank_opening_balance
-- and read by the bank-accounts settings UI and the bank-reconciliation
-- report. Phase 14.14h locked the column from manual edits in the front
-- end, but two scenarios still allowed it to drift from the GL:
--
--   1. Operator posts opening AED 250,000 for ADCB → JE-1 active,
--      bank_accounts.opening_balance = 250,000.
--   2. Operator posts ANOTHER opening for the same ADCB (e.g. they
--      forgot they already did it; nothing currently stops them).
--      → JE-2 also active. Column = 250,000 (last write wins via the
--      post RPC's UPDATE). GL has BOTH JEs = 500,000.
--   3. Operator voids JE-2.
--      → void_opening_balance unconditionally sets opening_balance = 0.
--      Column = 0. GL still has JE-1 = 250,000. MIRROR DRIFT.
--
-- Fix has two halves — defense in depth:
--
--   (a) post_bank_opening_balance refuses to post if an ACTIVE
--       opening_bank JE already exists for the bank. (Active =
--       reversed_by_id IS NULL AND reversal_of_id IS NULL.) An edit
--       must go through the Phase 14.14n void+repost RPC, which sets
--       the original's reversed_by_id before re-posting so this check
--       correctly allows it.
--
--   (b) void_opening_balance recomputes the column from the remaining
--       ACTIVE opening JEs for the bank instead of zeroing. After the
--       reverse_journal_entry call above marks the voided JE with
--       reversed_by_id IS NOT NULL, the lookup excludes it; any
--       OTHER still-active opening JE for the same bank keeps the
--       column accurate.
--
-- With (a) in place, scenario 2 is blocked at the source — the operator
-- gets a clear error and uses the Edit modal instead. With (b) in place,
-- even if a duplicate somehow slipped through (e.g. a previous DB state
-- with two active openings on the same bank), the void path no longer
-- corrupts the mirror.
-- ─────────────────────────────────────────────────────────────────────────


-- ── (a) post_bank_opening_balance — refuse duplicate active openings ──
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
  v_currency      TEXT;
BEGIN
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

  -- Phase 14.14r — refuse if an active opening already exists for this bank.
  -- "Active" = the canonical posting JE (reversed_by_id IS NULL) that is
  -- not itself a reversal (reversal_of_id IS NULL). The Phase 14.14n
  -- edit_opening_balance flow voids the original BEFORE calling this RPC,
  -- so reversed_by_id IS NOT NULL on the prior JE — the check passes for
  -- legitimate edits but blocks the "I forgot I already posted" mistake.
  IF EXISTS (
    SELECT 1 FROM public.journal_entries
    WHERE source_type = 'opening_bank'
      AND source_id   = p_bank_account_id
      AND reversed_by_id IS NULL
      AND reversal_of_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'A bank opening balance already exists for "%". Void or edit the '
      'existing one from Settings → Opening Balances instead of posting '
      'a second one.', v_bank_name
      USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_ob_eq_id FROM public.chart_of_accounts
   WHERE company_id = v_company_id AND code = '3010';
  IF v_ob_eq_id IS NULL THEN
    RAISE EXCEPTION '3010 Opening Balance Equity not seeded for this company';
  END IF;

  SELECT COALESCE(NULLIF(currency, ''), NULLIF(base_currency, ''), 'AED')
    INTO v_currency
  FROM public.companies WHERE id = v_company_id;

  INSERT INTO public.document_sequences
    (company_id, prefix, current_value, format)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}')
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
    'opening_bank', p_bank_account_id, v_currency, 1.0,
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

  UPDATE public.bank_accounts
     SET opening_balance      = CASE WHEN p_direction = 'debit'
                                     THEN p_amount ELSE -p_amount END,
         opening_balance_date = p_date,
         updated_at           = NOW()
   WHERE id = p_bank_account_id;

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


-- ── (b) void_opening_balance — recompute mirror from remaining active JEs ──
CREATE OR REPLACE FUNCTION public.void_opening_balance(
  p_doc_id    UUID,
  p_doc_type  TEXT,
  p_reason    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_company_id   UUID;
  v_user_id      UUID;
  v_je_id        UUID;
  v_was_opening  BOOLEAN := false;
  v_bank_id      UUID;
  v_rev_result   JSONB;
  v_bank_coa     UUID;       -- Phase 14.14r — used for mirror recompute
  v_new_balance  NUMERIC;    -- Phase 14.14r — recomputed mirror value
  v_new_date     DATE;       -- Phase 14.14r — earliest remaining JE date
BEGIN
  v_user_id := auth.uid();
  IF p_doc_type NOT IN ('invoice','vendor_bill','payment','opening_gl','opening_bank') THEN
    RAISE EXCEPTION 'void_opening_balance: invalid doc_type %', p_doc_type;
  END IF;

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

  v_rev_result := public.reverse_journal_entry(
    v_je_id,
    COALESCE('Void opening — ' || p_reason, 'Void opening balance')
  );

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
    -- Phase 14.14r — recompute the mirror from remaining active opening_bank
    -- JEs for this bank instead of zeroing unconditionally. After the
    -- reverse_journal_entry above, the JE we just voided has
    -- reversed_by_id IS NOT NULL, so it's excluded from this aggregation.
    -- The post-RPC's duplicate-active guard means there should be at
    -- most ONE remaining row, but the SUM handles legacy duplicates
    -- defensively.
    SELECT coa_account_id INTO v_bank_coa
    FROM public.bank_accounts WHERE id = v_bank_id;

    SELECT
      COALESCE(SUM(CASE WHEN gl.debit > 0 THEN gl.debit ELSE -gl.credit END), 0),
      MIN(je.date)
      INTO v_new_balance, v_new_date
    FROM public.journal_entries je
    JOIN public.general_ledger gl ON gl.journal_entry_id = je.id
    WHERE je.source_type     = 'opening_bank'
      AND je.source_id       = v_bank_id
      AND je.reversed_by_id IS NULL
      AND je.reversal_of_id IS NULL
      AND gl.account_id      = v_bank_coa;

    UPDATE public.bank_accounts
       SET opening_balance      = v_new_balance,
           opening_balance_date = CASE WHEN v_new_balance = 0 THEN NULL ELSE v_new_date END,
           updated_at           = NOW()
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


COMMENT ON FUNCTION public.post_bank_opening_balance IS
  'Phase 14.14r — refuses to post if an active opening_bank JE already '
  'exists for the bank. Edit via void+repost (edit_opening_balance, 14.14n) '
  'still works because the void marks the prior JE reversed_by_id IS NOT '
  'NULL before the repost executes.';

COMMENT ON FUNCTION public.void_opening_balance IS
  'Phase 14.14r — bank-opening void now recomputes bank_accounts.opening_balance '
  'from remaining ACTIVE opening_bank JEs for the bank, rather than '
  'unconditionally zeroing. Prevents mirror drift when (historic) duplicate '
  'opening JEs exist on the same bank.';


NOTIFY pgrst, 'reload schema';
