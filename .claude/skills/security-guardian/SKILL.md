---
name: security-guardian
description: The security posture of StockBolt ERP — its real defenses, its currently-OPEN vulnerabilities, and how to verify tenant isolation, authentication, authorization, secrets, the public API, and audit-log integrity before shipping. Use this skill for ANY security-relevant work: authentication and sessions, RLS and permissions, API keys and the public API, secrets and environment config, SQL injection, XSS, security headers, rate limiting, audit-log tampering, dependency CVEs, or reviewing whether a change is safe to expose. Also use it whenever a change touches auth, permissions, the database security model, the API, or anything a customer's data confidentiality depends on — even if security isn't the stated goal, because the most dangerous holes here are silent and cross-tenant.
---

# Security guardian — StockBolt's real security posture

For the mechanics of writing policies, RPCs and grants safely, use
`database-guardian`. For change-control process and the trap catalogue, use
`erp-guardian`. This skill owns the **security posture**: what actually
protects customer data, what does not yet, and how to prove isolation holds.

## Start here every time: the open findings

A full security audit (`docs/SECURITY_AUDIT_2026-07-19.md`) is the canonical
record. Several of its findings are **still open on the live database** — I
verified this. Before doing security work, know which holes exist right now, so
you neither rely on a defense that isn't there nor waste effort re-discovering
what is already documented.

`references/open-findings.md` is a live register with a verification query for
each item. **Re-run those queries rather than trusting this document's dates** —
the whole point of the register is that "we fixed that" is a claim to verify,
not assume. Two are severe and, as of last check, unresolved:

- **Arbitrary-SQL RPC callable by `anon`** — a `SECURITY DEFINER` function that
  runs arbitrary SQL is granted to `anon`, whose key ships in the browser
  bundle. This is a total cross-tenant data-read compromise, exploitable by
  anyone on the internet with no credentials. It is the single most urgent
  thing in the codebase.
- **Audit logs are user-mutable** — `audit_logs` has one `FOR ALL` policy, so
  any authenticated user can rewrite or delete their own company's audit trail.

If a task lets you fix either as a side effect, do it or flag it loudly. Never
build a new feature on top of an assumption that these are closed.

## The security model, honestly

**What genuinely protects the app:**

- **RLS on every table** (all 124, verified) with tenant isolation via
  `current_user_company_id()`, plus restrictive RBAC read/write lockdown on
  posting tables. The *table* layer is solid — the live holes are at the
  function-grant and policy-verb layer, not the table layer.
- **Auth is Supabase Auth + Google OAuth.** No custom auth, no password
  storage — correct, and never change it. Sessions are JWTs with refresh.
- **API keys are hash-only.** The raw `sk_live_…` is shown once; only its
  SHA-256 is stored. 192-bit CSPRNG entropy. Revocable.
- **The frontend bundle carries only the publishable (anon) key.** The service
  key exists only in Vercel env and `.env.local`, never in `src/`.
- **No `dangerouslySetInnerHTML` anywhere.** React's escaping is the XSS
  defense, and it is not being bypassed.

**What is weaker than it looks — do not assume these:**

- **Audit-log immutability** — claimed, not true yet (open finding).
- **Paid-tier API gate** — enforced at key *creation*, not at *runtime*; a
  cancelled tenant's keys keep working.
- **Rate limiting** — the API limiter is fail-open (errors → no limit) and
  racy; treat it as best-effort, not a control you can rely on.
- **Security headers** — `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy` are set; **CSP, HSTS and Permissions-Policy are missing.**
  So there is no compensating control if an XSS ever does land.
- **Backups / DR** — no verified restore, no documented RPO/RTO.
- **API key rotation** — not built. "Rotate" means revoke-and-create; there is
  no in-place rotation, so don't promise one.

## How to think: the attacker's two easy wins

For a multi-tenant financial SaaS, almost every real attack is one of two
shapes. Hold both in mind for every change.

**1. Cross-tenant read.** Can a user of company A see company B's data? This is
the catastrophic one, and it is why every query — in the app, in an RPC, and
especially in an Edge Function — must be scoped to the caller's company. In
service-role code (Edge Functions), **RLS is off**, so the scope must be an
explicit `.eq('company_id', …)` you wrote. A missing filter there is not a bug,
it is a breach. The open anon-SQL finding is exactly this shape at its worst.

**2. Privilege escalation.** Can a user do something their role forbids? RBAC
gates this via `has_perm`, but a `SECURITY DEFINER` function bypasses RLS by
design, so it must re-check identity and permission *itself* — the database is
not doing it for you inside a definer function.

If a change can be reasoned about as "does this let A read B" or "does this let
a low-privilege user act as a high-privilege one", you are looking at it the
right way.

