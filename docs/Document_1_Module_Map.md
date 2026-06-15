# StockBolt v1 — Document 1: Complete Module Map

**Status:** Final, approved
**Purpose:** The complete inventory of every module, page, screen, and feature in v1. This is the "what gets built" reference.
**Companion to:** Doc 2 (Schema), Doc 3 (Accounting), Doc 4 (Reports), Doc 5 (Phases), Doc 6 (AGENTS.md)

---

## V1 Scope Locked-In Decisions

These decisions shape every module below. They are final for v1.

| Aspect | Decision |
|---|---|
| Deployment | Hybrid (SaaS primary + self-hosted via Docker) |
| Stack | React + Vite + TypeScript + Supabase / PostgreSQL |
| Naming convention | snake_case end-to-end |
| Tenancy | One company per login |
| Customer | Auto parts dealers (GCC + India) |
| Languages | English + Arabic, full RTL, bilingual data |
| Warehouses | Multi-warehouse with stock transfers |
| POS | Walk-in cash + walk-in credit sales |
| Templates | 3–5 fixed templates per doc type, user picks default |
| Costing method | MAC only in v1; FIFO architected for v2; LIFO permanently excluded |
| Payroll | ~~Pushed to v2~~ AMENDED 2026-06-13 (owner override): in v1, phased — P1 employees + runs + GL ✅, P2 WPS + gratuity, P3 loans, P4 leave |

---

## Modules Overview

V1 contains **9 modules**, each composed of multiple pages, forms, and reports. The modules are:

1. Authentication & Onboarding
2. Dashboard
3. Sales
4. Purchases
5. Inventory
6. Accounting
7. Reports
8. POS / Counter Sale (separate fast UI on top of Sales)
9. Admin & Settings

**Excluded from v1 (scope discipline):** Payroll, multi-company switching, project/job costing, manufacturing/BOM, customer portal, automated email integration.

---

## MODULE 1 — Authentication & Onboarding

### Pages

- **Login** — Email + password, "Forgot password" link
- **Register** — Name, email, password, company name, country
- **Forgot Password** — Email entry → reset link sent
- **Reset Password** — Set new password from email link
- **Email Verification** — One-time verification on first login
- **Setup Wizard** — Multi-step, only on first login

### Setup Wizard Steps

1. **Company Details** — Name (EN + AR), address, phone, logo upload
2. **Country & Tax Settings** — UAE/SA/KW/BH/OM/QA/IN, VAT/GST registration, tax ID
3. **Currency & Fiscal Year** — Base currency, fiscal year start date
4. **First Warehouse** — Code, name (EN + AR), address
5. **Bank/Cash Accounts** — At least one bank account or petty cash
6. **Sample Data Choice** — Optional auto parts demo data OR start blank

After the wizard completes, the user lands on the Dashboard.

---

## MODULE 2 — Dashboard

A single-page customizable widget view. Refreshes every 5 minutes.

### Top Row — KPI Tiles
- Today's Sales (count + AED amount)
- Outstanding Receivables (with trend arrow)
- Outstanding Payables
- Cash + Bank balance (sum across all accounts)

### Middle Row — Operational Cards
- Top 5 selling products (this month)
- Top 5 customers by sales (this month)
- Low-stock alerts (count + link to reorder report)
- Overdue invoices (count + link to AR aging)

### Bottom Row — Charts
- Sales trend (last 30 days, daily bars)
- P&L summary (this month vs last month, side-by-side)

### Quick Actions Bar
- New Invoice
- New Bill
- New Payment
- Open POS

Different dashboards exist per role (admin, salesperson, counter staff) — see Module 7 / Doc 4 H1–H3.

---

## MODULE 3 — Sales

### Sub-modules

#### Sales Quotes
- **Quotes List** — Filter by status, customer, date range
- **Quote Editor** — Create/edit draft quotes
- **Quote View** — Read-only display, print, email, convert
- **"Convert to Invoice" action** — Full or partial conversion
- **"Convert to Sales Order" action**

Status flow: `draft → sent → accepted → rejected → expired → partially_invoiced → fully_invoiced → void`

No GL impact (commitment only).

#### Sales Orders
- **Orders List**
- **Order Editor**
- **Order View**
- "Convert to Invoice" action (full or partial)

Status: `draft → confirmed → partially_fulfilled → fulfilled → partially_invoiced → fully_invoiced → void`

No GL impact.

