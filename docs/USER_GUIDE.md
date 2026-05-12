# StockBolt — User Guide

A practical day-to-day reference for running an auto-parts shop on StockBolt.
This guide covers the workflows you'll actually use; it's not exhaustive. For
specific reports or settings not listed here, the in-app navigation is fairly
self-explanatory — open the relevant menu and follow your nose.

> **Tip — Quick Actions**: The floating **+** button in the bottom-right
> corner of every page opens a menu of the six most common new-document
> actions (Invoice, Quote, Payment, Bill, GRN, Product). Use it as a shortcut
> from anywhere.

---

## 1. First time signing in

If you're reading this, you've already completed the 6-step Setup Wizard. A
quick recap of what it did:

- Created your **company** record (name, country, currency, fiscal year).
- Seeded the **Chart of Accounts** for your country (UAE/GCC or India).
- Seeded standard **tax rates**, **payment methods**, and **units**.
- Created your first **warehouse** (default).
- Created your first **bank / cash account**.
- Optionally loaded **sample data** (10 demo products, 2 customers, 2 suppliers).

If you skipped sample data, your next step is to set up **master data** before
you can record any transactions.

---

## 2. Master data

Before recording sales or purchases, you need:

### Products (Inventory → All Products → + New Product)

For each product, fill in:

| Field | Why it matters |
|---|---|
| **SKU** | Your internal stock code. Must be unique. |
| **Name** (EN + AR) | What appears on invoices / quotes. |
| **OE Number** | Original-Equipment part number — searchable in the catalog. |
| **Brand**, **Category**, **Vehicle compatibility** | Used by the Parts Catalog browser. |
| **Selling price** | Default price on invoices. Editable per-line. |
| **Purchase Account** | Where the line posts to in the books. Defaults to **1300 Inventory** — leave as-is for parts you stock. Switch to a 5xxx/6xxx expense account for items like Customs Duty, Transport Charges, Service Fees. |
| **Min stock level** | Below this triggers the Low Stock alert and Reorder report. |

### Customers (Contacts → Customers → + Add Customer)

For each customer: name, phone, email, VAT/TRN ID, currency, payment terms
(in days; `0` = Cash on Delivery), credit limit, address.

### Suppliers (Contacts → Suppliers → + Add Supplier)

Same fields as Customers; type is set to `supplier` (or `both` if the contact
acts as both).

---

## 3. Recording a sale (the main daily flow)

### A. Quick counter sale (POS)

For walk-in cash/card sales at the counter:

1. **Sales → Counter Sales** (or sidebar: POS).
2. Click **Open Session** if it's not already open (enter opening cash).
3. Search the product (by SKU or OE number), tap it to add to cart.
4. Adjust quantity with +/- buttons.
5. Optionally select a **Customer** (skip for walk-in).
6. Click **Cash**, **Card**, or **Credit** to settle.
7. At end of day, **Close Session** — enter actual cash counted; the system
   records any variance.

### B. Invoice for a credit customer

1. **+ button → New Invoice** (or Sales → Invoices → + New Invoice).
2. Pick the **Customer** (typeahead — start typing the name).
3. Date defaults to today; Due Date follows the customer's payment terms.
4. Add **Line Items**:
   - Pick the product from the dropdown (typeahead search by SKU/name).
   - Adjust qty / unit price / discount / tax as needed.
5. **Save** as draft.
6. **Confirm** when ready. Confirmation posts:
   - Sales Journal Entry (DR Accounts Receivable, CR Sales, CR Output VAT)
   - Stock-ledger row (qty out, product cost = Moving Average Cost)
   - COGS Journal Entry (DR Cost of Goods Sold, CR Inventory) — only if MAC is known.
7. Print or save as PDF via the **🖨 Print** button on the editor.

### C. Receiving a payment

1. **+ button → Receive Payment** (or Sales → Payments → + New Payment).
2. Pick the **Customer**.
3. **Classification:** "Against Invoice" (default) shows an **Apply to
   Invoices** panel — distribute the amount across the customer's open
   invoices (auto-fills oldest first; override any row).
4. Pick the **Bank Account** (where the money lands).
5. Enter the **Amount**. The panel auto-fills the apply amounts.
6. Save → Confirm. The journal posts:
   - DR Bank, CR Accounts Receivable, plus a CR Customer Advances entry if
     the payment exceeded the allocations (the excess sits as an advance
     you can apply later).

---

## 4. Recording a purchase

Two paths depending on your workflow:

### A. Simple — the parts and the bill arrived together

1. **+ button → New Vendor Bill**.
2. Pick the **Supplier**.
3. Add **Line Items** — pick each product, enter qty + unit cost.
4. **Save** then **Confirm**.

What happens on confirm:

- For each line whose product has Purchase Account = **1300 Inventory**:
  - Stock-ledger row added (qty in, unit cost).
  - Moving Average Cost recalculated for that product.
  - DR Inventory.
- For lines where the product's account is 5xxx/6xxx (Customs Duty, Transport):
  - DR that expense account directly. No stock movement.
- DR Input VAT for tax. CR Accounts Payable for the total.

### B. Formal — Purchase Order → Goods Receipt → Vendor Bill

For larger shops that want to track POs:

1. **Purchases → Purchase Orders → + New PO** — pick supplier, add lines, save, **Send**.
2. When goods arrive: **Purchases → Goods Receipts → New GRN** — pre-fills
   from the PO. Confirm to receive stock and accrue payable.
