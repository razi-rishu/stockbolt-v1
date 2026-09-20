---
name: project-architecture
description: StockBolt's real system architecture — a thin React client over a smart Postgres database, where business logic lives in database RPCs and triggers (not a JS service layer), data access goes through the adapter, and the GL is the single source of truth. Use this skill when deciding where new code belongs, structuring a feature across layers, adding a folder or module, reasoning about dependency direction, or judging whether a change respects the architecture. Use it before creating any new file, because the most common architectural mistake here is putting logic in the wrong layer — especially business logic in the app instead of the database.
---

# Project architecture — thin app, smart database

This skill owns the **shape of the system**: the layers, where new code belongs,
and the dependency direction. For the *style* of code within a file (naming,
tokens, i18n, the adapter method shape) use `coding-standards`; for *what* the
business logic must do, use `business-rules` / `accounting-engine` /
`inventory-engine`. This skill is the map; those are the terrain.

## The one architectural idea that everything follows from

**StockBolt is a thin client over a smart database.** The important ERP logic —
posting, the general ledger, moving-average costing, tax, the invariants that
keep the books correct — lives in **PostgreSQL: RPC functions, triggers, and
RLS**, not in the JavaScript app. The React app renders, collects input, and
*calls* those database functions; it does not contain the accounting engine.

This is a deliberate choice, and understanding *why* is what keeps you from
breaking it: putting posting logic in the database means it **cannot be
bypassed** — not by the app, not by the public API, not by a hand-run query,
not by a future integration. There is exactly one place the GL can be written
correctly, and RLS guarantees every path goes through it. A parallel copy of
that logic in a JS "service layer" would be a *second* place for the rules to
live, and the two would drift — which is the precise failure this architecture
exists to prevent.

So the instinct from generic web-app architecture — "business logic goes in a
service layer between the UI and the database" — is **inverted here**. The
business logic is *in* the database. The app layer is intentionally thin.

## The real layers

```
┌─ Presentation ─────────────────────────────────────────────┐
│  src/modules/<domain>/*.tsx   feature screens               │
│  src/components/              app shell, shared components   │
│  src/ui/                      shared primitives (Button…)   │
└─────────────────────────────────────────────────────────────┘
        │ renders / dispatches
┌─ UI state & fetching ──────────────────────────────────────┐
│  src/hooks/                  TanStack Query hooks, useState │
└─────────────────────────────────────────────────────────────┘
        │ getAdapter().<domain>.<method>()
┌─ Data access (the adapter) ────────────────────────────────┐
│  src/data/adapter.ts         the interface (contract)       │
│  src/data/supabaseAdapter.ts the implementation             │
│  src/data/selfHostedAdapter.ts the alt implementation       │
│  src/data/supabase-client.ts the client                     │
└─────────────────────────────────────────────────────────────┘
        │ .from(...) / .rpc(...)
┌─ Business logic + persistence (the smart DB) ──────────────┐
│  Supabase Postgres: tables, RLS, TRIGGERS, and the         │
│  posting/accounting/inventory RPCs — THIS is where ERP     │
│  logic lives. Migrations in supabase/migrations/.          │
│  Public API: supabase/functions/api (Edge Function).       │
└─────────────────────────────────────────────────────────────┘
```

There is **no `src/services/` layer**, and there should not be one — the
"service" is the database. There is also no `src/pages/`, `src/routes/`, or
`src/database/` folder (the draft that inspired this skill listed those; they
don't exist). Routing lives in `src/App.tsx`; the DB lives in `supabase/`.

Supporting folders: `src/lib/` (pure utilities, env, config), `src/i18n/`
(translations), `src/types/` (generated DB types + shared types).

## Where new code goes — the decision

Ask "what *kind* of thing is this?" and place it by the answer:

- **A screen or a piece of one** → `src/modules/<domain>/` beside its peers, or
  `src/ui` / `src/components` if it's genuinely shared. Presentation only.
- **Fetching or coordinating UI state** → a hook in `src/hooks/` (or co-located),
  using TanStack Query + `getAdapter()`. No business rules here.
- **A new data operation** → a method on the adapter (`adapter.ts` interface +
  `supabaseAdapter.ts` impl). This is the *only* place app code touches Supabase.
- **Business logic — posting, GL, stock, tax, any rule that protects the books**
  → a **database RPC / trigger**, shipped as a migration (`migration-guardian`).
  Not a JS function. If you're about to write accounting math in TypeScript,
  stop: it belongs in the database.
- **A pure helper** (date math, formatting, a converter) → `src/lib/`.
- **A reusable UI primitive** → `src/ui/`.

## Dependency direction

Dependencies point **downward only**. Each layer knows about the one below it,
never the one above.

**Allowed:** module → hook → adapter → Supabase → DB.

**Forbidden — and why each matters:**
- **Component/page calling Supabase directly.** Breaks the swappable data layer
  and scatters queries; always go through the adapter. (Enforced by convention —
  `coding-standards`.)
- **Business logic in a component, hook, or page.** Posting/accounting/inventory
  math in the app is a second source of truth that will drift from the DB. It
  belongs in an RPC.
- **The adapter reaching up into UI** (importing a component, showing a toast).
  The adapter returns data and throws errors; the UI decides how to present them.
- **Circular imports**, especially through barrels.

## Reports are read-only

Every report derives from the GL and writes nothing. A report path that inserts
or updates is an architectural violation, not just a bug — reporting reads the
single source of truth, it never becomes a second one. (The known wrinkle:
reports currently aggregate *client-side* over unbounded fetches, which is the
E-1 truncation issue — `performance-guardian` / `database-guardian`. Moving that
aggregation into SQL aligns reporting with the "logic in the DB" architecture
and fixes the correctness bug at once.)

## No cached aggregates

A direct corollary of "GL is the single source of truth": balances are derived
on read, never stored in a cache column. The moment a cached total exists it can
disagree with the ledger and nobody can tell which is right. Don't introduce
one for convenience or speed (`accounting-engine`, `performance-guardian`).

## The two runtimes

Most of the app runs in the browser as `authenticated`, protected by RLS. The
**public API Edge Function** (`supabase/functions/api`) runs as `service_role`
and **bypasses RLS** — so it carries tenant isolation itself, and it is the one
place server-side JS logic legitimately lives, precisely because it sits outside
the browser trust boundary (`api-guardian`, `security-guardian`). It still does
not reimplement posting: it creates *drafts* and lets the DB engine post.

## When to stop and ask

- You're about to write accounting/inventory/tax math in TypeScript — it belongs
  in a database RPC; confirm the design (`migration-guardian`).
- A change would have a component or hook call Supabase directly, or reach around
  the adapter.
- You're tempted to create a `services/` layer, a cached-balance column, or a
  second place a rule lives — that's the drift the architecture prevents.
- A report path would write data.

## Reporting architectural work

```
Layers touched     — presentation / hooks / adapter / database
Where logic landed — and confirm business logic went to the DB, not the app
New files          — path + which layer, why there
Dependency check   — direction is downward-only; no UI reached from below
Reuse              — adapter method / hook / primitive reused vs. added
Confidence         — high / medium / low
```

## References

- **`references/layer-guide.md`** — a worked example tracing one feature
  (add a document type) through every layer, plus the "which folder" lookup and
  the anti-patterns with the reason each is forbidden. Read when placing new
  code or unsure which layer owns something.