#### Invoices
- **Invoices List** — Filter by status, customer, salesperson, date, warehouse
- **Invoice Editor** — Create/edit, line items with product search, tax calculation, discount per line or total
- **Invoice View** — Read-only, print, email, link to source quote/order

Status: `draft → confirmed → void`

GL effect (per Doc 3 A1): `Dr AR / Cr Sales Revenue + Cr Output VAT`. Plus COGS posting per Doc 3 A1.b.

#### Credit Notes
- **Credit Notes List**
- **Credit Note Editor** — Linked to original invoice or standalone
- Reasons: return, rebate, price correction, damage, goodwill

GL effect per Doc 3 A9 (with restock) or A10 (without).

#### Sales Returns
- **Sales Returns List**
- **Return Editor** — Track physical return, link to invoice
- Auto-generates a credit note on confirm
- Restocks inventory at original `cost_at_sale`

#### Payments Received
- **Payments List**
- **Payment Editor** — Single or multi-document allocation
- Cash, bank, cheque, card payment methods
- Advance receipts (no allocation) → Customer Advances (account 2400)

GL effect per Doc 3 A5 (with allocation), A6 (apply advance), A7 (pure advance).

#### Customers
- **Customers List** — Searchable by name, code, phone, email
- **Customer Detail Page** — Master info + statement of account + recent invoices
- **Add/Edit Modal** — All bilingual fields, credit limit, payment terms, default price level

---

## MODULE 4 — Purchases

### Sub-modules

#### Purchase Orders
- **POs List**
- **PO Editor**
- **PO View**
- "Receive Goods" action → spawns GRN

Status: `draft → sent → partially_received → received → closed → void`

No GL impact (commitment only).

#### Goods Receipt Notes (GRN)
- **GRNs List**
- **GRN Editor** — Receive goods, supports partial receipts against PO
- Direct GRN allowed (no PO required)

GL effect per Doc 3 B2: `Dr Inventory / Cr GRN Accrual`.

#### Vendor Bills
- **Bills List**
- **Bill Editor** — From GRN (auto-populates) or standalone (services)
- Three-way match: PO ↔ GRN ↔ Bill quantity reconciliation
- Variance handling (bill differs from GRN)

GL effect per Doc 3 B3 (from GRN) or B4 (standalone).

#### Debit Notes
- **Debit Notes List**
- **Debit Note Editor** — Return goods to supplier, reduce AP

GL effect per Doc 3 B9 (with return) or B10 (without).

#### Vendor Payments
- **Payments List**
- **Payment Editor** — Allocate to bills or record as vendor advance

GL effect per Doc 3 B5 (allocated), B6 (advance), B7 (apply advance).

#### Suppliers
- **Suppliers List**
- **Supplier Detail Page** — Master info + statement + recent bills
- **Add/Edit Modal** — All bilingual fields, supplier-specific part number mappings

---

## MODULE 5 — Inventory

### Sub-modules

#### Products
- **Products List** — Searchable by SKU, OE number, replacement number, name
- **Product Detail Page** — Full master with all auto-parts fields
- **Add/Edit Form** — Comprehensive

Auto-parts-rich fields:
- SKU (internal code)
- OEM part number
- Replacement/cross-reference numbers (multiple)
- Brand (Bosch, Mahle, Mann, Genuine, etc.)
- Quality tier (Genuine / OEM / Premium / Economy)
- Vehicle compatibility (make / model / year-from / year-to / engine)
- Category, sub-category
- Bilingual name + description
- Selling prices (per price level)
- Per-warehouse stock levels (derived, not stored)
- Reorder level per warehouse
- Serial-number tracking (yes/no)
- Product images (multiple)
- Supplier cross-references

#### Parts Catalog (Browse Mode)
A separate UI for staff at the counter:
- Vehicle-first navigation: Make → Model → Year → Category → Parts
- Visual tile layout with product photos
- Stock and price visible at a glance
- Tap a part to see fitment details

#### Categories
- **Categories List + Tree View**
- Hierarchical (Brakes → Brake Pads → Front)
- Add/Edit form

#### Brands
- **Brands List**
- **Add/Edit** — With logo upload

#### Units of Measure
- **Units List** — PCS, SET, KG, LITRE, BOX, etc.
- Add/Edit

#### Warehouses
- **Warehouses List**
- **Warehouse Editor** — Code, name (EN + AR), address, default flag

