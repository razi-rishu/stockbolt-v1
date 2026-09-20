# StockBolt v1 — Security, Architecture & Production-Readiness Audit

| | |
|---|---|
| **Date** | 2026-07-19 |
| **Auditor role** | Principal AppSec / Lead Pentest / Supabase + React architect |
| **Scope** | Full repo — 124 tables, ~40 migrations, React/Vite frontend, Supabase RLS + RPCs, public API Edge Function |
| **Method** | Static review + a **read-only** live-DB probe (`pg_policies`, `information_schema.routine_privileges`, `pg_class.relrowsecurity`, `storage.buckets`), deleted after use |
| **Live project verified** | `gzpkuaioibqrdppjdbwz` |
| **Code/DB changed during audit** | None (probe was read-only and removed) |

---

## Verdict

> ### "Would I confidently deploy this ERP for paying customers today?" — **NO.**

There is **one P0 that is already live and exploitable by anyone on the internet with zero credentials.** Everything else is secondary to closing that.

The foundations underneath are genuinely strong (RLS on all 124 tables, no anon table grants, a real double-entry engine, a 91-test regression gate), so this is **"close three holes,"** not "rebuild."

### Do this first — before anything else

Paste into the Supabase SQL editor now:

```sql
REVOKE ALL ON FUNCTION public._regression_test_query(text) FROM PUBLIC, anon, authenticated;

-- verify it is gone from the exposed roles:
SELECT grantee, privilege_type FROM information_schema.routine_privileges
WHERE routine_name = '_regression_test_query';
```

---

## Severity summary

| ID | Severity | Title | Live? |
|---|---|---|---|
| **C-1** | 🔴 Critical | Arbitrary-SQL RPC exposed to `anon` — full multi-tenant data breach | **Yes** |
| **H-1** | 🟠 High | Audit trail is editable & deletable by ordinary users | **Yes** |
| **H-2** | 🟠 High | Public API does not enforce the paid-tier gate at runtime | Yes |
| **H-3** | 🟠 High | `xlsx` (SheetJS) HIGH proto-pollution + ReDoS, no fix, parses user uploads | Yes |
| **H-4** | 🟠 High | No environment separation — tests run against production DB | Yes |
| **M-1** | 🟡 Medium | Missing security headers (no CSP, HSTS, Permissions-Policy) | Yes |
| **M-2** | 🟡 Medium | `ws` dependency — HIGH memory-disclosure + DoS (fix available) | Yes |
| **M-3** | 🟡 Medium | Edge Function rate limiter is fail-open and racy | Yes |
| **M-4** | 🟡 Medium | Order endpoint builds PostgREST `.or()` by string interpolation | Yes |
| **M-5** | 🟡 Medium | Public buckets are world-readable / path-enumerable | Yes |
| **L-1…L-4** | 🔵 Low/Info | CORS `*`, JWT in localStorage, order idempotency race, broad anon EXECUTE | — |

---

## 🔴 CRITICAL

### C-1 — Arbitrary-SQL RPC is exposed to `anon` + `authenticated` on production

- **Location:** `tests/integration/regressions.test.ts:77` (definition) → deployed live as `public._regression_test_query(text)`
- **OWASP:** A01 Broken Access Control / A04 Insecure Design

**Evidence (live DB — not theory):**

```
_regression_test_query EXECUTE grantees:
  service_role, authenticated, anon, postgres     ← anon + authenticated must NEVER be here
```

The function:

```sql
CREATE OR REPLACE FUNCTION public._regression_test_query(p_sql text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ BEGIN
  EXECUTE 'SELECT COALESCE(jsonb_agg(t), ''[]''::jsonb) FROM (' || p_sql || ') t'
    INTO v_result;
  RETURN v_result; END $$;
```

**Impact.** `SECURITY DEFINER` runs as the owner and **bypasses all Row Level Security.** It accepts an arbitrary SQL string, and it is granted to `anon` — whose key is embedded in the public JS bundle by design. Therefore **any anonymous person on the internet** can run `SELECT` across **every tenant's data**: all invoices and totals, all customer PII, `auth.users`, even `api_keys` hashes. Every trial user (`authenticated`) gets the same cross-tenant read. This one issue nullifies the entire multi-tenant isolation model.

**How an attacker exploits it** (grant evidence above is conclusive; a live anon-key call was intentionally not executed):

```
POST https://<ref>.supabase.co/rest/v1/rpc/_regression_test_query
apikey: <public anon key from the JS bundle>
Content-Type: application/json

{ "p_sql": "SELECT * FROM invoices" }        → every company's invoices
{ "p_sql": "SELECT email FROM auth.users" }  → every user's email
```

Writes are *mostly* constrained — the `SELECT (...) t` wrapper rejects top-level data-modifying CTEs, and the dangerous definer functions self-gate on `auth.uid()` — so this is primarily a **total confidentiality breach** rather than full RCE. For a financial ERP, "any stranger can read every customer's books and PII" is already catastrophic.

