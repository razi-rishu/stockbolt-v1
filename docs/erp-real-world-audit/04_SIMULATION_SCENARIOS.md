# 04 Simulation scenarios

> Audit date 2026-11-25. Local staging only (Docker, 127.0.0.1). No production data, source code or schema was changed. Commit fe2ef09 plus the uncommitted quantity display fix.

## Test company
Audit Trading LLC (UAE, AED, VAT registered, year January to December). Two branches, two warehouses, three suppliers, five customers (one with credit limit 500), 20 products (19 goods, 1 service), five employees, one bank and one cash account, seven users (owner, accountant, sales, counter, viewer, custom warehouse manager, custom purchase manager). A second company acted as the isolation control.

Baseline 2026-10-01: bank 100,000; cash 5,000; stock P01 100 x 10.00 in warehouse 1 and P02 50 x 5.55 in warehouse 2; AR 1,000; AP 1,000; customer credit 1,000; supplier credit 1,000.

## Method
Steps used the real functions and row security, signed in as each user, plus the application adapter for reports. The KG / litre / box scenario on 2026-11-25 was entered through the real screens. One accounting currency; foreign currency is blocked by design (ACC-05), so multi-currency could not be simulated. Roles not in the product (branch manager, HR manager, sales manager) were represented by custom roles or not tested.

