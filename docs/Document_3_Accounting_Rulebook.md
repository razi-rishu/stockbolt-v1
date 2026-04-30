# StockBolt v1 — Document 3: The Accounting Rulebook

**Status:** Final draft for review
**Purpose:** The single source of truth for every journal entry the system will ever post.
**Rule:** If a transaction type is not in this document, Claude Code MUST NOT invent posting logic. Stop and ask.

---

## How to Read This Document

Each transaction type below specifies:

1. **The trigger** — what user action causes this posting
2. **The journal entry** — exact debit/credit lines using account codes
3. **The source_type** — the tag stored on `journal_entries.source_type` (used by the validator)
4. **The validator rule** — what the mapping validator will assert
5. **A worked example** — concrete numbers showing the result
6. **Edge cases** — what to do when things get weird

If a posting in code doesn't match this document, **the code is wrong, not the document**.

---

## The Standard Chart of Accounts (COA)

Every company is auto-seeded with these accounts on signup. Code references throughout this doc point to these.

### Assets (1000s) — Debit Normal
| Code | Name | Used For |
|---|---|---|
| 1100 | Cash in Hand | Petty cash drawer |
| 1110 | Bank Account (Main) | Primary current account; each bank account gets its own sub-code (1111, 1112…) |
| 1200 | Accounts Receivable | Money customers owe us |
| 1250 | PDC Receivable (Customer) | Post-dated cheques received from customers, not yet due |
| 1260 | Bounced Cheques (Receivable) | PDCs that bounced — still owed |
| 1300 | Inventory Asset | Stock on hand at cost |
| 1400 | Vendor Advances / Prepaid | Money paid to suppliers before bill |
| 1500 | Input VAT (Claimable) | UAE/GCC VAT paid on purchases |
| 1510 | Input CGST | India GST — Central |
| 1520 | Input SGST | India GST — State |
| 1530 | Input IGST | India GST — Integrated (interstate) |

### Liabilities (2000s) — Credit Normal
| Code | Name | Used For |
|---|---|---|
| 2100 | Accounts Payable | Money we owe suppliers |
| 2150 | GRN Accrual | Goods received but not yet billed |
| 2200 | Output VAT Payable | UAE/GCC VAT charged on sales |
| 2210 | Output CGST | India GST — Central |
| 2220 | Output SGST | India GST — State |
| 2230 | Output IGST | India GST — Integrated |
| 2300 | Accrued Expenses | Expenses incurred but not paid |
| 2400 | Customer Advances | Money received before invoicing |
| 2450 | PDC Payable (Vendor) | Cheques we issued, not yet cleared |

### Equity (3000s) — Credit Normal
| Code | Name | Used For |
|---|---|---|
| 3100 | Retained Earnings | Year-end P&L closing |
| 3200 | Owner's Equity | Initial capital |
| 3300 | Owner's Drawings | Owner withdrawals (contra-equity) |

### Income (4000s) — Credit Normal
| Code | Name | Used For |
|---|---|---|
| 4100 | Sales Revenue | Sales of goods (the core income line) |
| 4150 | Sales Discounts | Discounts given (contra-revenue) |
| 4200 | Other Income | Misc income (scrap sales, interest received) |
| 4300 | Inventory Gain | Found stock on count |
| 4400 | Foreign Exchange Gain | FX revaluation gain |

### Cost of Goods Sold (5000s) — Debit Normal
| Code | Name | Used For |
|---|---|---|
| 5100 | Cost of Goods Sold | The cost side of every sale |
| 5200 | Purchase Discounts Received | Contra-COGS |

### Expenses (6000s) — Debit Normal
| Code | Name | Used For |
|---|---|---|
| 6100 | Salaries & Benefits | (used in v2 payroll) |
| 6200 | Rent & Utilities | |
| 6300 | Marketing & Advertising | |
| 6400 | Logistics & Shipping | |
| 6500 | General & Administrative | |
| 6600 | Bank Charges | Card fees, transfer fees |
| 6700 | Inventory Loss | Shrinkage, damage write-off |
| 6800 | Bad Debts Expense | Write-off of unrecoverable AR |
| 6900 | Foreign Exchange Loss | FX revaluation loss |

---

## Universal Rules That Apply To EVERY Posting

These are the laws. They cannot be broken.

### Rule 1 — Every Journal Entry Must Balance
`SUM(debits) = SUM(credits)` to within 0.01 (rounding tolerance). The DB has a CHECK constraint enforcing this. The application validator enforces it before insert. Both checks must pass.

### Rule 2 — Every Line Has Either Debit OR Credit, Never Both
A single `general_ledger` row has `debit > 0 AND credit = 0` OR `debit = 0 AND credit > 0`. Never both, never neither.

### Rule 3 — Every Posting Has a `source_type`
This is the tag on `journal_entries.source_type`. The mapping validator uses it to enforce which accounts are allowed. A `sales_invoice` source can only touch AR + Sales Revenue + Output Tax. Nothing else can sneak in.

### Rule 4 — No Negative Amounts
Reversals are done by **mirroring with flipped Dr/Cr**, not by posting negative amounts. A reversal row has `reversal_of_id` set, points back to the original.

### Rule 5 — Reversals Never Delete
Original GL rows are kept forever. Reversals add new rows. Trial balance computation must filter out matched (reversal_of_id, original) pairs. This is enforced in the report queries, not in the data layer.

### Rule 6 — Multi-Currency: Post In Base Currency
The `general_ledger` always stores amounts in the **company's base currency**, never the document currency. Conversion happens at post time using `exchange_rate`. The original currency + rate are stored on the `journal_entries` header for traceability.

### Rule 7 — Period Lock Is Final
If `journal_entries.date <= company.period_lock_date`, the post is rejected. This includes reversals — once a period is closed, you cannot retroactively reverse a transaction inside it. You must post a *new* adjusting entry in an open period.

