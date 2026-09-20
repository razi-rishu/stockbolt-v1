-- ============================================================================
-- Phase 52 — Audit H2, Option A
-- Whitelist-scoped PARTIAL UNIQUE INDEX on journal_entries.
-- Makes a duplicate canonical posting structurally impossible for exactly the
-- four document types the _guard_no_double_post trigger already guards.
-- ============================================================================
--
-- WHY
--   _guard_no_double_post is a BEFORE-INSERT read-check (SELECT ... LIMIT 1),
--   not a database constraint. Under READ COMMITTED, two concurrent
--   confirmations of the same draft cannot see each other's uncommitted JE, so
--   both pass the check and both commit -> two canonical journal entries for one
--   document (silent double-posting). A partial unique index closes that race
--   atomically at the storage layer.
--
-- SCOPE (Option A — approved)
--   The index predicate mirrors the trigger's whitelist EXACTLY:
--       'sales_invoice', 'vendor_bill', 'sales_credit_note', 'vendor_debit_note'
--   Because it matches the trigger's semantics, it can never reject an insert
--   the trigger already allows, so it cannot break any edit / void / repost flow
--   that works today:
--     * reversal mirrors            -> excluded (reversal_of_id IS NOT NULL)
--     * voided / superseded originals -> excluded (reversed_by_id IS NOT NULL)
--   Opening balances, POS sales, expenses and payments/receipts are NOT
--   trigger-guarded and are intentionally NOT covered by this index; their
--   behaviour is unchanged. (Extending coverage to those is a separate, larger
--   change — Option B — and is explicitly out of scope here.)
--
--   The _guard_no_double_post trigger is left AS-IS: it stays as the friendly
--   error-message layer; this index is the actual structural guarantee.
--
-- PREREQUISITE (verified 2026-07-22, read-only against production)
--   0 duplicate live canonicals exist for these four source_types
--   (source_id IS NOT NULL, reversal_of_id IS NULL, reversed_by_id IS NULL),
--   so the unique index builds cleanly.
--
-- HOW TO APPLY  (by hand, Supabase SQL Editor)
--   Run the CREATE INDEX statement below as a STANDALONE statement.
--   CREATE INDEX CONCURRENTLY cannot run inside a transaction block, so:
--     * do NOT wrap it in BEGIN/COMMIT,
--     * do NOT apply this file via `supabase db push` (push wraps in a txn),
--     * run only this one statement in the editor.
--   If the editor reports "CREATE INDEX CONCURRENTLY cannot run inside a
--   transaction block", use the NON-CONCURRENT fallback at the bottom instead
--   (safe here — the table is small, so the brief write-lock is sub-second).
--
-- ROLLBACK
--   DROP INDEX CONCURRENTLY IF EXISTS public.journal_entries_one_canonical_per_source;
--   (additive, no data touched — reversible with zero reconciliation risk)
-- ============================================================================

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  journal_entries_one_canonical_per_source
  ON public.journal_entries (company_id, source_type, source_id)
  WHERE source_id IS NOT NULL
    AND reversal_of_id IS NULL
    AND reversed_by_id IS NULL
    AND source_type IN (
      'sales_invoice',
      'vendor_bill',
      'sales_credit_note',
      'vendor_debit_note'
    );

-- ----------------------------------------------------------------------------
-- NON-CONCURRENT FALLBACK (use ONLY if the CONCURRENTLY form errors with
-- "cannot run inside a transaction block"). Same predicate; briefly locks the
-- table for writes while building (sub-second on this table).
-- ----------------------------------------------------------------------------
-- CREATE UNIQUE INDEX IF NOT EXISTS
--   journal_entries_one_canonical_per_source
--   ON public.journal_entries (company_id, source_type, source_id)
--   WHERE source_id IS NOT NULL
--     AND reversal_of_id IS NULL
--     AND reversed_by_id IS NULL
--     AND source_type IN (
--       'sales_invoice',
--       'vendor_bill',
--       'sales_credit_note',
--       'vendor_debit_note'
--     );
