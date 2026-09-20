### Open findings register

The canonical audit is `docs/SECURITY_AUDIT_2026-07-19.md`. This register is the
**actionable subset**: each item carries a verification query so you can confirm
its *current* state instead of trusting a status word.

Statuses below reflect a live check on **2026-07-19**. **Always re-run the
queries.** In this project, "that was fixed" has already turned out to be false
once (the posting-function drift), and a security register that is trusted
rather than verified is worse than no register at all.

Run each query through the regression helper RPC as a read-only probe, and
delete the probe afterwards.

---

## 🔴 SEC-1 — Arbitrary-SQL RPC callable by `anon` (P0, **OPEN**)

`public._regression_test_query(text)` is `SECURITY DEFINER`, executes an
arbitrary SQL string, and is granted to `anon` and `authenticated`. The anon key
ships inside the browser bundle, so **anyone on the internet can read every
tenant's data**, bypassing RLS completely. This is the most severe issue in the
codebase.

**Verify** — healthy result is `service_role` and `postgres` only:
```sql
SELECT grantee FROM information_schema.routine_privileges
WHERE routine_name = '_regression_test_query' ORDER BY grantee;
```
*Last checked 2026-07-19: returned `anon, authenticated, postgres, service_role` — still open.*

**Fix:**
```sql
REVOKE ALL ON FUNCTION public._regression_test_query(text)
  FROM PUBLIC, anon, authenticated;
```
Preferably remove it from production entirely (`DROP FUNCTION`) — it is a test
helper that has no business living in a customer database.

**The tension to resolve honestly:** the regression suite depends on this
function, and the suite runs against the live database (SEC-6). Dropping it
breaks the suite until a separate test project exists. The revoke above is safe
to apply immediately regardless, because the suite connects as `service_role`.

---

## 🟠 SEC-2 — Audit logs are user-mutable (**OPEN**)

`audit_logs` carries a single `FOR ALL` policy. `FOR ALL` covers UPDATE and
DELETE, so any authenticated user can rewrite or erase their own company's audit
trail — defeating the entire purpose of having one, and failing IT general
controls in any external audit.

**Verify** — healthy result is a SELECT policy plus an insert-deny, and **no**
policy with `cmd = 'ALL'`:
```sql
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'audit_logs';
```
*Last checked 2026-07-19: returned one policy `tenant_isolation` with `cmd = ALL` — still open.*

**Fix:**
```sql
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.audit_logs;

CREATE POLICY audit_read ON public.audit_logs
  FOR SELECT USING (company_id = public.current_user_company_id());

-- posting functions are SECURITY DEFINER and bypass RLS, so clients need no INSERT
CREATE POLICY audit_no_client_insert ON public.audit_logs
  FOR INSERT WITH CHECK (false);

-- no UPDATE or DELETE policy → both denied by default
```

---

## 🟠 SEC-3 — Public API paid-gate not enforced at runtime (**OPEN**)

`company_has_api_access()` is checked when a key is *created*, but the Edge
Function never re-checks entitlement per request. A tenant who downgrades or
cancels keeps working keys indefinitely — an access-control gap as well as
revenue leakage.

**Verify** — no matches means it is still unenforced:
```bash
rg -n "company_has_api_access|api_access|subscription" supabase/functions/api/index.ts
```

**Fix:** in `authenticate()`, after resolving the key, check the company's
entitlement and return 402/403 when absent. Cache per company for ~60s so this
does not add a query to every request.

---

## 🟡 SEC-4 — Missing security headers (**OPEN**)

`vercel.json` sets `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`
and `Referrer-Policy`. Missing: **Content-Security-Policy**,
**Strict-Transport-Security**, **Permissions-Policy**.

CSP matters most here: the session JWT lives in localStorage, so a successful
XSS means token theft. CSP is the compensating control, and right now there
isn't one.

**Verify:** read the `/(.*)` header block in `vercel.json`.

**Fix:** add HSTS and Permissions-Policy immediately; roll CSP out in
report-only mode first, since Vite's inline styles usually need tuning. Exact
header values are in the audit, §M-1.

---

## 🟡 SEC-5 — Dependency vulnerabilities (**OPEN**)

`xlsx` (SheetJS) carries a HIGH prototype-pollution + ReDoS advisory with **no
fix on npm**, and the Import feature parses attacker-supplied `.xlsx` files.
`ws` carries a HIGH advisory that does have a fix.

**Verify:**
```bash
npm audit --omit=dev
```

**Fix:** `npm audit fix` handles `ws`. For `xlsx`, migrate to the maintained
SheetJS distribution or `exceljs`, size-cap uploads, and parse in a Web Worker.

---

## 🟡 SEC-6 — Tests run against the production database (**OPEN**, process)

`.env.local` and the pre-commit suite point at the live project. This is the
root cause behind SEC-1 reaching production, and it is why posting drift went
undetected.

**Fix:** stand up a separate Supabase project for dev/test; point `.env.local`
and CI at it; keep production migration-only.

---

## Not a finding, but know its limits: the API rate limiter

The limiter counts `api_request_log` rows from the last minute, and the usage
row is inserted *after* the response — so a concurrent burst all reads a stale
count and passes. It also treats a failed count query as zero, meaning an error
silently disables it.

Both behaviours are fine for a courtesy speed bump and wrong for a security
control. If a real limit is ever needed (brute-force protection, abuse), use an
atomic per-key/per-minute counter that **fails closed**.

---

## Adding to this register

When you find a new vulnerability, add: a one-line description of the exposure,
a verification query with its healthy result stated explicitly, and the fix.

The value of this file is that a future session can re-check the entire security
surface in about two minutes instead of re-running a full audit. Anything that
does not serve that purpose belongs in the audit document instead.
