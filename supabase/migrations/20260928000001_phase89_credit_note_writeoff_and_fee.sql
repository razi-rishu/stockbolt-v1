-- ═══════════════════════════════════════════════════════════════════════════
-- phase89 (Z2) — the damaged write-off and the restocking fee move onto the
-- credit note
--
-- phase88 gave credit_note_items.condition and credit_notes.restocking_fee,
-- and nothing read them. This is what makes them post. Six functions and two
-- triggers, mirroring the sales-return versions that phase76 (R4a) and
-- phase77 (R4b) shipped:
--
--   post_credit_note_writeoff     Dr 6700 Inventory Loss / Cr 5100 COGS
--   reverse_credit_note_writeoff
--   post_credit_note_fee          Dr 1200 AR / Cr 2200 VAT + Cr 4200 Other Income
--   reverse_credit_note_fee
--   _tg_credit_note_writeoff      AFTER UPDATE OF status ON credit_notes
--   _tg_credit_note_fee
--
-- THE DOUBLE-POST HAZARD, AND THE GUARD FOR IT
-- While sales returns still exist, confirming one generates a credit note and
-- confirms it. That single act would fire the RETURN's triggers and the new
-- NOTE's triggers, posting the write-off and the fee twice for one event.
--
-- So both new trigger functions skip any note that belongs to a sales return.
-- Legacy returns keep the old path; standalone notes take the new one. When
-- Z3 retires returns the guard stops matching anything and costs nothing.
--
-- It is belt and braces on top of a second protection: a return-generated
-- note carries condition='resellable' on every line and restocking_fee=0,
-- because confirm_sales_return does not copy those across — so both posts
-- would short-circuit on a zero amount anyway. The guard is there because
-- that is a fact about today's confirm_sales_return, not a rule.
--
-- NEW SOURCE TYPES, NOT REUSED ONES
-- 'sales_return_writeoff' and 'sales_return_fee' already exist and are already
-- allowed. Reusing them would be wrong: source_id would point at a credit
-- note while the source_type named a return, and the Document 7 drill-down
-- resolves source_type to a table. Two new names, and the constraint is
-- widened for them here — the phase87 tripwire that reads every posting
-- function would have caught this migration if it had not been.
--
-- DIFFERENCES FROM THE SALES-RETURN ORIGINALS
--   * cost comes from credit_note_items.cost_at_sale, not unit_cost;
--   * the fee ceiling is the note's own total_amount, with no second lookup;
--   * the contact comes from the note itself, so a note with NO linked invoice
--     still posts — the tax rate then falls back to the note's own top line
--     rather than an invoice that does not exist. A standalone rebate with a
--     restocking fee is odd but not impossible, and it should not error.
--
-- SAFE TO APPLY: every function is new, both triggers are new, the constraint
-- change is additive. No existing function is reopened and no row is written.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Two more source types ───────────────────────────────────────────────
ALTER TABLE public.journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_source_type_check;

ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_source_type_check CHECK (
    source_type = ANY (ARRAY[
      'sales_invoice'::text, 'pos_cash_sale'::text, 'pos_card_sale'::text,
      'inventory_cogs'::text, 'customer_receipt'::text, 'customer_advance'::text,
      'advance_application'::text, 'advance_refund'::text,
      'sales_credit_note'::text, 'sales_return'::text, 'vendor_bill'::text,
      'goods_receipt'::text, 'vendor_payment'::text, 'vendor_advance'::text,
      'vendor_debit_note'::text, 'stock_transfer'::text,
      'inventory_adjustment'::text, 'opening_balance'::text, 'opening_gl'::text,
      'opening_bank'::text, 'bank_transfer'::text, 'direct_receipt'::text,
      'expense'::text, 'pdc_creation'::text, 'pdc_bank_post'::text,
      'pdc_clear'::text, 'pdc_bounce'::text, 'manual'::text,
      'year_end_close'::text,
      -- phase87
      'customer_refund'::text, 'vendor_refund'::text,
      'customer_credit_refund'::text, 'vendor_credit_refund'::text,
      'depreciation'::text, 'depreciation_reversal'::text, 'asset_disposal'::text,
      'amortization'::text, 'amortization_reversal'::text,
      'tds_deduction'::text, 'tds_reversal'::text,
      'sales_return_writeoff'::text, 'sales_return_fee'::text,
      -- phase89 (Z2)
      'credit_note_writeoff'::text,   -- Dr 6700 / Cr 5100, damaged lines
      'credit_note_fee'::text         -- Dr 1200 / Cr 2200 + Cr 4200
    ])
  );