**Root cause.** The code does `REVOKE … FROM PUBLIC; GRANT … TO service_role`, but on the live DB the REVOKE never took effect: a fresh `CREATE FUNCTION` default-grants `EXECUTE` to `PUBLIC` (which includes `anon` + `authenticated`). It was almost certainly installed manually via the SQL editor without the accompanying revoke.

**Fix.** Apply the revoke in the "Do this first" box, then remove it from production entirely and only install it in a throwaway test DB (see H-4):

```sql
DROP FUNCTION IF EXISTS public._regression_test_query(text);
```

---

## 🟠 HIGH

### H-1 — Audit trail is editable and deletable by ordinary users

- **Location:** `supabase/migrations/20260430121600_phase0_17_rls_policies.sql:44` — verified live
- **OWASP:** A09 Security Logging & Monitoring Failures

**Evidence.** The *only* policy on `audit_logs` is:

```sql
CREATE POLICY tenant_isolation ON public.audit_logs
  FOR ALL USING (company_id = current_user_company_id());
```

`audit_logs` is **absent** from the phase-22b write-lockdown table list, and there is no immutability trigger. `FOR ALL` + a company predicate means any authenticated user can `UPDATE`/`DELETE` their own company's audit rows directly from the browser client:

```js
supabase.from('audit_logs').delete().eq('company_id', myCompany)   // succeeds
```

**Impact.** The audit trail — the record that is supposed to be tamper-proof — can be rewritten or wiped by any employee to cover fraud. Fails audit requirement §12 outright.

**Fix (new migration):**

```sql
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.audit_logs;

-- read: own company only
CREATE POLICY audit_read ON public.audit_logs
  FOR SELECT USING (company_id = current_user_company_id());

-- insert only via SECURITY DEFINER posting functions (definer bypasses RLS,
-- so they need no permissive policy); deny all client inserts:
CREATE POLICY audit_no_client_insert ON public.audit_logs
  FOR INSERT WITH CHECK (false);

-- NO update/delete policy at all → both denied for every non-service role.
```

### H-2 — Public API does not enforce the paid-tier gate at runtime

- **Location:** `supabase/functions/api/index.ts`, `authenticate()` — `company_has_api_access` is never called (grep-confirmed)

**Impact.** The plan gate exists only at *key-creation* time in the Settings page. Once a key exists, a tenant who **downgrades or cancels** keeps full API access forever — revenue leakage and access-control drift. No default key expiry either.

**Fix.** In `authenticate()`, after resolving the key, verify the company's subscription entitlement (join into the key lookup or a gate helper) and return `402`/`403` if not entitled. Cache the per-company result for ~60s to avoid a per-request query.

### H-3 — `xlsx` (SheetJS): HIGH proto-pollution + ReDoS, no fix available, parses user uploads

- **Location:** `package.json` → `xlsx`; used by `src/modules/settings/import-export/_io/`

**Impact.** The Import feature parses attacker-controlled `.xlsx` files. Prototype pollution via a crafted file can corrupt object prototypes → potential auth/logic bypass or DoS. `npm audit` reports it HIGH with **no upstream fix** on the npm distribution.

**Fix.** Migrate to the maintained SheetJS build from their own registry (the npm package is stale), or switch to `exceljs`. Parse uploads inside a Web Worker; validate and size-cap files before parsing.

### H-4 — No environment separation: tests (and the C-1 backdoor) run against the live production database

- **Location:** `.env.local` → `gzpkuaioibqrdppjdbwz`; husky pre-commit runs `test:regressions` against it

**Impact.** Dev, test, and prod are one database. Running tests against production is how C-1's arbitrary-SQL helper reached prod, and it's what let the posting-function drift go unnoticed earlier. This is the **process root cause** behind several findings.

**Fix.** Stand up a separate Supabase project for dev/test; point `.env.local` and CI at it; keep production migration-only.

---

## 🟡 MEDIUM

### M-1 — Missing key security headers (no CSP, HSTS, Permissions-Policy)

- **Location:** `vercel.json`

