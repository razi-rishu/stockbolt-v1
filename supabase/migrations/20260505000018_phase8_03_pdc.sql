-- Phase 8 — PDC Cheque lifecycle RPCs
-- E1: create_pdc    — creates PDC record + posts GL (Dr 1250 Cr 1200/2400 for received;
--                                                    Dr 2100 Cr 2450 for issued)
-- E2: deposit_pdc   — marks as deposited, NO GL
-- E3: clear_pdc     — PDC cleared: Dr bank Cr 1250 (received); Dr 2450 Cr bank (issued)
-- E4: bounce_pdc    — PDC bounced: Dr 1260 Cr 1250 (received only)
--     cancel_pdc    — reverses creation GL, marks cancelled

-- ── create_pdc ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_pdc(
  p_type               TEXT,      -- 'received' | 'issued'
  p_contact_id         UUID,
  p_cheque_number      TEXT,
  p_amount             NUMERIC,
  p_issue_date         DATE,
  p_due_date           DATE,
  p_bank_name          TEXT       DEFAULT NULL,
  p_currency           TEXT       DEFAULT 'AED',
  p_deposit_account_id UUID       DEFAULT NULL,
  p_linked_payment_id  UUID       DEFAULT NULL,
  p_is_advance         BOOLEAN    DEFAULT FALSE,
  p_notes              TEXT       DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_company_id    UUID;
  v_lock_date     DATE;
  v_pdc_id        UUID;
  v_pdc_number    TEXT;
  v_je_id         UUID;
  v_je_number     TEXT;
  v_dr_account_id UUID;
  v_cr_account_id UUID;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'create_pdc: no company for user %', v_user_id;
  END IF;

  IF p_type NOT IN ('received', 'issued') THEN
    RAISE EXCEPTION 'create_pdc: type must be received or issued, got %', p_type;
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'create_pdc: amount must be positive';
  END IF;

  -- Period lock on due_date (that is the economic date)
  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND p_issue_date <= v_lock_date THEN
    RAISE EXCEPTION 'create_pdc: issue_date % is on or before period lock %', p_issue_date, v_lock_date;
  END IF;

  -- PDC sequence number
  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'PDC', 1000, 'PDC-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'PDC-' || current_value::TEXT INTO v_pdc_number
    FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'PDC';

  -- Insert PDC record
  INSERT INTO public.pdc_cheques
    (company_id, pdc_number, type, contact_id, cheque_number, bank_name,
     amount, currency, issue_date, due_date, deposit_account_id,
     linked_payment_id, notes, status)
  VALUES
    (v_company_id, v_pdc_number, p_type, p_contact_id, p_cheque_number, p_bank_name,
     p_amount, p_currency, p_issue_date, p_due_date, p_deposit_account_id,
     p_linked_payment_id, p_notes, 'pending')
  RETURNING id INTO v_pdc_id;

  -- JE number
  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1000, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'JE-' || current_value::TEXT INTO v_je_number
    FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'JE';

  IF p_type = 'received' THEN
    -- Dr 1250 PDC Receivable
    SELECT id INTO v_dr_account_id FROM public.chart_of_accounts
      WHERE company_id = v_company_id AND code = '1250' LIMIT 1;
    IF v_dr_account_id IS NULL THEN
      RAISE EXCEPTION 'create_pdc: COA account 1250 (PDC Receivable) not found';
    END IF;
    -- Cr 1200 AR (or 2400 Customer Advances if advance PDC)
    IF p_is_advance THEN
      SELECT id INTO v_cr_account_id FROM public.chart_of_accounts
        WHERE company_id = v_company_id AND code = '2400' LIMIT 1;
    ELSE
      SELECT id INTO v_cr_account_id FROM public.chart_of_accounts
        WHERE company_id = v_company_id AND code = '1200' LIMIT 1;
    END IF;
    IF v_cr_account_id IS NULL THEN
      RAISE EXCEPTION 'create_pdc: credit COA account not found (1200 or 2400)';
    END IF;
  ELSE -- issued
    -- Dr 2100 AP
    SELECT id INTO v_dr_account_id FROM public.chart_of_accounts
      WHERE company_id = v_company_id AND code = '2100' LIMIT 1;
    IF v_dr_account_id IS NULL THEN
      RAISE EXCEPTION 'create_pdc: COA account 2100 (AP) not found';
    END IF;
    -- Cr 2450 PDC Payable
    SELECT id INTO v_cr_account_id FROM public.chart_of_accounts
      WHERE company_id = v_company_id AND code = '2450' LIMIT 1;
    IF v_cr_account_id IS NULL THEN
      RAISE EXCEPTION 'create_pdc: COA account 2450 (PDC Payable) not found';
    END IF;
  END IF;

  -- Post GL: E1 / E5
  INSERT INTO public.journal_entries
    (company_id, je_number, date, source_type, source_id, description, posted_by, is_reversed)
  VALUES
    (v_company_id, v_je_number, p_issue_date,
     'pdc_creation', v_pdc_id,
     p_type || ' PDC ' || v_pdc_number || ' — ' || p_cheque_number,
     v_user_id, FALSE)
  RETURNING id INTO v_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, debit, credit, description)
  VALUES
    (v_company_id, v_je_id, v_dr_account_id, p_amount, 0,        'PDC ' || v_pdc_number),
    (v_company_id, v_je_id, v_cr_account_id, 0,        p_amount, 'PDC ' || v_pdc_number);

  INSERT INTO public.audit_logs (company_id, table_name, record_id, action, performed_by, new_data)
  VALUES (v_company_id, 'pdc_cheques', v_pdc_id, 'create', v_user_id,
          jsonb_build_object('pdc_number', v_pdc_number, 'journal_entry_id', v_je_id));

  RETURN jsonb_build_object(
    'pdc_id',          v_pdc_id,
    'pdc_number',      v_pdc_number,
    'journal_entry_id', v_je_id
  );