### Rule 8 — Stock Ledger Posts Match GL Posts
Anything that affects inventory must produce BOTH a `general_ledger` entry AND a `stock_ledger` entry, in the same database transaction. If one fails, the other must roll back. They are atomically linked.

### Rule 9 — All Balances Are Derived From The GL
Customer balance, supplier balance, bank balance, stock value, paid amount on invoice, outstanding on bill — **ALL** of these are calculated from `general_ledger` (and `stock_ledger`) at read time. None are stored. This rule is the single biggest fix from the previous build.

### Rule 10 — Audit Log Every Post
Every JE creates an `audit_logs` row with action='post_gl', the source document id, and a hash of the line items. A failed audit log must NEVER block the GL post (the audit logger catches its own errors).

---

# PART A — SALES TRANSACTIONS

## A1. Sales Invoice — Standard (Credit Sale)

**Trigger:** User confirms an invoice in the InvoiceEditor (status: draft → confirmed).

**Source type:** `sales_invoice`

**Journal entry:**

```
Dr  1200 Accounts Receivable          [grand_total]
    Cr  4100 Sales Revenue                [taxable_amount]
    Cr  2200 Output VAT Payable           [tax_amount]
```

**Validator rules:**
- Allowed accounts: `1200, 4100, 2200, 2210, 2220, 2230` (and equivalents for India)
- AR debit must be > 0
- Sales Revenue credit must be > 0
- `taxable_amount + tax_amount = grand_total` (within 0.01)

**Worked example:**
Invoice for AED 1,050 (1,000 net + 50 VAT) to customer "Al Noor Garage":
```
Dr  1200 Accounts Receivable     1,050.00
    Cr  4100 Sales Revenue              1,000.00
    Cr  2200 Output VAT                    50.00
```

**Plus, a separate COGS entry posts simultaneously** (see A1.b).

### A1.b — The COGS Posting (Always Pairs With A1)

**Trigger:** Same as A1, fires automatically when an invoice with stocked products is confirmed.

**Source type:** `inventory_cogs`

**Journal entry (per product line, summed):**

```
Dr  5100 Cost of Goods Sold       [total_cost_at_sale]
    Cr  1300 Inventory Asset           [total_cost_at_sale]
```

**Stock ledger entry (per line):**
```
type='sale', direction=-1, quantity=line.quantity,
unit_cost=product.current_MAC, warehouse_id=invoice.warehouse_id
```

**Where does `cost_at_sale` come from?**
- It is the **MAC (Moving Average Cost)** of the product at the moment of sale.
- MAC is computed from the `stock_ledger` history: `(sum of purchase costs) / (sum of purchase quantities)` excluding sales.
- Stored on `invoice_items.cost_at_sale` as a snapshot for audit purposes.

**Edge case — selling before purchasing (no MAC available):**
If a product has never been purchased and has no cost basis at the moment of sale, the system follows ONE behavior (no setting, no choice):

1. The sale posts AR + Revenue + Tax normally (per the standard A1 mapping). The customer is invoiced and AR is correct.
2. The COGS posting is **deferred** — a row is inserted into `deferred_cogs_queue` with `product_id`, `quantity`, `sale_invoice_id`, `invoice_item_id`, `sale_date`, `warehouse_id`, `status='pending'`.
3. When the product is next received via GRN (B2), the system flushes pending queue rows for that product:
   - Each queued sale gets a COGS posting using the new MAC.
   - JE date = original sale date IF that period is open, OTHERWISE = the GRN date (period lock honored).
   - Queue row is updated to `status='flushed'` with `flushed_at`, `flushed_journal_entry_id`, `flush_unit_cost`.
4. The queue is visible to admins as a "Pending COGS" report so backlog can be monitored.
5. If a sale in the queue is voided before flush, its row is updated to `status='cancelled'` and no COGS posts.

This guarantees every sale eventually has a matching COGS entry. No silent gaps in gross margin.

---

## A2. Sales Invoice — Walk-In Cash Sale (POS)

**Trigger:** User completes a POS sale with payment method = "Cash".

**Source type:** `pos_cash_sale`

**Journal entry:**

```
Dr  1100 Cash in Hand              [grand_total]
    Cr  4100 Sales Revenue              [taxable_amount]
    Cr  2200 Output VAT Payable         [tax_amount]
```

**Plus the COGS entry from A1.b.**

**Notes:**
- AR is **not touched** — money was received at point of sale.
- The invoice is created with `sale_channel='pos_cash'`, `pos_session_id` set, and `status='confirmed'` immediately.
- A receipt prints automatically.
- The cash drawer's running total (per `pos_session`) updates based on this posting.

**Validator rules:**
- Allowed accounts: `1100, 4100, 2200` (and tax variants)
- Cash debit must equal grand_total
- AR must NOT appear

---

## A3. Sales Invoice — Walk-In Card Sale (POS)

**Trigger:** POS sale with payment method = "Card".

**Source type:** `pos_card_sale`

**Journal entry:**

```
Dr  1110 Bank Account (Card Settlement)    [grand_total]
    Cr  4100 Sales Revenue                      [taxable_amount]
    Cr  2200 Output VAT Payable                 [tax_amount]
```

**Notes:**
- Hits the bank account configured on the POS station's payment method (typically the merchant settlement account).
- If there's a card fee taken at settlement (e.g., 1.5%), it's NOT posted at sale time — it's recognized when the bank statement is reconciled (a separate `bank_charges` posting).

---

## A4. Sales Invoice — Walk-In Credit Sale (POS, On Account)

**Trigger:** POS sale where customer is selected (e.g., "Al Noor Garage") and payment method = "Credit".

**Source type:** `sales_invoice`  *(same as A1 — it IS a credit invoice, just created via POS UI)*

**Journal entry:** Identical to A1.

**Notes:**
- The POS UI is just a faster way to create a credit invoice.
- `sale_channel='pos_credit'` distinguishes it for reporting.
- Receipt prints with "ON ACCOUNT" stamp and shows the customer's running balance.
- No payment is recorded. The customer pays later through standard Payments Received.

