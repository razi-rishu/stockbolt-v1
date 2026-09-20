### Migrations moved

The migration workflow — file naming, the template, idempotency by object type,
backfill guards, the three-phase `NOT NULL` add, hand-apply steps, post-apply
validation, and the never-re-run-old-migrations rule — now lives in its own
skill so there is a single source of truth.

**Use the `migration-guardian` skill** for anything involving a migration:
writing one, altering schema, adding a table/column/index/constraint/trigger,
changing an RPC or policy, backfilling or repairing data, or verifying that a
migration applied.

Its references:
- `migration-guardian/references/playbook.md` — writing and applying.
- `migration-guardian/references/validation.md` — before/after verification.

`database-guardian` still owns the surrounding craft — RLS policy authoring,
RPC and grant patterns, query bounds, and indexing — in `rls-and-rpc.md` and
`query-and-index.md`.
