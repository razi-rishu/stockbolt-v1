# StockBolt v1 — Document 5: Build Phases

**Status:** Final draft for review
**Purpose:** The exact, ordered sequence in which to build StockBolt v1, with explicit "definition of done" for each phase. **The discipline that was missing in your last build.**
**Companion to:** Docs 1 (Modules), 2 (Schema), 3 (Accounting), 4 (Reports), 6 (AGENTS.md — coming next)

---

## Why This Document Exists

Your previous build failed because everything was built in parallel. The Invoice screen, Payroll, PDC, multi-warehouse stock, and reports were all in flight simultaneously. When something didn't work, you couldn't tell which subsystem was broken — and by the time you noticed, three more subsystems had been built on top of it.

**Doc 5 fixes this by enforcing one rule:** *no module starts until the prior module's "definition of done" passes 100%*.

If a phase isn't done, you don't move on. Period.

---

## The Core Discipline

### Rule 1 — Phases Are Sequential, Not Parallel
Phase N must complete before Phase N+1 begins. No exceptions. No "I'll come back and fix it later." No "let me also start on this while I wait."

### Rule 2 — Every Phase Has a Definition of Done (DoD)
Each phase below has a checklist. Every box must be ticked before proceeding. **A phase isn't "mostly done" — it's done or it's not.**

### Rule 3 — Every Phase Has a Verification Test
Most phases include a concrete scenario you must run end-to-end. If the scenario passes, the phase is done. If it fails, you fix it before moving on.

### Rule 4 — No Going Backwards
Once a phase is marked done, you don't return to it to add features. Bug fixes only. New features go into a v1.1 backlog.

### Rule 5 — Reports Are Built Alongside The Modules That Need Them
Reports aren't a final phase. They're built in tiers (per Doc 4 Part J) WITH the modules that produce their data. The Trial Balance is built when the GL is first writable. The Customer Statement is built with the Sales module.

---

## Phase Overview

| Phase | Name | Estimated Effort | Outcome |
|---|---|---|---|
| 0 | Project Setup & Foundation | 2–3 days | Empty app, real DB, real auth, RLS working |
| 1 | Master Data & Onboarding | 1 week | Sign up, set up company, add warehouses, seed COA |
| 2 | Master Data: Products & Contacts | 1 week | Full product master with auto-parts fields, customer/supplier records |
| 3 | The Accounting Engine (Headless) | 1 week | GL works, no UI — proven via test scripts |
| 4 | Sales Loop (the keystone) | 2 weeks | Full Quote → Invoice → Payment → Reports |
| 5 | Purchase Loop | 1.5 weeks | PO → GRN → Bill → Payment → Reports |
| 6 | Inventory Operations | 1 week | Transfers, adjustments, stock reports |
| 7 | POS (Counter Sales) | 1 week | Walk-in cash/card/credit sales |
| 8 | Banking & PDC | 1 week | Bank transfers, PDC management |
| 9 | Returns & Credit/Debit Notes | 1 week | Sales returns + credit notes + reverse-COGS |
| 10 | Reports Completion | 1 week | All Tier 2-3 reports + tax returns |
| 11 | Print Templates & Bilingual | 1 week | All templates working in EN + AR |
| 12 | Polish, Multi-currency Edge Cases, Beta | 1.5 weeks | Final testing, FX handling, deployment |

**Total estimated effort:** ~13–14 weeks of focused work.

This is realistic for a single developer using Claude Code. **It's faster than your last attempt because it's sequenced correctly, not because it's smaller.**

---

# PHASE 0 — Project Setup & Foundation

**Goal:** Empty but properly-configured project with database, auth, and tenancy guard rails.

## Tasks

1. **Repository setup**
   - New git repo (clean, NOT a fork of your previous build)
   - Vite + React + TypeScript scaffolding
   - Tailwind CSS + your dark/amber design tokens
   - Folder structure (will be specified in AGENTS.md)
   - `.env.example` with required variables

2. **Supabase project (cloud mode)**
   - Create new Supabase project
   - Configure auth (email + password, email confirmation)
   - Storage buckets for logos, product images, attachments

3. **Database schema deployment**
   - Run all 48 table creation scripts from Doc 2
   - All foreign keys, CHECK constraints, indexes
   - Triggers for `updated_at` auto-update on every table
   - Database VIEWs `gl_active` and `stock_active` (per Doc 4 Rule 3)

4. **Row Level Security**
   - RLS policies on every table (`tenant_isolation` per Doc 2)
   - Test that a logged-in user from Company A cannot read/write Company B's data
   - This is the security foundation — must be verified before any UI work

