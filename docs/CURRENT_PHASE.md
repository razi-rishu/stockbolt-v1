# Current Phase

**Active Phase:** Phase 2 — Items, Customers & Vendors (IN PROGRESS — all stages done, running test)

**Status:** Phase 1 closed 2026-05-01. All 8 verification assertions passed (8/8). Verification gate: `npm run test:phase1`.

**Last completed:** Phase 2 implementation complete. All 9 stages done:
- App shell (sidebar + topbar via `AppLayout`)
- Adapter layer extended with all Phase 2 APIs + `listByModel`
- UI primitives: Table, Modal, Badge, Textarea
- Reference data CRUD: Categories, Brands, Warehouses, Units of Measure, Vehicle Makes/Models
- Contacts: Customers, Suppliers (shared `ContactListPage` component)
- Product master: list+search, detail with 4 tabs (details/compat/suppliers/images), image upload
- Parts Catalog browse view (Make → Model → Year → results)
- Price Levels settings page
- EN + AR i18n keys for all Phase 2 screens

**Next milestone:** Run `npm run test:phase2` — 9 assertions (W213 brake pad lifecycle). Then commit and close Phase 2.

**Notes:**
- Building from clean slate after rebuild decision
- All 6 planning docs approved before starting
- Costing method locked to MAC for v1
- LIFO permanently excluded
- Payroll deferred to v2

---

## How To Update This File

Update this file as phases advance:
1. When a Definition of Done checkbox passes, note it under "Last completed"
2. When all checkboxes for a phase pass, change "Active Phase" to the next phase
3. Update "Next milestone" to point to the next phase's verification test
4. Add session notes if there are decisions or context worth preserving

This file is read by Claude Code at the start of every session, so keep it accurate.

---

## Phase Log

### Phase 0 — Project Setup & Foundation
- Started: 2026-04-30
- Definition of Done: see Document_5_Build_Phases.md, Phase 0 section
- Verification test: RLS multi-tenant isolation test

**Stage progress:**
- [x] Stage 1 — Environment check (Node v24.13.0, npm 11.6.2, git 2.50.0)
- [x] Stage 2 — Repo scaffolding (Vite, TS, Tailwind, folder structure, design tokens locked)
- [x] Stage 3 — Supabase cloud project `stockbolt-v1` (ref `gzpkuaioibqrdppjdbwz`); Supabase CLI installed via Scoop; `supabase login` + `supabase link` succeeded
- [x] Stage 4 — 18 migrations applied via `supabase db push`. Schema lives: 56 tables, gl_active + stock_active views, RLS policies on every tenant table, 3 storage buckets
- [x] Stage 5 — Data adapter layer (`src/data/`): adapter interface + Supabase implementation + self-hosted stub. Auto-generated `src/types/database.ts` (4423 lines) via `supabase gen types`
- [x] Stage 6 — RLS verification test PASSED (6/6 assertions in `tests/integration/phase0-rls.test.ts`)
- [x] Stage 7 — git init, 6 conventional commits per AGENTS.md §11.3, pushed to GitHub
- [x] Stage 8 — All 7 Phase 0 DoD checkboxes ticked

**Phase 0 DoD — final state:**
- [x] `npm install && npm run dev` starts the app cleanly
- [x] All 56 tables exist in Supabase (Doc 2 said 48; actual count 56 due to item-table breakdown)
- [x] Two test users in two different companies can sign up (programmatically, in the RLS test)
- [x] User A cannot see User B's company_id rows — RLS test passes 6/6
- [x] `supabase gen types` produces a TypeScript types file (`src/types/database.ts`, 4423 lines)
- [x] No business logic written yet — only foundation
- [x] Repo on GitHub with clean commit history (6 commits, all `[Phase0] ...` prefixed)

**Decisions made in Phase 0:**
- Design tokens switched from dark/amber to light/indigo per approved screenshots; AGENTS.md §7.1 updated in same commit as `tailwind.config.js` to prevent drift.
- New Supabase project created (old project from previous build NOT reused, per AGENTS.md §0 North Star).
- AGENTS.md placed at repo root as a real file (not symlink — Windows-friendly); kept in sync with `docs/AGENTS.md` manually until v1.
- Cloud-only deployment for Phase 0 (Option A). Local Docker dev can be added later for offline/sample-data testing without re-doing migrations.
- ESLint `no-undef` rule disabled — TypeScript strict mode catches that class of error better and ESLint can't see ambient `.d.ts` declarations.
- `SUPABASE_SECRET_KEY` (no `VITE_` prefix) used for the RLS test; Vite refuses to bundle it into browser builds, blocking accidental client-side leakage.

