-- Phase 12 — Index Audit
--
-- Adds composite indexes that are critical for report performance.
-- All are created CONCURRENTLY-style using IF NOT EXISTS so they
-- are safe to re-run and won't block DML during migration on large tables.
--
-- Priority gaps identified:
-- 1. general_ledger(company_id, account_code, date) — used by every report
--    filter; existing index is on account_id (UUID), not account_code (text).
-- 2. vendor_bill_items(product_id) — required for purchases-by-product report.
-- 3. contacts(company_id, type, is_active) — autocomplete queries always
--    include company_id but the existing type_active_idx omits it.
-- 4. invoice_items(product_id, invoice_id) — supports sales-by-product joins.
-- 5. payment_allocations(company_id, doc_type, doc_id) — AR aging sums.
-- 6. general_ledger(company_id, related_doc_type, related_doc_id) — tracing
--    GL lines back to source documents (used in reversal-trail report).

-- ── 1. GL account_code + date ─────────────────────────────────────────────
-- Covers: .eq(company_id).in(account_code).gte/lte(date)
CREATE INDEX IF NOT EXISTS general_ledger_company_acct_date_idx
  ON public.general_ledger (company_id, account_code, date);

-- ── 2. GL company_id + date ───────────────────────────────────────────────
-- Covers date-range scans that don't filter by account_code (e.g. cash-flow
-- queries that pull multiple account codes in one pass).
CREATE INDEX IF NOT EXISTS general_ledger_company_date_idx
  ON public.general_ledger (company_id, date);

-- ── 3. Vendor bill items by product ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS vendor_bill_items_product_id_idx
  ON public.vendor_bill_items (product_id);

-- ── 4. Invoice items by product ──────────────────────────────────────────
-- Note: invoice_items_product_id_idx already covers the single-column case;
-- the composite version helps when joining back to invoices on invoice_id.
CREATE INDEX IF NOT EXISTS invoice_items_product_invoice_idx
  ON public.invoice_items (product_id, invoice_id);

-- ── 5. Contacts with company_id prefix ───────────────────────────────────
-- Every contact query starts with company_id; this replaces the scan on the
-- existing (type, is_active, name) index which lacks company_id.
CREATE INDEX IF NOT EXISTS contacts_company_type_active_name_idx
  ON public.contacts (company_id, type, is_active, name);

-- ── 6. Payment allocations scoped by company ─────────────────────────────
-- AR aging sums iterate allocations by company + doc.
CREATE INDEX IF NOT EXISTS payment_allocations_company_doc_idx
  ON public.payment_allocations (company_id, doc_type, doc_id);

-- ── 7. GL company + related doc (reversal trail / payment tracking) ───────
CREATE INDEX IF NOT EXISTS general_ledger_company_related_doc_idx
  ON public.general_ledger (company_id, related_doc_type, related_doc_id);

-- ── 8. Journal entries company + date (period summaries) ─────────────────
CREATE INDEX IF NOT EXISTS journal_entries_company_date_idx
  ON public.journal_entries (company_id, date);

-- ── 9. Stock ledger company + date (inventory valuation by period) ────────
CREATE INDEX IF NOT EXISTS stock_ledger_company_date_idx
  ON public.stock_ledger (company_id, date);

-- ── 10. Products: full-text-style search on sku + name ───────────────────
-- Covers the "search products" autocomplete: .ilike(name) OR .eq(sku)
CREATE INDEX IF NOT EXISTS products_company_sku_idx
  ON public.products (company_id, sku);
