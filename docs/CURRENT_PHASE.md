# Current Phase

**Active Phase:** Phase 0 — Project Setup & Foundation

**Status:** Stages 1–6 complete; Stage 7 (git + GitHub) in progress

**Last completed:** Stage 6 — RLS multi-tenant isolation gate **PASSED** (6/6 assertions). User A cannot see User B's company; cross-tenant updates blocked; cross-tenant inserts blocked.

**Next milestone:** Stage 7 — initial commits + push to GitHub. Then Stage 8 — tick all Phase 0 DoD boxes and close phase.

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
- [x] Stage 3 — Supabase cloud project `stockbolt-v1` (ref `gzpkuaioibqrdppjdbwz`, region `me-south-1`); Supabase CLI installed via Scoop; `supabase login` + `supabase link` succeeded
- [x] Stage 4 — 18 migrations applied via `supabase db push`. Schema lives: 56 tables, gl_active + stock_active views, RLS policies on every tenant table, 3 storage buckets
- [x] Stage 5 — Data adapter layer (`src/data/`): adapter interface + Supabase implementation + self-hosted stub. Auto-generated `src/types/database.ts` (4423 lines) via `supabase gen types`
- [x] Stage 6 — RLS verification test PASSED (6/6 assertions in `tests/integration/phase0-rls.test.ts`)
- [ ] Stage 7 — git init, commits, push to GitHub
- [ ] Stage 8 — Tick all Phase 0 DoD checkboxes

**Decisions made in Phase 0:**
- Design tokens switched from dark/amber to light/indigo per approved screenshots; AGENTS.md §7.1 updated in same commit as `tailwind.config.js` to prevent drift.
- New Supabase project will be created (old project from previous build NOT reused, per AGENTS.md §0 North Star).
- AGENTS.md placed at repo root as a real file (not symlink — Windows-friendly); kept in sync with `docs/AGENTS.md` manually until v1.

(Add subsequent phases here as they begin and complete.)