END;
$$;

-- ── deposit_pdc ────────────────────────────────────────────────────────────
-- E2: status change only — no GL

CREATE OR REPLACE FUNCTION public.deposit_pdc(p_pdc_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_pdc        public.pdc_cheques%ROWTYPE;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'deposit_pdc: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_pdc FROM public.pdc_cheques WHERE id = p_pdc_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'deposit_pdc: PDC % not found', p_pdc_id; END IF;
  IF v_pdc.type <> 'received' THEN
    RAISE EXCEPTION 'deposit_pdc: only received PDCs can be deposited';
  END IF;
  IF v_pdc.status <> 'pending' THEN
    RAISE EXCEPTION 'deposit_pdc: PDC must be pending to deposit (status=%)', v_pdc.status;
  END IF;

  UPDATE public.pdc_cheques SET status = 'deposited', updated_at = NOW() WHERE id = p_pdc_id;

  INSERT INTO public.audit_logs (company_id, table_name, record_id, action, performed_by, new_data)
  VALUES (v_company_id, 'pdc_cheques', p_pdc_id, 'deposit', v_user_id, '{}');

  RETURN jsonb_build_object('pdc_id', p_pdc_id, 'status', 'deposited');
END;
$$;

-- ── clear_pdc ──────────────────────────────────────────────────────────────
-- E3 (received): Dr deposit_bank_account, Cr 1250
-- E6 (issued):   Dr 2450, Cr deposit_bank_account

CREATE OR REPLACE FUNCTION public.clear_pdc(
  p_pdc_id             UUID,
  p_deposit_account_id UUID DEFAULT NULL   -- required for issued PDC clearing
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_company_id    UUID;
  v_pdc           public.pdc_cheques%ROWTYPE;
  v_lock_date     DATE;
  v_bank_coa_id   UUID;
  v_pdc_acc_id    UUID;  -- 1250 or 2450
  v_je_id         UUID;
  v_je_number     TEXT;
  v_dep_acc_id    UUID;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'clear_pdc: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_pdc FROM public.pdc_cheques WHERE id = p_pdc_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'clear_pdc: PDC % not found', p_pdc_id; END IF;

  IF v_pdc.type = 'received' AND v_pdc.status NOT IN ('pending', 'deposited') THEN
    RAISE EXCEPTION 'clear_pdc: received PDC must be pending/deposited to clear (status=%)', v_pdc.status;
  END IF;
  IF v_pdc.type = 'issued' AND v_pdc.status <> 'pending' THEN
    RAISE EXCEPTION 'clear_pdc: issued PDC must be pending to clear (status=%)', v_pdc.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_pdc.due_date <= v_lock_date THEN
    RAISE EXCEPTION 'clear_pdc: due_date % is in a locked period', v_pdc.due_date;
  END IF;

  -- Resolve deposit account (use stored one or override)
  v_dep_acc_id := COALESCE(p_deposit_account_id, v_pdc.deposit_account_id);
  IF v_dep_acc_id IS NULL THEN
    RAISE EXCEPTION 'clear_pdc: no deposit_account_id provided or stored on PDC';
  END IF;

  SELECT coa_account_id INTO v_bank_coa_id
    FROM public.bank_accounts WHERE id = v_dep_acc_id AND company_id = v_company_id;
  IF v_bank_coa_id IS NULL THEN
    RAISE EXCEPTION 'clear_pdc: deposit account has no COA link';
  END IF;

  -- Get PDC transit account
  IF v_pdc.type = 'received' THEN
    SELECT id INTO v_pdc_acc_id FROM public.chart_of_accounts
      WHERE company_id = v_company_id AND code = '1250' LIMIT 1;
    IF v_pdc_acc_id IS NULL THEN
      RAISE EXCEPTION 'clear_pdc: COA 1250 not found';
    END IF;
  ELSE
    SELECT id INTO v_pdc_acc_id FROM public.chart_of_accounts
      WHERE company_id = v_company_id AND code = '2450' LIMIT 1;
    IF v_pdc_acc_id IS NULL THEN
      RAISE EXCEPTION 'clear_pdc: COA 2450 not found';
    END IF;
  END IF;

  -- JE number
  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1000, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'JE-' || current_value::TEXT INTO v_je_number
    FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'JE';

  INSERT INTO public.journal_entries
    (company_id, je_number, date, source_type, source_id, description, posted_by, is_reversed)
  VALUES
    (v_company_id, v_je_number, COALESCE(v_pdc.due_date, CURRENT_DATE),
     'pdc_clear', p_pdc_id,
     'PDC Cleared: ' || v_pdc.pdc_number,
     v_user_id, FALSE)
  RETURNING id INTO v_je_id;

  IF v_pdc.type = 'received' THEN
    -- Dr bank, Cr 1250
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, debit, credit, description)
    VALUES
      (v_company_id, v_je_id, v_bank_coa_id,  v_pdc.amount, 0,             'PDC Cleared: ' || v_pdc.pdc_number),
      (v_company_id, v_je_id, v_pdc_acc_id,   0,             v_pdc.amount, 'PDC Cleared: ' || v_pdc.pdc_number);
  ELSE
    -- Dr 2450, Cr bank
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, debit, credit, description)
    VALUES
      (v_company_id, v_je_id, v_pdc_acc_id,   v_pdc.amount, 0,             'PDC Paid: ' || v_pdc.pdc_number),
      (v_company_id, v_je_id, v_bank_coa_id,  0,             v_pdc.amount, 'PDC Paid: ' || v_pdc.pdc_number);
  END IF;

  UPDATE public.pdc_cheques
     SET status = 'cleared', deposit_account_id = v_dep_acc_id, updated_at = NOW()
   WHERE id = p_pdc_id;

  INSERT INTO public.audit_logs (company_id, table_name, record_id, action, performed_by, new_data)
  VALUES (v_company_id, 'pdc_cheques', p_pdc_id, 'clear', v_user_id,
          jsonb_build_object('journal_entry_id', v_je_id));

  RETURN jsonb_build_object('pdc_id', p_pdc_id, 'status', 'cleared', 'journal_entry_id', v_je_id);
