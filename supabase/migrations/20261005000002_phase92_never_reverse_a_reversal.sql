-- ===========================================================================
-- phase92 - a reversal is never itself reversed
--
-- THE BUG
-- Editing a credit note twice inflated the customer's credit by the value of
-- the note. Pro_Parts CN-1004 was edited, refunded, then edited again, and
-- JUMA ARIF's receivable ended up showing a 131.25 credit the customer had
-- already been paid.
--
-- reopen_credit_note picks the journal entries to reverse with:
--
--     WHERE company_id = ... AND source_id = ... AND reversed_by_id IS NULL
--
-- That excludes entries already reversed, but NOT entries that ARE reversals.
-- On a second reopen the set therefore contains the first reopen's own
-- reversal, and reversing a reversal RE-APPLIES the original credit.
--
-- Proven, not inferred: JE-1114 reverses JE-1113 (correct) and JE-1115
-- reverses JE-1112 (a reversal) - both written in the same transaction, at
-- the same timestamp. CN-1004's entries net +262.50 of credit where they
-- should net +131.25.
--
-- The stock loop in the same function has the guard. The GL loop did not.
--
-- SCOPE - TEN FUNCTIONS, NOT ONE
-- The same clause was missing everywhere a document's entries are reversed by
-- source_id. The voids are exposed too: after any reopen cycle an un-reversed
-- reversal is sitting there for a later void to pick up.
--
--   reopen_credit_note   reopen_debit_note   reopen_expense
--   reopen_bank_transfer void_credit_note    void_debit_note
--   void_invoice         void_expense        void_bank_transfer
--
-- void_payment is a different shape and is patched separately below: its
-- COUNT(*) guard was unguarded while the fetch beneath it was already
-- correct, so a stale reversal made it refuse a legitimate void with
-- "multiple advance applications". Not a double-post, but still wrong.
--
-- NOT FIXED HERE, flagged deliberately: edit_vendor_bill, void_opening_balance
-- and void_opening_stock select on a different shape (source_type rather than
-- a plain source_id sweep). They need reading individually rather than a
-- mechanical clause, and none of them has fired.
--
-- HOW THESE BODIES WERE PRODUCED
-- Every function below was read from the LIVE database with
-- pg_get_functiondef and changed in exactly one place:
--
--     reversed_by_id IS NULL
--  -> reversed_by_id IS NULL AND reversal_of_id IS NULL
--
-- A generator did the substitution and refused any function where the clause
-- appeared more than once, so nothing was blind-replaced. Each body is
-- otherwise byte-identical to what is running now.
--
-- SAFE TO APPLY: ten CREATE OR REPLACE statements plus one correcting journal
-- entry. No schema change. The data fix is idempotent - it refuses to run
-- twice - and is dated at the original entry's date per phase43.
-- ===========================================================================

BEGIN;

-- ── reopen_credit_note ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reopen_credit_note(p_credit_note_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_cn         public.credit_notes%ROWTYPE;
  v_lock_date  DATE;
  v_je         public.journal_entries%ROWTYPE;
  v_gl         public.general_ledger%ROWTYPE;
  v_sl         public.stock_ledger%ROWTYPE;
  v_rev_id     UUID;
  v_rev_entry  TEXT;
  v_seq        BIGINT;
  v_prev_running NUMERIC(15,3);
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'reopen_credit_note: no company for user'; END IF;

  SELECT * INTO v_cn FROM public.credit_notes WHERE id = p_credit_note_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'reopen_credit_note: credit note % not found', p_credit_note_id; END IF;
  IF v_cn.status <> 'confirmed' THEN RAISE EXCEPTION 'reopen_credit_note: not confirmed (status=%)', v_cn.status; END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_cn.date <= v_lock_date THEN
    RAISE EXCEPTION 'reopen_credit_note: voucher date % on or before period lock %', v_cn.date, v_lock_date;
  END IF;

  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id AND source_id = p_credit_note_id AND reversed_by_id IS NULL AND reversal_of_id IS NULL
      AND source_type IN ('sales_credit_note', 'inventory_cogs')
  LOOP
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
    RETURNING current_value INTO v_seq;
    v_rev_entry := 'JE-' || v_seq::TEXT;
    IF v_lock_date IS NOT NULL AND v_je.date <= v_lock_date THEN
      RAISE EXCEPTION 'Cannot reverse: the original posting dated % is in a locked period (lock %).', v_je.date, v_lock_date;
    END IF;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description, source_type, source_id,
      currency, exchange_rate, total_debit, total_credit, reversal_of_id, created_by
    ) VALUES (
      v_company_id, v_rev_entry, v_je.date, 'Reopen – ' || v_cn.credit_note_number,
      v_je.source_type, p_credit_note_id, v_je.currency, v_je.exchange_rate,
      v_je.total_credit, v_je.total_debit, v_je.id, v_user_id
    ) RETURNING id INTO v_rev_id;

    FOR v_gl IN SELECT * FROM public.general_ledger WHERE journal_entry_id = v_je.id LOOP
      INSERT INTO public.general_ledger (
        company_id, journal_entry_id, account_id, account_code, date, debit, credit,
        description, contact_id, related_doc_type, related_doc_id, reversal_of_id
      ) VALUES (
        v_company_id, v_rev_id, v_gl.account_id, v_gl.account_code, v_gl.date, v_gl.credit, v_gl.debit,
        'Reopen – ' || v_cn.credit_note_number, v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
      );
    END LOOP;

    UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
  END LOOP;

  FOR v_sl IN
    SELECT * FROM public.stock_ledger
    WHERE company_id = v_company_id AND related_doc_id = p_credit_note_id
      AND related_doc_type = 'credit_note' AND reversal_of_id IS NULL
  LOOP
    SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_running
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_sl.product_id AND warehouse_id = v_sl.warehouse_id
    ORDER BY seq DESC LIMIT 1;

    INSERT INTO public.stock_ledger (
      company_id, product_id, warehouse_id, date, type, direction, quantity, unit_cost, total_cost,
      running_qty, running_avg_cost, related_doc_type, related_doc_id, reversal_of_id
    ) VALUES (
      v_company_id, v_sl.product_id, v_sl.warehouse_id, v_sl.date,
      'void', -v_sl.direction, v_sl.quantity, v_sl.unit_cost, v_sl.total_cost,
      v_prev_running + v_sl.quantity * (-v_sl.direction), v_sl.running_avg_cost,
      'credit_note', p_credit_note_id, v_sl.id
    );
  END LOOP;

  UPDATE public.credit_notes SET status = 'draft', updated_at = NOW() WHERE id = p_credit_note_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'reopen', 'credit_note', p_credit_note_id,
      jsonb_build_object('credit_note_number', v_cn.credit_note_number));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('credit_note_id', p_credit_note_id, 'status', 'draft');
