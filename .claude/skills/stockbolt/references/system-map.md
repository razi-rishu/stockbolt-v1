# StockBolt System Map

How each subsystem actually works, with the doctrine that keeps it correct.
Schema details live in `docs/Document_2_Database_Schema.md`; accounting rules
in `docs/Document_3_Accounting_Rulebook.md`. This file is the operational
digest.

## Contents

1. Posting engine & GL
2. Stock, MAC & COGS
3. Returns & credit/debit notes
4. Documents & lifecycle
5. Permissions (RBAC)
6. Salespeople & commissions
7. SaaS billing
8. Catalog (automotive)
9. Print system
10. Frontend architecture
11. Design system
12. i18n

## 1. Posting engine & GL

- Every financial event posts through a SECURITY-DEFINER RPC
  (`confirm_invoice`, `confirm_vendor_bill`, `confirm_expense`,
  `confirm_credit_note`, `confirm_debit_note`, `confirm_pos_sale`,
  `confirm_bank_transfer`, PDC functions, payments, payroll…). The frontend
  NEVER writes `general_ledger` or `journal_entries` directly.
- `general_ledger.account_code` and `date` are NOT NULL with no default:
  every insert must resolve the code (`SELECT code FROM chart_of_accounts
  WHERE id = …`) and carry the JE's date, plus `contact_id`,
  `related_doc_type`, `related_doc_id` (drill-down depends on these), and
  `reversal_of_id` on mirror rows.
- **Balance by construction**: revenue = `total_amount − tax_amount`
  (+ `discount_amount` under the gross method); per-line goods/expense basis
  = `line_total − tax_amount`. Never trust the header `subtotal` — with
  tax-inclusive pricing it once made JEs unbalance. Header identity that must
  always hold: `subtotal − discount + tax = total` (inclusive mode stores
  net-of-tax `line_subtotal`).
- `je_must_balance` — deferred constraint trigger on `general_ledger`
  (tolerance 0.05) rejects unbalanced JEs at COMMIT. If a change trips it,
  the change is wrong, not the trigger.
- **Voucher-date rule (phase 43)**: reversal JE := original JE's date;
  reversal GL rows := mirrored rows' dates; reversal stock rows := reversed
  row's date; edit reposts := document date. Lock checks compare the VOUCHER
  date to `companies.period_lock_date`. `CURRENT_DATE` in any reversal path
  is a bug — the regression suite hard-fails on it.
- Editing a confirmed document = reverse-and-repost (or reverse-and-reopen
  for bank transfers/expenses). Voids mirror every GL and stock row.

## 2. Stock, MAC & COGS

- `stock_ledger` is the only stock truth; on-hand qty and MAC derive from
  live rows (`reversal_of_id IS NULL AND NOT EXISTS (reversal pointing at
  row)`).
- **Ordering: `stock_ledger.seq`** (monotonic BIGINT). All latest-row lookups
  and replays order by `seq`. Ordering by `created_at, id` is forbidden —
  same-timestamp uuid coin-flips caused nondeterministic MAC reads and
  phantom E1 drift.
- Moving-average cost recomputes via `recompute_stock_valuation`; a trigger
  keeps running values consistent. System Health's E1 invariant compares
  subledger MAC vs GL 1300.
- **Deferred COGS**: selling at MAC=0 (sell-before-buy) queues in
  `deferred_cogs_queue`; the next vendor bill flushes it (Dr 5100 / Cr 1300
  at flush-time cost). Known design gap: editing a purchase price after its
  stock was sold does NOT re-cost past sales (E1 can't catch it — both sides
  equally wrong). A revaluation engine is designed but unbuilt (see
  workflow.md §Backlog).
- **Services never touch inventory** (phase 36): a name-ordered `_a_` trigger
  skips stock writes for service items; POS/bill paths patched.
- Negative stock is blocked at sale-posting unless the company enables
  "Allow backorders" (`companies.allow_negative_stock`).

## 3. Returns & credit/debit notes

- Sales returns post through the credit-note engine
  (`confirm_sales_return` creates + confirms a CN; damaged items credit the
  customer without restocking via `cost_at_sale = 0`).
- Credit notes carry `salesperson_id` inherited from the linked invoice
  (editor sets it; `confirm_sales_return` copies `v_inv.salesperson_id`) —
  this shrinks the right person's commission base.
- Debit notes are the purchasing mirror.

## 4. Documents & lifecycle

- Lifecycle: `draft → confirmed → (voided | edited-via-reversal)`. Only
  confirmed documents post. Document numbers come from
  `get_next_document_number`.
