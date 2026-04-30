# StockBolt v1 — Document 2: Complete Database Schema

**Status:** Final draft for review
**Scope:** v1 (Sales, Purchases, Inventory, Banking, Accounts, POS, Reports, Multi-warehouse, Bilingual EN/AR)
**Database:** PostgreSQL (works in Supabase cloud + self-hosted Docker)
**Naming:** snake_case throughout
**Money:** `numeric(15,2)` always
**Quantity:** `numeric(15,3)` always
**IDs:** UUID v4, generated client-side

---

## Schema Principles (Apply To Every Table)

1. Every table has: `id UUID PK`, `company_id UUID FK`, `created_at`, `updated_at` (auto-updated via trigger)
2. Every foreign key is intentional with `ON DELETE` rule (RESTRICT for transactional, CASCADE for child tables)
3. Bilingual fields use `_ar` suffix
4. Status fields use `text` + `CHECK` constraint (DB rejects bad values)
5. `company_id` enforced by Row Level Security in cloud mode
6. **No cached aggregates** — `paid_amount`, `outstanding_balance`, `stock_value` are always derived from ledgers, never stored
7. Indexes on all FKs + filterable fields

---

## SECTION A — CORE / TENANCY

### `companies`
The root tenant. One row per signup. Everything else hangs off this.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| name | text NOT NULL | English company name |
| name_ar | text | Arabic company name |
| country_code | text NOT NULL | 'AE', 'SA', 'KW', 'BH', 'OM', 'QA', 'IN' |
| currency | text NOT NULL | 'AED', 'SAR', 'INR', etc. |
| tax_id | text | TRN/VAT number/GSTIN |
| is_tax_registered | bool DEFAULT false | |
| address | text | |
| address_ar | text | |
| city | text | |
| state | text | Required for India GST place-of-supply |
| phone | text | |
| email | text | |
| logo_url | text | Public URL or storage path |
| fiscal_year_start | date NOT NULL DEFAULT '2024-01-01' | |
| base_currency | text NOT NULL | Same as currency for v1 |
| period_lock_date | date | No posting on/before this date |
| allow_future_dating | bool DEFAULT false | |
| costing_method | text NOT NULL DEFAULT 'mac' | CHECK IN ('mac'). v2 will add 'fifo'. LIFO permanently excluded. |
| cogs_deferral_enabled | bool DEFAULT true | When TRUE, sales of products without a MAC defer COGS to the deferred_cogs_queue. Always TRUE in v1. |
| prices_inclusive_of_tax | bool DEFAULT false | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### `profiles`
User accounts. Linked to Supabase Auth in cloud mode.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | Matches `auth.users.id` in cloud |
| company_id | UUID FK → companies | RESTRICT |
| full_name | text NOT NULL | |
| email | text NOT NULL | |
| role | text NOT NULL DEFAULT 'admin' | CHECK IN ('admin', 'accountant', 'sales', 'counter', 'viewer') |
| assigned_warehouse_id | UUID FK → warehouses | NULLABLE; for sales/counter staff |
| phone | text | |
| is_active | bool DEFAULT true | |
| last_login_at | timestamptz | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### `audit_logs`
Append-only log of every significant action. Never deleted.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| user_id | UUID FK → profiles | NULLABLE for system actions |
| action | text NOT NULL | 'create', 'update', 'delete', 'post_gl', 'reverse_gl', 'login', 'void' |
| entity_type | text NOT NULL | 'invoice', 'bill', 'payment', etc. |
| entity_id | UUID | |
| old_data | jsonb | |
| new_data | jsonb | |
| metadata | jsonb | Free-form context |
| created_at | timestamptz | |

---

## SECTION B — MASTER DATA

### `warehouses`
Physical locations holding inventory.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| code | text NOT NULL | Short code, e.g. 'WH-MAIN' |
| name | text NOT NULL | |
| name_ar | text | |
| address | text | |
| city | text | |
| phone | text | |
| is_default | bool DEFAULT false | One row per company is default |
| is_active | bool DEFAULT true | |
| created_at, updated_at | | |

UNIQUE (company_id, code). At least one warehouse must exist per company (enforced in app, not DB).

### `categories`
Hierarchical product categorization (e.g., Brakes → Brake Pads → Front).

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| parent_id | UUID FK → categories | NULLABLE; self-reference for tree |
| name | text NOT NULL | |
| name_ar | text | |
| sort_order | int DEFAULT 0 | |
| is_active | bool DEFAULT true | |
| created_at, updated_at | | |

### `brands`
Bosch, Mahle, Mann, Mercedes Genuine, etc.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| name | text NOT NULL | |
| name_ar | text | |
| logo_url | text | |
| is_active | bool DEFAULT true | |
| created_at, updated_at | | |

