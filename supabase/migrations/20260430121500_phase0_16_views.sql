-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 0 — Migration 16: Views (gl_active, stock_active)
-- ─────────────────────────────────────────────────────────────────────────
-- Per Doc 4 Rule 3 + AGENTS.md §8.4: ALL reports read from these views,
-- never from raw general_ledger or stock_ledger. The views exclude
-- reversed rows and reversal rows so reports always show the net active
-- picture.
-- ─────────────────────────────────────────────────────────────────────────

-- ── gl_active ─────────────────────────────────────────────────────────────
-- Excludes (a) GL rows belonging to a JE that has been reversed
--          (b) GL rows belonging to a JE that IS a reversal of another JE.
-- Net effect: only "live" entries that should appear in the trial balance.
CREATE OR REPLACE VIEW public.gl_active AS
SELECT
  gl.id,
  gl.company_id,
  gl.journal_entry_id,
  gl.account_id,
  gl.account_code,
  gl.date,
  gl.debit,
  gl.credit,
  gl.description,
  gl.contact_id,
  gl.related_doc_type,
  gl.related_doc_id,
  gl.reversal_of_id,
  gl.created_at
FROM public.general_ledger gl
JOIN public.journal_entries je ON je.id = gl.journal_entry_id
WHERE je.reversed_by_id IS NULL
  AND je.reversal_of_id IS NULL;

COMMENT ON VIEW public.gl_active IS
  'Doc 4 Rule 3 — all reports read from here. Excludes rows whose JE has been reversed AND rows that are themselves reversal entries.';

-- ── stock_active ─────────────────────────────────────────────────────────
-- Excludes (a) stock_ledger rows that are reversals of another row
--          (b) stock_ledger rows that have been reversed.
CREATE OR REPLACE VIEW public.stock_active AS
SELECT
  sl.id,
  sl.company_id,
  sl.product_id,
  sl.warehouse_id,
  sl.date,
  sl.type,
  sl.quantity,
  sl.direction,
  sl.unit_cost,
  sl.total_cost,
  sl.running_qty,
  sl.running_avg_cost,
  sl.related_doc_type,
  sl.related_doc_id,
  sl.notes,
  sl.reversal_of_id,
  sl.created_at
FROM public.stock_ledger sl
WHERE sl.reversal_of_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id
  );

COMMENT ON VIEW public.stock_active IS
  'Doc 4 Rule 3 — stock balances and movement reports read from here. Excludes both reversed rows and reversal rows.';
