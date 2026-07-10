---
name: stockbolt
description: >
  Operating guide for the StockBolt codebase — how the system works, what is
  important, and the working agreement with Rashid (the owner). Use this skill
  for ANY work in this repository: features, bug fixes, database migrations,
  posting/accounting changes, reports, UI/design changes, or questions about
  how StockBolt behaves. Consult it BEFORE touching posting RPCs, the GL,
  stock logic, or anything a live customer depends on — even for
  "small" changes.
---

# StockBolt — System & Working Agreement

StockBolt is a **published, multi-tenant auto-parts ERP** (stockbolt-v1.vercel.app)
with **real paying customers on the live database you are connected to**.
React + Vite + TS + Tailwind, Supabase (Postgres + RLS), TanStack Query,
i18next (EN + Arabic RTL). Sales, purchasing, inventory (moving-average cost),
double-entry accounting, VAT (GCC/India), payroll, POS, reports, SaaS billing.

Read `docs/AGENTS.md` first — it is the architecture rulebook (GL as the only
financial truth, posting engine, no cached aggregates, invariants). This skill
adds the operational layer: how we actually work, what is live, and the
hard-won doctrine from production incidents.

## Who you work with

Rashid is a solo builder, strong on product/accounting domain, **beginner on
infra** (Supabase dashboard, Google Cloud, git). Give exact step-by-step
instructions for anything outside the editor. He is decisive and fast — when
he says "fix globally", audit the WHOLE app for the same issue, not just the
screenshotted page.

## Non-negotiables (production safety)

1. **Live customers on this DB.** `IMBD123` (nabeelayar@gmail.com) and
   `Pro_Parts` are real businesses. **Never reset, delete, or "clean up"
   tenant data.** `Al Noor` is Rashid's own test tenant.
2. **Migrations are additive only** and Rashid applies every migration **by
   hand** in the Supabase SQL Editor — never run DDL/DML against the live DB
   yourself. Deliver a migration file + tell him exactly what to run.
3. **Patch posting RPCs from the LIVE definition** (`pg_get_functiondef` via
   the `_regression_test_query` helper RPC), never from old migration files —
   they drift. See `references/workflow.md` for the generator pattern.
4. **Git:** you edit and (when approved) commit; **Rashid pushes**. Commits
   end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
   Husky pre-commit runs the live-DB regression suite.
5. `SUPABASE_SERVICE_ROLE_KEY` lives only in Vercel env — never in client
   code or the DB. Probe scripts read `.env.local`
   (`VITE_SUPABASE_URL`, `SUPABASE_SECRET_KEY`) and are **deleted after use**.

## Accounting doctrine (the important part)

Beyond AGENTS.md, these rules came from real production incidents — every new
posting path must respect all of them:

- **Balance by construction**: revenue/goods amounts derive from
  `total_amount − tax_amount` (+ discount for the gross method), never from
  the header subtotal; per-line basis is `line_total − tax_amount`. Handles
  tax-inclusive pricing. A deferred constraint trigger `je_must_balance`
  rejects unbalanced JEs at commit — never work around it.
- **Voucher-date reversals**: every reversal/void/reopen/edit-repost posts at
  the ORIGINAL document's date, never `CURRENT_DATE`. Period-lock guards test
  the voucher date. An edit must never affect any period other than its own.
- **Stock ordering by `seq`**: all "latest stock row" and replay reads order
  by `stock_ledger.seq` — never `created_at DESC, id DESC` (uuid ties caused
  phantom valuation drift).
- **GL rows always carry** `account_code`, `date` (= their JE's date),
  `contact_id`, `related_doc_type/id`, and `reversal_of_id` on mirrors.
- **Services never touch inventory**; sell-before-buy uses the deferred-COGS
  queue (flushed at the next purchase's cost).
- Period Lock (`companies.period_lock_date`) is manual — advise customers to
  set it after VAT filing.

Full engine map: `references/system-map.md`.

## Standard workflows

**Any DB-side change** → write migration file in `supabase/migrations/`
(named `YYYYMMDDNNNNNN_phaseNN_slug.sql`), generated from live defs when
touching functions, plus a data repair/backfill when applicable → add a
regression test (soft-skip until applied; tenant-data checks WARN, never
fail) → give Rashid SQL Editor instructions → he applies, then commits.

**Any bug report** → reproduce/diagnose against live data with a throwaway
read-only probe script if needed (`scripts/_probe_*.mjs`, delete after) →
fix → **audit the whole app for the same pattern** → verify.

**Verification** (every change): `npx tsc --noEmit` + `npm run build` green;
for UI, drive it in the preview browser (dev server config in the session's
`.claude/launch.json`, port 5273 — Rashid's own dev server owns 5173).
Auth-gated pages can't be driven without credentials — verify compile + boot,
then ask Rashid to eyeball (his 5173 server hot-reloads your edits).

**Design changes** → match the existing token system (Tailwind `brand-*`
violet, `ink-*`, `surface-*`; brand mark = orange three-bar SVG in
`src/components/brand-logo.tsx`). Audit ALL modules when fixing a design
issue. Details: `references/system-map.md` §Design.

## Current state (2026-07)

Built through phase 45: full ERP + RBAC with custom roles & per-user
overrides, SaaS billing M1–M3 (PayPal; 1yr free / $21 / $105 / $200),
automotive catalog C1–C8, document drill-down, print template system,
Google OAuth sign-in, sidebar app shell, salesperson commissions.
`docs/CURRENT_PHASE.md` and `docs/Document_5_Build_Phases.md` track phases.
Known residuals and parked work: see `references/workflow.md` §Backlog.

## References

- `references/system-map.md` — how every subsystem works (posting engine,
  stock/MAC, returns, RBAC, billing, catalog, print, i18n, design system).
- `references/workflow.md` — migration generator pattern, probe scripts,
  regression-suite conventions, tenant registry, env/deploy, backlog.
