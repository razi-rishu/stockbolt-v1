# Current Phase

**Active Phase:** Phase 8 — (Serial Numbers & remaining per Doc 5)

**Status:** Phase 7 closed 2026-05-05. All 18 verification assertions passed (18/18). Verification gate: `npm run test:phase7`.

**Last completed:** Phase 7 in full. POS Counter Sales: 2 Supabase RPCs (open_pos_session, close_pos_session, confirm_pos_sale A2/A3/A4 + COGS A1.b), PosAPI with 8 methods, pos-screen.tsx (full-viewport two-panel UI with F2/F4/Esc shortcuts, session lifecycle, product grid, cart, payment modal), POS Session Report, Daily Sales Summary report, nav wiring, EN+AR i18n (pos.* section + reports.* POS keys), Phase 7 verification test 18/18. Awaiting `supabase db push` + `supabase gen types` to remove `(client.rpc as any)` casts for POS RPCs.

**Next milestone:** Phase 8 — Run `supabase db push` in main project to apply Phase 7 migrations, then `supabase gen types` to regenerate types and remove `(client.rpc as any)` casts.

**Notes:**
- Building from clean slate after rebuild decision
- All 6 planning docs approved before starting
- Costing method locked to MAC for v1
- LIFO permanently excluded
- Payroll deferred to v2

---

## How To Update This File

Update this file as phases advance:
1. When a Definition of Done checkbox passes, note it under "Last completed"
2. When all checkboxes for a phase pass, change "Active Phase" to the next phase
3. Update "Next milestone" to point to the next phase's verification test
4. Add session notes if there are decisions or context worth preserving

This file is read by Claude Code at the start of every session, so keep it accurate.

---

## Phase Log

### Phase 0 — Project Setup & Foundation
- Started: 2026-04-30
- Definition of Done: see Document_5_Build_Phases.md, Phase 0 section
- Verification test: RLS multi-tenant isolation test

**Stage progress:**
- [x] Stage 1 — Environment check (Node v24.13.0, npm 11.6.2, git 2.50.0)
- [x] Stage 2 — Repo scaffolding (Vite, TS, Tailwind, folder structure, design tokens locked)
- [x] Stage 3 — Supabase cloud project `stockbolt-v1` (ref `gzpkuaioibqrdppjdbwz`); Supabase CLI installed via Scoop; `supabase login` + `supabase link` succeeded
- [x] Stage 4 — 18 migrations applied via `supabase db push`. Schema lives: 56 tables, gl_active + stock_active views, RLS policies on every tenant table, 3 storage buckets
- [x] Stage 5 — Data adapter layer (`src/data/`): adapter interface + Supabase implementation + self-hosted stub. Auto-generated `src/types/database.ts` (4423 lines) via `supabase gen types`
- [x] Stage 6 — RLS verification test PASSED (6/6 assertions in `tests/integration/phase0-rls.test.ts`)
- [x] Stage 7 — git init, 6 conventional commits per AGENTS.md §11.3, pushed to GitHub
- [x] Stage 8 — All 7 Phase 0 DoD checkboxes ticked

**Phase 0 DoD — final state:**
- [x] `npm install && npm run dev` starts the app cleanly
- [x] All 56 tables exist in Supabase (Doc 2 said 48; actual count 56 due to item-table breakdown)
- [x] Two test users in two different companies can sign up (programmatically, in the RLS test)
- [x] User A cannot see User B's company_id rows — RLS test passes 6/6
- [x] `supabase gen types` produces a TypeScript types file (`src/types/database.ts`, 4423 lines)
- [x] No business logic written yet — only foundation
- [x] Repo on GitHub with clean commit history (6 commits, all `[Phase0] ...` prefixed)