UNIQUE (company_id, name)

### `units_of_measure`
PCS, SET, KG, LITRE, BOX.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| code | text NOT NULL | 'PCS' |
| name | text NOT NULL | 'Pieces' |
| name_ar | text | |
| created_at, updated_at | | |

UNIQUE (company_id, code)

### `vehicle_makes`, `vehicle_models`
Auto-parts-specific. Lookup tables for fitment data.

`vehicle_makes`:
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | NULLABLE = system-wide list |
| name | text NOT NULL | 'Mercedes-Benz', 'BMW' |
| logo_url | text | |

`vehicle_models`:
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| make_id | UUID FK → vehicle_makes | |
| name | text NOT NULL | 'E-Class' |
| chassis_code | text | 'W213' |

### `products`
The most important master table. Auto-parts-rich.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| sku | text NOT NULL | Internal SKU, unique per company |
| barcode | text | |
| name | text NOT NULL | |
| name_ar | text | |
| description | text | |
| description_ar | text | |
| oe_number | text | OEM part number |
| replacement_numbers | text[] | Cross-references (Bosch, Mahle codes) |
| brand_id | UUID FK → brands | |
| category_id | UUID FK → categories | |
| unit_id | UUID FK → units_of_measure | |
| quality_tier | text | CHECK IN ('genuine','oem','premium','economy', NULL) |
| selling_price | numeric(15,2) DEFAULT 0 | Default retail price |
| tax_category | text DEFAULT 'standard' | 'standard', 'zero_rated', 'exempt' |
| min_stock_level | numeric(15,3) DEFAULT 0 | Default, can override per-warehouse |
| max_stock_level | numeric(15,3) | |
| requires_serial | bool DEFAULT false | High-value items |
| weight_kg | numeric(10,3) | For shipping |
| image_urls | text[] | |
| is_active | bool DEFAULT true | |
| created_at, updated_at | | |

UNIQUE (company_id, sku)
INDEX on oe_number, name, name_ar (for fast search)
**NOTE:** `cost_price` and `stock_quantity` are **NOT stored here**. They're derived per-warehouse from `stock_ledger` and from the COGS strategy. **One source of truth.**

### `product_compatibility`
Vehicle fitment per product. One product can fit many vehicles.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| product_id | UUID FK → products ON DELETE CASCADE | |
| make_id | UUID FK → vehicle_makes | |
| model_id | UUID FK → vehicle_models | NULLABLE (fits all models of make) |
| year_from | int | NULLABLE |
| year_to | int | NULLABLE |
| engine | text | '2.0 Turbo', 'M276 V6' |
| notes | text | |

INDEX (product_id), INDEX (make_id, model_id, year_from, year_to)

### `product_supplier_codes`
Maps your SKU to supplier-specific part numbers.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| product_id | UUID FK → products ON DELETE CASCADE | |
| supplier_id | UUID FK → contacts | |
| supplier_sku | text NOT NULL | Their part number |
| last_purchase_price | numeric(15,2) | Auto-updated on bills |
| last_purchase_date | date | |
| created_at, updated_at | | |

UNIQUE (product_id, supplier_id)

### `product_serials`
Individual unit tracking for serial-tracked products.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| product_id | UUID FK | |
| warehouse_id | UUID FK → warehouses | Current location |
| serial_number | text NOT NULL | |
| status | text NOT NULL | CHECK IN ('available', 'reserved', 'sold', 'returned') |
| purchase_bill_id | UUID FK → vendor_bills | NULLABLE |
| sale_invoice_id | UUID FK → invoices | NULLABLE |
| purchase_date | date | |
| sale_date | date | |
| warranty_expiry | date | |
| notes | text | |
| created_at, updated_at | | |

UNIQUE (company_id, product_id, serial_number)

### `price_levels`
Retail / Wholesale / Garage / Distributor — each with markup logic.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| name | text NOT NULL | 'Retail', 'Garage Wholesale' |
| name_ar | text | |
| markup_percent | numeric(7,2) | e.g., 35.00 means cost + 35% |
| is_default | bool DEFAULT false | |
| sort_order | int DEFAULT 0 | |
| is_active | bool DEFAULT true | |

### `product_price_levels`
Optional: per-product override of price-level pricing. If absent, uses markup formula.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| product_id | UUID FK ON DELETE CASCADE | |
| price_level_id | UUID FK | |
| price | numeric(15,2) NOT NULL | |

UNIQUE (product_id, price_level_id)

---

## SECTION C — CONTACTS (Customers + Suppliers)

