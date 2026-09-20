### The regression suite — conventions and worked examples

Read before adding a test. The goal is to write checks that fit the existing
suite's shape, stay green for other people until a migration is applied, and go
red with a *useful* message when a fix is actually lost.

## Where things live

- **The suite:** `tests/integration/regressions.test.ts` — one Vitest file, run
  live against the DB. `npm run test:regressions`. ~35s, ~91 checks.
- **Unit tests:** `tests/unit/*.test.ts` — pure functions, no DB.
- **The hook:** husky pre-commit runs the regression suite. A commit is blocked
  if it fails. `--no-verify` bypasses it — reserved for genuine offline
  emergencies, never to escape a red posting test.
- **Connection:** `.env.local` supplies `VITE_SUPABASE_URL` +
  `SUPABASE_SECRET_KEY`; the suite connects as the service role.

## The `sql<T>()` helper

Every check runs SQL through one helper that returns typed rows:

```ts
const rows = await sql<{ proname: string }>(
  `SELECT proname FROM pg_proc WHERE proname = 'confirm_invoice'`);
```

Internally it calls `admin.rpc('_regression_test_query', { p_sql })`. That RPC
executes arbitrary SQL as a definer and is the SEC-1 security finding (see
`security-guardian`) — it exists for the tests and should not exist in
production, and no *product* code should ever depend on it. When the separate
test database is created (security-guardian SEC-6), this helper lives there.

## Pattern 1 — structural lock (the suite's bread and butter)

Prove a fix is still present by asserting a distinctive marker in the object's
definition. This is what the suite is genuinely good at.

```ts
it('phase46: round-off posts to 5900 in confirm_invoice', async () => {
  const fns = await sql<{ src: string }>(
    `SELECT pg_get_functiondef(oid) AS src FROM pg_proc WHERE proname='confirm_invoice'`);
  if (fns.length === 0) {                       // soft-skip if not present
    console.warn('⚠ confirm_invoice missing — check phase46 applied');
    return;
  }
  const src = fns[0].src;
  expect(src).toMatch(/ensure_round_off_account|5900/);   // marker, not exact SQL
});
```

Assert the *marker* (the account is referenced), never the exact statement — a
legitimate refactor should pass; a real loss of the round-off leg should fail.
Name the test after the phase and the guarantee so a failure reads as
"phase46: round-off leg missing", not "assertion failed".

Good markers: a function name called inside the body, an account code, a policy
`cmd`, a column's presence, a trigger being attached, a `WHERE` clause that
encodes a rule (`reversal_of_id IS NULL`).

## Pattern 2 — soft-skip until a migration is applied

Because migrations are applied by hand and the DB is shared, a test for an
unapplied migration must **warn and pass**, not fail — otherwise it turns
everyone else's commits red for something they didn't touch.

```ts
it('phase50: api_current_stock exists and is service-role-only', async () => {
  const fn = await sql(`SELECT proname FROM pg_proc WHERE proname='api_current_stock'`);
  if (fn.length === 0) {
    console.warn('⚠ phase50 not applied — run supabase/migrations/....sql');
    return;                                     // green until applied
  }
  const grants = await sql<{ grantee: string }>(
    `SELECT grantee FROM information_schema.routine_privileges
      WHERE routine_name='api_current_stock' AND privilege_type='EXECUTE'`);
  const g = grants.map(r => r.grantee);
  expect(g).not.toContain('anon');
  expect(g).not.toContain('authenticated');
  expect(g).toContain('service_role');
});
```

## Pattern 3 — tenant-data check that warns, never fails

When a check reads live customer rows, a data quirk in one tenant must not block
an unrelated commit. Observe and warn; keep the build green.

```ts
it('E1: stock valuation vs Inventory 1300 (warn-only)', async () => {
  const drift = await sql<{ name: string; diff: number }>(`... per-company drift ...`);
  if (drift.length) console.warn('⚠ E1 drift:', JSON.stringify(drift));
  expect(true).toBe(true);   // reported, not blocking
});
```

Reserve hard failures for invariants that must hold for **every** tenant and
that a code change controls — object existence, policy shape, a balanced-by-
construction guarantee. A customer typing odd data is not a build failure.

## Pattern 4 — behavioural accounting test (the gap to close)

The suite's blind spot is numeric correctness. This pattern actually posts and
checks the resulting numbers — the class of bug structural tests miss. It does
not exist in the suite yet; this is the shape to add when you want real
confidence in a posting or costing change.

Sketch (adapt to the real posting RPC signatures and a disposable company):

```ts
it('behavioural: invoice posts a balanced JE and reverses to zero', async () => {
  // 1. Arrange a scratch company + product + customer (or use a known test tenant).
  // 2. Post: call the confirm RPC for a small invoice.
  // 3. Assert the GL rows: AR debit, revenue credit, VAT credit, COGS + inventory
  //    — exact expected amounts, computed independently from the inputs.
  const je = await sql<{ dr: number; cr: number }>(
    `SELECT ROUND(SUM(debit),2) dr, ROUND(SUM(credit),2) cr
       FROM general_ledger WHERE related_doc_id = :invoiceId`);
  expect(je[0].dr).toBe(je[0].cr);              // balanced
  expect(je[0].dr).toBe(EXPECTED_TOTAL);        // and the RIGHT number
  // 4. Reverse/void, then assert the net movement for that document is zero.
});
```

Two cautions if you build these: they mutate data, so use a disposable company
and clean up (or a transaction that rolls back); and never run them against the
tenants that hold real customer books. This is exactly why the separate test
database (SEC-6) matters — behavioural tests want a database they can write to
freely.

The identity queries to assert against live in `accounting-engine`
(`references/verification-queries.md`) and `inventory-engine`
(`references/verification.md`): every JE balances, trial balance nets to zero,
Inventory ties to 1300, MAC continuity.

## Checklist for a new test

- Uses `sql<T>()`, not a new DB client.
- Soft-skips (warn + return) if it depends on an unapplied migration.
- Hard-fails only on a change-controlled invariant true for every tenant;
  warns on tenant-data observations.
- Asserts a marker/identity, not an exact SQL string, so refactors survive.
- Named `phaseNN: <the guarantee>` so a red result explains itself.
- Runs in the shared suite in seconds — no heavy fixtures, no external calls.

## Reading a red suite

A failure means one of two things: the **change** broke an invariant, or the
**test** is stale (the invariant legitimately moved). Decide which before
touching either. If the change is wrong, fix the change. If the test is stale,
update the test *and* say so in your report — a quietly weakened test is how a
real regression slips through next time. Never silence a red test by deleting
its assertion or bypassing the hook.
