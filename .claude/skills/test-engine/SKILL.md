---
name: test-engine
description: How testing and regression-proofing actually work in StockBolt ERP — what the live regression suite really checks (and the large class of bugs it cannot catch), how to add a test that locks a fix so it can't silently regress, and how to verify the things no automated test covers (numeric accounting correctness, UI, performance). Use this skill whenever you are writing or running tests, adding a regression test after a fix, deciding whether a change is adequately verified, interpreting a green or red suite, or a user asks "is this tested?" / "did I break anything?" / "how do I prove this is safe?". Especially important before concluding a change is safe, because the suite passing is routinely mistaken for correctness here when it does not prove it.
---

# Test engine — regression-proofing StockBolt

For risk tiers and the per-change verification checklist, use `erp-guardian`
(`references/regression-gate.md`). For the numeric SQL checks that prove
accounting and inventory identities, use `accounting-engine` and
`inventory-engine`. This skill owns the thing those defer to: **how the test
suite actually works, what it does and does not prove, and how to add a test
that genuinely locks a fix.**

## The one truth to internalise

**A green suite is not a correct ERP.** The draft that inspired this skill said
it well: passing TypeScript ≠ correct accounting; passing build ≠ correct
business logic. But the deeper, project-specific version is sharper —

> The regression suite is almost entirely **structural**. It asserts that
> functions, policies, triggers and columns *exist* and have the right shape.
> It rarely posts a transaction and checks that the resulting **numbers** are
> right.

So the suite reliably catches "someone deleted the round-off leg from the
function definition" and reliably *misses* "the function now computes the
round-off as 3.00 instead of 0.03". Both are regressions; only the first fails
the suite. This is not a flaw to fix in a sentence — it is the shape of the
tooling, and knowing it changes how you verify. When a change touches numbers,
**the suite passing tells you almost nothing about correctness; you must check
the numbers yourself.**

## What actually exists (don't imagine a test pyramid)

| Layer | Reality |
|---|---|
| **The enforced gate** | `tests/integration/regressions.test.ts` — one Vitest file, ~91 checks, run live against the database via `.env.local`, ~35s. Wired into the husky **pre-commit** hook. |
| **Unit tests** | A handful of pure-function tests (`tests/unit/`: exchange-rate, locale, print-presets, region-labels). Fast, deterministic, no DB. |
| **Orphaned suites** | `tests/integration/phase0…phase11-verification.test.ts` exist but are **not run** by the hook. Treat them as historical records, not coverage — a test that never runs is documentation that may be lying. |
| **CI** | None. The only gate is the local pre-commit hook, bypassable with `--no-verify`. |
| **Performance / E2E / load** | None. |
| **Where tests run** | Against the **production** database (`.env.local` → the live project). This is a known risk, not a design goal. |

If a task assumes a CI pipeline, an e2e harness, a staging test DB, or a
performance suite, say so — none exist. Don't write instructions that lean on
machinery that isn't there.

## How the suite is built (so you can extend it correctly)

Every check runs SQL through a helper:

```ts
const rows = await sql<{ proname: string }>(`SELECT ... FROM pg_proc ...`);
```

`sql<T>()` calls `admin.rpc('_regression_test_query', { p_sql })` as the service
role. (That helper is also the SEC-1 security finding — see `security-guardian`.
The tests need it; production does not. Keep that tension in mind, and never add
a *feature* that depends on it.)

Two conventions make the suite safe to run against a shared, migration-by-hand
database. Follow both when adding a test:

**Soft-skip until applied.** A test for an unapplied migration must not fail —
it warns and returns, so the suite stays green for everyone else until the
migration lands:
```ts
const fn = await sql(`SELECT proname FROM pg_proc WHERE proname = 'my_fn'`);
if (fn.length === 0) {
  console.warn('⚠ phaseNN not applied yet — run supabase/migrations/....sql');
  return;
}
// real assertions below
```

**Tenant-data checks warn, never fail.** A single customer's data quirk must
never block an unrelated commit. When a check inspects live tenant rows (e.g.
E1 stock-vs-GL drift), log a warning and pass, rather than failing the build:
```ts
if (drift.length) console.warn('⚠ E1 drift on', drift.length, 'company(ies)');
expect(true).toBe(true);   // observed, not blocking
```
Reserve hard `expect(...)` failures for **structural invariants that must hold
for every tenant** — a function's existence, a policy's shape, a trigger being
attached.

## How to lock a fix so it can't silently come back

The highest-value moment for a test is right after a fix. The goal is a
tripwire: if someone later reverts or overwrites the fix, the suite goes red
with a clear message.