**Decisions made in Phase 0:**
- Design tokens switched from dark/amber to light/indigo per approved screenshots; AGENTS.md §7.1 updated in same commit as `tailwind.config.js` to prevent drift.
- New Supabase project created (old project from previous build NOT reused, per AGENTS.md §0 North Star).
- AGENTS.md placed at repo root as a real file (not symlink — Windows-friendly); kept in sync with `docs/AGENTS.md` manually until v1.
- Cloud-only deployment for Phase 0 (Option A). Local Docker dev can be added later for offline/sample-data testing without re-doing migrations.
- ESLint `no-undef` rule disabled — TypeScript strict mode catches that class of error better and ESLint can't see ambient `.d.ts` declarations.
- `SUPABASE_SECRET_KEY` (no `VITE_` prefix) used for the RLS test; Vite refuses to bundle it into browser builds, blocking accidental client-side leakage.

### Phase 1 — Master Data & Onboarding
- Started: 2026-05-01
- Definition of Done: see Document_5_Build_Phases.md, Phase 1 section

**Stage progress:**
- [x] Stage 1 — Dependencies (zod, @hookform/resolvers), routing (React Router v6), TanStack Query provider, i18n config (i18next + RTL), Zustand auth store
- [x] Stage 2 — Auth module: Login, Register, ForgotPassword, ResetPassword, EmailVerification pages (react-hook-form + zod)
- [x] Stage 3 — COA seed service (32 accounts for UAE, 36 for India), tax rates, payment methods, units seed services; `runOnboarding` orchestrator in `src/core/`
- [x] Stage 4 — 6-step Setup Wizard (`/setup`); `complete_onboarding` SECURITY DEFINER Postgres function (Phase 1 migration) solves RLS bootstrap problem
- [x] Stage 5 — Company Settings page (`/settings/company`): edit info + logo upload to Supabase Storage
- [x] Stage 6 — Full EN + AR i18n keys; RTL layout via `document.documentElement.dir`; LanguageToggle component; logical Tailwind properties (`ms-*`/`me-*`)
- [x] Stage 7 — Phase 1 verification test (`tests/integration/phase1-verification.test.ts`); `npm run test:phase1` script added

**Phase 1 DoD — final state (all passed 2026-05-01):**
- [x] Auth flow: Login, Register, ForgotPassword, ResetPassword, EmailVerification
- [x] 6-step Setup Wizard at `/setup` (react-hook-form + zod, per-step validation)
- [x] COA seed: 32 system accounts for UAE/GCC, 36 for India (IS_SYSTEM=true)
- [x] Tax rates seed: 1 row "UAE VAT 5%" for AE, 4 GST rows for IN
- [x] Payment methods seed: Cash, Bank Transfer, Cheque, Card (4 rows)
- [x] Units of measure seed: PCS, SET, KG, LITRE, BOX (5 rows)
- [x] First warehouse with is_default=true
- [x] First bank/cash account linked to COA 1110/1100
- [x] Company Settings page (`/settings/company`): edit info + logo upload
- [x] EN + AR i18n (i18next, RTL, LanguageToggle)
- [x] Verification test: 8/8 assertions passed (`npm run test:phase1`)

**Decisions made in Phase 1:**
- RLS bootstrap solved via SECURITY DEFINER `complete_onboarding()` Postgres function (migrations 20260501000000 + 20260501000001 fix). Profile creation happens atomically with company creation.
- COA account count: Doc 5 says "30" but actual count for UAE is 32 (Doc 3 Part A list, minus 6 India GST accounts, minus 6100 Salaries which is v2-only).
- `bank_accounts.account_type` uses `'bank'/'cash'` (not `'current'/'petty_cash'`) — schema CHECK constraint is the source of truth.
- `payment_methods.type` uses `'bank'` (not `'bank_transfer'`) — schema CHECK constraint is the source of truth.
- `complete_onboarding` RPC now fully typed after `supabase gen types` re-run; `any` cast removed.

### Phase 2 — Items, Customers & Vendors
- Started: 2026-05-01
- Definition of Done: see Document_5_Build_Phases.md, Phase 2 section

