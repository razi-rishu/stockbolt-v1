-- ============================================================================
-- Phase 77 (R4b) — Restocking fee on a sales return
--
-- PROBLEM
-- There is no way to keep part of a credit. A customer returns 1,000 of goods
-- and the business keeps 100 as a restocking fee; today the only way to
-- express that is to hand-edit the credit note down to 900.
--
-- That is wrong twice over. It understates the revenue REVERSAL -- 4100 is
-- debited by 900 when 1,000 of sale really did come back -- and it books the
-- fee as sales revenue, when no sale took place. The fee is consideration for
-- a service (handling, inspection, re-shelving), which is indirect income.
-- The customer's balance happens to land in the right place, so nothing ever
-- looked wrong; revenue, gross margin and the VAT return were all misstated.
--
-- WHAT THIS ADDS
-- sales_returns.restocking_fee, and one extra self-balancing entry per
-- confirmed return that carries one:
--
--     Dr 1200 Accounts Receivable   (the whole fee, contact-attributed)
--     Cr 2200 Output VAT            (the tax inside it, when there is tax)
--     Cr 4200 Other Income          (the rest)
--
-- The credit note is NOT reduced. It keeps reversing the sale in full, which
-- is what actually happened; the fee is a separate charge that claws part of
-- the credit back. Net movement on the customer is credit minus fee, which is
-- what they receive.
--
-- TAX
-- The fee is treated as INCLUSIVE of tax at the rate of the invoice's
-- highest-value line -- the fee arises from that invoice, so the same
-- registration and the same rate apply. A zero-rated, exempt or untaxed
-- invoice yields rate 0 and the whole fee is income, which is also what
-- happens for a company that is not registered at all.
--
-- One number is rounded and the other is DERIVED BY SUBTRACTION:
--
--     net := ROUND(fee / (1 + rate/100), 2)
--     vat := fee - net
--
-- so net + vat is exactly the fee, always. Rounding both independently is how
-- a one-fils imbalance gets into a ledger.
--
-- DOUBLE ENTRY
-- Composed through post_journal_entry, so period lock, JE numbering and
-- balance validation come from the one primitive. The debit is the fee; the
-- credits are two parts of the same fee, derived from each other. The reversal
-- mirrors every leg with debit and credit swapped, at the ORIGINAL line's date
-- (Phase 43), never at CURRENT_DATE. je_must_balance re-checks all of it at
-- COMMIT.
--
-- The 1200 leg carries contact_id, because 1200 is a control account and the
-- B3 invariant (Phase 70) requires control-account lines to name their party.
-- Without it the customer's statement and the AR control would diverge by the
-- fee.
--
-- GUARD
-- The fee may not exceed the credit being issued. A fee larger than the credit
-- would mean the customer owes money for the privilege of returning goods,
-- which is an input error every time.
--
-- ADDITIVE, LIKE PHASE 76
-- Its own trigger and its own two functions. Phase 76's write-off trigger,
-- its functions, and every posting RPC are left exactly as they are -- this
-- migration redefines nothing that already exists. The two AFTER UPDATE
-- triggers are independent: each posts its own balanced entry, in either
-- order, and neither can see the other.
--
-- ROLLBACK
--   DROP TRIGGER IF EXISTS sales_returns_fee ON public.sales_returns;
--   DROP FUNCTION IF EXISTS public._tg_sales_return_fee();
--   DROP FUNCTION IF EXISTS public.reverse_sales_return_fee(uuid, text);
--   DROP FUNCTION IF EXISTS public.post_sales_return_fee(uuid);
--   ALTER TABLE public.sales_returns DROP COLUMN IF EXISTS restocking_fee;
--
-- Additive and idempotent. Safe to re-run.
-- ============================================================================


-- 1. The column ------------------------------------------------------------
ALTER TABLE public.sales_returns
  ADD COLUMN IF NOT EXISTS restocking_fee NUMERIC(15,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.sales_returns'::regclass
       AND conname  = 'sales_returns_restocking_fee_nonneg'
  ) THEN
    ALTER TABLE public.sales_returns
      ADD CONSTRAINT sales_returns_restocking_fee_nonneg
      CHECK (restocking_fee >= 0);
  END IF;
END $$;


