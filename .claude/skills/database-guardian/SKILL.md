---
name: database-guardian
description: PostgreSQL and Supabase craft for StockBolt ERP — how to write migrations that are safe to hand-apply and re-run, how to author RLS policies and RPCs without leaving a security hole, how to keep queries bounded and correctly indexed, and how to verify all of it against the live database. Use this skill for ANY database work in StockBolt: writing or applying migrations, schema changes, new tables, RLS policies, SECURITY DEFINER functions, RPC grants, indexes, foreign keys, triggers, constraints, query performance, N+1 problems, and Supabase specifics (PostgREST row caps, service_role, storage policies, Edge Functions). Use it even for small schema tweaks and "just add a column" requests, because migrations here are applied by hand to a live customer database where a half-applied script has already caused a production incident.
---

# Database guardian — PostgreSQL & Supabase craft for StockBolt

This skill covers **how to do database work correctly**. For *when* to be
careful and how much process a change deserves, use `erp-guardian` (risk tiers,
impact analysis, the trap catalogue). For accounting identities and what
correct posting means, use `accounting-engine`. For how the system is put
together, use `stockbolt`.

## Why the database carries the weight here

Application code is one path to the data. The database is *every* path — the
app, the public API, an import, a future integration, a hand-run SQL statement
at 2am. A rule enforced in a React form protects one of those; a rule enforced
by a constraint protects all of them, permanently, including against code that
does not exist yet.

That asymmetry is why business rules that protect **money or data integrity**
belong in the database. Frontend validation is for telling the user something
is wrong before they submit — it is a courtesy, not a guarantee. When the two
disagree, the database is right by construction.

## Three realities of this specific project

Generic Postgres advice will mislead you here. Internalise these first.

**1. Migrations are additive-only and applied by hand.** There is no
down-migration system and no automated deploy. Rashid pastes SQL into the
Supabase SQL editor against a database holding real customers' books. So the
safety property that matters is **not reversibility** — it is that a migration
is *additive* (adds, never destroys), *idempotent* (safe to run twice), and
*verifiable* (you can prove afterwards that it took effect). A migration
claiming to be "reversible" here is claiming something the project cannot
deliver; do not promise it.

**2. PostgREST is the API, and it has a row cap.** Every client query goes
through PostgREST, which caps responses (1,000 rows by default). An unbounded
`.select()` therefore does not error when it exceeds the cap — it **silently
truncates**. This has already produced a latent defect where financial reports
would quietly understate as tenants grow. Bounded queries are a correctness
requirement here, not a performance nicety.

**3. Service-role code has no safety net.** RLS protects the app because the
app runs as `authenticated`. Edge Functions run as `service_role` and **bypass
RLS entirely**, so every query in that code must carry its own
`.eq('company_id', …)`. A missing filter there is a cross-tenant breach, not a
bug.

## The real critical tables

Changes touching these need the highest scrutiny. These are the actual table
names in this schema — if you find yourself writing SQL against
`journal_entry_lines`, `account_balances`, `stock_movements`,
`inventory_transactions`, or a bare `accounts` table, stop: **those do not
exist here**, and you are working from a generic ERP mental model rather than
this one.

| Concern | Real tables |
|---|---|
| Journals & ledger | `journal_entries`, `general_ledger` |
| Accounts | `chart_of_accounts` |
| Inventory | `stock_ledger`, `deferred_cogs_queue`, `product_serials` |
| Sales | `invoices`, `invoice_items`, `credit_notes`, `sales_returns`, `sales_quotes`, `sales_orders` |
| Purchasing | `vendor_bills`, `vendor_bill_items`, `purchase_orders`, `goods_receipts`, `debit_notes`, `expenses` |
| Money movement | `payments`, `payment_allocations`, `bank_accounts`, `bank_transfers`, `pdc_cheques` |
| Tax | `tax_rates` (tax posts to GL accounts, not a `tax` table) |
| Governance | `audit_logs`, `profiles`, `roles`, `role_permissions` |
| Multi-tenancy | `companies` — nearly every table carries `company_id` |

Confirm names against `docs/Document_2_Database_Schema.md` or the migrations
before writing SQL. Guessing a table name wastes a round trip at best and
produces a broken migration at worst.

## Risk tiers for database work

| Tier | Examples | What it demands |
|---|---|---|
| **LOW** | Read-only query in app code, adding a bounded filter | Verify the query is company-scoped and bounded. |
| **MEDIUM** | New index, new nullable column, new non-financial table | Migration file, additive + idempotent, RLS on the new table. |
| **HIGH** | New RLS policy, new RPC, FK change, index on a hot table | The above + grant review + verify live afterwards. |
| **CRITICAL** | Any posting RPC, GL/stock schema, `SECURITY DEFINER`, data repair | The above + generate from the **live** definition + confirm the plan with Rashid before writing + regression test. |

When unsure, take the higher tier.

## Non-negotiables, and why

**Additive only.** Never drop a column or table, never change a primary key,
never rename anything unless renaming *is* the request. *Why:* live functions,
generated types, saved migrations and the API all bind to these names, and
there is no staging environment to catch the break first.