-- ── 2. Damaged goods write-off ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_credit_note_writeoff(p_credit_note_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_cn         public.credit_notes%ROWTYPE;
  v_amount     NUMERIC(15,2);
  v_desc       TEXT;
  v_res        JSONB;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'post_credit_note_writeoff: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_cn FROM public.credit_notes
   WHERE id = p_credit_note_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_credit_note_writeoff: credit note % not found', p_credit_note_id;
  END IF;

  -- Never post twice for the same note.
  IF EXISTS (
    SELECT 1 FROM public.journal_entries
     WHERE company_id     = v_company_id
       AND source_type    = 'credit_note_writeoff'
       AND source_id      = p_credit_note_id
       AND reversed_by_id IS NULL
       AND reversal_of_id IS NULL
  ) THEN
    RETURN NULL;
  END IF;

  -- Goods that came back damaged were restocked at full value by the note.
  -- This reclassifies that value out of inventory and into loss. Rounded
  -- ONCE, then used for both legs, so the entry balances by construction.
  SELECT ROUND(COALESCE(SUM(cni.quantity * COALESCE(cni.cost_at_sale, 0)), 0), 2)
    INTO v_amount
    FROM public.credit_note_items cni
   WHERE cni.credit_note_id = p_credit_note_id
     AND cni.condition = 'damaged';

  -- No damaged lines, or damaged lines with no cost on file: nothing to
  -- reclassify, so every note raised before this existed behaves unchanged.
  IF COALESCE(v_amount, 0) <= 0 THEN
    RETURN NULL;
  END IF;

  -- A readable failure beats post_journal_entry's generic one: this is the
  -- only account an operator might have switched off.
  IF NOT EXISTS (
    SELECT 1 FROM public.chart_of_accounts
     WHERE company_id = v_company_id AND code = '6700' AND is_active
  ) THEN
    RAISE EXCEPTION 'post_credit_note_writeoff: account 6700 Inventory Loss is missing or inactive. Reactivate it in Settings, Chart of Accounts, then confirm the credit note again.';
  END IF;

  v_desc := 'Damaged goods write-off - ' || v_cn.credit_note_number;

  v_res := public.post_journal_entry(jsonb_build_object(
    'date',          v_cn.date,
    'description',   v_desc,
    'source_type',   'credit_note_writeoff',
    'source_id',     p_credit_note_id,
    'currency',      (SELECT COALESCE(currency, 'AED') FROM public.companies WHERE id = v_company_id),
    'exchange_rate', 1,
    'lines', jsonb_build_array(
      jsonb_build_object('account_code', '6700', 'debit', v_amount, 'credit', 0, 'description', v_desc),
      jsonb_build_object('account_code', '5100', 'debit', 0, 'credit', v_amount, 'description', v_desc)
    )
  ));

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'writeoff', 'credit_note', p_credit_note_id,
      jsonb_build_object('credit_note_number', v_cn.credit_note_number,
                         'amount', v_amount,
                         'journal_entry_id', v_res ->> 'journal_entry_id'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_res;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reverse_credit_note_writeoff(
  p_credit_note_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_cn         public.credit_notes%ROWTYPE;
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
    RAISE EXCEPTION 'reverse_credit_note_writeoff: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_cn FROM public.credit_notes
   WHERE id = p_credit_note_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reverse_credit_note_writeoff: credit note % not found', p_credit_note_id;
  END IF;

  -- No live write-off: the note had no damaged lines, or predates phase89.
  -- Both ordinary — do nothing, so voiding an old note cannot start failing.
  SELECT * INTO v_je FROM public.journal_entries
   WHERE company_id     = v_company_id
     AND source_type    = 'credit_note_writeoff'
     AND source_id      = p_credit_note_id
     AND reversed_by_id IS NULL
     AND reversal_of_id IS NULL
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Phase 43: the reversal is dated at the ORIGINAL entry's date, so the
  -- period it belongs to is the period it unwinds.
  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_je.date <= v_lock_date THEN
    RAISE EXCEPTION 'reverse_credit_note_writeoff: the original write-off dated % is in a locked period (lock %)',
      v_je.date, v_lock_date;
  END IF;

  v_desc := COALESCE(p_reason, 'Reverse damaged goods write-off - ' || v_cn.credit_note_number);

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
    'credit_note_writeoff', p_credit_note_id, v_je.currency, v_je.exchange_rate,
    v_je.total_credit, v_je.total_debit, v_je.id, v_user_id
  ) RETURNING id INTO v_rev_id;

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
    VALUES (v_company_id, v_user_id, 'writeoff_reversal', 'credit_note', p_credit_note_id,
      jsonb_build_object('credit_note_number', v_cn.credit_note_number,
                         'reversal_of', v_je.id, 'entry_number', v_rev_entry));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('journal_entry_id', v_rev_id, 'entry_number', v_rev_entry);
END;
$function$;

-- ── 3. Restocking fee ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_credit_note_fee(p_credit_note_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_cn         public.credit_notes%ROWTYPE;
  v_fee        NUMERIC(15,2);
  v_net        NUMERIC(15,2);
  v_vat        NUMERIC(15,2);
  v_rate       NUMERIC;
  v_vat_code   TEXT;
  v_desc       TEXT;
  v_lines      JSONB;
  v_res        JSONB;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'post_credit_note_fee: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_cn FROM public.credit_notes
   WHERE id = p_credit_note_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_credit_note_fee: credit note % not found', p_credit_note_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.journal_entries
     WHERE company_id     = v_company_id
       AND source_type    = 'credit_note_fee'
       AND source_id      = p_credit_note_id
       AND reversed_by_id IS NULL
       AND reversal_of_id IS NULL
  ) THEN
    RETURN NULL;
  END IF;

  v_fee := ROUND(COALESCE(v_cn.restocking_fee, 0), 2);

  -- No fee: nothing posts, so every note raised before this existed, and
  -- every one raised without a fee, behaves exactly as it did.
  IF v_fee <= 0 THEN
    RETURN NULL;
  END IF;

  -- The fee cannot be larger than the credit it claws back. A customer must
  -- not end up OWING money for bringing goods back.
  IF v_fee > COALESCE(v_cn.total_amount, 0) THEN
    RAISE EXCEPTION 'post_credit_note_fee: restocking fee % is more than the credit being issued (%). The customer cannot owe money for returning goods.',
      v_fee, COALESCE(v_cn.total_amount, 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.chart_of_accounts
     WHERE company_id = v_company_id AND code = '4200' AND is_active
  ) THEN
    RAISE EXCEPTION 'post_credit_note_fee: account 4200 Other Income is missing or inactive. Reactivate it in Settings, Chart of Accounts, then confirm the credit note again.';
  END IF;

  -- Tax rate of the linked invoice's highest-value line: the fee arises from
  -- that sale, so the same registration and rate apply. With no linked
  -- invoice, the note's own top line is the best available answer — a
  -- standalone credit with a fee is odd, but it should post, not error.
  IF v_cn.linked_invoice_id IS NOT NULL THEN
    SELECT ii.tax_rate INTO v_rate
      FROM public.invoice_items ii
     WHERE ii.invoice_id = v_cn.linked_invoice_id
     ORDER BY ii.line_total DESC NULLS LAST, ii.sort_order
     LIMIT 1;
  END IF;
  IF v_rate IS NULL THEN
    SELECT cni.tax_rate INTO v_rate
      FROM public.credit_note_items cni
     WHERE cni.credit_note_id = p_credit_note_id
     ORDER BY cni.line_total DESC NULLS LAST, cni.sort_order
     LIMIT 1;
  END IF;
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

  v_desc := 'Restocking fee - ' || v_cn.credit_note_number;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', '1200', 'debit', v_fee, 'credit', 0,
                       'description', v_desc, 'contact_id', v_cn.contact_id),
    jsonb_build_object('account_code', '4200', 'debit', 0, 'credit', v_net,
                       'description', v_desc, 'contact_id', v_cn.contact_id)
  );

  IF v_vat > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_code', v_vat_code, 'debit', 0, 'credit', v_vat,
                         'description', v_desc, 'contact_id', v_cn.contact_id)
    );
  END IF;

  v_res := public.post_journal_entry(jsonb_build_object(
    'date',          v_cn.date,
    'description',   v_desc,
    'source_type',   'credit_note_fee',
    'source_id',     p_credit_note_id,
    'currency',      (SELECT COALESCE(currency, 'AED') FROM public.companies WHERE id = v_company_id),
    'exchange_rate', 1,
    'lines',         v_lines
  ));

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'restocking_fee', 'credit_note', p_credit_note_id,
      jsonb_build_object('credit_note_number', v_cn.credit_note_number,
                         'fee', v_fee, 'net', v_net, 'vat', v_vat, 'rate', v_rate,
                         'journal_entry_id', v_res ->> 'journal_entry_id'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_res;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reverse_credit_note_fee(
  p_credit_note_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_cn         public.credit_notes%ROWTYPE;
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
    RAISE EXCEPTION 'reverse_credit_note_fee: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_cn FROM public.credit_notes
   WHERE id = p_credit_note_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reverse_credit_note_fee: credit note % not found', p_credit_note_id;
  END IF;

  SELECT * INTO v_je FROM public.journal_entries
   WHERE company_id     = v_company_id
     AND source_type    = 'credit_note_fee'
     AND source_id      = p_credit_note_id
     AND reversed_by_id IS NULL
     AND reversal_of_id IS NULL
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_je.date <= v_lock_date THEN
    RAISE EXCEPTION 'reverse_credit_note_fee: the original fee dated % is in a locked period (lock %)',
      v_je.date, v_lock_date;
  END IF;

  v_desc := COALESCE(p_reason, 'Reverse restocking fee - ' || v_cn.credit_note_number);

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
    'credit_note_fee', p_credit_note_id, v_je.currency, v_je.exchange_rate,
    v_je.total_credit, v_je.total_debit, v_je.id, v_user_id
  ) RETURNING id INTO v_rev_id;

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
    VALUES (v_company_id, v_user_id, 'restocking_fee_reversal', 'credit_note', p_credit_note_id,
      jsonb_build_object('credit_note_number', v_cn.credit_note_number,
                         'reversal_of', v_je.id, 'entry_number', v_rev_entry));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('journal_entry_id', v_rev_id, 'entry_number', v_rev_entry);
END;
$function$;

-- ── 4. Triggers ────────────────────────────────────────────────────────────
-- Both skip a note that belongs to a sales return: while returns still exist,
-- confirming one confirms its note, and without this guard the write-off and
-- the fee would post twice for one event.
CREATE OR REPLACE FUNCTION public._tg_credit_note_writeoff()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.sales_returns sr WHERE sr.credit_note_id = NEW.id) THEN
    RETURN NULL;
  END IF;

  IF OLD.status = 'draft' AND NEW.status = 'confirmed' THEN
    PERFORM public.post_credit_note_writeoff(NEW.id);

  ELSIF OLD.status = 'confirmed' AND NEW.status IN ('void', 'draft') THEN
    PERFORM public.reverse_credit_note_writeoff(
      NEW.id,
      CASE WHEN NEW.status = 'void'
           THEN 'Void credit note '   || NEW.credit_note_number
           ELSE 'Reopen credit note ' || NEW.credit_note_number
      END);
  END IF;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public._tg_credit_note_fee()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.sales_returns sr WHERE sr.credit_note_id = NEW.id) THEN
    RETURN NULL;
  END IF;

  IF OLD.status = 'draft' AND NEW.status = 'confirmed' THEN
    PERFORM public.post_credit_note_fee(NEW.id);

  ELSIF OLD.status = 'confirmed' AND NEW.status IN ('void', 'draft') THEN
    PERFORM public.reverse_credit_note_fee(
      NEW.id,
      CASE WHEN NEW.status = 'void'
           THEN 'Void credit note '   || NEW.credit_note_number
           ELSE 'Reopen credit note ' || NEW.credit_note_number
      END);
  END IF;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS credit_notes_writeoff ON public.credit_notes;