-- 2. CoA — 4200 Other Income for any company that lacks it ------------------
--    Part of the standard seed (src/core/seeds/seedCOA.ts); this is a
--    backfill for a customised chart, not a new account.
INSERT INTO public.chart_of_accounts (company_id, code, name, name_ar, type, sub_type, is_active)
SELECT c.id, v.code, v.name, v.name_ar, v.type, v.sub_type, true
FROM public.companies c
CROSS JOIN (VALUES
  ('4200','Other Income','إيرادات أخرى','income','indirect')
) AS v(code, name, name_ar, type, sub_type)
WHERE NOT EXISTS (
  SELECT 1 FROM public.chart_of_accounts x WHERE x.company_id = c.id AND x.code = v.code
);


-- ============================================================================
-- post_sales_return_fee — Dr 1200 / Cr 2200 + Cr 4200
-- ============================================================================
CREATE OR REPLACE FUNCTION public.post_sales_return_fee(p_sales_return_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $function$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_sr         public.sales_returns%ROWTYPE;
  v_inv        public.invoices%ROWTYPE;
  v_cn_total   NUMERIC(15,2);
  v_fee        NUMERIC(15,2);
  v_rate       NUMERIC(7,2);
  v_net        NUMERIC(15,2);
  v_vat        NUMERIC(15,2);
  v_vat_code   TEXT;
  v_desc       TEXT;
  v_lines      JSONB;
  v_res        JSONB;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'post_sales_return_fee: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_sr FROM public.sales_returns
   WHERE id = p_sales_return_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_sales_return_fee: return % not found', p_sales_return_id;
  END IF;

  -- Never post twice for the same return.
  IF EXISTS (
    SELECT 1 FROM public.journal_entries
     WHERE company_id     = v_company_id
       AND source_type    = 'sales_return_fee'
       AND source_id      = p_sales_return_id
       AND reversed_by_id IS NULL
       AND reversal_of_id IS NULL
  ) THEN
    RETURN NULL;
  END IF;

  v_fee := ROUND(COALESCE(v_sr.restocking_fee, 0), 2);

  -- No fee: nothing posts, so every return raised before this existed, and
  -- every one raised without a fee, behaves exactly as it did.
  IF v_fee <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_inv FROM public.invoices
   WHERE id = v_sr.invoice_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_sales_return_fee: linked invoice not found';
  END IF;

  -- The fee cannot be larger than the credit it is clawing back.
  SELECT total_amount INTO v_cn_total FROM public.credit_notes
   WHERE id = v_sr.credit_note_id AND company_id = v_company_id;
  IF v_fee > COALESCE(v_cn_total, 0) THEN
    RAISE EXCEPTION 'post_sales_return_fee: restocking fee % is more than the credit being issued (%). The customer cannot owe money for returning goods.',
      v_fee, COALESCE(v_cn_total, 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.chart_of_accounts
     WHERE company_id = v_company_id AND code = '4200' AND is_active
  ) THEN
    RAISE EXCEPTION 'post_sales_return_fee: account 4200 Other Income is missing or inactive. Reactivate it in Settings, Chart of Accounts, then confirm the return again.';
  END IF;

  -- Tax rate of the invoice's highest-value line. The fee arises from that
  -- invoice, so the same registration and rate apply to it.
  SELECT ii.tax_rate INTO v_rate
    FROM public.invoice_items ii
   WHERE ii.invoice_id = v_sr.invoice_id
   ORDER BY ii.line_total DESC NULLS LAST, ii.sort_order
   LIMIT 1;
  v_rate := COALESCE(v_rate, 0);

  -- Same resolution confirm_credit_note uses for the output-tax account.
  IF v_rate > 0 THEN
    SELECT code INTO v_vat_code FROM public.chart_of_accounts
     WHERE company_id = v_company_id AND code LIKE '22%' AND is_active
     ORDER BY code LIMIT 1;
  END IF;

  -- Round ONE of them, derive the other by subtraction, so net + vat is
  -- exactly the fee and the entry cannot be a fils out.
  IF v_rate > 0 AND v_vat_code IS NOT NULL THEN
    v_net := ROUND(v_fee / (1 + v_rate / 100.0), 2);
    v_vat := v_fee - v_net;
  ELSE
    v_net := v_fee;
    v_vat := 0;
  END IF;

  v_desc := 'Restocking fee - ' || v_sr.return_number;

  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_code', '1200',
      'debit',        v_fee,
      'credit',       0,
      'description',  v_desc,
      'contact_id',   v_inv.contact_id
    ),
    jsonb_build_object(
      'account_code', '4200',
      'debit',        0,
      'credit',       v_net,
      'description',  v_desc,
      'contact_id',   v_inv.contact_id
    )
  );

  IF v_vat > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', v_vat_code,
        'debit',        0,
        'credit',       v_vat,
        'description',  v_desc,
        'contact_id',   v_inv.contact_id
      )
    );
  END IF;

  v_res := public.post_journal_entry(jsonb_build_object(
    'date',          v_sr.date,
    'description',   v_desc,
    'source_type',   'sales_return_fee',
    'source_id',     p_sales_return_id,
    'currency',      (SELECT COALESCE(currency, 'AED') FROM public.companies WHERE id = v_company_id),
    'exchange_rate', 1,
    'lines',         v_lines
  ));

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'restocking_fee', 'sales_return', p_sales_return_id,
      jsonb_build_object('return_number', v_sr.return_number,
                         'fee', v_fee, 'net', v_net, 'vat', v_vat, 'rate', v_rate,
                         'journal_entry_id', v_res ->> 'journal_entry_id'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_res;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.post_sales_return_fee(uuid) TO authenticated;


-- ============================================================================
-- reverse_sales_return_fee — mirror every leg, at the ORIGINAL date
-- ============================================================================
CREATE OR REPLACE FUNCTION public.reverse_sales_return_fee(
  p_sales_return_id uuid,
  p_reason          text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $function$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_sr         public.sales_returns%ROWTYPE;
  v_je         public.journal_entries%ROWTYPE;
  v_gl         public.general_ledger%ROWTYPE;
  v_lock_date  DATE;
  v_seq        BIGINT;
  v_rev_entry  TEXT;
  v_rev_id     UUID;
  v_desc       TEXT;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'reverse_sales_return_fee: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_sr FROM public.sales_returns
   WHERE id = p_sales_return_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reverse_sales_return_fee: return % not found', p_sales_return_id;
  END IF;

  -- No live fee entry: the return carried no fee, or predates Phase 77.
  -- Do nothing, so voiding an old return cannot start failing.
  SELECT * INTO v_je FROM public.journal_entries
   WHERE company_id     = v_company_id
     AND source_type    = 'sales_return_fee'
     AND source_id      = p_sales_return_id
     AND reversed_by_id IS NULL
     AND reversal_of_id IS NULL
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_je.date <= v_lock_date THEN
    RAISE EXCEPTION 'reverse_sales_return_fee: the original fee dated % is in a locked period (lock %)',
      v_je.date, v_lock_date;
  END IF;

  v_desc := COALESCE(p_reason, 'Reverse restocking fee - ' || v_sr.return_number);

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
    v_company_id, v_rev_entry, v_je.date, v_desc,
    'sales_return_fee', p_sales_return_id, v_je.currency, v_je.exchange_rate,
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
      v_gl.credit, v_gl.debit, v_desc,
      v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
    );
  END LOOP;

  UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'restocking_fee_reversal', 'sales_return', p_sales_return_id,
      jsonb_build_object('return_number', v_sr.return_number,
                         'reversal_of', v_je.id, 'entry_number', v_rev_entry));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('journal_entry_id', v_rev_id, 'entry_number', v_rev_entry);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.reverse_sales_return_fee(uuid, text) TO authenticated;


