# StockBolt

**Auto-parts ERP for the GCC + India market.**

This repo is a clean rebuild after a previous failed attempt. Build discipline is enforced by [`AGENTS.md`](./AGENTS.md) and the planning documents in [`docs/`](./docs/).

## Status

Phase 0 — Project Setup & Foundation. See [`docs/CURRENT_PHASE.md`](./docs/CURRENT_PHASE.md).

## Stack

- **Frontend:** Vite + React 18 + TypeScript (strict)
- **Backend:** Supabase (PostgreSQL + Auth + Storage + RLS)
- **Styling:** Tailwind CSS with custom indigo/light tokens
- **i18n:** i18next (EN + AR, with RTL support)
- **State:** TanStack Query (server data) + Zustand (UI state only)
- **Forms:** react-hook-form

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill in Supabase URL + anon key
npm run dev                  # → http://localhost:5173
```

## Required reading before contributing

1. [`AGENTS.md`](./AGENTS.md) — the rulebook. The 5 Inviolable Rules are non-negotiable.
2. [`docs/CURRENT_PHASE.md`](./docs/CURRENT_PHASE.md) — what phase we're in.
3. [`docs/Document_5_Build_Phases.md`](./docs/Document_5_Build_Phases.md) — what's in scope for the active phase.

## Scripts

| Command            | What it does                            |
| ------------------ | --------------------------------------- |
| `npm run dev`      | Start Vite dev server                   |
| `npm run build`    | Type-check + production build           |
| `npm run preview`  | Preview the production build            |
| `npm run lint`     | ESLint                                  |
| `npm run format`   | Prettier write                          |
| `npm run typecheck`| TypeScript compile check (no emit)      |
