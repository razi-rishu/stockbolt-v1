---
name: api-guardian
description: The public REST API contract for StockBolt ERP — its real response envelope, versioning and backward-compatibility rules, idempotency model, the draft-invoice intake design, and how to add an endpoint without breaking integrators. Use this skill for ANY work on the public API: the `supabase/functions/api` Edge Function, `/v1/...` endpoints, request/response shapes, API keys and scopes, pagination, rate limiting, webhooks, OpenAPI/docs, or anything a third-party integration consumes. Also use it when a change might alter an existing response shape, add or remove a field, or touch how external systems push orders or pull data — even if the API isn't the stated target, because a live integration silently breaks the moment its contract shifts.
---

# API guardian — the public REST API contract

This skill governs **the public REST API** — the customer-facing surface built
as the `supabase/functions/api` Edge Function, which external stores and
software call to push and pull data. Security of that surface (auth, key
hashing, tenant scoping, the open paid-gate finding, rate-limiter honesty) lives
in `security-guardian`; the accounting/inventory rules a write must respect live
in `accounting-engine` and `inventory-engine`; SQL and query bounds live in
`database-guardian`. This skill owns the **contract**.

Do not confuse this with the internal **adapter** (`src/data/adapter.ts` /
`supabaseAdapter.ts`) — that is the app's own TypeScript data layer, a different
thing with a different audience. When someone says "the API" and means external
integration, this is it.

## Why the contract is sacred

An internal function has one caller you control. A public API has callers you
**cannot see and cannot update** — a customer's website, a warehouse scanner
app, a script someone wrote once and forgot. The moment a response shape
changes, every one of those breaks silently, at their side, with no error on
yours. You find out through a support ticket days later, after orders have
already failed to import.

So the governing instinct is different from ordinary code: **additive only.** A
new optional field or a new endpoint is safe. Renaming a field, removing one,
changing its type, tightening validation, or changing a status code is a
breaking change even when it looks like an improvement — because somewhere a
parser depends on exactly what is there today.

## The actual contract (as built)

Know the real shapes before changing them. This is what ships today.

**Base:** `https://<project-ref>.supabase.co/functions/v1/api/v1/...`
**Auth:** `Authorization: Bearer sk_live_...` — the raw key, hashed to look up
`api_keys`. No key, bad key, revoked, or expired → `401`.
**Methods:** `GET`, `POST`, `PATCH` only. Anything else → `405`.

**Endpoints:**
| Method | Path | Scope | Returns |
|---|---|---|---|
| GET | `/v1/me` | read | key check: company, currency, scopes |
| GET | `/v1/products` | read | catalog; `?search ?active ?include=stock` |
| GET | `/v1/contacts` | read | `?type ?search` |
| GET | `/v1/invoices` | read | `?status ?from ?to` |
| GET | `/v1/invoices/:id` | read | header + line items |
| POST | `/v1/contacts` | write:contacts | create; `201` |
| PATCH | `/v1/contacts/:id` | write:contacts | update |
| POST | `/v1/orders` | write:orders | **draft** invoice; `201` |