CREATE TRIGGER credit_notes_writeoff
  AFTER UPDATE OF status ON public.credit_notes
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public._tg_credit_note_writeoff();

DROP TRIGGER IF EXISTS credit_notes_fee ON public.credit_notes;
CREATE TRIGGER credit_notes_fee
  AFTER UPDATE OF status ON public.credit_notes
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public._tg_credit_note_fee();

COMMIT;

-- ── ROLLBACK ───────────────────────────────────────────────────────────────
-- Refuses while any phase89 entry exists, rather than orphaning a posting
-- whose reversal function has been dropped.
--
-- BEGIN;
--
-- DO $$
-- BEGIN
--   IF EXISTS (SELECT 1 FROM public.journal_entries
--               WHERE source_type IN ('credit_note_writeoff','credit_note_fee'))
--   THEN
--     RAISE EXCEPTION 'phase89 entries exist; reverse them before rolling back.';
--   END IF;
-- END $$;
--
-- DROP TRIGGER IF EXISTS credit_notes_fee      ON public.credit_notes;
-- DROP TRIGGER IF EXISTS credit_notes_writeoff ON public.credit_notes;
-- DROP FUNCTION IF EXISTS public._tg_credit_note_fee();
-- DROP FUNCTION IF EXISTS public._tg_credit_note_writeoff();
-- DROP FUNCTION IF EXISTS public.reverse_credit_note_fee(uuid, text);
-- DROP FUNCTION IF EXISTS public.post_credit_note_fee(uuid);
-- DROP FUNCTION IF EXISTS public.reverse_credit_note_writeoff(uuid, text);
-- DROP FUNCTION IF EXISTS public.post_credit_note_writeoff(uuid);
-- -- The two source types stay in the CHECK: removing them is a separate,
-- -- riskier change and leaving them costs nothing.
--
-- COMMIT;
