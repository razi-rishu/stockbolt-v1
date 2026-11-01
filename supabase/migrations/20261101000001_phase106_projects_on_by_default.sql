-- phase106: the Projects module is available to every tenant
--
-- phase104 added companies.projects_enabled with DEFAULT false, so that
-- landing the feature could not change anything for a tenant already using
-- StockBolt while it was built across four stages. Stages 1-3b are now
-- complete and the feature works end to end, so that reason has expired.
--
-- This does two separate things, and both are needed:
--
--   1. turns the module ON for every EXISTING company;
--   2. flips the column DEFAULT, so every company created from now on gets it
--      without anyone remembering to run an UPDATE.
--
-- Doing only (1) would leave the next signup without it, which is exactly the
-- kind of gap that is discovered months later by a customer.
--
-- THE FLAG IS KEPT, NOT REMOVED. "On for everyone, can be switched off" is a
-- different thing from "always on". A counter-sales parts shop has no jobs, and
-- for them the Project field is clutter on every invoice; leaving the switch in
-- place means that is one UPDATE rather than a code change. This also matches
-- companies.cogs_deferral_enabled, which already defaults to true and is the
-- established shape for a module flag here.
--
-- WHY THIS IS SAFE FOR A TENANT WITH NO PROJECTS
-- Both surfaces handle the empty case deliberately: the Projects page shows its
-- own empty state, and ProjectPicker falls back to a "No projects yet"
-- placeholder whose only option is "No project". So a tenant who never creates
-- a job sees an extra nav entry and an extra optional field, and nothing else
-- changes - no posting path, no report, no figure. project_id stays NULL on
-- every document and every ledger row until somebody deliberately tags one.
--
-- IT IS ALSO CORRECT FOR TRADING TENANTS, not only services ones. A services
-- tenant's bill posts to a 6xxx expense and is job cost immediately; a trading
-- tenant's purchase posts to 1300 Inventory and reaches the job later as 5100
-- COGS at moving-average cost, when the goods sell. The chart of accounts
-- settles the difference, which is why there is no business-type branch
-- anywhere in the feature and why switching it on for a parts shop doing fleet
-- or workshop work gives the right answer.
--
-- ADDITIVE AND IDEMPOTENT: re-running sets the same default and updates no
-- further rows. Nothing is dropped, renamed or retyped.
--
-- UNDO PATH:
--   ALTER TABLE public.companies ALTER COLUMN projects_enabled SET DEFAULT false;
--   UPDATE public.companies SET projects_enabled = false WHERE id <> '<orvella-id>';
-- Note that turning it back off strands data rather than removing it: the UI
-- disappears but any project_id already written to the ledger remains, so a
-- tenant would have figures attributed to jobs they can no longer see. That is
-- an argument for leaving it on, not for avoiding this migration.

BEGIN;

-- 1. Every company created from here on ---------------------------------------
ALTER TABLE public.companies
  ALTER COLUMN projects_enabled SET DEFAULT true;

-- 2. Every company that already exists ----------------------------------------
-- The WHERE clause makes a second run a no-op rather than a full-table write.
UPDATE public.companies
   SET projects_enabled = true
 WHERE projects_enabled IS NOT TRUE;

COMMENT ON COLUMN public.companies.projects_enabled IS
  'Whether the Projects / Jobs module is shown to this tenant. Defaults TRUE '
  'since phase106 (was FALSE in phase104, while the feature was being built in '
  'stages). Gates the nav section, the Projects page and the Project field on '
  'invoices, quotations, supplier bills and expenses. Set FALSE for a tenant '
  'that does not want it - but note that any project_id already written to the '
  'ledger survives, so their tagged figures become invisible rather than gone.';

COMMIT;