### `contacts`
One table for both customers and suppliers (many businesses are both).

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| code | text | Optional internal code, e.g. 'C-0001' |
| name | text NOT NULL | |
| name_ar | text | |
| type | text NOT NULL | CHECK IN ('customer', 'supplier', 'both') |
| email | text | |
| phone | text | |
| mobile | text | |
| currency | text NOT NULL | Defaults to company currency |
| tax_id | text | TRN/GSTIN |
| address_street | text | |
| address_city | text | |
| address_state | text | Required for India GST |
| address_country | text | |
| address_postal | text | |
| billing_address_ar | text | Bilingual address block |
| contact_person_name | text | |
| contact_person_phone | text | |
| contact_person_email | text | |
| credit_limit | numeric(15,2) DEFAULT 0 | 0 = no limit check |
| payment_terms_days | int DEFAULT 0 | 0 = COD, 30 = Net 30 |
| default_price_level_id | UUID FK → price_levels | |
| is_active | bool DEFAULT true | |
| notes | text | |
| created_at, updated_at | | |

INDEX (type, is_active, name)

**NOTE:** `outstanding_balance` is **NOT stored here**. It's derived from the GL via `getContactBalance(contactId)`. **One source of truth.**

---

## SECTION D — SALES

### `sales_quotes`, `sales_quote_items`
Header + line item pattern (replaces JSONB items array — proper relational structure).

`sales_quotes`:
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| quote_number | text NOT NULL | UNIQUE per company |
| contact_id | UUID FK → contacts | |
| salesperson_id | UUID FK → profiles | |
| date | date NOT NULL | |
| expiry_date | date | |
| reference | text | |
| price_level_id | UUID FK | |
| currency | text NOT NULL | |
| exchange_rate | numeric(12,6) DEFAULT 1.0 | |
| prices_inclusive | bool DEFAULT false | |
| subtotal | numeric(15,2) | Pre-tax total — stored for performance |
| discount_amount | numeric(15,2) DEFAULT 0 | |
| tax_amount | numeric(15,2) | |
| total_amount | numeric(15,2) NOT NULL | Grand total |
| status | text NOT NULL DEFAULT 'draft' | CHECK IN ('draft','sent','accepted','rejected','expired','partially_invoiced','fully_invoiced','void') |
| invoiced_amount | numeric(15,2) DEFAULT 0 | Sum of invoices created from this |
| terms | text | |
| terms_ar | text | |
| notes | text | |
| created_at, updated_at | | |

UNIQUE (company_id, quote_number)

`sales_quote_items`:
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| quote_id | UUID FK ON DELETE CASCADE | |
| product_id | UUID FK | NULLABLE for ad-hoc lines |
| description | text | Editable per-line override |
| description_ar | text | |
| quantity | numeric(15,3) NOT NULL | |
| unit_id | UUID FK | |
| unit_price | numeric(15,2) NOT NULL | |
| discount_percent | numeric(7,2) DEFAULT 0 | |
| discount_amount | numeric(15,2) DEFAULT 0 | |
| tax_category | text DEFAULT 'standard' | |
| tax_rate | numeric(7,2) | Snapshot of rate at creation |
| tax_amount | numeric(15,2) | |
| line_subtotal | numeric(15,2) | qty × price − discount, pre-tax |
| line_total | numeric(15,2) | with tax |
| sort_order | int | |

INDEX (quote_id)

### `sales_orders`, `sales_order_items`
Same structure as quotes. Status: `draft, confirmed, partially_fulfilled, fulfilled, partially_invoiced, fully_invoiced, void`.

Adds: `expected_delivery_date date`, `warehouse_id` (default warehouse for fulfillment).

### `invoices`, `invoice_items`
The big one. Source of every AR transaction.

`invoices`:
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| invoice_number | text NOT NULL | |
| contact_id | UUID FK | |
| salesperson_id | UUID FK → profiles | |
| warehouse_id | UUID FK → warehouses | Where stock was sold from |
| date | date NOT NULL | |
| due_date | date | Auto-calc: date + payment_terms_days |
| reference | text | Customer's PO number |
| price_level_id | UUID FK | |
| currency | text NOT NULL | |
| exchange_rate | numeric(12,6) DEFAULT 1.0 | |
| prices_inclusive | bool DEFAULT false | |
| subtotal | numeric(15,2) | Pre-tax |
| discount_amount | numeric(15,2) DEFAULT 0 | |
| tax_amount | numeric(15,2) | |
| total_amount | numeric(15,2) NOT NULL | |
| status | text NOT NULL DEFAULT 'draft' | CHECK IN ('draft','confirmed','void') |
| source_quote_id | UUID FK → sales_quotes | NULLABLE |
| source_order_id | UUID FK → sales_orders | NULLABLE |
| sale_channel | text DEFAULT 'standard' | 'standard', 'pos_cash', 'pos_card', 'pos_credit' |
| pos_session_id | UUID FK → pos_sessions | NULLABLE; only for POS sales |
| terms | text | |
| terms_ar | text | |
| notes | text | |
| void_reason | text | NULLABLE; required when status='void' |
| voided_at | timestamptz | |
| voided_by | UUID FK → profiles | |
| created_at, updated_at | | |