END;
$function$
;

-- ── reopen_debit_note ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reopen_debit_note(p_debit_note_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_dn         public.debit_notes%ROWTYPE;
  v_lock_date  DATE;
  v_je         public.journal_entries%ROWTYPE;
  v_gl         public.general_ledger%ROWTYPE;
  v_sl         public.stock_ledger%ROWTYPE;
  v_rev_id     UUID;
  v_rev_entry  TEXT;
  v_seq        BIGINT;
  v_prev_running NUMERIC(15,3);
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'reopen_debit_note: no company for user'; END IF;

  SELECT * INTO v_dn FROM public.debit_notes WHERE id = p_debit_note_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'reopen_debit_note: debit note % not found', p_debit_note_id; END IF;
  IF v_dn.status <> 'confirmed' THEN RAISE EXCEPTION 'reopen_debit_note: not confirmed (status=%)', v_dn.status; END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_dn.date <= v_lock_date THEN
    RAISE EXCEPTION 'reopen_debit_note: voucher date % on or before period lock %', v_dn.date, v_lock_date;
  END IF;

  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id AND source_id = p_debit_note_id AND reversed_by_id IS NULL AND reversal_of_id IS NULL
      AND source_type = 'vendor_debit_note'
  LOOP
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
    RETURNING current_value INTO v_seq;
    v_rev_entry := 'JE-' || v_seq::TEXT;
    IF v_lock_date IS NOT NULL AND v_je.date <= v_lock_date THEN
      RAISE EXCEPTION 'Cannot reverse: the original posting dated % is in a locked period (lock %).', v_je.date, v_lock_date;
    END IF;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description, source_type, source_id,
      currency, exchange_rate, total_debit, total_credit, reversal_of_id, created_by
    ) VALUES (
      v_company_id, v_rev_entry, v_je.date, 'Reopen – ' || v_dn.debit_note_number,
      v_je.source_type, p_debit_note_id, v_je.currency, v_je.exchange_rate,
      v_je.total_credit, v_je.total_debit, v_je.id, v_user_id
    ) RETURNING id INTO v_rev_id;

    FOR v_gl IN SELECT * FROM public.general_ledger WHERE journal_entry_id = v_je.id LOOP
      INSERT INTO public.general_ledger (
        company_id, journal_entry_id, account_id, account_code, date, debit, credit,
        description, contact_id, related_doc_type, related_doc_id, reversal_of_id
      ) VALUES (
        v_company_id, v_rev_id, v_gl.account_id, v_gl.account_code, v_gl.date, v_gl.credit, v_gl.debit,
        'Reopen – ' || v_dn.debit_note_number, v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
      );
    END LOOP;

    UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
  END LOOP;

  FOR v_sl IN
    SELECT * FROM public.stock_ledger
    WHERE company_id = v_company_id AND related_doc_id = p_debit_note_id
      AND related_doc_type = 'debit_note' AND reversal_of_id IS NULL
  LOOP
    SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_running
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_sl.product_id AND warehouse_id = v_sl.warehouse_id
    ORDER BY seq DESC LIMIT 1;

    INSERT INTO public.stock_ledger (
      company_id, product_id, warehouse_id, date, type, direction, quantity, unit_cost, total_cost,
      running_qty, running_avg_cost, related_doc_type, related_doc_id, reversal_of_id
    ) VALUES (
      v_company_id, v_sl.product_id, v_sl.warehouse_id, v_sl.date,
      'void', -v_sl.direction, v_sl.quantity, v_sl.unit_cost, v_sl.total_cost,
      v_prev_running + v_sl.quantity * (-v_sl.direction), v_sl.running_avg_cost,
      'debit_note', p_debit_note_id, v_sl.id
    );
  END LOOP;

  UPDATE public.debit_notes SET status = 'draft', updated_at = NOW() WHERE id = p_debit_note_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'reopen', 'debit_note', p_debit_note_id,
      jsonb_build_object('debit_note_number', v_dn.debit_note_number));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('debit_note_id', p_debit_note_id, 'status', 'draft');
END;
$function$
;