3. When the supplier bill arrives: **Purchases → Vendor Bills → New Bill**
   — pre-fills from the GRN. Confirm to clear the accrual and book payable.

### C. Paying a supplier

**Purchases → Vendor Payments → + New Payment**. Same allocation panel as
customer payments, but applies the amount to the supplier's open bills.

---

## 5. Stock management

| Need | Where |
|---|---|
| See current quantity for a product | **Inventory → Stock Ledger** — filter by product + warehouse |
| Move stock between warehouses | **Inventory → Stock Transfers → New Transfer** |
| Adjust stock after a count (lost, found, damaged) | **Inventory → Inventory Adjustments → New Adjustment** |
| See what's below minimum stock | **Reports → Reorder Report** (or click the Low Stock Alerts bar on the dashboard) |
| Find slow-moving items | **Reports → Slow-Moving Stock** |
| Track how old your stock is | **Reports → Stock Aging** |

### Adjustments — when to use which type

- **Inventory Adjustment (Gain)** — you found stock you didn't know was
  there. Posts DR Inventory, CR 4300 Inventory Gain.
- **Inventory Adjustment (Loss)** — you lost stock to damage / theft /
  expiry. Posts DR 6700 Inventory Loss, CR Inventory.

---

## 6. Returns

### A customer returns a part

1. **Sales → Sales Returns → + New Return** — pick the original invoice,
   import the lines, set return quantity per line, save.
2. The system creates a **Credit Note** automatically (Sales → Credit Notes).
3. Confirm the Credit Note. This reverses the original sale's GL + restocks
   the inventory (if the return is "resellable").
4. The credit balance sits as a customer advance — apply it to a future
   invoice via the payment flow.

### You return parts to a supplier

1. **Purchases → Debit Notes → + New Debit Note** — pick supplier and the
   original bill, set return qty per line, save.
2. Confirm. Reverses the original purchase: stock goes out, AP goes down.

---

## 7. Banking

### Bank transfers
**Accounting → Bank Transfers → + New Transfer.** Pick "From" and "To"
accounts, enter amount. GL-neutral move.

### Day-to-day expenses (rent, utilities, etc.)
**Accounting → Expenses → + New Expense.** Pick the expense account
(6xxx), the bank account paying it, and the amount.

### Post-Dated Cheques (PDC)

If your customer pays with a future-dated cheque, or you give one to a supplier:

- **Accounting → PDC Received** — record a cheque from a customer. When you
  deposit the cheque, mark it deposited; when it clears, mark it cleared.
  Bounced cheques get re-classified to a Bounced Cheques receivable.
- **Accounting → PDC Issued** — same for cheques you give to suppliers.

---

## 8. Reports you'll actually look at

| Report | What it answers |
|---|---|
| **Dashboard** | Today's sales, today's purchases, inventory value, receivables, payables, recent activity. The home screen. |
| **Profit & Loss** | Are you making money this month? Shows Sales − COGS = Gross Profit, then minus operating expenses = Net Profit. |
| **Balance Sheet** | What do you own vs owe right now? Current assets, fixed assets, current/long-term liabilities, equity, and **Working Capital** (current assets − current liabilities). |
| **AR Aging** | Who owes you money and for how long. Bucketed Current / 31–60 / 61–90 / 90+. |
| **AP Aging** | Who you owe money to and for how long. |
| **Stock Valuation** | What's your inventory worth right now (at MAC). |
| **Reorder Report** | What to buy next — anything at or below its minimum stock level. |
| **VAT Return** | Quarterly tax reporting summary for UAE/GCC (or GST for India). |
| **Audit Log** | Who did what, when. Every confirm/void/edit. |

### Customer & supplier 360

Click any customer or supplier name in the contact list to open their **360
view**. KPIs (Outstanding, Overdue, 12-month total, doc count), aging chart,
and tabs for all their open documents, history, and the full account
statement. The statement is printable / PDF-exportable.

---

## 9. Period close

Once a month / quarter, close the books to prevent edits to past periods:

1. **Accounting → Period Lock**.
2. Set the lock date to the last day of the period (e.g. `2026-04-30`).
3. After this, no journal entry, invoice, payment, etc. can be posted with
   a date ≤ that lock date. To post a correcting entry for a locked period,
   move the lock date forward temporarily.

---

## 10. Tips

- **Search** — every dropdown for customer / supplier / product accepts
  typeahead. Just start typing.
- **Notifications** — the bell at the top-right shows: overdue invoices,
  low-stock items, payments received today. Click any one to jump straight
  to the document.
- **Print** — every printable document (Invoice, Quote, PO, GRN, Bill,
  Credit Note, Debit Note, Statement) has a **🖨 Print** button. The output
  opens in a new tab in a print-ready layout; your browser's "Print → Save
  as PDF" does the rest.
- **Print Settings** — **Settings → Print Settings** lets you customize the
  letterhead, accent color, and footer text on every printout.
- **Languages** — toggle between English and Arabic anytime via the
  language pill in the top bar. The whole UI flips to RTL when Arabic is
  selected.
- **Data integrity** — **Settings → System Health** runs the 9 invariants
  (Trial Balance balances, AR aging = 1200 account, AP aging = 2100, etc.).
  If anything goes red, contact support before continuing to post.

---

## Need help?

- File-level reference is in this repo's `docs/` folder (`Document_2`
  through `Document_5`).
- For bugs or questions during beta: contact the StockBolt team directly.

---

*This guide reflects StockBolt v1. The Arabic translation is queued.*