UNIQUE (company_id, invoice_number)
INDEX (contact_id, date), INDEX (warehouse_id, date), INDEX (status, date)

**Critical:** Status is just `draft / confirmed / void`. The `paid / partial / overdue` states are **derived** at read time:
- `paid_amount` = sum of allocations from `payment_allocations` where `doc_type='invoice'` and `doc_id = invoice.id`
- `outstanding` = `total_amount - paid_amount` (in invoice currency)
- `is_overdue` = `outstanding > 0 AND due_date < today`

`invoice_items`:
Same shape as `sales_quote_items` PLUS:
| Column | Type | Notes |
|---|---|---|
| cost_at_sale | numeric(15,2) | Snapshot of MAC at time of sale; used for COGS posting |
| serial_id | UUID FK → product_serials | NULLABLE; for serial-tracked items |

### `credit_notes`, `credit_note_items`
Reduces customer balance. Created from a return or as a direct credit (rebate, error correction).

`credit_notes`:
Same structure as `invoices`, plus:
| Column | Type | Notes |
|---|---|---|
| credit_note_number | text NOT NULL | |
| linked_invoice_id | UUID FK → invoices | NULLABLE; if credit relates to specific invoice |
| reason | text | 'return', 'rebate', 'price_correction', 'damage' |
| restock | bool DEFAULT true | If true, items return to inventory |

UNIQUE (company_id, credit_note_number)

### `sales_returns`
Tracks the physical return event. Generates a credit note + restocks items.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| return_number | text NOT NULL | |
| invoice_id | UUID FK → invoices | The invoice being returned against |
| date | date NOT NULL | |
| warehouse_id | UUID FK → warehouses | Where items go back |
| credit_note_id | UUID FK → credit_notes | Auto-created on confirm |
| reason | text | 'wrong_part', 'defective', 'customer_changed_mind' |
| status | text NOT NULL | 'draft', 'confirmed', 'void' |
| notes | text | |
| created_at, updated_at | | |

`sales_return_items`: product_id, qty_returned, condition ('resellable', 'damaged'), restock_warehouse_id

---

## SECTION E — PURCHASES

### `purchase_orders`, `purchase_order_items`
Same structure as sales_orders. Status: `draft, sent, partially_received, received, closed, void`.

Adds: `expected_delivery_date`, `warehouse_id` (intended destination).

### `goods_receipts`, `goods_receipt_items`
GRN — physical receipt of goods. Adds to inventory immediately, creates GRN accrual.

`goods_receipts`:
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| grn_number | text NOT NULL | |
| purchase_order_id | UUID FK → purchase_orders | NULLABLE for direct receipts |
| supplier_id | UUID FK → contacts | |
| warehouse_id | UUID FK → warehouses | Where stock landed |
| date | date NOT NULL | |
| status | text NOT NULL | 'draft', 'received', 'billed', 'void' |
| billed_amount | numeric(15,2) DEFAULT 0 | Derived; how much has been billed |
| notes | text | |
| created_at, updated_at | | |

`goods_receipt_items`: product_id, qty_received, unit_cost, total_cost, serial_numbers[]

### `vendor_bills`, `vendor_bill_items`
The actual supplier invoice. Clears GRN accrual, creates AP.

`vendor_bills`:
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| bill_number | text NOT NULL | OUR internal number |
| supplier_bill_number | text | Supplier's invoice number |
| supplier_id | UUID FK → contacts | |
| date | date NOT NULL | |
| due_date | date | |
| reference | text | |
| currency | text NOT NULL | |
| exchange_rate | numeric(12,6) DEFAULT 1.0 | |
| subtotal | numeric(15,2) | |
| discount_amount | numeric(15,2) DEFAULT 0 | |
| tax_amount | numeric(15,2) | |
| total_amount | numeric(15,2) NOT NULL | |
| status | text NOT NULL DEFAULT 'draft' | 'draft', 'confirmed', 'void' |
| linked_grn_id | UUID FK → goods_receipts | NULLABLE |
| notes | text | |
| created_at, updated_at | | |

UNIQUE (company_id, bill_number)

`vendor_bill_items`:
Same as `invoice_items` but `cost_at_sale` not needed. Add: `linked_grn_item_id` to track three-way match.

### `debit_notes`, `debit_note_items`
Mirror of credit_notes. Reduces AP, returns goods to supplier.

