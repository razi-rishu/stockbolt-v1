-- ============================================================================
-- Phase 76 (R4a) — Damaged sales returns land in Inventory Loss, not COGS
--
-- PROBLEM
-- sales_return_items.condition has offered 'resellable' / 'damaged' since
-- Phase 0, and the editor has exposed it for just as long. But look at what
-- 'damaged' actually does, in confirm_sales_return:
--
--     v_cost := CASE WHEN condition = 'damaged' THEN 0 ELSE unit_cost END;
--
-- and then, inside confirm_credit_note:
--
--     CONTINUE WHEN COALESCE(v_item.cost_at_sale, 0) = 0;
--
-- So for a damaged return the customer is credited in full --
-- Dr 4100 Revenue, Dr 2200 Output VAT, Cr 1200 AR -- and NOTHING AT ALL
-- happens to the cost. The Dr 5100 COGS / Cr 1300 Inventory raised when the
-- goods were sold simply stays where it is.
--
-- Net profit is right: the goods really were consumed, and the expense really
-- did belong to the period. Nothing is over- or under-stated in total, which
-- is why no invariant ever caught this. What is wrong is the CLASSIFICATION:
--
--   * 5100 Cost of Goods Sold now carries cost with no matching revenue,
--     so gross margin is understated by the scrap cost of every damaged
--     return, on every P&L and every margin report;
--   * and nothing anywhere answers "what did returned scrap cost us?",
--     because 6700 Inventory Loss is never touched by a return.
--
-- WHAT THIS ADDS
-- One extra, self-balancing journal entry per confirmed return that has at
-- least one damaged line:
--
--     Dr 6700 Inventory Loss    (damaged cost)
--     Cr 5100 Cost of Goods Sold
--
-- Inventory (1300) is deliberately NOT touched and the stock ledger is NOT
-- written: the goods are genuinely not back in sellable stock, which is
-- exactly what the existing cost_at_sale = 0 path already expresses. This
-- moves the expense to the right line of the P&L; it does not move goods.
--
-- Same bottom line, right classification, and write-offs become visible.
--
-- DOUBLE ENTRY
-- Both legs are the SAME rounded number, computed once, so the entry balances
-- by construction rather than by arithmetic that could drift. It is composed
-- through post_journal_entry, so period lock, JE numbering and balance
-- validation all come from the one primitive. The reversal mirrors every leg
-- with debit and credit swapped, at the ORIGINAL line's date (Phase 43), never
-- at CURRENT_DATE. Above all of it, je_must_balance -- a DEFERRABLE CONSTRAINT
-- TRIGGER on general_ledger checked at COMMIT -- makes an unbalanced entry
-- impossible to commit by any path.
--
-- WHY A TRIGGER, AND NOT AN EDIT TO THE THREE RPCs
-- The obvious implementation adds one PERFORM to confirm_sales_return, one to
-- void_sales_return and one to reopen_sales_return. That would mean
-- CREATE OR REPLACE on three live posting functions, reconstructed from
-- migration files -- exactly the thing this project does not do, because a
-- migration file is not proof of what is live.
--
-- Instead the hook is an AFTER UPDATE OF status trigger. Nothing that already
-- posts is reopened: confirm_sales_return, void_sales_return,
-- reopen_sales_return and confirm_credit_note keep byte-identical bodies. As a
-- bonus the hook is total -- any future path that flips the status is covered
-- automatically, rather than being a fourth place to remember.
--
-- NOT TOUCHED
-- confirm_credit_note. It never sees condition -- only cost_at_sale -- so it
-- has no business knowing about write-offs, and a tripwire asserts it never
-- learns. A credit note raised directly (goodwill, price adjustment) has no
-- condition to read and is deliberately unaffected.
--
-- The vendor side gets nothing: debit_note_items has no condition column, and
-- goods sent back to a supplier leave inventory at cost. There is no
-- write-off to make.
--
-- ROLLBACK
--   DROP TRIGGER IF EXISTS sales_returns_writeoff ON public.sales_returns;
--   DROP FUNCTION IF EXISTS public._tg_sales_return_writeoff();
--   DROP FUNCTION IF EXISTS public.reverse_sales_return_writeoff(uuid, text);
--   DROP FUNCTION IF EXISTS public.post_sales_return_writeoff(uuid);
--   -- (leave the seeded 6700 rows; harmless if unused)
--
-- Additive and idempotent. Safe to re-run.
-- ============================================================================


-- 1. CoA — 6700 Inventory Loss for any company that lacks it ----------------
--    It is part of the standard seed (src/core/seeds/seedCOA.ts), so this is
--    a backfill for companies whose chart was customised, not a new account.
INSERT INTO public.chart_of_accounts (company_id, code, name, name_ar, type, sub_type, is_active)
SELECT c.id, v.code, v.name, v.name_ar, v.type, v.sub_type, true
FROM public.companies c
CROSS JOIN (VALUES
  ('6700','Inventory Loss','خسائر المخزون','expense','indirect')
) AS v(code, name, name_ar, type, sub_type)
WHERE NOT EXISTS (
  SELECT 1 FROM public.chart_of_accounts x WHERE x.company_id = c.id AND x.code = v.code
);


