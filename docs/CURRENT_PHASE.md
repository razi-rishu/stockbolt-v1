# Current Phase

**Active Phase:** Phase 1 — Master Data & Onboarding (NOT YET STARTED)

**Status:** Phase 0 closed 2026-05-01. All 7 DoD checkboxes passed. Verification gate (RLS multi-tenant isolation) passed 6/6.

**Last completed:** Phase 0 in full. Repo live at https://github.com/razi-rishu/stockbolt-v1 with 5 conventional commits + Phase 0 close commit.

**Next milestone:** Phase 1 kickoff — auth signup, multi-step setup wizard (Doc 1), seed COA + tax rates + payment methods + units, first warehouse, first bank/cash account. See Doc 5 §"PHASE 1" for the full task list and DoD.

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
- Started: not yet
- Definition of Done: see Document_5_Build_Phases.md, Phase 1 section

(Add subsequent phases here as they begin and complete.)
