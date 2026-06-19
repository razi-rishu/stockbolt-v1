-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 18c: fix reopen_payment / reopen_vendor_payment
--                           double-reversal on repeated edits
-- ─────────────────────────────────────────────────────────────────────────
-- BUG: the Phase 18 reopen functions selected JEs to reverse with only
--   `reversed_by_id IS NULL AND source_type IN (...)`. The reversal entries
--   they create carry the SAME source_type (e.g. 'customer_receipt') and have
--   reversed_by_id NULL, so on a SECOND edit of the same payment the loop
--   re-reversed the PRIOR reopen's reversal entries — stacking phantom GL
--   rows and drifting the 2400 / 1400 control balance (same bug class as the
--   Phase 12.21 edit_invoice fix).
--
-- FIX: add `AND reversal_of_id IS NULL` everywhere the reopen loops pick rows
--   to reverse (both the advance-application cascade and the payment's own
--   JE), so only genuine, currently-live postings are reversed — never a
--   reversal entry. Idempotent; reverse-only, no posting-math change.
--
-- NOTE: existing tangled data from earlier test edits is repaired separately;
--   this migration only corrects the function logic going forward.
-- ─────────────────────────────────────────────────────────────────────────

-- ── reopen_payment — customer / inbound ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.reopen_payment(
  p_payment_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
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
    RAISE EXCEPTION 'reopen_payment: no company for user';
  END IF;

  SELECT * INTO v_pmt FROM public.payments WHERE id = p_payment_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reopen_payment: payment % not found', p_payment_id;
  END IF;
  IF v_pmt.status <> 'confirmed' THEN
    RAISE EXCEPTION 'reopen_payment: payment % is not confirmed (status=%)', p_payment_id, v_pmt.status;
  END IF;
  IF v_pmt.type <> 'inbound' THEN
    RAISE EXCEPTION 'reopen_payment: only inbound receipts are handled here (type=%)', v_pmt.type;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND CURRENT_DATE <= v_lock_date THEN
    RAISE EXCEPTION 'reopen_payment: today % is on or before the period lock %', CURRENT_DATE, v_lock_date;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.general_ledger gl
    JOIN public.journal_entries je ON je.id = gl.journal_entry_id
    WHERE je.company_id = v_company_id
      AND je.source_id = p_payment_id
      AND je.source_type IN ('customer_receipt','customer_advance')
      AND gl.reconciliation_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'reopen_payment: payment % is bank-reconciled. Un-reconcile it first, then edit.', p_payment_id;
  END IF;

  -- CASCADE: reverse advance-application JEs for invoices this payment paid
  -- (advance/on_account only). reversal_of_id IS NULL → never re-reverse a
  -- prior reversal.
  IF v_pmt.classification IN ('advance','on_account') THEN
  FOR v_alloc IN
    SELECT doc_id FROM public.payment_allocations
    WHERE payment_id = p_payment_id AND company_id = v_company_id AND doc_type = 'invoice'
  LOOP
    SELECT COUNT(*) INTO v_aje_count
    FROM public.journal_entries
    WHERE company_id = v_company_id
      AND source_id = v_alloc.doc_id
      AND source_type = 'advance_application'
      AND reversed_by_id IS NULL
      AND reversal_of_id IS NULL;

    IF v_aje_count > 1 THEN
      RAISE EXCEPTION 'reopen_payment: invoice % has multiple advance applications; reverse them manually first.', v_alloc.doc_id;
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

      INSERT INTO public.journal_entries (
        company_id, entry_number, date, description,
        source_type, source_id, currency, exchange_rate,
        total_debit, total_credit, reversal_of_id, created_by
      ) VALUES (
        v_company_id, v_rev_entry, CURRENT_DATE,
        'Edit reopen – reverse advance application',
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
          v_company_id, v_rev_id, v_gl.account_id, v_gl.account_code, CURRENT_DATE,
          v_gl.credit, v_gl.debit,
          'Edit reopen – reverse advance application',
          v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
        );
      END LOOP;

      UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
    END IF;
  END LOOP;
  END IF;

  -- Reverse the receipt's own live JE(s). reversal_of_id IS NULL is the key
  -- fix: never re-reverse a reversal entry created by a prior reopen.
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

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description,
      source_type, source_id, currency, exchange_rate,
      total_debit, total_credit, reversal_of_id, created_by
    ) VALUES (
      v_company_id, v_rev_entry, CURRENT_DATE,
      'Edit reopen – ' || v_pmt.payment_number,
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
        v_company_id, v_rev_id, v_gl.account_id, v_gl.account_code, CURRENT_DATE,
        v_gl.credit, v_gl.debit,
        'Edit reopen – ' || v_pmt.payment_number,
        v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
      );
    END LOOP;

    UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
  END LOOP;

  DELETE FROM public.payment_allocations
  WHERE payment_id = p_payment_id AND company_id = v_company_id;

  UPDATE public.payments
  SET status = 'draft', void_reason = NULL,
      voided_at = NULL, voided_by = NULL, updated_at = NOW()
  WHERE id = p_payment_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'edit', 'payment', p_payment_id,
      jsonb_build_object('payment_number', v_pmt.payment_number, 'reopened', true));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('payment_id', p_payment_id, 'payment_number', v_pmt.payment_number, 'status', 'draft');
