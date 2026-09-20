---
name: migration-guardian
description: How to write, apply, and verify database migrations for StockBolt ERP — safely, on a live customer database, applied by hand, with no down-migration system. Use this skill for ANYTHING involving a migration: writing a new one, altering schema, adding a table/column/index/constraint/trigger, changing an RPC or policy, backfilling or repairing data, or planning how a change reaches production. Also use it when deciding whether a schema change is safe, or when a past migration may have half-applied. This is the single source of truth for migrations; database-guardian defers here for them.
---

# Migration guardian — safe schema change on a live ERP

This skill owns the **migration workflow** end to end. For the surrounding
database craft — RLS policy authoring, RPC/grant patterns, query bounds — use
`database-guardian`. For the accounting/inventory rules a data change must
respect, use `accounting-engine` / `inventory-engine`. For risk tiers and the
overall change process, use `erp-guardian`.

## The reality that governs everything

Three facts about *this* project override generic migration advice. Internalise
them before writing a line of SQL, because most "best practice" assumes a world
StockBolt doesn't live in:

1. **Migrations are applied by hand to the live production database.** Rashid
   pastes the SQL into the Supabase SQL editor against a database holding real
   customers' books (`IMBD123`, `Pro_Parts` are real businesses). There is no
   staging environment to catch a mistake first. You never run DDL against the
   live DB yourself — you deliver a file and exact instructions.

2. **There is no down-migration system, and "rollback" as usually meant does
   not exist here.** You cannot ship a `.down.sql`, and there is no framework to
   run one. So the safety property that actually protects the data is **not
   reversibility** — it is that a migration is *additive* (adds, never
   destroys), *idempotent* (safe to run twice), and *verifiable* (you can prove
   afterward it took effect). A migration that promises a "rollback script" is
   promising something the project cannot deliver; do not write that promise.
   What "undo" really means here is covered below.

3. **Additive-only is not a preference, it is the design.** The whole schema
   evolves by adding. Dropping a column, renaming a table, changing a type, or
   removing a constraint has no safe path on a live hand-applied DB and is
   effectively never done. If a task seems to require one, stop and raise it.

If you ever catch yourself writing "BEGIN … backup … rollback script … validate
rollback", you have drifted into a different project's playbook. Come back to
additive + idempotent + verifiable.

## What "undo" actually means

Since there is no rollback framework, plan the *undo path* honestly up front —
it is one of these three, and you should say which in your report:

- **Additive change (column/table/index/function/policy add):** nothing to
  undo. The old code ignores the new object; leaving it in place is harmless.
  This is the overwhelmingly common case and the reason additive is safe.
- **A function replacement (`CREATE OR REPLACE`):** the "undo" is to redeploy
  the previous definition — which you get from the live database
  (`pg_get_functiondef`), never from an old migration file (see the traps).
- **A data repair (`UPDATE`/backfill):** there is usually no clean undo, which
  is exactly why you count the affected rows first, guard the predicate so a
  re-run is a no-op, and get agreement before applying. If a repair genuinely
  cannot be undone, that is a reason to slow down, not a footnote.

## Risk tiers for migrations

| Tier | Examples | What it demands |
|---|---|---|
| **LOW** | Add an index, add a nullable column with a default | Migration file, additive + idempotent. Verify it applied. |
| **MEDIUM** | New non-financial table (+RLS), new view, new plain function | The above + RLS on the new table + grants stated + post-apply verification. |
| **HIGH** | New/changed RLS policy, new RPC, FK addition, backfill of existing rows | The above + count affected rows first + revalidate dependent RPCs/policies + numeric spot-check. |
| **CRITICAL** | Any posting RPC, GL/stock schema, tax tables, `SECURITY DEFINER`, data repair on financial tables | The above + generate from the **live** definition + confirm the plan with Rashid before writing + a regression test + full post-apply validation. |

Take the higher tier when unsure. The financial tables — `journal_entries`,
`general_ledger`, `chart_of_accounts`, `stock_ledger`, `deferred_cogs_queue`,
`payments`, `invoices`, `vendor_bills`, `tax_rates`, `audit_logs` — are CRITICAL
whenever a change touches them, no matter how small it looks.

## The workflow

1. **Understand and scope.** One sentence on what changes and why. For a
   function change, read the **live** definition first (it drifts from the files).