-- ============================================================================
-- post_sales_return_writeoff — Dr 6700 / Cr 5100 for the damaged cost
-- ============================================================================
CREATE OR REPLACE FUNCTION public.post_sales_return_writeoff(p_sales_return_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $function$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_sr         public.sales_returns%ROWTYPE;
  v_amount     NUMERIC(15,2);
  v_desc       TEXT;
  v_res        JSONB;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'post_sales_return_writeoff: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_sr FROM public.sales_returns
   WHERE id = p_sales_return_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_sales_return_writeoff: return % not found', p_sales_return_id;
  END IF;

  -- Never post twice for the same return.
  IF EXISTS (
    SELECT 1 FROM public.journal_entries
     WHERE company_id     = v_company_id
       AND source_type    = 'sales_return_writeoff'
       AND source_id      = p_sales_return_id
       AND reversed_by_id IS NULL
       AND reversal_of_id IS NULL
  ) THEN
    RETURN NULL;
  END IF;

  -- The scrap cost. Rounded ONCE, then used for both legs, so the entry
  -- balances by construction.
  SELECT ROUND(COALESCE(SUM(sri.qty_returned * COALESCE(sri.unit_cost, 0)), 0), 2)
    INTO v_amount
    FROM public.sales_return_items sri
   WHERE sri.sales_return_id = p_sales_return_id
     AND sri.condition = 'damaged';

  -- No damaged lines, or damaged lines with no cost on file: nothing to
  -- reclassify, and every pre-existing flow therefore posts exactly what it
  -- posted before.
  IF COALESCE(v_amount, 0) <= 0 THEN
    RETURN NULL;
  END IF;

  -- A readable failure beats post_journal_entry's generic one: this is the
  -- only account an operator might have switched off.
  IF NOT EXISTS (
    SELECT 1 FROM public.chart_of_accounts
     WHERE company_id = v_company_id AND code = '6700' AND is_active
  ) THEN
    RAISE EXCEPTION 'post_sales_return_writeoff: account 6700 Inventory Loss is missing or inactive. Reactivate it in Settings, Chart of Accounts, then confirm the return again.';
  END IF;

  v_desc := 'Damaged goods write-off - ' || v_sr.return_number;

  v_res := public.post_journal_entry(jsonb_build_object(
    'date',          v_sr.date,
    'description',   v_desc,
    'source_type',   'sales_return_writeoff',
    'source_id',     p_sales_return_id,
    'currency',      (SELECT COALESCE(currency, 'AED') FROM public.companies WHERE id = v_company_id),
    'exchange_rate', 1,
    'lines', jsonb_build_array(
      jsonb_build_object(
        'account_code', '6700',
        'debit',        v_amount,
        'credit',       0,
        'description',  v_desc
      ),
      jsonb_build_object(
        'account_code', '5100',
        'debit',        0,
        'credit',       v_amount,
        'description',  v_desc
      )
    )
  ));

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'writeoff', 'sales_return', p_sales_return_id,
      jsonb_build_object('return_number', v_sr.return_number,
                         'amount', v_amount,
                         'journal_entry_id', v_res ->> 'journal_entry_id'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_res;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.post_sales_return_writeoff(uuid) TO authenticated;


-- ============================================================================
-- reverse_sales_return_writeoff — mirror every leg, at the ORIGINAL date
-- ============================================================================
CREATE OR REPLACE FUNCTION public.reverse_sales_return_writeoff(
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
    RAISE EXCEPTION 'reverse_sales_return_writeoff: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_sr FROM public.sales_returns
   WHERE id = p_sales_return_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reverse_sales_return_writeoff: return % not found', p_sales_return_id;
  END IF;

  -- No live write-off. Either the return had no damaged lines, or it was
  -- confirmed before Phase 76 existed. Both are ordinary: do nothing, so that
  -- voiding an old return cannot start failing.
  SELECT * INTO v_je FROM public.journal_entries
   WHERE company_id     = v_company_id
     AND source_type    = 'sales_return_writeoff'
     AND source_id      = p_sales_return_id
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
    RAISE EXCEPTION 'reverse_sales_return_writeoff: the original write-off dated % is in a locked period (lock %)',
      v_je.date, v_lock_date;
  END IF;

  v_desc := COALESCE(p_reason, 'Reverse damaged goods write-off - ' || v_sr.return_number);

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
    'sales_return_writeoff', p_sales_return_id, v_je.currency, v_je.exchange_rate,
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
    VALUES (v_company_id, v_user_id, 'writeoff_reversal', 'sales_return', p_sales_return_id,
      jsonb_build_object('return_number', v_sr.return_number,
                         'reversal_of', v_je.id, 'entry_number', v_rev_entry));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('journal_entry_id', v_rev_id, 'entry_number', v_rev_entry);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.reverse_sales_return_writeoff(uuid, text) TO authenticated;


-- ============================================================================
-- The hook — AFTER UPDATE OF status on sales_returns
-- ============================================================================
-- confirm_sales_return sets status='confirmed' AFTER confirm_credit_note has
-- run, so by the time this fires the credit note is already posted and the
-- write-off lands in the right order. void_ and reopen_sales_return both call
-- void_credit_note before flipping the status, so the same holds in reverse.
CREATE OR REPLACE FUNCTION public._tg_sales_return_writeoff()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $function$
BEGIN
  IF OLD.status = 'draft' AND NEW.status = 'confirmed' THEN
    -- credit_note_id proves this went through confirm_sales_return rather
    -- than a bare status UPDATE, so a write-off can never exist without the
    -- credit note it belongs to.
    IF NEW.credit_note_id IS NOT NULL THEN
      PERFORM public.post_sales_return_writeoff(NEW.id);
    END IF;

  ELSIF OLD.status = 'confirmed' AND NEW.status IN ('void', 'draft') THEN
    PERFORM public.reverse_sales_return_writeoff(
      NEW.id,
      CASE WHEN NEW.status = 'void'
           THEN 'Void sales return '   || NEW.return_number
           ELSE 'Reopen sales return ' || NEW.return_number
      END);
  END IF;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS sales_returns_writeoff ON public.sales_returns;
CREATE TRIGGER sales_returns_writeoff
  AFTER UPDATE OF status ON public.sales_returns
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public._tg_sales_return_writeoff();


NOTIFY pgrst, 'reload schema';