END;
$$;

-- ── bounce_pdc ─────────────────────────────────────────────────────────────
-- E4: Dr 1260 Bounced Cheques, Cr 1250 PDC Receivable (received PDCs only)

CREATE OR REPLACE FUNCTION public.bounce_pdc(p_pdc_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id      UUID := auth.uid();
  v_company_id   UUID;
  v_pdc          public.pdc_cheques%ROWTYPE;
  v_lock_date    DATE;
  v_bounced_id   UUID;
  v_pdc_recv_id  UUID;
  v_je_id        UUID;
  v_je_number    TEXT;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'bounce_pdc: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_pdc FROM public.pdc_cheques WHERE id = p_pdc_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'bounce_pdc: PDC % not found', p_pdc_id; END IF;
  IF v_pdc.type <> 'received' THEN
    RAISE EXCEPTION 'bounce_pdc: only received PDCs can bounce';
  END IF;
  IF v_pdc.status NOT IN ('pending', 'deposited') THEN
    RAISE EXCEPTION 'bounce_pdc: PDC must be pending/deposited to bounce (status=%)', v_pdc.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND CURRENT_DATE <= v_lock_date THEN
    RAISE EXCEPTION 'bounce_pdc: posting date is in a locked period';
  END IF;

  SELECT id INTO v_bounced_id FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND code = '1260' LIMIT 1;
  IF v_bounced_id IS NULL THEN
    RAISE EXCEPTION 'bounce_pdc: COA 1260 (Bounced Cheques) not found';
  END IF;

  SELECT id INTO v_pdc_recv_id FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND code = '1250' LIMIT 1;
  IF v_pdc_recv_id IS NULL THEN
    RAISE EXCEPTION 'bounce_pdc: COA 1250 not found';
  END IF;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1000, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'JE-' || current_value::TEXT INTO v_je_number
    FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'JE';

  INSERT INTO public.journal_entries
    (company_id, je_number, date, source_type, source_id, description, posted_by, is_reversed)
  VALUES
    (v_company_id, v_je_number, CURRENT_DATE,
     'pdc_bounce', p_pdc_id,
     'PDC Bounced: ' || v_pdc.pdc_number,
     v_user_id, FALSE)
  RETURNING id INTO v_je_id;

  -- Dr 1260 Bounced Cheques, Cr 1250 PDC Receivable
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, debit, credit, description)
  VALUES
    (v_company_id, v_je_id, v_bounced_id,  v_pdc.amount, 0,             'Bounced PDC: ' || v_pdc.pdc_number),
    (v_company_id, v_je_id, v_pdc_recv_id, 0,             v_pdc.amount, 'Bounced PDC: ' || v_pdc.pdc_number);

  UPDATE public.pdc_cheques SET status = 'bounced', updated_at = NOW() WHERE id = p_pdc_id;

  INSERT INTO public.audit_logs (company_id, table_name, record_id, action, performed_by, new_data)
  VALUES (v_company_id, 'pdc_cheques', p_pdc_id, 'bounce', v_user_id,
          jsonb_build_object('journal_entry_id', v_je_id));

  RETURN jsonb_build_object('pdc_id', p_pdc_id, 'status', 'bounced', 'journal_entry_id', v_je_id);
