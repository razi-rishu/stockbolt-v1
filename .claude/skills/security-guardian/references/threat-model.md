### Threat model and verification probes

Read when verifying exposure or reviewing whether a change is safe to ship.

Security verification is not "does this work for me". It is **"does this fail
for the people it should fail for"** — which means deliberately attempting the
attack rather than confirming the happy path. A feature that works perfectly and
also returns another tenant's rows passes every functional test ever written.

All probes below are read-only. Run them through the regression helper RPC and
delete the probe script afterwards.

---

## The real attack surface, ranked

**1. Cross-tenant read — catastrophic, and the most likely.**
Multi-tenant SaaS lives or dies here. Every query must be scoped to the caller's
company. In the app, RLS does this. In Edge Functions (service_role), **RLS is
off** and the scope is whatever `.eq('company_id', …)` you wrote — a missing one
is a breach, not a bug. SEC-1 is this attack in its purest form.

**2. Privilege escalation — high.**
A staff user performing an admin action. RBAC gates this via `has_perm`, but
`SECURITY DEFINER` functions bypass RLS by design and must therefore re-check
identity and permission themselves.

**3. XSS → session theft — high impact, currently low likelihood.**
The JWT lives in localStorage, so any script running on the page can read it.
Likelihood is low because there is no `dangerouslySetInnerHTML` anywhere and
React escapes by default — but there is **no CSP** (SEC-4) to contain a mistake.
This is why the no-raw-HTML discipline is load-bearing rather than stylistic.

**4. Secret exposure — high impact, low likelihood.**
The service key bypasses everything. It lives only in Vercel env and
`.env.local`. Any path that moves it toward the client, a log, or a response is
a total compromise.

**5. Injection — low, but non-zero.**
Posting logic uses parameterised RPCs. The residual surface is string-built
filters: PostgREST `.or()` takes a *string*, so interpolating user input into it
is an injection vector even though it looks like a typed API call.

### What is NOT the threat (don't spend effort here)

**Classic CSRF does not apply.** Authentication is a JWT in the `Authorization`
header, not a cookie. CSRF depends on the browser automatically attaching a
cookie to a cross-site request; a header token is never auto-attached, so a
malicious site cannot ride the session. Adding CSRF tokens here would be
security theatre. The mirror-image risk — XSS reading the token out of
localStorage — is the one that matters.

**Password handling is Supabase's.** No passwords are stored, hashed, or reset
by this codebase. Never add custom auth, password policies, or reset flows.

---

## Probe 1 — What can `anon` and `authenticated` execute?

The single highest-value security query in this project. Any `SECURITY DEFINER`
function reachable by `anon` that does not gate itself internally is a hole.

```sql
SELECT p.proname, r.grantee, p.prosecdef AS security_definer
FROM information_schema.routine_privileges r
JOIN pg_proc p ON p.proname = r.routine_name
WHERE r.grantee IN ('anon', 'authenticated')
  AND p.prosecdef = true
  AND p.pronamespace = 'public'::regnamespace
ORDER BY p.proname;
```

Expect a long list — Supabase grants EXECUTE to `anon` by default, and most of
these functions self-gate correctly (`reset_company_data` requires auth +
same-company + admin + typed confirmation; `create_api_key` requires
`settings.write` + plan entitlement). That is fine.

What you are hunting for is a function that takes powerful input and performs
**no internal identity check**. Read the body of anything unfamiliar:

```sql
SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = '<name>';
```

Then confirm it contains an `auth.uid()` check, an `auth_require(...)`, or a
company-scoped predicate. If it contains none, that is a finding.

## Probe 2 — RLS coverage

A table without RLS is readable across tenants. Healthy result: zero rows.

```sql
SELECT relname FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = false
ORDER BY relname;
```

*Last verified: all 124 tables had RLS enabled. Re-check after adding any table.*

## Probe 3 — Direct table grants to `anon`

Even with RLS, a direct grant widens the surface. Healthy result: zero rows.

```sql
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'anon' AND table_schema = 'public'
ORDER BY table_name;
```

*Last verified: empty — the table layer is clean.*

## Probe 4 — Policy verbs on sensitive tables

`FOR ALL` on a financial or audit table almost always grants more than intended
(SEC-2). Review the verbs rather than assuming.

```sql
SELECT tablename, policyname, cmd, permissive
FROM pg_policies
WHERE tablename IN ('audit_logs','general_ledger','journal_entries',
                    'api_keys','subscriptions','profiles')
ORDER BY tablename, cmd;
```

## Probe 5 — Secret leakage in the bundle

The service key must never appear in client code. Healthy result: no matches.

```bash
rg -rn "SERVICE_ROLE|SERVICE_KEY|SECRET_KEY|service_role" src/
git ls-files | rg -i "\.env"        # only .env.example should be tracked
```

## Probe 6 — Cross-tenant access attempt

The direct test of isolation. Using two known company ids, confirm a query
scoped to company A cannot return company B's rows — and, more usefully, review
new Edge Function code for any query missing its `company_id` filter:

```bash
rg -n "from\('" supabase/functions/api/index.ts | rg -v "company_id"
```

Every data query in service-role code should appear in the filtered set. Anything
in the unfiltered output needs a reason.

## Probe 7 — Response field leakage

Public API responses use explicit allow-lists so internal fields cannot escape
by accident. Confirm margin and internal data stay out:

```bash
rg -n "cost_at_sale|company_id|key_hash" supabase/functions/api/index.ts
```

`cost_at_sale` should appear only in a comment explaining its exclusion.

---

## Reviewing a change for exposure

Four questions, in order. If any answer is unsatisfying, that is the thing to
fix before shipping:

1. **Who can reach this?** `anon` / any authenticated user / one tenant /
   one role / service-role only. Name it precisely — the gap between "callable
   by anon" and "service-role only" is the entire risk profile.
2. **What enforces the boundary?** RLS, an explicit `.eq('company_id')`, a grant,
   an internal `auth_require`? "The UI doesn't show the button" is not an answer;
   the API is reachable regardless of the UI.
3. **What happens if the caller lies?** Sends another tenant's id, an expired
   token, a crafted filter string, an oversized payload.
4. **If this leaks, what leaks?** One field, one tenant, or everything.

## Security regression scenarios worth locking

The existing suite is structural — it checks that policies and functions exist,
not that an attack fails. The highest-value additions would assert exposure
directly:

- No `SECURITY DEFINER` function in `public` grants EXECUTE to `anon` without an
  internal auth gate (would have caught SEC-1 at commit time).
- `audit_logs` has no policy with `cmd = 'ALL'` (SEC-2).
- Every table in `public` has `relrowsecurity = true`.
- `anon` holds no direct table grants.

Each is a single query with an unambiguous healthy result, which makes them
cheap to add and hard to argue with — the profile of a good tripwire.