-- ── reopen_expense ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reopen_expense(p_expense_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id UUID := auth.uid(); v_company_id UUID; v_expense public.expenses%ROWTYPE;
  v_lock_date DATE; v_je RECORD; v_rev_je_id UUID; v_rev_je_num TEXT; v_total NUMERIC;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'reopen_expense: no company for user %', v_user_id; END IF;

  SELECT * INTO v_expense FROM public.expenses WHERE id = p_expense_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'reopen_expense: expense % not found', p_expense_id; END IF;
  IF v_expense.status <> 'confirmed' THEN
    RAISE EXCEPTION 'reopen_expense: only confirmed expenses can be reopened (status=%)', v_expense.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_expense.date <= v_lock_date THEN
    RAISE EXCEPTION 'reopen_expense: posting date % is in a locked period', v_expense.date;
  END IF;

  -- Find the live posting JE for this expense.
  SELECT * INTO v_je FROM public.journal_entries
   WHERE source_type = 'expense' AND source_id = p_expense_id AND company_id = v_company_id AND reversed_by_id IS NULL AND reversal_of_id IS NULL
   ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'reopen_expense: no live JE found for expense %', p_expense_id; END IF;

  SELECT COALESCE(SUM(debit), 0) INTO v_total FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  -- Allocate a reversal JE number.
  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1000, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'JE-' || current_value::TEXT INTO v_rev_je_num FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'JE';

  -- Post the mirror-image reversal.
  INSERT INTO public.journal_entries
    (company_id, entry_number, date, source_type, source_id, description, total_debit, total_credit, created_by, reversal_of_id)
  VALUES
    (v_company_id, v_rev_je_num, v_je.date, 'expense', p_expense_id,
     'REOPEN: ' || COALESCE(v_expense.expense_number, 'Expense'), v_total, v_total, v_user_id, v_je.id)
  RETURNING id INTO v_rev_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id, reversal_of_id)
  SELECT v_company_id, v_rev_je_id, account_id, account_code, date, credit, debit, 'REOPEN: ' || description, contact_id, related_doc_type, related_doc_id, id
    FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  UPDATE public.journal_entries SET reversed_by_id = v_rev_je_id WHERE id = v_je.id;

  -- Flip the expense back to draft (clearing any void fields).
  UPDATE public.expenses
     SET status = 'draft', void_reason = NULL, voided_at = NULL, voided_by = NULL, updated_at = NOW()
   WHERE id = p_expense_id;

  INSERT INTO public.audit_logs (company_id, entity_type, entity_id, action, user_id, new_data)
  VALUES (v_company_id, 'expenses', p_expense_id, 'update', v_user_id,
          jsonb_build_object('reopened', true, 'reversal_je_id', v_rev_je_id));

  RETURN jsonb_build_object('expense_id', p_expense_id, 'reversal_je_id', v_rev_je_id);
END;
$function$
;

-- ── reopen_bank_transfer ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reopen_bank_transfer(p_transfer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id UUID := auth.uid(); v_company_id UUID; v_transfer public.bank_transfers%ROWTYPE;
  v_lock_date DATE; v_je RECORD; v_rev_je_id UUID; v_rev_je_num TEXT; v_total NUMERIC;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'reopen_bank_transfer: no company for user %', v_user_id; END IF;
  SELECT * INTO v_transfer FROM public.bank_transfers WHERE id = p_transfer_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'reopen_bank_transfer: transfer % not found', p_transfer_id; END IF;
  IF v_transfer.status <> 'confirmed' THEN RAISE EXCEPTION 'reopen_bank_transfer: only confirmed transfers can be reopened (status=%)', v_transfer.status; END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_transfer.date <= v_lock_date THEN RAISE EXCEPTION 'reopen_bank_transfer: posting date % is in a locked period', v_transfer.date; END IF;

  SELECT * INTO v_je FROM public.journal_entries
   WHERE source_type = 'bank_transfer' AND source_id = p_transfer_id AND company_id = v_company_id AND reversed_by_id IS NULL AND reversal_of_id IS NULL
   ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'reopen_bank_transfer: no live JE found for transfer %', p_transfer_id; END IF;

  SELECT COALESCE(SUM(debit), 0) INTO v_total FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1000, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'JE-' || current_value::TEXT INTO v_rev_je_num FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'JE';

  INSERT INTO public.journal_entries
    (company_id, entry_number, date, source_type, source_id, description, total_debit, total_credit, created_by, reversal_of_id)
  VALUES
    (v_company_id, v_rev_je_num, v_je.date, 'bank_transfer', p_transfer_id,
     'REOPEN: Bank Transfer ' || v_transfer.transfer_number, v_total, v_total, v_user_id, v_je.id)
  RETURNING id INTO v_rev_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id, reversal_of_id)
  SELECT v_company_id, v_rev_je_id, account_id, account_code, date, credit, debit, 'REOPEN: ' || description, contact_id, related_doc_type, related_doc_id, id
    FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  UPDATE public.journal_entries SET reversed_by_id = v_rev_je_id WHERE id = v_je.id;
  UPDATE public.bank_transfers SET status = 'draft', updated_at = NOW() WHERE id = p_transfer_id;

  INSERT INTO public.audit_logs (company_id, entity_type, entity_id, action, user_id, new_data)
  VALUES (v_company_id, 'bank_transfers', p_transfer_id, 'update', v_user_id,
          jsonb_build_object('reopened', true, 'reversal_je_id', v_rev_je_id));

  RETURN jsonb_build_object('transfer_id', p_transfer_id, 'reversal_je_id', v_rev_je_id);
END; $function$
;

