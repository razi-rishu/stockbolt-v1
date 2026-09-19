-- ============================================================================
-- Phase 78 (R5a) — Refunding a credit balance on Accounts Receivable
--
-- PROBLEM
-- A customer pays 1,000 and then returns the goods. The credit note posts
-- Dr 4100 / Cr 1200, so their receivable is now MINUS 1,000: we hold their
-- money. There is no way to give it back.
--
--   * confirm_customer_refund (phase 68) posts Dr 2400 / Cr bank and reads its
--     ceiling from the 2400 ledger. A credit sitting in 1200 is invisible to
--     it. 2400 is money taken BEFORE a sale; this is money owed AFTER one.
--   * confirm_payment hard-rejects anything that is not 'inbound'.
--   * apply_advance moves 2400, not 1200.
--
-- Confirmed against live: no journal entry anywhere debits 1200 and credits a
-- bank or cash account, and only four engines have ever touched 1200 at all --
-- sales_invoice, customer_receipt, sales_credit_note, advance_application.
-- The combination outbound + on_account + customer is legal in the schema and
-- has no engine, so nothing is being taken from anything.
--
-- The only exits today are "leave it on account forever" or a hand-written
-- journal entry.
--
-- WHAT THIS ADDS
-- An ordinary payments row the schema already permits -- type='outbound',
-- classification='on_account', contact = the customer. No new table, no new
-- column, no CHECK change.
--
--   confirm_customer_credit_refund   Dr 1200 (contact) / Cr bank
--   void_customer_credit_refund      mirrors every leg back, at the voucher date
--
-- HOW MUCH CAN BE REFUNDED
-- SUM(credit - debit) on 1200 for that contact -- their NET position, not the
-- size of the credit note. This matters: a customer holding a 1,000 credit who
-- also has a 3,000 unpaid invoice nets to MINUS 2,000, so no refund is
-- allowed, and the answer is to apply the credit against the invoice instead.
-- Paying cash to someone who owes you more than they are owed is not a refund,
-- it is a loan. The ceiling gives that for free rather than needing a rule.
--
-- DOUBLE ENTRY
-- Composed through post_journal_entry, so balance, period lock, JE numbering
-- and the audit row all come from the one primitive rather than being
-- re-implemented. void_customer_credit_refund mirrors each original leg with
-- debit and credit swapped, at the ORIGINAL date (phase 43), which balances by
-- construction. Above both, je_must_balance -- a DEFERRABLE CONSTRAINT TRIGGER
-- on general_ledger checked at COMMIT -- makes an unbalanced entry impossible
-- to commit by any path.
--
-- The 1200 leg carries contact_id, because 1200 is a control account and the
-- B3 invariant (phase 70) requires control-account lines to name their party.
-- Without it the AR control and the customer statement would diverge by the
-- refund. The bank leg carries it too, matching phase 68.
--
-- NOT TOUCHED
-- confirm_payment, confirm_vendor_payment, void_payment, reopen_payment,
-- apply_advance, confirm_customer_refund, void_customer_refund,
-- confirm_credit_note. This is a standalone document alongside them, the same
-- discipline phase 68 and the TDS work used. Tripwires assert the advance
-- refund never learns about 1200 and this one never learns about 2400, so the
-- two can never start refunding the same money twice.
--
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.void_customer_credit_refund(uuid, text);
--   DROP FUNCTION IF EXISTS public.confirm_customer_credit_refund(uuid);
--
-- Additive and idempotent. Safe to re-run.
-- ============================================================================