- Drill-down (`Document 7`): `<DocLink>` + a registry map GL/report rows to
  their source documents — new GL writes must fill `related_doc_*` so links
  work.
- View-first editors: saved documents open in a print-style template view;
  editing is explicit.

## 5. Permissions (RBAC)

- Permission strings `module.read` / `module.write` + `users.manage`
  (admin-only, never grantable). 5 system roles (shared, locked) + per-company
  custom roles + per-user allow/deny overrides. Effective permissions come
  from `my_permissions()` into the auth store.
- Enforcement layers: sidebar nav filtering → `RequirePermission` route
  guards → RLS read/write policies per module. Known residual: some posting
  RPCs don't re-check permissions inside the function body.
- UI: Settings → Users & Roles (invite by email, customize per user,
  duplicate system roles into editable custom copies).

## 6. Salespeople & commissions

- `salespeople` master (per company, `commission_pct`), independent of auth
  users. Invoices REQUIRE a salesperson; quotes/orders/CNs carry one.
- Sales by Salesperson report: net sales = invoices − credit notes (excl.
  VAT, header `total − tax`), commission = net × `commission_pct`, floored
  at 0. POS sales have no salesperson → "Unassigned".

## 7. SaaS billing (Document 6)

- M1–M3 built: subscriptions, PayPal (see `docs/PayPal_Setup_Steps.md`),
  pricing 1 year free → $21/$105/$200 tiers. M4+ (invoices, emails, admin
  console, enforcement) not built. Admin dashboard exists at
  `src/modules/admin/`.

## 8. Catalog (automotive, Document 8)

- TecDoc-grade: vehicle hierarchy (makes → models → engines), product
  compatibility links, OE numbers, brands (enrichment + merge), category
  tree, cascading vehicle filter in Parts Catalog, imports/exports.

## 9. Print system

- "Signature Ledger Edge" template engine (`src/modules/print/`): themed
  document templates for every doc type + statements, print-config per
  company (logo, accent, toggles), bilingual output.

## 10. Frontend architecture

- **Adapter pattern**: ALL data access goes through `getAdapter()`
  (`src/data/adapter.ts` = interface + types, `supabaseAdapter.ts` = cloud
  impl, `selfHostedAdapter.ts` = stub). New RPCs missing from generated types
  use the `rpcAny` helper — never `as never` casts.
- Routes lazy-load in `src/App.tsx`; guards: `RequireAuth` →
  `RequireOnboarded` → `RequirePermission`. Auth bootstrap in
  `use-auth-init.ts` (persisted zustand store `stockbolt-ui`).
- App shell `src/components/app-layout.tsx`: white sidebar (accordion nav +
  SHORTCUTS + company chip) + top bar (command palette Ctrl+K/Ctrl+/, bell,
  gear, profile). Auth pages share `src/modules/auth/auth-shell.tsx`.
- Dashboard KPIs compute client-side in `getOwnerDashboard` (paged fetch,
  net of VAT, Today/Month/Year toggle persisted in localStorage).
- Never call setState inside a TanStack Query `select` — it runs during
  render and infinite-loops (production incident).
- Vendor chunks are split in `vite.config.ts` (`manualChunks`); page routes
  lazy; recharts/xlsx load on demand.

## 11. Design system

- Tokens in `tailwind.config.js`: `brand-*` (violet #7C3AED primary),
  `ink-*` text, `surface-*`, `border-*`, semantic success/danger/warning.
  Inline-style pages use `src/ui/theme.ts`. Primitives in `src/ui/`.
- **Brand (2026-07)**: orange three-bar mark + navy STOCKBOLT wordmark —
  `src/components/brand-logo.tsx` (`BrandMark`/`BrandTile`/`BrandLogo`,
  mark color parameterizable; the marketing site uses teal). Favicon
  `public/favicon.svg`. The app UI accent is still violet — an orange
  re-theme was discussed but not approved.
- Landing page (`src/modules/marketing/landing-page.tsx`): navy/blue/teal
  marketing palette, CSS-built mockups, no external images.
- Reference page at `/design-system`. When fixing any design issue, sweep
  every module for the same pattern.

## 12. i18n

- `src/i18n/en.json` + `ar.json`, full RTL via `applyDirection`. Every new
  user-facing string needs both languages. Use logical CSS
  (`ps-/pe-/start-/end-`) so layouts flip. The Latin wordmark STOCKBOLT and
  logos don't localize. Known residual: Users & Roles page is English-only.