**Stage progress:**
- [x] Stage 1 — App shell: `AppLayout` sidebar + topbar; `App.tsx` wrapped all onboarded routes; `dashboard/index.tsx` simplified (no own header)
- [x] Stage 2 — Adapter layer extended: `CategoriesAPI`, `BrandsAPI`, `WarehousesManagementAPI`, `UnitsManagementAPI`, `VehicleMakesAPI`, `ProductsAPI` (incl. `listByModel`), `ContactsAPI`, `PriceLevelsAPI`; supabaseAdapter + selfHostedAdapter updated
- [x] Stage 3 — New UI primitives: `Table<T>`, `Modal`, `Badge`, `Textarea`
- [x] Stage 4 — Reference data CRUD: Categories (`/products/categories`), Brands (`/products/brands`), Warehouses (`/settings/warehouses`), Units (`/settings/units`), Vehicle Makes/Models (`/products/vehicles`)
- [x] Stage 5 — Contacts: Customers + Suppliers via shared `ContactListPage` parameterised by type
- [x] Stage 6 — Product master: list with dual-mode search, detail page with 4 tabs (Details, Compatibility, Supplier Codes, Images)
- [x] Stage 7 — Parts Catalog browse (`/catalog`): Make → Model → Year filter → product cards grid
- [x] Stage 8 — Price Levels settings page (`/settings/price-levels`)
- [x] Stage 9 — EN + AR i18n for all Phase 2 screens (nav, products, contacts, catalog, settings.warehouses/units/price_levels, parts_catalog)

**Phase 2 DoD — final state (all passed 2026-05-01):**
- [x] AppLayout sidebar + topbar; all onboarded routes wrapped; mobile hamburger overlay
- [x] Categories CRUD at `/products/categories`
- [x] Brands CRUD with logo upload at `/products/brands`
- [x] Vehicle Makes + Models (two-panel drill-down) at `/products/vehicles`
- [x] Warehouses CRUD (with default-delete guard) at `/settings/warehouses`
- [x] Units of Measure CRUD at `/settings/units`
- [x] Price Levels CRUD at `/settings/price-levels`
- [x] Customers list + add/edit at `/contacts/customers`
- [x] Suppliers list + add/edit at `/contacts/suppliers`
- [x] Products list with dual-mode search (OE + supplier SKU) at `/products`
- [x] Product detail with 4 tabs (Details/Compat/Supplier Codes/Images) at `/products/:id`
- [x] Parts Catalog browse (Make → Model → Year → product cards) at `/catalog`
- [x] EN + AR i18n for all Phase 2 screens
- [x] Verification test: 10/10 assertions passed (`npm run test:phase2`)

**Decisions made in Phase 2:**
- `vehicle_models` has no `company_id`; scoped to company via `vehicle_makes.company_id` FK — RLS handles this through a join.
- `product_compatibility.make_id` is required (not nullable) — both make and model must be provided even when model is nullable.
- zod v4 `coerce` types are incompatible with `@hookform/resolvers` `Resolver<T>` constraint — fixed with `zodResolver(schema) as any` + `v as FormValues` cast in handleSubmit.
- `products.listByModel` uses two-step query: compat rows → product_id set → IN query on products. Year filter uses chained `.or()` for (year_from IS NULL OR year_from ≤ year) AND (year_to IS NULL OR year_to ≥ year).

### Phase 3 — Accounting Engine & GL UI
- Started: 2026-05-02
- Closed: 2026-05-02
- Definition of Done: see Document_5_Build_Phases.md, Phase 3 section