1. **Find the marker that proves the fix is present.** Usually a distinctive
   string in the function body, a policy verb, a column, or a trigger.
   ```ts
   const src = await sql<{ ok: boolean }>(
     `SELECT pg_get_functiondef(oid) LIKE '%ensure_round_off_account%' AS ok
      FROM pg_proc WHERE proname = 'confirm_invoice'`);
   expect(src[0]?.ok).toBe(true);
   ```
2. **Assert the marker, not the mechanism.** Test that the round-off account is
   referenced, not the exact SQL that references it — so a legitimate refactor
   doesn't trip the wire while a genuine loss of behaviour does.
3. **Soft-skip if it depends on an unapplied migration.**
4. **Name it after the phase and the guarantee**, so a red result reads as
   "phase46: round-off leg missing from confirm_invoice", not "assertion failed".

This structural-marker approach is what the suite is good at, and it is the
right tool for "this function must keep doing X".

## The gap worth closing: behavioural accounting tests

The suite's blind spot is numeric correctness. The single most valuable test to
*add* to this project is a **behavioural** one that the structural suite can't
express: seed a scratch company, post a document, assert the exact GL rows,
reverse it, assert the ledger nets to zero. That catches the "3.00 vs 0.03"
class the marker tests miss.

If a task involves a costing or posting change and you want real confidence,
this is the shape to reach for — and `accounting-engine` /
`inventory-engine` hold the identity queries (trial balance nets to zero,
Inventory ties to 1300, MAC continuity) to assert against. Until such tests
exist, that verification has to be done by hand, deliberately, per change.

## Matching verification to the change

Don't run the whole battery on a label edit; don't wave a posting change through
on a green structural suite. Scale it (full tiering lives in `erp-guardian`):

- **Copy / CSS / icons** — `tsc` + build. Done.
- **Forms / filters / lists** — the above, plus drive it in the browser: empty
  state, error state, a bad input rejected, the query stays bounded.
- **Reports / API / permissions** — the above, plus the regression suite, plus
  verify the actual numbers against a known-good source, plus a cross-tenant
  check (does a scoped query refuse another company's row).
- **Posting / migrations / costing / RLS** — all of the above, plus generate the
  fix from the *live* definition, add a locking test, and **verify numerically**:
  post → assert GL → reverse → assert net zero on a scratch tenant.

## Edge cases that actually bite here

Not a generic list — these are the ones with a history in this codebase:

- **Concurrency:** two confirms of one document (double-post race), a retried
  API order (idempotency). Structural tests won't catch these; reason about the
  locking, and prefer a unique index over a read-check.
- **Negative and zero:** negative stock is a *valid* state with backorders on;
  reports must not clamp it to zero. Zero-quantity or zero-cost lines.
- **Large data:** the report truncation cliff — a tenant past the API row cap.
  A test that seeds >1000 GL rows and asserts the Balance Sheet still balances
  would catch it; none exists yet.
- **Empty:** a company with no documents, a product with no movement, a first
  invoice. Empty states are where UIs and aggregates most often throw.
- **Tax-inclusive vs exclusive**, **sell-before-buy**, **round-off** — the
  posting paths with the most scar tissue; changes near them deserve the
  numeric check.

## When to stop and ask

- A change touches posting/costing and you cannot verify the numbers (no scratch
  tenant, no known-good baseline) — say so rather than reporting a green
  structural suite as if it were proof.
- The suite is red for a reason you don't understand — diagnose whether the
  *change* is wrong or the *test* is stale before touching either. Never reach
  for `--no-verify` to get past red; the hook is the last line of defence
  between a posting bug and a customer's books.
- A task asks to "add tests" for behaviour the current tooling can't express
  (real numeric posting tests) — that is worth doing, and worth flagging as
  net-new rather than assuming a harness exists.

## Reporting test/verification work

```
Change + risk tier   — what changed, and the highest tier it touches
Verified             — what you actually ran, and the real output (not "looks fine")
Not verified         — what you could not check, and why (be explicit — this is the honest core)
Regression lock      — the test you added, or why none was needed
Numeric check        — for posting/costing: the before/after numbers, or "N/A — no financial surface"
Remaining risk       — what could still be wrong, ranked
Confidence           — high/medium/low, and what would raise it
```

The "Not verified" line is the most valuable thing in the report. A confident
summary that hides an unchecked path is the same failure as a green structural
suite mistaken for correctness — it just moves the false assurance from the
tooling into the prose. Name what you didn't check.

## References

- **`references/regression-suite.md`** — the suite's exact conventions, the
  `sql<T>()` helper, worked examples of a structural lock and a soft-skip, and
  the anatomy of a behavioural accounting test. Read before adding a test.
