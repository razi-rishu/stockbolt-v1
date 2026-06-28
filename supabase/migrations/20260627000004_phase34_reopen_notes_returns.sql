-- ════════════════════════════════════════════════════════════════════════════
-- Phase 34 — reopen_credit_note / reopen_debit_note / reopen_sales_return
-- ────────────────────────────────────────────────────────────────────────────
-- Makes "Edit a confirmed document" consistent across ALL of Sales + Purchasing.
-- Invoices, receipts, vendor bills, vendor payments and expenses already support
-- reverse-&-edit (reopen). These three documents previously only supported Void —
-- so confirming them was a dead end. Each reopen mirrors the document's OWN tested
-- void (reverses the GL + stock) but ends in status='draft' instead of 'void', so
-- the user edits the draft and re-confirms (reusing the proven confirm path).
-- SECURITY INVOKER — RLS + period-lock enforced exactly like the voids.
-- Run by hand in the Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════

-- ── reopen_credit_note (mirror of void_credit_note, → draft) ──────────────────
CREATE OR REPLACE FUNCTION public.reopen_credit_note(p_credit_note_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
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
  IF v_lock_date IS NOT NULL AND CURRENT_DATE <= v_lock_date THEN
    RAISE EXCEPTION 'reopen_credit_note: today % on or before period lock %', CURRENT_DATE, v_lock_date;
  END IF;

  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id AND source_id = p_credit_note_id AND reversed_by_id IS NULL
      AND source_type IN ('sales_credit_note', 'inventory_cogs')
  LOOP
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
    RETURNING current_value INTO v_seq;
    v_rev_entry := 'JE-' || v_seq::TEXT;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description, source_type, source_id,
      currency, exchange_rate, total_debit, total_credit, reversal_of_id, created_by
    ) VALUES (
      v_company_id, v_rev_entry, CURRENT_DATE, 'Reopen – ' || v_cn.credit_note_number,
      v_je.source_type, p_credit_note_id, v_je.currency, v_je.exchange_rate,
      v_je.total_credit, v_je.total_debit, v_je.id, v_user_id
    ) RETURNING id INTO v_rev_id;

    FOR v_gl IN SELECT * FROM public.general_ledger WHERE journal_entry_id = v_je.id LOOP
      INSERT INTO public.general_ledger (
        company_id, journal_entry_id, account_id, account_code, date, debit, credit,
        description, contact_id, related_doc_type, related_doc_id, reversal_of_id
      ) VALUES (
        v_company_id, v_rev_id, v_gl.account_id, v_gl.account_code, CURRENT_DATE, v_gl.credit, v_gl.debit,
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
    ORDER BY created_at DESC LIMIT 1;

    INSERT INTO public.stock_ledger (
      company_id, product_id, warehouse_id, date, type, direction, quantity, unit_cost, total_cost,
      running_qty, running_avg_cost, related_doc_type, related_doc_id, reversal_of_id
    ) VALUES (
      v_company_id, v_sl.product_id, v_sl.warehouse_id, CURRENT_DATE,
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
$$;
GRANT EXECUTE ON FUNCTION public.reopen_credit_note(UUID) TO authenticated;

-- ── reopen_debit_note (mirror of void_debit_note, → draft) ────────────────────
CREATE OR REPLACE FUNCTION public.reopen_debit_note(p_debit_note_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
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
  IF v_lock_date IS NOT NULL AND CURRENT_DATE <= v_lock_date THEN
    RAISE EXCEPTION 'reopen_debit_note: today % on or before period lock %', CURRENT_DATE, v_lock_date;
  END IF;

  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id AND source_id = p_debit_note_id AND reversed_by_id IS NULL
      AND source_type = 'vendor_debit_note'
  LOOP
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
    RETURNING current_value INTO v_seq;
    v_rev_entry := 'JE-' || v_seq::TEXT;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description, source_type, source_id,
      currency, exchange_rate, total_debit, total_credit, reversal_of_id, created_by
    ) VALUES (
      v_company_id, v_rev_entry, CURRENT_DATE, 'Reopen – ' || v_dn.debit_note_number,
      v_je.source_type, p_debit_note_id, v_je.currency, v_je.exchange_rate,
      v_je.total_credit, v_je.total_debit, v_je.id, v_user_id
    ) RETURNING id INTO v_rev_id;

    FOR v_gl IN SELECT * FROM public.general_ledger WHERE journal_entry_id = v_je.id LOOP
      INSERT INTO public.general_ledger (
        company_id, journal_entry_id, account_id, account_code, date, debit, credit,
        description, contact_id, related_doc_type, related_doc_id, reversal_of_id
      ) VALUES (
        v_company_id, v_rev_id, v_gl.account_id, v_gl.account_code, CURRENT_DATE, v_gl.credit, v_gl.debit,
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
    ORDER BY created_at DESC LIMIT 1;

    INSERT INTO public.stock_ledger (
      company_id, product_id, warehouse_id, date, type, direction, quantity, unit_cost, total_cost,
      running_qty, running_avg_cost, related_doc_type, related_doc_id, reversal_of_id
    ) VALUES (
      v_company_id, v_sl.product_id, v_sl.warehouse_id, CURRENT_DATE,
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
$$;
GRANT EXECUTE ON FUNCTION public.reopen_debit_note(UUID) TO authenticated;

-- ── reopen_sales_return (void the linked credit note, → draft + unlink) ───────
CREATE OR REPLACE FUNCTION public.reopen_sales_return(p_sales_return_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_sr         public.sales_returns%ROWTYPE;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'reopen_sales_return: no company for user'; END IF;

  SELECT * INTO v_sr FROM public.sales_returns WHERE id = p_sales_return_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'reopen_sales_return: return % not found', p_sales_return_id; END IF;
  IF v_sr.status <> 'confirmed' THEN RAISE EXCEPTION 'reopen_sales_return: not confirmed (status=%)', v_sr.status; END IF;

  -- Reverse the financial posting by voiding the linked credit note, then unlink.
  IF v_sr.credit_note_id IS NOT NULL THEN
    PERFORM public.void_credit_note(v_sr.credit_note_id, 'Reopen sales return ' || v_sr.return_number);
  END IF;

  UPDATE public.sales_returns
  SET status = 'draft', credit_note_id = NULL, updated_at = NOW()
  WHERE id = p_sales_return_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'reopen', 'sales_return', p_sales_return_id,
      jsonb_build_object('return_number', v_sr.return_number));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('sales_return_id', p_sales_return_id, 'status', 'draft');
END;
$$;
GRANT EXECUTE ON FUNCTION public.reopen_sales_return(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