-- ── void_credit_note ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.void_credit_note(p_credit_note_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_cn         public.credit_notes%ROWTYPE;
  v_lock_date  DATE;
  v_je         public.journal_entries%ROWTYPE;
  v_gl         public.general_ledger%ROWTYPE;
  v_sl         public.stock_ledger%ROWTYPE;
  v_rev_id     UUID;
  v_rev_entry  TEXT;
  v_seq        BIGINT;
  v_prev_running NUMERIC(15,3);
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'void_credit_note: no company for user';
  END IF;

  SELECT * INTO v_cn FROM public.credit_notes WHERE id = p_credit_note_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'void_credit_note: credit note % not found', p_credit_note_id;
  END IF;
  IF v_cn.status <> 'confirmed' THEN
    RAISE EXCEPTION 'void_credit_note: not confirmed (status=%)', v_cn.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_cn.date <= v_lock_date THEN
    RAISE EXCEPTION 'void_credit_note: voucher date % on or before period lock %', v_cn.date, v_lock_date;
  END IF;

  -- Reverse all unreversed JEs linked to this credit note
  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id
      AND source_id = p_credit_note_id
      AND reversed_by_id IS NULL AND reversal_of_id IS NULL
      AND source_type IN ('sales_credit_note', 'inventory_cogs')
  LOOP
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE
      SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
    RETURNING current_value INTO v_seq;
    v_rev_entry := 'JE-' || v_seq::TEXT;
    IF v_lock_date IS NOT NULL AND v_je.date <= v_lock_date THEN
      RAISE EXCEPTION 'Cannot reverse: the original posting dated % is in a locked period (lock %).', v_je.date, v_lock_date;
    END IF;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description,
      source_type, source_id, currency, exchange_rate,
      total_debit, total_credit, reversal_of_id, created_by
    ) VALUES (
      v_company_id, v_rev_entry, v_je.date,
      COALESCE(p_reason, 'Void – ' || v_cn.credit_note_number),
      v_je.source_type, p_credit_note_id,
      v_je.currency, v_je.exchange_rate,
      v_je.total_credit, v_je.total_debit,
      v_je.id, v_user_id
    ) RETURNING id INTO v_rev_id;

    FOR v_gl IN SELECT * FROM public.general_ledger WHERE journal_entry_id = v_je.id LOOP
      INSERT INTO public.general_ledger (
        company_id, journal_entry_id, account_id, account_code, date,
        debit, credit, description,
        contact_id, related_doc_type, related_doc_id, reversal_of_id
      ) VALUES (
        v_company_id, v_rev_id, v_gl.account_id, v_gl.account_code, v_gl.date,
        v_gl.credit, v_gl.debit,
        COALESCE(p_reason, 'Void – ' || v_cn.credit_note_number),
        v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
      );
    END LOOP;

    UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
  END LOOP;

  -- Reverse stock_ledger rows
  FOR v_sl IN
    SELECT * FROM public.stock_ledger
    WHERE company_id = v_company_id
      AND related_doc_id = p_credit_note_id
      AND related_doc_type = 'credit_note'
      AND reversal_of_id IS NULL
  LOOP
    SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_running
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_sl.product_id AND warehouse_id = v_sl.warehouse_id
    ORDER BY seq DESC LIMIT 1;

    INSERT INTO public.stock_ledger (
      company_id, product_id, warehouse_id, date,
      type, direction, quantity, unit_cost, total_cost,
      running_qty, running_avg_cost,
      related_doc_type, related_doc_id, reversal_of_id
    ) VALUES (
      v_company_id, v_sl.product_id, v_sl.warehouse_id, v_sl.date,
      'void', -v_sl.direction, v_sl.quantity, v_sl.unit_cost, v_sl.total_cost,
      v_prev_running + v_sl.quantity * (-v_sl.direction),
      v_sl.running_avg_cost,
      'credit_note', p_credit_note_id, v_sl.id
    );
  END LOOP;

  UPDATE public.credit_notes
  SET status = 'void', updated_at = NOW()
  WHERE id = p_credit_note_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'void', 'credit_note', p_credit_note_id,
      jsonb_build_object('credit_note_number', v_cn.credit_note_number, 'reason', p_reason));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('credit_note_id', p_credit_note_id, 'credit_note_number', v_cn.credit_note_number);
END;
$function$
;

-- ── void_debit_note ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.void_debit_note(p_debit_note_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_dn         public.debit_notes%ROWTYPE;
  v_lock_date  DATE;
  v_je         public.journal_entries%ROWTYPE;
  v_gl         public.general_ledger%ROWTYPE;
  v_sl         public.stock_ledger%ROWTYPE;
  v_rev_id     UUID;
  v_rev_entry  TEXT;
  v_seq        BIGINT;
  v_prev_running NUMERIC(15,3);
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'void_debit_note: no company for user';
  END IF;

  SELECT * INTO v_dn FROM public.debit_notes WHERE id = p_debit_note_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'void_debit_note: debit note % not found', p_debit_note_id;
  END IF;
  IF v_dn.status <> 'confirmed' THEN
    RAISE EXCEPTION 'void_debit_note: not confirmed (status=%)', v_dn.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_dn.date <= v_lock_date THEN
    RAISE EXCEPTION 'void_debit_note: voucher date % on or before period lock %', v_dn.date, v_lock_date;
  END IF;

  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id
      AND source_id = p_debit_note_id
      AND reversed_by_id IS NULL AND reversal_of_id IS NULL
      AND source_type = 'vendor_debit_note'
  LOOP
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE
      SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
    RETURNING current_value INTO v_seq;
    v_rev_entry := 'JE-' || v_seq::TEXT;
    IF v_lock_date IS NOT NULL AND v_je.date <= v_lock_date THEN
      RAISE EXCEPTION 'Cannot reverse: the original posting dated % is in a locked period (lock %).', v_je.date, v_lock_date;
    END IF;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description,
      source_type, source_id, currency, exchange_rate,
      total_debit, total_credit, reversal_of_id, created_by
    ) VALUES (
      v_company_id, v_rev_entry, v_je.date,
      COALESCE(p_reason, 'Void – ' || v_dn.debit_note_number),
      v_je.source_type, p_debit_note_id,
      v_je.currency, v_je.exchange_rate,
      v_je.total_credit, v_je.total_debit,
      v_je.id, v_user_id
    ) RETURNING id INTO v_rev_id;

    FOR v_gl IN SELECT * FROM public.general_ledger WHERE journal_entry_id = v_je.id LOOP
      INSERT INTO public.general_ledger (
        company_id, journal_entry_id, account_id, account_code, date,
        debit, credit, description,
        contact_id, related_doc_type, related_doc_id, reversal_of_id
      ) VALUES (
        v_company_id, v_rev_id, v_gl.account_id, v_gl.account_code, v_gl.date,
        v_gl.credit, v_gl.debit,
        COALESCE(p_reason, 'Void – ' || v_dn.debit_note_number),
        v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
      );
    END LOOP;

    UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
  END LOOP;

  -- Reverse stock_ledger rows
  FOR v_sl IN
    SELECT * FROM public.stock_ledger
    WHERE company_id = v_company_id
      AND related_doc_id = p_debit_note_id
      AND related_doc_type = 'debit_note'
      AND reversal_of_id IS NULL
  LOOP
    SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_running
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_sl.product_id AND warehouse_id = v_sl.warehouse_id
    ORDER BY seq DESC LIMIT 1;

    INSERT INTO public.stock_ledger (
      company_id, product_id, warehouse_id, date,
      type, direction, quantity, unit_cost, total_cost,
      running_qty, running_avg_cost,
      related_doc_type, related_doc_id, reversal_of_id
    ) VALUES (
      v_company_id, v_sl.product_id, v_sl.warehouse_id, v_sl.date,
      'void', -v_sl.direction, v_sl.quantity, v_sl.unit_cost, v_sl.total_cost,
      v_prev_running + v_sl.quantity * (-v_sl.direction),
      v_sl.running_avg_cost,
      'debit_note', p_debit_note_id, v_sl.id
    );
  END LOOP;

  UPDATE public.debit_notes
  SET status = 'void', updated_at = NOW()
  WHERE id = p_debit_note_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'void', 'debit_note', p_debit_note_id,
      jsonb_build_object('debit_note_number', v_dn.debit_note_number, 'reason', p_reason));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('debit_note_id', p_debit_note_id, 'debit_note_number', v_dn.debit_note_number);
