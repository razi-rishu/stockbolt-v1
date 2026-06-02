-- ═══════════════════════════════════════════════════════════════════════════
-- StockBolt — wipe ALL companies + ALL data, full reset
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES
-- ──────────────
-- Deletes every business row from every multi-tenant table:
--   companies, profiles, chart_of_accounts, products, contacts, invoices,
--   vendor_bills, payments, journal_entries, general_ledger, stock_ledger,
--   bank_accounts, warehouses, units_of_measure, categories, brands,
--   tax_rates, payment_methods, vehicle_makes/models, salespeople,
--   price_levels, print_templates, attachments, notifications, audit_logs,
--   document_sequences, and every transactional table.
--
-- HOW IT WORKS
-- ────────────
-- One TRUNCATE ... CASCADE on public.companies. Postgres walks every FK
-- back to companies and clears those tables too in a single atomic
-- statement. Faster than DELETE, and CASCADE means we don't have to list
-- 50+ tables in the right tier order.
--
-- WHAT IS NOT TOUCHED
-- ───────────────────
--   - auth.users (your Supabase login still works — same email/password)
--   - auth.identities, auth.sessions (also intact)
--   - Storage buckets (any uploaded files survive unless they were tied to
--     a row that got cascaded)
--   - Database schema / functions / RPCs / RLS policies (only DATA goes)
--
-- AFTER RUNNING
-- ─────────────
-- Log into the app again. You'll land on /setup because your profile is
-- gone. Complete the 5-step wizard — a fresh company + seeded CoA is
-- created. You're back to a clean slate.
--
-- SAFETY
-- ──────
-- This is IRREVERSIBLE. There is no undo. Make sure no real data lives
-- in the system before running. If you're not sure — back up first
-- (Supabase Dashboard → Database → Backups → Create backup).
--
-- HOW TO RUN
-- ──────────
-- 1. Open https://supabase.com/dashboard → your project → SQL Editor
-- 2. Click + New query
-- 3. Paste this entire file
-- 4. Click Run
-- 5. You should see "Success. No rows returned."
-- 6. Refresh the StockBolt app — you'll be on /setup
--
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Optional sanity-check counts before the wipe (you'll see these in the
-- Results panel as "1 row returned" — comment out if you don't care).
SELECT
  (SELECT COUNT(*) FROM public.companies)            AS companies_before,
  (SELECT COUNT(*) FROM public.profiles)             AS profiles_before,
  (SELECT COUNT(*) FROM public.invoices)             AS invoices_before,
  (SELECT COUNT(*) FROM public.products)             AS products_before,
  (SELECT COUNT(*) FROM public.bank_accounts)        AS banks_before;

-- The one-liner that does the work. CASCADE means every FK to companies
-- gets followed; everything multi-tenant is cleared in one swing.
TRUNCATE public.companies CASCADE;

-- audit_logs has no FK to companies (deliberately) so it survives the
-- cascade — wipe it explicitly too, since stale entries would point at
-- company_ids that no longer exist.
TRUNCATE public.audit_logs CASCADE;

-- Sanity-check counts after the wipe — every value should be 0.
SELECT
  (SELECT COUNT(*) FROM public.companies)            AS companies_after,
  (SELECT COUNT(*) FROM public.profiles)             AS profiles_after,
  (SELECT COUNT(*) FROM public.invoices)             AS invoices_after,
  (SELECT COUNT(*) FROM public.products)             AS products_after,
  (SELECT COUNT(*) FROM public.bank_accounts)        AS banks_after;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- Done. Refresh PostgREST so any cached row counts are flushed.
-- ═══════════════════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';