**Success envelope** — a `data` key, plus `pagination` on lists:
```json
{ "data": [ ... ], "pagination": { "limit": 50, "offset": 0, "has_more": true } }
```
Single resource: `{ "data": { ... } }`.
(`/v1/me` is the one exception — it returns fields at the top level. Leave it;
don't "fix" it into a wrapper, because a consumer may already read it flat.)

**Error envelope** — always this shape, never a stack trace or SQL:
```json
{ "error": { "code": "not_found", "message": "Invoice not found." } }
```
A `409` conflict additionally carries `existing_id` so the caller can recover.

There is **no `success: true/false` boolean.** If a draft you are given uses
one, it does not match this API — presence of `data` means success, presence of
`error` means failure.

## The design decisions that must not be quietly undone

**The API exposes no posting.** There is no "confirm invoice", "post payment",
or "adjust stock" endpoint, and that is deliberate. External input is untrusted;
letting it post directly to the ledger would let a buggy or compromised store
write a customer's books. Instead, `POST /v1/orders` creates a **draft invoice**
that a human reviews and confirms inside StockBolt. If asked to "let the API
confirm orders automatically", treat it as a real decision with a real risk, not
a convenience — surface it, don't just build it.

**Prices come from StockBolt, never the caller.** `POST /v1/orders` ignores any
price the caller sends and recomputes line prices and tax from the product
catalog. This is anti-tamper: the store cannot underprice by sending its own
numbers. Never add a path that trusts caller-supplied money.

**Idempotency is by the caller's own reference.** `POST /v1/orders` requires
`external_ref` (the store's order id). A repeat with the same ref returns the
existing invoice with `deduplicated: true` rather than creating a second one, so
a network retry cannot double-import an order. Note the current limitation:
there is no unique index on `(company_id, reference)`, so two *simultaneous*
first-time requests can still race. If you harden idempotency, add that index.
Any new create endpoint should follow the same external-ref pattern.

**Responses are allow-listed, not filtered.** Each endpoint returns an explicit
set of fields. Internal and margin data — `cost_at_sale`, `company_id`, key
hashes — are never in the list, so they cannot leak by forgetting to strip them.
Adding a field to a response is a deliberate act; do it by extending the
allow-list, never by returning a row wholesale.

## Non-negotiables, with the why

**Version in the path; never break `/v1`.** Breaking changes go to a new
`/v2`, leaving `/v1` intact for existing integrations. *Why:* you cannot deploy
a fix to the caller's code, so the old contract must keep working until they
migrate on their own schedule.

**Every query is tenant-scoped and bounded.** The Edge Function runs as
`service_role` and bypasses RLS, so every query carries its own
`.eq('company_id', key.company_id)`, and lists cap their size. A missing scope
is a cross-tenant breach (see `security-guardian`); an unbounded list silently
truncates (see `database-guardian`).

**Validate strictly and reject clearly.** Unknown fields on a write are a `400`
naming them, not a silent ignore — an integrator debugging why their data didn't
save is helped enormously by "unknown field: phon" and abandoned by silence.
Check types, lengths, ranges, and enum membership at the boundary.

**Writes respect the engines.** A write endpoint goes through the same posting,
costing and validation paths as the app — never a shortcut that touches the GL,
MAC, or stock ledger directly. The API is a doorway to the engines, not around
them.

**Scope every endpoint.** Reads need `read`; each write needs its specific
scope (`write:contacts`, `write:orders`). A key without the scope gets `403`.
New endpoints declare their scope explicitly.

## Not built yet — don't imply otherwise

- **No published docs or OpenAPI spec.** Integrators have no reference. If a
  task is "document the API", that is real net-new work.
- **No webhooks.** The API is pull + push-draft only; nothing calls out to the
  customer. If webhooks are built, they need signing, retries, delivery logging,
  and duplicate-suppression on the receiver side.
- **No sandbox environment.** There is one live surface. Integrators test
  against production data, which is a reason to be extra careful with writes.
- **Runtime paid-gate is not enforced** (security-guardian SEC-3) and the **rate
  limiter is best-effort** (fail-open, racy). Don't describe either as a
  dependable control.
- **No key rotation** — only create/revoke. "Rotate" means revoke + create.

## When to stop and ask

- A change would alter an existing response shape, rename or remove a field, or
  change a status code — that is breaking; confirm the `/v2` path instead.
- A request asks the API to confirm/post rather than draft.
- A write would trust caller-supplied prices, or bypass a posting engine.
- A new endpoint would return a whole row instead of an allow-listed subset.
- The task assumes webhooks, docs, or a sandbox that do not exist.

## Reporting API work

```
Contract impact    — new endpoint / new optional field (safe) OR shape change (breaking)
Consumers affected — who calls this; can they be updated (no — they're external)
Breaking?          — yes/no, and if yes why /v2 rather than editing /v1
Security           — auth, scope, tenant scoping, allow-list (link security-guardian)
Idempotency        — for writes: how a retry is made safe
Verification       — the requests you made and the actual responses (401 wall + happy path + a negative)
Rollback           — redeploy prior function; note the Edge Function is a single file
Confidence         — high/medium/low and what would raise it
```

Verify like an integrator, not like the author: exercise the auth wall (no key →
401), the happy path, and at least one negative (wrong scope → 403, unknown
field → 400, other tenant's id → 404). A green happy path alone hides exactly
the failures an external caller will hit first.

## References

- **`references/api-contract.md`** — the full per-endpoint contract: parameters,
  response fields, status codes, the order-intake flow, and a worked example of
  adding an endpoint consistent with the existing ones. Read before changing or
  adding any endpoint.
