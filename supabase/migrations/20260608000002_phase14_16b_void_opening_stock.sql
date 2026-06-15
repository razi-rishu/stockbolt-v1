-- ─────────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 14.16b — void_opening_stock RPC
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Purpose:
--   Allows a user to void an opening stock entry that was posted via
--   post_opening_stock. Necessary because:
--     a) Items were posted before Phase 14.16 fixed the equity account
--        (they credited 3200 instead of 3010) and need to be re-posted.
--     b) General ability to correct mistakes in opening stock entries.
--
-- What it does (atomically):
--   1. Loads and validates the stock_ledger row (must be type=opening_balance).
--   2. Finds the associated opening-stock journal entry.
--   3. Reverses the JE using the same Dr↔Cr flip pattern as
--      reverse_journal_entry (creates a new reversal JE, links both ways).
--   4. Hard-deletes the stock_ledger row so the one-shot guard is cleared
--      and post_opening_stock can be called again for the same product+warehouse.
--
-- Returns: { voided: true, reversal_entry: "JE-NNN" }
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.void_opening_stock(
  p_stock_ledger_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_sl         RECORD;
  v_je_id      UUID;
  v_orig       public.journal_entries%ROWTYPE;
  v_rev_id     UUID;
  v_rev_entry  TEXT;
  v_seq        BIGINT;
  v_gl         public.general_ledger%ROWTYPE;
BEGIN
  -- Resolve caller's company
  SELECT company_id INTO v_company_id
  FROM public.profiles
  WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'void_opening_stock: not signed in to a company'
      USING ERRCODE = '42501';
  END IF;

  -- Load the stock_ledger row — must belong to this company and be opening_balance type
  SELECT * INTO v_sl
  FROM public.stock_ledger
  WHERE id = p_stock_ledger_id
    AND company_id = v_company_id
    AND type = 'opening_balance';

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'void_opening_stock: stock ledger row % not found or is not an opening balance entry',
      p_stock_ledger_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Find the journal entry that corresponds to this opening stock.
  -- post_opening_stock sets source_type='opening_balance', source_id=product_id.
  -- We match on product_id (source_id) and exclude already-reversed entries.
  SELECT je.id INTO v_je_id
  FROM public.journal_entries je
  WHERE je.company_id   = v_company_id
    AND je.source_type  = 'opening_balance'
    AND je.source_id    = v_sl.product_id
    AND je.reversal_of_id  IS NULL
    AND je.reversed_by_id  IS NULL
  ORDER BY je.created_at DESC
  LIMIT 1;

  -- Reverse the JE if found (safe to skip if it was already reversed manually)
  IF v_je_id IS NOT NULL THEN
    SELECT * INTO v_orig
    FROM public.journal_entries
    WHERE id = v_je_id AND company_id = v_company_id;

    -- Advance document sequence for the reversal entry
    INSERT INTO public.document_sequences
      (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES
      (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE
      SET current_value = public.document_sequences.current_value + 1,
          updated_at    = NOW()
    RETURNING current_value INTO v_seq;

    v_rev_entry := 'JE-' || v_seq::TEXT;

    -- Insert reversal JE header
    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description,
      source_type, source_id,
      currency, exchange_rate,
      total_debit, total_credit,
      reversal_of_id,
      created_by
    ) VALUES (
      v_company_id,
      v_rev_entry,
      CURRENT_DATE,
      'Void opening stock — ' || v_orig.description,
      v_orig.source_type,
      v_orig.source_id,
      v_orig.currency,
      v_orig.exchange_rate,
      v_orig.total_credit,  -- swapped
      v_orig.total_debit,   -- swapped
      v_je_id,
      v_user_id
    )
    RETURNING id INTO v_rev_id;

    -- Mirror GL lines with Dr↔Cr flipped
    FOR v_gl IN
      SELECT * FROM public.general_ledger
      WHERE journal_entry_id = v_je_id
    LOOP
      INSERT INTO public.general_ledger (
        company_id, journal_entry_id, account_id, account_code, date,
        debit, credit, description,
        contact_id, related_doc_type, related_doc_id,
        reversal_of_id
      ) VALUES (
        v_company_id,
        v_rev_id,
        v_gl.account_id,
        v_gl.account_code,
        CURRENT_DATE,
        v_gl.credit,  -- flipped
        v_gl.debit,   -- flipped
        'Void opening stock — ' || v_orig.description,
        v_gl.contact_id,
        v_gl.related_doc_type,
        v_gl.related_doc_id,
        v_gl.id
      );
    END LOOP;

    -- Mark original JE as reversed
    UPDATE public.journal_entries
    SET reversed_by_id = v_rev_id
    WHERE id = v_je_id;
  END IF;

  -- Hard-delete the stock_ledger row so the one-shot guard is cleared.
  -- This allows post_opening_stock to be called again for the same product+warehouse.
  DELETE FROM public.stock_ledger
  WHERE id = p_stock_ledger_id;

  RETURN jsonb_build_object(
    'voided',         true,
    'reversal_entry', COALESCE(v_rev_entry, 'no-je-found')
  );
END;
$$;

COMMENT ON FUNCTION public.void_opening_stock IS
  'Phase 14.16b — voids an opening stock entry: reverses the GL JE and '
  'hard-deletes the stock_ledger row so the product can be re-posted.';
