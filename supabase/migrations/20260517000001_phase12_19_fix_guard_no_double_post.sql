-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 12 — Migration 19: fix _guard_no_double_post trigger
-- ─────────────────────────────────────────────────────────────────────────
-- Phase 12.15 added a BEFORE INSERT trigger on journal_entries that blocks
-- posting a SECOND JE for a source document that already has an un-reversed
-- one. The trigger correctly excludes "reversal entries" via the bypass
-- check `IF NEW.reversal_of_id IS NOT NULL THEN RETURN NEW`. But the
-- LOOKUP for "is there already an un-reversed JE for this source?" had a
-- subtle bug:
--
--     SELECT ... FROM journal_entries
--     WHERE source_type = NEW.source_type
--       AND source_id   = NEW.source_id
--       AND reversed_by_id IS NULL
--       AND id <> NEW.id;
--
-- The intent was "find the canonical posting JE that's still active". But
-- a REVERSAL entry inserted by edit_invoice also has reversed_by_id IS
-- NULL (a reversal hasn't itself been reversed), AND it shares source_id
-- with the original. So the query falsely treats the reversal entry as a
-- competing posting and BLOCKS the repost step in edit_invoice.
--
-- Symptom in production:
--   1. User confirms invoice → JE-1 posted. Reports: 2,100. ✓
--   2. User clicks Edit, changes the line totals, clicks Save → calls
--      edit_invoice RPC:
--        Step 1 inserts JE-2 (reversal of JE-1, source_id=inv,
--                             reversal_of_id=JE-1.id, reversed_by_id=NULL)
--        Step 1 also: UPDATE JE-1 SET reversed_by_id = JE-2.id
--        Step 3 INSERTs JE-3 (new posting, source_id=inv,
--                             reversal_of_id=NULL)
--      → Trigger fires on JE-3, finds JE-2 (source matches,
--        reversed_by_id IS NULL), raises "Double-post blocked".
--      → Invoice header is already updated (status=confirmed,
--        total_amount=new value), but the GL still has only JE-1 active.
--      → Reports keep showing the OLD numbers even though the invoice UI
--        shows the NEW grand total.
--
-- The fix: also exclude reversal entries themselves from the "is there
-- already an active posting?" lookup by adding `AND reversal_of_id IS
-- NULL`. A reversal entry is by definition NOT a competing posting — it's
-- the bookkeeping counter-entry that retires the original.
--
-- After this fix the chain works as intended:
--   - Edit-then-save on a confirmed invoice posts the new JE correctly.
--   - Reports immediately reflect the edited totals.
--   - The original "double-post" guard still blocks the broken UI path
--     where a confirmed invoice is silently saved-as-draft then re-
--     confirmed (which leaves the old JE active AND inserts a new one).
-- ─────────────────────────────────────────────────────────────────────────

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

  -- Look for any other CANONICAL POSTING JE with the same source that is
  -- still active. "Canonical posting" = NOT a reversal entry, AND not yet
  -- itself reversed. Both conditions matter:
  --   - reversed_by_id IS NULL  → still active
  --   - reversal_of_id IS NULL  → not a reversal of something else
  -- The second condition is what fixes the bug in Phase 12.15: without it,
  -- the reversal entry produced by edit_invoice was misclassified as a
  -- competing posting and the repost step was blocked.
  SELECT entry_number INTO v_existing
  FROM public.journal_entries
  WHERE company_id      = NEW.company_id
    AND source_type     = NEW.source_type
    AND source_id       = NEW.source_id
    AND reversed_by_id IS NULL
    AND reversal_of_id IS NULL
    AND id              <> NEW.id
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

COMMENT ON FUNCTION public._guard_no_double_post() IS
  'BEFORE INSERT trigger on journal_entries. Blocks posting a second '
  'canonical JE for a source document that already has an active one. '
  'A "canonical posting JE" is one with reversed_by_id IS NULL AND '
  'reversal_of_id IS NULL — i.e. an active, non-reversal entry. Reversal '
  'entries (reversal_of_id IS NOT NULL) bypass the check entirely. '
  'edit_invoice and similar reverse-and-repost flows work because '
  '(a) reversals bypass the check at insert time, and (b) the original '
  'gets reversed_by_id set before the new posting is inserted.';

-- Trigger itself is unchanged from Phase 12.15 — only the function body
-- changes. The DROP+CREATE here is defensive for environments where the
-- trigger may have been removed.
DROP TRIGGER IF EXISTS journal_entries_guard_no_double_post ON public.journal_entries;
CREATE TRIGGER journal_entries_guard_no_double_post
BEFORE INSERT ON public.journal_entries
FOR EACH ROW EXECUTE FUNCTION public._guard_no_double_post();