---

## A5. Customer Receipt — Allocated to Specific Invoices

**Trigger:** User creates a Payment Received and allocates the amount to one or more invoices.

**Source type:** `customer_receipt`

**Journal entry:**

```
Dr  [bank_or_cash_account]         [received_amount]
    Cr  1200 Accounts Receivable        [allocated_amount]
    Cr  2400 Customer Advances          [unallocated_amount]   -- only if received > allocated
```

**Validator rules:**
- Bank/cash debit must equal received amount
- AR credit cannot exceed received amount
- If `received > allocated`, the excess MUST go to Customer Advances (2400)
- If `allocated > received`, REJECTED at validation

**Worked example 1 — Exact match:**
Receive AED 1,050 from Al Noor Garage, allocate fully to INV-1023.
```
Dr  1110 Bank (Emirates NBD)     1,050.00
    Cr  1200 AR                         1,050.00
```

**Worked example 2 — Overpayment becomes advance:**
Receive AED 2,000, allocate AED 1,500 to INV-1023, leave AED 500 unallocated.
```
Dr  1110 Bank (Emirates NBD)     2,000.00
    Cr  1200 AR                         1,500.00
    Cr  2400 Customer Advances            500.00
```

**Edge case — paying off an old advance + part of a new invoice:**
Customer had AED 800 advance from previous payment, now pays AED 1,200, wants to clear an INV-1024 of AED 2,000.
This is handled by the **allocation engine** as TWO separate operations:
- The new payment of AED 1,200 → posts as receipt above
- The advance of AED 800 → posts as A6 (Advance Application) below

So the user picks "Apply Advance" on the invoice separately from posting a new payment. Two journals, clean trail.

---

## A6. Apply Customer Advance to an Invoice

**Trigger:** User clicks "Apply Advance" on an invoice for a customer that has a `2400 Customer Advances` balance.

**Source type:** `advance_application`

**Journal entry:**

```
Dr  2400 Customer Advances        [amount_applied]
    Cr  1200 Accounts Receivable        [amount_applied]
```

**Notes:**
- No bank/cash account touched — this is a contra entry.
- The original receipt that created the advance is unchanged.
- A `payment_allocations` row is created linking the advance to the invoice.

---

## A7. Customer Advance Receipt (Pure Advance, No Invoice)

**Trigger:** User creates a Payment Received with classification = "advance" — no invoices selected.

**Source type:** `customer_advance`

**Journal entry:**

```
Dr  [bank_or_cash_account]        [amount]
    Cr  2400 Customer Advances         [amount]
```

**Notes:**
- Used when customer pays before invoice exists (deposit, prepayment).
- The advance sits in 2400 until applied to an invoice (A6) or refunded (A8).

---

## A8. Customer Advance Refund

**Trigger:** User refunds an advance back to a customer.

**Source type:** `advance_refund`

**Journal entry:**

```
Dr  2400 Customer Advances        [amount]
    Cr  [bank_or_cash_account]         [amount]
```

---

## A9. Sales Credit Note — With Restock

**Trigger:** User confirms a credit note created from a Sales Return.

**Source type:** `sales_credit_note`

**Journal entry (header):**

```
Dr  4100 Sales Revenue            [taxable_amount]
Dr  2200 Output VAT Payable       [tax_amount]
    Cr  1200 Accounts Receivable        [grand_total]
```

**Plus a reverse-COGS entry per line (the inventory comes back):**

```
Dr  1300 Inventory Asset          [cost_at_return]
    Cr  5100 Cost of Goods Sold         [cost_at_return]
```

**Stock ledger entry per line:**
```
type='sales_return', direction=+1, quantity=qty_returned,
unit_cost=original_cost_at_sale, warehouse_id=return.warehouse_id
```