**Stage progress:**
- [x] Stage 1 — DB: 2 migrations (`post_journal_entry` RPC + `reverse_journal_entry` RPC); Supabase types regenerated
- [x] Stage 2 — Adapter layer: `CoaAPI`, `AccountingAPI`, `StockLedgerAPI` added to adapter.ts + supabaseAdapter.ts + selfHostedAdapter.ts
- [x] Stage 3 — GL engine: `journal-validator.ts` (10 universal rules + source_type mapping assertion), `posting-engine.ts` (postJournalEntry + reverseJournalEntry)
- [x] Stage 4 — MAC engine: `mac-engine.ts` (MovingAverageCostingStrategy + postStockMovement)
- [x] Stage 5 — CoA UI: `chart-of-accounts.tsx` (grouped by type, Add Custom Account modal); sidebar Accounting + Reports sections; App.tsx routes updated
- [x] Stage 6 — JE editor: `journal-entries.tsx` (list) + `journal-entry-editor.tsx` (create + view + reverse; dynamic lines; live balance indicator)
- [x] Stage 7 — GL viewer + Trial Balance: `general-ledger.tsx` (account + date filter, running balance) + `trial-balance.tsx` (type-grouped, totals row)
- [x] Stage 8 — Period lock UI: `period-lock.tsx`; accounting.* + reports.* i18n keys (EN + AR)
- [x] Stage 9 — Verification test: `phase3-verification.test.ts` (11 pure unit assertions); `test:phase3` script added

**Phase 3 DoD — final state (all passed 2026-05-02):**
- [x] post_journal_entry Postgres RPC: period lock guard, lazy sequence init, audit log
- [x] reverse_journal_entry Postgres RPC: checks not-already-reversed, Dr↔Cr mirror, period lock on today
- [x] Journal validator: balanced within 0.01, ≥2 lines, no negatives, no Dr+Cr same line, source_type mapping rules
- [x] MAC engine: new_MAC = (old_MAC × old_qty + in_cost × in_qty) / (old_qty + in_qty)
- [x] Chart of Accounts at `/accounting/chart-of-accounts`
- [x] Journal Entries list + editor at `/accounting/journal-entries`
- [x] General Ledger viewer at `/accounting/general-ledger`
- [x] Trial Balance at `/reports/trial-balance`
- [x] Period Lock settings at `/accounting/period-lock`
- [x] EN + AR i18n for all Phase 3 screens
- [x] Verification test: 11/11 assertions passed (`npm run test:phase3`)

**Decisions made in Phase 3:**
- GL atomicity achieved via SECURITY INVOKER Postgres RPCs (not client-side multi-table inserts) — period lock check, sequence management, JE header + GL lines + audit_log all in one transaction.
- document_sequences lazy init: RPC uses `INSERT ... ON CONFLICT DO UPDATE` to auto-create sequence row on first JE — no onboarding step needed.
- CoA API added as `coa.list/create` (separate from onboarding.insertCoaBatch) to support the CoA UI in read+add mode.
- database.ts had a stray "Initialising login role..." line prepended (artifact from Supabase CLI output redirect) — removed in this phase.

### Phase 4 — Sales Loop
- Started: 2026-05-02
- Closed: 2026-05-02
- Definition of Done: see Document_5_Build_Phases.md, Phase 4 section

**Stage progress:**
- [x] Stage 1 — DB: 5 migrations (get_next_document_number, confirm_invoice, void_invoice+edit_invoice, confirm_payment, apply_advance); `supabase gen types` re-run
- [x] Stage 2 — Adapter layer: InvoicesAPI, SalesQuotesAPI, PaymentsAPI, BankAccountsAPI, TaxRatesAPI, ReportsAPI added to adapter.ts + supabaseAdapter.ts + selfHostedAdapter.ts
- [x] Stage 3 — Invoice UI: `invoices.tsx` (list) + `invoice-editor.tsx` (create/edit/confirm/void/repost with dynamic line items)
- [x] Stage 4 — Payments UI: `payments.tsx` (list) + `payment-editor.tsx` (create/confirm + apply-advance panel)
- [x] Stage 5 — Quotes UI: `quotes.tsx` (list + convert-to-invoice) + `quote-editor.tsx` (create/edit)
- [x] Stage 6 — Customer Detail page: `customer-detail.tsx` (open invoices + AR statement)
- [x] Stage 7 — Reports: `profit-loss.tsx` + `balance-sheet.tsx`
- [x] Stage 8 — Reports: `ar-aging.tsx` + `stock-valuation.tsx`
- [x] Stage 9 — i18n + routing: sales.*, payments.*, reports.* keys (EN+AR); Sales + expanded Reports sidebar sections; App.tsx routes
- [x] Stage 10 — Verification test: `phase4-verification.test.ts` (31 pure unit assertions); `test:phase4` script added

