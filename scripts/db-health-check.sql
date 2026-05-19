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

  UNION ALL SELECT 8, 'Phase 12.23: confirm_payment posts post-sale discount to 6850',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'confirm_payment' AND pronargs = 1
        AND pg_get_functiondef(oid) LIKE '%Phase 12.23%'
    ) THEN '✓ pass' ELSE '✗ FAIL — apply migration 20260518000002' END, ''

  UNION ALL SELECT 9, 'Phase 12.23: payment_allocations.discount_amount column exists',
    CASE WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'payment_allocations'
        AND column_name = 'discount_amount'
    ) THEN '✓ pass' ELSE '✗ FAIL — apply migration 20260518000002' END, ''

  UNION ALL SELECT 11, 'Phase 12.27: confirm_vendor_bill filters stale rows + flushes deferred COGS',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'confirm_vendor_bill' AND pronargs = 1
        AND pg_get_functiondef(oid) LIKE '%Phase 12.27%'
        AND pg_get_functiondef(oid) LIKE '%deferred_cogs_queue%'
        AND pg_get_functiondef(oid) ~ 'status\s*=\s*''flushed'''
    ) THEN '✓ pass' ELSE '✗ FAIL — apply migration 20260519000001' END, ''

  UNION ALL SELECT 12, 'Phase 12.27: edit_invoice re-queues deferred COGS when MAC=0',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'edit_invoice' AND pronargs = 1
        AND pg_get_functiondef(oid) LIKE '%Phase 12.27%'
        AND pg_get_functiondef(oid) ~* 'INSERT\s+INTO\s+public\.deferred_cogs_queue'
    ) THEN '✓ pass' ELSE '✗ FAIL — apply migration 20260519000001' END, ''

  UNION ALL SELECT 10, 'Phase 12.17: vendor_bills.landed_cost_total + vendor_bill_items.warehouse_id exist',
    CASE WHEN
      EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='vendor_bills'
                AND column_name='landed_cost_total')
      AND
      EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='vendor_bill_items'
                AND column_name='warehouse_id')
    THEN '✓ pass' ELSE '✗ FAIL — apply migration 20260515000003' END, ''

  UNION ALL SELECT 26, 'Phase 12.24: AR (1200) GL rows always carry contact_id',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM general_ledger WHERE account_code='1200' AND contact_id IS NULL
    ) THEN '✓ pass' ELSE '✗ FAIL — AR rows without contact_id will show as "(no contact)" in drill-downs' END,
    (SELECT COUNT(*)::text FROM general_ledger WHERE account_code='1200' AND contact_id IS NULL)

  UNION ALL SELECT 27, 'Phase 12.24: per-customer 2400 balance = cash received − allocated',
    CASE WHEN NOT EXISTS (
      WITH per_customer_cash AS (
        SELECT p.contact_id, COALESCE(SUM(p.amount), 0)::numeric AS cash
        FROM payments p WHERE p.status='confirmed' AND p.type='inbound'
        GROUP BY p.contact_id
      ),
      per_customer_alloc AS (
        SELECT p.contact_id,
               COALESCE(SUM(pa.amount_applied + COALESCE(pa.discount_amount, 0)), 0)::numeric AS allocated
        FROM payments p
        JOIN payment_allocations pa ON pa.payment_id=p.id AND pa.doc_type='invoice'
        WHERE p.status='confirmed' AND p.type='inbound'
        GROUP BY p.contact_id
      ),
      per_customer_2400 AS (
        SELECT contact_id, COALESCE(SUM(credit - debit), 0)::numeric AS gl_balance
        FROM general_ledger WHERE account_code='2400' AND contact_id IS NOT NULL
        GROUP BY contact_id
      ),
      merged AS (
        SELECT COALESCE(c.contact_id, a.contact_id, g.contact_id) AS contact_id,
               COALESCE(c.cash, 0) AS cash, COALESCE(a.allocated, 0) AS allocated,
               COALESCE(g.gl_balance, 0) AS gl_balance
        FROM per_customer_cash c
        FULL OUTER JOIN per_customer_alloc a USING (contact_id)
        FULL OUTER JOIN per_customer_2400  g USING (contact_id)
      )
      SELECT 1 FROM merged WHERE ABS(gl_balance - (cash - allocated)) > 0.01
    ) THEN '✓ pass' ELSE '✗ FAIL — per-customer 2400 balance does not match payment activity' END, ''

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

  UNION ALL SELECT 24, 'Confirmed invoices: canonical AR debit = total_amount',
    CASE WHEN NOT EXISTS (
      WITH canonical_je AS (
        SELECT id, source_id FROM journal_entries
        WHERE source_type='sales_invoice'
          AND reversal_of_id IS NULL
          AND reversed_by_id IS NULL
      )
      SELECT 1 FROM invoices i
      LEFT JOIN general_ledger g ON g.related_doc_type='invoice' AND g.related_doc_id=i.id
      WHERE i.status='confirmed'
      GROUP BY i.id, i.total_amount
      HAVING ABS(i.total_amount - COALESCE(SUM(g.debit) FILTER (
        WHERE g.account_code='1200'
          AND g.journal_entry_id IN (SELECT id FROM canonical_je WHERE source_id = i.id)
      ), 0)) > 0.01
    ) THEN '✓ pass' ELSE '✗ FAIL — canonical AR debit drift on at least one invoice' END, ''
)
SELECT status, check_name, detail FROM checks ORDER BY sort;