END;
$function$
;

-- ── void_invoice ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.void_invoice(p_invoice_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_inv        public.invoices%ROWTYPE;
  v_lock_date  DATE;
  v_je         public.journal_entries%ROWTYPE;
  v_gl         public.general_ledger%ROWTYPE;
  v_sl         public.stock_ledger%ROWTYPE;
  v_rev_id     UUID;
  v_rev_entry  TEXT;
  v_seq        BIGINT;
  v_prev_running NUMERIC(15,3);
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'void_invoice: no company for user';
  END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'void_invoice: invoice % not found', p_invoice_id;
  END IF;
  IF v_inv.status <> 'confirmed' THEN
    RAISE EXCEPTION 'void_invoice: invoice % not confirmed (status=%)', p_invoice_id, v_inv.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_inv.date <= v_lock_date THEN
    RAISE EXCEPTION 'void_invoice: voucher date % on or before period lock %', v_inv.date, v_lock_date;
  END IF;

  -- Reverse all unreversed JEs linked to this invoice
  -- Covers: sales_invoice, inventory_cogs, advance_application
  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id
      AND source_id = p_invoice_id
      AND reversed_by_id IS NULL AND reversal_of_id IS NULL
      AND source_type IN ('sales_invoice','inventory_cogs','advance_application')
  LOOP
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE
      SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
    RETURNING current_value INTO v_seq;
    v_rev_entry := 'JE-' || v_seq::TEXT;
    IF v_lock_date IS NOT NULL AND v_je.date <= v_lock_date THEN
      RAISE EXCEPTION 'Cannot reverse: the original posting dated % is in a locked period (lock %).', v_je.date, v_lock_date;
    END IF;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description,
      source_type, source_id, currency, exchange_rate,
      total_debit, total_credit, reversal_of_id, created_by
    ) VALUES (
      v_company_id, v_rev_entry, v_je.date,
      COALESCE(p_reason, 'Void – ' || v_inv.invoice_number),
      v_je.source_type, p_invoice_id,
      v_je.currency, v_je.exchange_rate,
      v_je.total_credit, v_je.total_debit,
      v_je.id, v_user_id
    ) RETURNING id INTO v_rev_id;

    FOR v_gl IN SELECT * FROM public.general_ledger WHERE journal_entry_id = v_je.id LOOP
      INSERT INTO public.general_ledger (
        company_id, journal_entry_id, account_id, account_code, date,
        debit, credit, description,
        contact_id, related_doc_type, related_doc_id, reversal_of_id
      ) VALUES (
        v_company_id, v_rev_id, v_gl.account_id, v_gl.account_code, v_gl.date,
        v_gl.credit, v_gl.debit,
        COALESCE(p_reason, 'Void – ' || v_inv.invoice_number),
        v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
      );
    END LOOP;

    UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
  END LOOP;

  -- Reverse stock_ledger rows
  FOR v_sl IN
    SELECT * FROM public.stock_ledger
    WHERE company_id = v_company_id
      AND related_doc_id = p_invoice_id
      AND related_doc_type = 'invoice'
      AND reversal_of_id IS NULL
  LOOP
    SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_running
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_sl.product_id AND warehouse_id = v_sl.warehouse_id
    ORDER BY seq DESC LIMIT 1;

    INSERT INTO public.stock_ledger (
      company_id, product_id, warehouse_id, date,
      type, direction, quantity, unit_cost, total_cost,
      running_qty, running_avg_cost,
      related_doc_type, related_doc_id, reversal_of_id
    ) VALUES (
      v_company_id, v_sl.product_id, v_sl.warehouse_id, v_sl.date,
      'void', -v_sl.direction, v_sl.quantity, v_sl.unit_cost, v_sl.total_cost,
      v_prev_running + v_sl.quantity * (-v_sl.direction),
      v_sl.running_avg_cost,
      'invoice', p_invoice_id, v_sl.id
    );
  END LOOP;

  -- Cancel pending deferred COGS
  UPDATE public.deferred_cogs_queue
  SET status = 'cancelled', updated_at = NOW()
  WHERE sale_invoice_id = p_invoice_id AND status = 'pending';

  -- Void invoice
  UPDATE public.invoices
  SET status = 'void', void_reason = p_reason,
      voided_at = NOW(), voided_by = v_user_id, updated_at = NOW()
  WHERE id = p_invoice_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'void', 'invoice', p_invoice_id,
      jsonb_build_object('invoice_number', v_inv.invoice_number, 'reason', p_reason));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'invoice_number', v_inv.invoice_number);