**Phase 4 DoD — final state (all passed 2026-05-02):**
- [x] confirm_invoice RPC: A1 (sales_invoice JE) + A1.b (inventory_cogs JE) + stock_ledger outbound rows, deferred COGS when MAC=0
- [x] void_invoice RPC: reverses all JEs (sales_invoice + inventory_cogs + advance_application), reverses stock, cancels deferred COGS
- [x] edit_invoice RPC (F1): TypeScript updates items first, RPC reverses+reposts atomically
- [x] confirm_payment RPC: A5 (against_invoice: DR bank, CR 1200+2400) or A7 (advance: DR bank, CR 2400)
- [x] apply_advance RPC (A6): DR 2400, CR 1200, inserts payment_allocation row
- [x] get_next_document_number RPC: lazy sequence init for INV/QT/REC/JE prefixes
- [x] Invoice list + editor at `/sales/invoices`
- [x] Sales Quotes list + editor at `/sales/quotes`
- [x] Payments list + editor at `/sales/payments`
- [x] Customer Detail + Statement at `/contacts/customers/:id`
- [x] Profit & Loss at `/reports/profit-loss`
- [x] Balance Sheet at `/reports/balance-sheet`
- [x] AR Aging at `/reports/ar-aging`
- [x] Stock Valuation at `/reports/stock-valuation`
- [x] EN + AR i18n for all Phase 4 screens
- [x] Verification test: 31/31 assertions passed (`npm run test:phase4`)

**Decisions made in Phase 4:**
- `invoice-calc.ts` extracted to `src/core/sales/` to make line-item arithmetic unit-testable independently of UI state.
- `edit_invoice` is a 2-step operation: TypeScript writes updated items to DB, then calls RPC which reads them and does atomic reversal+repost.
- `void_invoice` finds advance_application JEs via `source_id = p_invoice_id` (not source_id = payment_id), which is how they were recorded by `apply_advance`.
- Reports computed client-side from raw GL data (no stored views) — acceptable for v1 data volumes; can be moved to DB views/RPCs in v2 if performance requires.
- `supabase gen types` re-run after migrations; stray "Initialising login role..." prefix removed again (Supabase CLI CLI artifact; filed as known issue).

### Phase 5 — Purchase Loop
- Started: 2026-05-02
- Closed: 2026-05-02
- Definition of Done: see Document_5_Build_Phases.md, Phase 5 section

