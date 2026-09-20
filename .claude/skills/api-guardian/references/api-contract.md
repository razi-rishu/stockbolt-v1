### Public API contract — full reference

Read before changing or adding any endpoint. This documents what ships today so
that a change can be judged additive (safe) or breaking (needs `/v2`).

Implementation: `supabase/functions/api/index.ts`, deployed with
`npx supabase functions deploy api --no-verify-jwt` (the JWT check is off
because callers authenticate with our own key, not a Supabase session).

## Conventions

- **Base:** `/functions/v1/api/v1/...` — the function name (`api`) then the API
  version (`v1`) in the path.
- **Auth:** `Authorization: Bearer sk_live_<hex>`. Hashed (SHA-256) and looked
  up in `api_keys`. Failure at any point → `401` with the error envelope.
- **Content type:** JSON in, JSON out.
- **Success:** `{ "data": ... }`, plus `"pagination"` on list endpoints.
- **Error:** `{ "error": { "code": "<slug>", "message": "<human>" } }`.
- **Pagination:** `?limit` (default 50, max 200) and `?offset`; response
  `pagination: { limit, offset, has_more }`. `has_more` is computed by asking
  for one row beyond the page.
- **Rate limit:** 120 requests/min per key (best-effort — see security-guardian).
- **Every request** is logged to `api_request_log`; `api_keys.last_used_at` is
  updated.

## Status codes in use

| Code | Meaning here |
|---|---|
| 200 | OK (reads, PATCH, dedup hit on orders) |
| 201 | Created (POST contacts, POST orders new) |
| 400 | Bad request — validation, unknown field, malformed id |
| 401 | Missing/invalid/revoked/expired key |
| 403 | Key lacks the required scope |
| 404 | Not found, or another tenant's resource (indistinguishable by design) |
| 405 | Method not allowed on that path |
| 409 | Conflict (duplicate contact email) — carries `existing_id` |
| 429 | Rate limited |
| 500 | Internal — generic message only, never a stack trace |
| 501 | Not implemented (reserved) |

Note `404` is deliberately returned for both "does not exist" and "exists but
belongs to another company" — never reveal that an id exists in a tenant the
caller cannot see.

## Scopes

- `read` — all GET endpoints.
- `write:contacts` — POST/PATCH contacts.
- `write:orders` — POST orders.

A key carries an array of scopes; missing the required one → `403`.

## Endpoints

### GET /v1/me
Key/identity check. Returns top-level (not wrapped — the one exception):
```json
{ "company": "Al Noor", "currency": "AED", "scopes": ["read","write:orders"], "version": "v1" }
```

### GET /v1/products
Query: `search` (sku/name/oe_number, ilike, wildcard-escaped), `active`
(`true`/`false`), `include=stock` (adds `stock_qty` via the service-role-only
`api_current_stock` aggregate). Allow-listed fields: id, sku, barcode, name,
description, oe_number, brand, category, selling_price, tax_category, is_active,
timestamps, and `stock_qty` when requested. **Not** returned: cost.

### GET /v1/contacts
Query: `type` (`customer`/`supplier` → matches that plus `both`), `search`
(name/email/phone). Allow-listed contact fields; no internal ids beyond the
contact's own.

### GET /v1/invoices  and  GET /v1/invoices/:id
List query: `status` (`draft`/`confirmed`/`void`), `from`, `to` (ISO dates).
List returns headers with the customer embedded; detail adds line items. Line
items expose sku, name, description, quantity, unit_price, discount, tax,
line_total — **never `cost_at_sale`**. `:id` must be a UUID (else `400`); a
missing or cross-tenant id is `404`.

### POST /v1/contacts   (scope write:contacts)
Create a customer/supplier. Strict allow-list of writable fields; an unknown key
is `400` listing it. `name` required; `type` defaults to `customer`; `currency`
defaults to the company base. Duplicate email (same company, case-insensitive) →
`409` with `existing_id`. Deliberately **not** writable: `credit_limit`, price
levels, `code`, `company_id`. Returns `201` `{ data: <contact> }`.

### PATCH /v1/contacts/:id   (scope write:contacts)
Update allow-listed fields (same set minus `currency`, which is create-only —
changing it under existing documents is unsafe). Empty body or no writable
fields → `400`. Email collision with another contact → `409`.

### POST /v1/orders   (scope write:orders)
The order-intake endpoint. Body:
```json
{
  "external_ref": "SHOP-1001",
  "customer": { "email": "a@b.com", "name": "Ali", "phone": "050..." },
  "items": [ { "sku": "BP-001", "quantity": 2 }, { "product_id": "uuid", "quantity": 1 } ],
  "notes": "optional"
}
```
Behaviour:
- `external_ref` **required** — the idempotency key, matched against
  `invoices.reference`. A repeat returns the existing invoice with
  `deduplicated: true` (status 200), never a second document.
- `customer` — either `{ id }` (must be an existing, active, non-supplier
  contact in this company) or `{ email }` (matched; created with `name` if new).
- `items` — 1–100 lines, each with `product_id` or `sku`, and a positive
  `quantity`. Products resolved within the company.
- **Prices and tax are recomputed from the catalog** (selling_price +
  tax_category → standard rate by country). Caller prices are ignored.
- Creates a **draft** invoice with an official `INV-...` number, today's date,
  due date from the customer's payment terms. No GL, no stock, no VAT until a
  human confirms it in-app.
- If line insert fails after the header, the draft header is deleted (manual
  rollback — PostgREST has no cross-call transaction).

Returns `201` with `invoice_id`, `invoice_number`, `status: "draft"`,
`external_ref`, customer, totals, items, `deduplicated: false`, and a `note`
reminding that it must be confirmed in-app.

## Adding an endpoint — worked pattern

Say the ask is `GET /v1/invoices/:id/payments`. Keep it consistent:

1. **Method + scope.** GET → `read` scope. Gate before doing any work.
2. **Route.** Add the match in `route()`; validate the `:id` is a UUID (`400`
   otherwise).
3. **Scope query to the company.** `.eq('company_id', key.company_id)` on every
   table touched — the function is service-role, nothing else scopes it.
4. **Bound it.** Paginate or aggregate; never an unbounded `.select()`.
5. **Allow-list the response.** Map explicit fields; do not spread a row. Ask
   for each field: would an integrator, or a competitor, be entitled to see it?
   Exclude cost/margin/internal ids.
6. **Envelope.** `{ data, pagination }` for a list, `{ data }` for one, the
   error envelope for failures. No stack traces.
7. **404 for cross-tenant.** A resource in another company reads as absent.
8. **Verify like an integrator:** no key → 401, wrong scope → 403, happy path,
   another tenant's id → 404.
9. **It is additive** — a brand-new path breaks no existing consumer, so it does
   not need `/v2`. Changing an *existing* endpoint's output does.

## What counts as breaking (→ needs /v2, not an edit to /v1)

- Renaming or removing a response field.
- Changing a field's type or format (string→number, date format).
- Changing a status code for an existing condition.
- Making an optional request field required, or tightening validation so
  previously-accepted input now `400`s.
- Changing pagination defaults or the envelope shape.

Additive and safe: a new endpoint, a new **optional** query parameter, a new
field **added** to a response (consumers ignore unknown fields), a new optional
request field with a backward-compatible default.

When unsure whether a change is breaking, imagine the dumbest possible
consumer — one that does `response.data[0].sku` and hard-codes every field name.
If that consumer would break, it is breaking.