Present and correct: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`.
Missing: **Content-Security-Policy** (the compensating control against XSS→token theft, since the JWT lives in localStorage), **Strict-Transport-Security**, **Permissions-Policy**.

**Fix — add to the `/(.*)` header block:**

```json
{ "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
{ "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" },
{ "key": "Content-Security-Policy", "value": "default-src 'self'; connect-src 'self' https://*.supabase.co; img-src 'self' data: https://*.supabase.co; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'" }
```

Roll CSP out in report-only mode first — Vite inline styles may need tuning.

### M-2 — `ws` dependency: HIGH (uninitialized-memory disclosure + DoS), fix available

**Fix.** `npm audit fix` (non-breaking for `ws`).

### M-3 — Edge Function rate limiter is fail-open and racy

- **Location:** `supabase/functions/api/index.ts`, `rateLimited()`

`return (count ?? 0) >= LIMIT` → if the count query errors, `count` is null → treated as 0 → **unlimited**. The usage row is also inserted *after* the response, so a concurrent burst all reads a stale count and sails past 120/min. No global/per-IP ceiling.

**Fix.** Fail-closed on query error; use an atomic counter (a `SECURITY DEFINER` RPC doing upsert-and-return on a per-key/per-minute bucket) rather than counting a log table.

### M-4 — Order endpoint builds a PostgREST `.or()` filter by string interpolation

- **Location:** `supabase/functions/api/index.ts`, `createOrder()`

```
sku.in.(${skus.map(s => '"' + s.replace(/"/g, '') + '"')})
```

Only `"` is stripped; a sku containing `,` / `)` / `.` could perturb the OR group. It stays within company scope (the `.eq('company_id')` is ANDed), so it is contained, but it is an injection smell.

**Fix.** Filter products with a parameterized `.in('sku', skuArray)` call (separate from id lookups) instead of a hand-built `.or()` string.

### M-5 — Public buckets are world-readable and path-enumerable

- **Location:** verified live — `logos` (public), `products` (public), `attachments` (**private ✓**)

Public logos/product images are fine by design, but objects are readable by URL without RLS. Ensure nothing sensitive is ever written to those two buckets and that upload paths stay company-scoped (they are, per the storage RLS on write).

---

## 🔵 LOW / INFO

- **L-1** — CORS `Access-Control-Allow-Origin: *` on the API. Acceptable (bearer-auth, no cookies); consider an allow-list later.
- **L-2** — JWT/session in `localStorage` (Supabase default): XSS-exfiltration risk, mitigated by **zero `dangerouslySetInnerHTML`** (confirmed) and React escaping. CSP (M-1) is the real hardening.
- **L-3** — `POST /v1/orders` idempotency race: no unique index on `(company_id, reference)`. Add `CREATE UNIQUE INDEX … ON invoices (company_id, reference) WHERE reference IS NOT NULL` for hard idempotency.
- **L-4** — Broad `anon` EXECUTE on `SECURITY DEFINER` functions is the Supabase default. The ones spot-checked (`reset_company_data`, `create_api_key`) **do** self-gate correctly (auth.uid + same-company + admin + name confirmation). Fragile posture, though — one future function that forgets its internal `auth_require` inherits anon exposure. Adopt a default `REVOKE … FROM PUBLIC` convention on every new function.

---

## What is genuinely solid (calibration)

- ✅ **RLS enabled on all 124 public tables** (verified live); **no direct table grants to `anon`** (verified live) — the data layer itself is tight. C-1 is a *function*-grant hole, not an RLS hole.
- ✅ Tenant isolation via `current_user_company_id()` + restrictive RBAC read/write lockdown across posting tables.
- ✅ **No `dangerouslySetInnerHTML` anywhere**; bundle carries only the publishable key (no service key in `src/`); secrets gitignored, only `.env.example` tracked.
- ✅ API keys: 192-bit CSPRNG, **SHA-256 hashed at rest** (raw key never stored), revoke + expiry checks, indexed.
- ✅ Accounting integrity: double-entry with a deferred `je_must_balance` constraint trigger, negative-stock guard, voucher-date reversals, round-off discipline, MAC valuation — all locked by a **91-test live regression suite** gating every commit.

---

## Scores

| Dimension | Score | Note |
|---|---:|---|
| **Security** | **34 / 100** | Strong foundations, but a live anon-exploitable full-read breach (C-1) + mutable audit trail (H-1) cap it hard. Rises to ~75 once C-1 and H-1 are fixed. |
| **Production Readiness** | **42 / 100** | Blocked by C-1 and no env separation (H-4). Otherwise mature (headers mostly present, CI gate, migrations). |
| **Architecture** | **78 / 100** | Clean adapter pattern, RLS-first, real posting engine. Loses points for by-hand migration fragility and grant discipline. |
| **ERP Reliability** | **80 / 100** | Double-entry integrity + regression suite are excellent; recent drift shows the manual-migration process is the weak link. |
| **Scalability** | **70 / 100** | Indexes present, Edge Function fine; watch client-side aggregation (`getCurrentStockMap` `.limit(10000)`) and some N+1 in reports. |

---

## Blocking issues, in priority order

1. **C-1** — revoke/drop `_regression_test_query` from prod. *(minutes — do it now)*
2. **H-1** — make `audit_logs` append-only. *(one migration)*
3. **H-4** — separate the test DB from production. *(prevents recurrence of C-1)*
4. **H-2** — enforce `company_has_api_access()` in the API runtime.
5. **H-3 / M-2** — address `xlsx`, run `npm audit fix`.
6. **M-1** — add CSP + HSTS + Permissions-Policy.

---

*No code or database state was changed during this audit. The single probe script used was read-only and has been deleted.*
