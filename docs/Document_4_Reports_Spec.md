# StockBolt v1 — Document 4: Reports Specification

**Status:** Final draft for review
**Purpose:** The single source of truth for every report. Every number on every screen must be derivable from this document.
**Companion to:** Doc 2 (Schema), Doc 3 (Accounting Rulebook)

---

## How to Read This Document

Each report below specifies:

1. **Purpose** — what business question it answers
2. **Inputs** — filters and parameters the user provides
3. **Source tables** — which tables provide the data
4. **Formula / Logic** — pseudocode or SQL pattern showing how numbers are computed
5. **Output columns** — exactly what the user sees
6. **Drill-down** — what each row links to
7. **Verification rule** — how to know the report is correct
8. **Performance notes** — indexes, caching, pagination

---

## Universal Rules For Every Report

These apply to ALL reports without exception.

### Rule 1 — Reports Read, They Never Write
A report query is read-only. It does not insert, update, or delete any data. If a user wants to act on what they see, the report links to the underlying document.

### Rule 2 — Reports Always Filter by Company
Every query starts with `WHERE company_id = $current_company`. RLS enforces this in cloud mode; the application enforces it in self-hosted mode. **No exceptions.**

### Rule 3 — Reports Always Honor Reversal Rules
Any GL or stock_ledger query MUST exclude reversed rows. The standard exclusion pattern:

```sql
-- For general_ledger:
WHERE id NOT IN (
  SELECT reversal_of_id FROM general_ledger
  WHERE reversal_of_id IS NOT NULL AND company_id = $current_company
)
AND reversal_of_id IS NULL  -- and the row itself is not a reversal

-- Equivalent for stock_ledger.
```

This pattern is encapsulated in a database VIEW called `gl_active` and `stock_active` so reports never write the exclusion logic themselves. They just `SELECT FROM gl_active WHERE ...`.

### Rule 4 — Money Always In Base Currency
Every monetary number on every report is in the company's base currency, derived from `general_ledger` (which is always in base currency by Rule 6 of Doc 3).

