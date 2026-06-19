-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 18: Edit a CONFIRMED payment (reverse-and-reopen)
-- ─────────────────────────────────────────────────────────────────────────
-- Lets the operator edit a posted payment the audit-safe way: reverse its GL
-- posting + cascade-reverse any advance applications + drop its allocations,
-- then flip status back to 'draft'. The UI then reuses the existing (tested,
-- FX-aware) draft editor + update_payment_draft + confirm_payment /
-- confirm_vendor_payment to re-post. NO posting math is duplicated here.
--
-- These are near-clones of void_payment (Phase 14) — the ONLY behavioural
-- difference is the final status is 'draft' (not 'void') and the void_* fields
-- are cleared. confirm_*, void_payment, update_payment_draft and every
-- invoice/inventory path are UNCHANGED.
--
-- Guards (both): must be confirmed + correct type; today after period lock;
-- NONE of the payment's GL lines may be bank-reconciled (un-reconcile first).
--
-- Returns: { payment_id, payment_number, status }
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1) reopen_payment — customer / inbound ───────────────────────────────
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

  -- Period lock (reversal posts with today's date)
  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND CURRENT_DATE <= v_lock_date THEN
    RAISE EXCEPTION 'reopen_payment: today % is on or before the period lock %', CURRENT_DATE, v_lock_date;
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
    RAISE EXCEPTION 'reopen_payment: payment % is bank-reconciled. Un-reconcile it first, then edit.', p_payment_id;
  END IF;

  -- ── CASCADE: reverse advance-application JEs for invoices this payment paid ──
  -- ONLY for advance/on_account receipts (same reasoning as void_payment).
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
      RAISE EXCEPTION 'reopen_payment: invoice % has multiple advance applications; reverse them manually first.', v_alloc.doc_id;
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

  -- Drop allocations so any invoice this receipt paid reopens.
  DELETE FROM public.payment_allocations
  WHERE payment_id = p_payment_id AND company_id = v_company_id;

  -- Reopen the payment as an editable draft (clear any prior void metadata).
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


-- ── 2) reopen_vendor_payment — vendor / outbound ─────────────────────────
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

  -- Reconciliation guard
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

  -- ── CASCADE: reverse advance-application JEs for bills this payment paid ──
  -- ONLY for advance/on_account payments.
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
      AND reversed_by_id IS NULL;

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

  -- ── Reverse the payment's own JE (vendor_payment | vendor_advance) ──
  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id
      AND source_id = p_payment_id
      AND reversed_by_id IS NULL
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

  -- Drop allocations so any bill this payment paid reopens.
  DELETE FROM public.payment_allocations
  WHERE payment_id = p_payment_id AND company_id = v_company_id;

  -- Reopen the payment as an editable draft.
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
