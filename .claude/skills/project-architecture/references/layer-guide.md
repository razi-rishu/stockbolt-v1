### Layer guide — placing code correctly

Read when adding a file or unsure which layer owns something. The recurring
mistake this prevents is putting business logic in the app when it belongs in
the database.

## "Which folder?" lookup

| What you're adding | Where it goes |
|---|---|
| A feature screen | `src/modules/<domain>/*.tsx` |
| A shared UI primitive (Button, Input, Modal) | `src/ui/` |
| App shell / cross-feature component | `src/components/` |
| A data-fetching or UI-coordination hook | `src/hooks/` (or co-located) |
| A new read/write against the DB | a method on `src/data/adapter.ts` + `supabaseAdapter.ts` |
| **Posting / accounting / inventory / tax logic** | **a DB RPC or trigger** (migration) |
| A pure helper (dates, formatting, conversion) | `src/lib/` |
| Translations | `src/i18n/en.json` + `ar.json` |
| Shared / generated types | `src/types/` |
| A migration | `supabase/migrations/` |
| Public API endpoint code | `supabase/functions/api/` |

Not folders here (don't create them): `src/services/`, `src/pages/`,
`src/routes/`, `src/database/`.

## Worked example — adding a new document type end to end

Say you're adding "Delivery Notes." Trace the layers so each piece lands right.

**1. Database (the business logic) — first, and the heart of it.**
The rules of a delivery note — what it does to stock, whether it posts to the
GL, how it reverses — are a **database** concern. Write a migration
(`migration-guardian`) with:
- the tables (`delivery_notes`, `delivery_note_items`) with `company_id`, RLS,
  a `status` check (`draft`/`confirmed`/`void`);
- the posting RPCs (`confirm_delivery_note`, `void_delivery_note`) that write the
  stock ledger and any GL rows, going through the same engine patterns as the
  siblings (`accounting-engine`, `inventory-engine`);
- grants revoked from PUBLIC/anon, granted to `authenticated`.
This is where the *intelligence* lives. Do not put any of this math in the app.

**2. Adapter (data access).**
Add `deliveryNotes` to the `adapter.ts` interface and implement it in
`supabaseAdapter.ts`: `list`, `getById`, `getItems`, `create` (draft insert),
and thin wrappers that call the confirm/void RPCs. Every query company-scoped and
bounded. The adapter *calls* the RPCs; it doesn't reimplement them.

**3. Hooks (UI state & fetching).**
A `useDeliveryNotes` hook (or inline `useQuery`) keyed by company, plus mutations
that call `getAdapter().deliveryNotes.confirm(...)` and invalidate the right
keys. No business rules — just fetching and cache coordination.

**4. Presentation.**
`src/modules/<domain>/delivery-notes.tsx` (list) and an editor, matching the
sibling screens' style (`coding-standards`): loading/empty/error states, tokens,
i18n keys in both `en.json` and `ar.json`, the shared `BackButton`/primitives.
Render and dispatch only.

**5. Routing & nav.**
Register the route in `src/App.tsx` (behind the right permission guard) and add
the nav entry. Routing lives in `App.tsx`, not a `routes/` folder.

The shape to notice: **the further down you go, the more the intelligence is;
the app layers get progressively thinner.** The screen is dumb; the database is
smart.

## Anti-patterns, with the reason each is forbidden

- **SQL or `supabase` client calls inside a component.** Scatters data access,
  breaks the swappable adapter, and hides queries from the one place they should
  be. → adapter method.
- **Accounting/inventory math in TypeScript.** Creates a second source of truth
  that drifts from the DB engine — the exact failure the architecture prevents.
  → DB RPC.
- **A cached balance/total column or in-memory cache of financial data.** Can
  disagree with the GL with no way to tell which is right. → derive on read
  (`accounting-engine`).
- **The adapter importing UI** (showing a toast, importing a component). Inverts
  the dependency direction; the adapter returns data/throws, the UI presents.
- **A report that writes.** Reporting reads the single source of truth; it must
  never become one.
- **A new `services/` layer** to "hold business logic." That logic belongs in
  the database; a JS service layer would duplicate it.
- **Circular imports through a barrel.** A new file pulling from an index that
  pulls back. Import the specific module.

## The test for "is this the right layer?"

Two questions settle almost every placement:

1. **Does it protect the correctness of the books?** (posting, GL, stock, tax,
   an invariant) → it belongs in the **database**, full stop.
2. **If not, what's the smallest layer that can own it?** A pure helper → `lib`.
   Data access → adapter. Fetching/UI state → hook. Rendering → component. Push
   it as far down (toward pure/reusable) or as close to presentation as its
   actual responsibility, and no further.

When those two don't decide it, read two or three sibling files and match where
they put the equivalent thing — the codebase is the final authority
(`coding-standards`).
