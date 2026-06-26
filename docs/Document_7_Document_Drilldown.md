# Document 7 — Document Drill-Down System — Architecture Plan

> Status: **DESIGN — not yet built.** End-to-end architecture for traceable drill-down across the
> whole ERP, to be built in approved milestones (D1–D6). No code ships from this doc alone.
> Last updated: 2026-06-25.

---

## 0. Objective & principles
Every figure on every report should trace back to the document that created it — the SAP B1 /
Dynamics / Odoo experience. Click `JE-1100` → the journal entry; click `INV-1000` → the invoice;
click a customer / supplier / product → its profile.

**Principles**
1. **One reusable primitive, applied everywhere** — a single `<DocLink>` + a central route registry.
   No per-page link logic, no duplicated mapping.
2. **Reuse existing routes; zero new destination pages** — every target already exists (§2).
3. **The data must carry IDs** — reports show *numbers* today (`INV-1000`) but not the document
   **UUID**. The real work is threading `*_id` columns through each report's adapter/RPC (§4).
4. **RLS-aware** — a link the user isn't permitted to open renders as plain text, never a dead link
   (req 13). Routes are already permission-guarded as the server-side backstop.
5. **Deleted / reversed safe** — the link is preserved; status is shown; the destination degrades
   gracefully (req 12).
6. **Additive & backward-compatible** — display-layer only; no posting/accounting change.

---

## 1. The three new shared pieces

### 1a. `src/lib/doc-links.ts` — the registry (single source of truth)
```ts
type DocType =
  | 'journal_entry' | 'invoice' | 'vendor_bill' | 'customer_payment' | 'vendor_payment'
  | 'quote' | 'credit_note' | 'debit_note' | 'sales_return' | 'purchase_order'
  | 'goods_receipt' | 'expense' | 'stock_transfer' | 'inventory_adjustment'
  | 'bank_transfer' | 'payroll_run' | 'customer' | 'supplier' | 'product';

interface DocMeta { route: (id: string) => string; label: string; perm: string; }

const DOC_REGISTRY: Record<DocType, DocMeta>;        // canonical → route + label + read-perm
function normalizeDocType(raw: string): DocType|null; // alias map (see §3)
function resolveDocRoute(type: string, id: string): string | null;
```

### 1b. `src/ui/doc-link.tsx` — `<DocLink>`
```tsx
<DocLink type="invoice" id={row.source_id} label={row.source_number}
         status={row.reversed ? 'reversed' : 'active'} />
```
- Resolves the route via the registry. Renders a brand-coloured link.
- `status='reversed'|'deleted'` → still links, adds a small muted badge (req 12).
- No `id`, unknown type, or **caller lacks `perm`** (via `usePermissions`) → renders plain label,
  no link (req 13).
- Optional `chip` prop to keep the existing coloured source chip (GL `SourceCell` look).

### 1c. `src/ui/breadcrumbs.tsx` — `<Breadcrumbs>`
`Reports › General Ledger › JE-1100`. Placed at the top of every **destination** editor/detail page
(req 11). Back-navigates via the registry + the browser history.

---

## 2. Route registry (all targets already exist — verified in `App.tsx`)
| Canonical type | Route |
|---|---|
| journal_entry | `/accounting/journal-entries/:id` |
| invoice | `/sales/invoices/:id` |
| quote | `/sales/quotes/:id` |
| customer_payment | `/sales/payments/:id` |
| credit_note | `/sales/credit-notes/:id` |
| sales_return | `/sales/returns/:id` |
| vendor_bill | `/purchasing/bills/:id` |
| vendor_payment | `/purchasing/payments/:id` |
| purchase_order | `/purchasing/orders/:id` |
| goods_receipt | `/purchasing/grns/:id` |
| expense | `/purchasing/expenses/:id` |
| debit_note | `/purchasing/debit-notes/:id` |
| stock_transfer | `/inventory/transfers/:id` |
| inventory_adjustment | `/inventory/adjustments/:id` |
| bank_transfer | `/banking/transfers/:id` |
| payroll_run | `/payroll/runs/:id` |
| customer | `/contacts/customers/:id` |
| supplier | `/contacts/suppliers/:id` |
| product | `/products/:id` |

JE-only sources (`inventory_cogs`, `opening_balance`) have **no separate document** → the link
target is the **journal entry** itself.

---

## 3. Vocabulary normalization (the same concept has different strings)
The doc-type string differs by table, so the registry needs an alias map:
| Raw value (where it appears) | Canonical |
|---|---|
| `sales_invoice` (journal_entries.source_type), `invoice` (general_ledger/stock_ledger.related_doc_type) | `invoice` |
| `customer_payment`, `payment` | `customer_payment` |
| `vendor_payment` | `vendor_payment` |
| `goods_receipt`, `grn` | `goods_receipt` |
| `inventory_cogs`, `opening_balance`, `manual` | → link to the **journal_entry** |
`normalizeDocType()` owns this map; the GL `SourceCell` already encodes most of these labels and is
folded into `<DocLink>`.

---