**Stage progress:**
- [x] Stage 1 — DB: 3 migrations (confirm_grn B2+MAC, confirm_vendor_bill B3/B4, vendor_payment B5/B6/B7 + apply_vendor_advance); coa_account_id column added to vendor_bill_items
- [x] Stage 2 — Core util: `src/core/purchasing/purchase-calc.ts` (calcPurchaseLine, calcPurchaseHeaderTotals, calcMAC, calcMACAfterVariance, apAgingBucket)
- [x] Stage 3 — Adapter layer: PurchaseOrdersAPI, GoodsReceiptsAPI, VendorBillsAPI, VendorPaymentsAPI added; ReportsAPI extended (getAPAgingReport, getSupplierStatement, getGRNReconciliation)
- [x] Stage 4 — Purchase Orders UI: `purchase-orders.tsx` (list) + `po-editor.tsx` (create/edit/send/close with calcPurchaseLine lines)
- [x] Stage 5 — Goods Receipts UI: `goods-receipts.tsx` (list) + `grn-editor.tsx` (create/confirm + pre-fill from PO via ?po_id=)
- [x] Stage 6 — Vendor Bills UI: `vendor-bills.tsx` (list) + `vendor-bill-editor.tsx` (create/confirm + pre-fill from GRN via ?grn_id=, B4 expense accounts)
- [x] Stage 7 — Vendor Payments UI: `vendor-payments.tsx` (list) + `vendor-payment-editor.tsx` (create/confirm + apply-advance panel)
- [x] Stage 8 — Supplier Detail page: `supplier-detail.tsx` (open bills + supplier statement)
- [x] Stage 9 — Reports: `ap-aging.tsx` + `supplier-statement.tsx` + `grn-reconciliation.tsx`
- [x] Stage 10 — i18n + routing: purchasing.* + reports.* Phase 5 keys (EN+AR); Purchasing sidebar section; App.tsx routes
- [x] Stage 11 — Verification test: `phase5-verification.test.ts` (23 pure unit assertions); `test:phase5` script added

**Phase 5 DoD — final state (all passed 2026-05-02):**
- [x] confirm_grn RPC: B2 (DR 1300 Inventory, CR 2150 GRN Accrual), per-item MAC update
- [x] confirm_vendor_bill RPC: B3 (clear 2150, DR 2100 AP; variance to 1300) + B4 (standalone expense bills)
- [x] confirm_vendor_payment RPC: B5 (against_invoice), B6 (advance DR 1400), and apply_vendor_advance B7 (DR 2100 CR 1400)
- [x] Purchase Orders list + editor at `/purchasing/orders`
- [x] Goods Receipts list + editor at `/purchasing/grns`
- [x] Vendor Bills list + editor at `/purchasing/bills`
- [x] Vendor Payments list + editor at `/purchasing/payments`
- [x] Supplier Detail + Statement at `/contacts/suppliers/:id`
- [x] AP Aging at `/reports/ap-aging`
- [x] Supplier Statement at `/reports/supplier-statement`
- [x] GRN Reconciliation at `/reports/grn-reconciliation`
- [x] EN + AR i18n for all Phase 5 screens
- [x] Verification test: 23/23 assertions passed (`npm run test:phase5`)

**Decisions made in Phase 5:**
- `stock_ledger` constraints (quantity > 0, direction IN (-1,1)) prevent zero-qty cost-adjustment rows after bill variance — MAC variance recalculation only tested as a pure formula; RPC does not insert adjustment rows.
- `coa_account_id` on vendor_bill_items not yet in generated types (requires `supabase db push` + `supabase gen types`); insert cast to `any[]` until types are regenerated.
- Phase 5 RPCs not yet in generated database.ts function type union; `client.rpc` cast to `any` for 4 new RPCs.
- Products table has no cost_price field — PO editor defaults unit_cost to 0 when selecting a product; operator fills it in manually.
- `purchase-calc.ts` extracted to `src/core/purchasing/` to keep purchasing arithmetic pure and unit-testable.

### Phase 6 — Inventory Operations
- Started: 2026-05-05
- Closed: 2026-05-05
- Definition of Done: see Document_5_Build_Phases.md, Phase 6 section

