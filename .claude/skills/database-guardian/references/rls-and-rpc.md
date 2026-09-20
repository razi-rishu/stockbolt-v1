### RLS policies and RPC functions

Read before writing a policy or a database function.

Both of these have a default that is wrong for a multi-tenant financial system,
and both have already produced a real security finding in this project. The
theme: **the default is permissive, so silence is not safety.**

## New table checklist

Do all of this in the same migration that creates the table. A table that ships
without policies is readable across tenants until somebody notices.

```sql
CREATE TABLE IF NOT EXISTS public.my_table (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  -- ... columns ...
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  updated_at  timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE public.my_table ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS my_table_company_idx ON public.my_table (company_id);

DROP POLICY IF EXISTS my_table_read ON public.my_table;
CREATE POLICY my_table_read ON public.my_table
  FOR SELECT USING (
    company_id = public.current_user_company_id()
    AND public.has_perm('module.read')
  );

DROP POLICY IF EXISTS my_table_write ON public.my_table;
CREATE POLICY my_table_write ON public.my_table
  FOR INSERT WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.has_perm('module.write')
  );
-- separate UPDATE / DELETE policies as needed
```

Checklist: `company_id` present and FK'd · RLS enabled · index on `company_id`
(RLS predicates run per row, so an unindexed tenant column is a table scan) ·
policies per verb · permission gate as well as tenant gate · timestamps.

## The `FOR ALL` trap

`FOR ALL` covers `SELECT`, `INSERT`, `UPDATE` **and** `DELETE`. On a financial
or audit table this is almost never what is intended.

This is how `audit_logs` ended up mutable by ordinary users — a single
`FOR ALL USING (company_id = current_user_company_id())` policy meant any
authenticated user could delete their own company's audit trail, which is the
one table that must be immutable.

Prefer explicit verbs, and simply **omit** the ones you want denied — with RLS
enabled, an operation with no permissive policy is refused:

```sql
-- read: yes
CREATE POLICY audit_read ON public.audit_logs
  FOR SELECT USING (company_id = public.current_user_company_id());

-- client insert: no (SECURITY DEFINER posting functions bypass RLS anyway)
CREATE POLICY audit_no_client_insert ON public.audit_logs
  FOR INSERT WITH CHECK (false);

-- no UPDATE or DELETE policy at all → both denied
```

Also consider `ALTER TABLE ... FORCE ROW LEVEL SECURITY`: without it, the table
**owner** bypasses RLS, which can mask a missing policy during testing.

## Permissive vs restrictive

Multiple `PERMISSIVE` policies are OR'd — adding one can only *widen* access.
`RESTRICTIVE` policies are AND'd and can only *narrow* it. This project uses
restrictive policies for the RBAC write/read lockdown so that a permissive
tenant-isolation policy cannot accidentally grant a write to a role that lacks
the permission. When adding a policy, be deliberate about which you want; a new
permissive policy on a locked-down table may quietly reopen something.

## SECURITY DEFINER — power and responsibility

`SECURITY DEFINER` runs as the function owner and **bypasses RLS**. It is the
right tool for posting engines (which must write GL rows the caller could not
write directly) and the wrong tool for anything that merely reads user data.

Every definer function must:

1. `SET search_path = public, pg_temp` — without it, a caller can shadow
   objects with a temp schema and change what your function resolves to.
2. **Gate itself internally.** RLS is not protecting it, so the function must
   check identity and permission itself:
   ```sql
   IF auth.uid() IS NULL THEN
     RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
   END IF;
   PERFORM public.auth_require('module.write');
   ```
   `reset_company_data` is a good model: it requires authentication, same-company
   membership, admin role, **and** typing the company name to confirm.
3. **Never accept arbitrary SQL.** A definer function taking a `text` parameter
   it executes is a full database compromise primitive. One such helper reached
   production and was callable by `anon`.
4. **Have its grants stated explicitly** (next section).

Prefer `SECURITY INVOKER` (the default) whenever RLS already expresses the
rule — then tenant isolation is enforced for free.

## Grants — the default is the danger

A newly created function default-grants `EXECUTE` to `PUBLIC`, and `PUBLIC`
includes `anon`. The anon key ships inside the browser bundle, so "granted to
anon" means "callable by anyone on the internet".

State the grant on **every** function:

```sql
REVOKE ALL ON FUNCTION public.my_fn(uuid) FROM PUBLIC, anon, authenticated;

-- then grant exactly one of:
GRANT EXECUTE ON FUNCTION public.my_fn(uuid) TO authenticated;   -- app-callable
GRANT EXECUTE ON FUNCTION public.my_fn(uuid) TO service_role;    -- Edge Function only
```

Note that `CREATE OR REPLACE` on an *existing* function preserves its ACL,
while a *new* function gets the permissive default — so a function that was
safe can become exposed simply by being dropped and recreated. Verify grants
live after applying, rather than trusting the source:

```sql
SELECT grantee, privilege_type FROM information_schema.routine_privileges
WHERE routine_name = 'my_fn';
```

If `anon` or `authenticated` appears on something that should be internal, fix
it immediately.

## Input validation in RPCs

Validate at the boundary, and fail with a clear `ERRCODE`:

- Required arguments are non-null and well-formed.
- Enum-like text is checked against an allowed list.
- Numerics are range-checked (quantities positive, percentages 0–100).
- The referenced row belongs to the caller's company — never trust an id alone;
  an id is a guess away from another tenant's row.

Build dynamic SQL only with `format()` and `%I` / `%L` placeholders. Never
concatenate user input into a statement. The same discipline applies to
PostgREST filter strings built in TypeScript — `.or()` takes a string, and a
value interpolated into it is an injection surface even though it looks like a
typed API call. Prefer `.in('col', array)` over a hand-built `.or()`.

## Triggers

Good uses: enforcing an invariant (`je_must_balance`), maintaining `updated_at`,
blocking an impossible state (negative stock), writing audit rows.

Avoid: hiding business logic a reader would never think to look for, expensive
work on hot paths, and anything that can recurse.

**Know what a trigger actually proves.** A `BEFORE INSERT` trigger that
`SELECT`s to check for a conflicting row is a read-check, not a guarantee — two
concurrent transactions each see a clean slate under `READ COMMITTED` and both
proceed. That is exactly how the double-post guard can be defeated. When you
need uniqueness, use a unique index (partial, if the rule is conditional) and
keep the trigger for the friendly error message:

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS my_unique_idx
  ON public.my_table (company_id, source_type, source_id)
  WHERE reversal_of_id IS NULL AND reversed_by_id IS NULL;
```

Check for existing violations before building it — the index creation fails if
any exist, and finding them is itself a useful integrity audit.

## Storage policies

Buckets `logos` and `products` are public by design (images must render);
`attachments` is private. Public means **world-readable by URL, without RLS** —
so never write anything sensitive to the public buckets. Write policies still
apply, and paths are company-scoped as `{company_id}/{entity}/…`; keep that
convention so the policies keep working.