UNIQUE (company_id, debit_note_number)

---

## SECTION F — PAYMENTS

### `payments`
Both customer receipts (inbound) and supplier payments (outbound).

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| payment_number | text NOT NULL | |
| type | text NOT NULL | CHECK IN ('inbound', 'outbound') |
| contact_id | UUID FK → contacts | |
| date | date NOT NULL | |
| amount | numeric(15,2) NOT NULL | Total payment amount |
| currency | text NOT NULL | |
| exchange_rate | numeric(12,6) DEFAULT 1.0 | |
| payment_method_id | UUID FK → payment_methods | |
| bank_account_id | UUID FK → bank_accounts | NULLABLE for cash payments |
| reference | text | Cheque number, transfer reference |
| classification | text NOT NULL | CHECK IN ('against_invoice', 'advance', 'on_account') |
| status | text NOT NULL DEFAULT 'draft' | 'draft', 'confirmed', 'void' |
| notes | text | |
| created_at, updated_at | | |

UNIQUE (company_id, payment_number)
INDEX (contact_id, date), INDEX (type, status)

### `payment_allocations`
Maps a payment to one or more documents (invoices, bills, credit notes, debit notes). One payment can clear multiple invoices.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| payment_id | UUID FK → payments ON DELETE CASCADE | |
| doc_type | text NOT NULL | CHECK IN ('invoice', 'vendor_bill', 'credit_note', 'debit_note') |
| doc_id | UUID NOT NULL | References the document (no FK because polymorphic) |
| amount_applied | numeric(15,2) NOT NULL | In payment currency |
| created_at | | |

INDEX (payment_id), INDEX (doc_type, doc_id)

### `payment_methods`
Cash, Bank Transfer, Cheque, Card, Online Gateway. Lookup table.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| name | text NOT NULL | |
| name_ar | text | |
| type | text NOT NULL | 'cash', 'bank', 'cheque', 'card', 'online' |
| is_active | bool DEFAULT true | |

---

## SECTION G — BANKING

### `bank_accounts`
Bank accounts and petty cash boxes. Each has its own COA account.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| name | text NOT NULL | 'Emirates NBD - AED' |
| name_ar | text | |
| account_type | text NOT NULL | 'bank', 'cash' |
| account_number | text | |
| iban | text | |
| swift_code | text | |
| bank_name | text | |
| branch | text | |
| currency | text NOT NULL | |
| coa_account_id | UUID FK → chart_of_accounts | The GL account this bank maps to |
| opening_balance | numeric(15,2) DEFAULT 0 | At company setup |
| opening_balance_date | date | |
| is_default | bool DEFAULT false | |
| is_active | bool DEFAULT true | |
| created_at, updated_at | | |

**Balance is derived** from GL postings to the linked `coa_account_id`. Not stored.

### `bank_transfers`
Move money between own accounts (e.g., bank → petty cash).

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| transfer_number | text NOT NULL | |
| from_account_id | UUID FK → bank_accounts | |
| to_account_id | UUID FK → bank_accounts | |
| amount | numeric(15,2) NOT NULL | |
| date | date NOT NULL | |
| reference | text | |
| notes | text | |
| status | text NOT NULL | 'draft', 'confirmed', 'void' |
| created_at, updated_at | | |

### `pdc_cheques`
Post-dated cheques. Status machine drives GL.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| pdc_number | text NOT NULL | |
| type | text NOT NULL | 'received' (from customer), 'issued' (to vendor) |
| contact_id | UUID FK | |
| cheque_number | text NOT NULL | The physical cheque number |
| bank_name | text | |
| amount | numeric(15,2) NOT NULL | |
| currency | text NOT NULL | |
| issue_date | date NOT NULL | |
| due_date | date NOT NULL | When cheque can be deposited |
| deposit_account_id | UUID FK → bank_accounts | NULLABLE; populated when deposited |
| status | text NOT NULL DEFAULT 'pending' | CHECK IN ('pending','deposited','cleared','bounced','cancelled','returned') |
| linked_payment_id | UUID FK → payments | NULLABLE; for clear/bounce posting trail |
| notes | text | |
| created_at, updated_at | | |

INDEX (status, due_date)

### `expenses`
Direct expense booking — bypasses vendor bill flow.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| expense_number | text NOT NULL | |
| date | date NOT NULL | |
| expense_account_id | UUID FK → chart_of_accounts | The expense account |
| paid_from_account_id | UUID FK → bank_accounts | |
| amount | numeric(15,2) NOT NULL | |
| tax_amount | numeric(15,2) DEFAULT 0 | |
| total_amount | numeric(15,2) NOT NULL | |
| supplier_id | UUID FK → contacts | NULLABLE (for supplier-attributed expenses) |
| reference | text | |
| description | text NOT NULL | |
| receipt_url | text | Attached scanned receipt |
| status | text NOT NULL DEFAULT 'draft' | 'draft', 'confirmed', 'void' |
| created_at, updated_at | | |