END;
$$;

-- ── cancel_pdc ─────────────────────────────────────────────────────────────
-- Reverses the creation JE and marks status='cancelled'
-- Works for both received (reversal: Dr 1200/2400, Cr 1250) and issued (Dr 2450, Cr 2100)

CREATE OR REPLACE FUNCTION public.cancel_pdc(p_pdc_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_pdc        public.pdc_cheques%ROWTYPE;
  v_lock_date  DATE;
  v_je         RECORD;
  v_rev_je_id  UUID;
  v_rev_je_num TEXT;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'cancel_pdc: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_pdc FROM public.pdc_cheques WHERE id = p_pdc_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'cancel_pdc: PDC % not found', p_pdc_id; END IF;
  IF v_pdc.status NOT IN ('pending', 'deposited') THEN
    RAISE EXCEPTION 'cancel_pdc: cannot cancel PDC in status %', v_pdc.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_pdc.issue_date <= v_lock_date THEN
    RAISE EXCEPTION 'cancel_pdc: issue_date % is in a locked period', v_pdc.issue_date;
  END IF;

  SELECT * INTO v_je
    FROM public.journal_entries
   WHERE source_type = 'pdc_creation' AND source_id = p_pdc_id
     AND company_id = v_company_id AND is_reversed = FALSE
   ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancel_pdc: no live creation JE found for PDC %', p_pdc_id;
  END IF;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1000, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW();
  SELECT 'JE-' || current_value::TEXT INTO v_rev_je_num
    FROM public.document_sequences WHERE company_id = v_company_id AND prefix = 'JE';

  INSERT INTO public.journal_entries
    (company_id, je_number, date, source_type, source_id, description, posted_by, is_reversed, reversal_of_id)
  VALUES
    (v_company_id, v_rev_je_num, CURRENT_DATE,
     'pdc_creation', p_pdc_id,
     'CANCELLED PDC: ' || v_pdc.pdc_number,
     v_user_id, TRUE, v_je.id)
  RETURNING id INTO v_rev_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, debit, credit, description)
  SELECT v_company_id, v_rev_je_id, account_id, credit, debit, 'CANCEL: ' || description
    FROM public.general_ledger WHERE journal_entry_id = v_je.id;

  UPDATE public.journal_entries SET is_reversed = TRUE WHERE id = v_je.id;
  UPDATE public.pdc_cheques SET status = 'cancelled', updated_at = NOW() WHERE id = p_pdc_id;

  INSERT INTO public.audit_logs (company_id, table_name, record_id, action, performed_by, new_data)
  VALUES (v_company_id, 'pdc_cheques', p_pdc_id, 'cancel', v_user_id,
          jsonb_build_object('reversal_je_id', v_rev_je_id));

  RETURN jsonb_build_object('pdc_id', p_pdc_id, 'status', 'cancelled', 'reversal_je_id', v_rev_je_id);
END;
$$;
