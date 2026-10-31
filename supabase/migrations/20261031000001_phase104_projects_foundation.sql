-- phase104: projects / jobs — foundation only
--
-- Stage 1 of 4. This migration adds the SHAPE and nothing else: a projects
-- table, a per-company switch, and a nullable project_id on the documents and
-- on general_ledger. No posting engine writes project_id yet, so every value
-- is NULL, every existing report is byte-identical, and nothing behaves
-- differently for any tenant until Stage 2.
--
-- WHY project_id LIVES ON general_ledger AND NOT ONLY ON DOCUMENTS
-- Profitability is then a ledger question, which makes the chart of accounts
-- settle the trading-vs-services difference for free:
--
--   a supplier bill at a SERVICES tenant  -> posts to a 6xxx expense -> cost
--   a supplier bill at a TRADING tenant   -> posts to 1300 Inventory -> asset,
--     not a cost; the cost lands later as 5100 COGS when the goods are sold,
--     at moving-average cost
--
-- So "project cost = expense-type GL lines tagged to the job" is correct for
-- both without a business-type branch anywhere. Tagging the DOCUMENT instead
-- would count a trading tenant's stock purchase as a job cost immediately and
-- then count it again as COGS on sale.
--
-- It also inherits, at no cost: tax excluded (VAT posts to 2200, a liability,
-- never income), payments excluded (cash Dr / AR Cr — neither is income or
-- expense), advances excluded until applied (2400, a liability), voids and
-- reversals handled (gl_active already drops reversed rows), base currency
-- (the GL is always base), and period filtering (GL lines carry dates).
--
-- ADDITIVE AND IDEMPOTENT
-- Every object is guarded; the file is safe to run twice. Nothing is dropped,
-- renamed or retyped. The new column on general_ledger is nullable with no
-- default, so it neither rewrites the table nor touches a single existing row.
--
-- UNDO PATH: additive — there is nothing to undo. Code that does not know
-- about projects ignores the column, which is also why an Android client on
-- 1.0.3 is unaffected by this landing before its release.

BEGIN;

-- 1. The project ------------------------------------------------------------
-- Holds no money. It is a label that GL lines point at; every figure on a
-- project page is derived from the ledger at read time (Rule 1 — no cached
-- aggregates). The estimates below are the ONLY stored numbers, and they are
-- a budget the operator types, not a computed balance.
CREATE TABLE IF NOT EXISTS public.projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name          text NOT NULL,
  name_ar       text,
  -- Optional. When set, "+ Invoice" / "+ Quotation" from the project page
  -- pre-fill this customer.
  contact_id    uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'planned'
                  CHECK (status IN ('planned','active','completed','cancelled')),
  -- Budget. In the company's BASE currency: the GL is always base currency, so
  -- comparing an estimate against realised figures only means anything if both
  -- are in the same unit.
  estimated_revenue numeric(15,2) NOT NULL DEFAULT 0,
  estimated_cost    numeric(15,2) NOT NULL DEFAULT 0,
  start_date    date,
  end_date      date,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid
);

CREATE INDEX IF NOT EXISTS projects_company_status_idx
  ON public.projects (company_id, status);
CREATE INDEX IF NOT EXISTS projects_contact_idx
  ON public.projects (contact_id);

-- 2. RLS — same shape as every other master table ----------------------------
-- tenant_isolation permits only the caller's company; the restrictive rbac
-- policies then require sales.write for any write. CREATE POLICY has no
-- IF NOT EXISTS, and a bare one aborts the whole script on a re-run, so each
-- is dropped first.
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.projects;
CREATE POLICY tenant_isolation ON public.projects
  FOR ALL
  USING      (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

DROP POLICY IF EXISTS rbac_w_ins_projects ON public.projects;
CREATE POLICY rbac_w_ins_projects ON public.projects
  AS RESTRICTIVE FOR INSERT
  WITH CHECK (public.has_perm('sales.write'));

DROP POLICY IF EXISTS rbac_w_upd_projects ON public.projects;
CREATE POLICY rbac_w_upd_projects ON public.projects
  AS RESTRICTIVE FOR UPDATE
  USING      (public.has_perm('sales.write'))
  WITH CHECK (public.has_perm('sales.write'));

DROP POLICY IF EXISTS rbac_w_del_projects ON public.projects;
CREATE POLICY rbac_w_del_projects ON public.projects
  AS RESTRICTIVE FOR DELETE
  USING (public.has_perm('sales.write'));

-- 3. updated_at, the house trigger -------------------------------------------
DROP TRIGGER IF EXISTS projects_set_updated_at ON public.projects;
CREATE TRIGGER projects_set_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. The module switch -------------------------------------------------------
-- DEFAULT false, so every existing tenant — Pro_Parts, IMBD123 and the rest —
-- sees no change whatsoever. Orvella Event gets it switched on by hand.
-- Sibling of the existing companies.cogs_deferral_enabled flag.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS projects_enabled boolean NOT NULL DEFAULT false;

-- 5. project_id on the documents ---------------------------------------------
-- ON DELETE RESTRICT on purpose: a project that has been used must not be
-- deletable out from under its records. The UI marks jobs completed or
-- cancelled rather than deleting them.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE RESTRICT;
ALTER TABLE public.sales_quotes
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE RESTRICT;
ALTER TABLE public.vendor_bills
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE RESTRICT;
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS invoices_project_idx
  ON public.invoices (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_quotes_project_idx
  ON public.sales_quotes (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vendor_bills_project_idx
  ON public.vendor_bills (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS expenses_project_idx
  ON public.expenses (project_id) WHERE project_id IS NOT NULL;

-- 6. project_id on the ledger ------------------------------------------------
-- The column only. NOTHING writes to it until Stage 2 patches the posting
-- engines, so it is NULL on every existing and every newly posted row, and no
-- report changes. Partial index because the overwhelming majority of GL rows
-- will never carry a project.
ALTER TABLE public.general_ledger
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS general_ledger_project_idx
  ON public.general_ledger (company_id, project_id) WHERE project_id IS NOT NULL;

-- 7. gl_active must carry the new column -------------------------------------
-- A view's column list is FROZEN at creation: gl_active names its columns
-- explicitly, so adding project_id to general_ledger does NOT make it visible
-- through the view. Every report reads gl_active rather than the raw table
-- because the view is what excludes reversed rows (AGENTS.md 8.4), so without
-- this the project report would have to read general_ledger directly and would
-- silently count voided documents.
--
-- This has already happened once: reconciliation_id was added to
-- general_ledger and never reached the view. It is included here too, since
-- recreating the view costs nothing extra and leaving a known gap in place is
-- how the next person trips over it.
--
-- CREATE OR REPLACE VIEW may only APPEND columns — never reorder or remove —
-- so the two new ones go at the end and every existing consumer is unaffected.
CREATE OR REPLACE VIEW public.gl_active AS
  SELECT gl.id,
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
         gl.created_at,
         gl.reconciliation_id,
         gl.project_id
    FROM public.general_ledger gl
    JOIN public.journal_entries je ON je.id = gl.journal_entry_id
   WHERE je.reversed_by_id IS NULL AND je.reversal_of_id IS NULL;

COMMIT;