END;
$function$
;

-- ── void_expense ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.void_expense(p_expense_id uuid, p_void_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id UUID := auth.uid(); v_company_id UUID; v_expense public.expenses%ROWTYPE;
  v_lock_date DATE; v_je RECORD; v_rev_je_id UUID; v_rev_je_num TEXT; v_total NUMERIC;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'void_expense: no company for user %', v_user_id; END IF;
  SELECT * INTO v_expense FROM public.expenses WHERE id = p_expense_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'void_expense: expense % not found', p_expense_id; END IF;
  IF v_expense.status <> 'confirmed' THEN RAISE EXCEPTION 'void_expense: only confirmed expenses can be voided (status=%)', v_expense.status; END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_expense.date <= v_lock_date THEN RAISE EXCEPTION 'void_expense: posting date % is in a locked period', v_expense.date; END IF;

  SELECT * INTO v_je FROM public.journal_entries
   WHERE source_type = 'expense' AND source_id = p_expense_id AND company_id = v_company_id AND reversed_by_id IS NULL AND reversal_of_id IS NULL
   ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'void_expense: no live JE found for expense %', p_expense_id; END IF;

  SELECT COALESCE(SUM(debit), 0) INTO v_total FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1000, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'JE-' || current_value::TEXT INTO v_rev_je_num FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'JE';

  INSERT INTO public.journal_entries
    (company_id, entry_number, date, source_type, source_id, description, total_debit, total_credit, created_by, reversal_of_id)
  VALUES
    (v_company_id, v_rev_je_num, v_je.date, 'expense', p_expense_id,
     'VOID: ' || COALESCE(p_void_reason, 'Expense Void'), v_total, v_total, v_user_id, v_je.id)
  RETURNING id INTO v_rev_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id, reversal_of_id)
  SELECT v_company_id, v_rev_je_id, account_id, account_code, date, credit, debit, 'VOID: ' || description, contact_id, related_doc_type, related_doc_id, id
    FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  UPDATE public.journal_entries SET reversed_by_id = v_rev_je_id WHERE id = v_je.id;
  UPDATE public.expenses SET status = 'void', void_reason = p_void_reason, voided_at = NOW(), voided_by = v_user_id, updated_at = NOW() WHERE id = p_expense_id;

  INSERT INTO public.audit_logs (company_id, entity_type, entity_id, action, user_id, new_data)
  VALUES (v_company_id, 'expenses', p_expense_id, 'void', v_user_id, jsonb_build_object('void_reason', p_void_reason, 'reversal_je_id', v_rev_je_id));

  RETURN jsonb_build_object('expense_id', p_expense_id, 'reversal_je_id', v_rev_je_id);
END; $function$
;

-- ── void_bank_transfer ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.void_bank_transfer(p_transfer_id uuid, p_void_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id UUID := auth.uid(); v_company_id UUID; v_transfer public.bank_transfers%ROWTYPE;
  v_lock_date DATE; v_je RECORD; v_rev_je_id UUID; v_rev_je_num TEXT; v_total NUMERIC;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'void_bank_transfer: no company for user %', v_user_id; END IF;
  SELECT * INTO v_transfer FROM public.bank_transfers WHERE id = p_transfer_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'void_bank_transfer: transfer % not found', p_transfer_id; END IF;
  IF v_transfer.status <> 'confirmed' THEN RAISE EXCEPTION 'void_bank_transfer: only confirmed transfers can be voided (status=%)', v_transfer.status; END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_transfer.date <= v_lock_date THEN RAISE EXCEPTION 'void_bank_transfer: posting date % is in a locked period', v_transfer.date; END IF;

  SELECT * INTO v_je FROM public.journal_entries
   WHERE source_type = 'bank_transfer' AND source_id = p_transfer_id AND company_id = v_company_id AND reversed_by_id IS NULL AND reversal_of_id IS NULL
   ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'void_bank_transfer: no live JE found for transfer %', p_transfer_id; END IF;

  SELECT COALESCE(SUM(debit), 0) INTO v_total FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1000, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'JE-' || current_value::TEXT INTO v_rev_je_num FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'JE';

  INSERT INTO public.journal_entries
    (company_id, entry_number, date, source_type, source_id, description, total_debit, total_credit, created_by, reversal_of_id)
  VALUES
    (v_company_id, v_rev_je_num, v_je.date, 'bank_transfer', p_transfer_id,
     'VOID: ' || COALESCE(p_void_reason, 'Bank Transfer Void'), v_total, v_total, v_user_id, v_je.id)
  RETURNING id INTO v_rev_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id, reversal_of_id)
  SELECT v_company_id, v_rev_je_id, account_id, account_code, date, credit, debit, 'VOID: ' || description, contact_id, related_doc_type, related_doc_id, id
    FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  UPDATE public.journal_entries SET reversed_by_id = v_rev_je_id WHERE id = v_je.id;
  UPDATE public.bank_transfers SET status = 'void', updated_at = NOW() WHERE id = p_transfer_id;

  INSERT INTO public.audit_logs (company_id, entity_type, entity_id, action, user_id, new_data)
  VALUES (v_company_id, 'bank_transfers', p_transfer_id, 'void', v_user_id, jsonb_build_object('void_reason', p_void_reason, 'reversal_je_id', v_rev_je_id));

  RETURN jsonb_build_object('transfer_id', p_transfer_id, 'reversal_je_id', v_rev_je_id);
END; $function$
;


