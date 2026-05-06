-- Phase 5 — confirm_vendor_bill RPC
-- B3 (GRN-linked): DR 2150 GRN Accrual (up to accrued amount) + variance → 1300, DR 1500 VAT, CR 2100 AP
-- B4 (standalone):  DR expense accounts per line (coa_account_id), DR 1500 VAT, CR 2100 AP
-- Returns: { bill_id, bill_number, je_id, entry_number }

-- Add coa_account_id to vendor_bill_items for standalone expense bills
ALTER TABLE public.vendor_bill_items
  ADD COLUMN IF NOT EXISTS coa_account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.confirm_vendor_bill(p_bill_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id      UUID := auth.uid();
  v_company_id   UUID;
  v_bill         public.vendor_bills%ROWTYPE;
  v_item         public.vendor_bill_items%ROWTYPE;
  v_lock_date    DATE;
  v_je_id        UUID;
  v_entry        TEXT;
  v_seq          BIGINT;
  -- GL accounts
  v_ap_id        UUID;   -- 2100 AP
  v_accrual_id   UUID;   -- 2150 GRN Accrual
  v_inv_id       UUID;   -- 1300 Inventory
  v_vat_id       UUID;   -- 1500 Input VAT
  -- B3 amounts
  v_grn_total    NUMERIC(15,2) := 0;
  v_debit_2150   NUMERIC(15,2) := 0;
  v_variance     NUMERIC(15,2) := 0;
  v_bill_goods   NUMERIC(15,2);
  v_total_dr     NUMERIC(15,2);
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_vendor_bill: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_bill FROM public.vendor_bills WHERE id = p_bill_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_vendor_bill: bill % not found', p_bill_id;
  END IF;
  IF v_bill.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_vendor_bill: bill % not in draft (status=%)', p_bill_id, v_bill.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_bill.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_vendor_bill: date % on or before period lock %', v_bill.date, v_lock_date;
  END IF;

  -- Resolve GL accounts
  SELECT id INTO v_ap_id      FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2100' AND is_active;
  SELECT id INTO v_accrual_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2150' AND is_active;
  SELECT id INTO v_inv_id     FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1300' AND is_active;

  IF v_bill.tax_amount > 0 THEN
    SELECT id INTO v_vat_id FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND code LIKE '15%' AND is_active
    ORDER BY code LIMIT 1;
  END IF;

  -- JE sequence
  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_seq;
  v_entry := 'JE-' || v_seq::TEXT;

  v_total_dr := v_bill.total_amount;

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, currency, exchange_rate,
    total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_entry, v_bill.date,
    'Vendor Bill ' || v_bill.bill_number,
    'vendor_bill', p_bill_id,
    v_bill.currency, v_bill.exchange_rate,
    v_total_dr, v_total_dr,
    v_user_id
  ) RETURNING id INTO v_je_id;

  -- ── B3: GRN-linked bill ─────────────────────────────────────────────────
  IF v_bill.linked_grn_id IS NOT NULL THEN
    -- Sum GRN accrual (what was originally posted at GRN confirmation)
    SELECT COALESCE(SUM(total_cost), 0) INTO v_grn_total
    FROM public.goods_receipt_items
    WHERE grn_id = v_bill.linked_grn_id;

    -- Goods portion of bill (excluding VAT)
    v_bill_goods := v_bill.subtotal - v_bill.discount_amount;

    -- Clear accrual up to the GRN amount; variance if bill > GRN
    v_debit_2150 := LEAST(v_grn_total, v_bill_goods);
    v_variance   := v_bill_goods - v_debit_2150;  -- ≥ 0

    -- DR 2150 GRN Accrual
    IF v_debit_2150 > 0 THEN
      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date,
         debit, credit, description, contact_id, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_je_id, v_accrual_id, '2150', v_bill.date,
         v_debit_2150, 0,
         'Vendor Bill ' || v_bill.bill_number,
         v_bill.supplier_id, 'vendor_bill', p_bill_id);
    END IF;

    -- DR 1300 Inventory (variance)
    IF v_variance > 0 THEN
      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date,
         debit, credit, description, contact_id, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_je_id, v_inv_id, '1300', v_bill.date,
         v_variance, 0,
         'Bill variance ' || v_bill.bill_number,
         v_bill.supplier_id, 'vendor_bill', p_bill_id);
    END IF;

    -- Mark GRN as billed
    UPDATE public.goods_receipts SET status = 'billed', updated_at = NOW()
    WHERE id = v_bill.linked_grn_id AND company_id = v_company_id;

  -- ── B4: Standalone bill (expenses / services) ───────────────────────────
  ELSE
    -- DR each expense line's COA account
    FOR v_item IN SELECT * FROM public.vendor_bill_items WHERE bill_id = p_bill_id LOOP
      IF v_item.coa_account_id IS NOT NULL AND v_item.line_subtotal > 0 THEN
        INSERT INTO public.general_ledger
          (company_id, journal_entry_id, account_id, account_code, date,
           debit, credit, description, contact_id, related_doc_type, related_doc_id)
        SELECT
          v_company_id, v_je_id, coa.id, coa.code, v_bill.date,
          v_item.line_subtotal, 0,
          COALESCE(v_item.description, 'Vendor Bill ' || v_bill.bill_number),
          v_bill.supplier_id, 'vendor_bill', p_bill_id
        FROM public.chart_of_accounts coa WHERE coa.id = v_item.coa_account_id;
      END IF;
    END LOOP;
  END IF;

  -- DR 1500 Input VAT (both B3 and B4)
  IF v_bill.tax_amount > 0 AND v_vat_id IS NOT NULL THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_vat_id, '1500', v_bill.date,
       v_bill.tax_amount, 0,
       'Input VAT ' || v_bill.bill_number,
       v_bill.supplier_id, 'vendor_bill', p_bill_id);
  END IF;

  -- CR 2100 Accounts Payable
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date,
     debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_ap_id, '2100', v_bill.date,
     0, v_bill.total_amount,
     'Vendor Bill ' || v_bill.bill_number,
     v_bill.supplier_id, 'vendor_bill', p_bill_id);

  UPDATE public.vendor_bills SET status = 'confirmed', updated_at = NOW() WHERE id = p_bill_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'vendor_bill', p_bill_id,
      jsonb_build_object('bill_number', v_bill.bill_number, 'je', v_entry));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'bill_id',      p_bill_id,
    'bill_number',  v_bill.bill_number,
    'je_id',        v_je_id,
    'entry_number', v_entry
  );
END;
$$;