---

## SECTION H — INVENTORY MOVEMENT

### `stock_ledger`
The inventory equivalent of the GL. Every stock movement is a row. **Source of truth for stock.**

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| product_id | UUID FK | |
| warehouse_id | UUID FK | |
| date | date NOT NULL | |
| type | text NOT NULL | 'purchase', 'sale', 'sales_return', 'purchase_return', 'transfer_out', 'transfer_in', 'adjustment_in', 'adjustment_out', 'opening_balance' |
| quantity | numeric(15,3) NOT NULL | Always POSITIVE; sign comes from `direction` |
| direction | int NOT NULL | +1 or -1 |
| unit_cost | numeric(15,2) NOT NULL | Cost at moment of movement |
| total_cost | numeric(15,2) | quantity × unit_cost |
| running_qty | numeric(15,3) | Snapshot of warehouse qty after movement (for reports) |
| running_avg_cost | numeric(15,2) | MAC after movement |
| related_doc_type | text | 'invoice', 'vendor_bill', 'grn', 'adjustment', 'transfer' |
| related_doc_id | UUID | |
| notes | text | |
| reversal_of_id | UUID FK → stock_ledger | For reversals (no deletes) |
| created_at | | |

INDEX (product_id, warehouse_id, date), INDEX (related_doc_type, related_doc_id)

**Stock quantity per warehouse is always derived:** `SUM(quantity × direction) GROUP BY warehouse_id` excluding reversed rows.

### `stock_transfers`, `stock_transfer_items`
Move stock between warehouses.

`stock_transfers`:
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| transfer_number | text NOT NULL | |
| from_warehouse_id | UUID FK | |
| to_warehouse_id | UUID FK | |
| date | date NOT NULL | |
| status | text NOT NULL | 'draft','in_transit','completed','void' |
| notes | text | |

### `inventory_adjustments`, `inventory_adjustment_items`
Stock counts, shrinkage, damages.

`inventory_adjustments`:
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| adjustment_number | text NOT NULL | |
| warehouse_id | UUID FK | |
| date | date NOT NULL | |
| reason | text NOT NULL | 'stock_count', 'damage', 'shrinkage', 'found' |
| status | text NOT NULL | 'draft','confirmed','void' |
| notes | text | |

`inventory_adjustment_items`: product_id, system_qty, actual_qty, difference, unit_cost

### `deferred_cogs_queue`
Holds COGS postings that couldn't be made at sale time because the product had no cost basis (sold before purchased). Flushed when the product is next purchased — see Doc 3 section A1.b.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| product_id | UUID FK → products | |
| invoice_item_id | UUID FK → invoice_items | The originating sale line |
| sale_invoice_id | UUID FK → invoices | For traceability |
| sale_date | date NOT NULL | Original sale date |
| warehouse_id | UUID FK → warehouses | Warehouse the sale was attributed to |
| quantity | numeric(15,3) NOT NULL | Quantity awaiting COGS |
| status | text NOT NULL DEFAULT 'pending' | CHECK IN ('pending', 'flushed', 'cancelled') |
| flushed_at | timestamptz | When the COGS was finally posted |
| flushed_journal_entry_id | UUID FK → journal_entries | The JE that finally posted COGS |
| flush_unit_cost | numeric(15,2) | The MAC used at flush time |
| created_at, updated_at | | |

INDEX (company_id, product_id, status), INDEX (sale_date)

**Visibility:** Surfaced as a "Pending COGS" report in admin so the owner can monitor backlog.

---

## SECTION I — ACCOUNTING (THE GL)

### `chart_of_accounts`
The COA. Pre-seeded standard accounts + user-added.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| code | text NOT NULL | '1100', '1110', etc. |
| name | text NOT NULL | |
| name_ar | text | |
| type | text NOT NULL | CHECK IN ('asset','liability','equity','income','expense') |
| sub_type | text | 'current_asset','fixed_asset','direct_income','indirect_income', etc. |
| parent_id | UUID FK → chart_of_accounts | NULLABLE; for grouped reporting |
| is_system | bool DEFAULT false | true = pre-seeded, can't be deleted |
| is_active | bool DEFAULT true | |
| created_at, updated_at | | |

UNIQUE (company_id, code)