-- ── void_payment (hand-patched: the COUNT(*) guard only) ─────────────
-- The fetch beneath this count was already correct. The count was not, so
-- a leftover reversal made it see two advance applications where there is
-- one, and refuse a legitimate void. Same clause, so the two agree.
CREATE OR REPLACE FUNCTION public.void_payment(p_payment_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id     UUID := auth.uid();
  v_company_id  UUID;
  v_pmt         public.payments%ROWTYPE;
  v_lock_date   DATE;
  v_je          public.journal_entries%ROWTYPE;
  v_gl          public.general_ledger%ROWTYPE;
  v_rev_id      UUID;
  v_rev_entry   TEXT;
  v_seq         BIGINT;
  v_alloc       RECORD;
  v_aje_count   INTEGER;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'void_payment: no company for user';
  END IF;

  SELECT * INTO v_pmt FROM public.payments WHERE id = p_payment_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'void_payment: payment % not found', p_payment_id;
  END IF;
  IF v_pmt.status <> 'confirmed' THEN
    RAISE EXCEPTION 'void_payment: payment % is not confirmed (status=%)', p_payment_id, v_pmt.status;
  END IF;
  IF v_pmt.type <> 'inbound' THEN
    RAISE EXCEPTION 'void_payment: only inbound receipts are handled here (type=%)', v_pmt.type;
  END IF;

  -- Period lock (reversal posts with today's date)
  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_pmt.date <= v_lock_date THEN
    RAISE EXCEPTION 'void_payment: voucher date % is on or before the period lock %', v_pmt.date, v_lock_date;
  END IF;

  -- Reconciliation guard — refuse if any GL line of this payment is reconciled
  IF EXISTS (
    SELECT 1
    FROM public.general_ledger gl
    JOIN public.journal_entries je ON je.id = gl.journal_entry_id
    WHERE je.company_id = v_company_id
      AND je.source_id = p_payment_id
      AND je.source_type IN ('customer_receipt','customer_advance')
      AND gl.reconciliation_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'void_payment: payment % is bank-reconciled. Un-reconcile it first, then void.', p_payment_id;
  END IF;

  -- ── CASCADE: reverse advance-application JEs for invoices this payment paid ──
  -- ONLY for advance/on_account receipts. An against_invoice receipt settles
  -- via the 1200 credit inside its own confirm JE (reversed below) — its
  -- allocations are NOT advance applications, so we must not touch any
  -- advance_application JE that happens to sit on the same invoice (it could
  -- belong to a different payment).
  -- Phase 18d: cascade runs for ALL classifications. An against_invoice
  -- receipt's unallocated portion can later be applied as an advance; the
  -- per-invoice count guard below still protects the ambiguous case.
  FOR v_alloc IN
    SELECT doc_id FROM public.payment_allocations
    WHERE payment_id = p_payment_id AND company_id = v_company_id AND doc_type = 'invoice'
  LOOP
    SELECT COUNT(*) INTO v_aje_count
    FROM public.journal_entries
    WHERE company_id = v_company_id
      AND source_id = v_alloc.doc_id
      AND source_type = 'advance_application'
      AND reversed_by_id IS NULL AND reversal_of_id IS NULL;

    IF v_aje_count > 1 THEN
      RAISE EXCEPTION 'void_payment: invoice % has multiple advance applications; reverse them manually first.', v_alloc.doc_id;
    END IF;

    IF v_aje_count = 1 THEN
      SELECT * INTO v_je
      FROM public.journal_entries
      WHERE company_id = v_company_id
        AND source_id = v_alloc.doc_id
        AND source_type = 'advance_application'
        AND reversed_by_id IS NULL
      AND reversal_of_id IS NULL
      LIMIT 1;

      INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
      VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
      ON CONFLICT (company_id, prefix) DO UPDATE
        SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
      RETURNING current_value INTO v_seq;
      v_rev_entry := 'JE-' || v_seq::TEXT;
    IF v_lock_date IS NOT NULL AND v_je.date <= v_lock_date THEN
      RAISE EXCEPTION 'Cannot reverse: the original posting dated % is in a locked period (lock %).', v_je.date, v_lock_date;
    END IF;

      INSERT INTO public.journal_entries (
        company_id, entry_number, date, description,
        source_type, source_id, currency, exchange_rate,
        total_debit, total_credit, reversal_of_id, created_by
      ) VALUES (
        v_company_id, v_rev_entry, v_je.date,
        COALESCE(p_reason, 'Void receipt – reverse advance application'),
        v_je.source_type, v_je.source_id,
        v_je.currency, v_je.exchange_rate,
        v_je.total_credit, v_je.total_debit,
        v_je.id, v_user_id
      ) RETURNING id INTO v_rev_id;

      FOR v_gl IN SELECT * FROM public.general_ledger WHERE journal_entry_id = v_je.id LOOP
        INSERT INTO public.general_ledger (
          company_id, journal_entry_id, account_id, account_code, date,
          debit, credit, description,
          contact_id, related_doc_type, related_doc_id, reversal_of_id
        ) VALUES (
          v_company_id, v_rev_id, v_gl.account_id, v_gl.account_code, v_gl.date,
          v_gl.credit, v_gl.debit,
          COALESCE(p_reason, 'Void receipt – reverse advance application'),
          v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
        );
      END LOOP;

      UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
    END IF;
  END LOOP;

  -- ── Reverse the receipt's own JE (customer_receipt | customer_advance) ──
  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id
      AND source_id = p_payment_id
      AND reversed_by_id IS NULL
      AND reversal_of_id IS NULL
      AND source_type IN ('customer_receipt','customer_advance')
  LOOP
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE
      SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
    RETURNING current_value INTO v_seq;
    v_rev_entry := 'JE-' || v_seq::TEXT;
    IF v_lock_date IS NOT NULL AND v_je.date <= v_lock_date THEN
      RAISE EXCEPTION 'Cannot reverse: the original posting dated % is in a locked period (lock %).', v_je.date, v_lock_date;
    END IF;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description,
      source_type, source_id, currency, exchange_rate,
      total_debit, total_credit, reversal_of_id, created_by
    ) VALUES (
      v_company_id, v_rev_entry, v_je.date,
      COALESCE(p_reason, 'Void – ' || v_pmt.payment_number),
      v_je.source_type, p_payment_id,
      v_je.currency, v_je.exchange_rate,
      v_je.total_credit, v_je.total_debit,
      v_je.id, v_user_id
    ) RETURNING id INTO v_rev_id;

    FOR v_gl IN SELECT * FROM public.general_ledger WHERE journal_entry_id = v_je.id LOOP
      INSERT INTO public.general_ledger (
        company_id, journal_entry_id, account_id, account_code, date,
        debit, credit, description,
        contact_id, related_doc_type, related_doc_id, reversal_of_id
      ) VALUES (
        v_company_id, v_rev_id, v_gl.account_id, v_gl.account_code, v_gl.date,
        v_gl.credit, v_gl.debit,
        COALESCE(p_reason, 'Void – ' || v_pmt.payment_number),
        v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
      );
    END LOOP;

    UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
  END LOOP;

  -- Drop allocations so any invoice this receipt paid reopens.
  DELETE FROM public.payment_allocations
  WHERE payment_id = p_payment_id AND company_id = v_company_id;

  -- Void the payment
  UPDATE public.payments
  SET status = 'void', void_reason = p_reason,
      voided_at = NOW(), voided_by = v_user_id, updated_at = NOW()
  WHERE id = p_payment_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'void', 'payment', p_payment_id,
      jsonb_build_object('payment_number', v_pmt.payment_number, 'reason', p_reason));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('payment_id', p_payment_id, 'payment_number', v_pmt.payment_number);
END;
$function$
;

-- ===========================================================================
-- THE DATA: reverse out JE-1115, the entry the bug created
--
-- Dated at the ORIGINAL entry's date (phase43), so the correction lands in
-- the period it unwinds rather than today. Refuses to run if the entry is not
-- the shape this migration expects, or if it has already been corrected -
-- so applying this file twice is safe.
-- ===========================================================================

DO $fix$
DECLARE
  v_co      UUID;
  v_je      public.journal_entries%ROWTYPE;
  v_gl      public.general_ledger%ROWTYPE;
  v_seq     BIGINT;
  v_entry   TEXT;
  v_rev_id  UUID;
  v_desc    TEXT := 'Correction - phase92 reversed-a-reversal (JE-1115)';
BEGIN
  SELECT id INTO v_co FROM public.companies WHERE name = 'Pro_Parts';
  IF v_co IS NULL THEN
    RAISE NOTICE 'phase92: Pro_Parts not found, skipping the data fix.';
    RETURN;
  END IF;

  -- The entry must still be what we diagnosed: a reversal WHOSE TARGET IS
  -- ITSELF A REVERSAL. If that is not true, this is not the row we mean and
  -- we must not touch it.
  SELECT je.* INTO v_je
  FROM public.journal_entries je
  JOIN public.journal_entries tgt ON tgt.id = je.reversal_of_id
  WHERE je.company_id = v_co
    AND je.entry_number = 'JE-1115'
    AND je.reversal_of_id IS NOT NULL
    AND tgt.reversal_of_id IS NOT NULL
    AND je.reversed_by_id IS NULL;

  IF NOT FOUND THEN
    RAISE NOTICE 'phase92: JE-1115 is not an un-corrected reversal-of-a-reversal; nothing to do.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.companies
              WHERE id = v_co AND period_lock_date IS NOT NULL
                AND period_lock_date >= v_je.date) THEN
    RAISE EXCEPTION 'phase92: % is in a locked period; unlock before correcting.', v_je.date;
  END IF;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_co, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_seq;
  v_entry := 'JE-' || v_seq::TEXT;

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, currency, exchange_rate,
    total_debit, total_credit, reversal_of_id, created_by
  ) VALUES (
    v_co, v_entry, v_je.date, v_desc,
    v_je.source_type, v_je.source_id, v_je.currency, v_je.exchange_rate,
    v_je.total_credit, v_je.total_debit, v_je.id, v_je.created_by
  ) RETURNING id INTO v_rev_id;

  FOR v_gl IN SELECT * FROM public.general_ledger WHERE journal_entry_id = v_je.id LOOP
    INSERT INTO public.general_ledger (
      company_id, journal_entry_id, account_id, account_code, date,
      debit, credit, description,
      contact_id, related_doc_type, related_doc_id, reversal_of_id
    ) VALUES (
      v_co, v_rev_id, v_gl.account_id, v_gl.account_code, v_gl.date,
      v_gl.credit, v_gl.debit, v_desc,
      v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
    );
  END LOOP;

  UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;

  RAISE NOTICE 'phase92: corrected JE-1115 with %', v_entry;
END
$fix$;

COMMIT;

-- -- VERIFY: JUMA ARIF's receivable should now be 0.00
-- SELECT ROUND(SUM(gl.credit - gl.debit), 2) AS should_be_zero
--   FROM public.general_ledger gl
--   JOIN public.contacts ct ON ct.id = gl.contact_id
--  WHERE gl.account_code = '1200' AND ct.name = 'JUMA ARIF';
--
-- -- VERIFY: no entry anywhere reverses a reversal
-- SELECT je.entry_number FROM public.journal_entries je
--   JOIN public.journal_entries r ON r.id = je.reversal_of_id
--  WHERE r.reversal_of_id IS NOT NULL AND je.reversed_by_id IS NULL;

-- == ROLLBACK ===============================================================
-- The ten function bodies can be restored by re-running the previous
-- migration that defined each, or by removing the added clause. The data fix
-- cannot be meaningfully rolled back: the correcting entry is itself a
-- journal entry, and Doc 3 Rule 5 is reverse-never-delete. To undo it, post a
-- further reversal of the correcting entry.
