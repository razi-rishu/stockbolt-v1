-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 12 — Migration 16: Salespeople master table
-- ─────────────────────────────────────────────────────────────────────────
-- The Phase 0 schema referenced profiles.id for salesperson_id on sales
-- documents — assuming every salesperson is a system user. In practice
-- (especially small auto-parts shops) salespeople are floor staff who
-- never log in; the admin/cashier tags invoices with their name to
-- track commission and performance.
--
-- This migration introduces a dedicated salespeople master so the admin
-- can manage names from the UI without creating Supabase auth users.
--
-- Schema changes:
--   1. CREATE TABLE salespeople (id, company_id, name, name_ar, email,
--      phone, commission_pct, is_active, notes, created_at, updated_at)
--   2. NULL out existing salesperson_id on all 4 sales-side tables
--      (system is in QA — no real data to preserve)
--   3. Drop the FK to profiles, add a new FK to salespeople (ON DELETE
--      SET NULL — deactivating a salesperson does NOT cascade-delete
--      historical sales)
--   4. RLS: company-scoped read; writes via standard CRUD (no RPC
--      gating — this is master data, not GL-touching)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE public.salespeople (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  name            TEXT NOT NULL,
  name_ar         TEXT,
  email           TEXT,
  phone           TEXT,
  commission_pct  NUMERIC(5,2) NOT NULL DEFAULT 0
                  CHECK (commission_pct >= 0 AND commission_pct <= 100),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX salespeople_company_active_idx
  ON public.salespeople (company_id, is_active);
CREATE INDEX salespeople_name_idx
  ON public.salespeople (company_id, name);

-- Reuse the set_updated_at trigger fn defined in Phase 0
CREATE TRIGGER salespeople_set_updated_at
  BEFORE UPDATE ON public.salespeople
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.salespeople IS
  'Master list of sales staff per company. Independent of profiles '
  '(auth users) — a salesperson does not need to log in. Tagged on '
  'sales documents (invoices, quotes, orders, credit notes) for '
  'reporting and commission tracking.';

-- ── Swap FKs from profiles → salespeople ─────────────────────────────────
-- System is in QA; any existing salesperson_id values are pointing at
-- the admin's own profile (the only profile that exists). Reset to NULL
-- so the FK swap doesn't violate; the admin can re-tag in the UI after
-- creating their salesperson list.

UPDATE public.invoices      SET salesperson_id = NULL;
UPDATE public.sales_quotes  SET salesperson_id = NULL;
UPDATE public.sales_orders  SET salesperson_id = NULL;
UPDATE public.credit_notes  SET salesperson_id = NULL;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_salesperson_id_fkey;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_salesperson_id_fkey
  FOREIGN KEY (salesperson_id) REFERENCES public.salespeople(id) ON DELETE SET NULL;

ALTER TABLE public.sales_quotes
  DROP CONSTRAINT IF EXISTS sales_quotes_salesperson_id_fkey;
ALTER TABLE public.sales_quotes
  ADD CONSTRAINT sales_quotes_salesperson_id_fkey
  FOREIGN KEY (salesperson_id) REFERENCES public.salespeople(id) ON DELETE SET NULL;

ALTER TABLE public.sales_orders
  DROP CONSTRAINT IF EXISTS sales_orders_salesperson_id_fkey;
ALTER TABLE public.sales_orders
  ADD CONSTRAINT sales_orders_salesperson_id_fkey
  FOREIGN KEY (salesperson_id) REFERENCES public.salespeople(id) ON DELETE SET NULL;

ALTER TABLE public.credit_notes
  DROP CONSTRAINT IF EXISTS credit_notes_salesperson_id_fkey;
ALTER TABLE public.credit_notes
  ADD CONSTRAINT credit_notes_salesperson_id_fkey
  FOREIGN KEY (salesperson_id) REFERENCES public.salespeople(id) ON DELETE SET NULL;

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.salespeople ENABLE ROW LEVEL SECURITY;

CREATE POLICY salespeople_read ON public.salespeople
  FOR SELECT
  USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY salespeople_insert ON public.salespeople
  FOR INSERT
  WITH CHECK (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY salespeople_update ON public.salespeople
  FOR UPDATE
  USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY salespeople_delete ON public.salespeople
  FOR DELETE
  USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));