-- ============================================================================
-- confirm_customer_credit_refund
-- ============================================================================
CREATE OR REPLACE FUNCTION public.confirm_customer_credit_refund(p_payment_id uuid)
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
    RAISE EXCEPTION 'confirm_customer_credit_refund: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_pmt FROM public.payments
   WHERE id = p_payment_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_customer_credit_refund: payment % not found', p_payment_id;
  END IF;
  IF v_pmt.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_customer_credit_refund: payment % is not draft (status=%)',
      p_payment_id, v_pmt.status;
  END IF;

  -- Shape guards. classification='on_account' is what separates this from the
  -- advance refund, which is 'advance'. One document cannot be mistaken for
  -- the other, so the two ceilings can never be applied to the same money.
  IF v_pmt.type <> 'outbound' THEN
    RAISE EXCEPTION 'confirm_customer_credit_refund: expects an outbound payment (type=%)', v_pmt.type;
  END IF;
  IF v_pmt.classification <> 'on_account' THEN
    RAISE EXCEPTION 'confirm_customer_credit_refund: expects classification=on_account (got %). An advance is refunded with confirm_customer_refund.',
      v_pmt.classification;
  END IF;
  IF COALESCE(v_pmt.amount, 0) <= 0 THEN
    RAISE EXCEPTION 'confirm_customer_credit_refund: amount must be positive (got %)', v_pmt.amount;
  END IF;
  IF v_pmt.bank_account_id IS NULL THEN
    RAISE EXCEPTION 'confirm_customer_credit_refund: a bank or cash account is required — the money has to leave one';
  END IF;

  SELECT * INTO v_contact FROM public.contacts
   WHERE id = v_pmt.contact_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_customer_credit_refund: contact % not found', v_pmt.contact_id;
  END IF;
  IF v_contact.type NOT IN ('customer', 'both') THEN
    RAISE EXCEPTION 'confirm_customer_credit_refund: % is not a customer (type=%)',
      v_contact.name, v_contact.type;
  END IF;

  -- Period lock on the VOUCHER date (phase 43), not today.
  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_pmt.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_customer_credit_refund: date % is on or before the period lock %',
      v_pmt.date, v_lock_date;
  END IF;

  SELECT ba.coa_account_id, coa.code
    INTO v_bank_coa_id, v_bank_code
  FROM public.bank_accounts ba
  JOIN public.chart_of_accounts coa ON coa.id = ba.coa_account_id
  WHERE ba.id = v_pmt.bank_account_id AND ba.company_id = v_company_id;
  IF v_bank_coa_id IS NULL THEN
    RAISE EXCEPTION 'confirm_customer_credit_refund: bank account % has no GL account',
      v_pmt.bank_account_id;
  END IF;

  v_amount := ROUND(v_pmt.amount * COALESCE(v_pmt.exchange_rate, 1), 2);

  -- Ceiling = the customer's NET position on 1200. Unpaid invoices reduce it,
  -- so a customer who owes more than they are owed cannot be refunded at all --
  -- the credit gets applied against the invoice instead.
  SELECT COALESCE(SUM(gl.credit - gl.debit), 0)::NUMERIC(15,2)
    INTO v_available
  FROM public.general_ledger gl
  WHERE gl.company_id   = v_company_id
    AND gl.contact_id   = v_pmt.contact_id
    AND gl.account_code = '1200';

  IF v_available <= 0 THEN
    RAISE EXCEPTION 'confirm_customer_credit_refund: % has no credit balance to refund (net position %). Apply the credit against an open invoice instead.',
      v_contact.name, v_available;
  END IF;
  IF v_amount > v_available THEN
    RAISE EXCEPTION 'confirm_customer_credit_refund: refund % exceeds the % credit balance held for %',
      v_amount, v_available, v_contact.name;
  END IF;

  v_desc := 'Customer Credit Refund ' || v_pmt.payment_number;

  -- Dr 1200 Accounts Receivable (contact-attributed) / Cr bank.
  v_res := public.post_journal_entry(jsonb_build_object(
    'date',          v_pmt.date,
    'description',   v_desc,
    'source_type',   'customer_credit_refund',
    'source_id',     p_payment_id,
    'currency',      v_pmt.currency,
    'exchange_rate', COALESCE(v_pmt.exchange_rate, 1),
    'lines', jsonb_build_array(
      jsonb_build_object(
        'account_code', '1200',
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
    VALUES (v_company_id, v_user_id, 'confirm', 'customer_credit_refund', p_payment_id,
      jsonb_build_object(
        'payment_number',  v_pmt.payment_number,
        'contact_id',      v_pmt.contact_id,
        'amount',          v_amount,
        'credit_before',   v_available,
        'credit_after',    v_available - v_amount,
        'journal_entry_id', v_je_id));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'payment_id',       p_payment_id,
    'payment_number',   v_pmt.payment_number,
    'journal_entry_id', v_je_id,
    'entry_number',     v_res ->> 'entry_number',
    'amount',           v_amount,
    'remaining',        v_available - v_amount);
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_customer_credit_refund(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_customer_credit_refund(uuid) TO authenticated;


-- ============================================================================
-- void_customer_credit_refund
-- ============================================================================
-- Mirrors every leg of the refund JE with debit and credit swapped, at the
-- ORIGINAL entry's date. reverse_journal_entry posts at CURRENT_DATE and must
-- not be used here.
CREATE OR REPLACE FUNCTION public.void_customer_credit_refund(
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
    RAISE EXCEPTION 'void_customer_credit_refund: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_pmt FROM public.payments
   WHERE id = p_payment_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'void_customer_credit_refund: payment % not found', p_payment_id;
  END IF;
  IF v_pmt.status <> 'confirmed' THEN
    RAISE EXCEPTION 'void_customer_credit_refund: payment % is not confirmed (status=%)',
      p_payment_id, v_pmt.status;
  END IF;
  IF v_pmt.type <> 'outbound' OR v_pmt.classification <> 'on_account' THEN
    RAISE EXCEPTION 'void_customer_credit_refund: % is not a customer credit refund (type=%, classification=%)',
      p_payment_id, v_pmt.type, v_pmt.classification;
  END IF;

  -- Same guard void_payment uses: a reconciled line must be un-reconciled
  -- first, otherwise the reconciliation would reference a reversed posting.
  IF EXISTS (
    SELECT 1 FROM public.general_ledger gl
    JOIN public.journal_entries je ON je.id = gl.journal_entry_id
    WHERE je.company_id = v_company_id
      AND je.source_id  = p_payment_id
      AND gl.reconciliation_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'void_customer_credit_refund: refund % is bank-reconciled. Un-reconcile it first, then void.',
      p_payment_id;
  END IF;

  SELECT * INTO v_je FROM public.journal_entries
   WHERE company_id     = v_company_id
     AND source_id      = p_payment_id
     AND source_type    = 'customer_credit_refund'
     AND reversed_by_id IS NULL
     AND reversal_of_id IS NULL
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'void_customer_credit_refund: no live journal entry found for refund %', p_payment_id;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_je.date <= v_lock_date THEN
    RAISE EXCEPTION 'void_customer_credit_refund: the original posting dated % is in a locked period (lock %)',
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
    COALESCE(p_reason, 'Void customer credit refund – ' || v_pmt.payment_number),
    'customer_credit_refund', p_payment_id, v_je.currency, v_je.exchange_rate,
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
      COALESCE(p_reason, 'Void customer credit refund – ' || v_pmt.payment_number),
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
    VALUES (v_company_id, v_user_id, 'void', 'customer_credit_refund', p_payment_id,
      jsonb_build_object('payment_number', v_pmt.payment_number,
                         'reason', p_reason, 'reversal_entry', v_rev_entry));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'payment_id',       p_payment_id,
    'journal_entry_id', v_rev_id,
    'entry_number',     v_rev_entry);
END;
$function$;

REVOKE ALL ON FUNCTION public.void_customer_credit_refund(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_customer_credit_refund(uuid, text) TO authenticated;


NOTIFY pgrst, 'reload schema';