**Idempotent always.** Assume every migration will be run twice — because one
already was, and a non-idempotent `CREATE POLICY` aborted mid-script, rolling
back a function replacement further down while showing only a confusing error.
Use `CREATE OR REPLACE`, `IF NOT EXISTS`, `DROP POLICY IF EXISTS` before
`CREATE POLICY`, and guard data repairs with a predicate that makes a re-run a
no-op. Full workflow: the **`migration-guardian`** skill.

**Never assume a table is empty.** Every table may already hold customer data.
A migration that adds a `NOT NULL` column without a default, or backfills
without a `WHERE` guard, will either fail or corrupt.

**RLS on every new table, from creation.** Enable it in the same migration that
creates the table, with tenant-isolation policies. *Why:* a table created
without RLS is readable by every tenant until someone notices, and "we'll add
policies later" is how that becomes permanent.

**Revoke explicitly on every new function.** A freshly created function
default-grants `EXECUTE` to `PUBLIC`, which includes `anon` — and the anon key
ships in the browser bundle. This exact default already exposed an arbitrary-SQL
function to the public internet. Never rely on the default; state the grant.
Pattern in `references/rls-and-rpc.md`.

**Never build SQL by string concatenation.** Parameterise, or use `format()`
with `%I`/`%L`. This applies to PostgREST `.or()` filter strings too — those
are a string-injection surface even though they look like an API call.

**Every query is company-scoped and bounded.** Both, always. Scoping prevents
cross-tenant leaks; bounding prevents silent truncation.

**Referential integrity stays on.** Do not drop or disable a foreign key for
convenience. `ON DELETE RESTRICT` on master data is what actually prevents
deleting a customer who has invoices — application checks are advisory, the
constraint is the guarantee.

**Master data is deactivated, never deleted.** Anything with transaction
history keeps its row so historical documents keep resolving.

## Transactions — know what you get for free

A plpgsql function body is a **single transaction**. Every posting RPC
therefore gets all-or-nothing semantics automatically: if any statement raises,
the whole confirm rolls back. This is why posting logic belongs in RPCs.

What does **not** get this: multi-statement work from client or Edge Function
code over PostgREST. Each call is its own transaction, so a sequence like
"insert header, then insert lines" can leave a half-written document if the
second call fails. Either move the whole operation into one RPC (preferred), or
compensate explicitly — the API's order intake, for example, deletes the draft
header if its line insert fails. Say which approach you chose and why.

## Verifying — trust the end state, not the absence of an error

A SQL script can abort partway and roll back while still looking like it "ran".
After any database change, verify what actually exists:

- Functions → `pg_get_functiondef` (also the only reliable source when
  patching, since live definitions drift from migration files)
- Policies → `pg_policies`
- Grants → `information_schema.routine_privileges`
- RLS enabled → `pg_class.relrowsecurity`
- Indexes → `pg_indexes`, then `EXPLAIN ANALYZE` to confirm one is actually used

Run these through the regression helper RPC as a read-only probe (see the
`stockbolt` skill), and delete the probe afterwards.

Then add a regression test that locks the change, soft-skipping until the
migration is applied so the suite stays green in the meantime.

## When to stop and ask

- The change would drop, rename, or destructively alter anything.
- A data repair or backfill touches existing tenant rows.
- You cannot determine whether a migration already partly applied.
- A `SECURITY DEFINER` function would be reachable by `anon` or `authenticated`
  and you are unsure it self-gates.
- The fix requires re-running an old migration file — **never do this**; it
  overwrites every function that file defines with its stale version, which is
  exactly how the posting engine silently regressed once already.

## Reporting database work

```
Impact            — tables, columns, RPCs, policies, indexes, triggers touched
Migration         — file path; additive? idempotent? data repair? 
Apply steps       — exactly what Rashid pastes into the SQL editor, in order
Rollback          — how to undo, or an honest "additive, nothing to undo"
Security          — RLS, grants, tenant scoping, definer/invoker
Performance       — new queries, index usage, expected row counts at scale
Verification      — what you ran against live and what it returned
Risk level        — LOW / MEDIUM / HIGH / CRITICAL
```

Give apply steps as literal, ordered instructions. Rashid applies these by hand
and is a beginner with Supabase tooling — "run the phase51 migration" is not
actionable; "open the SQL editor, paste the contents of
`supabase/migrations/20260720000001_phase51_x.sql`, click Run, then paste this
verification query and confirm it returns 0 rows" is.

## References

- **Migrations** — use the **`migration-guardian`** skill (the single owner of
  the migration workflow: template, idempotency, backfills, hand-apply, and
  before/after validation). `references/migration-playbook.md` here is now a
  pointer to it.
- **`references/rls-and-rpc.md`** — new-table checklist, policy patterns
  (including the `FOR ALL` trap), `SECURITY DEFINER` rules, and the grant
  pattern that prevents anon exposure. Read before writing a policy or RPC.
- **`references/query-and-index.md`** — query bounds, the PostgREST row cap,
  N+1 patterns, indexing decisions, and `EXPLAIN ANALYZE`. Read when writing
  data-access code or diagnosing slowness.