## Scenario list
| Test | Scenario |
|---|---|
| C1.1 | Register business through onboarding |
| C1.1b | Second company (isolation control) |
| C1.2 | Second branch |
| C1.3 | Second warehouse in second branch |
| C1.4 | Bank and cash accounts |
| C1.5-accountant | Add user accountant by invite + accept |
| C1.5-sales | Add user sales by invite + accept |
| C1.5-counter | Add user counter by invite + accept |
| C1.5-viewer | Add user viewer by invite + accept |
| C1.6 | Custom role warehouse + purchasing |
| C1.7-wh | Add custom-role user wh |
| C1.7-pu | Add custom-role user pu |
| C3 | Three suppliers |
| C7.1 | Five customers, one with credit limit 500 |
| C4.1 | Categories with subcategory |
| C4.2 | Twenty products |
| C4.3 | Opening stock 2 products |
| C3.2 | Opening balances: bank, supplier, customer |
| C3.3-ar_owed | Opening balance ar_owed |
| C3.3-ap_owed | Opening balance ap_owed |
| C3.3-customer_credit | Opening balance customer_credit |
| C3.3-vendor_credit | Opening balance vendor_credit |
| C5.4 | Purchase order 100 x P03 @8 |
| C5.5 | Partial goods receipt 60 |
| C5.6 | Complete goods receipt 40 |
| D1 | Over-receipt: 30 more than ordered |
| C5.7 | Supplier invoice for GRN1 (60 x 8) |
| D2 | Supplier invoice price differs from GRN (40 x 9 vs 8) |
| D3 | Same GRN billed twice |
| D4 | Duplicate supplier invoice number S-1 same supplier |
| C5.7b | Direct bill P04 50@4, P05 30@7.333 |
| D5 | Confirm the same bill twice |
| C5.8 | Supplier part payment 200 |
| D6 | Overpay: allocate 10,000 to a 504 bill |
| C5.10 | Purchase return 5 x P04 |
| D7 | Return more than bought (200 x P04) |
| D7b | Return 46 of 45 left from bill of 50 (already 5 returned) with stock allowed from bill limit |
| C6.2 | Transfer 20 P01 between branches/warehouses |
| D8 | Transfer more than held (500) |
| C6.7 | Damaged stock -2 |
| C6.9 | Physical count +1 (found) |
| D9 | Stale count: system_qty saved 79 but stock moved to 79+0; client claims 10 |
| C7.3 | Quotation |
| C7.9 | Sales invoice 10 P01 @20 |
| C7.10 | Partial customer payment 100 |
| C7.11 | Full payment of remaining 110 |
| D10 | Duplicate payment of a paid invoice |
| D11 | Two drafts 210 on same invoice confirmed concurrently |
| D12 | Same invoice confirmed concurrently x5 |
| D13 | Two sales of last stock concurrently (P05 stock) |
| D14 | Negative stock: sell 9999 of P04 |
| D15 | Customer over credit limit 500 (invoice 2100) |
| D16 | Duplicate invoice number |
| D18 | Return more than invoiced (50 of 10) |
| D19 | Payment reversed (void) |
| D20 | Sales invoice cancelled restores stock |
| D20b | Void an invoice that has payments |
| D21 | Customer advance then apply |
| C7.13r | Sales return with cost as the screen sends it |
| D17r | Damaged customer return with cost |
| C7.15r | Credit refund after paid invoice |
| D20c | Void invoice with a confirmed payment: allocation and AR state |
| C8.8 | Journal voucher balanced |
| D22 | Unbalanced journal |
| D22b | Unbalanced by 0.01 |
| D23 | Manual journal to AR without customer |
| D23b | Manual journal direct to Inventory 1300 |
| D23c | Manual journal labelled sales_invoice |
| D23d | Negative amounts in a journal |
| C8.7 | Business expense with VAT |
| C10.2 | Bank to cash transfer |
| D24 | Transfer more cash than held (999999) |
| C10.5 | Bank reconciliation that does not agree, locked |
| C8.9 | Fixed asset and depreciation Oct |
| D25 | Depreciation twice same month |
| C8.11 | Asset disposal for 900 |
| C8.12 | Prepaid amortization |
| C2 | Five employees |
| C9.3 | Payroll run confirm + pay |
| D26 | Second payroll same month |
| C9.8 | Employee leaves: gratuity settlement |
| C9.8b | Gratuity above accrual (500000) |
| C8.14 | Employee loan row posts to 1450 |
| C8.pdc | PDC received then cleared |
| D27 | USD 100 @3.67 invoice converts in GL |
| D28 | Deactivate product with history |
| D28b | Invoice a deactivated service product |
| D28c | Delete products with history |
| D28d | Delete contacts with history |
| D28e | Delete warehouses with history |
| D28f | Delete chart_of_accounts with history |
| S1 | Cross-tenant: read 20 tables of another company |
| S1b | Cross-tenant insert |
| S1c | Cross-tenant void/confirm |
| S1d | Own invoice with another company customer |
| S1e | Company-parameter RPCs with a foreign company id |
| S2 | Anonymous reads |
| S2b | Anonymous reset_company_data / set_user_role |
| S3 | Sales user promotes self to admin |
| S3b | User moves own profile to another company |
| S4-sales | sales reads general ledger |
| S5-sales | sales posts a manual journal |
| S6-sales | sales reads employees/salaries |
| S7-sales | sales reads supplier bills, bank accounts, expenses |
| S8-sales | sales confirms an expense |
| S4-counter | counter reads general ledger |
| S5-counter | counter posts a manual journal |
| S6-counter | counter reads employees/salaries |
| S7-counter | counter reads supplier bills, bank accounts, expenses |
| S8-counter | counter confirms an expense |
| S4-viewer | viewer reads general ledger |
| S5-viewer | viewer posts a manual journal |
| S6-viewer | viewer reads employees/salaries |
| S7-viewer | viewer reads supplier bills, bank accounts, expenses |
| S8-viewer | viewer confirms an expense |
| S4-wh | wh reads general ledger |
| S5-wh | wh posts a manual journal |
| S6-wh | wh reads employees/salaries |
| S7-wh | wh reads supplier bills, bank accounts, expenses |
| S8-wh | wh confirms an expense |
| S4-pu | pu reads general ledger |
| S5-pu | pu posts a manual journal |
| S6-pu | pu reads employees/salaries |
| S7-pu | pu reads supplier bills, bank accounts, expenses |
| S8-pu | pu confirms an expense |
| S5-acc | Accountant posts journal (should be allowed) |
| S9 | Sales user confirms payroll run |
| S9b | Sales user settles gratuity (cash out of bank) |
| S10-sales | sales voids a confirmed customer receipt |
| S10-wh | wh voids a confirmed customer receipt |
| S10-pu | pu voids a confirmed customer receipt |
| S10-viewer | viewer voids a confirmed customer receipt |
| S10-counter | counter voids a confirmed customer receipt |
| S11 | Warehouse user confirms a sales invoice |
| S11b | Purchase user: opening stock / GL opening |
| S11c | Sales user reverses a vendor-bill journal entry |
| S12 | REST: change total of CONFIRMED invoice (sales user) |
| S12b | REST: draft invoice -> confirmed without posting |
| S12c | REST: edit line of CONFIRMED invoice |
| S12d | REST: draft payment -> confirmed without posting |
| S12e | REST: insert payment already confirmed |
| S12f | REST: delete CONFIRMED invoice |
| S12g | REST: alter GL / stock ledger |
| S12h | REST: change confirmed bill / credit note amounts |
| S13 | Forge an audit log row |
| S13b | Delete audit log rows |
| S14 | Sales user changes company settings |
| C12.1 | Lock period to 2026-10-31 |
| D29 | Post into closed period |
| D29b | Accountant unlocks the period |
| D29c | REST: change date of confirmed invoice into closed period |
| C12.2 | Close fiscal year 2026 before it ends |
| E1 | Every journal balances |
| E1b | No journal header without lines |
| E2 | Stock ledger value = GL 1300 |
| S15r | Branch restriction switched on: warehouse user |
| V-void_vendor_bill | Cancel function exists: void_vendor_bill |
| V-void_grn | Cancel function exists: void_grn |
| V-void_stock_transfer | Cancel function exists: void_stock_transfer |
| V-void_inventory_adjustment | Cancel function exists: void_inventory_adjustment |
| D30 | Two users edit the same draft invoice |
| C7.1c | POS cash sale without a customer |
| C7.1d | POS cash sale with a customer, stock moves |
| E3 | System health checks |
| E4 | MAC rounding: 3 units for 10.00 |
| D31 | Bill line total tampered: qty 1 x 5 saved as total 500 |
| D31b | Invoice header total differs from lines |
| C12.3-quarterly | File VAT return with figures that do not match the books (999) |
| C12.3-monthly | File VAT return with figures that do not match the books (999) |
| S16 | Sales user reads settings secrets: api_keys hash, payment_provider_configs |
