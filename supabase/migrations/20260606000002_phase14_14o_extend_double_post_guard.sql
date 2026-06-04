-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 14.14o — extend _guard_no_double_post whitelist
-- ─────────────────────────────────────────────────────────────────────────
-- Audit item A — HIGH. The Phase 12.19 guard only covers four source_types:
--
--   sales_invoice, vendor_bill, sales_credit_note, vendor_debit_note
--
-- Everything else — expenses, bank transfers, POS sales, vendor / customer
-- payments, PDC events, sales returns, stock transfers, inventory
-- adjustments, GRNs — has no double-post protection. Symptom: an operator
-- clicks Confirm on an expense, the network blips between the JE insert
-- and the response, the UI shows an error, the operator clicks Confirm
-- again. Boom — two JEs for the same expense, books are silently over-
-- stated by exactly that amount until someone catches the duplicate in a
-- statement review.
--
-- This migration extends the whitelist to every "one canonical JE per
-- source document" source_type. The guard's existing logic (skip reversal
-- entries via reversal_of_id IS NOT NULL, skip already-reversed via
-- reversed_by_id IS NOT NULL) all still applies — so edit-and-repost
-- flows (`edit_invoice`-style) continue to work.
--
-- Deliberately EXCLUDED from the guard:
--   - inventory_cogs       — one JE PER INVOICE LINE; multi-JE per source
--   - opening_balance      — many subsidiary openings can share company-id
--   - opening_gl           — direct GL openings, no shared source
--   - opening_bank         — per-bank openings (one per bank, many banks)
--   - advance_application  — multiple applications can share one payment
--   - advance_refund       — multiple refunds can share one payment
--   - manual               — operator-driven, no source-doc semantic
--   - year_end_close       — once per year, low-risk; source_id format varies
--
-- After this migration, double-clicking Confirm on any of the new
-- whitelisted types raises:
--   "Double-post blocked: an unreversed <type> entry (<entry_number>)
--    already exists for this document (source_id=<id>). Void it or use
--    Save & Repost to revise."
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
  -- Phase 14.14o — expanded whitelist. Every source_type below represents
  -- ONE canonical JE per source document. See migration header for the
  -- explicit exclusion list and rationale.
  IF NEW.source_type NOT IN (
    -- Sales side
    'sales_invoice',
    'sales_credit_note',
    'sales_return',
    'customer_receipt',
    'customer_advance',
    -- POS
    'pos_cash_sale',
    'pos_card_sale',
    -- Purchase side
    'vendor_bill',
    'vendor_debit_note',
    'goods_receipt',
    'vendor_payment',
    'vendor_advance',
    -- Inventory
    'stock_transfer',
    'inventory_adjustment',
    -- Banking / cash
    'bank_transfer',
    'direct_receipt',
    'expense',
    -- PDC lifecycle (each event is one JE per cheque; source_type+source_id
    -- pair is unique per event so creation+clearing+bouncing don't conflict)
    'pdc_creation',
    'pdc_bank_post',
    'pdc_clear',
    'pdc_bounce'
  ) THEN
    RETURN NEW;
  END IF;

  -- Reversal entries bypass — they carry reversal_of_id and are the
  -- bookkeeping counter-entry, not a competing posting. (Unchanged from
  -- Phase 12.19.)
  IF NEW.reversal_of_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Look for any other CANONICAL POSTING JE with the same source that is
  -- still active. Canonical = NOT a reversal entry AND not yet reversed.
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
  'Phase 14.14o extended the whitelist beyond the original 4 types to '
  'cover expenses, transfers, GRNs, POS sales, payments, and PDC events. '
  'Reversal entries (reversal_of_id IS NOT NULL) and edit-and-repost '
  'flows still work — the original is marked reversed_by_id before the '
  'new posting inserts, so the lookup finds nothing competing.';

-- Trigger itself is unchanged from Phase 12.15 — only the function body
-- changes. DROP+CREATE for defensive idempotency.
DROP TRIGGER IF EXISTS journal_entries_guard_no_double_post ON public.journal_entries;
CREATE TRIGGER journal_entries_guard_no_double_post
BEFORE INSERT ON public.journal_entries
FOR EACH ROW EXECUTE FUNCTION public._guard_no_double_post();
