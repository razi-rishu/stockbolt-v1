-- Phase 14 — void_payment RPC (customer receipts)
--
-- Reverses a CONFIRMED inbound payment the audit-safe way (mirrors void_invoice):
--   • Reverses every unreversed JE linked to the payment
--     (source_type 'customer_receipt' | 'customer_advance').
--   • CASCADE: if the receipt was an advance that got APPLIED to invoices,
--     reverses each matching 'advance_application' JE too — so those invoices
--     reopen. (Skips with a clear error only in the rare ambiguous case where
--     one invoice has >1 unreversed advance application.)
--   • Deletes the payment's allocations so any invoice it paid reopens.
--   • Marks the payment status='void' (kept for audit, like a voided invoice).
--
-- Guards: must be confirmed + inbound; today after period lock; none of the
-- payment's GL lines may be bank-reconciled.
--
-- Returns: { payment_id, payment_number }

CREATE OR REPLACE FUNCTION public.void_payment(
  p_payment_id UUID,
  p_reason     TEXT DEFAULT NULL
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
  IF v_lock_date IS NOT NULL AND CURRENT_DATE <= v_lock_date THEN
    RAISE EXCEPTION 'void_payment: today % is on or before the period lock %', CURRENT_DATE, v_lock_date;
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
      AND reversed_by_id IS NULL;

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
          v_company_id, v_rev_id, v_gl.account_id, v_gl.account_code, CURRENT_DATE,
          v_gl.credit, v_gl.debit,
          COALESCE(p_reason, 'Void receipt – reverse advance application'),
          v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
        );
      END LOOP;

      UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
    END IF;
  END LOOP;
  END IF;

  -- ── Reverse the receipt's own JE (customer_receipt | customer_advance) ──
  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id
      AND source_id = p_payment_id
      AND reversed_by_id IS NULL
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
        v_company_id, v_rev_id, v_gl.account_id, v_gl.account_code, CURRENT_DATE,
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
$$;