2. **Assess impact and tier.** What tables, RPCs, policies, indexes, reports does
   this touch? (See `erp-guardian` impact-analysis for the full template.)
3. **For CRITICAL: agree the plan before writing.** A rejected plan costs a
   message; a rejected migration on live data costs a repair.
4. **Write the migration** — additive, idempotent, guarded. Template and
   idempotency-by-object-type in `references/playbook.md`.
5. **For a data repair: count the affected rows first** with a read-only probe,
   and guard the `WHERE` so a re-run is a no-op.
6. **Write the hand-apply instructions** — literal, ordered steps Rashid follows
   in the SQL editor (he is a beginner with the tooling).
7. **Write a soft-skipping regression test** that locks the change (see
   `test-engine`).
8. **After it's applied, verify the end state** — not the absence of an error.
   The full pre/post checklist is in `references/validation.md`.

## The core non-negotiables

**Additive only.** No drop, no rename, no type change, no PK change — unless
that literally is the request, in which case stop and confirm the risk first.

**Idempotent always.** Assume every migration runs twice. `CREATE OR REPLACE`,
`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DROP POLICY IF EXISTS`
before `CREATE POLICY`, guarded backfills. The playbook has the per-object forms.

**Never assume a table is empty.** Every table may hold customer data. A
`NOT NULL` add without a default fails; an ungarded backfill corrupts.

**RLS on every new table, in the same migration.** A table shipped without
policies is cross-tenant readable until someone notices.

**State grants on every new function.** A new function default-grants EXECUTE to
`PUBLIC` (which includes `anon`). Revoke, then grant narrowly. This exact default
already put an arbitrary-SQL function on the public internet (security-guardian
SEC-1).

## Traps that have already caused incidents here

These are load-bearing — each corresponds to a real production failure. Full
detail in `erp-guardian` known-traps and `references/playbook.md`:

- **`CREATE POLICY` has no `IF NOT EXISTS`.** Re-running a file with a bare
  `CREATE POLICY` aborts and **rolls back the whole script** — silently skipping
  correct work further down. Always `DROP POLICY IF EXISTS` first. This one
  silently reverted a posting function in production.
- **Never re-run an old migration file to "restore" a function.** That file
  holds every function it defines as of its authoring date; running it reverts
  all of them. This is how voucher-date reversals, the round-off leg, and
  landed-cost legs were lost live. Patch from `pg_get_functiondef`, ship a *new*
  migration.
- **A migration can abort mid-script and roll back while looking like it "ran".**
  "No error appeared" is not proof. Verify the intended end state directly.

## When to stop and ask

- The change would drop, rename, or destructively alter anything.
- A data repair touches existing financial rows (raise the count and the plan).
- You cannot tell whether a migration already partly applied — find out first.
- A `SECURITY DEFINER` function would be reachable by `anon`/`authenticated`.
- The task needs a "rollback script" — explain that the project is additive-only
  and reframe the undo path (additive = nothing to undo; else a forward fix).

## Reporting a migration

```
Summary       — what changes and why
Risk tier     — LOW / MEDIUM / HIGH / CRITICAL
Tables/objects— affected tables, columns, RPCs, policies, indexes, triggers
Additive?     — yes / no (if no, STOP and justify)
Idempotent?   — yes, and how (which guards)
Data impact   — rows a backfill/repair touches (counted, not estimated)
Undo path     — additive (nothing to undo) OR redeploy prior fn OR forward repair
Apply steps   — exactly what Rashid pastes into the SQL editor, in order
Verification  — the end-state checks to run after applying (from validation.md)
Regression    — the locking test added
Confidence    — high / medium / low, and what would raise it
```

Give apply steps literally: not "run the phase51 migration" but "open Supabase →
SQL Editor → New query, paste the contents of
`supabase/migrations/20260720000001_phase51_x.sql`, click Run, then paste this
verification query and confirm it returns 0 rows."

## References

- **`references/playbook.md`** — file naming, the template, idempotency by
  object type, backfill guards, the three-phase `NOT NULL` add, hand-apply
  workflow, and the never-re-run-old-migrations rule. Read before writing.
- **`references/validation.md`** — pre-apply and post-apply verification, scaled
  by risk tier: schema, RLS, RPC, dependent objects, tenant isolation, reports,
  accounting reconciliation, performance. Read at verification time.