**Stage progress:**
- [x] Stage 1 — DB: 2 migrations (confirm_stock_transfer C1 GL-neutral, confirm_inventory_adjustment C2/C3 gain→4300/loss→6700); copied to main project for `supabase db push`
- [x] Stage 2 — Core util: `src/core/inventory/inventory-calc.ts` (calcAdjustmentLine, stockAgingDays, stockAgingBucket, isReorderNeeded)
- [x] Stage 3 — Adapter layer: StockTransfersAPI, InventoryAdjustmentsAPI, ProductSerialsAPI; ReportsAPI extended (getStockMovement, getSlowMoving, getReorderReport, getStockAging, getInventoryAdjustmentReport); selfHostedAdapter stubs
- [x] Stage 4 — Stock Transfers UI: `stock-transfers.tsx` (list) + `transfer-editor.tsx` (create/confirm with from/to warehouse, line items)
- [x] Stage 5 — Inventory Adjustments UI: `inventory-adjustments.tsx` (list) + `adjustment-editor.tsx` (create/confirm with live calcAdjustmentLine, summary gain/loss cards)
- [x] Stage 6 — Stock Ledger viewer: `stock-ledger.tsx` (product+warehouse+date range filter, qty_in/qty_out columns, running_qty+value)
- [x] Stage 7 — 5 Inventory report pages: stock-movement, slow-moving, reorder, stock-aging, inventory-adjustment-report
- [x] Stage 8 — App layout: Inventory sidebar section (Transfers, Adjustments, Stock Ledger) + 5 new report links + ArrowsIcon + SliderIcon
- [x] Stage 9 — Routing: 7 inventory routes + 5 report routes added to App.tsx
- [x] Stage 10 — i18n: `inventory.*` (53 keys) + `reports.*` Phase 6 additions (14 keys) + `common.run` + `nav.inventory` in EN + AR
- [x] Stage 11 — Verification test: `phase6-verification.test.ts` (30 pure unit assertions); `test:phase6` script added

**Phase 6 DoD — final state (all passed 2026-05-05):**
- [x] confirm_stock_transfer RPC: C1 — GL-neutral; transfer_out (direction=-1) + transfer_in (direction=+1) per item, running_qty updated
- [x] confirm_inventory_adjustment RPC: C2/C3 — adjustment_in/out stock_ledger rows; JE DR 1300 CR 4300 for gain, JE DR 6700 CR 1300 for loss
- [x] calcAdjustmentLine: difference = actual-system, total_value = ABS(diff)×cost, direction in/out/none
- [x] stockAgingDays: floor diff in ms / 86_400_000, null → 0
- [x] stockAgingBucket: 0_30 / 31_60 / 61_90 / over_90
- [x] isReorderNeeded: qty <= minStockLevel
- [x] Stock Transfers list + editor at `/inventory/transfers`
- [x] Inventory Adjustments list + editor at `/inventory/adjustments`
- [x] Stock Ledger viewer at `/inventory/stock-ledger`
- [x] Stock Movement report at `/reports/stock-movement`
- [x] Slow-Moving Stock report at `/reports/slow-moving`
- [x] Reorder report at `/reports/reorder`
- [x] Stock Aging report at `/reports/stock-aging`
- [x] Inventory Adjustment report at `/reports/inventory-adjustment-report`
- [x] EN + AR i18n for all Phase 6 screens
- [x] Verification test: 30/30 assertions passed (`npm run test:phase6`)

**Decisions made in Phase 6:**
- Stock transfers are GL-neutral (C1) — company-wide MAC means no P&L impact when stock moves between own warehouses; only two stock_ledger rows per item (transfer_out dir=-1, transfer_in dir=+1).
- Inventory adjustment can post two JEs in one call (gain JE to 4300 + loss JE to 6700) — design allows mixed-sign adjustments in a single document.
- Phase 6 RPCs (confirm_stock_transfer, confirm_inventory_adjustment) still use `(client.rpc as any)` casts pending `supabase db push` + `supabase gen types`.
- stockAgingDays(null) → 0 treats never-moved items as "just received" for safety (conservative — avoids false over_90 buckets on items with no ledger yet).

### Phase 7 — POS Counter Sales
- Started: 2026-05-05
- Closed: 2026-05-05
- Definition of Done: see Document_5_Build_Phases.md, Phase 7 section