### `journal_entries`
Header for batched GL postings. Every business event creates one.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| entry_number | text NOT NULL | Auto-generated, e.g., 'JE-2024-001' |
| date | date NOT NULL | |
| description | text NOT NULL | |
| source_type | text NOT NULL | 'sales_invoice','customer_receipt','vendor_payment','vendor_bill','goods_receipt','inventory_cogs','inventory_adjustment','bank_transfer','expense','manual','pdc_creation','pdc_clear','pdc_bounce','opening_balance' |
| source_id | UUID | The originating doc id (invoice_id, payment_id, etc.) |
| currency | text | |
| exchange_rate | numeric(12,6) DEFAULT 1.0 | |
| total_debit | numeric(15,2) NOT NULL | In base currency |
| total_credit | numeric(15,2) NOT NULL | Must equal total_debit (DB CHECK) |
| reversed_by_id | UUID FK → journal_entries | NULLABLE; if this JE was reversed |
| reversal_of_id | UUID FK → journal_entries | NULLABLE; if this JE IS a reversal |
| created_by | UUID FK → profiles | |
| created_at | | |

INDEX (source_type, source_id), INDEX (date), CHECK (total_debit = total_credit)

### `general_ledger`
The actual debit/credit lines. **The source of truth for everything financial.**

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| journal_entry_id | UUID FK → journal_entries ON DELETE RESTRICT | |
| account_id | UUID FK → chart_of_accounts | |
| account_code | text NOT NULL | Snapshot of code at post time |
| date | date NOT NULL | Same as journal_entries.date |
| debit | numeric(15,2) DEFAULT 0 | In base currency |
| credit | numeric(15,2) DEFAULT 0 | In base currency |
| description | text | |
| contact_id | UUID FK → contacts | NULLABLE; for AR/AP analytics |
| related_doc_type | text | Same as journal_entries.source_type |
| related_doc_id | UUID | |
| reversal_of_id | UUID FK → general_ledger | For reversal rows |
| created_at | | |

INDEX (account_id, date), INDEX (contact_id, account_id), INDEX (related_doc_type, related_doc_id)
CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0))

**Every financial query in the app eventually reads from `general_ledger`. Trial balance, P&L, balance sheet, customer balance, supplier balance, bank balance, tax reports — all derived here.**

---

## SECTION J — POS (Point of Sale)

### `pos_sessions`
A counter shift. Opened by user, closed at end of day with cash reconciliation.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| session_number | text NOT NULL | |
| user_id | UUID FK → profiles | |
| warehouse_id | UUID FK | |
| opened_at | timestamptz NOT NULL | |
| opening_cash | numeric(15,2) NOT NULL | What's in the drawer at start |
| closed_at | timestamptz | |
| closing_cash_counted | numeric(15,2) | Physical count at close |
| closing_cash_expected | numeric(15,2) | Calculated from session sales + opening |
| cash_variance | numeric(15,2) | counted − expected; +ve = surplus, -ve = short |
| variance_reason | text | |
| status | text NOT NULL | 'open', 'closed' |
| total_sales_amount | numeric(15,2) | Derived; for the closing report |
| total_sales_count | int | |
| notes | text | |
| created_at, updated_at | | |

INDEX (user_id, status), INDEX (warehouse_id, opened_at)

POS sales (in `invoices` with `pos_session_id` set) link back to the session for end-of-day reconciliation.

---

## SECTION K — TEMPLATES & SETTINGS

### `print_templates`
Stores user's choice of template per document type, plus customization (logo, colors, footer).

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| document_type | text NOT NULL | 'invoice', 'quote', 'order', 'bill', 'receipt', 'statement', 'pos_receipt' |
| template_name | text NOT NULL | 'Modern Dark', 'Classic', 'Bilingual Split' — matches code |
| is_default | bool DEFAULT false | One default per document_type |
| primary_color | text | Hex |
| accent_color | text | Hex |
| footer_text_en | text | |
| footer_text_ar | text | |
| show_salesperson | bool DEFAULT true | |
| show_due_date | bool DEFAULT true | |
| show_terms | bool DEFAULT true | |
| bilingual_print | bool DEFAULT false | |
| paper_size | text DEFAULT 'A4' | 'A4', '80mm', '58mm' |
| created_at, updated_at | | |

UNIQUE (company_id, document_type, template_name)

### `document_sequences`
Per-prefix counters for document numbers.

| Column | Type | Notes |
|---|---|---|
| company_id | UUID PK part | |
| prefix | text PK part | 'INV', 'PO', 'BILL', 'PMT', 'JE', 'CN', 'DN', 'GRN', 'TRF', 'ADJ', 'EXP', 'PDC' |
| current_value | bigint NOT NULL DEFAULT 1000 | |
| format | text DEFAULT 'PREFIX-{NUMBER}' | Optional pattern |
| pad_zeros | int DEFAULT 0 | e.g., 4 = INV-0001 |
| reset_yearly | bool DEFAULT false | INV-2024-0001 |

