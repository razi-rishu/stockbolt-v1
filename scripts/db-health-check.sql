-- ─────────────────────────────────────────────────────────────────────────
-- db-health-check.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Paste this into the Supabase SQL editor any time you want a 5-second
-- sanity sweep across the DB. Returns one row per check:
--
--   status   = ✓ pass / ✗ FAIL
--   detail   = humanly readable explanation
--
-- All checks are read-only; safe to run on production.
--
-- Run this:
--   • After applying any new migration
--   • Before/after a Reset Company Data
--   • Whenever a report number looks off
--   • As part of release checklist
-- ─────────────────────────────────────────────────────────────────────────

WITH checks AS (
  -- ─── Migration / function fixes ────────────────────────────────────────
  SELECT 1 AS sort, 'Phase 12.18: search_products has ::NUMERIC cast' AS check_name,
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'search_products'
        AND pg_get_functiondef(oid) ~* 'selling_price\s*::\s*NUMERIC'
    ) THEN '✓ pass' ELSE '✗ FAIL — apply migration 20260515000004 (defensive cast)' END AS status,
    '' AS detail

  UNION ALL SELECT 2, 'Phase 12.18: search_contacts has ::NUMERIC cast',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'search_contacts'
        AND pg_get_functiondef(oid) ~* 'credit_limit\s*::\s*NUMERIC'
    ) THEN '✓ pass' ELSE '✗ FAIL — apply migration 20260515000004' END, ''

  UNION ALL SELECT 3, 'Phase 12.19: _guard_no_double_post filters reversal entries',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = '_guard_no_double_post'
        AND pg_get_functiondef(oid) ~* 'reversal_of_id\s+IS\s+NULL'
        AND pg_get_functiondef(oid) ~* 'reversed_by_id\s+IS\s+NULL'
    ) THEN '✓ pass' ELSE '✗ FAIL — apply migration 20260517000001' END, ''

  UNION ALL SELECT 4, 'Phase 12.20: edit_invoice always writes stock_ledger',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'edit_invoice' AND pronargs = 1
        AND pg_get_functiondef(oid) LIKE '%Phase 12.20%'
    ) THEN '✓ pass' ELSE '✗ FAIL — apply migration 20260517000002' END, ''

  UNION ALL SELECT 5, 'Phase 12.21: edit_invoice does not double-reverse',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'edit_invoice' AND pronargs = 1
        AND pg_get_functiondef(oid) LIKE '%Phase 12.21%'
    ) THEN '✓ pass' ELSE '✗ FAIL — apply migration 20260517000003' END, ''

  UNION ALL SELECT 6, 'Phase 12.22: confirm_invoice uses gross method (Sales Discounts 4150)',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'confirm_invoice' AND pronargs = 1
        AND pg_get_functiondef(oid) LIKE '%Phase 12.22%'
    ) THEN '✓ pass' ELSE '✗ FAIL — apply migration 20260518000001' END, ''

  UNION ALL SELECT 7, 'Phase 12.22: edit_invoice uses gross method',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'edit_invoice' AND pronargs = 1
        AND pg_get_functiondef(oid) LIKE '%Phase 12.22%'
    ) THEN '✓ pass' ELSE '✗ FAIL — apply migration 20260518000001' END, ''

  -- ─── Triggers / constraints ────────────────────────────────────────────
  UNION ALL SELECT 10, 'journal_entries_guard_no_double_post trigger present',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relname = 'journal_entries'
        AND t.tgname = 'journal_entries_guard_no_double_post'
        AND NOT t.tgisinternal
    ) THEN '✓ pass' ELSE '✗ FAIL — trigger missing, re-apply Phase 12.15/12.19' END, ''

  UNION ALL SELECT 11, 'stock_ledger.type CHECK allows void + edit_reversal',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
      WHERE r.relname = 'stock_ledger' AND c.conname = 'stock_ledger_type_check'
        AND pg_get_constraintdef(c.oid) ~ '''void'''
        AND pg_get_constraintdef(c.oid) ~ '''edit_reversal'''
    ) THEN '✓ pass' ELSE '✗ FAIL — re-apply Phase 12.14' END, ''

  -- ─── Live data invariants ──────────────────────────────────────────────
  UNION ALL SELECT 20, 'No invoice has >1 active canonical sales JE',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM journal_entries
      WHERE source_type = 'sales_invoice'
        AND reversal_of_id IS NULL
        AND reversed_by_id IS NULL
      GROUP BY source_id HAVING COUNT(*) > 1
    ) THEN '✓ pass' ELSE '✗ FAIL — double-post slipped through' END,
    (SELECT COALESCE(string_agg(source_id::text, ', '), '')
     FROM (SELECT source_id FROM journal_entries
           WHERE source_type = 'sales_invoice'
             AND reversal_of_id IS NULL
             AND reversed_by_id IS NULL
           GROUP BY source_id HAVING COUNT(*) > 1) x)

  UNION ALL SELECT 21, 'No stock_ledger original has >1 active reversal',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM stock_ledger WHERE reversal_of_id IS NOT NULL
      GROUP BY reversal_of_id HAVING COUNT(*) > 1
    ) THEN '✓ pass' ELSE '✗ FAIL — Phase 12.21 corruption present' END, ''

  UNION ALL SELECT 22, 'All journal_entries balance (debit = credit)',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM journal_entries WHERE ABS(total_debit - total_credit) > 0.01
    ) THEN '✓ pass' ELSE '✗ FAIL — unbalanced JE detected' END, ''

  UNION ALL SELECT 23, 'All GL rows per JE balance (debit = credit)',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM general_ledger GROUP BY journal_entry_id
      HAVING ABS(SUM(debit) - SUM(credit)) > 0.01
    ) THEN '✓ pass' ELSE '✗ FAIL — GL rows per JE do not balance' END, ''

  UNION ALL SELECT 25, 'Confirmed invoices with discount have 4150 entry (gross method)',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM invoices i
      JOIN journal_entries je ON je.source_id = i.id
                            AND je.source_type='sales_invoice'
                            AND je.reversed_by_id IS NULL
                            AND je.reversal_of_id IS NULL
      WHERE i.status='confirmed' AND i.discount_amount > 0
        AND NOT EXISTS (SELECT 1 FROM general_ledger gl
                         WHERE gl.journal_entry_id=je.id AND gl.account_code='4150')
    ) THEN '✓ pass' ELSE '✗ FAIL — gross method skipped on at least one invoice' END,
    (SELECT COALESCE(string_agg(invoice_number, ', '), '')
     FROM (SELECT i.invoice_number FROM invoices i
           JOIN journal_entries je ON je.source_id=i.id AND je.source_type='sales_invoice'
                                  AND je.reversed_by_id IS NULL AND je.reversal_of_id IS NULL
           WHERE i.status='confirmed' AND i.discount_amount > 0
             AND NOT EXISTS (SELECT 1 FROM general_ledger gl
                              WHERE gl.journal_entry_id=je.id AND gl.account_code='4150')) x)

  UNION ALL SELECT 24, 'Confirmed invoices: GL AR matches invoice.total_amount',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM invoices i
      LEFT JOIN general_ledger g ON g.related_doc_type='invoice' AND g.related_doc_id=i.id
      WHERE i.status='confirmed'
      GROUP BY i.id, i.invoice_number, i.total_amount
      HAVING ABS(i.total_amount - COALESCE(SUM(g.debit - g.credit) FILTER (WHERE g.account_code='1200'), 0)) > 0.01
    ) THEN '✓ pass' ELSE '✗ FAIL — at least one invoice GL drift' END,
    (SELECT COALESCE(string_agg(invoice_number, ', '), '')
     FROM (SELECT i.invoice_number FROM invoices i
           LEFT JOIN general_ledger g ON g.related_doc_type='invoice' AND g.related_doc_id=i.id
           WHERE i.status='confirmed'
           GROUP BY i.id, i.invoice_number, i.total_amount
           HAVING ABS(i.total_amount - COALESCE(SUM(g.debit - g.credit) FILTER (WHERE g.account_code='1200'), 0)) > 0.01) x)
)
SELECT status, check_name, detail FROM checks ORDER BY sort;