5. **Environment abstraction**
   - The `data adapter` layer (per Doc 1) — abstraction over Supabase
   - Self-hosted mode adapter stub (we'll fill it in later, but the abstraction must exist now)

6. **TypeScript types from schema**
   - Auto-generate types from Supabase schema using `supabase gen types`
   - These are the single source of truth for all DB shapes — no hand-written types

7. **Lint + format setup**
   - ESLint, Prettier
   - snake_case enforcement on object keys (custom rule or convention)

## Definition of Done — Phase 0

- [ ] `npm install && npm run dev` starts the app cleanly
- [ ] All 48 tables exist in Supabase, verified via dashboard
- [ ] Two test users in two different companies can sign up
- [ ] User A cannot see User B's company_id rows (RLS test passes)
- [ ] `supabase gen types` produces a TypeScript types file
- [ ] No business logic written yet — only foundation
- [ ] Repo is on GitHub with clean commit history

## Verification Test

Sign up two users (test1@..., test2@...) in two different companies. Insert a row into `companies` table for each. Try to query the other's company from each user's session. **Both queries must return zero rows.** If they don't, RLS is misconfigured — fix before proceeding.

---

# PHASE 1 — Master Data & Onboarding

**Goal:** A user can sign up, set up their company, and the system seeds correct foundational data (COA, default warehouse, default tax rates).

## Modules Built (per Doc 1)

- Module 1: Authentication & Onboarding (full)
- Module 9: Admin & Settings (basic — Company Settings only)

## Pages

- Login, Register, Forgot Password, Reset Password, Email Verification
- Multi-step Setup Wizard (6 steps per Doc 1):
  1. Company details (name + name_ar, address, logo)
  2. Country & tax (UAE/GCC/India, VAT/GST registration, tax ID)
  3. Currency & fiscal year start
  4. First warehouse (with bilingual name)
  5. Bank/cash accounts (at least one)
  6. Optional sample data load OR start blank
- Company Settings page (edit company info)

## Backend Logic

- On first login, redirect to setup wizard if not onboarded
- On wizard completion:
  - Insert `companies` row with `costing_method='mac'` (locked)
  - Seed standard COA from Doc 3 Part A list (system accounts with `is_system=true`)
  - Seed default tax rates per country (5% VAT for UAE, 18% GST split for India, etc.)
  - Seed default payment methods (Cash, Bank Transfer, Cheque, Card)
  - Seed default units (PCS, SET, KG, LITRE, BOX)
  - Insert first warehouse, mark `is_default=true`
  - Insert first bank/cash account, link to COA
  - If sample data selected: insert demo brands (Bosch, Mahle, Mann), demo categories, 20 sample products

## Definition of Done — Phase 1

- [ ] User signs up with email + password, receives verification email
- [ ] User completes setup wizard end-to-end without errors
- [ ] After wizard, `companies` table has correct row
- [ ] COA is seeded — exactly the accounts in Doc 3 Part A, with correct types
- [ ] Default warehouse exists, `is_default=true`
- [ ] Tax rates seeded based on country choice
- [ ] User can edit company info from Settings page
- [ ] Logo upload works (writes to Supabase Storage)
- [ ] All UI text appears in both English AND Arabic when language toggled
- [ ] RTL layout flips correctly when Arabic is active

## Verification Test

A new user signs up as a UAE auto parts business. Completes the wizard. After wizard:
- Open `chart_of_accounts` table → exactly 30 system accounts present
- Open `warehouses` → 1 row, `is_default=true`
- Open `tax_rates` → 1 row "UAE VAT 5%"
- Open `payment_methods` → 4 rows (Cash, Bank Transfer, Cheque, Card)
- Toggle UI to Arabic → entire UI flips to RTL, all labels translated

---

# PHASE 2 — Master Data: Products & Contacts

**Goal:** All static reference data the business depends on. **No transactions yet.**

## Modules Built

- Module 5 (partial): Products, Categories, Brands, Units, Warehouses, Vehicle Makes/Models
- Module 3 (partial): Customers (master only)
- Module 4 (partial): Suppliers (master only)

## Pages

- Categories (list with tree view, add/edit)
- Brands (list, add/edit, logo upload)
- Units of Measure (list, add/edit)
- Warehouses (list, add/edit — multi-warehouse support)
- Vehicle Makes / Models (list, add/edit — auto-parts-specific)
- Products:
  - List with search by SKU/name/OE number
  - Detail page with all fields (per Doc 2 `products` schema)
  - Add/Edit modal/form
  - Vehicle compatibility sub-form
  - Supplier cross-references sub-form
  - Image upload (multiple)
- Parts Catalog (browse mode — Make → Model → Year → Category → results)
- Customers (list, detail page placeholder, add/edit)
- Suppliers (list, detail page placeholder, add/edit)
- Price Levels (settings page, add/edit, optional product overrides)

## Definition of Done — Phase 2

- [ ] Can create a product with all auto-parts fields (OE number, replacements, brand, vehicle compatibility, supplier cross-refs)
- [ ] Bilingual fields (name + name_ar) editable, displayed correctly
- [ ] Product search works by SKU, OE number, replacement number, name (EN and AR)
- [ ] Parts Catalog navigation works (Make → Model → Year → Parts)
- [ ] Can create a customer with bilingual fields, credit limit, payment terms
- [ ] Can mark a contact as "both" (customer AND supplier)
- [ ] Multiple warehouses can be created
- [ ] Categories form a working tree
- [ ] Image upload works for products and brands
- [ ] All these screens are accessible in both EN and AR

## Verification Test

Create a real product: "Front Brake Pad Set — Mercedes E-Class W213 (2017–2023)"
- SKU: `BP-MB-W213-FRT`
- OE Number: `0009931901`
- Replacement Numbers: `[Bosch 0986494104, Mahle MFE-46/4]`
- Brand: Bosch
- Quality Tier: Premium
- Compatibility: Mercedes-Benz / E-Class / 2017-2023 / Engine: All
- Supplier cross-ref: Bosch UAE → supplier SKU `0986494104`

Open product → all fields editable. Search for `0986494104` → product appears. Toggle to Arabic → bilingual name shows. **Product master is auto-parts-grade.**

---

# PHASE 3 — The Accounting Engine (Headless)

**Goal:** The GL engine works, validated via tests, with NO user-facing UI. This is the keystone phase.

This phase is critical because **it's the only way to ensure the engine is correct before the UI muddies the testing**.

## Modules Built

- Module 6: Chart of Accounts UI (read + add custom)
- Module 6: General Ledger viewer (read-only)
- Module 6: Journal Entries (manual JE editor)
- Module 6: Period Lock (settings)

## Backend Components Built

1. **`postJournalEntry(entries, metadata)` — the core engine**
   - Validates Doc 3 Universal Rules 1–10
   - Calls `assertJournalMapping(source_type, lines)` per Doc 3 Part I
   - Inserts `journal_entries` header
   - Inserts `general_ledger` rows
   - Logs to `audit_logs`
   - All in a single DB transaction

2. **`reverseJournalEntry(je_id, reversal_metadata)`**
   - Mirrors all GL rows with debit↔credit swapped
   - Sets `reversal_of_id` properly
   - Period-lock guard
   - Audit log

3. **`CostingStrategy` interface + `MovingAverageCostingStrategy` implementation**
   - All 5 methods from Doc 3 Part O
   - MAC formula correctly applied on purchase
   - `cost_at_sale` snapshot logic

4. **`postStockMovement(product, warehouse, type, qty, cost, ...)`**
   - Inserts to `stock_ledger`
   - Triggers MAC recalc via CostingStrategy
   - Atomically linked with GL post when applicable

5. **Test harness (TypeScript test file)**
   - The "vertical slice test" — described below

## Reports Built (Tier 1)

- A1 Trial Balance
- A2 General Ledger (account-level)

## Definition of Done — Phase 3

- [ ] Manual JE editor works: user enters debits + credits, system rejects unbalanced entries
- [ ] Manual JE editor enforces all 10 Universal Rules
- [ ] Trial Balance displays correctly: total debit = total credit
- [ ] General Ledger viewer shows all entries with running balance
- [ ] Period Lock UI: setting a lock date prevents posting earlier
- [ ] **Test harness passes** (described below)
- [ ] Audit log records every post and reversal

## The Verification Test (THE Phase 3 Gate)

This test must pass 100% before Phase 4 starts. Run it as a TypeScript test file in CI.

```typescript
// PHASE 3 VERIFICATION TEST — the most important test in the entire build

async function phase3VerificationTest() {
  // 1. Set up
  const company = await createTestCompany({
    country: 'AE',
    currency: 'AED',
    base_currency: 'AED'
  });
  
  // 2. Verify standard COA seeded
  const coa = await getCOA(company.id);
  assert(coa.find(a => a.code === '1100')); // Cash
  assert(coa.find(a => a.code === '1200')); // AR
  assert(coa.find(a => a.code === '1300')); // Inventory
  assert(coa.find(a => a.code === '2100')); // AP
  assert(coa.find(a => a.code === '2200')); // Output VAT
  assert(coa.find(a => a.code === '4100')); // Sales
  assert(coa.find(a => a.code === '5100')); // COGS
  
  // 3. Manual JE: post owner's capital injection
  const je1 = await postJournalEntry({
    source_type: 'opening_balance',
    description: 'Opening capital',
    lines: [
      { account_code: '1110', debit: 50000, credit: 0 },  // Bank
      { account_code: '3200', debit: 0, credit: 50000 }   // Owner's Equity
    ]
  });
  
  // 4. Trial balance: bank=50000 Dr, equity=50000 Cr
  const tb1 = await getTrialBalance(company.id, today());
  assert(tb1.totalDebit === 50000);
  assert(tb1.totalCredit === 50000);
  assert(tb1.byAccount['1110'] === 50000);
  assert(tb1.byAccount['3200'] === -50000);
  
  // 5. Manual JE: rent expense
  await postJournalEntry({
    source_type: 'manual',
    description: 'Office rent',
    lines: [
      { account_code: '6200', debit: 5000, credit: 0 },
      { account_code: '1110', debit: 0, credit: 5000 }
    ]
  });
  
  // 6. Trial balance still balances
  const tb2 = await getTrialBalance(company.id, today());
  assert(tb2.totalDebit === tb2.totalCredit);
  
  // 7. Try to post unbalanced JE — must fail
  let failed = false;
  try {
    await postJournalEntry({
      source_type: 'manual',
      lines: [
        { account_code: '1110', debit: 100, credit: 0 },
        { account_code: '6200', debit: 0, credit: 99 } // unbalanced
      ]
    });
  } catch (e) { failed = true; }
  assert(failed, 'Unbalanced JE must be rejected');
  
  // 8. Try to post with invalid mapping — must fail
  failed = false;
  try {
    await postJournalEntry({
      source_type: 'sales_invoice',
      lines: [
        { account_code: '1110', debit: 100, credit: 0 }, // Bank — not allowed for sales_invoice
        { account_code: '4100', debit: 0, credit: 100 }
      ]
    });
  } catch (e) { failed = true; }
  assert(failed, 'Invalid mapping must be rejected');
  
  // 9. Reverse the rent JE
  await reverseJournalEntry(rentJeId);
  
  // 10. Trial balance: rent expense back to zero
  const tb3 = await getTrialBalance(company.id, today());
  assert(tb3.byAccount['6200'] === 0);
  assert(tb3.byAccount['1110'] === 50000);
  
  // 11. Period lock test
  await setPeriodLock(company.id, '2026-04-30');
  failed = false;
  try {
    await postJournalEntry({
      source_type: 'manual',
      date: '2026-04-15', // before lock
      lines: [...]
    });
  } catch (e) { failed = true; }
  assert(failed, 'Posting in locked period must be rejected');
  
  console.log('✅ Phase 3 verification PASSED');
}
```

**If any step fails: STOP. Fix the engine. Do not proceed to Phase 4.**

This is the discipline that was missing in your last build. The engine must be proven correct in isolation before any business module touches it.

---

# PHASE 4 — Sales Loop (THE KEYSTONE)

**Goal:** A complete Sales workflow that posts correctly to the GL, with reports proving it.

This is the most important phase after Phase 3. **Everything else builds on the patterns established here.**

## Modules Built

- Module 3 (full): Sales Quotes, Sales Orders, Invoices, Payments Received, Customer Detail Page

## Pages

- Quotes (List, Editor, View, "Convert to Invoice" action)
- Sales Orders (List, Editor, View, "Convert to Invoice" action)
- Invoices (List, Editor, View)
- Payments Received (List, Editor, View)
- Customer Detail Page (with statement view)

## Backend Logic

- All postings per Doc 3 Part A (A1, A1.b, A5, A6, A7, A8) — sales invoice, COGS, customer receipts, advances
- Document numbering via `document_sequences` table
- Status workflow: draft → confirmed → void
- Edit-as-reversal flow per Doc 3 F1
- Void flow per Doc 3 F2
- Allocation engine for payments (a payment can clear multiple invoices, leftover goes to advance)

## Reports Built (Tier 1 + portion of Tier 2)

- A1 Trial Balance (already built, must continue to balance after every action)
- A3 Profit & Loss (basic version)
- A4 Balance Sheet (basic version)
- B1 AR Aging
- B3 Customer Statement
- E1 Stock Valuation (basic — proves COGS posted correctly)

## Definition of Done — Phase 4

- [ ] User can create a draft invoice (no GL post)
- [ ] User can confirm an invoice → GL posts AR + Sales + VAT, COGS posts Inventory → COGS
- [ ] User can edit a confirmed invoice → reversal + repost mechanism works
- [ ] User can void a confirmed invoice → all postings reversed cleanly
- [ ] User can create a payment, allocate to one or more invoices
- [ ] Overpayment becomes Customer Advance (account 2400)
- [ ] Customer with advance can apply it to a new invoice
- [ ] Quote → Invoice conversion works (partial conversion supported)
- [ ] Invoice has bilingual print preview (template selection in Phase 11)
- [ ] All Tier 1 reports continue to balance after every action

## Verification Test — The Sales Loop Test

This test is the gate for Phase 4. **All assertions must pass.**

```
Scenario: A real GCC auto parts sales workflow

1. Create customer "Al Noor Garage" — credit limit AED 10,000, payment terms 30 days
2. Create quote QUO-001 to Al Noor for 10× brake pads @ AED 145 net = AED 1,450 + 5% VAT = AED 1,522.50
3. Convert QUO-001 to invoice INV-001 (full conversion)
4. ASSERT: Trial Balance shows AR Dr 1,522.50, Sales Cr 1,450, VAT Cr 72.50, Inventory Cr (cost), COGS Dr (cost)
5. ASSERT: Trial Balance still balances (Dr total = Cr total)
6. ASSERT: AR Aging shows Al Noor with 1,522.50 outstanding, "not yet due"
7. ASSERT: Customer Statement shows INV-001 with running balance 1,522.50 Dr
8. ASSERT: Stock Valuation correctly reduced by 10× brake pads at MAC
9. ASSERT: P&L shows revenue 1,450, COGS (cost amount), gross profit positive

10. Receive partial payment: PMT-001 for AED 800
11. Allocate PMT-001 fully to INV-001
12. ASSERT: Trial Balance shows AR Dr reduced by 800, Bank Dr increased by 800, still balances
13. ASSERT: AR Aging shows Al Noor with 722.50 outstanding
14. ASSERT: Customer Statement shows INV-001 plus PMT-001, running balance 722.50

15. Receive overpayment: PMT-002 for AED 1,000
16. Allocate AED 722.50 to INV-001, leave AED 277.50 unallocated
17. ASSERT: AR for Al Noor is now zero
18. ASSERT: Customer Advances (2400) shows 277.50 Cr for Al Noor
19. ASSERT: Trial Balance still balances

20. Create new invoice INV-002 for AED 500
21. Apply available advance (AED 277.50) to INV-002
22. ASSERT: 2400 Customer Advances reduced to zero
23. ASSERT: AR for INV-002 is 222.50

24. Edit INV-001 — change quantity to 12 brake pads (was 10)
25. ASSERT: Original GL rows reversed (mirrored), new GL rows posted
26. ASSERT: Trial Balance still balances after edit
27. ASSERT: Stock Valuation reflects new quantity

28. Void INV-002
29. ASSERT: All INV-002 postings reversed
30. ASSERT: Customer Advance restored to 277.50 Cr (the advance application reversed)
31. ASSERT: Trial Balance still balances
```

**If any assertion fails: STOP. Fix Phase 4. Do not proceed to Phase 5.**

When this test passes, you have a working sales→cash loop. **This is the moment your last build never reached.**

---

# PHASE 5 — Purchase Loop

**Goal:** Mirror of the Sales Loop, for Purchases.

## Modules Built

- Module 4 (full): Purchase Orders, Goods Receipts, Vendor Bills, Vendor Payments, Supplier Detail Page

## Pages

- Purchase Orders (List, Editor, View, "Receive" action)
- Goods Receipts (List, Editor, View, "Bill" action)
- Vendor Bills (List, Editor, View)
- Vendor Payments (List, Editor, View)
- Supplier Detail Page with statement view

## Backend Logic

- All postings per Doc 3 Part B (B1–B8) — PO has no GL, GRN posts to GRN Accrual, Bill clears accrual, Payment clears AP
- 3-way match logic (PO ↔ GRN ↔ Bill quantity reconciliation)
- Variance handling (bill differs from GRN — Doc 3 B3 edge case)
- Vendor advances + applications

## Reports Built

- B2 AP Aging
- B4 Supplier Statement
- D4 GRN Reconciliation Report (unbilled GRNs)

## Definition of Done — Phase 5

- [ ] PO → GRN → Bill flow works end-to-end
- [ ] GRN posts to Inventory + GRN Accrual (no AP yet)
- [ ] Bill clears GRN Accrual + creates AP
- [ ] Bill with different amount than GRN — variance posted to Inventory correctly
- [ ] Payment to supplier reduces AP
- [ ] Vendor advance handling (paying before bill, applying advance to bill later)
- [ ] AP Aging correctly reflects unpaid bills
- [ ] GRN Reconciliation report sums to 2150 GRN Accrual on Trial Balance
- [ ] **MAC updates on every GRN post** — verified by checking product MAC after multiple purchases

## Verification Test — The Purchase Loop Test

```
Scenario: Buying brake pads from Bosch UAE

1. Create supplier "Bosch UAE" with currency AED, payment terms 60 days
2. Create PO-001 to Bosch for 50× brake pads @ AED 100 each = AED 5,000 (no VAT for simplicity)
3. ASSERT: Trial Balance unchanged (PO has no GL impact)

4. Receive GRN-001 against PO-001 — full quantity received
5. ASSERT: Inventory (1300) Dr 5,000, GRN Accrual (2150) Cr 5,000
6. ASSERT: Stock Ledger shows +50 brake pads at AED 100 each in Main warehouse
7. ASSERT: Product MAC = AED 100 (no prior cost)
8. ASSERT: Stock Valuation total increased by AED 5,000

9. Receive Bill BILL-001 from Bosch for AED 5,000 (matches GRN exactly)
10. ASSERT: GRN Accrual (2150) Dr 5,000 (cleared), AP (2100) Cr 5,000
11. ASSERT: Trial Balance: Inventory 5,000 Dr, AP 5,000 Cr (net zero impact, matches reality)

12. Receive GRN-002: 30 more brake pads at AED 110 (price went up)
13. ASSERT: Inventory Dr 3,300, GRN Accrual Cr 3,300
14. ASSERT: Product MAC = (50×100 + 30×110) / 80 = 103.75
15. ASSERT: Stock Valuation: 80 brake pads × 103.75 = 8,300

16. Bill arrives for GRN-002 but supplier billed AED 3,400 (variance of 100)
17. ASSERT: GRN Accrual Dr 3,300, Inventory Dr 100 (absorbed variance), AP Cr 3,400
18. ASSERT: MAC recalculates with the new actual cost

19. Pay Bosch AED 3,000 — allocate fully to BILL-001 partial
20. ASSERT: AP reduced by 3,000, Bank reduced by 3,000

21. AP Aging shows Bosch with outstanding balance equal to remaining
22. Supplier Statement shows BILL-001 (partially paid) and BILL-002 (unpaid)
23. ASSERT: Trial Balance still balances after every step
```

---

# PHASE 6 — Inventory Operations

**Goal:** Multi-warehouse stock management, transfers, adjustments.

## Modules Built

- Module 5 (remaining): Stock Transfers, Inventory Adjustments, Stock Ledger viewer, Serial Numbers

## Pages

- Stock Transfers (List, Editor — from/to warehouse with line items)
- Inventory Adjustments (List, Editor — gain/loss with reasons)
- Stock Ledger (read-only, per product, all movements)
- Product Serials (managed within Product Detail page)

## Backend Logic

- Transfer posting per Doc 3 C1 (no GL impact, two stock_ledger rows)
- Adjustment posting per Doc 3 C2/C3 (gain/loss to GL)
- Serial number lifecycle (available → reserved → sold → returned)

## Reports Built

- E2 Stock Movement Report
- E3 Slow-Moving Items
- E4 Reorder Report
- E5 Stock Aging
- E6 Inventory Adjustment Report

## Definition of Done — Phase 6

- [ ] Transfer between warehouses works — stock decreases in source, increases in destination
- [ ] Transfer is GL-neutral (Trial Balance unchanged)
- [ ] Adjustment with reason 'shrinkage' posts to Inventory Loss (6700)
- [ ] Adjustment with reason 'found' posts to Inventory Gain (4300)
- [ ] Stock valuation report still equals 1300 Inventory after all operations
- [ ] Reorder report correctly identifies products below min stock per warehouse
- [ ] Serial-tracked product workflow: purchase records serial, sale picks specific serial

## Verification Test

```
1. Transfer 20 brake pads from Main WH to Branch WH
2. ASSERT: Main WH stock reduced by 20, Branch WH stock increased by 20
3. ASSERT: Trial Balance unchanged (1300 Inventory same as before)
4. ASSERT: Stock Valuation report unchanged in total, but redistributed

5. Adjust Main WH stock down by 5 (reason: damage)
6. ASSERT: Stock count in Main WH reduced by 5
7. ASSERT: Inventory Loss (6700) Dr (5 × MAC), Inventory (1300) Cr (5 × MAC)
8. ASSERT: Trial Balance still balances
9. ASSERT: P&L shows Inventory Loss as expense

10. Set min stock level for product = 100 in Main WH
11. ASSERT: Reorder report flags this product

12. Add a new serial-tracked product (alternator)
13. Receive 3 alternators with serials SN-A, SN-B, SN-C
14. ASSERT: 3 rows in product_serials, status='available'
15. Sell SN-B
16. ASSERT: SN-B status='sold', other two still 'available'
```

---

# PHASE 7 — POS (Counter Sales)

**Goal:** A fast counter-sale screen optimized for walk-in business. Cash, card, credit modes.

## Modules Built

- Module 3 (POS portion): Counter Sale screen
- POS sessions (open/close with cash reconciliation)

## Pages

- POS screen (`/pos`) — described in Doc 1
- POS Session opening dialog (cashier picks warehouse, enters opening cash)
- POS Session closing dialog (cashier counts cash, system calculates expected, variance shown)

## Backend Logic

- Postings per Doc 3 A2 (cash sale), A3 (card sale), A4 (credit sale)
- POS sale creates an `invoice` row with `sale_channel='pos_*'`, `pos_session_id` set, `status='confirmed'` immediately
- Session reconciliation: closing cash + transactions vs counted cash → variance posts as adjustment if accepted

## Reports Built

- G3 POS Session Report
- G1 Daily Sales Summary

## Definition of Done — Phase 7

- [ ] Counter staff can open a session with opening cash
- [ ] POS product search by SKU + OE number + name (sub-100ms)
- [ ] Vehicle filter chips work
- [ ] Add products to cart, adjust quantities, apply discounts
- [ ] Cash payment: posts to Cash 1100, no AR
- [ ] Card payment: posts to bank settlement account
- [ ] Credit payment: requires customer selection, creates AR (same as regular invoice)
- [ ] Receipt prints (template will be polished in Phase 11)
- [ ] Session close: variance calculated and recorded
- [ ] Keyboard shortcuts work (F2, F4, F8 per Doc 1)

## Verification Test

```
1. Counter user opens POS session with opening cash AED 500
2. Walk-in customer: 1× oil filter @ 35 + 1× brake pad @ 145 = 180 + 9 VAT = 189
3. Pay cash → Cash (1100) Dr 189, Sales Cr 180, VAT Cr 9, COGS posted
4. ASSERT: Trial Balance balances
5. ASSERT: Cash in Hand increased to 500 + 189 = 689 (per session log)

6. Walk-in customer pays card → Bank account Dr 189, similar credit lines
7. Garage runner from "Al Noor" picks up parts → Credit sale → AR Dr (no cash impact)
8. ASSERT: Al Noor's AR aging shows new outstanding
9. ASSERT: POS receipt prints "ON ACCOUNT" stamp

10. Close session: counted AED 689 (matches expected)
11. ASSERT: Variance = 0
12. Close session with mismatch: counted 685 → variance -4
13. Cashier provides reason → recorded in session
```

---

# PHASE 8 — Banking & PDC

**Goal:** Bank transfers, PDC management (received and issued).

## Modules Built

- Module 6 (banking portion): Bank Transfers, PDC Management
- Module 6: Expenses (direct expense booking)

## Pages

- Bank Accounts list (with per-account ledger)
- Bank Transfers (List, Editor)
- PDC Management — Received (list, status workflow)
- PDC Management — Issued (list, status workflow)
- Expenses (List, Editor)

## Backend Logic

- Postings per Doc 3 D1 (bank transfer), D3 (expense), E1–E5 (PDC lifecycle)
- PDC status state machine: pending → deposited → cleared / bounced

## Reports Built

- G2 Daily Cash Report
- G4 Bank Reconciliation Worksheet (basic)

## Definition of Done — Phase 8

- [ ] Bank-to-bank transfer works (same currency)
- [ ] Bank-to-cash transfer works
- [ ] Direct expense posts to expense account + bank/cash
- [ ] PDC received from customer: AR moves to PDC Receivable
- [ ] PDC marked as deposited: status changes only, no GL
- [ ] PDC cleared: PDC Receivable cleared, bank credited
- [ ] PDC bounced: PDC Receivable cleared, Bounced Cheques debited
- [ ] PDC issued: AP moves to PDC Payable
- [ ] PDC issued cleared: PDC Payable cleared, bank debited

## Verification Test

```
1. Customer Al Noor issues PDC due in 30 days for AED 2,000 against INV-001
2. ASSERT: AR reduced by 2,000, PDC Receivable Dr 2,000
3. Customer Statement reflects this

4. After 30 days, deposit PDC at Emirates NBD
5. ASSERT: PDC status = 'deposited', no GL change
6. Bank confirms cleared next day
7. ASSERT: Bank Dr 2,000, PDC Receivable Cr 2,000

8. Another customer issues PDC for AED 1,500
9. Deposit it. Bank returns it as bounced.
10. ASSERT: PDC Receivable cleared, Bounced Cheques (1260) Dr 1,500
11. Customer balance shows 1,500 still owed (in 1260 not 1200)
```

---

# PHASE 9 — Returns & Credit/Debit Notes

**Goal:** Customer returns, supplier returns, credit notes, debit notes.

## Modules Built

- Module 3 (remaining): Sales Returns, Credit Notes
- Module 4 (remaining): Debit Notes

## Pages

- Sales Returns (List, Editor)
- Credit Notes (List, Editor)
- Debit Notes (List, Editor)

## Backend Logic

- Postings per Doc 3 A9 (credit note with restock), A10 (without restock), A11 (bad debt)
- Postings per Doc 3 B9, B10 (debit notes)
- Refund payment flow per Doc 3 F3

## Definition of Done — Phase 9

- [ ] Sales return restocks inventory at original cost-at-sale (not current MAC)
- [ ] Credit note reduces AR + reverses VAT
- [ ] Credit note without restock: AR reduced, no inventory movement
- [ ] Debit note returns goods to supplier, reduces AP
- [ ] Refund payment from cash sale works (3-step flow per Doc 3 F3)
- [ ] All these maintain Trial Balance integrity

## Verification Test

```
1. Customer returns 5× brake pads from INV-001 (originally sold @ MAC 100)
2. Create Sales Return → auto-creates Credit Note
3. ASSERT: 5 brake pads back in stock at unit cost 100 (not current MAC if it changed)
4. ASSERT: Sales Revenue Dr (reduce), VAT Dr (reduce), AR Cr (reduce)
5. ASSERT: COGS reversal: Inventory Dr (5×100), COGS Cr (5×100)
6. ASSERT: Customer Statement shows credit note
7. ASSERT: Trial Balance balances

8. Return goods to Bosch: 10× brake pads from BILL-001
9. Create Debit Note
10. ASSERT: Inventory Cr (10×original cost), AP Dr (reduce by amount)
11. ASSERT: Stock reduced
```

---

# PHASE 10 — Reports Completion

**Goal:** All Tier 2 and Tier 3 reports per Doc 4 Part J. The system is now reporting-complete.

## Reports Built

- A5 Cash Flow Statement
- C1–C6 Sales Reports (by customer, product, brand, vehicle, salesperson, trend)
- D1–D3 Purchase Reports
- F1 UAE VAT Return
- F3 India GST Return (if applicable)
- I1 Audit Log viewer
- I2 Reversal Trail Report

## Dashboards

- H1 Owner's Dashboard
- H2 Salesperson's Dashboard
- H3 Counter Staff Dashboard

## System Health

- The 9 Verification Invariants from Doc 4 Part K, runnable as one button "System Health Check"

## Definition of Done — Phase 10

- [ ] Every report from Doc 4 Tier 2 + Tier 3 is built
- [ ] All 9 Invariants pass on a populated test database
- [ ] Reports support PDF, Excel, CSV export
- [ ] All reports honor RLS (multi-tenant safety)
- [ ] All reports work in EN and AR

## Verification Test

Run the Phase 10 master test on a database populated by Phases 4–9:
- All 9 Invariants pass
- Each report renders without errors
- Each report's totals match the underlying GL queries
- VAT Return shows correct breakdowns per emirate

---

# PHASE 11 — Print Templates & Bilingual Polish

**Goal:** Professional printable documents in EN + AR + bilingual layouts.

## Templates Built (3–5 per document type)

- Invoice templates: Classic, Modern, Compact, Bilingual Split, Thermal POS Receipt
- Quote templates (3 variants)
- Statement templates (2 variants)
- Bill, PO, Credit Note, Debit Note templates (1 each)

## Settings

- Per-doc-type default template selector
- Logo upload
- Company colors (primary, accent)
- Footer text (EN + AR)
- Field toggles (show salesperson, show due date, etc.)
- Bilingual print toggle per template

## Definition of Done — Phase 11

- [ ] All document types have at least one template
- [ ] User can pick default per doc type from settings
- [ ] Bilingual templates render Arabic correctly (RTL within the template)
- [ ] PDF generation works for all templates
- [ ] Logo and company colors applied correctly
- [ ] Thermal POS receipt prints to 80mm width

---

# PHASE 12 — Polish, Multi-currency, Beta

**Goal:** Final hardening before launch.

## Tasks

1. **Multi-currency edge cases**
   - Invoice in foreign currency (Doc 3 J1)
   - Receipt in foreign currency with FX gain/loss (Doc 3 J2)
   - Foreign-currency bank account handling
2. **Performance**
   - Index audit on every table
   - Query optimization for reports with > 50,000 rows
   - Pagination everywhere a list could exceed 100 rows
3. **Mobile responsiveness**
   - Tablet support (counter staff often use tablets)
   - Phone support for owner viewing dashboard on the go
4. **Self-hosted Docker package** (optional for v1 — can defer to v1.1)
   - Dockerfile + docker-compose for the full stack
   - Postgres + the app + a small Express layer replacing Supabase auth
5. **Onboarding flow polish** with sample auto-parts data
6. **Documentation** — user guide in EN + AR
7. **Beta testing** — Pro Parts UAE as customer #1
8. **Bug fixes from beta**

## Definition of Done — Phase 12

- [ ] Pro Parts UAE running on the system for at least 2 weeks without critical issues
- [ ] Multi-currency scenarios all post correctly with FX gain/loss
- [ ] Mobile + tablet UX acceptable
- [ ] All Doc 4 Invariants still pass on a real-data company
- [ ] First external customer onboarded successfully

---

# CROSS-PHASE INVARIANTS (Always True)

These must be true at the END of every phase, not just at the end of v1:

1. **Trial Balance balances** (Doc 4 A1)
2. **Balance Sheet balances** (Doc 4 A4)
3. **AR Aging total = AR account balance** (Doc 4 B1)
4. **AP Aging total = AP account balance** (Doc 4 B2)
5. **Stock Valuation total = Inventory account balance** (Doc 4 E1)
6. **GRN Reconciliation total = GRN Accrual account balance** (Doc 4 D4)
7. **All UI text appears in both EN and AR** (no hardcoded English-only strings)
8. **No console errors in browser dev tools**
9. **No TypeScript errors in build**
10. **All tests pass in CI**

If ANY of these fails, the phase is not done — go back and fix.

---

# WHAT TO DO IF YOU GET STUCK MID-PHASE

The temptation will be to "skip ahead" or "come back to fix later." Resist it.

If you're stuck:

1. **Identify exactly which Doc 3 rule the current behavior violates.** If you can't tell, the ambiguity is in Doc 3 — flag it for clarification before continuing.

2. **Run the verification test for the current phase.** If it fails, the failure point is your bug. Find it and fix.

3. **Check the cross-phase invariants.** If Trial Balance doesn't balance, the answer is in `general_ledger` — find the unbalanced JE.

4. **Don't add features to the current phase to "work around" a bug.** Fix the bug first.

5. **If a fundamental design issue emerges:** stop, document it, and update Doc 2 or Doc 3 BEFORE continuing. Don't just patch the code and let docs drift again.

---

# WHAT THIS DOCUMENT REPLACES

In your previous build:
- Modules were built in parallel without ordering
- No "definition of done" — you kept building features without verifying anything was complete
- No verification tests — bugs accumulated silently
- No invariants — Trial Balance imbalances went undetected for weeks

This document fixes all of that:
- **Strict sequential phases** — one at a time, no exceptions
- **Explicit DoD per phase** — checklist + verification test
- **Cross-phase invariants** — bugs caught immediately
- **Clear "stop and fix" protocol** when things go wrong

---

# SUMMARY — THE DISCIPLINE

If you internalize ONE thing from this document, make it this:

> **The Phase 3 Verification Test must pass before Phase 4 starts. The Phase 4 Sales Loop Test must pass before Phase 5 starts. And so on.**
>
> **No exceptions. No "I'll come back to fix it." No starting the next phase while the current one is half-done.**

Your last build failed because every phase was 80% done and 20% broken. Eight modules at 80% means zero working modules.

This time, every phase is 100% done before the next begins. **Half-finished work doesn't exist in this build.**

---

## Total Estimated Timeline

- Phase 0: 2–3 days
- Phase 1: 1 week
- Phase 2: 1 week
- Phase 3: 1 week (the keystone — could be longer if engine bugs surface, that's fine)
- Phase 4: 2 weeks (the second keystone — never compromise)
- Phase 5: 1.5 weeks
- Phase 6: 1 week
- Phase 7: 1 week
- Phase 8: 1 week
- Phase 9: 1 week
- Phase 10: 1 week
- Phase 11: 1 week
- Phase 12: 1.5 weeks

**Total:** ~13–14 weeks of focused work using Claude Code.

This is a **launchable v1**. After it ships and you have paying customers, v1.1 / v2 features (FIFO, payroll, advanced workflows) come from real customer feedback, not speculation.

---

## Next Steps

After your approval of Doc 5:

**Doc 6 — AGENTS.md for Claude Code.** This is the final document. It's the rulebook Claude Code will read on every session — the "constitution" that prevents drift. It encodes:
- All architecture rules from Docs 1–5
- The sequential phase discipline from this doc
- The "stop and ask, don't invent" protocol when ambiguity arises
- The naming conventions, file structure, and code patterns

After Doc 6, the planning is complete and you can start Phase 0 in Claude Code.

Read this doc carefully. Flag:
- Any phases that should be reordered
- Any DoD checks you'd add or remove
- Any verification tests you'd strengthen
- Any timeline estimates that look too optimistic for your situation

When ready, reply "Doc 5 approved, move to Doc 6."
