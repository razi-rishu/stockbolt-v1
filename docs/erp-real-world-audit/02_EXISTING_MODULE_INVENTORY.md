# 02 Existing module inventory

> Audit date 2026-11-25. Local staging only (Docker, 127.0.0.1). No production data, source code or schema was changed. Commit fe2ef09 plus the uncommitted quantity display fix.

Codes: A fully implemented (no defect found here), B partial, C screen without backend, D backend without screen, E not implemented, F implemented but defective, G not verified.

| Code | Modules |
|---|---|
| A | 12 |
| B | 1 |
| D | 1 |
| E | 2 |
| F | 18 |
| G | 10 |

Architecture: React + Vite client, one data adapter (src/data/supabaseAdapter.ts), business logic in PostgreSQL functions. Measured on staging: 123 tables, 353 functions, 406 policies, 157 triggers, 248 migration files. All 123 tables have row security on. Posting functions run as ledger_writer (no login, no bypass). Tests: 51 unit test files, 34 integration suites and a production regression monitor (not run).

| Module | Code | Backend | Notes |
|---|---|---|---|
| Onboarding and company setup | A | complete_onboarding, companies, branches, warehouses | Wizard activation not tested |
| Users, roles, invites | F | profiles, roles, role_permissions | SEC-01, SEC-03: rights not enforced in posting and some reads |
| Approvals | G | approval_* | Config read only; workflow not tested |
| Dashboard | A | adapter owner dashboard | Figures agreed in the KG test |
| Products, brands, categories, packs | A | products, product_units | SAL-05 |
| Vehicle catalogue | G | vehicle_* | Not tested |
| Contacts | A | contacts | - |
| Quotations | A | sales_quotes | - |
| Sales orders | D | sales_orders tables only | SO-01 (no functions, no screen) |
| Invoices | F | confirm/edit/void_invoice | SAL-01..05, PAY-02 |
| Credit notes / returns | F | confirm_credit_note | SAL-01, SAL-04 |
| Receipts, advances, refunds | F | confirm_payment and others | PAY-01, PAY-02 |
| POS | F | confirm_pos_sale | POS-01, POS-02 |
| Purchase orders | F | purchase_orders | PUR-03 |
| Goods receipts | F | confirm_grn | PUR-03, PUR-04, INV-04 |
| Vendor bills, landed cost | F | confirm_vendor_bill | PUR-01, PUR-02, PUR-05, PUR-06 |
| Debit notes | A | confirm_debit_note | - |
| Vendor payments | F | confirm_vendor_payment | PAY-01 |
| Expenses | A | confirm_expense | SEC-01 |
| Stock ledger and costing | A | stock_ledger, MAC | INV-02 |
| Transfers | B | confirm_stock_transfer | No void |
| Adjustments | F | confirm_inventory_adjustment | INV-01, INV-04 |
| Repack | A | confirm/void_stock_repack | - |
| Chart of accounts, journals | F | post_journal_entry | ACC-01, SEC-01 |
| Period lock, year-end close | F | close_fiscal_year | ACC-02; close not run |
| Fixed assets | A | run_depreciation, dispose | Asset purchase path not retested |
| Amortization | A | run_amortization | - |
| TDS / India GST | G | tds_* | Not tested (UAE company) |
| VAT return | F | file_tax_return | ACC-03, ACC-04 |
| E-invoicing | G | e_invoice_documents | Not tested |
| Bank accounts, transfers | F | confirm_bank_transfer | BNK-01 |
| Bank reconciliation | F | save_bank_reconciliation | BNK-02, BNK-03 |
| Post-dated cheques | A | create/clear/bounce_pdc | RPT-06 |
| Employees, payroll, leave salary, gratuity | F | payroll_*, settle_gratuity | HR-01 |
| Employee loans | E | employee_loans table | HR-02 |
| Attendance, leave | E | none | HR-03 |
| Projects | G | projects | Not tested |
| Reports (about 33 screens) | F | adapter reports | RPT-01..06, ACC-06 |
| Print templates | F | print engine | DOC-01 |
| Import / export | G | - | Not tested |
| Support tickets | G | support_* | Not tested |
| Subscription and billing | G | subscriptions | Not tested; payments never exercised |
| Public API | G | supabase/functions/api | Not tested |
| Android app | G | Capacitor 1.0.27 built | Phone layout crawled in a browser; no device |