### Phase 1 — Master Data & Onboarding
- Started: 2026-05-01
- Definition of Done: see Document_5_Build_Phases.md, Phase 1 section

**Stage progress:**
- [x] Stage 1 — Dependencies (zod, @hookform/resolvers), routing (React Router v6), TanStack Query provider, i18n config (i18next + RTL), Zustand auth store
- [x] Stage 2 — Auth module: Login, Register, ForgotPassword, ResetPassword, EmailVerification pages (react-hook-form + zod)
- [x] Stage 3 — COA seed service (32 accounts for UAE, 36 for India), tax rates, payment methods, units seed services; `runOnboarding` orchestrator in `src/core/`
- [x] Stage 4 — 6-step Setup Wizard (`/setup`); `complete_onboarding` SECURITY DEFINER Postgres function (Phase 1 migration) solves RLS bootstrap problem
- [x] Stage 5 — Company Settings page (`/settings/company`): edit info + logo upload to Supabase Storage
- [x] Stage 6 — Full EN + AR i18n keys; RTL layout via `document.documentElement.dir`; LanguageToggle component; logical Tailwind properties (`ms-*`/`me-*`)
- [x] Stage 7 — Phase 1 verification test (`tests/integration/phase1-verification.test.ts`); `npm run test:phase1` script added

**Phase 1 DoD — final state (all passed 2026-05-01):**
- [x] Auth flow: Login, Register, ForgotPassword, ResetPassword, EmailVerification
- [x] 6-step Setup Wizard at `/setup` (react-hook-form + zod, per-step validation)
- [x] COA seed: 32 system accounts for UAE/GCC, 36 for India (IS_SYSTEM=true)
- [x] Tax rates seed: 1 row "UAE VAT 5%" for AE, 4 GST rows for IN
- [x] Payment methods seed: Cash, Bank Transfer, Cheque, Card (4 rows)
- [x] Units of measure seed: PCS, SET, KG, LITRE, BOX (5 rows)
- [x] First warehouse with is_default=true
- [x] First bank/cash account linked to COA 1110/1100
- [x] Company Settings page (`/settings/company`): edit info + logo upload
- [x] EN + AR i18n (i18next, RTL, LanguageToggle)
- [x] Verification test: 8/8 assertions passed (`npm run test:phase1`)

**Decisions made in Phase 1:**
- RLS bootstrap solved via SECURITY DEFINER `complete_onboarding()` Postgres function (migrations 20260501000000 + 20260501000001 fix). Profile creation happens atomically with company creation.
- COA account count: Doc 5 says "30" but actual count for UAE is 32 (Doc 3 Part A list, minus 6 India GST accounts, minus 6100 Salaries which is v2-only).
- `bank_accounts.account_type` uses `'bank'/'cash'` (not `'current'/'petty_cash'`) — schema CHECK constraint is the source of truth.
- `payment_methods.type` uses `'bank'` (not `'bank_transfer'`) — schema CHECK constraint is the source of truth.
- `complete_onboarding` RPC now fully typed after `supabase gen types` re-run; `any` cast removed.

### Phase 2 — Items, Customers & Vendors
- Started: 2026-05-01
- Definition of Done: see Document_5_Build_Phases.md, Phase 2 section

**Stage progress:**
- [x] Stage 1 — App shell: `AppLayout` sidebar + topbar; `App.tsx` wrapped all onboarded routes; `dashboard/index.tsx` simplified (no own header)
- [x] Stage 2 — Adapter layer extended: `CategoriesAPI`, `BrandsAPI`, `WarehousesManagementAPI`, `UnitsManagementAPI`, `VehicleMakesAPI`, `ProductsAPI` (incl. `listByModel`), `ContactsAPI`, `PriceLevelsAPI`; supabaseAdapter + selfHostedAdapter updated
- [x] Stage 3 — New UI primitives: `Table<T>`, `Modal`, `Badge`, `Textarea`
- [x] Stage 4 — Reference data CRUD: Categories (`/products/categories`), Brands (`/products/brands`), Warehouses (`/settings/warehouses`), Units (`/settings/units`), Vehicle Makes/Models (`/products/vehicles`)
- [x] Stage 5 — Contacts: Customers + Suppliers via shared `ContactListPage` parameterised by type
- [x] Stage 6 — Product master: list with dual-mode search, detail page with 4 tabs (Details, Compatibility, Supplier Codes, Images)
- [x] Stage 7 — Parts Catalog browse (`/catalog`): Make → Model → Year filter → product cards grid
- [x] Stage 8 — Price Levels settings page (`/settings/price-levels`)
- [x] Stage 9 — EN + AR i18n for all Phase 2 screens (nav, products, contacts, catalog, settings.warehouses/units/price_levels, parts_catalog)