### `tax_rates`
Configurable tax rates beyond the country defaults.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| name | text NOT NULL | 'Standard VAT 5%', 'Zero Rated' |
| rate | numeric(7,2) NOT NULL | |
| tax_type | text NOT NULL | 'VAT', 'GST', 'CGST', 'SGST', 'IGST' |
| coa_output_account_id | UUID FK | When charged on sales |
| coa_input_account_id | UUID FK | When paid on purchases |
| is_active | bool DEFAULT true | |
| created_at, updated_at | | |

---

## SECTION L — SYSTEM TABLES

### `attachments`
Files attached to any document.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| entity_type | text NOT NULL | 'invoice', 'bill', 'expense', etc. |
| entity_id | UUID NOT NULL | |
| file_name | text NOT NULL | |
| file_url | text NOT NULL | Storage path |
| file_size | bigint | |
| mime_type | text | |
| uploaded_by | UUID FK → profiles | |
| created_at | | |

### `notifications`
In-app notifications (low stock, overdue invoices, period close reminders).

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | |
| user_id | UUID FK → profiles | NULLABLE for company-wide |
| type | text NOT NULL | 'low_stock', 'overdue_invoice', 'pdc_due', 'period_close_reminder' |
| title | text NOT NULL | |
| message | text | |
| link_to | text | Internal URL |
| is_read | bool DEFAULT false | |
| created_at | | |

---

## Row Level Security (Cloud Mode Only)

Every table gets a single RLS policy:

```sql
CREATE POLICY tenant_isolation ON <table_name>
  USING (company_id = (SELECT company_id FROM profiles WHERE id = auth.uid()));
```

This means: **a logged-in user can only see/touch rows where `company_id` matches their profile's company.** No code needs to filter by company. Postgres does it automatically. Cross-tenant leak becomes impossible at the database level.

In self-hosted (single-tenant) mode, RLS is disabled (only one company exists, so it's irrelevant).

---

## Foreign Key Discipline Summary

| Pattern | Used For |
|---|---|
| `ON DELETE CASCADE` | Child tables of a header (e.g., `invoice_items` when invoice deleted). |
| `ON DELETE RESTRICT` | Master data referenced by transactions (can't delete a customer with invoices). |
| `ON DELETE SET NULL` | Optional links (e.g., `salesperson_id` if user deactivated). |

**No financial data is ever truly deleted.** Documents go to `status='void'`, journal entries get reversed, stock ledger reversals are mirrored — but rows persist.

---

## Total Table Count: 48

By section:
- Core/Tenancy: 3
- Master Data: 13
- Contacts: 1
- Sales: 8 (quotes, orders, invoices, credit notes, returns + their item tables)
- Purchases: 6 (POs, GRNs, bills, debit notes + their item tables)
- Payments: 3
- Banking: 4
- Inventory Movement: 6 (stock_ledger, stock_transfers + items, inventory_adjustments + items, deferred_cogs_queue)
- Accounting: 3
- POS: 1
- Templates/Settings: 3
- System: 2

This covers every screen and every transaction in the Module Map.

---

## What This Schema Solves From Your Last Build

| Last Build's Problem | This Schema's Fix |
|---|---|
| 14 tables in schema, 30+ used in code | 47 tables, every one matches a code path |
| `company_id` was company name (text) | `company_id` is always UUID with FK constraint |
| camelCase vs snake_case schism | snake_case enforced everywhere |
| Cached `paid_amount` on invoices drifted | No cached aggregates — always derived from GL |
| `stock_quantity` on products drifted | No cached stock — always derived from `stock_ledger` per warehouse |
| `JSONB items` arrays were unfilterable | Proper relational item tables with FKs |
| RLS declared but never used | RLS is the multi-tenancy enforcement, day one |
| Mock localStorage masked schema bugs | Postgres-only, schema enforced from day one |
| Missing audit trail | Every JE batched + audit_logs table for everything |
| No reversal pattern | `reversal_of_id` on GL + stock_ledger; immutable history |

---

## Next Steps

This is Document 2. Once you approve it (or flag changes), I'll write:

- **Document 3 — Accounting Rulebook:** every transaction type and its exact journal entry. The thing that broke last time. We'll lock it down completely.
- **Document 4 — Reports Spec:** every report and its formula.
- **Document 5 — Build Phases:** phased rollout with done-criteria.
- **Document 6 — AGENTS.md for Claude Code:** the locked-in rules so Claude Code never drifts mid-build.

Read this schema carefully. Flag:
- Missing tables
- Missing fields (especially auto-parts-specific things you've encountered in real Pro Parts work)
- Field types that look wrong
- Anything you don't understand and want explained
