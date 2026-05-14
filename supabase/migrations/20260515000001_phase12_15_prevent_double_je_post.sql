-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 12 — Migration 15: prevent double-posting JEs
-- ─────────────────────────────────────────────────────────────────────────
-- QA caught a critical accounting-integrity bug:
--
--   1. User confirms invoice INV-1001 for 1,750 → JE-1 posted to GL
--   2. User clicks "Edit Invoice", then clicks the regular "Save" button
--      (NOT "Save & Repost")
--   3. The Save button calls saveMutation → invoices.update → sets
--      status='draft' and replaces items. NO GL reversal happens.
--      Old JE-1 remains posted for 1,750.
--   4. User clicks "Confirm Invoice" again
--   5. confirm_invoice sees status='draft' (passes its only existing
--      guard) and posts JE-2 for the new amount 1,837.50
--   6. RESULT: GL contains BOTH JE-1 (1,750) AND JE-2 (1,837.50),
--      double-counting AR, sales, and stock in every report.
--
-- The UI fix in this commit hides the regular Save button when editing
-- a confirmed invoice. That closes the surface path. But the charter
-- demands defense-in-depth at the source-of-truth layer too — even if
-- some future UI or API call routes around the guard, the RPC must
-- refuse to post a second JE for a document that already has one.
--
-- Fix: at the top of confirm_invoice and confirm_vendor_bill, check
-- journal_entries for an existing un-reversed entry whose source_id
-- matches this doc. If found, raise an exception with a clear message
-- telling the user to either void or use Save & Repost.
-- ─────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────
-- Helper: assert no un-reversed JE exists for a source doc.
-- An "un-reversed" JE is one where reversed_by_id IS NULL.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._assert_no_unreversed_je(
  p_source_type TEXT,
  p_source_id   UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_entry TEXT;
BEGIN
  SELECT entry_number INTO v_existing_entry
  FROM public.journal_entries
  WHERE source_type = p_source_type
    AND source_id   = p_source_id
    AND reversed_by_id IS NULL
  LIMIT 1;

  IF v_existing_entry IS NOT NULL THEN
    RAISE EXCEPTION
      'Double-post blocked: an unreversed journal entry (%) already exists for this document. Void it or use Save & Repost to revise.',
      v_existing_entry
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._assert_no_unreversed_je(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._assert_no_unreversed_je(TEXT, UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- Wire the guard into confirm_invoice.
-- We can't redefine the entire RPC here (it's 200+ lines), so we patch
-- via a wrapper trigger-style: a BEFORE-statement check using the
-- helper. Since confirm_invoice is one PL/pgSQL function, the cleanest
-- approach is to drop+recreate it with the guard added at the top.
-- That's what Phase 12.03 did when it fixed the stock_ledger bug — same
-- pattern here.
-- ─────────────────────────────────────────────────────────────────────────

-- For confirm_invoice the source_type is 'sales_invoice' (per Phase 4.2).
-- We re-use the original RPC body — only the first few lines change.
-- The body below is identical to Phase 12.03's confirm_invoice EXCEPT
-- for the new guard call after the status check.

-- Rather than copy 200 lines, we use ALTER FUNCTION ... but PG doesn't
-- support patching a function body. So the safest minimal change is:
-- create a wrapper that calls the guard, then calls the existing
-- confirm_invoice. But we can't easily wrap because the original
-- function name is what callers invoke.
--
-- Cleanest approach: add a BEFORE-INSERT trigger on journal_entries
-- that, for source_type='sales_invoice' or 'vendor_bill', refuses
-- the insert if another un-reversed JE exists for the same source.
-- This catches ALL paths (confirm_invoice, edit_invoice repost,
-- direct API, future code) without rewriting any function.

CREATE OR REPLACE FUNCTION public._guard_no_double_post()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing TEXT;
BEGIN
  -- Only enforce on source types that represent one accounting event
  -- per source doc. Lines like 'inventory_cogs' (separate JE per sale
  -- but same source_id) are excluded.
  IF NEW.source_type NOT IN (
    'sales_invoice',
    'vendor_bill',
    'sales_credit_note',
    'vendor_debit_note'
  ) THEN
    RETURN NEW;
  END IF;

  -- If this JE is itself a reversal entry, allow it (it links to an
  -- original via reversal_of_id). Reversals NEVER have source_id
  -- alone — they always carry reversal_of_id.
  IF NEW.reversal_of_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Look for any other un-reversed JE with the same source.
  SELECT entry_number INTO v_existing
  FROM public.journal_entries
  WHERE company_id   = NEW.company_id
    AND source_type  = NEW.source_type
    AND source_id    = NEW.source_id
    AND reversed_by_id IS NULL
    AND id <> NEW.id          -- ignore the row being inserted
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION
      'Double-post blocked: an unreversed % entry (%) already exists for this document (source_id=%). Void it or use Save & Repost to revise.',
      NEW.source_type, v_existing, NEW.source_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS journal_entries_guard_no_double_post ON public.journal_entries;
CREATE TRIGGER journal_entries_guard_no_double_post
BEFORE INSERT ON public.journal_entries
FOR EACH ROW EXECUTE FUNCTION public._guard_no_double_post();

COMMENT ON FUNCTION public._guard_no_double_post() IS
  'BEFORE INSERT trigger on journal_entries. Blocks posting a second '
  'JE for a source document that already has an un-reversed one. '
  'Reversal entries (reversal_of_id IS NOT NULL) bypass the check. '
  'edit_invoice and similar reverse-and-repost flows still work because '
  'they first set reversed_by_id on the original (making it "reversed") '
  'before inserting the new JE.';