#### Stock Transfers
- **Transfers List**
- **Transfer Editor** — From/to warehouse, line items
- Status: `draft → in_transit → completed → void`

GL effect per Doc 3 C1: none (accounting-neutral). Stock ledger gets two rows (out + in).

#### Inventory Adjustments
- **Adjustments List**
- **Adjustment Editor** — Stock counts, shrinkage, damages, found stock
- Reason types: stock_count, damage, shrinkage, found

GL effect per Doc 3 C2 (gain) or C3 (loss).

#### Stock Ledger Viewer
- Read-only, per product
- Movement history with running balance per warehouse

#### Serial Numbers
- Managed within Product Detail page
- For high-value items: alternators, ECUs, AC compressors
- Lifecycle: available → reserved → sold → returned

---

## MODULE 6 — Accounting

### Sub-modules

#### Chart of Accounts
- **COA List** — Pre-seeded standard accounts + user-added
- **Add/Edit Custom Accounts**
- System accounts (1100, 1200, 2100, etc.) cannot be deleted, only renamed

#### Journal Entries
- **JE List** — All manual journal entries
- **JE Editor** — Manual JE creation for adjustments
- Must balance (Dr = Cr) before save
- All postings audited

#### General Ledger
- **GL Viewer** — Filterable by account, date range, period
- Drillable to source documents
- Running balance per account

#### Bank & Cash Accounts
- **Bank Accounts List**
- **Add/Edit** — Account number, IBAN, SWIFT, currency, linked COA account
- **Per-account ledger view** — All transactions touching this account

#### Bank Transfers
- **Transfers List**
- **Transfer Editor** — Move money between own accounts

GL effect per Doc 3 D1.

#### PDC Management
- **PDCs Received** — From customers, with status workflow
- **PDCs Issued** — To suppliers
- Status: `pending → deposited → cleared / bounced / cancelled`

GL effects per Doc 3 E1–E5.

#### Expenses
- **Expenses List**
- **Expense Editor** — Direct expense booking, bypasses vendor bill flow
- Receipt scan attachment

GL effect per Doc 3 D3.

#### Period Lock
- Settings page
- Close month/year — no posting allowed in locked periods

---

## MODULE 7 — Reports

### Categories

The full reports specification is in Doc 4. Summary by category:

**Financial Reports**
- Trial Balance
- Profit & Loss (with comparative periods)
- Balance Sheet (point-in-time)
- Cash Flow Statement

**Receivables / Payables**
- AR Aging (0-30, 31-60, 61-90, 90+)
- AP Aging
- Customer Statement (per customer)
- Supplier Statement (per supplier)

**Sales Reports**
- Sales by Customer
- Sales by Product
- Sales by Salesperson
- Sales by Brand (auto-parts-specific)
- Sales by Vehicle Make/Model (auto-parts-specific)
- Sales Trend (daily/weekly/monthly)

**Purchase Reports**
- Purchases by Supplier
- Purchases by Product
- Outstanding Purchase Orders
- GRN Reconciliation

**Inventory Reports**
- Stock Valuation (per warehouse + total)
- Stock Movement (per product)
- Slow-Moving Items
- Reorder Report
- Stock Aging
- Inventory Adjustment Report

**Tax Reports**
- UAE VAT Return (FTA VAT201 format)
- Saudi VAT Return (ZATCA format)
- India GST Returns (GSTR-1, GSTR-3B helpers)

**Daily Operations**
- Daily Sales Summary
- Daily Cash Report
- POS Session Report
- Bank Reconciliation Worksheet

**Audit & System**
- Audit Log
- Reversal Trail Report
- System Health Check (the 9 invariants)

---

## MODULE 8 — POS / Counter Sale

A separate route (`/pos`) optimized for one task: sell to a walk-in customer in under 30 seconds.

### Layout
- **Big product search bar** — Searches SKU, OE number, name simultaneously
- **Vehicle filter chips** — Quick-select Make → Model → Year
- **Cart panel** — Items, quantities, line/total discount, running total
- **Customer field** — Defaults to "Walk-in Customer", optional named customer for credit
- **Three big payment buttons** — Cash | Card | Credit
- **Auto-print receipt** — On payment confirm
- **Keyboard shortcuts** — F2 (search), F4 (payment), F8 (print)