## 4. The core work — threading IDs through each surface
Each report's adapter query must **also select the target UUIDs** (they exist in the tables —
`general_ledger.related_doc_id` / `journal_entry_id`, `stock_ledger.related_doc_id` / `product_id`,
`contacts.id`, etc.) and add them to the row type. Representative per-surface plan:

| # | Surface | Clickable | IDs the query must add | Destination |
|---|---|---|---|---|
| 1 | **General Ledger** | `entry_number`, source chip | `journal_entry_id`, `source_id` (=related_doc_id) | JE / source doc |
| 2 | **Trial Balance** | account rows *(already drill to GL, Phase 12.18)* | — (account code present) | GL filtered |
| 3 | **Profit & Loss** | account lines | account code (present) | GL by account+period |
| 4 | **Balance Sheet** | control-account rows *(clickable since Phase 18)* | account code | GL |
| 5 | **Cash Flow** | line items | account code | GL by account |
| 6 | **Customer Statement** | each row (invoice/receipt/CN) | `doc_type` + `doc_id` per row | source doc |
| 7 | **Supplier Statement** | each row (bill/payment/DN) | `doc_type` + `doc_id` | source doc |
| 8 | **AR Aging** | customer name (+ invoice list) | `contact_id` (+ invoice_id) | customer / invoice |
| 9 | **AP Aging** | supplier name | `contact_id` | supplier |
| 10 | **Stock Ledger** | product, reference | `product_id`, `related_doc_id`+`related_doc_type` | product / source doc |
| 11 | **Stock Movement** | product, reference | same as Stock Ledger | product / source doc |
| 12 | **Inventory Valuation** | product | `product_id` | product detail |
| 13 | **Dashboard widgets** | top-expenses / recent docs / banks | ids per widget RPC | source docs |
| 14 | **Audit Logs** | entity reference | `entity_type` + `entity_id` *(already stored)* | source doc |

> Reports 2–5 mostly drill **by account code into the GL** (already partly done) — light work.
> Reports 6, 7, 10, 11, 14 are the heavier ones (per-row doc ids).

---

## 5. Breadcrumbs (req 11) — destination pages
Add `<Breadcrumbs>` to the top of the ~18 editor/detail pages that are drill-down targets: invoice,
quote, customer payment, vendor bill, vendor payment, PO, GRN, expense, credit note, debit note,
sales return, **journal-entry editor**, customer detail, supplier detail, product detail, stock
transfer, inventory adjustment, bank transfer, payroll run. Pattern: a small component above the
existing `PageHeader`, fed `[{label,to}]` from where the user came (referrer via `location.state` or
a sensible default like "Reports › General Ledger").

---

## 6. Deleted / reversed handling (req 12)
- **Reversed** (JE/document voided or edited): data already exposes `reversed_by_id` /
  `reversal_of_id` (GL) — `<DocLink status="reversed">` adds a muted "reversed" badge but keeps the
  link, so the audit trail stays navigable.
- **Hard-deleted** (id dangles): the destination page shows the existing **diagnostic 404**
  ("document no longer exists") rather than a blank screen. `<DocLink>` still renders the number as
  text if the report flags it missing.

## 7. RLS / permission-aware links (req 13)
`DOC_REGISTRY[type].perm` gives the read permission (`invoice→sales.read`, `vendor_bill→
purchasing.read`, `journal_entry→accounting.read`, `product→inventory.read`, contacts → the owning
module). `<DocLink>` checks it via the existing `usePermissions` hook; if denied it renders plain
text. The route guards (`RequirePermission`) remain the server-enforced backstop, and RLS already
prevents cross-tenant reads.

---

## 8. Rollout milestones
| D | Scope | Risk |
|---|---|---|
| **D1** | Foundation: `doc-links.ts` registry + `<DocLink>` + `<Breadcrumbs>` + fold in GL `SourceCell` | low |
| **D2** | **General Ledger** end-to-end (entry_number → JE, source → doc; query returns the ids) — the flagship | low |
| **D3** | Financial reports 2–5 (TB / P&L / BS / Cash Flow) — drill by account into GL (mostly wiring) | low |
| **D4** | Statements + Aging (6–9): per-row doc ids + contact links | med |
| **D5** | Inventory (10–12): stock ledger / movement / valuation → product + source doc | med |
| **D6** | Dashboard widgets (13) + Audit Logs (14) + breadcrumbs on all destination pages (§5) | med |

Each milestone: adapter/type changes + `<DocLink>` application + `tsc`/regression green, committed,
pushed. No migrations expected (display layer; the ids already exist in the tables).

---

## 9. Testing checklist
Click each ref type → lands on the right document · reversed JE shows badge + still links · deleted
doc → graceful 404 · a `viewer`/restricted role sees plain text (no link) for modules they can't read
· tenant isolation (can't drill into another tenant's doc — RLS) · breadcrumbs navigate back · TB/BS
account drill-down still works · no posting/accounting values changed.

## 10. Risks / backward-compat
Pure display layer — **no accounting, posting, or schema change**. The only churn is widening report
row types + their queries to carry ids (additive). Main risk is a wrong route/alias mapping →
mitigated by the single registry + the testing checklist. If a surface's RPC can't easily return an
id, that row falls back to plain text (no regression — it just isn't a link yet).
