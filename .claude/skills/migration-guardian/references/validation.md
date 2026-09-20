### Migration validation — before and after

Read at verification time. A migration is not done when it runs without an
error; it is done when you have **proven the intended end state exists** and
nothing downstream broke. A SQL script can abort partway and roll back while
still looking like it "ran" — this has happened in production — so verify the
result directly, never the absence of a red message.

Scale the depth to the risk tier. A new index needs step 1. A posting-RPC change
needs all of them.

## Before applying (all tiers)

- **Is it additive?** No drop/rename/type-change/PK-change. If not, stop.
- **Is it idempotent?** Every object uses its safe form (playbook table); a
  re-run is a no-op.
- **For a data repair: how many rows?** Count with a read-only probe before
  applying. State the number.
- **Does it assume an empty table?** It must not — `NOT NULL` without default,
  ungarded backfill, and unique index on dirty data all fail on a populated
  table.
- **Grants stated on any new function?** Revoked from PUBLIC/anon, granted
  narrowly.

## After applying — verify the end state exists

Run these through the regression helper RPC as read-only probes. Each states the
healthy result.

**Schema present:**
```sql
-- column added?
SELECT 1 FROM information_schema.columns
WHERE table_name='my_table' AND column_name='my_col';        -- expect 1 row
-- index present?
SELECT indexname FROM pg_indexes WHERE tablename='my_table';
```

**Function actually replaced** (not just "no error"):
```sql
SELECT pg_get_functiondef(oid) LIKE '%<distinctive marker>%' AS ok
FROM pg_proc WHERE proname='my_fn';                          -- expect ok = true
```

**Policies present and correctly shaped:**
```sql
SELECT policyname, cmd, permissive FROM pg_policies WHERE tablename='my_table';
```

**Grants correct** (nothing internal leaked to anon/authenticated):
```sql
SELECT grantee, privilege_type FROM information_schema.routine_privileges
WHERE routine_name='my_fn';
```

**RLS enabled on any new table:**
```sql
SELECT relname, relrowsecurity FROM pg_class WHERE relname='my_table';  -- expect true
```

## After applying — HIGH / CRITICAL, verify nothing downstream broke

A schema change can silently break objects that depend on the changed thing.
Check the dependents, not just the target.

- **Dependent RPCs:** a column or type change can break a function that reads it.
  Re-read the definitions of RPCs that touch the changed table and confirm they
  still reference valid columns. For a posting-RPC change, this is the point of
  the whole migration — verify it numerically, below.
- **Views and triggers:** a view over a changed column, or a trigger on a changed
  table, can be left stale. Confirm they still resolve.
- **RLS still isolates:** after any policy change, re-confirm a query scoped to
  one company cannot see another's rows, and that `anon` gained nothing
  (`security-guardian` has the probes).
- **Tenant isolation intact:** no new table or grant exposed data across
  companies.

## After applying — CRITICAL, verify the numbers

Structural checks prove the object exists; they do **not** prove it computes the
right amount (see `test-engine`). For any change to posting, costing, or the GL:

- **Every JE still balances; trial balance still nets to zero** per company
  (`accounting-engine` verification queries).
- **Existing confirmed documents reproduce identically.** Capture a sample's GL
  before, re-derive after, diff. Any movement in a historical document means the
  change was retroactive — stop; that is a change to books a customer may have
  filed.
- **Stock valuation still ties to Inventory 1300** (`inventory-engine` E1 check).
- **A behavioural spot-check:** post a small document on a scratch tenant, assert
  the exact GL, reverse it, assert net zero.

## After applying — reports and app still work

For a change that could move a reported number, sanity-check the surfaces a
customer actually reads: Trial Balance and Balance Sheet still balance, P&L ties
to GL movement, the relevant statement/aging reconciles. Confirm the app still
boots and the affected screen renders (compile + a driven check, or ask Rashid
to eyeball on his dev server).

## Then lock it

Add a soft-skipping regression test that asserts the change is present, so a
future revert or an old-migration re-run turns the suite red with a clear
message (`test-engine` has the patterns). The suite is the tripwire that would
have caught the posting drift; every CRITICAL migration should leave one behind.

## If verification fails

Do not assume the migration "mostly" applied. A rolled-back script leaves
*nothing* changed, including the parts that mattered. Re-read what actually
exists in the database, find where the script aborted (the `CREATE POLICY`
trap is the usual culprit), fix the file to be idempotent, and re-apply. Never
paper over a failed apply by editing data directly to match what the migration
was supposed to produce.