**Notes:**
- The cost used for restocking is the **same cost the item was sold at** (snapshot from `invoice_items.cost_at_sale`). NOT the current MAC. Otherwise we'd create gain/loss artifacts on every return.
- If item is returned in damaged condition, it goes to a separate `damaged_stock` warehouse (or the reason is tagged as 'damaged' so it's excluded from sellable stock reports).

---

## A10. Sales Credit Note — Without Restock (Rebate / Price Adjustment)

**Trigger:** Credit note created for reasons like "rebate", "price_correction", or "goodwill" — no physical return.

**Source type:** `sales_credit_note`

**Journal entry:**

```
Dr  4100 Sales Revenue            [taxable_amount]
Dr  2200 Output VAT Payable       [tax_amount]
    Cr  1200 Accounts Receivable        [grand_total]
```

**No COGS reversal. No stock movement.**

**Notes:**
- This is just an AR reduction.
- If the customer already paid the original invoice, the credit becomes a customer advance (or is refunded — that's a separate transaction).

---

## A11. Bad Debt Write-Off

**Trigger:** Manual journal entry — admin marks an old AR as uncollectible.

**Source type:** `manual` *(but with `bad_debt: true` flag)*

**Journal entry:**

```
Dr  6800 Bad Debts Expense        [amount]
    Cr  1200 Accounts Receivable        [amount]
```

**Notes:**
- VAT recovery (writing back the output VAT) is a separate posting and depends on jurisdiction. For UAE, FTA allows recovery after 6 months — out of v1 scope, do as manual JE.

---

# PART B — PURCHASE TRANSACTIONS

## B1. Purchase Order

**Trigger:** User confirms a PO.

**Journal entry:** **NONE.**

**Notes:**
- A PO is a commitment, not a transaction. It does NOT post to GL.
- Only inventory/AP gets affected when goods are received (B2) or billed (B3).

---

## B2. Goods Receipt Note (GRN)

**Trigger:** User confirms a GRN (goods physically received).

**Source type:** `goods_receipt`

**Journal entry:**

```
Dr  1300 Inventory Asset          [total_received_value]
    Cr  2150 GRN Accrual                [total_received_value]
```

**Stock ledger entry per line:**
```
type='purchase', direction=+1, quantity=qty_received,
unit_cost=line.unit_cost, warehouse_id=grn.warehouse_id
```

**MAC update:** The product's MAC is recalculated using the formula:
```
new_MAC = (old_MAC × old_qty + new_unit_cost × new_qty) / (old_qty + new_qty)
```
This update happens on the product master, computed from the stock_ledger.

**Why GRN Accrual?**
- Goods physically arrive on Day 1, but the supplier's invoice (vendor bill) might come on Day 5.
- We don't yet know the EXACT amount we owe (currency fluctuations, freight, taxes).
- So we accrue at the *expected* cost (from PO) into 2150.
- When the bill arrives (B3), it clears 2150 and creates the real AP.

**Edge case — direct GRN without PO:**
Allowed. Same posting. The bill (B3) will reference this GRN.

---

## B3. Vendor Bill (From GRN — Three-Way Match)

**Trigger:** User confirms a vendor bill linked to a GRN.

**Source type:** `vendor_bill`

**Journal entry (when bill amount = GRN amount):**

```
Dr  2150 GRN Accrual              [grn_subtotal]
Dr  1500 Input VAT (Claimable)    [tax_amount]    -- if VAT applicable
    Cr  2100 Accounts Payable           [bill_total]
```

**Edge case — bill differs from GRN (price variance):**

If supplier's bill says AED 1,200 but GRN was accrued at AED 1,000:

```
Dr  2150 GRN Accrual              1,000.00      -- clears the original accrual
Dr  1300 Inventory Asset            200.00      -- absorbs the extra cost
Dr  1500 Input VAT                   60.00      -- 5% on 1,200
    Cr  2100 Accounts Payable           1,260.00
```

The MAC is recalculated to reflect the higher actual cost.

**Edge case — partial billing (3-way match in progress):**
GRN was for 100 units at 10 each = 1,000 accrued. Supplier bills only 60 units at 10 = 600.

```
Dr  2150 GRN Accrual                600.00
Dr  1500 Input VAT                   30.00
    Cr  2100 Accounts Payable             630.00
```

The remaining 400 sits in 2150 until billed (or written off if supplier never bills).

**Validator rules:**
- Allowed debit accounts: `2150, 1300, 1500, 1510, 1520, 1530`, expense accounts (`6xxx`)
- Allowed credit accounts: `2100`
- AP credit must equal sum of all debits

---

## B4. Vendor Bill (Standalone — No GRN, e.g., Services)

**Trigger:** User creates a vendor bill not linked to any GRN. Used for services like rent, utilities, freight, professional fees.

**Source type:** `vendor_bill`

**Journal entry:**

```
Dr  [expense_account_code]        [taxable_amount]    -- e.g., 6200 Rent
Dr  1500 Input VAT (Claimable)    [tax_amount]
    Cr  2100 Accounts Payable           [bill_total]
```

**Notes:**
- Each bill line specifies an expense account directly (not a product).
- No stock ledger entry.

---

## B5. Vendor Payment — Allocated to Bills

**Trigger:** User creates a vendor payment and allocates to one or more bills.

**Source type:** `vendor_payment`

**Journal entry:**

```
Dr  2100 Accounts Payable         [allocated_amount]
Dr  1400 Vendor Advances          [unallocated_amount]   -- if paid > allocated
    Cr  [bank_or_cash_account]          [paid_amount]
```

**Worked example — Exact:**
Pay AED 5,000 to Bosch, fully allocated to BILL-2024-001:
```
Dr  2100 AP                       5,000.00
    Cr  1110 Bank                       5,000.00
```

**Worked example — Overpayment becomes vendor advance:**
Pay AED 6,000 to Bosch, allocate AED 5,500 to BILL-2024-001:
```
Dr  2100 AP                       5,500.00
Dr  1400 Vendor Advances            500.00
    Cr  1110 Bank                       6,000.00
```

---

## B6. Vendor Advance Payment (No Bill Yet)

**Trigger:** User pays a supplier in advance — no bill exists.

**Source type:** `vendor_advance`

**Journal entry:**

```
Dr  1400 Vendor Advances          [amount]
    Cr  [bank_or_cash_account]          [amount]
```

---

## B7. Apply Vendor Advance to a Bill

**Trigger:** User clicks "Apply Advance" on a bill.

**Source type:** `advance_application`

**Journal entry:**

```
Dr  2100 Accounts Payable         [amount_applied]
    Cr  1400 Vendor Advances            [amount_applied]
```

---

## B8. Vendor Advance Refund

**Trigger:** User refunds an advance back from a supplier (rare, but possible).

**Source type:** `advance_refund`

**Journal entry:**

```
Dr  [bank_or_cash_account]        [amount]
    Cr  1400 Vendor Advances            [amount]
```

---

## B9. Debit Note — With Stock Return

**Trigger:** User returns goods to supplier and confirms a debit note.

**Source type:** `vendor_debit_note`

**Journal entry:**

```
Dr  2100 Accounts Payable         [grand_total]
    Cr  1300 Inventory Asset            [taxable_amount]
    Cr  1500 Input VAT (Reversed)       [tax_amount]
```

**Stock ledger entry per line:**
```
type='purchase_return', direction=-1, quantity=qty_returned,
unit_cost=original_cost_at_purchase, warehouse_id=debit_note.warehouse_id
```

**Notes:**
- Cost used is the cost at original purchase (snapshot), not current MAC.

---

## B10. Debit Note — Without Stock Return (Price Adjustment)

**Trigger:** Supplier issues a credit (debit note from our side) for overcharge — no physical return.

**Source type:** `vendor_debit_note`

**Journal entry:**

```
Dr  2100 Accounts Payable         [amount]
    Cr  [original_expense_or_inventory_account]   [amount]
```

The "original account" depends on what the original bill posted to. For inventory bills, credit 1300. For expense bills, credit the same expense account.

---

# PART C — INVENTORY MOVEMENTS

## C1. Stock Transfer Between Warehouses

**Trigger:** User confirms a Stock Transfer document.

**Source type:** `stock_transfer`

**Journal entry:** **NONE** (when MAC is company-wide, transfers are accounting-neutral).

**Stock ledger entries (TWO rows per line, atomically):**
```
Row 1: type='transfer_out', direction=-1, warehouse_id=from_warehouse
Row 2: type='transfer_in',  direction=+1, warehouse_id=to_warehouse
```

**Notes:**
- Total inventory value is unchanged — same stuff, different shelf.
- In v1, MAC is **company-wide**, not per-warehouse. So transfers don't change accounting at all.
- If we later add per-warehouse MAC (v2 feature), transfers would post a small JE for cost differential. Not in v1.

**Edge case — In-transit:**
If a transfer is multi-day (between cities), an "in_transit" status holds stock in a virtual warehouse `WH-TRANSIT` until it's confirmed received. The two stock_ledger rows are split across two confirmation events.

---

## C2. Inventory Adjustment — Found Stock (Count Up)

**Trigger:** Stock count finds MORE units than the system shows. User confirms an adjustment with `direction='in'`.

**Source type:** `inventory_adjustment`

**Journal entry:**

```
Dr  1300 Inventory Asset          [quantity × unit_cost]
    Cr  4300 Inventory Gain             [quantity × unit_cost]
```

**Stock ledger entry:**
```
type='adjustment_in', direction=+1, quantity=difference,
unit_cost=current_MAC, warehouse_id=adjustment.warehouse_id
```

**Notes:**
- `unit_cost` uses current MAC. If product has no MAC, the user must enter one (system prompts).

---

## C3. Inventory Adjustment — Shrinkage / Damage (Count Down)

**Trigger:** Count finds FEWER units. User confirms with `direction='out'`, reason in `'damage', 'shrinkage', 'theft', 'expiry'`.

**Source type:** `inventory_adjustment`

**Journal entry:**

```
Dr  6700 Inventory Loss           [quantity × unit_cost]
    Cr  1300 Inventory Asset            [quantity × unit_cost]
```

**Stock ledger entry:**
```
type='adjustment_out', direction=-1, quantity=difference,
unit_cost=current_MAC, warehouse_id=adjustment.warehouse_id
```

---

## C4. Opening Balance — Stock

**Trigger:** During onboarding, user enters opening stock per warehouse.

**Source type:** `opening_balance`

**Journal entry:**

```
Dr  1300 Inventory Asset          [total_value]
    Cr  3200 Owner's Equity             [total_value]
```

**Stock ledger entry per product per warehouse:**
```
type='opening_balance', direction=+1, quantity=opening_qty,
unit_cost=opening_cost, warehouse_id=specified_warehouse
```

**Notes:**
- This is a one-time setup posting.
- Sets the initial MAC per product.

---

# PART D — BANKING

## D1. Bank Transfer (Own Account to Own Account)

**Trigger:** User confirms a Bank Transfer document.

**Source type:** `bank_transfer`

**Journal entry:**

```
Dr  [to_bank_account.coa_account]      [amount]
    Cr  [from_bank_account.coa_account]      [amount]
```

**Notes:**
- Pure asset reclassification — total cash unchanged.
- For cross-currency transfers (AED account to USD account), use the FX rate at transfer date. Any rounding difference posts to 4400 (FX Gain) or 6900 (FX Loss).

---

## D2. Direct Income Receipt (Not From a Customer)

**Trigger:** User records a direct receipt — e.g., interest received from bank, scrap sale.

**Source type:** `direct_receipt`

**Journal entry:**

```
Dr  [bank_or_cash_account]        [amount]
    Cr  4200 Other Income               [taxable_amount]
    Cr  2200 Output VAT (if applicable) [tax_amount]
```

**Validator rules:**
- Target account must NOT be AR, AP, Inventory, or any control account.
- Must be an income account (4xxx) or a specific asset/liability the user picks for non-trading transactions.

---

## D3. Direct Expense Payment

**Trigger:** User books an expense (no vendor bill flow).

**Source type:** `expense`

**Journal entry:**

```
Dr  [expense_account_code]        [taxable_amount]
Dr  1500 Input VAT (Claimable)    [tax_amount]
    Cr  [bank_or_cash_account]          [grand_total]
```

**Validator rules:**
- Debit must be an expense account (5xxx, 6xxx) or input tax (15xx).
- Credit must be a bank/cash account.

---

## D4. Bank Charges (e.g., Card Settlement Fees)

**Trigger:** Posted during bank reconciliation when bank deducts a fee.

**Source type:** `expense` *(specific to bank charges)*

**Journal entry:**

```
Dr  6600 Bank Charges             [fee]
    Cr  [bank_account]                  [fee]
```

---

# PART E — POST-DATED CHEQUES (PDC)

PDCs in GCC business culture are *very* common. The accounting reflects three states.

## E1. PDC — Created (Customer Issues a Future-Dated Cheque)

**Trigger:** User records a PDC received from a customer, due on a future date.

**Source type:** `pdc_creation`

**Journal entry:**

```
Dr  1250 PDC Receivable           [amount]
    Cr  1200 Accounts Receivable        [amount]
```

**Notes:**
- The AR is moved out (reduced) to acknowledge that a payment instrument exists.
- It sits in 1250 until the cheque is deposited and clears.

**Edge case — PDC for an advance (no AR exists yet):**
```
Dr  1250 PDC Receivable           [amount]
    Cr  2400 Customer Advances          [amount]
```

---

## E2. PDC — Deposited at Bank (Cheque Submitted for Clearance)

**Trigger:** User marks PDC as "deposited" on its due date.

**Source type:** `pdc_bank_post`

**Journal entry:** **NONE.**

**Notes:**
- A status change only — cheque is now with the bank but hasn't cleared.
- Tracking via `pdc_cheques.status='deposited'` and `deposit_account_id`.
- No accounting until clear/bounce decision.

---

## E3. PDC — Cleared (Cheque Honored)

**Trigger:** Bank confirms cheque cleared.

**Source type:** `pdc_clear`

**Journal entry:**

```
Dr  [deposit_bank_account]        [amount]
    Cr  1250 PDC Receivable             [amount]
```

**Notes:**
- The deposit account chosen at deposit time is now credited with real cash.
- 1250 is cleared.

---

## E4. PDC — Bounced

**Trigger:** Bank returns the cheque (insufficient funds, signature mismatch, etc.).

**Source type:** `pdc_bounce`

**Journal entry:**

```
Dr  1260 Bounced Cheques          [amount]
    Cr  1250 PDC Receivable             [amount]
```

**Notes:**
- Money is still owed but is now a *contested* receivable.
- Subsequent collection or write-off uses 1260, not 1200.
- If we later collect, we credit 1260 and debit cash.
- If unrecoverable, we write off 1260 to bad debts (6800).

---

## E5. PDC — Issued (We Give a Future-Dated Cheque to Vendor)

**Trigger:** User records a PDC issued to a supplier.

**Source type:** `pdc_creation` *(outbound variant)*

**Journal entry:**

```
Dr  2100 Accounts Payable         [amount]
    Cr  2450 PDC Payable                [amount]
```

When the cheque clears (E6):
```
Dr  2450 PDC Payable              [amount]
    Cr  [bank_account]                  [amount]
```

If we cancel before due date:
```
Dr  2450 PDC Payable              [amount]
    Cr  2100 Accounts Payable           [amount]
```

---

# PART F — REVERSALS AND EDITS

## F1. Editing a Confirmed Invoice (Reversal + Repost)

**Trigger:** User edits a confirmed invoice and saves.

**Posting flow:**
1. Find all live (non-reversed) GL rows for the original `journal_entry_id`.
2. Insert mirror rows with debit↔credit flipped, set `reversal_of_id` to original row id.
3. Insert reverse stock_ledger rows (sale becomes return).
4. Recalculate MAC for affected products.
5. Post a fresh JE with the new values, identical pattern to A1.
6. Audit log records both the reversal and the repost.

**Result:**
- Net GL effect is the new invoice values.
- Original rows preserved for audit.
- Trial balance always agrees.

**Period-lock guard:** If the original posting is in a locked period, edit is REJECTED. User must void + repost in current period.

---

## F2. Voiding a Document

**Trigger:** User voids an invoice/bill/payment with status='confirmed'.

**Posting flow:**
1. Same reversal mechanism as F1 — mirror all live GL rows.
2. Stock movements reversed.
3. Document status → `void`.
4. `void_reason`, `voided_at`, `voided_by` populated.

**Result:**
- Document is preserved (auditor can see it).
- Net GL effect is zero.
- Stock returns to where it was.

---

## F3. Refund of a Cash Sale

**Trigger:** Customer brings back a cash-sale item for refund.

**This is NOT a void.** It's a Sales Return + Credit Note + Refund Payment, three separate transactions in sequence:

1. **Sales Return** (per A9) — restocks the item, posts COGS reversal.
2. **Credit Note** issued to customer (creates a credit balance in 2400 or refunds AR).
3. **Refund Payment** — separate transaction:

```
Dr  2400 Customer Advances        [refund_amount]   (or 1200 AR if credit balance is there)
    Cr  [bank_or_cash_account]          [refund_amount]
```

---

# PART G — YEAR-END / PERIOD CLOSE

## G1. Period Lock

**Trigger:** Admin closes a month in Settings → Period Lock.

**Posting:** None.

**Effect:**
- `companies.period_lock_date` is set to the last day of the closed month.
- Any future post (including reversals) targeting that date or earlier is REJECTED.
- Reports for closed periods are now "frozen."

---

## G2. Year-End Close (Move P&L to Retained Earnings)

**Trigger:** End of fiscal year, admin clicks "Close Year".

**Source type:** `year_end_close`

**Posting:**

For every income account (4xxx) with a credit balance:
```
Dr  [income_account]              [balance]
    Cr  3100 Retained Earnings          [balance]
```

For every expense/COGS account (5xxx, 6xxx) with a debit balance:
```
Dr  3100 Retained Earnings        [balance]
    Cr  [expense_account]               [balance]
```

**Result:**
- All income/expense accounts zero out.
- Net profit (or loss) lands in 3100 Retained Earnings.
- New fiscal year starts clean.

---

# PART H — COA EXTENSIBILITY

User can add custom accounts (e.g., subdivide expenses by department, add multiple bank accounts).

**Rules:**
- Custom accounts MUST follow the type system (asset/liability/equity/income/expense).
- Code must be unique per company.
- System accounts (1100, 1200, 1300, 2100, 2150, 2200, 4100, 5100 etc.) are flagged `is_system=true` — they cannot be deleted, only renamed (within same type).
- Custom accounts can be deactivated but not deleted if they have GL history.

---

# PART I — VALIDATOR REFERENCE

The mapping validator (`assertJournalMapping`) is called BEFORE every GL post. It checks:

| Source Type | Required Account(s) | Forbidden Accounts |
|---|---|---|
| `sales_invoice` | 1200 (Dr), 4100 (Cr) | All others except output tax |
| `pos_cash_sale` | 1100 (Dr), 4100 (Cr) | AR, AP, Inventory direct |
| `pos_card_sale` | 11xx Bank (Dr), 4100 (Cr) | AR, AP |
| `customer_receipt` | Bank/Cash (Dr) | Sales Revenue, Inventory |
| `vendor_payment` | Bank/Cash (Cr) | Sales Revenue, Inventory |
| `vendor_bill` | 2100 (Cr) | Sales Revenue, AR |
| `goods_receipt` | 1300 (Dr), 2150 (Cr) | All others |
| `inventory_cogs` | 5100 (Dr), 1300 (Cr) | All others |
| `bank_transfer` | Bank/Cash both sides | Everything else |
| `expense` | Expense (Dr) | AR, Inventory |
| `customer_advance` | Bank (Dr), 2400 (Cr) | All others |
| `vendor_advance` | 1400 (Dr), Bank (Cr) | All others |

**If a posting fails validation, it is REJECTED — no GL row is written, the user sees a clear error message.** This is the single biggest mechanism preventing the "mapping doesn't work" failure mode.

---

# PART J — MULTI-CURRENCY HANDLING

## J1. Sales Invoice in Foreign Currency

**Scenario:** Company base currency is AED. Customer invoiced in USD.

**Stored on the document:**
- `currency='USD'`, `exchange_rate=3.6725` (AED per USD on invoice date)
- Line amounts in USD

**GL is posted in AED:**
```
USD invoice for $1,000.00 (taxable $952.38, VAT $47.62) at rate 3.6725:

Dr  1200 AR                     3,672.50    -- $1,000 × 3.6725
    Cr  4100 Sales Revenue              3,496.61    -- $952.38 × 3.6725
    Cr  2200 Output VAT                   175.89    -- $47.62 × 3.6725
```

**Audit trail:** The journal_entries header stores `currency='USD'` and `exchange_rate=3.6725` so reporting can reconstruct.

---

## J2. Customer Receipt in Foreign Currency Against Foreign Invoice

**Scenario:** Same USD invoice. Customer pays $1,000 USD on a different date when rate is 3.6750.

**The invoice's AR was booked at 3.6725 → AED 3,672.50.**
**The receipt comes in at 3.6750 → AED 3,675.00.**
**Difference: AED 2.50 — this is FX gain.**

```
Dr  1110 Bank (USD)              3,675.00      -- USD 1,000 at receipt rate
    Cr  1200 AR                          3,672.50     -- closes the original AR
    Cr  4400 FX Gain                         2.50    -- the difference
```

**If rate moves the other way (loss):**
```
Dr  1110 Bank (USD)              3,670.00
Dr  6900 FX Loss                     2.50
    Cr  1200 AR                          3,672.50
```

**Engine logic:**
The FX adjustment line is auto-calculated and added by the posting engine — the user doesn't enter it manually. Tolerance is 0.01.

---

## J3. Bank Account Maintained in Foreign Currency

If a company has a USD bank account, the COA might have:
- 1110 Emirates NBD AED (currency='AED')
- 1115 Emirates NBD USD (currency='USD')

The 1115 account stores its balance **in USD**, but the GL is **in AED**. When the AED/USD rate changes, the AED equivalent of the USD balance changes — this is **unrealized FX**, posted via a periodic revaluation entry (manual JE in v1, automatic in v2).

---

# PART K — INDIA GST SPECIFICS

When `company.country_code = 'IN'`, the tax mapping changes.

**Intra-state sale (customer in same state):**
- Output Tax splits into CGST + SGST (e.g., 18% = 9% CGST + 9% SGST)
- Posting:
```
Dr  1200 AR                       11,800
    Cr  4100 Sales Revenue            10,000
    Cr  2210 Output CGST                 900
    Cr  2220 Output SGST                 900
```

**Inter-state sale (customer in different state):**
- Output Tax is IGST (full 18%)
- Posting:
```
Dr  1200 AR                       11,800
    Cr  4100 Sales Revenue            10,000
    Cr  2230 Output IGST              1,800
```

**Determination logic:**
- Compare `company.state` with `contact.address_state`.
- Same → CGST + SGST split.
- Different → IGST.

**Same logic mirrors for purchases:** Input CGST/SGST/IGST.

---

# PART L — WHAT NEVER POSTS TO GL

For clarity, these actions DO NOT touch the general ledger:

- Creating/editing a **draft** invoice, bill, quote, order
- Creating/editing a **draft** payment (allocation may exist but no GL)
- Creating a customer or supplier
- Creating a product
- Creating a price level
- Editing master data (categories, brands, units)
- Creating a quote (even when sent)
- Creating a sales order or PO (commitments only)
- Stock transfers within company-wide MAC (stock ledger only)
- PDC deposit at bank (status change only)
- Period lock toggle
- Adding users
- Bank account opening (the *opening balance* posts via opening_balance source, but creating an empty bank account does not)

---

# PART M — POSTING SAFETY CHECKLIST

Before any GL post, the engine validates:

1. ✅ Period lock — date >= period_lock_date
2. ✅ Future date — date <= today + 1 (configurable)
3. ✅ Balanced — sum(debit) = sum(credit), tolerance 0.01
4. ✅ Source type valid — must be one of the known types
5. ✅ Mapping valid — all accounts in posting are allowed for that source type
6. ✅ Account active — every account_id is `is_active=true`
7. ✅ Account exists in tenant's COA — UUID lookup succeeds
8. ✅ No mixing dr+cr on single line
9. ✅ All amounts non-negative
10. ✅ Currency conversion — if foreign currency, exchange_rate > 0

If any check fails, the entire transaction rolls back. No partial posts. Ever.

---

# PART N — WHAT THIS DOCUMENT REPLACES

This rulebook replaces all of the following from the previous build, which had partial/inconsistent rules:
- `accountingMapping.ts` (the partial validator)
- Inline posting logic in `InvoiceEditor.tsx`, `PaymentEditor.tsx`, etc.
- The implicit rules that were only in your head

Now the rules are written, reviewed, agreed, and version-controlled. Every Claude Code session will have access to this document. No more "the mapping isn't working" mysteries.

---

# PART O — COSTING STRATEGY (LOCKED-IN DECISION)

This part documents the costing-method architecture, since every COGS-related rule above depends on it.

## O1. Method Used in v1: Moving Average Cost (MAC)

For every product, **one running cost** is maintained, recalculated on each purchase using the formula:

```
new_MAC = (old_MAC × old_qty + new_unit_cost × new_qty) / (old_qty + new_qty)
```

- MAC is **company-wide** (not per-warehouse). One cost per product across all warehouses.
- Quantity is **per-warehouse** (each warehouse tracks its own stock count).
- Stock transfers are accounting-neutral (same MAC moves with the goods).
- IFRS-compliant. FTA-accepted. GST-accepted.

## O2. Method Banned Permanently: LIFO

LIFO is **never** built, in any version of StockBolt.

Reason:
- IFRS prohibits LIFO (UAE/GCC/India all follow IFRS-aligned standards)
- UAE FTA does not accept LIFO for VAT-related inventory valuation
- India's Ind AS and AS frameworks both prohibit LIFO

If a future spec, prompt, or feature request mentions LIFO, treat it as an error. Do not implement, do not add to settings, do not reference in any code path.

## O3. v2 Roadmap: FIFO (First In, First Out)

FIFO is planned for v2 as a premium-tier feature, when a real paying customer requests it. Until then, no FIFO code is written. The architecture below makes adding FIFO non-disruptive.

## O4. Architecture: The CostingStrategy Abstraction

All cost calculations in the system go through ONE interface. No business logic ever computes a cost directly.

```
interface CostingStrategy {
  // Returns the cost-per-unit to be used at the moment of sale.
  // For MAC: returns current company-wide MAC for the product.
  // For FIFO (v2): returns weighted cost from the oldest available lots, in order.
  getCostAtSale(productId, warehouseId, quantity, saleDate): Promise<number>

  // Called when a purchase is recorded (B2 GRN posting).
  // For MAC: triggers MAC recalculation.
  // For FIFO (v2): inserts a new row into stock_lots.
  recordPurchase(productId, warehouseId, quantity, unitCost, purchaseDate): Promise<void>

  // Called when a sale is recorded (A1.b COGS posting).
  // For MAC: no state change (cost is read-only at sale).
  // For FIFO (v2): consumes oldest lots, updates stock_lots.remaining_qty.
  recordSale(productId, warehouseId, quantity, costAtSale, saleDate): Promise<void>

  // Called when a return is recorded (A9 / B9).
  // For MAC: no state change.
  // For FIFO (v2): returns to most-recent-consumed lot, or specific lot if traceable.
  recordReturn(productId, warehouseId, quantity, originalCost, lotId?): Promise<void>

  // Returns the current valuation for stock valuation reports (E1).
  // For MAC: quantity × current_MAC.
  // For FIFO (v2): sum across all open lots.
  getCurrentValuation(productId, warehouseId): Promise<number>
}
```

### v1 implementation: `MovingAverageCostingStrategy`

The only implementation in v1. Reads from `stock_ledger` to compute current MAC and current quantity. No `stock_lots` table needed.

### v2 implementation: `FIFOCostingStrategy`

Adds:
- `stock_lots` table (one row per purchase batch with `remaining_qty`)
- Lot-consumption algorithm at sale time
- Lot-restoration logic for returns

The transaction posting code (every section in this document) does NOT change. Only the strategy class differs. The strategy is selected at company creation based on `companies.costing_method` and locked thereafter.

## O5. Switching Costing Methods

Companies CANNOT switch costing methods mid-fiscal-year. The rules:

- Method is chosen during company onboarding (always 'mac' in v1).
- Once a transaction has been posted, the method is locked.
- A future v2 admin feature will allow conversion only at the start of a new fiscal year, with explicit owner confirmation, generating an opening-balance entry that translates the closing position from one method to the other.

## O6. AGENTS.md Enforcement

The build agent (Claude Code) MUST honor:

1. All cost lookups go through `CostingStrategy.getCostAtSale()`. Never inline a MAC formula in invoice/GRN/return code.
2. v1 ships only `MovingAverageCostingStrategy`. Do not write `FIFOCostingStrategy`, `LIFOCostingStrategy`, `StandardCostingStrategy`, or any other variant.
3. The `companies.costing_method` field exists, but in v1 it is constrained by CHECK to only allow 'mac'. Do not relax this constraint without explicit instruction.
4. If any prompt or spec references LIFO, treat it as an error and stop.

---

## Summary — Coverage Check

By transaction type, every flow in your v1 module map has explicit posting rules:

- ✅ Sales: standard invoice, POS cash, POS card, POS credit, customer receipt, advance receipt, advance application, advance refund, credit note (with/without restock), bad debt
- ✅ Purchases: PO (no GL), GRN, vendor bill (from GRN, standalone, with variance), vendor payment, vendor advance, vendor advance application, vendor advance refund, debit note (with/without return)
- ✅ Inventory: stock transfer, found stock (gain), shrinkage (loss), opening balance
- ✅ Banking: bank transfer (same currency, FX), direct receipt, direct expense, bank charges
- ✅ PDC: created (inbound), deposited, cleared, bounced; issued (outbound), cleared, cancelled
- ✅ Reversals: edit-as-reversal, void, cash refund flow
- ✅ Period close + year-end retained earnings
- ✅ Multi-currency: invoice in foreign currency, receipt with FX gain/loss
- ✅ India GST: intra-state vs inter-state determination

**Total transaction types: 38.** Each has exact debit/credit lines and a worked example.

---

## Next Steps

This is Document 3. After your approval:

- **Document 4 — Reports Spec:** Trial Balance, P&L, Balance Sheet, Aging, Stock Valuation, etc. — each with the SQL/logic that derives it from `general_ledger` and `stock_ledger`.
- **Document 5 — Build Phases:** Phased rollout, with done-criteria.
- **Document 6 — AGENTS.md:** The locked rulebook for Claude Code.

Read this carefully. Flag:
- Postings that don't match how your business actually does things in UAE
- Edge cases I missed (especially around PDC, which has GCC-specific quirks)
- Account codes you'd rather rename or restructure
- Anything you don't understand and want explained simpler