For multi-currency contexts (a single foreign customer's statement), reports may also show original currency, but the **totals are always base currency**.

### Rule 5 — Dates Are Inclusive On Both Ends
"Date range March 1 to March 31" includes both March 1 and March 31. Standard SQL pattern: `WHERE date BETWEEN $start AND $end`. Reports always show the date range used in the header.

### Rule 6 — All Reports Show "As of" Timestamp
Every report's header shows when it was generated. Helps with audit and reconciliation when numbers change between runs.

### Rule 7 — Drafts Don't Show in Financial Reports
Documents with `status='draft'` have no GL entries (per Doc 3). They don't appear in trial balance, P&L, balance sheet, etc. They DO appear in their own list views (e.g., draft invoices show in the Invoices list with a "DRAFT" badge).

### Rule 8 — Period Lock Doesn't Hide Data
Reports show all data regardless of period lock. Period lock prevents *posting*, not viewing.

### Rule 9 — Numbers Round at Display, Not at Calculation
Calculations use full precision. Display rounds to 2 decimals (or 3 for quantities). This prevents rounding-drift errors in totals.

### Rule 10 — Every Report Is Exportable
PDF, Excel (XLSX), and CSV. Same data, different format. Excel/CSV exports include filter parameters as a header row so the file is self-documenting.

---

# PART A — FINANCIAL REPORTS

## A1. Trial Balance

**Purpose:** Verify the books balance. Every account's net debit or credit position as of a given date. Total debits MUST equal total credits.

**Inputs:**
- `as_of_date` (default: today)
- `show_zero_balances` (default: false)

**Source tables:** `gl_active` (the view), `chart_of_accounts`

**Formula:**

```sql
SELECT
  coa.code,
  coa.name,
  coa.name_ar,
  coa.type,
  SUM(gl.debit) AS total_debit,
  SUM(gl.credit) AS total_credit,
  SUM(gl.debit) - SUM(gl.credit) AS net_balance
FROM chart_of_accounts coa
LEFT JOIN gl_active gl ON gl.account_id = coa.id AND gl.date <= $as_of_date
WHERE coa.company_id = $company_id
GROUP BY coa.id, coa.code, coa.name, coa.name_ar, coa.type
HAVING ($show_zero_balances = TRUE OR SUM(gl.debit) <> 0 OR SUM(gl.credit) <> 0)
ORDER BY coa.code;
```

**Output columns:**
| Code | Account Name | Type | Debit | Credit |
|---|---|---|---|---|
| 1100 | Cash in Hand | Asset | 5,420.00 | — |
| 1200 | Accounts Receivable | Asset | 23,890.50 | — |
| 2100 | Accounts Payable | Liability | — | 14,200.00 |
| ... | ... | ... | ... | ... |
| **TOTAL** | | | **187,420.50** | **187,420.50** |

**Display rule:**
- Asset/Expense accounts: net positive = Debit column, negative = Credit column
- Liability/Equity/Income accounts: net positive = Credit column, negative = Debit column
- Account groups (parent accounts) sum their children — shown as expandable rows

**Drill-down:** Click any account → opens General Ledger filtered to that account.

**Verification rule:**
**`SUM(debit) MUST EQUAL SUM(credit)`**.
If they don't equal, the books are broken — display a red banner: "Trial balance out of balance. Difference: AED X. Run system audit."
This should never happen if Doc 3 rules are followed correctly.

**Performance:** With 100,000+ GL rows, this query runs in <500ms with index on `(account_id, date, company_id)`. No caching needed.

---

## A2. General Ledger (Account-Level Detail)

**Purpose:** Every transaction that hit a specific account, in date order, with running balance.

**Inputs:**
- `account_id` (required)
- `from_date`, `to_date`
- `contact_id` (optional — for AR/AP analytics)

**Source tables:** `gl_active`, `journal_entries`, `chart_of_accounts`

**Formula:**

```sql
SELECT
  gl.date,
  je.entry_number,
  je.description,
  je.source_type,
  gl.debit,
  gl.credit,
  -- Running balance computed in window function
  SUM(gl.debit - gl.credit) OVER (ORDER BY gl.date, gl.id) AS running_balance,
  gl.contact_id,
  contact.name AS contact_name
FROM gl_active gl
JOIN journal_entries je ON je.id = gl.journal_entry_id
LEFT JOIN contacts contact ON contact.id = gl.contact_id
WHERE gl.account_id = $account_id
  AND gl.date BETWEEN $from_date AND $to_date
ORDER BY gl.date, gl.id;
```

**Output columns:**
| Date | JE# | Description | Source | Debit | Credit | Running Balance | Contact |
|---|---|---|---|---|---|---|---|
| 2026-04-01 | JE-1023 | Sales Invoice INV-1023 | sales_invoice | 1,050.00 | — | 1,050.00 | Al Noor Garage |
| 2026-04-05 | JE-1027 | Receipt PMT-0044 | customer_receipt | — | 1,050.00 | 0.00 | Al Noor Garage |

**Drill-down:** Click any row → opens the source document (invoice, payment, etc.).

**Verification:** Final running balance = the trial balance figure for this account on `to_date`.

**Performance:** Paginated at 100 rows per page. Use index `(account_id, date, id)`.

---

## A3. Profit & Loss Statement

**Purpose:** Income vs. expenses for a period. Shows gross profit, operating profit, and net profit.

**Inputs:**
- `from_date`, `to_date`
- `compare_with_previous` (optional, default false)
- `compare_with_year_ago` (optional)

**Source tables:** `gl_active`, `chart_of_accounts`

**Formula:**

```sql
-- For each income/cogs/expense account, sum movements in the period
SELECT
  coa.code,
  coa.name,
  coa.type,
  coa.sub_type,
  CASE
    WHEN coa.type = 'income' THEN SUM(gl.credit) - SUM(gl.debit)
    WHEN coa.type IN ('expense') THEN SUM(gl.debit) - SUM(gl.credit)
  END AS amount
FROM chart_of_accounts coa
LEFT JOIN gl_active gl ON gl.account_id = coa.id
  AND gl.date BETWEEN $from_date AND $to_date
WHERE coa.company_id = $company_id
  AND coa.type IN ('income', 'expense')
GROUP BY coa.id;
```

**Output structure (the actual report layout):**

```
PROFIT & LOSS STATEMENT
For the period: April 1, 2026 to April 30, 2026

INCOME
  Sales Revenue (4100)                         180,420.00
  Other Income (4200)                            2,500.00
  Inventory Gain (4300)                            150.00
  Less: Sales Discounts (4150)                  (1,200.00)
  ──────────────────────────────────────────
  TOTAL INCOME                                 181,870.00

COST OF GOODS SOLD
  Cost of Goods Sold (5100)                    102,300.00
  Less: Purchase Discounts (5200)                 (480.00)
  ──────────────────────────────────────────
  TOTAL COGS                                   101,820.00

GROSS PROFIT                                    80,050.00       (44.0%)

OPERATING EXPENSES
  Salaries & Benefits (6100)                     8,400.00
  Rent & Utilities (6200)                        4,200.00
  Logistics & Shipping (6400)                    1,150.00
  General & Administrative (6500)                  890.00
  Bank Charges (6600)                              210.00
  Inventory Loss (6700)                            340.00
  ──────────────────────────────────────────
  TOTAL OPERATING EXPENSES                      15,190.00

OPERATING PROFIT                                64,860.00       (35.7%)

OTHER ITEMS
  Foreign Exchange Gain (4400)                     230.00
  Foreign Exchange Loss (6900)                    (110.00)
  Bad Debts (6800)                                 (50.00)
  ──────────────────────────────────────────
  NET OTHER                                        70.00

NET PROFIT                                      64,930.00       (35.7%)
```

**Comparison columns:** When `compare_with_previous=true`, add a column showing the same calculation for the previous equivalent period (March 1–31). Show variance as both absolute and %.

**Drill-down:** Click any line → General Ledger for that account, filtered to the period.

**Verification:**
- Net Profit on this report = Net change in Retained Earnings (3100) + ALL movements in income/expense accounts during the period.
- After year-end close (Doc 3, G2), all 4xxx/5xxx/6xxx accounts close to 3100. Running this report for the closed year shows zero everywhere except as historical record.

---

## A4. Balance Sheet

**Purpose:** Snapshot of assets, liabilities, and equity at a point in time. Must balance: Assets = Liabilities + Equity.

**Inputs:**
- `as_of_date` (default: today)
- `compare_with_year_ago` (optional)

**Source tables:** `gl_active`, `chart_of_accounts`

**Formula:** For each account, the **cumulative balance from inception to as_of_date**.

```sql
-- Asset accounts: SUM(debit - credit) cumulative
-- Liability/Equity accounts: SUM(credit - debit) cumulative

SELECT
  coa.code,
  coa.name,
  coa.type,
  coa.sub_type,
  CASE
    WHEN coa.type IN ('asset', 'expense') THEN SUM(gl.debit) - SUM(gl.credit)
    WHEN coa.type IN ('liability', 'equity', 'income') THEN SUM(gl.credit) - SUM(gl.debit)
  END AS balance
FROM chart_of_accounts coa
LEFT JOIN gl_active gl ON gl.account_id = coa.id AND gl.date <= $as_of_date
WHERE coa.company_id = $company_id
  AND coa.type IN ('asset', 'liability', 'equity')
GROUP BY coa.id;
```

**Plus:** Net profit/loss YTD = sum of all income - all expenses from fiscal year start to as_of_date. This is shown in equity as "Current Year Earnings" (a virtual line, not a real account).

**Output structure:**

```
BALANCE SHEET
As of: April 30, 2026

ASSETS
  Current Assets
    Cash in Hand (1100)                            5,420.00
    Bank Accounts (1110-series)                   84,200.00
    Accounts Receivable (1200)                    23,890.50
    PDC Receivable (1250)                          7,500.00
    Inventory Asset (1300)                       142,800.00
    Vendor Advances (1400)                         3,200.00
    Input VAT (1500)                               1,840.00
    ──────────────────────────────────────────
    TOTAL CURRENT ASSETS                         268,850.50

  Fixed Assets
    [Office Equipment, Vehicles, etc. — user-added]
    ──────────────────────────────────────────
    TOTAL FIXED ASSETS                                 0.00
  
  ──────────────────────────────────────────────
  TOTAL ASSETS                                   268,850.50

LIABILITIES
  Current Liabilities
    Accounts Payable (2100)                       14,200.00
    GRN Accrual (2150)                             3,800.00
    Output VAT Payable (2200)                      9,021.00
    Customer Advances (2400)                       1,500.00
    PDC Payable (2450)                             2,000.00
    ──────────────────────────────────────────
    TOTAL LIABILITIES                             30,521.00

EQUITY
  Owner's Equity (3200)                          150,000.00
  Retained Earnings (3100)                        23,399.50
  Current Year Earnings                           64,930.00
  ──────────────────────────────────────────
  TOTAL EQUITY                                   238,329.50

TOTAL LIABILITIES + EQUITY                      268,850.50
```

**Verification rule:**
**`Total Assets MUST EQUAL Total Liabilities + Total Equity`**.
If not, the books are broken. Show red banner.

This is the most important consistency check in the entire ERP. It must always balance.

---

## A5. Cash Flow Statement (Indirect Method)

**Purpose:** Where did cash come from and where did it go during the period.

**Inputs:** `from_date`, `to_date`

**Source tables:** Derived from `general_ledger` movements + opening/closing balances of cash/bank accounts.

**Logic:** Indirect method — start with net profit, adjust for non-cash items, adjust for working capital changes, add cash from financing/investing.

```
NET PROFIT (from P&L)                           64,930.00

Adjustments for non-cash items:
  Add back: Inventory Loss                          340.00
  Subtract: Inventory Gain                         (150.00)

Changes in working capital:
  (Increase) / Decrease in AR                  (8,200.00)
  (Increase) / Decrease in Inventory          (12,400.00)
  Increase / (Decrease) in AP                    3,500.00
  Increase / (Decrease) in Customer Advances     1,500.00

NET CASH FROM OPERATING ACTIVITIES              49,520.00

INVESTING ACTIVITIES
  Purchase of Fixed Assets                            0.00
NET CASH FROM INVESTING ACTIVITIES                  0.00

FINANCING ACTIVITIES
  Owner's Capital Injection                           0.00
  Owner's Drawings                                    0.00
NET CASH FROM FINANCING ACTIVITIES                  0.00

NET INCREASE IN CASH                            49,520.00

Cash at start of period                         40,100.00
Cash at end of period                           89,620.00
```

**Verification:** Closing cash on this report MUST equal sum of all cash + bank account balances on the Balance Sheet on `to_date`.

**Note for v1:** This is a calculated report, not user-entered. Working-capital deltas come from comparing balance sheet snapshots at start and end of period.

---

# PART B — RECEIVABLES & PAYABLES

## B1. AR Aging Report

**Purpose:** Show outstanding customer balances bucketed by how overdue they are.

**Inputs:**
- `as_of_date` (default: today)
- `customer_id` (optional, for single-customer view)

**Source tables:** `invoices`, `payment_allocations`, `payments`, `credit_notes`, `gl_active`

**Logic:**

For each customer, for each unpaid (or partially paid) invoice, calculate:
- `outstanding = invoice.total_amount - SUM(allocations against this invoice) - SUM(credit notes applied to this invoice)`
- `days_overdue = today - invoice.due_date` (negative = not yet due)
- Bucket:
  - Not Yet Due (days_overdue ≤ 0)
  - 0–30 days overdue
  - 31–60 days overdue
  - 61–90 days overdue
  - 90+ days overdue

**Output columns:**
| Customer | Total Outstanding | Not Due | 0-30 | 31-60 | 61-90 | 90+ |
|---|---|---|---|---|---|---|
| Al Noor Garage | 12,400.00 | 5,000.00 | 4,200.00 | 3,200.00 | 0.00 | 0.00 |
| Bahar Auto Spares | 8,200.00 | 0.00 | 0.00 | 4,200.00 | 4,000.00 | 0.00 |
| **TOTAL** | **23,890.50** | **5,000.00** | **8,400.00** | **8,490.50** | **2,000.00** | **0.00** |

**Drill-down:** Click customer → expanded view showing each unpaid invoice with date, due date, original amount, paid amount, outstanding, days overdue.

**Verification:**
- Sum of "Total Outstanding" column MUST equal AR account balance (1200) on Trial Balance as of same date.
- This is THE consistency check between the document layer and the GL layer. If they don't match, there's a bug.

**Performance notes:** Materialize as a daily snapshot if customer count > 1000. For most users, calculate on-demand.

---

## B2. AP Aging Report

**Purpose:** Same as AR Aging, but for vendor bills owed.

Identical structure to B1, but reads from `vendor_bills` and uses 2100 (Accounts Payable) for verification.

**Verification:**
- Sum of outstanding MUST equal AP account balance (2100) on Trial Balance.

---

## B3. Customer Statement

**Purpose:** Detailed account history for a single customer, in chronological order, with running balance. The document you email to a customer when they ask "what do I owe you?"

**Inputs:**
- `customer_id` (required)
- `from_date`, `to_date` (default: company fiscal year)

**Source tables:** `gl_active` filtered by `contact_id = customer`, `account_id IN (1200, 2400, 1250, 1260)`

**Output:**

```
STATEMENT OF ACCOUNT
Customer: Al Noor Garage
Period: Jan 1, 2026 to Apr 30, 2026

Date         Document       Description              Debit      Credit    Balance
─────────────────────────────────────────────────────────────────────────────────
Jan 1, 2026  -              Opening Balance                                2,500.00 Dr
Jan 5, 2026  INV-1018       Sales Invoice          3,200.00            5,700.00 Dr
Jan 12, 2026 PMT-0029       Receipt                            1,500.00 4,200.00 Dr
Feb 8, 2026  INV-1023       Sales Invoice          1,050.00            5,250.00 Dr
Feb 15, 2026 PMT-0044       Receipt                            5,250.00      0.00
...
Apr 28, 2026 INV-1067       Sales Invoice          4,200.00            4,200.00 Dr
─────────────────────────────────────────────────────────────────────────────────
                                          Closing Balance:           4,200.00 Dr
```

**Includes:**
- Sales invoices (Dr to AR)
- Customer receipts (Cr to AR)
- Credit notes (Cr to AR)
- Customer advances (Cr to 2400)
- Advance applications (Dr to 2400, Cr to 1200)
- PDC creations (Dr to 1250, Cr to 1200)
- PDC clearances and bounces

**Verification:** Closing balance on statement = customer's net position from `gl_active` (sum across 1200, 2400, 1250, 1260 with sign respected).

**Print template:** Bilingual EN/AR available, with company letterhead and "PAY THIS BALANCE" highlighted.

---

## B4. Supplier Statement

Same as B3 but for a supplier. Reads accounts 2100 (AP), 1400 (Vendor Advances), 2450 (PDC Payable).

---

# PART C — SALES REPORTS

## C1. Sales by Customer

**Purpose:** Who's buying from us most.

**Inputs:** `from_date`, `to_date`, `top_n` (default 50)

**Source tables:** `invoices`, `invoice_items`, `credit_notes`

**Formula:**

```sql
SELECT
  c.id, c.name, c.name_ar,
  COUNT(DISTINCT i.id) AS invoice_count,
  SUM(i.subtotal) AS gross_sales,
  COALESCE(SUM(cn.subtotal), 0) AS returns,
  SUM(i.subtotal) - COALESCE(SUM(cn.subtotal), 0) AS net_sales,
  -- Calculate gross profit using cost_at_sale
  SUM(i.subtotal) - SUM(items.cost_at_sale * items.quantity) AS gross_profit
FROM contacts c
LEFT JOIN invoices i ON i.contact_id = c.id
  AND i.status = 'confirmed'
  AND i.date BETWEEN $from_date AND $to_date
LEFT JOIN invoice_items items ON items.invoice_id = i.id
LEFT JOIN credit_notes cn ON cn.contact_id = c.id
  AND cn.status = 'confirmed'
  AND cn.date BETWEEN $from_date AND $to_date
WHERE c.type IN ('customer', 'both')
GROUP BY c.id
ORDER BY net_sales DESC
LIMIT $top_n;
```

**Output:** Customer | Invoice Count | Gross Sales | Returns | Net Sales | Gross Profit | GP %

**Drill-down:** Click customer → list of invoices in the period.

---

## C2. Sales by Product

**Purpose:** What's selling.

**Inputs:** `from_date`, `to_date`, `top_n`, `category_id` (optional), `brand_id` (optional)

**Output:** SKU | Product Name | Brand | Qty Sold | Net Sales | Gross Profit | GP%

**Special view:** "Slow movers" — products with zero or near-zero sales in the period.

---

## C3. Sales by Brand (Auto-Parts Specific)

**Purpose:** Which brands generate the most revenue. Critical for purchase planning and supplier negotiations.

**Inputs:** `from_date`, `to_date`

**Output:** Brand | Qty Sold | Revenue | GP | GP% | Stock Value (current)

This is THE report owners look at to decide which brand relationships to deepen.

---

## C4. Sales by Vehicle Make/Model (Auto-Parts Specific)

**Purpose:** Which vehicles are driving demand. If 60% of sales are Mercedes parts, you stock more Mercedes parts.

**Inputs:** `from_date`, `to_date`, `make_id` (optional drill-down)

**Logic:** Joins `invoice_items` → `products` → `product_compatibility` → `vehicle_makes` / `vehicle_models`. Aggregates sales value to the **most specific compatibility** of each product.

**Output:** Vehicle Make | Vehicle Model | Qty | Revenue | GP

**Edge case:** A product fits multiple vehicles. Default behavior: count the sale ONCE under each vehicle it fits (so the totals will exceed total sales). Add a footnote: "A product compatible with multiple vehicles is counted under each."
Alternative behavior: assign sale to the vehicle marked as "primary fitment." User picks the mode in report settings.

---

## C5. Sales by Salesperson

**Purpose:** Performance tracking. Especially useful for outdoor sales reps (relevant to your workflow at Pro Parts).

**Output:** Salesperson | Invoice Count | Net Sales | GP | GP% | Avg Invoice Value

---

## C6. Sales Summary by Day / Week / Month

**Purpose:** Trend analysis.

**Output:** Time Bucket | Invoice Count | Gross Sales | Returns | Net Sales | GP

Visualized as a bar/line chart on the dashboard.

---

# PART D — PURCHASE REPORTS

## D1. Purchases by Supplier

Mirror of C1 but for vendor bills. Output: Supplier | Bill Count | Gross Purchases | Returns | Net Purchases | % of Total Purchases

## D2. Purchases by Product

Output: SKU | Product Name | Qty Purchased | Total Cost | Avg Unit Cost (period)

## D3. Outstanding Purchase Orders

Open POs that haven't been fully received yet. Helps with cash flow planning ("we have AED 45,000 of orders coming in").

**Output:** PO# | Supplier | Date | Expected Delivery | Total | Received Value | Pending Value

## D4. GRN Reconciliation Report

Goods receipts not yet billed (the 2150 GRN Accrual liability). Helps catch missing supplier bills.

**Verification:** Total of "unbilled GRNs" MUST equal balance of 2150 GRN Accrual on Trial Balance.

---

# PART E — INVENTORY REPORTS

## E1. Stock Valuation Report

**Purpose:** What's the inventory worth, by warehouse and product. **THE** report auditors care most about for inventory.

**Inputs:**
- `as_of_date` (default: today)
- `warehouse_id` (optional, otherwise all warehouses)
- `category_id`, `brand_id` (optional filters)

**Source tables:** `stock_active` (the view), `products`

**Formula:**

```sql
SELECT
  p.sku,
  p.name,
  p.name_ar,
  p.brand_id,
  w.id AS warehouse_id,
  w.name AS warehouse_name,
  -- Quantity = sum of stock movements for this product+warehouse up to as_of_date
  SUM(sl.quantity * sl.direction) AS quantity_on_hand,
  -- Current MAC for this product (company-wide in v1)
  -- Computed via the costing strategy
  costing_strategy.get_current_mac(p.id) AS unit_cost,
  SUM(sl.quantity * sl.direction) * costing_strategy.get_current_mac(p.id) AS stock_value
FROM products p
LEFT JOIN stock_active sl ON sl.product_id = p.id AND sl.date <= $as_of_date
LEFT JOIN warehouses w ON w.id = sl.warehouse_id
WHERE p.company_id = $company_id
GROUP BY p.id, w.id
HAVING SUM(sl.quantity * sl.direction) > 0
ORDER BY p.name, w.name;
```

**Output columns:**
| SKU | Product | Brand | Warehouse | Qty | Unit Cost (MAC) | Stock Value |
|---|---|---|---|---|---|---|
| BP-MB-W213 | Front Brake Pad Set | Bosch | Main WH | 24 | 145.00 | 3,480.00 |
| BP-MB-W213 | Front Brake Pad Set | Bosch | Branch WH | 8 | 145.00 | 1,160.00 |
| OF-MB-271 | Oil Filter | Mahle | Main WH | 156 | 32.00 | 4,992.00 |

**Subtotals:** By warehouse, by brand, by category. Grand total at bottom.

**Verification:**
**`SUM of all stock_value MUST equal balance of 1300 Inventory Asset on Trial Balance, as of same date`**.
If they don't match, the GL and stock ledger have drifted — major bug. Show red banner.

This is the second most important consistency check after Balance Sheet balancing.

**Performance:** With 10,000 SKUs across 5 warehouses, this is 50,000 rows — paginate, cache snapshot per `as_of_date`.

---

## E2. Stock Movement Report (Per Product)

**Purpose:** Every movement of one product across all warehouses, in chronological order, like a "passport" for the SKU.

**Inputs:** `product_id`, `from_date`, `to_date`

**Output:**
| Date | Doc | Type | Warehouse | Qty In | Qty Out | Running Qty | Unit Cost | Running MAC |
|---|---|---|---|---|---|---|---|---|
| 2026-04-01 | GRN-001 | Purchase | Main WH | 50 | — | 50 | 145.00 | 145.00 |
| 2026-04-03 | INV-1023 | Sale | Main WH | — | 2 | 48 | 145.00 | 145.00 |
| 2026-04-05 | TRF-002 | Transfer Out | Main WH | — | 10 | 38 | — | 145.00 |
| 2026-04-05 | TRF-002 | Transfer In | Branch WH | 10 | — | 10 | — | 145.00 |
| 2026-04-12 | GRN-008 | Purchase | Main WH | 30 | — | 68 (Main) | 152.00 | 147.59 |

**Drill-down:** Click any row → opens the source document (GRN, invoice, transfer).

---

## E3. Slow-Moving Items

**Purpose:** Products that haven't moved in N days. Capital tied up in dead stock.

**Inputs:** `days_threshold` (default 90), `warehouse_id` (optional)

**Output:** SKU | Product | Brand | Qty | Stock Value | Last Sale Date | Days Since Last Sale

Sortable by stock value descending — see the biggest dead capital first.

---

## E4. Reorder Report

**Purpose:** Products at or below reorder level — what to buy next.

**Inputs:** `warehouse_id` (optional)

**Output:** SKU | Product | Brand | Warehouse | Current Qty | Min Level | To Reorder | Last Cost | Suggested Supplier

"Suggested Supplier" = supplier from `product_supplier_codes` with most recent purchase.

**Drill-down:** "Create PO" button populates a draft PO with all the items grouped by suggested supplier.

---

## E5. Stock Aging Report

**Purpose:** How long current stock has been sitting in the warehouse. Helps identify obsolescence risk.

**Output:** SKU | Product | Qty | Stock Value | 0-30 days | 31-90 days | 91-180 days | 180+ days

Aging is determined by the date of the OLDEST `purchase` movement that contributes to current quantity (using FIFO logic for aging only — independent of costing method).

---

## E6. Inventory Adjustment Report

**Purpose:** All shrinkage, damage, found stock entries.

**Output:** Date | Adjustment# | Warehouse | Reason | Items | Total Value Impact (+/-)

Verification: Sum of all "value impact" entries in the period = Inventory Loss (6700) - Inventory Gain (4300) movements in the same period.

---

# PART F — TAX REPORTS

## F1. UAE VAT Return Summary

**Purpose:** The numbers needed to file the FTA's VAT201 form.

**Inputs:** `period_start`, `period_end` (typically a quarter)

**Output structure (matches FTA form):**

```
VAT RETURN — UAE FTA Format
Period: Q2 2026 (April 1 – June 30, 2026)

VAT ON SALES AND ALL OTHER OUTPUTS

Box 1a Standard Rated Supplies — Abu Dhabi          0.00
Box 1b Standard Rated Supplies — Dubai             52,400.00
Box 1c Standard Rated Supplies — Sharjah          120,800.00
Box 1d Standard Rated Supplies — Ajman              4,200.00
Box 1e Standard Rated Supplies — Umm Al Quwain      0.00
Box 1f Standard Rated Supplies — Ras Al Khaimah     0.00
Box 1g Standard Rated Supplies — Fujairah           0.00
Box 2  Tax Refunds to Tourists                      0.00
Box 3  Supplies subject to Reverse Charge           0.00
Box 4  Zero Rated Supplies                          0.00
Box 5  Exempt Supplies                              0.00
Box 6  Goods Imported into the UAE                  0.00
Box 7  Adjustments to Goods Imported                0.00
                                                    ─────────────
TOTAL VAT DUE                                       8,870.00

VAT ON EXPENSES AND ALL OTHER INPUTS

Box 9  Standard Rated Expenses                     45,200.00
Box 10 Supplies Subject to Reverse Charge           0.00
                                                    ─────────────
TOTAL RECOVERABLE INPUT VAT                         2,260.00

NET VAT PAYABLE                                     6,610.00
```

**Source:** All `general_ledger` rows hitting accounts 2200 (Output VAT) and 1500 (Input VAT) within the period, joined to source documents to determine emirate of supply.

**Verification:** Output VAT total on this report = sum of credits to account 2200 in the period.

**Filing aid:** Export as XML in FTA's required format (v2 feature). For v1, export PDF and CSV — accountant transcribes to FTA portal.

---

## F2. Saudi VAT Return

Similar to UAE but per ZATCA's format.

## F3. India GST Return Summary

**Inputs:** `period` (typically a month)

**Output:** Three sub-reports matching GST return forms:
- **GSTR-1:** Outward supplies (your sales) — broken down by intra-state (CGST+SGST) vs inter-state (IGST), per state
- **GSTR-3B:** Summary return — output tax, input tax, net liability
- **GSTR-2 helper:** Inward supplies for matching with auto-populated 2A/2B

**Format:** Match GSTN's CSV/JSON upload format. Download → upload to GST portal directly.

---

# PART G — DAILY OPERATIONAL REPORTS

## G1. Daily Sales Summary

**Purpose:** End-of-day report — what did we sell today.

**Output:**
- Total invoices count
- Total cash sales count + amount
- Total card sales count + amount
- Total credit sales count + amount
- Total returns count + amount
- Net sales (sales − returns)
- Top 10 SKUs sold today
- VAT collected today
- Active POS sessions (open / closed)

This is the "morning ritual" report for the owner.

---

## G2. Daily Cash Report

**Purpose:** Every cash movement today.

**Output:**
- Opening cash (from yesterday's closing)
- + Cash receipts from customers
- + Cash sales from POS (per session)
- − Cash payments to suppliers
- − Cash expenses
- − Cash transfers to bank
- = Expected closing cash
- vs Counted closing cash (from POS sessions + main drawer)
- Variance

**Verification:** Expected closing cash = Cash in Hand (1100) balance on Trial Balance at end of day.

---

## G3. POS Session Report

**Purpose:** Reconciliation of a closed POS session. The cashier prints this at end of shift.

**Output:**
- Cashier name
- Warehouse
- Session start time / end time
- Opening cash
- Total sales count
- Cash sales total
- Card sales total
- Credit sales total (no cash impact)
- Refunds total
- Expected closing cash
- Counted closing cash
- Variance (with required reason if non-zero)
- List of all transactions during the session

---

## G4. Bank Reconciliation Worksheet

**Purpose:** Compare the system's bank balance vs the bank statement. v1 is manual reconciliation; v2 may add automatic statement import.

**Output:**
- System balance per bank account
- Cleared transactions (user ticks them off as they appear in the statement)
- Uncleared transactions (still in system, not yet on statement)
- Statement balance (user enters)
- Reconciled? (system balance ± uncleared = statement balance, must equal)

---

# PART H — MANAGEMENT DASHBOARDS

## H1. Owner's Dashboard (Default Landing Page)

**Single-screen overview, refreshed every 5 minutes:**

**Top row — KPI tiles:**
- Today's Sales (count + AED)
- Outstanding AR (with arrow showing change vs 7 days ago)
- Outstanding AP
- Cash + Bank (sum across all accounts)

**Middle row:**
- Top 5 selling products (this month)
- Top 5 customers by sales (this month)
- Low-stock alerts (count + link to reorder report)
- Overdue invoices (count + link to AR aging)

**Bottom row:**
- Sales trend chart (last 30 days, daily bars)
- P&L summary (this month vs last month, side-by-side)

All tiles drillable to underlying reports.

---

## H2. Salesperson's Dashboard

For users with role='sales' — their personal dashboard:
- My sales today / this week / this month
- My top customers
- My quotes pending acceptance
- My invoices unpaid (where they're listed as salesperson)

---

## H3. Counter Staff Dashboard

For role='counter' — minimal:
- Open POS session status (with "Open New Session" or "Close Session" button)
- Today's session sales
- Quick search bar (jump to POS)

---

# PART I — AUDIT REPORTS

## I1. Audit Log

**Purpose:** Every significant action in the system. Read-only. Never editable.

**Source:** `audit_logs` table.

**Inputs:** `from_date`, `to_date`, `user_id`, `entity_type`, `action_type`

**Output:** Timestamp | User | Action | Entity Type | Entity# | Old Value | New Value

**Specific filters owners want:**
- "Show all voids in the last 30 days" — voiding documents is a high-risk action
- "Show all manual journal entries" — bypass of normal flows
- "Show all overrides of period lock attempts (rejected)"
- "Show all GL postings by user X"

---

## I2. Reversal Trail Report

**Purpose:** Show original-then-reversal pairs for any edited or voided document.

**Output:** Original Document | Voided/Edited On | By Whom | Reason | New Document (if reposted)

Critical for auditor review of accounting integrity.

---

# PART J — REPORT BUILD ORDER

When implementing reports during the build phases, do them in this priority:

**Tier 1 — Must work for trust (build with sales/purchase modules):**
1. Trial Balance (A1)
2. General Ledger (A2)
3. Customer Statement (B3)
4. Supplier Statement (B4)
5. Stock Valuation (E1)

**Tier 2 — Operational essentials (build before launch):**
6. P&L (A3)
7. Balance Sheet (A4)
8. AR Aging (B1)
9. AP Aging (B2)
10. Daily Sales Summary (G1)
11. Stock Movement (E2)
12. Daily Cash Report (G2)

**Tier 3 — Tax compliance (before first quarter close):**
13. UAE VAT Return (F1)
14. India GST Return (F3)

**Tier 4 — Analytics (post-launch nice-to-have):**
15. Sales by Customer/Product/Brand/Vehicle (C1–C4)
16. Slow movers, Reorder, Stock Aging (E3, E4, E5)
17. Owner's Dashboard (H1)

**Tier 5 — Advanced (v1.x or v2):**
18. Cash Flow Statement (A5)
19. Bank Reconciliation (G4)
20. POS Session Report (G3)
21. Audit Log views (I1, I2)

---

# PART K — VERIFICATION INVARIANTS

These are the **system-wide consistency checks** that must always be true. If any fails, there's a bug.

| Invariant | Sources | Tolerance |
|---|---|---|
| **Trial Balance balances** | A1 — Debit total = Credit total | ±0.01 |
| **Balance Sheet balances** | A4 — Assets = Liabilities + Equity | ±0.01 |
| **AR Aging = AR Account** | B1 sum = TB account 1200 | ±0.01 |
| **AP Aging = AP Account** | B2 sum = TB account 2100 | ±0.01 |
| **Stock Valuation = Inventory Account** | E1 sum = TB account 1300 | ±0.01 |
| **Customer Advances valid** | Customer-level 2400 balances are credits, never debits | always |
| **Vendor Advances valid** | Customer-level 1400 balances are debits, never credits | always |
| **GRN Accrual = Unbilled GRNs** | D4 sum = TB account 2150 | ±0.01 |
| **Cash Report = Cash Account** | G2 closing cash = TB account 1100 + 11xx bank accounts | ±0.01 |

**System Health Check** (Settings → System Health) runs all these invariants and shows green/red. If any are red, escalate to support immediately. The build should include a SQL function `verify_invariants(company_id, as_of_date)` that returns this report.

---

# PART L — COSTING STRATEGY ADDENDUM (for Doc 3 alignment)

Per our locked-in decision (MAC for v1, FIFO for v2 via abstraction):

All cost-related queries in this document use the **active costing strategy** for the company. In v1 this is always MAC. The query patterns above use `costing_strategy.get_current_mac(p.id)` as a placeholder for the actual function call.

When FIFO is added in v2, the only changes needed in this document are:
- E1 Stock Valuation: query reads from `stock_lots` instead of computing average
- E2 Stock Movement: shows lot-level detail when costing_method='fifo'
- C1, C2 Sales reports: gross profit calculation reads `cost_at_sale` snapshot from `invoice_items` (works identically for both methods because the snapshot is method-agnostic)

The reports themselves don't change. Only the cost-fetching function changes.

---

## Summary

**Total reports specified: 38**
- Financial: 5 (Trial Balance, GL, P&L, Balance Sheet, Cash Flow)
- AR/AP: 4 (Aging × 2, Statements × 2)
- Sales: 6 (by customer, product, brand, vehicle, salesperson, trend)
- Purchase: 4 (by supplier, by product, open POs, GRN reconciliation)
- Inventory: 6 (valuation, movement, slow movers, reorder, aging, adjustments)
- Tax: 3 (UAE VAT, KSA VAT, India GST)
- Daily ops: 4 (sales summary, cash, POS session, bank rec)
- Dashboards: 3 (owner, salesperson, counter)
- Audit: 2 (log, reversal trail)
- System health: 1 (invariants)

**Total verification invariants: 9** — these are the laws that prove the books are clean.

---

## What This Document Replaces

In your previous build, reports were:
- Built ad-hoc per module
- Read from cached fields like `invoices.paid_amount` (which drifted from GL)
- Had no consistency checks against the GL
- No defined verification rules

This document fixes all of that:
- Every report has a defined source (always GL or stock ledger, never cached fields)
- Every report has a verification rule that proves it's correct
- The 9 invariants in Part K give you a single "is the system healthy?" check
- Reports are categorized into build tiers so you don't try to build all 38 at once

---

## Next Steps

After your approval of Doc 4:

1. **Update pass on Docs 2 and 3** to bake in costing strategy decisions (MAC default, costing_method field, deferred_cogs_queue table, FIFO/LIFO addendum). Small changes — won't take long.
2. **Doc 5 — Build Phases:** the phased rollout, with explicit "definition of done" for each phase. What to build first, what to build second, what proves each phase complete.
3. **Doc 6 — AGENTS.md:** the locked rulebook for Claude Code that prevents drift mid-build.

Read this doc. Flag:
- Any reports missing
- Reports you'd reorder by priority
- Verification rules you want to add
- Anything unclear

When ready, reply "Doc 4 approved, move to Doc 5" or list changes.
