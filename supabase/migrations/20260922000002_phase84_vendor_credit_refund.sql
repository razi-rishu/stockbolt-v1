-- ============================================================================
-- Phase 84 — Receiving money back from a supplier
--
-- THE GAP
-- Return goods against a bill you have ALREADY PAID and the debit note posts
-- Dr 2100 / Cr 1300, pushing Accounts Payable into a DEBIT balance: the
-- supplier now owes you. There was no way to take that money back.
--
--   confirm_payment          demands inbound AND a customer  (phase 69 guard)
--   confirm_vendor_payment   demands outbound AND a supplier (phase 69 guard)
--   confirm_vendor_refund    empties 1400 Vendor Advances, not 2100
--
-- So "money coming IN from a supplier" had no engine. Every function that
-- touches 2100 alongside a bank account pays money OUT. The combination
-- inbound + on_account + supplier is legal in the schema and unreachable,
-- which is exactly the free slot phase 78 used on the customer side.
--
-- This is the vendor mirror of phase 78. Same shape, opposite direction:
--
--   phase 78   confirm_customer_credit_refund   Dr 1200 / Cr bank   (we pay out)
--   phase 84   confirm_vendor_credit_refund     Dr bank / Cr 2100   (we take in)
--
-- HOW MUCH CAN BE TAKEN BACK
-- SUM(debit - credit) on 2100 for that contact -- their NET position, not the
-- size of the debit note. A supplier owed 3,000 on other unpaid bills who
-- also owes you 1,000 back nets to a CREDIT balance, so no refund is allowed
-- and the right move is to offset the debit note against the open bill.
-- Taking cash from someone you still owe more to is not a refund, it is a
-- loan in the other direction. Reading the ledger gives that for free.
--
-- DOUBLE ENTRY
-- Composed through post_journal_entry, so balance, period lock, JE numbering
-- and the audit row all come from the one primitive. The void mirrors each leg
-- with debit and credit swapped, at the ORIGINAL date (phase 43), never
-- CURRENT_DATE. je_must_balance re-checks at COMMIT regardless.
--
-- The 2100 leg carries contact_id: it is a control account and B3 (phase 70)
-- requires it, or the AP control and the supplier statement diverge.
--
-- CURRENCY
-- v_amount multiplies by exchange_rate, matching phase 78 and confirm_payment.
-- Most engines in this codebase still do not -- that is a known, separate gap
-- -- but a new one should not add to it.
--
-- GRANTS
-- Revoked FROM PUBLIC **and anon**. Phase 78 revoked only from PUBLIC and left
-- anon's direct grant in place; phase 82 had to clean that up. Not repeating it.
--
-- REGIONS
-- Nothing region-specific. AP behaves identically under GCC VAT and India GST;
-- no tax account is touched -- the tax was already reversed by the debit note.
--
-- NOT TOUCHED
-- confirm_payment, confirm_vendor_payment, void_payment, reopen_payment,
-- apply_vendor_advance, confirm_vendor_refund, confirm_debit_note. Standalone
-- document alongside them, same discipline as phase 78.
--
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.void_vendor_credit_refund(uuid, text);
--   DROP FUNCTION IF EXISTS public.confirm_vendor_credit_refund(uuid);
--
-- Additive and idempotent. Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.confirm_vendor_credit_refund(p_payment_id uuid)
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
    RAISE EXCEPTION 'confirm_vendor_credit_refund: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_pmt FROM public.payments
   WHERE id = p_payment_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_vendor_credit_refund: payment % not found', p_payment_id;
  END IF;
  IF v_pmt.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_vendor_credit_refund: payment % is not draft (status=%)',
      p_payment_id, v_pmt.status;
  END IF;

  -- Shape guards. inbound + on_account is what separates this from a vendor
  -- payment (outbound) and from an advance refund (classification=advance).
  IF v_pmt.type <> 'inbound' THEN
    RAISE EXCEPTION 'confirm_vendor_credit_refund: expects an inbound payment (type=%) - money is coming back TO us', v_pmt.type;
  END IF;
  IF v_pmt.classification <> 'on_account' THEN
    RAISE EXCEPTION 'confirm_vendor_credit_refund: expects classification=on_account (got %). An advance is refunded with confirm_vendor_refund.',
      v_pmt.classification;
  END IF;
  IF COALESCE(v_pmt.amount, 0) <= 0 THEN
    RAISE EXCEPTION 'confirm_vendor_credit_refund: amount must be positive (got %)', v_pmt.amount;
  END IF;
  IF v_pmt.bank_account_id IS NULL THEN
    RAISE EXCEPTION 'confirm_vendor_credit_refund: a bank or cash account is required - the money has to arrive somewhere';
  END IF;

  SELECT * INTO v_contact FROM public.contacts
   WHERE id = v_pmt.contact_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_vendor_credit_refund: contact % not found', v_pmt.contact_id;
  END IF;
  IF v_contact.type NOT IN ('supplier', 'both') THEN
    RAISE EXCEPTION 'confirm_vendor_credit_refund: % is not a supplier (type=%)',
      v_contact.name, v_contact.type;
  END IF;

  -- Period lock on the VOUCHER date (phase 43), not today.
  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_pmt.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_vendor_credit_refund: date % is on or before the period lock %',
      v_pmt.date, v_lock_date;
  END IF;

  SELECT ba.coa_account_id, coa.code
    INTO v_bank_coa_id, v_bank_code
  FROM public.bank_accounts ba
  JOIN public.chart_of_accounts coa ON coa.id = ba.coa_account_id
  WHERE ba.id = v_pmt.bank_account_id AND ba.company_id = v_company_id;
  IF v_bank_coa_id IS NULL THEN
    RAISE EXCEPTION 'confirm_vendor_credit_refund: bank account % has no GL account',
      v_pmt.bank_account_id;
  END IF;

  v_amount := ROUND(v_pmt.amount * COALESCE(v_pmt.exchange_rate, 1), 2);

  -- Ceiling = the supplier's NET position on 2100. Open unpaid bills reduce it,
  -- so a supplier you still owe money to cannot refund you cash - the debit
  -- note gets offset against the open bill instead.
  SELECT COALESCE(SUM(gl.debit - gl.credit), 0)::NUMERIC(15,2)
    INTO v_available
  FROM public.general_ledger gl
  WHERE gl.company_id   = v_company_id
    AND gl.contact_id   = v_pmt.contact_id
    AND gl.account_code = '2100';

  IF v_available <= 0 THEN
    RAISE EXCEPTION 'confirm_vendor_credit_refund: % does not owe you anything (net position %). Offset the debit note against an open bill instead.',
      v_contact.name, v_available;
  END IF;
  IF v_amount > v_available THEN
    RAISE EXCEPTION 'confirm_vendor_credit_refund: refund % exceeds the % owed back by %',
      v_amount, v_available, v_contact.name;
  END IF;

  v_desc := 'Vendor Credit Refund ' || v_pmt.payment_number;

  -- Dr bank / Cr 2100 Accounts Payable (contact-attributed).
  v_res := public.post_journal_entry(jsonb_build_object(
    'date',          v_pmt.date,
    'description',   v_desc,
    'source_type',   'vendor_credit_refund',
    'source_id',     p_payment_id,
    'currency',      v_pmt.currency,
    'exchange_rate', COALESCE(v_pmt.exchange_rate, 1),
    'lines', jsonb_build_array(
      jsonb_build_object(
        'account_code', v_bank_code,
        'debit',        v_amount,
        'credit',       0,
        'description',  v_desc,
        'contact_id',   v_pmt.contact_id
      ),
      jsonb_build_object(
        'account_code', '2100',
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
    VALUES (v_company_id, v_user_id, 'confirm', 'vendor_credit_refund', p_payment_id,
      jsonb_build_object(
        'payment_number',   v_pmt.payment_number,
        'contact_id',       v_pmt.contact_id,
        'amount',           v_amount,
        'owed_before',      v_available,
        'owed_after',       v_available - v_amount,
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

REVOKE ALL    ON FUNCTION public.confirm_vendor_credit_refund(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_vendor_credit_refund(uuid) TO authenticated;


-- ============================================================================
-- void_vendor_credit_refund — mirror every leg, at the ORIGINAL date
-- ============================================================================
CREATE OR REPLACE FUNCTION public.void_vendor_credit_refund(
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
    RAISE EXCEPTION 'void_vendor_credit_refund: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_pmt FROM public.payments
   WHERE id = p_payment_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'void_vendor_credit_refund: payment % not found', p_payment_id;
  END IF;
  IF v_pmt.status <> 'confirmed' THEN
    RAISE EXCEPTION 'void_vendor_credit_refund: payment % is not confirmed (status=%)',
      p_payment_id, v_pmt.status;
  END IF;
  IF v_pmt.type <> 'inbound' OR v_pmt.classification <> 'on_account' THEN
    RAISE EXCEPTION 'void_vendor_credit_refund: % is not a vendor credit refund (type=%, classification=%)',
      p_payment_id, v_pmt.type, v_pmt.classification;
  END IF;

  -- Same guard void_payment uses: a reconciled line must be un-reconciled first.
  IF EXISTS (
    SELECT 1 FROM public.general_ledger gl
    JOIN public.journal_entries je ON je.id = gl.journal_entry_id
    WHERE je.company_id = v_company_id
      AND je.source_id  = p_payment_id
      AND gl.reconciliation_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'void_vendor_credit_refund: refund % is bank-reconciled. Un-reconcile it first, then void.',
      p_payment_id;
  END IF;

  SELECT * INTO v_je FROM public.journal_entries
   WHERE company_id     = v_company_id
     AND source_id      = p_payment_id
     AND source_type    = 'vendor_credit_refund'
     AND reversed_by_id IS NULL
     AND reversal_of_id IS NULL
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'void_vendor_credit_refund: no live journal entry found for refund %', p_payment_id;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_je.date <= v_lock_date THEN
    RAISE EXCEPTION 'void_vendor_credit_refund: the original posting dated % is in a locked period (lock %)',
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
    COALESCE(p_reason, 'Void vendor credit refund - ' || v_pmt.payment_number),
    'vendor_credit_refund', p_payment_id, v_je.currency, v_je.exchange_rate,
    v_je.total_credit, v_je.total_debit, v_je.id, v_user_id
  ) RETURNING id INTO v_rev_id;

  FOR v_gl IN SELECT * FROM public.general_ledger WHERE journal_entry_id = v_je.id LOOP
    INSERT INTO public.general_ledger (
      company_id, journal_entry_id, account_id, account_code, date,
      debit, credit, description,
      contact_id, related_doc_type, related_doc_id, reversal_of_id
    ) VALUES (
      v_company_id, v_rev_id, v_gl.account_id, v_gl.account_code, v_gl.date,
      v_gl.credit, v_gl.debit,
      COALESCE(p_reason, 'Void vendor credit refund - ' || v_pmt.payment_number),
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
    VALUES (v_company_id, v_user_id, 'void', 'vendor_credit_refund', p_payment_id,
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

REVOKE ALL    ON FUNCTION public.void_vendor_credit_refund(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_vendor_credit_refund(uuid, text) TO authenticated;


NOTIFY pgrst, 'reload schema';
