### Migration playbook — writing and applying

Read before writing any migration. Migrations go straight into a live database
holding real customers' books, pasted by hand, with no automated rollback.
Write every one as if it will be run twice, at the wrong time, by someone who
cannot easily undo it — because all three have happened here.

## Naming and location

```
supabase/migrations/YYYYMMDDNNNNNN_phaseNN_short_slug.sql
```

Keep the timestamp monotonic with existing files so ordering is unambiguous.

## Template

```sql
-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase NN: <what and why, one or two sentences>
-- ─────────────────────────────────────────────────────────────────────────
-- Additive + idempotent. Safe to re-run.
-- <If there is a data repair, state exactly what it touches and its guard.>
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Schema (additive only)
ALTER TABLE public.my_table
  ADD COLUMN IF NOT EXISTS my_col text;

-- 2. Indexes
CREATE INDEX IF NOT EXISTS my_table_my_col_idx
  ON public.my_table (my_col);

-- 3. Policies — CREATE POLICY has NO "IF NOT EXISTS"; drop first
DROP POLICY IF EXISTS my_policy ON public.my_table;
CREATE POLICY my_policy ON public.my_table
  FOR SELECT USING (company_id = public.current_user_company_id());

-- 4. Functions — CREATE OR REPLACE is inherently idempotent
CREATE OR REPLACE FUNCTION public.my_fn(p_arg uuid)
RETURNS ... LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$ ... $$;

-- 5. Grants — never rely on the default (a new fn grants EXECUTE to PUBLIC/anon)
REVOKE ALL ON FUNCTION public.my_fn(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_fn(uuid) TO authenticated;

-- 6. Data repair — guarded so a re-run is a no-op
UPDATE public.my_table
   SET my_col = 'x'
 WHERE my_col IS DISTINCT FROM 'x'
   AND <additional safety predicate>;

COMMENT ON COLUMN public.my_table.my_col IS 'Phase NN — <purpose>';
```

## Idempotency by object type

| Object | Idempotent form | Gotcha |
|---|---|---|
| Table | `CREATE TABLE IF NOT EXISTS` | Won't add columns to an existing table |
| Column | `ADD COLUMN IF NOT EXISTS` | `NOT NULL` needs a `DEFAULT` or a backfill first |
| Index | `CREATE INDEX IF NOT EXISTS` | `CONCURRENTLY` can't run inside a transaction block |
| Function | `CREATE OR REPLACE FUNCTION` | Changing the signature creates an **overload** — `DROP FUNCTION` the old one explicitly |
| Trigger | `DROP TRIGGER IF EXISTS` then `CREATE TRIGGER` | No `OR REPLACE` for triggers |
| **Policy** | `DROP POLICY IF EXISTS` then `CREATE POLICY` | **No `IF NOT EXISTS` — the one that caused a production incident** |
| Constraint | Guarded `DO $$ ... $$` checking `pg_constraint` | No `IF NOT EXISTS` |
| Enum value | `ALTER TYPE ... ADD VALUE IF NOT EXISTS` | Can't run inside a transaction in older versions |
| Seed row | `INSERT ... ON CONFLICT DO NOTHING/UPDATE` | Needs a unique constraint to conflict on |

### The policy trap, concretely

`CREATE POLICY` has no `IF NOT EXISTS`. Re-running a file with a bare
`CREATE POLICY` raises `42710 policy already exists`, and because the SQL editor
runs the script as one unit, **Postgres rolls back everything** — including
correct work further down the file. The operator sees an error and reasonably
concludes nothing changed; in fact nothing changed *including the part that
mattered*. Always `DROP POLICY IF EXISTS` first.

## Data repairs

Guard so re-running is harmless, and scope so the blast radius is visible:

```sql
UPDATE public.journal_entries je
   SET date = src.date
  FROM public.invoices src
 WHERE je.source_id = src.id
   AND je.source_type = 'sales_invoice'
   AND je.date IS DISTINCT FROM src.date          -- re-run = no-op
   AND src.date > COALESCE(
         (SELECT period_lock_date FROM public.companies WHERE id = je.company_id),
         '1900-01-01'::date);                      -- never touch a locked period
```

**Count the affected rows first** with a read-only probe. "This updates 3 rows"
and "this updates 40,000 rows" are different conversations, and the owner
deserves to know which one they are approving. A repair on financial tables is
CRITICAL and needs the plan agreed before writing.

## Adding a NOT NULL column to a populated table

Never in one step. Three phases, possibly across migrations:

1. Add the column nullable, with a default if appropriate.
2. Backfill in a guarded `UPDATE`.
3. Only once every row is populated, `SET NOT NULL`.

Adding `NOT NULL` without a default to a table with rows fails outright; adding
it *with* a default rewrites the table and locks it.

## Hand-apply workflow

Rashid applies migrations himself and is a beginner with Supabase tooling.
Write steps he can follow literally:

1. Name the file to open.
2. Say to copy its **entire** contents.
3. Say where to paste (Supabase dashboard → SQL Editor → New query) and to
   click **Run**.
4. Give the verification query to paste next, and state exactly what a healthy
   result looks like ("should return 0 rows", "should show `service_role` only").
5. If several migrations must go in order, number them and say the order matters.

Never run DDL against the live database yourself.

## Never re-run an old migration file

If a live function looks wrong, do **not** reach for the migration that created
it. That file holds the state of *every* function it defines as of the day it
was written; running it reverts all of them. This is exactly how voucher-date
reversals, the round-off leg, and landed-cost legs were silently lost in
production.

Instead: read the current definition with `pg_get_functiondef`, edit that text,
and ship it as a **new** migration.