## Non-negotiables, with the why

**Tenant scope on every data path.** App queries get it from RLS; Edge Function
queries must carry it explicitly. *Why:* service-role code has no safety net,
and one omitted filter exposes every tenant.

**Never expose arbitrary SQL.** A function that executes a caller-supplied
string is a full compromise primitive. One reached production and is the open
P0. Never write another; never grant one to `anon`/`authenticated`.

**State every function's grants.** A new function default-grants EXECUTE to
`PUBLIC` (which includes `anon`). Always `REVOKE ALL … FROM PUBLIC, anon,
authenticated` then grant the one role that should call it. Verify live.

**Secrets stay server-side.** The service key lives in Vercel env and
`.env.local` only. Never reference it from `src/`, never log it, never return
it. Probe scripts read `.env.local` and are deleted after use.

**Validate at the boundary, in the RPC — not the form.** Frontend validation is
a courtesy to the user; the database function is the guarantee. Check
authentication, company membership, permission, and input shape inside the RPC,
because the RPC is reachable directly via the API regardless of what the UI
allows.

**Never trust an id.** An id from a request is a guess away from another
tenant's row. Every lookup confirms the row belongs to the caller's company;
never `WHERE id = :id` alone on tenant data.

**Audit logs are append-only.** They must reject UPDATE and DELETE for ordinary
users (currently they don't — open finding). The whole value of an audit trail
is that the person who did the thing cannot erase the evidence.

**Output allow-lists, not block-lists.** API responses return an explicit set
of fields, so internal data (`cost_at_sale`, `company_id`, hashes, stack
traces) cannot leak by default. Adding a field is a deliberate act.

## What is NOT the threat here (so you don't waste effort)

**Classic CSRF is largely not applicable.** The app authenticates with a JWT in
the `Authorization` header (from localStorage), not a cookie session. CSRF
relies on the browser auto-attaching a cookie; a header token is not
auto-attached, so cross-site requests cannot ride the user's session. The
real risk in this design is the mirror image: **XSS → token theft**, because a
script on the page *can* read localStorage. That is why the absence of CSP
(open finding) matters and why the no-`dangerouslySetInnerHTML` discipline is
load-bearing. Spend effort there, not on CSRF tokens.

**Password security is Supabase's job.** No passwords are stored here. Don't add
custom auth, password rules, or reset flows — Supabase Auth owns all of it.

## Verifying — think like the attacker, with the service key

Security verification is not "does it work for me" — it is "does it fail for
someone it should fail for". `references/threat-model.md` has the read-only
probes: cross-tenant read attempts, anon-callable function enumeration, grant
audits, RLS coverage, secret-leak scans, and the header check. Run them through
the regression helper RPC and delete the probe after.

The highest-value checks, always:

- **Enumerate what `anon` and `authenticated` can EXECUTE.** Any `SECURITY
  DEFINER` function there that doesn't self-gate is a hole. This is how the P0
  is found and how you confirm a new function didn't reopen it.
- **Confirm RLS is enabled on any new table** (`pg_class.relrowsecurity`) — a
  table without it is cross-tenant readable.
- **Grep `src/` for the service key** — it must never appear.

A green regression suite is not a security pass: the suite is structural and
does not attempt an attack. Confidentiality has to be probed deliberately.

## When to stop and ask

- A change would grant `anon` or `authenticated` EXECUTE on a definer function.
- Anything would move a secret toward the client, a log, or a response.
- A new table or endpoint would ship without tenant scoping.
- A change touches auth, session handling, or the RBAC gates.
- You find a cross-tenant path — stop and surface it; do not quietly patch and
  move on, because there are usually siblings.

## Reporting security work

```
Threat analysis   — which of the two attacker wins this touches (cross-tenant read / privesc), or neither and why
Risk level        — Critical / High / Medium / Low
Attack surface    — who can reach this: anon, authenticated, one tenant, service-role only
Controls          — what enforces the boundary (RLS? explicit scope? grant? validation?)
Verification      — the attack you attempted and that it failed; actual query output
Open-finding link — does this touch or resolve anything in open-findings.md?
Rollback          — how to undo if it turns out to widen access
```

Be concrete about attack surface. "Callable by anon" and "service-role only"
are different universes of risk, and naming which one tells the reader exactly
how much to worry.

## References

- **`references/open-findings.md`** — live register of known vulnerabilities
  with a verification query and fix for each. Read first, and re-run the
  queries rather than trusting the status column.
- **`references/threat-model.md`** — attacker's-eye verification probes
  (cross-tenant, grants, RLS coverage, secrets, headers) and the corrected
  threat surface. Read when verifying or reviewing exposure.
