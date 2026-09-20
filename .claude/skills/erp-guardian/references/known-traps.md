# Known traps

Every entry here has already caused a real defect in StockBolt. They are
recorded because each one is invisible in review — the code looks fine, the
tests pass, and the damage is silent.

Read before touching posting RPCs, migrations, reports, or currency.

---

## 1. A balanced journal entry can still be wrong

**Incident:** Four document editors (invoice, quote, vendor bill, PO) exposed a
dropdown offering every world currency. The posting engine — by explicit design
recorded in `docs/MULTICURRENCY_AUDIT.md` §2 — records `exchange_rate` on the
JE header but **never multiplies by it**. A 1,000 USD invoice therefore posts
to the ledger as 1,000 AED instead of ~3,673.

**Why it was invisible:** the entry balances (1000 = 1000). `je_must_balance`
passes. The regression suite passes. No error, no warning. AR, VAT, P&L and
Balance Sheet are all quietly wrong.

**The lesson:** balance is a necessary condition, never a sufficient one. When
changing anything that feeds posting inputs, ask what the *magnitude* should be
and how a wrong magnitude would surface.

**Standing rule:** a half-built financial feature reachable by users is a
defect, not a limitation. Either finish it to its acceptance gates or remove it
from the UI. Multi-currency has no acceptable middle state.

---

## 2. Client-side aggregation inherits the API row cap

**Incident:** `getBalanceSheet` (and the other statement reports) fetch every
GL row for a company with no `.limit()` or `.range()` and aggregate in
JavaScript. PostgREST caps responses at `max_rows` (1000 by default). Past that
threshold the report silently computes over a truncated subset.

**Why it was invisible:** correct today only because every tenant is far below
the cap. A confirmed invoice writes 4–6 GL rows, so the cap arrives at roughly
170–250 invoices — months, not years, for an active customer. No error is
raised at truncation.

**The lesson:** any unbounded `.select()` on a table that grows with usage is a
latent correctness bug, not merely a performance issue. Aggregate in SQL, or —
at minimum — detect the ceiling and fail loudly.

**When adding a report:** return grouped totals from an RPC. A Balance Sheet
should return ~30 rows regardless of ledger size.

---

## 3. A read-check is not a constraint (TOCTOU)

**Incident:** `_guard_no_double_post()` is a `BEFORE INSERT` trigger that
`SELECT`s to detect an existing canonical JE for the same source document. No
posting RPC takes a row lock (`FOR UPDATE`) on the document being confirmed.

**Why it was invisible:** under `READ COMMITTED`, two concurrent transactions
cannot see each other's uncommitted insert. Both pass the guard, both commit —
duplicated revenue, VAT, COGS and stock. Triggered by a double-clicked Confirm,
a client retry after timeout, or two users on one document.

**The lesson:** enforce uniqueness with a unique index, not a query. Use the
trigger for the friendly message, the constraint for the guarantee.

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  journal_entries_one_canonical_per_source
ON public.journal_entries (company_id, source_type, source_id)
WHERE reversal_of_id IS NULL AND reversed_by_id IS NULL;
```

Check for pre-existing duplicates before building the index — it will fail if
any exist, and that failure is itself a valuable integrity audit.

---

## 4. `CREATE POLICY` has no `IF NOT EXISTS` — and a failed script rolls back everything

**Incident:** Re-applying the phase-47 migration aborted at
`policy "vblc_read" already exists`. Postgres rolled back the **entire script**,
silently skipping the `confirm_vendor_bill` replacement several hundred lines
below. The operator saw an error and reasonably assumed nothing had changed —
in fact nothing had changed *including the part that was needed*, leaving the
live function without its landed-cost legs.

**The lesson:** every migration that might be re-applied must be idempotent
end to end. `CREATE POLICY` has no `IF NOT EXISTS`; guard it explicitly:

```sql
DROP POLICY IF EXISTS my_policy ON public.my_table;
CREATE POLICY my_policy ON public.my_table ...;
```

Use `CREATE OR REPLACE FUNCTION`, `ADD COLUMN IF NOT EXISTS`,
`CREATE INDEX IF NOT EXISTS`, and guard data repairs with a
`WHERE <target> IS DISTINCT FROM <value>` predicate so re-runs are no-ops.

**And:** after any migration, verify the intended **end state** directly rather
than trusting the absence of an error.

---

## 5. Live function definitions drift from migration files

**Incident:** The live posting functions silently reverted to an earlier state,
losing voucher-date reversals, the round-off leg and landed-cost legs — while
the corresponding tables and columns remained in place. Almost certainly an old
migration file re-run, `CREATE OR REPLACE`-ing functions with stale bodies.

**The lesson:** the live database is the source of truth for function bodies.
Generate patches from `pg_get_functiondef`, never from an old migration file.
Never re-run an old migration against production — it overwrites every function
it defines with that file's version of them.

The regression suite's function-source assertions exist specifically to catch
this class of regression. Keep adding them.

---

## 6. Grep results can come from a stale worktree

**Incident:** A search concluded that certain list pages had no date filter.
They did. The search had run against `.claude/worktrees/…`, a stale checkout,
not the main repo.

**The lesson:** when a search result contradicts expectation, verify the path
before acting on it. Edits and commits target `E:\stockbolt_clean\stockbolt-v1`.
A false negative from a stale tree looks exactly like a real finding.

---

## 7. Convenience functions outlive their convenience

**Incident:** `_regression_test_query(p_sql text)` — a `SECURITY DEFINER`
function executing arbitrary SQL, intended for the test harness — was installed
on the production database with `EXECUTE` granted to `anon` and `authenticated`.
The anon key is published in the browser bundle, so any anonymous visitor could
read every tenant's data, bypassing RLS entirely.

**Why it happened:** a fresh `CREATE FUNCTION` default-grants `EXECUTE` to
`PUBLIC`. The intended `REVOKE` was in the source but never took effect live.

**The lesson:** for any new function, revoke explicitly and grant narrowly:

```sql
REVOKE ALL ON FUNCTION public.my_fn(...) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_fn(...) TO service_role;  -- or authenticated, if intended
```

Then verify the grants live. And keep test-only tooling out of production
entirely — tests and production sharing one database is what made this possible.

---

## 8. Permissive `FOR ALL` policies grant writes you didn't intend

**Incident:** `audit_logs` carries only
`CREATE POLICY tenant_isolation ... FOR ALL USING (company_id = current_user_company_id())`.
`FOR ALL` covers `UPDATE` and `DELETE`, so any authenticated user can edit or
delete their own company's audit trail — the one table that must be immutable.

**The lesson:** `FOR ALL` is rarely what you want on a financial or audit table.
Grant `SELECT` explicitly, deny client `INSERT` where a `SECURITY DEFINER`
function does the writing (definers bypass RLS), and simply omit `UPDATE`/
`DELETE` policies so both are denied by default.

---

## Recognising a new trap

The pattern behind all eight: **a guard that appears to protect something but
checks a weaker condition than assumed.** Balance instead of magnitude. A read
instead of a lock. An error message instead of an end state. A policy verb
broader than intended. A grant default instead of a grant decision.

When you add or rely on a guard, state precisely what it proves — and what it
does not. If the gap between those two could produce a wrong number rather than
an error, close it before shipping, and add the trap here.