-- ============================================================================
-- The hook — its own trigger, alongside Phase 76's
-- ============================================================================
-- Deliberately NOT folded into _tg_sales_return_writeoff. Two independent
-- triggers each post their own balanced entry; neither can see or break the
-- other, and Phase 76 does not have to be reopened to add this.
CREATE OR REPLACE FUNCTION public._tg_sales_return_fee()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $function$
BEGIN
  IF OLD.status = 'draft' AND NEW.status = 'confirmed' THEN
    -- credit_note_id proves this went through confirm_sales_return, so a fee
    -- can never exist without the credit it claws back.
    IF NEW.credit_note_id IS NOT NULL THEN
      PERFORM public.post_sales_return_fee(NEW.id);
    END IF;

  ELSIF OLD.status = 'confirmed' AND NEW.status IN ('void', 'draft') THEN
    PERFORM public.reverse_sales_return_fee(
      NEW.id,
      CASE WHEN NEW.status = 'void'
           THEN 'Void sales return '   || NEW.return_number
           ELSE 'Reopen sales return ' || NEW.return_number
      END);
  END IF;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS sales_returns_fee ON public.sales_returns;
CREATE TRIGGER sales_returns_fee
  AFTER UPDATE OF status ON public.sales_returns
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public._tg_sales_return_fee();


NOTIFY pgrst, 'reload schema';