END;
$$;

GRANT EXECUTE ON FUNCTION public.reopen_payment(UUID) TO authenticated;


-- ── reopen_vendor_payment — vendor / outbound ────────────────────────────
CREATE OR REPLACE FUNCTION public.reopen_vendor_payment(
  p_payment_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
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
    RAISE EXCEPTION 'reopen_vendor_payment: no company for user';
  END IF;

  SELECT * INTO v_pmt FROM public.payments WHERE id = p_payment_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reopen_vendor_payment: payment % not found', p_payment_id;
  END IF;
  IF v_pmt.status <> 'confirmed' THEN
    RAISE EXCEPTION 'reopen_vendor_payment: payment % is not confirmed (status=%)', p_payment_id, v_pmt.status;
  END IF;
  IF v_pmt.type <> 'outbound' THEN
    RAISE EXCEPTION 'reopen_vendor_payment: only outbound payments are handled here (type=%)', v_pmt.type;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND CURRENT_DATE <= v_lock_date THEN
    RAISE EXCEPTION 'reopen_vendor_payment: today % is on or before the period lock %', CURRENT_DATE, v_lock_date;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.general_ledger gl
    JOIN public.journal_entries je ON je.id = gl.journal_entry_id
    WHERE je.company_id = v_company_id
      AND je.source_id = p_payment_id
      AND je.source_type IN ('vendor_payment','vendor_advance')
      AND gl.reconciliation_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'reopen_vendor_payment: payment % is bank-reconciled. Un-reconcile it first, then edit.', p_payment_id;
  END IF;

  IF v_pmt.classification IN ('advance','on_account') THEN
  FOR v_alloc IN
    SELECT doc_id FROM public.payment_allocations
    WHERE payment_id = p_payment_id AND company_id = v_company_id AND doc_type = 'vendor_bill'
  LOOP
    SELECT COUNT(*) INTO v_aje_count
    FROM public.journal_entries
    WHERE company_id = v_company_id
      AND source_id = v_alloc.doc_id
      AND source_type = 'advance_application'
      AND reversed_by_id IS NULL
      AND reversal_of_id IS NULL;

    IF v_aje_count > 1 THEN
      RAISE EXCEPTION 'reopen_vendor_payment: bill % has multiple advance applications; reverse them manually first.', v_alloc.doc_id;
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

      INSERT INTO public.journal_entries (
        company_id, entry_number, date, description,
        source_type, source_id, currency, exchange_rate,
        total_debit, total_credit, reversal_of_id, created_by
      ) VALUES (
        v_company_id, v_rev_entry, CURRENT_DATE,
        'Edit reopen – reverse advance application',
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
          v_company_id, v_rev_id, v_gl.account_id, v_gl.account_code, CURRENT_DATE,
          v_gl.credit, v_gl.debit,
          'Edit reopen – reverse advance application',
          v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
        );
      END LOOP;

      UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
    END IF;
  END LOOP;
  END IF;

  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id
      AND source_id = p_payment_id
      AND reversed_by_id IS NULL
      AND reversal_of_id IS NULL
      AND source_type IN ('vendor_payment','vendor_advance')
  LOOP
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE
      SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
    RETURNING current_value INTO v_seq;
    v_rev_entry := 'JE-' || v_seq::TEXT;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description,
      source_type, source_id, currency, exchange_rate,
      total_debit, total_credit, reversal_of_id, created_by
    ) VALUES (
      v_company_id, v_rev_entry, CURRENT_DATE,
      'Edit reopen – ' || v_pmt.payment_number,
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
        v_company_id, v_rev_id, v_gl.account_id, v_gl.account_code, CURRENT_DATE,
        v_gl.credit, v_gl.debit,
        'Edit reopen – ' || v_pmt.payment_number,
        v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
      );
    END LOOP;

    UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
  END LOOP;

  DELETE FROM public.payment_allocations
  WHERE payment_id = p_payment_id AND company_id = v_company_id;

  UPDATE public.payments
  SET status = 'draft', void_reason = NULL,
      voided_at = NULL, voided_by = NULL, updated_at = NOW()
  WHERE id = p_payment_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'edit', 'vendor_payment', p_payment_id,
      jsonb_build_object('payment_number', v_pmt.payment_number, 'reopened', true));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('payment_id', p_payment_id, 'payment_number', v_pmt.payment_number, 'status', 'draft');
END;
$$;

GRANT EXECUTE ON FUNCTION public.reopen_vendor_payment(UUID) TO authenticated;
