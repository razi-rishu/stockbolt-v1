-- ============================================================================
-- Phase 68 (S2) — Customer refund of an advance
--
-- PROBLEM
-- A customer pays 200 in advance, then cancels part of the order before any
-- invoice exists, and wants 50 back. Today there is no way to do that:
--
--   * A sales return reverses an INVOICE and restocks goods. There is no
--     invoice and no goods movement, so it would fabricate both.
--   * A manual journal entry cannot name the customer — the JE editor has no
--     party field — so the 2400 line would land with contact_id NULL. Account
--     2400 would fall by 50 while the customer still showed 200 on file, and
--     the control account would silently diverge from the sub-ledger. (The
--     missing party field is fixed separately in S5.)
--   * confirm_payment hard-rejects anything that is not 'inbound', and
--     confirm_vendor_payment hard-rejects anything that is not 'outbound'.
--     The payment layer splits by DIRECTION and assumes direction implies
--     party type, so "money out, to a customer" has no home.
--
-- WHAT THIS ADDS
-- A customer refund is an ordinary payments row that the schema already
-- permits — type='outbound', classification='advance', contact = the customer.
-- No new table, no new column, no CHECK change.
--
--   confirm_customer_refund  Dr 2400 (contact) / Cr bank
--   void_customer_refund     mirrors every leg back, at the voucher date
--
-- DOUBLE ENTRY
-- confirm_customer_refund composes post_journal_entry, so balance, period lock,
-- JE numbering and the audit row all come from the one primitive rather than
-- being re-implemented. void_customer_refund mirrors each original leg with
-- debit and credit swapped, which balances by construction. Above both,
-- je_must_balance (a DEFERRABLE CONSTRAINT TRIGGER on general_ledger, checked
-- at COMMIT) makes an unbalanced entry impossible to commit by any path.
--
-- HOW MUCH CAN BE REFUNDED
-- The ceiling is the customer's advance balance read from the LEDGER --
-- SUM(credit - debit) on 2400 for that contact -- the same figure
-- contacts.getAdvanceBalance shows. Phase 67 (S1) made apply_advance respect
-- the same number, so a refund and a later application cannot together exceed
-- what the customer actually has on file.
--
-- NOT TOUCHED
-- confirm_payment, confirm_vendor_payment, void_payment, reopen_payment,
-- apply_advance. A refund is a standalone document alongside them, the same
-- discipline used for TDS. A tripwire asserts those five stay ignorant of
-- refunds, so a future change cannot start refunding inside them and
-- double-count.
--
-- Additive and idempotent. Safe to re-run.
-- ============================================================================


-- ============================================================================
-- confirm_customer_refund
-- ============================================================================

