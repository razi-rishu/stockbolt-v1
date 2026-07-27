# StockBolt — AC-4A: E-invoice / tax classification metadata — Specification

**Created:** 2026-07-24 · Spec only (no implementation). The shared metadata foundation for e-invoicing (AC-4) **and** AC-3 full-fidelity. Additive migration (hand-applied); **no posting-logic change**.

---

## 0. What already exists (reuse — do NOT re-add)
Grepped from the live schema:
- **`products.hsn_code`** (nullable) — HSN/SAC already modelled ✓ (needs *population* + validation, not a new column).
- **`products.tax_category`** + **`invoice_items.tax_category`** (text, currently only `'standard'`).
- **`contacts.tax_id`** — GSTIN/TRN ✓ · **`contacts.address_state`** — state as free text (human name).
- **`units_of_measure.code`** — a UoM code ✓ · `products.unit_id` links the line to it.

## 1. Posting-safety gate (must verify FIRST, at build time)
Before adding/looking at treatment columns: confirm — from the **live** `pg_get_functiondef` — that `confirm_invoice` / `edit_invoice` derive tax **only** from `tax_rate` / `tax_amount` and do **not** branch on `tax_category`. If true (expected), the new metadata is inert to posting and integrity is preserved by construction. If any posting RPC reads `tax_category`, we add a *new* column instead of touching it (which is the plan anyway). **This check is a hard prerequisite.**

## 2. New columns (migration `phase58`, additive + idempotent, hand-applied)
Deliberately **new** columns (not overloading `tax_category`, which posting/legacy data may rely on):

| Table | Column | Type / values | Purpose |
|---|---|---|---|
| `invoice_items` | `tax_treatment` | text CHECK (`standard`,`zero_rated`,`exempt`,`reverse_charge`,`export`,`out_of_scope`) **default `standard`** | the line's supply treatment (VAT201 boxes / GSTR classification / e-invoice) |
| `products` | `default_tax_treatment` | text (same set) nullable | pre-fills the invoice line; blank ⇒ `standard` |
| `contacts` | `place_of_supply_code` | text nullable | India GST 2-digit **state code** (distinct from `address_state` name) |
| `contacts` | `buyer_type` | text CHECK (`registered`,`unregistered`,`export`,`sez`,`composition`) **default `registered`** | B2B/B2C/export classification |
| `invoices` | `is_export` | boolean default `false` | export/zero-rated supply marker (header) |
| `invoices` | `place_of_supply_code` | text nullable | destination state / import-export marker (header) |

All nullable/defaulted → backfills cleanly; **no existing row changes behaviour**, no posting RPC touched.

## 3. Adapter types
Extend the `Product`/`Contact`/`Invoice`/`InvoiceItem` insert/update types + add the two enums (`TaxTreatment`, `BuyerType`) and a GST **state-code list** constant. Types-only; no method behaviour change.

## 4. Entry-UI fields (non-blocking)
- **Product editor:** surface `hsn_code` (exists) + `default_tax_treatment`.
- **Contact editor:** `buyer_type` + `place_of_supply_code` (dropdown of the 36/37 GST state codes; shown for India tenants).
- **Invoice editor:** per-line `tax_treatment` (defaulting from the product); header `is_export` + `place_of_supply`.
- **Validation = warn, never block.** An "e-invoice readiness" hint lists missing required fields (HSN, place-of-supply, buyer GSTIN) so existing invoicing is never interrupted.

## 5. Pure helpers + unit tests (`tests/unit/einvoice-metadata.test.ts`)
- `GST_STATE_CODES` list + `isValidStateCode()`.
- `suggestBuyerType(contact)` (registered if `tax_id` present, else unregistered; export/sez explicit).
- `TAX_TREATMENTS` enum guard + `resolveLineTreatment(product, invoice)` (product default → line, export header ⇒ `export`).
- `eInvoiceReadiness(invoice, contact, products)` → the list of missing fields (drives the UI hint; reused by AC-4B/AC-4D). All pure, DB-free.

## 6. Reuse / integrity / regression / rollback
- **Reuse:** hsn_code, tax_id, address_state, units.code, the product/contact/invoice editors, i18n.
- **Integrity:** metadata-only; posting engine untouched (per §1). E-invoicing/AC-3 read these; nothing writes GL.
- **Regression:** unit tests (§5) + a soft-until-applied structural tripwire that the columns/CHECKs exist; a read-only invariant (warn) that every `tax_treatment` is in the allowed set. No behavioural DB test needed (no RPC).
- **Rollback:** `ALTER TABLE … DROP COLUMN` the six additions; revert types + UI + tests. No data/posting to undo.

## Open questions (small)
1. **UoM code:** reuse `units_of_measure.code` as the e-invoice UoM (assume it holds a usable code) *(recommended)* vs add a dedicated `uom_gst_code`? — defer to AC-4B once we see the formatter's needs.
2. **Where India-only fields show:** gate `place_of_supply_code`/`buyer_type` behind `country_code === 'IN'` *(recommended)* vs always show.

_Awaiting approval to implement AC-4A. The §1 posting-safety check is the first action on approval; if it surprises us, I'll stop and report before any migration._