### Three Payment Modes
- **Cash** — `Dr Cash / Cr Sales + Cr Output VAT` (Doc 3 A2)
- **Card** — `Dr Bank / Cr Sales + Cr Output VAT` (Doc 3 A3)
- **Credit** — Requires customer selection. `Dr AR / Cr Sales + Cr Output VAT` (Doc 3 A4 = same as A1, just different UI)

### POS Sessions
- Cashier opens session with opening cash count
- All POS sales link to the session
- Cashier closes session at end of shift with cash reconciliation
- Variance tracked with required reason

### Daily Cash Drawer
- Running cash total visible during session
- End-of-day reconciliation per Doc 4 G3

---

## MODULE 9 — Admin & Settings

### Sub-modules

#### Company Settings
- Edit company info (name, address, phone, logo)
- Edit tax registration (TRN, GSTIN)
- Edit fiscal year start
- Edit base currency

#### User Management
- Add team members
- Assign roles: admin / accountant / sales / counter / viewer
- Per-user warehouse assignment (sales/counter staff)
- Activate/deactivate users

#### Role & Permissions
- Locked role definitions in v1 (admin/accountant/sales/counter/viewer)
- Permission matrix shows what each role can do
- Custom roles deferred to v2

#### Price Levels
- Default levels: Retail, Wholesale, Garage, Distributor
- Each with markup % from cost
- Optional per-product price override

#### Tax Settings
- Default tax rates
- Tax categories (standard, zero_rated, exempt)
- Per-country variations

#### Document Number Settings
- Per-doc-type prefix (INV, PO, BILL, PMT, JE, CN, DN, GRN, TRF, ADJ, EXP, PDC)
- Starting number, padding, optional yearly reset

#### Email Templates
- Invoice email
- Statement email
- Payment reminder
- (Editable EN + AR)

#### Print Templates
- 3–5 templates per document type (per Doc 1 / Doc 5 Phase 11)
- Per-doc-type default selector
- Logo, color, footer customization
- Bilingual print toggle

#### Backup & Restore
- Manual export
- Scheduled backups (cloud mode)
- Self-hosted: documented backup procedure

#### Audit Log Viewer
- Read-only view
- Filter by user, action type, entity type, date range

#### System Health
- Run the 9 invariants on demand (Doc 4 Part K)
- Green/red status per invariant
- Database stats, storage usage, last backup time

---

## Cross-Module Concerns

### Internationalization (EN + AR)
Every module above must work in both languages with full RTL support. This is checked in every phase's Definition of Done (Doc 5).

### Multi-Currency
Documents may be raised in foreign currency. The GL is always posted in base currency with FX gain/loss calculated automatically (Doc 3 J1–J3).

### Multi-Warehouse
Stock-affecting modules (sales, purchases, inventory, POS) all support warehouse selection. Reports break down by warehouse.

### Audit Logging
Every significant action (post, edit, void, login, period lock change) creates an `audit_logs` row. Read-only forever.

### Period Lock
When a period is locked, no posting is allowed in or before that period. Reports still show data; only posting is blocked.

---

## What's Excluded From V1 (For Reference)

These were considered and explicitly deferred:

- **Payroll** — Module deferred to v2 (8,000+ lines of code, doesn't overlap with auto-parts ERP value)
- **Multi-company switching** — Locked to one company per login
- **Loans & Advances tracking** — Part of payroll, deferred
- **Attendance / Leave tracking** — Part of payroll
- **Project / Job costing** — Specialized, low demand
- **Manufacturing / BOM** — Irrelevant for parts trading
- **Email-sending integration (SMTP)** — v1 generates `mailto:` links instead
- **Public-facing customer portal** — v2
- **Custom report builder** — v2
- **Workflow approvals (maker-checker)** — v2
- **API access for third-party integrations** — v2
- **Mobile native apps** — v2 (responsive web works on tablet/phone)
- **FIFO costing** — v2 (architecture supports it; abstraction layer in v1)
- **LIFO costing** — Permanently excluded (banned under IFRS)

---

## Document Index

This document complements:
- **Doc 2 — Database Schema:** The tables backing every module above
- **Doc 3 — Accounting Rulebook:** The GL effect of every action
- **Doc 4 — Reports Spec:** The exact formulas for every report listed in Module 7
- **Doc 5 — Build Phases:** The order in which modules are built
- **Doc 6 — AGENTS.md:** The rules Claude Code follows when building

For a complete picture of v1, all six documents must be read together. This Module Map is the entry point.

— End of Document 1 —