CREATE OR REPLACE FUNCTION public.confirm_customer_refund(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id     UUID := auth.uid();
  v_company_id  UUID;
  v_pmt         public.payments%ROWTYPE;
  v_contact     public.contacts%ROWTYPE;
  v_lock_date   DATE;
  v_bank_coa_id UUID;
  v_bank_code   TEXT;
  v_amount      NUMERIC(15,2);
  v_available   NUMERIC(15,2);
  v_desc        TEXT;
  v_res         JSONB;
  v_je_id       UUID;
BEGIN
  PERFORM public.auth_require('accounting.write');

  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_customer_refund: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_pmt FROM public.payments
   WHERE id = p_payment_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_customer_refund: payment % not found', p_payment_id;
  END IF;
  IF v_pmt.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_customer_refund: payment % is not draft (status=%)',
      p_payment_id, v_pmt.status;
  END IF;

  -- Shape guards. These keep the refund a distinct document rather than a
  -- variant of a receipt or a vendor payment.
  IF v_pmt.type <> 'outbound' THEN
    RAISE EXCEPTION 'confirm_customer_refund: expects an outbound payment (type=%)', v_pmt.type;
  END IF;
  IF v_pmt.classification <> 'advance' THEN
    RAISE EXCEPTION 'confirm_customer_refund: expects classification=advance (got %)', v_pmt.classification;
  END IF;
  IF COALESCE(v_pmt.amount, 0) <= 0 THEN
    RAISE EXCEPTION 'confirm_customer_refund: amount must be positive (got %)', v_pmt.amount;
  END IF;
  IF v_pmt.bank_account_id IS NULL THEN
    RAISE EXCEPTION 'confirm_customer_refund: a bank or cash account is required — the money has to leave one';
  END IF;

  -- The money must be going back to a CUSTOMER. Without this a refund could be
  -- aimed at a supplier and would hit the wrong control account.
  SELECT * INTO v_contact FROM public.contacts
   WHERE id = v_pmt.contact_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_customer_refund: contact % not found', v_pmt.contact_id;
  END IF;
  IF v_contact.type NOT IN ('customer', 'both') THEN
    RAISE EXCEPTION 'confirm_customer_refund: % is not a customer (type=%) — use the vendor refund instead',
      v_contact.name, v_contact.type;
  END IF;

  -- Period lock on the VOUCHER date (phase 43), not today.
  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_pmt.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_customer_refund: date % is on or before the period lock %',
      v_pmt.date, v_lock_date;
  END IF;

  SELECT ba.coa_account_id, coa.code
    INTO v_bank_coa_id, v_bank_code
  FROM public.bank_accounts ba
  JOIN public.chart_of_accounts coa ON coa.id = ba.coa_account_id
  WHERE ba.id = v_pmt.bank_account_id AND ba.company_id = v_company_id;
  IF v_bank_coa_id IS NULL THEN
    RAISE EXCEPTION 'confirm_customer_refund: bank account % has no GL account',
      v_pmt.bank_account_id;
  END IF;

  v_amount := ROUND(v_pmt.amount * COALESCE(v_pmt.exchange_rate, 1), 2);

  -- Ceiling = what the customer actually has on file, read from the ledger.
  -- Same figure contacts.getAdvanceBalance reports, and the same figure phase
  -- 67 made apply_advance respect — so a refund and a later application cannot
  -- together exceed the balance.
  SELECT COALESCE(SUM(gl.credit - gl.debit), 0)::NUMERIC(15,2)
    INTO v_available
  FROM public.general_ledger gl
  WHERE gl.company_id   = v_company_id
    AND gl.contact_id   = v_pmt.contact_id
    AND gl.account_code = '2400';

  IF v_amount > v_available THEN
    RAISE EXCEPTION 'confirm_customer_refund: refund % exceeds the advance balance % held for %',
      v_amount, v_available, v_contact.name;
  END IF;

  v_desc := 'Customer Refund ' || v_pmt.payment_number;

  -- Dr 2400 Customer Advances (contact-attributed) / Cr bank.
  -- Composed through post_journal_entry: balance, period lock, JE numbering and
  -- the audit row all come from the primitive.
  v_res := public.post_journal_entry(jsonb_build_object(
    'date',          v_pmt.date,
    'description',   v_desc,
    'source_type',   'customer_refund',
    'source_id',     p_payment_id,
    'currency',      v_pmt.currency,
    'exchange_rate', COALESCE(v_pmt.exchange_rate, 1),
    'lines', jsonb_build_array(
      jsonb_build_object(
        'account_code', '2400',
        'debit',        v_amount,
        'credit',       0,
        'description',  v_desc,
        'contact_id',   v_pmt.contact_id
      ),
      jsonb_build_object(
        'account_code', v_bank_code,
        'debit',        0,
        'credit',       v_amount,
        'description',  v_desc,
        'contact_id',   v_pmt.contact_id
      )
    )
  ));
  v_je_id := (v_res ->> 'journal_entry_id')::UUID;

  UPDATE public.payments
     SET status = 'confirmed', updated_at = NOW()
   WHERE id = p_payment_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'customer_refund', p_payment_id,
      jsonb_build_object(
        'payment_number',   v_pmt.payment_number,
        'contact_id',       v_pmt.contact_id,
        'amount',           v_amount,
        'advance_before',   v_available,
        'advance_after',    v_available - v_amount,
        'entry_number',     v_res ->> 'entry_number',
        'phase',            '68'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'payment_id',       p_payment_id,
    'payment_number',   v_pmt.payment_number,
    'journal_entry_id', v_je_id,
    'entry_number',     v_res ->> 'entry_number',
    'amount',           v_amount,
    'advance_after',    v_available - v_amount
  );
END;
$function$;

REVOKE ALL    ON FUNCTION public.confirm_customer_refund(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_customer_refund(uuid) TO authenticated;


-- ============================================================================
-- void_customer_refund
--
-- Mirrors every leg of the refund JE with debit and credit swapped, at the
-- ORIGINAL line's date (phase 43 — never CURRENT_DATE). reverse_journal_entry
-- is deliberately NOT used: it posts the reversal at today's date, which would
-- move the correction into a different period from the refund it reverses.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.void_customer_refund(
  p_payment_id uuid,
  p_reason     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_pmt        public.payments%ROWTYPE;
  v_je         public.journal_entries%ROWTYPE;
  v_gl         public.general_ledger%ROWTYPE;
  v_lock_date  DATE;
  v_seq        BIGINT;
  v_rev_entry  TEXT;
  v_rev_id     UUID;
BEGIN
  PERFORM public.auth_require('accounting.write');

  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'void_customer_refund: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_pmt FROM public.payments
   WHERE id = p_payment_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'void_customer_refund: payment % not found', p_payment_id;
  END IF;
  IF v_pmt.status <> 'confirmed' THEN
    RAISE EXCEPTION 'void_customer_refund: payment % is not confirmed (status=%)',
      p_payment_id, v_pmt.status;
  END IF;
  IF v_pmt.type <> 'outbound' OR v_pmt.classification <> 'advance' THEN
    RAISE EXCEPTION 'void_customer_refund: % is not a customer refund (type=%, classification=%)',
      p_payment_id, v_pmt.type, v_pmt.classification;
  END IF;

  -- Same guard void_payment uses: a reconciled line must be un-reconciled first,
  -- otherwise the reconciliation would reference a reversed posting.
  IF EXISTS (
    SELECT 1 FROM public.general_ledger gl
    JOIN public.journal_entries je ON je.id = gl.journal_entry_id
    WHERE je.company_id = v_company_id
      AND je.source_id  = p_payment_id
      AND gl.reconciliation_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'void_customer_refund: refund % is bank-reconciled. Un-reconcile it first, then void.',
      p_payment_id;
  END IF;

  SELECT * INTO v_je FROM public.journal_entries
   WHERE company_id     = v_company_id
     AND source_id      = p_payment_id
     AND source_type    = 'customer_refund'
     AND reversed_by_id IS NULL
     AND reversal_of_id IS NULL
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'void_customer_refund: no live journal entry found for refund %', p_payment_id;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_je.date <= v_lock_date THEN
    RAISE EXCEPTION 'void_customer_refund: the original posting dated % is in a locked period (lock %)',
      v_je.date, v_lock_date;
  END IF;

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
    v_company_id, v_rev_entry, v_je.date,
    COALESCE(p_reason, 'Void customer refund – ' || v_pmt.payment_number),
    'customer_refund', p_payment_id, v_je.currency, v_je.exchange_rate,
    v_je.total_credit, v_je.total_debit, v_je.id, v_user_id
  ) RETURNING id INTO v_rev_id;

  -- Swap debit and credit on every leg. Balanced by construction, and
  -- je_must_balance re-checks it at COMMIT regardless.
  FOR v_gl IN SELECT * FROM public.general_ledger WHERE journal_entry_id = v_je.id LOOP
    INSERT INTO public.general_ledger (
      company_id, journal_entry_id, account_id, account_code, date,
      debit, credit, description,
      contact_id, related_doc_type, related_doc_id, reversal_of_id
    ) VALUES (
      v_company_id, v_rev_id, v_gl.account_id, v_gl.account_code, v_gl.date,
      v_gl.credit, v_gl.debit,
      COALESCE(p_reason, 'Void customer refund – ' || v_pmt.payment_number),
      v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
    );
  END LOOP;

  UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;

  UPDATE public.payments
     SET status      = 'void',
         void_reason = p_reason,
         voided_at   = NOW(),
         voided_by   = v_user_id,
         updated_at  = NOW()
   WHERE id = p_payment_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'void', 'customer_refund', p_payment_id,
      jsonb_build_object(
        'payment_number',  v_pmt.payment_number,
        'reason',          p_reason,
        'reversal_entry',  v_rev_entry,
        'reversed_je',     v_je.entry_number,
        'phase',           '68'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'payment_id',      p_payment_id,
    'reversal_je_id',  v_rev_id,
    'reversal_entry',  v_rev_entry
  );
END;
$function$;

REVOKE ALL    ON FUNCTION public.void_customer_refund(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_customer_refund(uuid, text) TO authenticated;