**Stage progress:**
- [x] Stage 1 — DB: 2 migrations (open_pos_session + close_pos_session RPCs; confirm_pos_sale RPC: A2 cash DR 1100, A3 card DR 1110, A4 credit DR 1200, all CR 4100+2200 VAT, plus A1.b COGS DR 5100 CR 1300); copied to main project
- [x] Stage 2 — Core util: `src/core/pos/pos-calc.ts` (calcPOSLine, calcPOSTotals, calcPOSSessionSummary — exclusive tax, same formula as invoice-calc.ts)
- [x] Stage 3 — Adapter layer: PosAPI (8 methods: openSession, getOpenSession, closeSession, confirmSale, getSessionSales, listSessions, getPOSSessionReport, getDailySalesSummary); PosSessionRow re-export; selfHostedAdapter stubs
- [x] Stage 4 — supabaseAdapter.ts: full pos: implementation (openSession via RPC, getOpenSession via direct query, closeSession via RPC, confirmSale via RPC, getSessionSales, listSessions, getPOSSessionReport, getDailySalesSummary)
- [x] Stage 5 — POS screen: `pos-screen.tsx` (full-viewport two-panel layout; OpenSessionDialog; CloseSessionDialog; session bar; F2/F4/Esc shortcuts; product search grid; cart with +/- qty; totals; customer select; Cash/Card/Credit payment buttons; payment confirm modal; last-sale banner)
- [x] Stage 6 — POS reports: `pos-session.tsx` (session list with cash variance) + `daily-sales.tsx` (day-by-day cash/card/credit breakdown with tfoot totals)
- [x] Stage 7 — App layout: POS sidebar section (Counter Sales) + 2 new report links + RegisterIcon; Reports section extended with pos-session + daily-sales
- [x] Stage 8 — Routing: `/pos` + `/reports/pos-session` + `/reports/daily-sales` added to App.tsx
- [x] Stage 9 — i18n: `pos.*` section (43 keys) + `reports.*` POS additions (9 keys) + `common.*` additions (status, all, date, date_from, date_to, total) + `nav.pos` in EN + AR
- [x] Stage 10 — Verification test: `phase7-verification.test.ts` (18 pure unit assertions); `test:phase7` script added

**Phase 7 DoD — final state (all passed 2026-05-05):**
- [x] open_pos_session RPC: validates warehouse, rejects if session already open, creates pos_sessions row with status='open'
- [x] close_pos_session RPC: expected_cash = opening_cash + SUM(pos_cash invoices), records variance, status='closed'
- [x] confirm_pos_sale RPC: A2/A3/A4 debit account resolved by payment_method, creates invoice + items + stock_ledger + GL JEs atomically, updates session totals
- [x] calcPOSLine: exclusive-tax, discount-first formula; 6 tests pass
- [x] calcPOSTotals: aggregates across lines; 4 tests pass
- [x] calcPOSSessionSummary: channels cash/card/credit, grand_total; 5 tests pass
- [x] POS Screen at `/pos` (full-viewport, session lifecycle, product search, cart, payment)
- [x] POS Session Report at `/reports/pos-session`
- [x] Daily Sales Summary at `/reports/daily-sales`
- [x] EN + AR i18n for all Phase 7 screens
- [x] Verification test: 18/18 assertions passed (`npm run test:phase7`)

**Decisions made in Phase 7:**
- Walk-in customers (cash/card) → `contact_id = NULL`; credit sales enforce `customer_id` required in both RPC and UI.
- confirm_pos_sale uses a single RPC with CASE on payment_method for debit account ('1100'/'1110'/'1200') — consistent with confirm_invoice pattern.
- `expected_cash` for session close only counts `pos_cash` invoices; card/credit do not affect the physical cash drawer.
- getDailySalesSummary groups invoices by date in TypeScript (not DB) — consistent with other client-side report aggregations; acceptable for v1 volumes.
- Phase 7 POS RPCs use `(client.rpc as any)` casts until `supabase db push` + `supabase gen types` is run from the main project.
